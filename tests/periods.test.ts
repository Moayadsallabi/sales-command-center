import { describe, expect, it } from "vitest";
import {
  monthEnd,
  monthStart,
  presetWindow,
  previousWindow,
  withinWindow,
} from "../src/lib/periods";

/**
 * The date arithmetic behind the period buttons.
 *
 * WHY THIS FILE EXISTS. On 2026-08-18 every preset on this dashboard was one
 * day longer than its label — the seven-day cash tile showed $10,175 for a
 * week that took $8,175 — and the whole suite was green, because nothing could
 * reach the window maths without rendering the page around it. The presets are
 * calendar periods now, which trades that off-by-one for month-length clamps
 * and a leap day, so the maths is asserted directly.
 *
 * Every date here is fixed. Nothing reads the clock.
 */

describe("presetWindow", () => {
  it("gives Today a window one day long, both ends the same", () => {
    expect(presetWindow("2026-08-19", "today")).toEqual({
      from: "2026-08-19",
      to: "2026-08-19",
    });
  });

  it("starts This week on Monday and stops it at today", () => {
    // 19 August 2026 is a Wednesday.
    expect(presetWindow("2026-08-19", "week")).toEqual({
      from: "2026-08-17",
      to: "2026-08-19",
    });
  });

  it("puts a Sunday at the END of its week, never the start of the next one", () => {
    // JavaScript numbers Sunday as 0, so the naive expression lands on
    // tomorrow and the window shows a day that has not happened.
    expect(presetWindow("2026-08-23", "week")).toEqual({
      from: "2026-08-17",
      to: "2026-08-23",
    });
  });

  it("starts This week on the Monday itself", () => {
    expect(presetWindow("2026-08-17", "week")).toEqual({
      from: "2026-08-17",
      to: "2026-08-17",
    });
  });

  it("lets This week run back into the previous month", () => {
    // 2 September 2026 is a Wednesday; its Monday is 31 August.
    expect(presetWindow("2026-09-02", "week").from).toBe("2026-08-31");
  });

  it("gives Last week a whole finished week, Monday to Sunday", () => {
    // 19 August 2026 is a Wednesday, so last week is 10–16 August. It does NOT
    // stop at today the way This week does: the week is over, and clipping it
    // would hand back a three-day window under a button that says week.
    expect(presetWindow("2026-08-19", "lastweek")).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
  });

  it("reads Last week on a Monday as the seven days just finished", () => {
    // The day This week holds a single day is the day Last week matters most,
    // and the naive Sunday-is-0 expression would move it a week out.
    expect(presetWindow("2026-08-17", "lastweek")).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
  });

  it("does not let a Sunday steal the week that is still running", () => {
    // 23 August 2026 is a Sunday and belongs to the week starting the 17th, so
    // Last week is still 10–16 August rather than 17–23.
    expect(presetWindow("2026-08-23", "lastweek")).toEqual({
      from: "2026-08-10",
      to: "2026-08-16",
    });
  });

  it("lets Last week run back over a month boundary", () => {
    // 2 September 2026 is a Wednesday; the week before it is 24–30 August.
    expect(presetWindow("2026-09-02", "lastweek")).toEqual({
      from: "2026-08-24",
      to: "2026-08-30",
    });
  });

  it("starts This month on the 1st and stops it at today", () => {
    expect(presetWindow("2026-08-19", "month")).toEqual({
      from: "2026-08-01",
      to: "2026-08-19",
    });
  });

  it("does not run This month past today into unlived days", () => {
    // The bar under the buttons counts the days in the window, and per-day
    // figures divide by them. Ending on the 31st would make both a third wrong.
    expect(presetWindow("2026-08-19", "month").to).not.toBe("2026-08-31");
  });

  it("gives Last month the whole calendar month, both ends", () => {
    expect(presetWindow("2026-08-19", "lastmonth")).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("wraps Last month back over a year boundary", () => {
    expect(presetWindow("2026-01-07", "lastmonth")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("ends Last month on the 28th of a non-leap February", () => {
    expect(presetWindow("2026-03-15", "lastmonth").to).toBe("2026-02-28");
  });

  it("ends Last month on the 29th of a leap February", () => {
    expect(presetWindow("2028-03-15", "lastmonth").to).toBe("2028-02-29");
  });

  it("starts This year on 1 January and stops it at today", () => {
    expect(presetWindow("2026-08-19", "year")).toEqual({
      from: "2026-01-01",
      to: "2026-08-19",
    });
  });
});

describe("previousWindow", () => {
  it("measures Today against yesterday", () => {
    expect(previousWindow({ from: "2026-08-19", to: "2026-08-19" }, "today")).toEqual({
      from: "2026-08-18",
      to: "2026-08-18",
    });
  });

  it("measures This week against the same days of last week", () => {
    // Monday–Wednesday against Monday–Wednesday. The same-length rule would
    // have given Friday–Sunday: a weekend against three trading days.
    expect(previousWindow({ from: "2026-08-17", to: "2026-08-19" }, "week")).toEqual({
      from: "2026-08-10",
      to: "2026-08-12",
    });
  });

  it("measures Last week against the week before it, both whole", () => {
    // 10–16 August against 3–9 August. Seven full days against seven full
    // days, so nothing on the strip is comparing a part-week to a whole one.
    expect(previousWindow({ from: "2026-08-10", to: "2026-08-16" }, "lastweek")).toEqual({
      from: "2026-08-03",
      to: "2026-08-09",
    });
  });

  it("measures a running month against the same stretch of the one before", () => {
    // 1–19 August against 1–19 July. Against all 31 days of July, nineteen
    // days of trading would report a collapse before anything had happened.
    expect(previousWindow({ from: "2026-08-01", to: "2026-08-19" }, "month")).toEqual({
      from: "2026-07-01",
      to: "2026-07-19",
    });
  });

  it("measures a finished month against the whole of the one before", () => {
    expect(previousWindow({ from: "2026-07-01", to: "2026-07-31" }, "lastmonth")).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
  });

  it("clamps the 31st back to a 30-day month rather than inventing a date", () => {
    // 31 August is a running month only on its last day; the comparison day
    // would be 31 July, which exists. The clamp matters going the other way.
    expect(previousWindow({ from: "2026-05-01", to: "2026-05-31" }, "lastmonth")!.to).toBe(
      "2026-04-30"
    );
  });

  it("clamps a 30-day day-of-month back into February", () => {
    const prior = previousWindow({ from: "2026-03-01", to: "2026-03-30" }, "month");
    expect(prior).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("crosses the year boundary for January", () => {
    expect(previousWindow({ from: "2026-01-01", to: "2026-01-12" }, "month")).toEqual({
      from: "2025-12-01",
      to: "2025-12-12",
    });
  });

  it("measures the year against the same stretch of the year before", () => {
    expect(previousWindow({ from: "2026-01-01", to: "2026-08-19" }, "year")).toEqual({
      from: "2025-01-01",
      to: "2025-08-19",
    });
  });

  it("pulls 29 February back to the 28th when the earlier year has no 29th", () => {
    expect(previousWindow({ from: "2028-01-01", to: "2028-02-29" }, "year")!.to).toBe(
      "2027-02-28"
    );
  });

  it("leaves every other February date alone", () => {
    // The clamp is for 29 February only. Consecutive years are never both
    // leap years, so there is no case where the 29th survives the mapping —
    // which is exactly why the guard has to be there and has to be narrow.
    expect(previousWindow({ from: "2029-01-01", to: "2029-02-28" }, "year")!.to).toBe(
      "2028-02-28"
    );
  });

  it("gives Custom the same length immediately before, never overlapping it", () => {
    const prior = previousWindow({ from: "2026-08-10", to: "2026-08-16" }, "custom");
    expect(prior).toEqual({ from: "2026-08-03", to: "2026-08-09" });
  });
});

describe("month bounds", () => {
  it("finds the 1st and the last day of a month from any day in it", () => {
    expect(monthStart("2026-08-19")).toBe("2026-08-01");
    expect(monthEnd("2026-08-19")).toBe("2026-08-31");
    expect(monthEnd("2026-02-03")).toBe("2026-02-28");
    expect(monthEnd("2028-02-03")).toBe("2028-02-29");
  });
});

describe("withinWindow", () => {
  it("counts both end days", () => {
    const window = { from: "2026-08-01", to: "2026-08-19" };
    expect(withinWindow("2026-08-01", window)).toBe(true);
    expect(withinWindow("2026-08-19", window)).toBe(true);
    expect(withinWindow("2026-07-31", window)).toBe(false);
    expect(withinWindow("2026-08-20", window)).toBe(false);
  });

  it("drops an undated row from a bounded window, and keeps it in an open one", () => {
    expect(withinWindow(null, { from: "2026-08-01", to: "2026-08-19" })).toBe(false);
    expect(withinWindow(null, { from: null, to: null })).toBe(true);
  });
});
