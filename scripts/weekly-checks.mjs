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
import { loadEnv } from "./lib/env-file.mjs";
import { missingFor, outcomeOf, NOT_CONFIGURED, CLEAN, FINDING, UNCONFIGURED } from "./lib/required-env.mjs";
import { workflowPathFor, handleFrom } from "./lib/sales-call-filter.mjs";
import { existsSync, readdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
/** Both scripts page through months of Whop, Notion and Calendly. */
const TIMEOUT_MS = 6 * 60 * 1000;

const CLIENT = process.env.WEEKLY_CHECK_CLIENT || process.env.NEXT_PUBLIC_BRAND_NAME || "the tracker";

/**
 * The client's HANDLE, which is a different thing from the name above.
 *
 * WEEKLY_CHECK_CLIENT is a display name — it titles the Slack message, and on
 * this deploy it is "Brey" with a capital B. It was also being passed to the
 * two checks that look up a file named after the client, and
 * `automation/generated/sales-call-tracker-Brey.json` does not exist: the files
 * are lower-case handles. A Mac hid this completely, because its filesystem
 * does not care about case and the container's does.
 *
 * So the two uses are separated. Set CLIENT_HANDLE when the handle is not just
 * the display name lower-cased; otherwise this derives it, which covers Brey.
 */
const HANDLE = handleFrom(process.env.CLIENT_HANDLE || CLIENT);
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

/* --------------------------------------------------------------- PREFLIGHT

   WHICH CHECKS CAN EVEN RUN HERE, asked before any of them is run.

   Added 2026-09-08, after a morning in which three of the six checks below had
   never run once on this server and the report said so in three different ways,
   none of which named the cause. The full account is in lib/required-env.mjs;
   the short version is that the scheduled service was never given a
   FATHOM_KEY_*, and two scripts read .env.local — a file no container has.

   This asks the same question of the same declaration the scripts themselves
   use, so the answer here and the child's own answer cannot disagree. The env
   files are loaded first for the laptop's benefit: a person running this by
   hand has the variables in .env.local, and the children inherit what is
   loaded here.

   It is reported at the TOP of the message, because every "UNKNOWN" further
   down is explained by it. */
loadEnv();

const CHECKS_RUN = [
  "backfill-emails.mjs",
  "check-payments.mjs",
  "check-collect.mjs",
  "check-claims.mjs",
  "check-delivery.mjs",
  "check-dropped.mjs",
  "check-identified.mjs",
];

const unconfigured = CHECKS_RUN
  .map((name) => ({ name, missing: missingFor(name) }))
  .filter((c) => c.missing.length > 0);

/**
 * The two arrival checks read the sales-call rule out of this client's own
 * generated workflow, so a handle with no file is the same kind of fault as a
 * missing variable — this deploy is not set up for this client — and belongs in
 * the same place, at the top, named. Left to the checks themselves it surfaces
 * as "the check could not complete", which sends somebody to look at Fathom.
 */
const handleFile = workflowPathFor(HANDLE);
const handleMissing = !existsSync(handleFile);
const handlesOnDisk = existsSync(join(ROOT, "automation", "generated"))
  ? readdirSync(join(ROOT, "automation", "generated"))
      .map((f) => /^sales-call-tracker-(.+)\.json$/.exec(f)?.[1])
      .filter(Boolean)
  : [];

/** The name a person types, out of the filename. */
const commandOf = (file) => `npm run ${file.replace(/\.mjs$/, "").replace("check-", "check:")}`;

function configurationSection() {
  if (unconfigured.length === 0 && !handleMissing) return { mustFix: [], lines: [] };

  const lines = [];
  if (unconfigured.length) {
    lines.push(
      `🚨 *Not configured* — ${unconfigured.length} of ${CHECKS_RUN.length} checks cannot run here, ` +
        "so what they cover is unknown rather than clean:"
    );
    for (const { name, missing } of unconfigured) {
      lines.push(`  • \`${commandOf(name)}\` — missing ${missing.join(", ")}`);
    }
    lines.push("  • These are variables on this service. Nothing below covers what these checks would have found.");
  }
  if (handleMissing) {
    lines.push(
      `🚨 *Unknown client* — nothing on this deploy is set up for the handle \`${HANDLE}\`, ` +
        `so the arrival checks have no sales-call rule to read.` +
        (handlesOnDisk.length ? ` Handles that do exist: ${handlesOnDisk.join(", ")}.` : "") +
        " Set CLIENT_HANDLE to the right one."
    );
  }

  return {
    // One entry per fault, so fixing one of them changes the fingerprint and the
    // next run says so instead of staying quiet.
    mustFix: [
      ...unconfigured.map((c) => `${c.name} is not configured`),
      ...(handleMissing ? [`no workflow for the handle ${HANDLE}`] : []),
    ],
    lines,
  };
}

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
  // Not configured is named once at the top of the report; repeating the cause
  // in every section would bury the sections that DID run.
  if (code === NOT_CONFIGURED) {
    return {
      mustFix: [],
      lines: ["🚨 *Payments* — not configured here, so the tracker's money was not checked against Whop."],
    };
  }
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

  if (delivery.code === NOT_CONFIGURED) {
    // Named at the top with the variable it wants, so this line says what is
    // not covered rather than repeating the cause.
    lines.push("🚨 *Delivery* — not configured here, so whether calls are reaching the tracker at all is unknown.");
  } else if (delivery.code !== 0 && missing === undefined) {
    lines.push("⚠ *Delivery* — the check could not complete, so whether calls are arriving is UNKNOWN. Run `npm run check:delivery` by hand.");
  } else if (Number(missing) > 0) {
    lines.push(`⚠️ *Delivery* — ${missing} recording(s) the automation should have scored never reached the tracker. Run \`npm run check:delivery\` for which.`);
  } else {
    lines.push("✅ *Delivery* — every sales recording of the last two weeks reached the tracker.");
  }

  // THE BACKLOG USED TO DISAPPEAR RATHER THAN REPORT. This reads a count out of
  // check-dropped's output, so a run that never produced output produced no
  // count, no line, and a report that looked like it had nothing to say. An
  // absent sentence is not a zero.
  if (dropped.code === NOT_CONFIGURED) {
    lines.push("• The ad-hoc backlog was not counted — that check is not configured here either.");
  } else if (dropped.code !== 0 && backlog === undefined) {
    lines.push("• The ad-hoc backlog could not be counted this run, so it is unknown rather than empty.");
  } else if (Number(backlog) > 0) {
    lines.push(`• ${backlog} ad-hoc recording(s) are waiting on a human ruling. \`npm run check:dropped\` lists them with a link each.`);
  }

  /* THE CAUSE, BESIDE THE SYMPTOM.
     Measured on Brey 2026-09-11: of 142 recordings, 92 were started as an
     ad-hoc meeting and NOT ONE carried the prospect's email; of the 50 joined
     from the booking, 33 did. A meeting started on the spot has no calendar
     event, so no invitee, no prospect name and no title — which is the backlog
     above, the rows reading "Unknown", and the identification line below, all
     from one habit. This is the leading indicator: it moves the day the habit
     changes, where the address rate takes a fortnight to show it. */
  const adHoc = dropped.output.match(
    /(\d+) of (\d+) \((\d+)%\) were started as an ad-hoc meeting/
  );
  if (adHoc) {
    const [, count, total, pct] = adHoc;
    const carried = dropped.output.match(/ad-hoc: (\d+) of \d+, joined from the booking: (\d+) of (\d+)/);
    lines.push(
      `• ${count} of ${total} recordings (${pct}%) were started as an ad-hoc meeting rather than joined from the booking.`
    );
    if (carried && carried[1] === "0") {
      lines.push(
        `  None of those ${count} carried the prospect's email; ${carried[2]} of the ${carried[3]} joined from the booking did. ` +
          "Same habit behind the backlog above and the identification line below."
      );
    }
  }
  return lines;
}

/**
 * Whether recent calls can be tied to anything else at all.
 *
 * `Prospect Email` is the key every join runs on, and the workflow can only
 * take it from an external guest on the calendar invite. It is not a software
 * fault when it is missing — no error is raised, the joins simply do not
 * happen — so nothing would ever mention it. On Brey's account it went from 0%
 * missing in June to 35% in August, and the ask went to the team on 1 September
 * 2026. This is how anyone finds out whether it took.
 *
 * IT ONLY BREAKS SILENCE WHEN THE RATE IS BAD, not every day it is imperfect.
 * A rate that is over the bar and STAYS over it is the same finding as
 * yesterday, so the report goes quiet on it exactly the way it goes quiet on a
 * payment row nobody has fixed yet — and speaks once when it clears.
 *
 * A window too small to judge is reported as unknown rather than as clean: a
 * quiet week is not evidence of a habit taking.
 */
/**
 * FILLING IN THE ADDRESSES, AND THE RULE THIS DELIBERATELY REVERSES.
 *
 * ---------------------------------------------------------------------------
 * THIS RUNNER USED TO READ AND REPORT AND NEVER WRITE
 *
 * That was decided on 2026-08-18, when a launchd job running
 * `check-payments --apply` unattended was retired. Its reasoning is worth
 * quoting, because this is a departure from it: "an unattended --apply puts its
 * best guess into a client's tracker before anyone has seen it."
 *
 * True of the payments check, and not true of this one — which is the whole
 * reason this is the single write allowed here:
 *
 *   - it writes ONE FIELD, an email address. Never an outcome, never a figure.
 *   - it is not a guess. The confirmed path needs TWO independent systems to
 *     agree that the booking and the recording are the same appointment —
 *     Calendly's scheduled start against Fathom's. Anything they disagree
 *     about is named and left alone.
 *   - it never overwrites. A row already carrying an address is untouched, so
 *     the worst case is a blank field staying blank.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS WORTH THE DEPARTURE
 *
 * `Prospect Email` is the key every join in this system runs on, and the
 * identification check below has reported it missing on 60% of recent calls for
 * weeks. Reporting changed nothing, because the fix was a command somebody had
 * to remember. Measured on 2026-09-11, what that cost: a $4,000 customer sat as
 * a follow-up with a $150 deposit for twelve days; six of seven rows "claiming
 * cash Whop does not hold" were real money nothing could join; $3,850 of
 * September's unattributed cash belonged to a call on the tracker all along.
 *
 * It runs FIRST, ahead of the payments reconciliation, so a payment that could
 * not reach its call this morning reaches it this morning rather than tomorrow.
 *
 * `BACKFILL_EMAILS=0` goes back to reporting only.
 */
function backfillSection({ code, output }) {
  if (code === NOT_CONFIGURED) {
    return {
      mustFix: [],
      lines: ["🚨 *Addresses* — not configured here, so no missing prospect email was filled in."],
    };
  }
  if (code === 2) {
    // NOT a finding. A write that did not happen leaves every row exactly as it
    // was, so this is a bad morning rather than something for a person to
    // correct — and putting it in mustFix would make the daily post shout.
    return {
      mustFix: [],
      lines: ["🚨 *Addresses* — the backfill could not run, so any missing prospect email is still missing."],
    };
  }

  const wrote = (output.match(/(\d+) rows? filled in/) || [])[1];
  const held = (output.match(/unconfirmed\s+(\d+) of/) || [])[1];
  const lines = [];

  if (Number(wrote) > 0) {
    lines.push(
      `✅ *Addresses* — filled in ${wrote} missing prospect email${wrote === "1" ? "" : "s"} ` +
        "from Calendly, each confirmed against the recording's own slot. Notion's page history is the undo."
    );
  } else {
    lines.push(
      "✅ *Addresses* — nothing to fill in; every recent call that can be tied to a booking already carries one."
    );
  }
  if (Number(held) > 0) {
    lines.push(
      `  • ${held} more matched on the name alone and were NOT written — \`npm run backfill:emails\` lists them.`
    );
  }
  return { mustFix: [], lines };
}

function identifiedSection({ code, output }) {
  if (code === NOT_CONFIGURED) {
    return {
      mustFix: [],
      lines: ["🚨 *Identification* — not configured here, so whether recent calls can be tied to a payment is unknown."],
    };
  }
  if (code === 2) {
    return {
      mustFix: ["the identification check could not run"],
      lines: ["🚨 *Identification* — the check could not run, so whether recent calls can be tied to a payment is UNKNOWN."],
    };
  }

  const missing = (output.match(/missing it\s+:\s+(\d+)/) || [])[1];
  const total = (output.match(/Calls in the last \d+ days: (\d+)/) || [])[1];
  const pct = (output.match(/\((\d+)%\)/) || [])[1];
  const anonymous = (output.match(/no name either\s+:\s+(\d+)/) || [])[1];

  if (output.includes("Too few calls in this window to judge")) {
    return { mustFix: [], lines: [`• *Identification* — only ${total ?? "a few"} call(s) in the window, too few to judge.`] };
  }

  if (code === 1) {
    const lines = [
      `⚠️ *Identification* — ${missing} of ${total} recent calls (${pct}%) arrived with no prospect email, so nothing can tie them to a payment, a booking or an ad.`,
    ];
    if (Number(anonymous) > 0) {
      lines.push(`  • ${anonymous} of those carry no name either — nothing can recover who they were.`);
    }
    lines.push(
      "  • The address comes from a guest on the calendar invite: book through the Calendly link, put the prospect on the invite, and reschedule rather than recreate."
    );
    // The identifier stays the same while the problem persists, on purpose —
    // that is what keeps this quiet between the day it starts and the day it
    // clears. Including the percentage here would re-post on every wobble.
    return { mustFix: ["recent calls arriving with no prospect email"], lines };
  }

  return {
    mustFix: [],
    lines: [`✅ *Identification* — ${total} recent call(s), ${100 - Number(pct || 0)}% carrying an address that ties them to their money.`],
  };
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

/**
 * Whether the collect list is safe to work from.
 *
 * It is the only panel that names a customer and asks somebody to ring them
 * about money, so it is the only one whose being wrong costs a phone call to a
 * person who has already paid. That is not hypothetical: the day it shipped, a
 * customer who paid in full and was refunded most of it back was on the list
 * for the refund, because the processor reports totals net of refunds.
 *
 * The must-fix is deliberately just that one shape — a refunded row still
 * marked Customer. Everything else the check reports needs a person's judgement
 * rather than a fix, and a report that shouts weekly about rows nobody can
 * mechanically resolve is one people stop opening.
 */
function collectSection({ code, output }) {
  if (code === NOT_CONFIGURED) {
    return {
      mustFix: [],
      lines: ["🚨 *To collect* — not configured here, so whether the chase list is safe to work from is unknown."],
    };
  }
  if (code === 2) {
    return {
      mustFix: ["the collect-list check could not run"],
      lines: ["🚨 *To collect* — the check could not run, so whether the chase list is safe to work from is UNKNOWN."],
    };
  }

  const refunds = headlines(output, ["✗"]);
  const listed = (output.match(/(\d+) rows would be listed, (\$[\d,]+) owed/) || []);
  const weak = (output.match(/(\d+) of them rest on less than an address match/) || [])[1];

  const lines = [];
  if (refunds.length) {
    lines.push(`⚠️ *To collect* — ${refunds.length === 1 ? "a refunded customer is" : `${refunds.length} refunded customers are`} still marked Customer on the tracker.`);
    lines.push(...cap(refunds).map((l) => `  • ${l}`));
    lines.push("  • Mark the row REFUND: until then every money figure on the page counts it.");
  } else if (listed.length) {
    lines.push(`✅ *To collect* — ${listed[1]} deals part paid, ${listed[2]} owed, no refunded row on the list.`);
  } else {
    lines.push("✅ *To collect* — nothing outstanding on a closed deal.");
  }
  if (weak && Number(weak) > 0) {
    lines.push(`  • ${weak} of them rest on less than an address match — \`npm run check:collect\` names which.`);
  }
  return { mustFix: refunds.length ? ["a refunded customer is on the collect list"] : [], lines };
}

/* THE ONE STEP HERE THAT WRITES, AND IT RUNS FIRST.
   Filling the addresses in before the reconciliation below means a payment that
   could not reach its call this morning reaches it this morning. See
   backfillSection for why this runner writes at all. */
const backfillOff = process.env.BACKFILL_EMAILS === "0";
const addresses = backfillOff
  ? /* SWITCHED OFF IS NOT "NOTHING TO DO". The first version of this handed the
       section a fake clean result, which printed "nothing to fill in; every
       recent call already carries one" on a run that had not looked. That is
       the fault this whole file exists to prevent, reintroduced by its newest
       step — see the exit-code header at the top. */
    {
      mustFix: [],
      lines: [
        "• *Addresses* — filling in is switched off here (`BACKFILL_EMAILS=0`), so any missing prospect email is still missing.",
      ],
    }
  : backfillSection(await runScript("backfill-emails.mjs", ["--apply"]));

const payments = await runScript("check-payments.mjs");
const pay = paymentsSection(payments);

/* THE ONE PANEL THAT ASKS SOMEBODY TO PICK UP THE PHONE. Added 2026-09-04 with
   the collect list itself, rather than left to be run when somebody remembers —
   which is the mechanism every other check here exists to replace. */
const collect = collectSection(await runScript("check-collect.mjs"));

// Every missing-money finding somebody already ACTED ON, re-asked of the
// processor. This runs weekly for the same reason the payments check does: the
// claim it re-checks was true when it was made, and a payment landing the next
// morning turns a corrected figure into a wrong one with nothing to say so.
// See money-claims.json. It reads only; closing a claim stays a person's job.
const claims = await runScript("check-claims.mjs");

/*
 * THREE STATES, NOT TWO. This read `claims.code === 0` as "every claim holds"
 * and EVERYTHING ELSE as "a claim no longer holds" — so a check that could not
 * start was published as a finding about a client's money. It did exactly that
 * every day from the moment it moved onto a server, because check-claims read
 * .env.local and a container has none.
 *
 * A check that did not run has nothing to say about claims, and saying so is
 * the whole point: the reader can tell an alarm from an absence.
 */
const claimsOutcome = outcomeOf(claims.code);
const claimsRan = claimsOutcome === CLEAN || claimsOutcome === FINDING;
const claimsReopened = claimsOutcome === FINDING;
const claimLines = {
  [UNCONFIGURED]: ["🚨 *Claims* — not configured here, so no acted-on claim was re-asked of the processor."],
  broke: ["🚨 *Claims* — the check could not run, so whether a corrected figure has since been paid is UNKNOWN."],
  [FINDING]: [
    "⚠ A claim that money was missing no longer holds — a figure somebody",
    "  corrected is now wrong. Run `npm run check:claims` for which one.",
  ],
  [CLEAN]: ["Every claim about missing money still holds."],
}[claimsOutcome];

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
// check-delivery ignored `--since` until 2026-09-08 and quietly used its own
// seven-day default, so the "last two weeks" sentence below described a window
// nobody had measured. It understands the argument now, and rejects one it does
// not recognise rather than dropping it — but the fortnight is stated here, in
// the caller, so the two can be read side by side.
const delivery = await runScript("check-delivery.mjs", ["--client", HANDLE, "--since", twoWeeksAgo()]);
const dropped = await runScript("check-dropped.mjs", ["--client", HANDLE, "--since", twoWeeksAgo()]);
const arrivalLines = arrivalSection(delivery, dropped);

const identified = identifiedSection(await runScript("check-identified.mjs"));

const previous = ALWAYS_REPORT ? null : readState(STATE_DIR);
// A reopened claim is a must-fix in its own right: it is a number that is
// currently wrong in the client's tracker, which is exactly what this report
// exists to break silence about.
//
// AND IT NEVER DID, until 2026-09-01. This read `pay.mustFix || !claimsHold`,
// and `pay.mustFix` is always an array — an empty array is truthy in
// JavaScript, so the expression returned it every time and the `!claimsHold`
// half could not run. The comment above described behaviour the line had never
// had. Nothing failed, which is the whole problem: a reopened claim quietly
// did not break silence, and a report whose job is to speak up stayed quiet
// about the one thing it names as most urgent.
//
// Every contributor is now a STRING IN ONE ARRAY, because that is the shape
// `decide` fingerprints. A boolean folded in with `||` cannot be fingerprinted
// and cannot be seen to have gone missing.
const configuration = configurationSection();

const verdict = decide({
  mustFix: [
    ...configuration.mustFix,
    ...pay.mustFix,
    ...collect.mustFix,
    ...(claimsReopened ? ["a money claim has been reopened"] : []),
    ...(claimsRan ? [] : ["the claims check did not run"]),
    ...identified.mustFix,
  ],
  previous,
  now: Date.now(),
});

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
  // First, because every "unknown" below it is explained by it.
  ...(configuration.lines.length ? [...configuration.lines, ""] : []),
  ...pay.lines,
  "",
  ...claimLines,
  "",
  ...collect.lines,
  "",
  ...arrivalLines,
  "",
  // Directly above identification, because they are two halves of one subject:
  // how many calls arrived without an address, and how many of those have since
  // been given one. Read apart, the first looks like a problem nobody is on.
  ...addresses.lines,
  "",
  ...identified.lines,
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
