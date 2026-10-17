/**
 * A smooth line through every point that never overshoots one.
 *
 * Monotone cubic interpolation (Fritsch–Carlson, the same curve d3 calls
 * `curveMonotoneX`): each tangent is limited by the slopes either side of it,
 * so the curve can only bend between two days, never past them. That matters
 * more here than anywhere — most days in a window are zero, and an ordinary
 * spline would swing below zero on the way into every spike, drawing money
 * that went negative. With this one a zero day stays on the floor.
 */
export function smoothPath(c: { x: number; y: number }[]): string {
  const n = c.length;
  const fmt = (v: number) => v.toFixed(2);
  if (n < 3) {
    return c.map((p, i) => `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`).join(" ");
  }

  // The slope of each straight segment.
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = c[i + 1].x - c[i].x;
    secant.push(h === 0 ? 0 : (c[i + 1].y - c[i].y) / h);
  }

  // The tangent at each point: zero at a peak, a trough or a flat, otherwise
  // the gentlest of the two neighbouring slopes and their average.
  const tangent = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const a = secant[i - 1];
    const b = secant[i];
    if (a * b <= 0) continue;
    const h0 = c[i].x - c[i - 1].x;
    const h1 = c[i + 1].x - c[i].x;
    const p = (a * h1 + b * h0) / (h0 + h1);
    tangent[i] = Math.sign(a) * Math.min(Math.abs(a), Math.abs(b), 0.5 * Math.abs(p));
  }
  // The two ends take the slope that keeps the first and last segments a
  // plain cubic, held to the segment's own direction so neither can overshoot.
  const end = (s: number, t: number) => {
    const v = (3 * s - t) / 2;
    return Math.sign(v) !== Math.sign(s) ? 0 : Math.abs(v) > 3 * Math.abs(s) ? 3 * s : v;
  };
  tangent[0] = end(secant[0], tangent[1]);
  tangent[n - 1] = end(secant[n - 2], tangent[n - 2]);

  let d = `M${fmt(c[0].x)} ${fmt(c[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (c[i + 1].x - c[i].x) / 3;
    d +=
      ` C${fmt(c[i].x + dx)} ${fmt(c[i].y + dx * tangent[i])}` +
      ` ${fmt(c[i + 1].x - dx)} ${fmt(c[i + 1].y - dx * tangent[i + 1])}` +
      ` ${fmt(c[i + 1].x)} ${fmt(c[i + 1].y)}`;
  }
  return d;
}
