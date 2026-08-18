/**
 * The calls that ended with "let's speak again" and were never spoken to again.
 *
 * An outcome on this tracker is written at the moment the call ends and then
 * never moves. That is fine for a Customer and fine for a No deal, but BAMFAM
 * means the deal is still open — and because nothing ever rewrites the row, an
 * open deal looks exactly the same on day two as it does on day fifty. The
 * dashboard could show a close rate all day without ever mentioning that a
 * five-figure pipeline was quietly ageing out underneath it.
 *
 * So this is not a metric. It is a worklist, and it is deliberately not
 * narrowed by the date filter above it: a follow-up owed since July is exactly
 * the one a thirty-day view would hide.
 *
 * **How a row leaves the list.** Nothing ever edits the BAMFAM row itself, so
 * "done" cannot be read off it. What happens instead is that the follow-up call
 * is recorded and arrives as its OWN row, a few days later, under the same
 * name. So a prospect drops off here when a later call exists for them — which
 * is the only evidence this tracker produces that the conversation continued.
 * Without that rule the list was wrong in the worst direction: Zay closed nine
 * days after his BAMFAM and was still sitting in the chase list a month later.
 *
 * The consequence is that a follow-up that happens and is NOT recorded looks
 * identical to one that never happened. Both stay here. That is the honest
 * answer — the tracker genuinely does not know — and it is the same recording
 * gap the coverage panel exists to shrink.
 */

import { CallRecord } from "./types";
import { reportingDiscussed } from "./money";

/** The outcome that means the deal is still open and someone owes a call back. */
const OPEN_OUTCOME = "BAMFAM";

/** Past this many days a follow-up has stopped being a follow-up. */
export const FOLLOW_UP_COLD_DAYS = 30;
/** Past this many days it needs chasing today rather than this week. */
export const FOLLOW_UP_STALE_DAYS = 14;

export interface FollowUp {
  call: CallRecord;
  /** Days between the call and today. */
  age: number;
  /** What was on the table, converted for totalling. Zero when never stated. */
  worth: number;
}

export interface FollowUpResult {
  /** Oldest first — the ones most likely to have gone cold. */
  items: FollowUp[];
  /** Everything on the list, added up. */
  worth: number;
  /** How many are past the stale and cold marks. */
  stale: number;
  cold: number;
  /** Dropped because a later call exists for the same person. Never silent. */
  spokenAgain: number;
}

/**
 * A name reduced to something safe to compare two rows on.
 *
 * Returns null for anything that is not really a name. The tracker writes
 * "Unknown" whenever Fathom gave it no invitee, and on this account that is
 * several rows — matching two of those to each other would silently retire a
 * real follow-up because a different anonymous prospect was called later.
 */
function comparableName(name: string): string | null {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return null;
  if (cleaned === "unknown" || cleaned === "no name") return null;
  return cleaned;
}

/**
 * Whether this prospect shows up again on a later call.
 *
 * Email when both rows carry one, since that is an identifier. Otherwise the
 * whole name has to match, which is an inference — but a weak inference here
 * costs one unnecessary row leaving a chase list, while not making it at all
 * costs a closed customer being chased for a month.
 */
function spokeAgain(call: CallRecord, calls: CallRecord[]): boolean {
  const date = call.call_date;
  if (!date) return false;
  const name = comparableName(call.name);

  return calls.some((other) => {
    if (other.id === call.id) return false;
    if (!other.call_date || other.call_date <= date) return false;
    if (call.prospect_email && other.prospect_email) {
      return call.prospect_email === other.prospect_email;
    }
    return name != null && comparableName(other.name) === name;
  });
}

/** Whole days from `date` to `today`, both YYYY-MM-DD. Negative clamps to 0. */
function daysBetween(date: string, today: string): number {
  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 864e5));
}

/**
 * Every open follow-up across the whole tracker, oldest first.
 *
 * Takes the unfiltered call list on purpose. Everything else on the page
 * answers "how did the last thirty days go"; this one answers "who has not
 * been called back", and the answer to that does not expire when the window
 * scrolls past it.
 */
export function followUps(calls: CallRecord[], today: string): FollowUpResult {
  const open = calls.filter((c) => c.outcome === OPEN_OUTCOME && c.call_date);
  const answered = open.filter((c) => spokeAgain(c, calls));
  const outstanding = open.filter((c) => !answered.includes(c));

  const items = outstanding
    .map((call) => ({
      call,
      age: daysBetween(call.call_date as string, today),
      worth: reportingDiscussed(call),
    }))
    .sort((a, b) => b.age - a.age);

  return {
    items,
    worth: items.reduce((sum, i) => sum + i.worth, 0),
    stale: items.filter((i) => i.age >= FOLLOW_UP_STALE_DAYS).length,
    cold: items.filter((i) => i.age >= FOLLOW_UP_COLD_DAYS).length,
    spokenAgain: answered.length,
  };
}

/* ------------------------------------------------------- who has gone quiet */

export interface CloserSilence {
  closer: string;
  /** Their last recorded call. */
  lastCall: string;
  days: number;
  /** How many calls they have recorded in total, as the weight of the signal. */
  calls: number;
}

/** A closer with fewer than this many calls was never really running. */
const MIN_CALLS_TO_MISS = 3;
/** Silence shorter than this is a holiday, not a broken pipe. */
export const SILENCE_DAYS = 14;

/**
 * Closers who were recording calls and then stopped.
 *
 * The failure this exists to catch is not a lazy closer — it is a recording
 * pipeline that quietly stopped delivering one person's calls while the rest
 * kept flowing. From the dashboard's side those two look identical, and both
 * mean every number below is missing a closer's worth of calls. Either way the
 * answer is to go and look, which is why it is stated rather than inferred.
 */
export function silentClosers(
  calls: CallRecord[],
  today: string
): CloserSilence[] {
  const byCloser = new Map<string, string[]>();
  for (const call of calls) {
    if (!call.closer || !call.call_date) continue;
    const dates = byCloser.get(call.closer);
    if (dates) dates.push(call.call_date);
    else byCloser.set(call.closer, [call.call_date]);
  }

  return [...byCloser.entries()]
    .map(([closer, dates]) => {
      const lastCall = dates.reduce((a, b) => (a > b ? a : b));
      return {
        closer,
        lastCall,
        days: daysBetween(lastCall, today),
        calls: dates.length,
      };
    })
    .filter((c) => c.calls >= MIN_CALLS_TO_MISS && c.days >= SILENCE_DAYS)
    .sort((a, b) => b.days - a.days);
}

/* ---------------------------------------------------- recordings, per week */

export interface RecordingWeek {
  /** Monday of the week, YYYY-MM-DD. */
  week: string;
  calls: number;
}

/** The Monday on or before `date`. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // getUTCDay is 0 on Sunday, so Sunday belongs to the week that began six
  // days earlier rather than starting one of its own.
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

/**
 * Recordings per week, most recent last, including the weeks with none.
 *
 * A gap week has to be present or the trend lies: four bars all showing calls
 * reads as four working weeks even when two of them are missing entirely.
 */
export function recordingWeeks(
  calls: CallRecord[],
  today: string,
  weeks = 6
): RecordingWeek[] {
  const counts = new Map<string, number>();
  for (const call of calls) {
    if (!call.call_date) continue;
    const week = weekStart(call.call_date);
    counts.set(week, (counts.get(week) ?? 0) + 1);
  }

  const out: RecordingWeek[] = [];
  const cursor = new Date(`${weekStart(today)}T00:00:00Z`);
  for (let i = 0; i < weeks; i++) {
    const week = cursor.toISOString().slice(0, 10);
    out.unshift({ week, calls: counts.get(week) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return out;
}
