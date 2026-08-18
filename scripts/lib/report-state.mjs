/**
 * Decides whether today's check is worth saying out loud.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The reconciliation used to run weekly, which was inherited from the laptop
 * job it replaced rather than chosen. Money moves daily: a payment that lands
 * on Tuesday leaves the tracker wrong until the following Monday, so anyone
 * reading revenue mid-week reads a stale number.
 *
 * Running it daily fixes that and breaks something else. The check has no
 * memory, so a daily run posts "9 rows need attention" every morning until
 * somebody fixes them, and a channel that cries the same wolf seven times a
 * week gets muted. A muted alert is silence you have paid for.
 *
 * So the run is daily and the SPEAKING is conditional: it posts when the set of
 * things needing correction changes, and once a week regardless.
 *
 * ---------------------------------------------------------------------------
 * WHY ONLY THE MUST-FIX LINES COUNT
 *
 * The check produces two kinds of finding. `✗` is a row a person can correct.
 * `⚠` is context — the coverage gap, buyers with no call on the tracker — and
 * those numbers move whenever anything is sold, which is most days.
 *
 * Fingerprinting both would mean the fingerprint changed every single day and
 * the daily post would be unconditional again, which is the thing being
 * avoided. So the fingerprint is built from the `✗` lines only. The `⚠` lines
 * still ride along in whatever gets posted; they just never trigger a post by
 * themselves.
 *
 * ---------------------------------------------------------------------------
 * WHY THE WEEKLY POST SURVIVES ALL OF THIS
 *
 * A check that only speaks when something changed is indistinguishable from a
 * check that has stopped running. Both are silence. The heartbeat is what makes
 * a quiet week mean "clean" instead of "broken", so it fires even when nothing
 * has changed and nothing is wrong.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const STATE_FILE = "payments-check-state.json";
/** A week, in days, before the all-clear is repeated whether or not anything moved. */
export const HEARTBEAT_DAYS = 7;

/**
 * A stable identity for "the set of things needing correction".
 *
 * The headline text carries its own counts and amounts, so a tenth row joining
 * nine changes the line and therefore the fingerprint. Sorted, because the
 * order the script happens to print its sections in is not information.
 */
export function fingerprintOf(mustFix) {
  return mustFix.map((s) => s.replace(/\s+/g, " ").trim()).sort().join(" | ");
}

/**
 * Should this run post?
 *
 * `previous` is what the last run left behind, or null on the very first run
 * or when the state store is unavailable.
 */
export function decide({ mustFix, previous, now, heartbeatDays = HEARTBEAT_DAYS }) {
  const fingerprint = fingerprintOf(mustFix);
  const hadProblems = !!(previous && previous.fingerprint);
  const hasProblems = mustFix.length > 0;

  // No memory: post. Degrading to "say it every time" is the old behaviour,
  // which is noisy but never silently drops a finding.
  if (!previous) {
    return { post: true, reason: hasProblems ? "changed" : "heartbeat", fingerprint };
  }

  if (fingerprint !== previous.fingerprint) {
    // Everything cleared. Worth saying, or the last word on these rows is that
    // they were broken and "fixed" reads the same as "nobody mentioned it".
    if (!hasProblems && hadProblems) return { post: true, reason: "recovered", fingerprint };
    return { post: true, reason: "changed", fingerprint };
  }

  const lastAt = previous.lastPostedAt ? Date.parse(previous.lastPostedAt) : NaN;
  const daysSince = Number.isNaN(lastAt) ? Infinity : (now - lastAt) / 86400000;
  if (daysSince >= heartbeatDays) return { post: true, reason: "heartbeat", fingerprint, daysSince };

  return { post: false, reason: "unchanged", fingerprint, daysSince };
}

/** A one-line explanation of why this message arrived, so nobody has to guess. */
export function reasonLine(reason, daysSince) {
  switch (reason) {
    case "changed":
      return "_Sent because what needs correcting has changed since the last report._";
    case "recovered":
      return "_Sent because everything that needed correcting has been cleared._";
    case "heartbeat":
      return `_Weekly all-clear. Nothing has changed${
        daysSince && Number.isFinite(daysSince) ? ` in ${Math.round(daysSince)} days` : ""
      } — this arrives anyway so a silent week means the check is running, not broken._`;
    default:
      return "";
  }
}

/** Missing or unreadable state is not an error — it means "no memory", handled above. */
export function readState(dir) {
  if (!dir) return null;
  try {
    return JSON.parse(readFileSync(join(dir, STATE_FILE), "utf8"));
  } catch {
    return null;
  }
}

/** Returns whether it stuck. A run that cannot remember still reports; it just repeats itself. */
export function writeState(dir, state) {
  if (!dir) return false;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}
