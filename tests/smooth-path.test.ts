/**
 * The curve under the cash total.
 *
 * Its one promise is that it bends only BETWEEN two days and never past them.
 * Most days in a window take no money, and an ordinary spline swings below the
 * floor on the way into every payment — a chart of money that went negative.
 * So every Bézier segment's control points must stay inside the vertical band
 * of the two days it joins; if they do, the curve cannot leave that band.
 */
import { describe, expect, it } from "vitest";
import { smoothPath } from "../src/lib/smooth-path";

/** Every segment as [start, control 1, control 2, end], read off the path. */
function segments(d: string) {
  const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const out: number[][][] = [];
  let at = [nums[0], nums[1]];
  for (let i = 2; i + 5 < nums.length + 1; i += 6) {
    const c1 = [nums[i], nums[i + 1]];
    const c2 = [nums[i + 2], nums[i + 3]];
    const end = [nums[i + 4], nums[i + 5]];
    out.push([at, c1, c2, end]);
    at = end;
  }
  return out;
}

/** The sparkline's own mapping: zero sits at y=97, the peak at y=12. */
function coords(values: number[]) {
  const peak = Math.max(...values, 0) || 1;
  const step = 100 / (values.length - 1);
  return values.map((v, i) => ({ x: i * step, y: 97 - (v / peak) * 85 }));
}

function staysInBand(values: number[]) {
  for (const [a, c1, c2, b] of segments(smoothPath(coords(values)))) {
    const lo = Math.min(a[1], b[1]) - 0.01;
    const hi = Math.max(a[1], b[1]) + 0.01;
    expect(c1[1]).toBeGreaterThanOrEqual(lo);
    expect(c1[1]).toBeLessThanOrEqual(hi);
    expect(c2[1]).toBeGreaterThanOrEqual(lo);
    expect(c2[1]).toBeLessThanOrEqual(hi);
  }
}

describe("smoothPath", () => {
  it("keeps a run of zero days on the floor around a single payment", () => {
    staysInBand([0, 0, 0, 4500, 0, 0, 0]);
  });

  it("does not overshoot a plateau or a payment on the last day", () => {
    staysInBand([0, 0, 3375, 3200, 0, 0, 4883, 4883, 0, 2000, 1500]);
  });

  it("holds on a steady climb and a steady fall", () => {
    staysInBand([100, 400, 900, 1600, 900, 400, 100]);
  });

  it("passes through every day it was given", () => {
    const values = [0, 1200, 0, 300, 4500];
    const pts = coords(values);
    const ends = segments(smoothPath(pts)).map((s) => s[3]);
    ends.forEach((end, i) => {
      expect(end[0]).toBeCloseTo(pts[i + 1].x, 1);
      expect(end[1]).toBeCloseTo(pts[i + 1].y, 1);
    });
  });

  it("draws two days as a straight line", () => {
    expect(smoothPath(coords([0, 100]))).toBe("M0.00 97.00 L100.00 12.00");
  });
});
