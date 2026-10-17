/**
 * The search box's ranking, and the running total the pace chart draws.
 *
 * The search's promise is that every word typed has to land somewhere, so a
 * closer's name plus an outcome narrows to that closer's calls with that
 * outcome rather than widening to everything mentioning either. The chart's
 * promise is that its last point IS the total printed above it.
 */
import { describe, expect, it } from "vitest";
import { matchRank as score } from "../src/lib/match-rank";
import { runningTotals } from "../src/lib/series";

const call = (label: string, detail: string, keywords = "") => ({ label, detail, keywords });

describe("search ranking", () => {
  it("drops a row when any typed word lands nowhere", () => {
    expect(score("sam deal", call("Dana Silva", "Sam Rep · 19 Sept · Customer"))).toBe(0);
    expect(score("sam deal", call("Indigo Park", "Sam Rep · 2 Aug · No deal"))).toBeGreaterThan(0);
  });

  it("ranks a name that starts with the query above one that only contains it", () => {
    const starts = score("ana", call("Anaya Brooks", ""));
    const contains = score("ana", call("Dana Silva", ""));
    expect(starts).toBeGreaterThan(contains);
    expect(contains).toBeGreaterThan(0);
  });

  it("ranks a match in the name above a match in the detail", () => {
    expect(score("sam", call("Sam Rep", "closer"))).toBeGreaterThan(
      score("sam", call("Dana Silva", "Sam Rep · 19 Sept"))
    );
  });

  it("treats typed punctuation as text, not as a pattern", () => {
    expect(() => score("o'neil (", call("Shay O'Neil", ""))).not.toThrow();
    expect(score("o'neil", call("Shay O'Neil", ""))).toBeGreaterThan(0);
  });
});

describe("runningTotals", () => {
  it("ends on the window's total, so the chart ends on the headline", () => {
    const points = [0, 4500, 0, 0, 1125, 3375].map((value, i) => ({
      day: `2026-10-0${i + 1}`,
      value,
      days: 1,
    }));
    const run = runningTotals(points);
    expect(run).toEqual([0, 4500, 4500, 4500, 5625, 9000]);
    expect(run[run.length - 1]).toBe(points.reduce((s, p) => s + p.value, 0));
  });

  it("can fall, when a refund takes money back out", () => {
    const run = runningTotals([
      { day: "2026-10-01", value: 2000, days: 1 },
      { day: "2026-10-02", value: -500, days: 1 },
    ]);
    expect(run).toEqual([2000, 1500]);
  });
});
