/**
 * The weekly reconciliation, run by a schedule instead of by remembering.
 * Run with: npm run check:weekly
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * check-payments and check-accuracy were both written to be run weekly and
 * neither had a schedule. Until today the payments one lived in a Mac calendar
 * entry that had never fired once — if that laptop was shut on a Monday
 * morning, the week was simply skipped, and nothing anywhere said so.
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
/** Both scripts page through months of Whop, Notion and Calendly. */
const TIMEOUT_MS = 6 * 60 * 1000;

const CLIENT = process.env.WEEKLY_CHECK_CLIENT || process.env.NEXT_PUBLIC_BRAND_NAME || "the tracker";

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
    if (text) found.push(firstSentences(text));
  }
  return found;
}

function cap(lines, max = 6) {
  return lines.length <= max ? lines : lines.slice(0, max).concat(`…and ${lines.length - max} more`);
}

function paymentsSection({ code, output }) {
  if (code === 2) {
    return [
      "🚨 *Payments check could not run.*",
      "```" + output.trim().split("\n").slice(-4).join("\n") + "```",
      "The tracker's money was not checked against Whop this week.",
    ];
  }

  const mustFix = headlines(output, ["✗"]);
  const worthKnowing = headlines(output, ["⚠"]);

  if (!mustFix.length && !worthKnowing.length) {
    return ["✅ *Payments* — the tracker and Whop agree on every row that can be matched."];
  }

  const out = [];
  if (mustFix.length) {
    out.push(`⚠️ *Payments* — ${mustFix.length} thing${mustFix.length === 1 ? "" : "s"} to correct in the tracker:`);
    out.push(...cap(mustFix).map((l) => `  • ${l}`));
    out.push("", "To apply the mechanical corrections: `npm run check:payments -- --apply`");
    out.push("Read the list first — a payment can be a close, a deposit, or a second instalment, and only you can tell which.");
  } else {
    out.push("✅ *Payments* — no row needs correcting against Whop.");
  }

  if (worthKnowing.length) {
    out.push("", "*Worth knowing, not errors:*");
    out.push(...cap(worthKnowing).map((l) => `  • ${l}`));
  }
  return out;
}

function accuracySection({ code, output }) {
  if (code === 2 || code === 1) {
    return [
      "🚨 *Coverage check could not run.*",
      "```" + output.trim().split("\n").slice(-4).join("\n") + "```",
    ];
  }

  // The tally block the script prints: how many calls it found and got right.
  const tally = output
    .split("\n")
    .filter((l) => /^\s{2}(on the calendar|in the tracker|answered|unsure|no booking)/.test(l))
    .map((l) => "  " + l.trim());

  const missing = output.includes("Recorded by the closer but missing from the tracker");

  const out = ["*Coverage* — how much of what happened the system can see:"];
  out.push(...(tally.length ? tally : ["  (the check printed no tally — see the run's log)"]));
  if (missing) {
    out.push("", "  ⚠️ Some calls the closer recorded are missing from the tracker entirely — those are absent from every figure on the dashboard, not just this one.");
  }
  return out;
}

/** Post to the alert relay, and treat anything but "ok" as an undelivered alert. */
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
const accuracy = await runScript("check-accuracy.mjs");

const report = [
  `*Weekly check — ${CLIENT}*`,
  "",
  ...paymentsSection(payments),
  "",
  ...accuracySection(accuracy),
].join("\n");

const result = await postAlert(report);
if (result.error) {
  console.error(`\nThe report was produced but not delivered — ${result.error}\n`);
  console.error(report);
  process.exit(1);
}
console.log(result.skipped ? "\nNot sent (no relay configured)." : "\nWeekly report sent to Slack.");
