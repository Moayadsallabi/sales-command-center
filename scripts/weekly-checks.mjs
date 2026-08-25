/**
 * The weekly reconciliation, run by a schedule instead of by remembering.
 * Run with: npm run check:weekly
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * check-payments was written to be run weekly and had no schedule. Until this
 * was built it lived in a Mac calendar entry that had never fired once — if
 * that laptop was shut on a Monday morning, the week was simply skipped, and
 * nothing anywhere said so.
 *
 * check-accuracy started out in here too and was taken out on 2026-08-19; the
 * long comment further down says why, and it is worth reading before putting it
 * back.
 *
 * ---------------------------------------------------------------------------
 * WHY IT DOES NOT CORRECT ANYTHING
 *
 * check-payments can write its corrections straight into Notion with --apply.
 * That is deliberately not what runs here. Its own header says the correction
 * cannot be automated: only a person knows whether a payment is the deal
 * closing, a deposit on a follow-up, or a second instalment on a deal already
 * counted. An unattended writer would put its best guess into a client's
 * tracker before anyone had seen it.
 *
 * So this reads, reports, and names the command that does the writing. The
 * judgement stays with a person; only the searching is automated.
 *
 * ---------------------------------------------------------------------------
 * WHY IT REPORTS A CLEAN WEEK TOO
 *
 * A check that only speaks when it finds something looks exactly like a check
 * that has stopped running. Both are silence. It posts either way, so a quiet
 * Monday means the schedule is broken rather than the books being clean.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { decide, reasonLine, readState, writeState } from "./lib/report-state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
/** Both scripts page through months of Whop, Notion and Calendly. */
const TIMEOUT_MS = 6 * 60 * 1000;

const CLIENT = process.env.WEEKLY_CHECK_CLIENT || process.env.NEXT_PUBLIC_BRAND_NAME || "the tracker";
/**
 * Where the last run's fingerprint is kept.
 *
 * Every scheduled run is a brand new container with a brand new filesystem, so
 * this has to be a mounted volume to survive between runs. Without one the
 * script still works and simply reports every time — noisy, but it can never
 * silently swallow a finding, which is the failure that would matter.
 */
const STATE_DIR = process.env.STATE_DIR || "/data";
/** Set to skip the "has anything changed" logic and always report. */
const ALWAYS_REPORT = process.env.ALWAYS_REPORT === "1";

/** Run one check and collect everything it printed. Never throws. */
function runScript(file, args = []) {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (r) => {
      if (!settled) { settled = true; resolve(r); }
    };

    let child;
    try {
      child = spawn(process.execPath, [join(ROOT, "scripts", file), ...args], { cwd: ROOT, env: process.env });
    } catch (err) {
      return finish({ code: 2, output: `could not start ${file}: ${err.message}` });
    }

    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      finish({ code: 2, output: `${out}\n${file} was still running after ${TIMEOUT_MS / 60000} minutes and was stopped.` });
    }, TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (err) => { clearTimeout(timer); finish({ code: 2, output: `could not start ${file}: ${err.message}` }); });
    child.on("close", (code) => { clearTimeout(timer); finish({ code: code === null ? 2 : code, output: out }); });
  });
}

/**
 * Cut a headline to whole sentences.
 *
 * The check scripts wrap their longer headlines across several physical lines,
 * so taking the marker's line alone can end mid-clause — "it is the list to go"
 * was the first thing this printed. Ending on a full stop is the difference
 * between a summary and a sentence fragment nobody can act on.
 */
function firstSentences(text, maxChars = 200) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (lastStop > 40) return cut.slice(0, lastStop + 1);
  return cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

/**
 * Headline lines only — the ones the script starts at column 0 with a marker.
 * The indented lines under each are the individual rows, which belong in the
 * run's log rather than in a phone notification.
 *
 * A headline that wraps is rejoined first: its continuation lines are indented
 * and carry no row markers, unlike the rows that follow.
 */
function headlines(output, markers) {
  const lines = output.split("\n");
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (!markers.some((m) => lines[i].startsWith(m + " "))) continue;
    let text = lines[i].slice(2).trim();
    // Keep absorbing indented continuation until the blank line that ends the
    // headline. The row list that follows always starts after that blank.
    for (let j = i + 1; j < lines.length && lines[j].trim(); j++) {
      text += " " + lines[j].trim();
      i = j;
    }
    // A HEADLINE WRITTEN FOR THE TERMINAL ENDS IN A COLON, because the rows it
    // introduces are printed underneath it. Slack gets the headline and not the
    // rows, so that colon promises a list that never arrives — three bullets in
    // the 2026-08-24 report each stopped dead on one. Closed here rather than in
    // the checks themselves: every check writes for the terminal, and the
    // terminal is right to want the colon.
    if (text) found.push(firstSentences(text).replace(/\s*:$/, "."));
  }
  return found;
}

function cap(lines, max = 6) {
  return lines.length <= max ? lines : lines.slice(0, max).concat(`…and ${lines.length - max} more`);
}

/**
 * Returns the lines to print AND the must-fix list separately, because the
 * must-fix list is what decides whether any of this gets sent at all.
 *
 * A run that could not read Whop reports a must-fix of its own: "the check did
 * not happen" has to be able to break the silence, or a permanently broken
 * check looks exactly like a permanently clean one.
 */
function paymentsSection({ code, output }) {
  if (code === 2) {
    return {
      mustFix: ["the payments check could not run"],
      lines: [
        "🚨 *Payments check could not run.*",
        "```" + output.trim().split("\n").slice(-4).join("\n") + "```",
        "The tracker's money was not checked against Whop.",
      ],
    };
  }

  const mustFix = headlines(output, ["✗"]);
  const worthKnowing = headlines(output, ["⚠"]);

  if (!mustFix.length && !worthKnowing.length) {
    return { mustFix, lines: ["✅ *Payments* — the tracker and Whop agree on every row that can be matched."] };
  }

  // Some findings are ones --apply deliberately refuses to write — a payment
  // already closed on a later call is the one that exists today. When those are
  // all that is left, naming the command sends somebody to run a no-op, so the
  // check's own closing sentence decides whether it is offered. It prints the
  // line below only when it has something mechanical to write.
  const canApply = output.includes("Rerun with `npm run check:payments -- --apply`");

  const out = [];
  if (mustFix.length) {
    out.push(`⚠️ *Payments* — ${mustFix.length} thing${mustFix.length === 1 ? "" : "s"} to correct in the tracker:`);
    out.push(...cap(mustFix).map((l) => `  • ${l}`));
    if (canApply) {
      out.push("", "To apply the mechanical corrections: `npm run check:payments -- --apply`");
      out.push("Read the list first — a payment can be a close, a deposit, or a second instalment, and only you can tell which.");
    } else {
      out.push("", "These are edits only a person can make — run `npm run check:payments` to see which row needs what.");
    }
  } else {
    out.push("✅ *Payments* — no row needs correcting against Whop.");
  }

  if (worthKnowing.length) {
    out.push("", "*Worth knowing, not errors:*");
    out.push(...cap(worthKnowing).map((l) => `  • ${l}`));
  }
  return { mustFix, lines: out };
}

/** Post to the alert relay, and treat anything but "ok" as an undelivered alert. */
/** The Monday of two weeks ago, as YYYY-MM-DD. */
function twoWeeksAgo() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 14);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether calls are reaching the tracker, and what is waiting on a ruling.
 *
 * Deliberately reports the clean case too, for the same reason the payments
 * section does: a check that only speaks when it finds something is
 * indistinguishable from a check that has stopped running.
 *
 * A non-zero exit is reported as an unknown rather than as a clean result —
 * the scripts exit non-zero when the recorder rate-limits, and reading that as
 * "nothing missing" would be the exact failure this section exists to catch.
 */
function arrivalSection(delivery, dropped) {
  const missing = (delivery.output.match(/(\d+) sales recordings never reached the tracker/) || [])[1];
  const backlog = (dropped.output.match(/(\d+) recording\(s\) had a title that named nothing/) || [])[1];
  const lines = [];

  if (delivery.code !== 0 && missing === undefined) {
    lines.push("⚠ *Delivery* — the check could not complete, so whether calls are arriving is UNKNOWN. Run `npm run check:delivery` by hand.");
  } else if (Number(missing) > 0) {
    lines.push(`⚠️ *Delivery* — ${missing} recording(s) the automation should have scored never reached the tracker. Run \`npm run check:delivery\` for which.`);
  } else {
    lines.push("✅ *Delivery* — every sales recording of the last two weeks reached the tracker.");
  }

  if (Number(backlog) > 0) {
    lines.push(`• ${backlog} ad-hoc recording(s) are waiting on a human ruling. \`npm run check:dropped\` lists them with a link each.`);
  }
  return lines;
}

async function postAlert(text) {
  const url = process.env.OPS_ALERT_WEBHOOK;
  if (!url) {
    console.log("OPS_ALERT_WEBHOOK is not set — printing the report instead of sending it.\n");
    console.log(text);
    return { sent: false, skipped: true };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const said = (await res.text()).trim();
    if (res.ok && (said === "ok" || said === "")) return { sent: true };
    return { sent: false, error: `the alert relay refused it: ${said || "HTTP " + res.status}` };
  } catch (err) {
    return { sent: false, error: `the alert relay was unreachable: ${err.message}` };
  }
}

const payments = await runScript("check-payments.mjs");
const pay = paymentsSection(payments);

// Every missing-money finding somebody already ACTED ON, re-asked of the
// processor. This runs weekly for the same reason the payments check does: the
// claim it re-checks was true when it was made, and a payment landing the next
// morning turns a corrected figure into a wrong one with nothing to say so.
// See money-claims.json. It reads only; closing a claim stays a person's job.
const claims = await runScript("check-claims.mjs");
const claimsHold = claims.code === 0;
const claimLines = claimsHold
  ? ["Every claim about missing money still holds."]
  : [
      "⚠ A claim that money was missing no longer holds — a figure somebody",
      "  corrected is now wrong. Run `npm run check:claims` for which one.",
    ];

/* ARE CALLS EVEN ARRIVING? Added 2026-08-25.

   The two checks above ask whether the numbers on the tracker are right. They
   cannot ask the prior question — whether the tracker is receiving calls at
   all — and that is the failure that actually happened: on 24 August the
   scoring step stopped writing to Notion and nothing said so for a day,
   because a silent pipe produces no wrong numbers to find. Every other check
   in this system runs on a schedule; the two that would have caught it only
   ran when somebody remembered.

   Both read only, and both are scoped to the last two weeks, because a
   recording nobody rescued a month ago is not this week's news. */
const delivery = await runScript("check-delivery.mjs", ["--client", CLIENT, "--since", twoWeeksAgo()]);
const dropped = await runScript("check-dropped.mjs", ["--client", CLIENT, "--since", twoWeeksAgo()]);
const arrivalLines = arrivalSection(delivery, dropped);

const previous = ALWAYS_REPORT ? null : readState(STATE_DIR);
// A reopened claim is a must-fix in its own right: it is a number that is
// currently wrong in the client's tracker, which is exactly what this report
// exists to break silence about.
const verdict = decide({ mustFix: pay.mustFix || !claimsHold, previous, now: Date.now() });

// The coverage check (check-accuracy) is deliberately NOT run here.
//
// It grades the matcher against a closer's own tracking sheet — a frozen record
// of 48 calls from one fortnight in August. The answer key holds prospect names,
// so .gitignore keeps it out of this repo and out of every image built from it;
// a scheduled container therefore cannot ever have the file, and from the day
// this moved off the laptop it reported "Coverage check could not run" every
// week, in a message whose whole purpose is that silence means broken.
//
// Adding the file back would not fix the mismatch, only hide it. The answer key
// does not change, so re-grading it weekly asks the same question of the same
// data and can only produce a different answer when the matching CODE changes.
// That makes it a check on a change, not a check on the week. It belongs beside
// the change — `npm run check:accuracy`, before and after touching how bookings
// are matched to calls — which is what docs/accuracy.md now says.

const heading = verdict.reason === "heartbeat" ? "Weekly check" : "Payments check";
const report = [
  `*${heading} — ${CLIENT}*`,
  "",
  ...pay.lines,
  "",
  ...claimLines,
  "",
  ...arrivalLines,
  "",
  reasonLine(verdict.reason, verdict.daysSince),
].join("\n");

if (!verdict.post) {
  console.log(
    `Nothing to report — the same ${pay.mustFix.length} item(s) as the last run, ` +
      `${Math.round(verdict.daysSince)} day(s) ago. Staying quiet.`
  );
  process.exit(0);
}

const result = await postAlert(report);
if (result.error) {
  // Deliberately NOT recording this run: an undelivered report must be re-sent
  // next time, not treated as said. Remembering it here is how a finding gets
  // swallowed by the very thing meant to surface it.
  console.error(`\nThe report was produced but not delivered — ${result.error}\n`);
  console.error(report);
  process.exit(1);
}

if (!result.skipped) {
  const remembered = writeState(STATE_DIR, {
    fingerprint: verdict.fingerprint,
    lastPostedAt: new Date().toISOString(),
    lastReason: verdict.reason,
  });
  if (!remembered) {
    console.warn(
      `Could not write to ${STATE_DIR}, so the next run has no memory and will report again. ` +
        "Attach a volume there to make the daily run quiet when nothing has changed."
    );
  }
}

console.log(result.skipped ? "\nNot sent (no relay configured)." : `\nReport sent to Slack (${verdict.reason}).`);
