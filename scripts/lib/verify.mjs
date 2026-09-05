/**
 * The pure half of `npm run verify` — matching one person across the systems,
 * and deciding what each source is entitled to answer.
 *
 * SPLIT OUT SO IT CAN BE TESTED WITHOUT A NETWORK. The command around it does
 * nothing but fetch and print; every judgement it makes is in here, and
 * `tests/verify.test.ts` holds it to the ownership rule in
 * docs/verifying-a-number.md.
 */

/**
 * Only for grouping candidates — never for deciding two people are the same.
 *
 * A BRACKETED ALIAS IS KEPT, NOT DROPPED. The first version stripped brackets,
 * which threw away the half that matters: the tracker writes a repeat prospect
 * as "Pluto (A'sha Andrews)" — the name they book under, with the name they are
 * actually called behind it. Dropping it meant a search for the real name
 * matched nothing, which is the silent miss this whole tool exists to prevent.
 *
 * Apostrophes close up rather than splitting, so "A'sha" stays one part. Split
 * on it and you get "a" and "sha", neither of which matches "asha".
 */
export function nameKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name parts shared by two names, so "one first name" can be told from "both". */
export function sharedParts(a, b) {
  const left = new Set(nameKey(a).split(" ").filter((p) => p.length > 2));
  const right = nameKey(b).split(" ").filter((p) => p.length > 2);
  return right.filter((p) => left.has(p)).length;
}

/**
 * How a candidate was tied to the question, strongest first.
 *
 * The strength is reported on every line the command prints, because the whole
 * failure this tool exists to end is a figure quoted without saying what it
 * rested on. `email` is an identifier. `both-names` is an inference. `one-name`
 * is a hint and is never presented as an answer.
 */
export const STRENGTH = { email: "email", bothNames: "both-names", oneName: "one-name" };

/**
 * Everything in `pool` that might be this person, each labelled with how it was
 * matched. Never narrows to one — picking a winner is what produced the
 * confident-and-wrong answers. The command prints them all and says which is
 * which.
 */
export function candidates(pool, { email, name }, read) {
  const out = [];
  for (const item of pool) {
    const itemEmail = (read.email(item) ?? "").toLowerCase();
    const itemName = read.name(item);
    if (email && itemEmail && itemEmail === email.toLowerCase()) {
      out.push({ item, strength: STRENGTH.email });
      continue;
    }
    if (!name) continue;
    const shared = sharedParts(name, itemName);
    // Two parts agreeing is worth showing; one is worth showing only when
    // nothing better exists, and is labelled so nobody reads it as a match.
    if (shared >= 2) out.push({ item, strength: STRENGTH.bothNames });
    else if (shared === 1) out.push({ item, strength: STRENGTH.oneName });
  }
  const rank = { [STRENGTH.email]: 0, [STRENGTH.bothNames]: 1, [STRENGTH.oneName]: 2 };
  return out.sort((a, b) => rank[a.strength] - rank[b.strength]);
}

/** Money lines out of a Fathom summary, so the agreed price can be read by eye. */
export function moneyLines(summaryMarkdown) {
  return String(summaryMarkdown ?? "")
    .split("\n")
    .map((line) => line.replace(/\(https:\/\/[^)]*\)/g, "").replace(/[[\]*]/g, "").trim())
    .filter((line) => line && /\$\s?[\d,]+|\b\d+\s?k\b/i.test(line));
}

/**
 * The disagreements worth a person's attention, and only those.
 *
 * Each one names the OWNER of the fact in dispute rather than declaring a
 * winner, because for two of the three the owner is the recording and this
 * function cannot read a transcript. Saying "go and listen to this bit" is the
 * honest output; picking a side from the two non-owners is how the wrong figure
 * got defended last time.
 */
export function disagreements({ trackerRows, whopPaid, recordingExists }) {
  const found = [];

  const priced = trackerRows.filter((r) => r.priceClosed != null && r.priceClosed > 0);
  const claimedCash = trackerRows.reduce((sum, r) => sum + (r.cash ?? 0), 0);

  /* CASH IS A FLOOR, SO ONLY ONE DIRECTION IS A FAULT. Whop holding LESS than
     the deal value is a payment plan mid-way through and is not news. Whop
     holding less than what somebody typed as ALREADY COLLECTED is money that was
     recorded and never arrived, which is. */
  if (claimedCash > 0 && whopPaid + 0.01 < claimedCash) {
    found.push({
      fact: "money received",
      owner: "Whop",
      says: `Whop has $${whopPaid.toLocaleString()}`,
      against: `the tracker says $${claimedCash.toLocaleString()} was collected`,
      note:
        "Money recorded as collected that the processor has never seen. Whop owns this " +
        "outright, so the tracker is wrong until a payment turns up. Write it into " +
        "money-claims.json if you change a figure on it, so it gets re-asked.",
    });
  }

  for (const row of priced) {
    if (row.priceClosed > whopPaid) {
      found.push({
        fact: "what was agreed",
        owner: "the recording",
        says: `the tracker says the deal was $${row.priceClosed.toLocaleString()}`,
        against: `Whop has $${whopPaid.toLocaleString()} so far`,
        note: recordingExists
          ? "Not a fault on its own — an unfinished payment plan looks exactly like this. " +
            "Whop cannot settle it; only the recording can. Listen to the price lines above."
          : "And there is no recording, so NOTHING owns this figure. It cannot be confirmed " +
            "from here — the closer's word is all there is.",
      });
    }
  }

  const wins = trackerRows.filter((r) => r.outcome === "Customer");
  if (wins.length > 0 && whopPaid === 0) {
    found.push({
      fact: "money received",
      owner: "Whop",
      says: "Whop has nothing for this person",
      against: `${wins.length} call(s) are marked Customer`,
      note: "A sale with no money behind it. Either the payment is under another name or " +
        "address in Whop, or it never happened.",
    });
  }

  return found;
}
