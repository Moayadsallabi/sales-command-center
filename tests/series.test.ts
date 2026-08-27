/**
 * The cash line under the headline figure.
 *
 * Two rules it must never break. **Empty days are drawn**, because plotting
 * only the days money arrived turns four scattered payments into a smooth
 * rising line — the opposite of what happened. And **a long window is bucketed,
 * never sampled**: summing days into blocks keeps every pound on the chart,
 * while sampling drops whole payments and quietly redraws the shape.
 *
 * The third is that the line and the number above it come from the SAME source.
 * A Whop line under a tracker total is two different answers stacked on top of
 * each other.
 */
import { describe, it, expect } from "vitest";
import { dailyTotals, cashSeries } from "../src/lib/series";
import { call } from "./helpers";

const totalOf = (points: { value: number }[]) =>
  points.reduce((sum, p) => sum + p.value, 0);

describe("dailyTotals", () => {
  it("draws a point for every day, including the empty ones", () => {
    const points = dailyTotals(
      "2026-08-01",
      "2026-08-05",
      new Map([["2026-08-01", 100], ["2026-08-05", 200]])
    );

    expect(points.map((p) => p.day)).toEqual([
      "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05",
    ]);
    expect(points.map((p) => p.value)).toEqual([100, 0, 0, 0, 200]);
    expect(points.every((p) => p.days === 1)).toBe(true);
  });

  it("counts a single-day window as one day, not zero", () => {
    const points = dailyTotals("2026-08-09", "2026-08-09", new Map([["2026-08-09", 50]]));
    expect(points).toEqual([{ day: "2026-08-09", value: 50, days: 1 }]);
  });

  it("returns nothing when the window runs backwards", () => {
    expect(dailyTotals("2026-08-10", "2026-08-01", new Map())).toEqual([]);
  });

  it("keeps every pound when a long window is bucketed", () => {
    // THE RULE. A sampled series would drop whole payments; a summed one
    // cannot. 365 days, a pound on each.
    const totals = new Map<string, number>();
    const d = new Date(Date.UTC(2026, 0, 1));
    for (let i = 0; i < 365; i++) {
      totals.set(d.toISOString().slice(0, 10), 1);
      d.setUTCDate(d.getUTCDate() + 1);
    }

    const points = dailyTotals("2026-01-01", "2026-12-31", totals);

    expect(points.length).toBeLessThanOrEqual(90);
    expect(totalOf(points)).toBe(365);
    // every day is accounted for by exactly one bucket
    expect(points.reduce((sum, p) => sum + p.days, 0)).toBe(365);
  });

  it("does not lose the last, short bucket", () => {
    // 100 days into buckets of 2 leaves a remainder to be careful with.
    const totals = new Map([["2026-01-01", 7], ["2026-04-10", 11]]);
    const points = dailyTotals("2026-01-01", "2026-04-10", totals);

    expect(totalOf(points)).toBe(18);
    expect(points[0].day).toBe("2026-01-01");
  });

  it("labels a bucket with its first day", () => {
    const totals = new Map([["2026-01-02", 5]]);
    const points = dailyTotals("2026-01-01", "2026-06-30", totals);

    expect(points[0].day).toBe("2026-01-01");
    expect(points[0].days).toBeGreaterThan(1);
    expect(totalOf(points)).toBe(5);
  });
});

describe("cashSeries reads from one source at a time", () => {
  const window = { from: "2026-08-01", to: "2026-08-03" };

  it("draws the processor's days when payments are supplied", () => {
    const points = cashSeries(
      window,
      [{ day: "2026-08-02", amount: 500 }],
      [call({ call_date: "2026-08-01", cash_collected: 9999, outcome: "Customer" })]
    );

    // the tracker's 9999 must not appear anywhere on a Whop line
    expect(points.map((p) => p.value)).toEqual([0, 500, 0]);
  });

  it("falls back to what closers logged when there are no payments", () => {
    const points = cashSeries(window, null, [
      call({ call_date: "2026-08-01", cash_collected: 300, outcome: "Customer" }),
      call({ call_date: "2026-08-03", cash_collected: 200, outcome: "Customer" }),
    ]);

    expect(points.map((p) => p.value)).toEqual([300, 0, 200]);
  });

  it("adds up two payments landing on the same day", () => {
    const points = cashSeries(
      window,
      [
        { day: "2026-08-02", amount: 500 },
        { day: "2026-08-02", amount: 250 },
      ],
      []
    );

    expect(points.map((p) => p.value)).toEqual([0, 750, 0]);
  });

  it("leaves a refund out of the tracker line", () => {
    const points = cashSeries(window, null, [
      call({ call_date: "2026-08-01", cash_collected: 300, outcome: "Customer" }),
      call({ call_date: "2026-08-02", cash_collected: 400, outcome: "REFUND" }),
    ]);

    expect(points.map((p) => p.value)).toEqual([300, 0, 0]);
  });

  it("borrows its bounds from the data when the window is open-ended", () => {
    const points = cashSeries({ from: null, to: null }, null, [
      call({ call_date: "2026-08-04", cash_collected: 100, outcome: "Customer" }),
      call({ call_date: "2026-08-06", cash_collected: 100, outcome: "Customer" }),
    ]);

    expect(points.map((p) => p.day)).toEqual(["2026-08-04", "2026-08-05", "2026-08-06"]);
  });

  it("draws nothing rather than guessing on an empty dashboard", () => {
    expect(cashSeries({ from: null, to: null }, null, [])).toEqual([]);
    expect(cashSeries({ from: null, to: null }, [], [])).toEqual([]);
  });

  it("ignores a call with no date rather than placing it somewhere", () => {
    const points = cashSeries(window, null, [
      call({ call_date: null, cash_collected: 5000, outcome: "Customer" }),
    ]);

    expect(totalOf(points)).toBe(0);
  });
});
