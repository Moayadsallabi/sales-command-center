// Rescores calls already on the tracker against the rubric the live workflow
// is running now. Run with: npm run rescore -- --client brey --webhook <url> ...
//
// WHY IT GOES THROUGH THE WORKFLOW AND NOT AROUND IT. The scorer's prompt,
// schema, model settings and Notion write all live in the client's n8n
// workflow, with the Anthropic credential attached there and nowhere on this
// machine. A second scorer here would agree with the live one until the day it
// did not, and this repository has spent weeks paying for duplicated rules. So
// each recording is fetched from Fathom and posted to the same webhook a live
// call arrives on, with `force_score` set so the title filter lets it through.
//
// WHY THE OLD ROW IS ARCHIVED FIRST. The workflow refuses to score a Recording
// ID that is already on the tracker — that is what makes a Fathom retry
// harmless — and Notion's database query does not return archived pages. So
// archiving the old row is what lets the same recording in again. Every old
// row is written to rescore-backups/<recording id>.json before that happens,
// and is un-archived if the new row never appears.
//
// WHAT IS COPIED BACK. The scorer's commercial fields are a first read; the
// ones on the old row were corrected by people and reconciled against Whop and
// Calendly (Mason's $2,000, the deposit floor, the backfilled addresses). So
// outcome, prices, cash, currency, email, name and lead source are copied from
// the old row onto the new one, and a note on the new page says so. Scores,
// flags, lead factors and the written feedback are the new scorer's.
//
//   npm run rescore -- --client brey --webhook https://…/webhook/fathom-webhook-brey --sample 10
//   npm run rescore -- --client brey --webhook … --ids 178975072,176769475 --apply
//   npm run rescore -- --client brey --webhook … --all --apply
//
// Without --apply nothing is written anywhere.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, notionHeaders } from "./lib/notion-env.mjs";
import { fetchPage } from "./lib/fathom.mjs";

loadEnv();

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const client = arg("client");
const webhook = arg("webhook");
const apply = has("apply");
const ids = (arg("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
const sample = Number(arg("sample") ?? 0);
const all = has("all");
const waitMinutes = Number(arg("wait") ?? 8);

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

if (!client || !webhook) fail("Needs --client and --webhook.", "See the header of this file.");
if (!ids.length && !sample && !all) fail("Say which rows: --ids a,b,c or --sample N or --all.");

const NOTION_KEY = process.env.NOTION_API_KEY;
const DB = (process.env.NOTION_DATABASE_ID ?? "").replace(/-/g, "");
if (!NOTION_KEY || !DB) fail("NOTION_API_KEY and NOTION_DATABASE_ID must be set (see .env.local).");

// One Fathom key per closer whose recordings the tracker holds. A key reaches
// only its owner's recordings, so the closer on the row decides which key to
// try first; the others are tried after.
const FATHOM_KEYS = Object.entries(process.env)
  .filter(([k, v]) => k.startsWith("FATHOM_KEY_") && v)
  .map(([k, v]) => ({ label: k.slice("FATHOM_KEY_".length).toLowerCase(), key: v }));
if (!FATHOM_KEYS.length) fail("No FATHOM_KEY_* in the environment — nothing can fetch a transcript.");

const BACKUPS = join(process.cwd(), "rescore-backups");

/* ------------------------------------------------------------- Notion */

const H = notionHeaders(NOTION_KEY);

async function notion(path, init = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
    if (res.status === 429) {
      await sleep(Number(res.headers.get("retry-after") ?? 2) * 1000);
      continue;
    }
    const body = await res.json();
    if (!res.ok) throw new Error(`Notion ${res.status} on ${path}: ${body.message ?? JSON.stringify(body)}`);
    return body;
  }
  throw new Error(`Notion kept rate-limiting ${path}`);
}

async function allRows() {
  const rows = [];
  let cursor;
  do {
    const page = await notion(`/databases/${DB}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    rows.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return rows;
}

const read = (p) => {
  if (!p) return null;
  switch (p.type) {
    case "number": return p.number;
    case "select": return p.select?.name ?? null;
    case "multi_select": return p.multi_select.map((x) => x.name);
    case "rich_text": return p.rich_text.map((t) => t.plain_text).join("");
    case "title": return p.title.map((t) => t.plain_text).join("");
    case "date": return p.date?.start ?? null;
    case "checkbox": return p.checkbox;
    case "url": return p.url;
    case "email": return p.email;
    default: return null;
  }
};

// A read property turned back into the shape a write wants. Only the types the
// copied columns use.
const toWrite = (p) => {
  switch (p.type) {
    case "number": return { number: p.number };
    case "select": return { select: p.select ? { name: p.select.name } : null };
    case "rich_text": return { rich_text: p.rich_text.map((t) => ({ text: { content: t.plain_text } })) };
    case "title": return { title: p.title.map((t) => ({ text: { content: t.plain_text } })) };
    case "date": return { date: p.date };
    case "email": return { email: p.email };
    case "url": return { url: p.url };
    case "checkbox": return { checkbox: p.checkbox };
    default: return null;
  }
};

const DIMS = ["Frame Ownership", "Discovery Depth", "Belief Architecture", "Pitch Precision", "Tension Management", "Objection Resolution", "Qualification", "Strategic Awareness"];

// Hand-maintained or reconciled by a person. Copied old → new on every rescore.
const KEEP = ["Name", "Outcome", "Price Discussed", "Price Closed", "Collected On Call", "Cash Collected", "Outstanding", "Currency", "FX Rate", "Payment Structure", "Lead Source", "Prospect Email", "Guarantee"];

/* ------------------------------------------------------------- Fathom */

const meetingsByKey = new Map();

/** Every recording a key can see since `since`, indexed by recording id. Read once per key. */
async function meetingsFor(keyEntry, since) {
  if (meetingsByKey.has(keyEntry.label)) return meetingsByKey.get(keyEntry.label);
  const index = new Map();
  let cursor = null;
  let page = 0;
  do {
    if (page > 0) await sleep(6000);
    page += 1;
    const url = new URL("https://api.fathom.ai/external/v1/meetings");
    url.searchParams.set("created_after", since);
    url.searchParams.set("include_transcript", "true");
    url.searchParams.set("include_summary", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = await fetchPage(url, keyEntry.key);
    for (const m of data.items ?? data.data ?? []) index.set(Number(m.recording_id), m);
    cursor = data.next_cursor ?? null;
    console.log(`  fathom (${keyEntry.label}) page ${page}: ${index.size} recordings so far${cursor ? "" : " (last)"}`);
  } while (cursor);
  meetingsByKey.set(keyEntry.label, index);
  return index;
}

function keysFor(closer) {
  const c = String(closer ?? "").toLowerCase();
  const first = FATHOM_KEYS.filter((k) => c.includes(k.label));
  const rest = FATHOM_KEYS.filter((k) => !first.includes(k));
  return [...first, ...rest];
}

/* --------------------------------------------------------------- run */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nRescore — ${client}${apply ? "" : " (dry run — add --apply to write)"}`);
const rows = await allRows();
const scored = rows
  .map((r) => ({ page: r, props: Object.fromEntries(Object.entries(r.properties).map(([k, p]) => [k, read(p)])) }))
  .filter((r) => r.props["Recording ID"] != null)
  .filter((r) => DIMS.some((d) => r.props[d] != null) || r.props["Quality Score"] != null);
console.log(`${rows.length} rows on the tracker, ${scored.length} scored with a Recording ID`);

let targets;
if (ids.length) {
  targets = scored.filter((r) => ids.includes(Number(r.props["Recording ID"])));
  const missing = ids.filter((id) => !targets.some((r) => Number(r.props["Recording ID"]) === id));
  if (missing.length) fail(`Not on the tracker as scored rows: ${missing.join(", ")}`);
} else if (all) {
  targets = scored;
} else {
  // Spread across the score range, so the sample says how the whole board
  // moves rather than how the worst or best calls do.
  const eligible = scored
    .filter((r) => r.props["Offer Match"] !== "different offer" && r.props.Outcome !== "No show")
    .sort((a, b) => (a.props["Quality Score"] ?? 0) - (b.props["Quality Score"] ?? 0));
  const n = Math.min(sample, eligible.length);
  targets = Array.from({ length: n }, (_, i) => eligible[Math.floor((i * (eligible.length - 1)) / Math.max(1, n - 1))]);
}
targets.sort((a, b) => String(a.props["Call Date"]).localeCompare(String(b.props["Call Date"])));

console.log(`\n${targets.length} row(s) to rescore:`);
for (const t of targets) {
  console.log(`  ${t.props["Call Date"]}  ${String(t.props.Name).padEnd(24)} ${t.props.Closer ?? ""}  ${t.props["Quality Score"] ?? "—"}/10  v${t.props["Rubric Version"] ?? "?"}  #${t.props["Recording ID"]}`);
}

const earliest = targets.map((t) => t.props["Call Date"]).filter(Boolean).sort()[0] ?? "2026-01-01";
const since = new Date(new Date(earliest).getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

if (!apply) {
  console.log(`\nDry run. Would fetch recordings from Fathom since ${since.slice(0, 10)}, archive each row, post it to\n  ${webhook}\nand copy ${KEEP.length} commercial columns back. Add --apply to do it.`);
  process.exit(0);
}

mkdirSync(BACKUPS, { recursive: true });
const report = [];

for (const t of targets) {
  const id = Number(t.props["Recording ID"]);
  const label = `${t.props["Call Date"]} ${t.props.Name} #${id}`;
  console.log(`\n▶ ${label}`);

  let meeting = null;
  for (const k of keysFor(t.props.Closer)) {
    const index = await meetingsFor(k, since);
    if (index.has(id)) { meeting = index.get(id); break; }
  }
  if (!meeting) {
    console.log("  ✗ no Fathom recording reachable with the keys on hand — skipped, nothing changed");
    report.push({ id, name: t.props.Name, status: "no recording" });
    continue;
  }
  const words = (meeting.transcript ?? []).map((l) => l.text ?? "").join(" ").split(/\s+/).filter(Boolean).length;
  if (words < 50) {
    console.log(`  ✗ transcript is ${words} words — the workflow would log a no-show; skipped`);
    report.push({ id, name: t.props.Name, status: "no transcript" });
    continue;
  }

  const backupPath = join(BACKUPS, `${id}.json`);
  writeFileSync(backupPath, JSON.stringify({ archived_at: new Date().toISOString(), page: t.page }, null, 2));
  console.log(`  saved old row → rescore-backups/${id}.json`);

  await notion(`/pages/${t.page.id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) });
  console.log("  archived old row");

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...meeting, force_score: true }),
  });
  if (!res.ok) {
    await notion(`/pages/${t.page.id}`, { method: "PATCH", body: JSON.stringify({ archived: false }) });
    console.log(`  ✗ webhook answered ${res.status}; old row restored`);
    report.push({ id, name: t.props.Name, status: `webhook ${res.status}` });
    continue;
  }
  console.log("  posted to the workflow, waiting for the new row…");

  let fresh = null;
  const deadline = Date.now() + waitMinutes * 60 * 1000;
  while (Date.now() < deadline && !fresh) {
    await sleep(15000);
    const q = await notion(`/databases/${DB}/query`, {
      method: "POST",
      body: JSON.stringify({ filter: { property: "Recording ID", number: { equals: id } } }),
    });
    const candidate = q.results.find((r) => r.id !== t.page.id);
    if (candidate && DIMS.some((d) => read(candidate.properties[d]) != null)) fresh = candidate;
    else if (candidate && read(candidate.properties.Outcome) === "No show") fresh = candidate;
  }
  if (!fresh) {
    await notion(`/pages/${t.page.id}`, { method: "PATCH", body: JSON.stringify({ archived: false }) });
    console.log(`  ✗ no new row after ${waitMinutes} minutes; old row restored — check the n8n execution`);
    report.push({ id, name: t.props.Name, status: "timed out" });
    continue;
  }

  const restore = {};
  for (const col of KEEP) {
    const p = t.page.properties[col];
    if (!p) continue;
    const w = toWrite(p);
    if (w) restore[col] = w;
  }
  const oldOverall = t.props["Quality Score"];
  const oldVersion = t.props["Rubric Version"];
  const newProps = Object.fromEntries(Object.entries(fresh.properties).map(([k, p]) => [k, read(p)]));
  await notion(`/pages/${fresh.id}`, { method: "PATCH", body: JSON.stringify({ properties: restore }) });
  await notion(`/blocks/${fresh.id}/children`, {
    method: "PATCH",
    body: JSON.stringify({
      children: [{
        object: "block", type: "callout",
        callout: { icon: { emoji: "🔁" }, rich_text: [{ text: { content:
          `Rescored ${new Date().toISOString().slice(0, 10)} against rubric ${newProps["Rubric Version"]}. ` +
          `The previous row (rubric ${oldVersion ?? "?"}, overall ${oldOverall ?? "—"}) is archived and saved in rescore-backups/${id}.json. ` +
          `Outcome, prices, cash, currency, email and lead source were copied from that row; scores, flags and written feedback are new.` } }] },
      }],
    }),
  });

  const dims = Object.fromEntries(DIMS.map((d) => [d, { old: t.props[d], new: newProps[d] }]));
  console.log(`  ✓ ${oldOverall ?? "—"} → ${newProps["Quality Score"] ?? "—"}   ` +
    DIMS.map((d) => `${(t.props[d] ?? "-")}→${(newProps[d] ?? "-")}`).join("  ") +
    (newProps["Offer Match"] && newProps["Offer Match"] !== "this offer" ? `   offer: ${newProps["Offer Match"]}` : ""));
  report.push({
    id, name: t.props.Name, closer: t.props.Closer, date: t.props["Call Date"], outcome: t.props.Outcome,
    status: "rescored", old_version: oldVersion, new_version: newProps["Rubric Version"],
    old_overall: oldOverall, new_overall: newProps["Quality Score"],
    old_lead: t.props["Lead Score"], new_lead: newProps["Lead Score"],
    offer_match: newProps["Offer Match"], dims,
    flags: { old: [t.props["Value Leak"], t.props["Follow-Up Trap"], t.props["Early Price Drop"]], new: [newProps["Value Leak"], newProps["Follow-Up Trap"], newProps["Early Price Drop"]] },
    old_page: t.page.id, new_page: fresh.id,
  });
}

const reportPath = join(BACKUPS, `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));
const done = report.filter((r) => r.status === "rescored");
const mean = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2) : "—");
console.log(`\n${done.length} rescored, ${report.length - done.length} skipped. Report → ${reportPath}`);
if (done.length) {
  console.log(`mean overall: ${mean(done.map((r) => r.old_overall).filter((x) => x != null))} → ${mean(done.map((r) => r.new_overall).filter((x) => x != null))}`);
  for (const d of DIMS) {
    const o = done.map((r) => r.dims[d].old).filter((x) => x != null);
    const n = done.map((r) => r.dims[d].new).filter((x) => x != null);
    console.log(`  ${d.padEnd(22)} ${mean(o)} → ${mean(n)}   (scored ${o.length} → ${n.length})`);
  }
}
