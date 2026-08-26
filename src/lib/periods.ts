/**
 * THE PERIOD ON SCREEN, AND THE ONLY DEFINITION OF IT.
 *
 * These live in their own module so they can be tested without mounting the
 * dashboard. They had to be: every one of them is date arithmetic with an
 * off-by-one or a clamp in it, and the last date bug here — a seven-day window
 * that held eight days of money — shipped green because nothing could reach
 * the maths without rendering the whole page around it.
 *
 * Pure by construction. Nothing in this file reads the clock; `today` is
 * always passed in, which is what makes a fixed-date test possible at all.
 */

/**
 * EVERY PRESET IS A CALENDAR PERIOD — today, this week, last week, this
 * month, last month, this year.
 *
 * The ROLLING windows (7 days, 30 days, 90 days) and All time came off this
 * strip on 2026-08-19 on Moayad's call. A page that offers "the last 30 days"
 * next to a monthly cash goal invites the two to be read as the same number,
 * and on the 19th of the month they never are: the goal counted 1–19 August
 * while every tile beside it counted 21 July onwards.
 *
 * The cost of calendar periods is that a period still running is a short
 * window, so the comparison has to be short too — see previousWindow, which
 * measures 1–19 August against 1–19 July rather than against all of it, and
 * Monday-to-Wednesday against Monday-to-Wednesday of the week before.
 */
export type DateRange = "today" | "week" | "lastweek" | "month" | "lastmonth" | "year" | "custom";

export const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "lastweek", label: "Last week" },
  { value: "month", label: "This month" },
  { value: "lastmonth", label: "Last month" },
  { value: "year", label: "This year" },
  { value: "custom", label: "Custom" },
];

/**
 * Both ends of the period on screen, inclusive, as YYYY-MM-DD.
 *
 * The ends stay nullable although no preset produces a null one any more —
 * All time came off the strip on 2026-08-19. The series code below still reads
 * an open end as "borrow the data's own first and last day", which is the
 * right answer for an empty account and costs nothing to keep.
 *
 * Every date filter on this page reads one of these rather than working out
 * its own cutoff. When each panel did its own arithmetic they could disagree
 * about what "this week" meant and nothing on screen would say so.
 */
export type DateWindow = { from: string | null; to: string | null };

/** `isoDate` minus `days`, as YYYY-MM-DD. Pure — no clock reading. */
export function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

/** Whole days from `from` to `to` inclusive — the 9th to the 9th is one day. */
export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * The Monday of the week `iso` falls in.
 *
 * Written as `getUTCDay() + 6) % 7` rather than `getUTCDay() - 1` because
 * JavaScript numbers Sunday as 0: subtracting one lands on TOMORROW, so once a
 * week "This week" would show a range that had not happened yet and every tile
 * in it would read zero. The KPI dashboard shipped exactly that bug.
 */
export function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return daysBefore(iso, (d.getUTCDay() + 6) % 7);
}

/** The 1st of the calendar month `iso` falls in. */
export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** The last day of the calendar month `iso` falls in — day 0 of the next. */
export function monthEnd(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().split("T")[0];
}

/** Any day inside the calendar month before the one `iso` falls in. */
export function inPreviousMonth(iso: string): string {
  return daysBefore(monthStart(iso), 1);
}

/**
 * The same day of an earlier month, CLAMPED to that month's length.
 *
 * Without the clamp, 31 August against July is fine and 31 March against
 * February is `2026-02-31` — a date that exists nowhere, matches no row, and
 * reports the comparison period as empty rather than as broken.
 */
export function sameDayOf(monthIso: string, day: number): string {
  const last = Number(monthEnd(monthIso).slice(8, 10));
  return `${monthIso.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/**
 * A PRESET COUNTS ITS OWN LAST DAY, and a month still running STOPS AT TODAY.
 *
 * "This month" ending on the 31st while today is the 19th would put twelve
 * unlived days inside the window: the day count under the buttons would read
 * 31, and every per-day figure computed across the window would be a third
 * too low with nothing on screen saying why.
 */
export function presetWindow(today: string, range: DateRange): DateWindow {
  if (range === "today") return { from: today, to: today };
  if (range === "week") return { from: weekStart(today), to: today };
  // LAST WEEK IS A FINISHED WEEK — the Monday to the Sunday before this one,
  // both ends, never stopping at today. "This month" and "This year" stop at
  // today because they are still running; a week already over is not, and
  // clipping it would hand back the same partial window as This week.
  if (range === "lastweek") {
    const monday = daysBefore(weekStart(today), 7);
    return { from: monday, to: daysBefore(weekStart(today), 1) };
  }
  if (range === "month") return { from: monthStart(today), to: today };
  if (range === "lastmonth") {
    const prior = inPreviousMonth(today);
    return { from: monthStart(prior), to: monthEnd(prior) };
  }
  // This year stops at today for the same reason this month does.
  return { from: `${today.slice(0, 4)}-01-01`, to: today };
}

/** Inclusive at both ends, and false for a record with no date to test. */
export function withinWindow(date: string | null | undefined, window: DateWindow): boolean {
  if (window.from === null && window.to === null) return true;
  if (!date) return false;
  if (window.from !== null && date < window.from) return false;
  if (window.to !== null && date > window.to) return false;
  return true;
}

/**
 * What every "vs last period" figure on the page is measured against.
 *
 * A CALENDAR PERIOD IS COMPARED AGAINST THE SAME STRETCH OF THE ONE BEFORE IT,
 * not against the whole of it and not against the days immediately preceding.
 * On the 19th of August, "vs last month" means 1–19 July. Compared against all
 * 31 days of July, 19 days of trading reports a 39% collapse before anything
 * has happened; compared against 13–31 July, it is measured against a stretch
 * that starts mid-month and answers no question anybody asks.
 *
 * A month already finished keeps the full-month comparison — February against
 * the whole of January is what people mean.
 *
 * Custom keeps the same-length-immediately-before rule, because a hand-picked
 * range has no calendar predecessor to point at.
 */
export function previousWindow(window: DateWindow, range: DateRange): DateWindow | null {
  if (window.from === null || window.to === null) return null;

  // THIS WEEK IS COMPARED AGAINST THE SAME DAYS OF LAST WEEK, not against the
  // days immediately before it. On a Wednesday the same-length rule would set
  // Monday–Wednesday against Friday–Sunday: a weekend against three trading
  // days, which is the comparison that makes every Monday look catastrophic.
  // Last week takes the same rule for the same reason: the seven days before
  // it, aligned Monday to Sunday, rather than the generic same-length window.
  // They happen to agree here — a whole week shifted back seven days is the
  // week before it either way — but the alignment is stated rather than
  // inherited, so a later change to the generic rule cannot quietly move it.
  if (range === "week" || range === "lastweek") {
    return { from: daysBefore(window.from, 7), to: daysBefore(window.to, 7) };
  }

  if (range === "month" || range === "lastmonth") {
    const prior = inPreviousMonth(window.from);
    const runningTo = sameDayOf(prior, Number(window.to.slice(8, 10)));
    // A completed month spans its own last day, so it compares against the
    // whole of the month before; a running one stops at the same day.
    const finished = window.to === monthEnd(window.to);
    return { from: monthStart(prior), to: finished ? monthEnd(prior) : runningTo };
  }

  if (range === "year") {
    const year = Number(window.from.slice(0, 4)) - 1;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    // 29 February exists in this year and not necessarily in the one before.
    const tail = window.to.slice(5) === "02-29" && !leap ? "02-28" : window.to.slice(5);
    return { from: `${year}-01-01`, to: `${year}-${tail}` };
  }

  const length = daysBetween(window.from, window.to);
  return { from: daysBefore(window.from, length), to: daysBefore(window.from, 1) };
}
