/**
 * WHOSE DAY IS IT. ONE ANSWER, FOR EVERYTHING THAT TURNS AN INSTANT INTO A DAY.
 *
 * Plain .mjs, and imported by `src/lib/business-day.ts` rather than copied into
 * it, for the reason `buyer-match.mjs` gives at length: the check scripts ask
 * this same question — which day a tracker row belongs to, which day to print —
 * and a .mjs script cannot import a .ts module. Two copies agree until the day
 * they do not, and this file exists because of a day two copies did not agree.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * These helpers lived in `lib/calendar.ts`, and its header said plainly why the
 * grid needed them: a Calendly `scheduled_at` is an INSTANT, and an instant
 * only becomes a day once you say whose day you mean. `2026-09-05T01:00:00Z` is
 * a call at nine on the evening of the 4th for the team taking it.
 *
 * That header also said "the rest of the page is untouched: nothing here is a
 * denominator, and no rate is computed from these groupings." That was true of
 * the grid and false of the page. `lib/bookings.ts` was turning the same
 * instants into days with `scheduled_at.slice(0, 10)` — UTC — to decide which
 * booking belongs to which call, and which bookings fall inside the window on
 * screen. Both of those ARE denominators.
 *
 * Measured on Brey's live account, 2026-09-10: 27 of 574 bookings (4.7%) sit on
 * a different calendar day under the two rules, and the cost was not a rounding
 * error. Twice in ten days the same-day name fallback could not see a call's
 * own booking — it had crossed midnight into the next UTC day — and matched the
 * call to the slot the prospect had RESCHEDULED AWAY FROM instead:
 *
 *   Mike Totall, 4 Sept, call at 20:55. Its 21:00 booking read as 5 September,
 *   so the only booking left on the 4th was the 19:00 slot he had moved. The
 *   calendar drew that abandoned slot as a No-show, and the 21:00 booking he
 *   actually attended as "Not recorded".
 *
 *   Pluto, 1 Sept. Matched to a 31 August 20:00 slot, for the same reason.
 *
 * Both moved slots then carried a call, so they stopped being cancellations and
 * escaped the "a moved slot is not a second booking" subtraction: `booked` read
 * 53 where the rule intends 51. One 31 August booking was counted inside
 * September, which at a month boundary is systematic rather than bad luck.
 *
 * So the rule is written once, here, and the grid, the matcher and the window
 * filter all read it. A second copy agrees until the day it does not — the same
 * arrangement `sales-rules.json` and `buyer-match.mjs` already have.
 *
 * ---------------------------------------------------------------------------
 * WHICH ZONE, AND WHY THE NEAR MISSES ARE THE DANGEROUS ONES
 *
 * `ClientConfig.timeZone` — the business's own answer, one for the whole
 * client, the same one the ad spend and the call dates are counted on.
 *
 * The grid first shipped reading the zone off the Calendly ACCOUNT, which is
 * whoever created the login: America/Chicago on Brey's, where the business runs
 * on America/New_York. One hour out. Nothing looks wrong — the times are still
 * working hours, and only the calls at either end of the day land on the wrong
 * square. An hour is harder to spot than five.
 *
 * With no zone configured everything falls back to UTC, which is what this did
 * before any of it existed. That is a knowingly worse answer, not a broken one,
 * and the calendar panel says on screen which zone it drew.
 */

/**
 * A zone we can actually format in. An account with a zone this build of Node
 * or this browser does not know still gets a calendar, drawn in UTC and
 * labelled UTC, rather than an exception halfway down the page.
 */
export function usableZone(zone) {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

/**
 * Formatters are expensive to build and this is called once per booking per
 * render, so each zone's pair is built once and kept.
 */
const dayFormatters = new Map();
const timeFormatters = new Map();

function dayFormatter(zone) {
  let fmt = dayFormatters.get(zone);
  if (!fmt) {
    // en-CA renders as YYYY-MM-DD, which is the shape every other date on this
    // page is stored and compared in — so the output slots straight into
    // `withinWindow` and friends without a second parse.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(zone, fmt);
  }
  return fmt;
}

function timeFormatter(zone) {
  let fmt = timeFormatters.get(zone);
  if (!fmt) {
    // `hourCycle: "h23"` rather than `hour12: false`: the latter renders
    // midnight as 24:00 in several engines, which reads as tomorrow.
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(zone, fmt);
  }
  return fmt;
}

/** The `YYYY-MM-DD` an instant falls on, in `zone`. Null if it will not parse. */
export function dayInZone(iso, zone) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return dayFormatter(zone).format(new Date(ms));
}

/** `14:30`, in `zone`. Null if it will not parse. */
export function timeInZone(iso, zone) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return timeFormatter(zone).format(new Date(ms));
}

/**
 * THE ONE CONVERSION EVERY READER OF A STORED DATE SHOULD USE.
 *
 * Two shapes arrive at this app wearing the same name, and only one of them is
 * an instant:
 *
 *   `2026-09-07`                      a calendar day. Already the answer.
 *   `2026-09-07T21:51:00.000+00:00`   an instant. Needs a zone to become a day.
 *
 * Notion's Call Date holds both — a date property answers the first shape until
 * somebody writes a time into it, and the Fathom automation now writes the
 * call's exact start on purpose. Calendly's `scheduled_at` is always the second.
 *
 * A day-only value is returned untouched. Parsing it in a zone would hand
 * midnight to whoever is looking and slide it either side, which is the fault
 * `lib/periods.ts` guards against everywhere else by reading days as UTC.
 *
 * A timestamped value is converted to the client's business day. Slicing it
 * instead takes the day as WRITTEN, in whatever offset the writer happened to
 * use — and Brey's tracker writes two: since 25 August, 11 stamped rows carry
 * `-04:00` and 4 carry `+00:00`. Today those agree, because no `+00:00` row is
 * late enough in the evening to cross midnight. The first one that is would be
 * filed a day late, silently, which is the fault that had to be corrected for
 * 24 rows in workspace commit f5f4073.
 */
export function businessDay(value, zone) {
  if (!value) return null;
  // A bare YYYY-MM-DD is already a day, and no zone can improve it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  /* NO ZONE MEANS THE DAY AS WRITTEN, WHICH IS NOT THE SAME AS UTC.
     A Notion stamp carries its own offset — `2026-09-04T20:55:00.000-04:00` —
     and the day in front of the T is the day the person entering the call saw.
     Converting that to UTC files an evening call on tomorrow, which is the
     fault this whole module exists to stop, so an unconfigured install must not
     be handed it as a "default". It keeps exactly what it had before the zone
     existed. A Calendly `scheduled_at` is already UTC, so for those the two
     answers are the same string either way. */
  const resolved = zone ? usableZone(zone) : null;
  if (!resolved || resolved !== zone) return value.slice(0, 10);
  return dayInZone(value, resolved);
}

/**
 * How a zone is named on screen: `America/New_York · GMT-4`.
 *
 * Both halves, because neither is enough on its own. The abbreviation is what
 * a person recognises; the IANA name is what they can check against Calendly,
 * and it does not change when the clocks do.
 */
export function zoneLabel(zone, on = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(on);
    const abbrev = parts.find((p) => p.type === "timeZoneName")?.value ?? null;
    return abbrev && abbrev !== zone ? `${zone} · ${abbrev}` : zone;
  } catch {
    return zone;
  }
}

/**
 * The client's business zone as a check script sees it.
 *
 * The app resolves this through the client registry (`ClientConfig.timeZone`);
 * a script has only the environment, and these are the two variables that
 * registry falls back to. Null when neither is set, which `businessDay` reads
 * as UTC.
 */
export function clientZone() {
  return (
    process.env.CLIENT_TIME_ZONE?.trim() ||
    process.env.WHOP_TIME_ZONE?.trim() ||
    null
  );
}
