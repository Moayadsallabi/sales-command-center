#!/usr/bin/env node
/**
 * Re-asks the processor about every "this money is missing" claim anybody acted on.
 *
 * A missing-payment finding is a reading of one moment, and it expires. The
 * payment lands the next morning; the row had no email so nothing could ever
 * have matched it; the name in the processor is a handle that looks nothing
 * like the name on the invite. Meanwhile somebody has already changed a figure
 * on the strength of it, and nothing in the system ever asks again.
 *
 * That is the failure this closes, in Moayad's words on 2026-08-24: "u tell me
 * theres no 750$ collected in the whop and then i tell u to 0 it out, but then
 * the payment comes in ... and u never end up updating."
 *
 * So: write the claim down when it is ACTED ON, and let this re-check it for
 * ever. Money found against an open claim is not a note in a report, it is a
 * non-zero exit — somebody has to go and undo what they did.
 *
 *   npm run check:claims
 *
 * It changes nothing. Closing a claim is a person editing money-claims.json
 * with a reason and a date.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "money-claims.json");

function env() {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    console.error("\n✗ No .env.local to read the processor key from.");
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i === -1 || line.trimStart().startsWith("#")) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const E = env();
if (!E.WHOP_API_KEY) {
  console.error("\n✗ No WHOP_API_KEY, so no claim can be re-checked. Nothing has been verified.");
  process.exit(1);
}

let ledger;
try {
  ledger = JSON.parse(readFileSync(FILE, "utf8"));
} catch (err) {
  // Unlike the exclusion list, a missing ledger is NOT benign — it means the
  // safety net is absent, and the whole point is that nobody notices that.
  console.error(`\n✗ money-claims.json could not be read — ${err.message}`);
  console.error("  Every acted-on claim is unchecked until this is fixed.");
  process.exit(1);
}

/** Every payment the processor has ever taken, whatever its state. */
async function payments() {
  const all = [];
  for (let page = 1; page <= 40; page += 1) {
    const url = new URL("https://api.whop.com/api/v2/payments");
    url.searchParams.set("per", "50");
    url.searchParams.set("page", String(page));
    url.searchParams.set("expand[]", "user");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${E.WHOP_API_KEY}` } });
    if (!res.ok) throw new Error(`the processor refused (${res.status})`);
    const data = await res.json();
    const rows = data.data ?? [];
    all.push(...rows);
    if (rows.length < 50) break;
  }
  return all.map((p) => ({
    when: new Date(
      Number.isNaN(Number(p.paid_at ?? p.created_at))
        ? p.paid_at ?? p.created_at
        : Number(p.paid_at ?? p.created_at) * 1000
    )
      .toISOString()
      .slice(0, 10),
    amount: Number([p.final_amount, p.total, p.subtotal].find((v) => v != null && v !== "") ?? 0),
    status: p.status,
    who: `${p.user?.name ?? ""} ${p.user?.username ?? ""} ${p.user?.email ?? ""}`.trim(),
    email: p.user?.email ?? "",
  }));
}

const tokens = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

/**
 * Money that could be this claim's.
 *
 * Deliberately GENEROUS, which is the opposite of how the matcher in
 * check-payments works, and on purpose. That one decides whether to report a
 * disagreement, so it must not invent matches. This one decides whether to make
 * a human look again, and the expensive error here is the other way round —
 * every payment it fails to surface is a corrected figure left wrong for ever.
 * A false alarm costs somebody thirty seconds.
 */
function candidates(claim, paid) {
  const want = tokens(claim.prospect_name);
  const email = String(claim.prospect_email ?? "").toLowerCase();
  return paid.filter((p) => {
    if (p.status !== "paid") return false;
    if (email && p.email.toLowerCase() === email) return true;
    const hay = tokens(p.who);
    const byName = want.length > 0 && want.some((t) => hay.includes(t));
    const byAmount = claim.amount != null && Math.abs(p.amount - claim.amount) < 0.01;
    return byName || byAmount;
  });
}

const open = (ledger.claims ?? []).filter((c) => c.status === "open");
const reopened = (ledger.claims ?? []).filter((c) => c.status === "reopened");
const closed = (ledger.claims ?? []).filter((c) => c.status === "closed");

console.log(`\n${(ledger.claims ?? []).length} claim(s) on file — ${open.length} open, ${reopened.length} reopened, ${closed.length} closed.\n`);

let paid;
try {
  paid = await payments();
} catch (err) {
  console.error(`✗ ${err.message}. NOTHING HAS BEEN RE-CHECKED — do not read this run as a pass.`);
  process.exit(1);
}
console.log(`Re-asked the processor: ${paid.length} payments read.\n`);

let found = 0;
for (const claim of open) {
  const hits = candidates(claim, paid);
  if (hits.length === 0) {
    console.log(`  ok    ${claim.id} — still nothing. Claimed ${claim.claimed_on}.`);
    continue;
  }
  found += 1;
  console.log(`\n  REOPEN  ${claim.id}`);
  console.log(`          claimed ${claim.claimed_on}: ${claim.claim}`);
  console.log(`          acted on: ${claim.acted_on}`);
  console.log(`          the processor now shows:`);
  for (const h of hits.slice(0, 6)) {
    console.log(`            ${h.when}  $${h.amount}  ${h.who}`);
  }
  console.log(`          → undo what was done, then set this claim's status and say why.\n`);
}

for (const claim of reopened) {
  console.log(`\n  REOPENED (not yet closed)  ${claim.id}`);
  console.log(`          ${claim.resolution ?? "no resolution written down yet"}`);
}

if (open.length === 0 && reopened.length === 0) {
  console.log("Nothing is waiting on a second look.\n");
}

if (found > 0) {
  console.log(
    `\n${found} claim(s) have money against them that was not there when somebody\n` +
      `acted. Each one is a figure that is now wrong in the tracker.\n`
  );
  process.exit(1);
}
if (reopened.length > 0) {
  console.log(`\n${reopened.length} reopened claim(s) still need a person to close them with a reason.\n`);
  process.exit(1);
}
console.log("\nEvery open claim still holds.\n");
