/**
 * THE MATCHER, AND THE GUARD THAT THERE IS ONLY ONE OF IT.
 *
 * Every case below is a row off Brey's live August 2026, because all of them
 * were wrong on the page while `npm test` was green. The tests that existed
 * could not see any of it: they built their own buyers, and every fixture put
 * the person's real name in `name` — the field a live Whop payment almost never
 * carries — so they exercised a shape the account does not produce.
 *
 * The second half of the file is structural rather than behavioural. Both faults
 * here were the SAME fault twice: `src/lib/reconcile.ts` and
 * `scripts/check-payments.mjs` each had their own copy of the matcher, the
 * script's copy was fixed twice, and the library's was not. Asserting the two
 * behave alike would only ever test whichever pair of fixtures somebody wrote.
 * Asserting there is one implementation is a claim that cannot rot.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reconcile } from "../src/lib/reconcile";
import { call, buyer } from "./helpers";
import { corroborationOf, corroborationLabel } from "../scripts/lib/buyer-match.mjs";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("a name match needs two signals", () => {
  it("refuses a buyer who shares only the first name of a two-word row", () => {
    // LIVE, 3 August 2026. The tracker row "Robert Brown" is BAMFAM and carries
    // no email; Whop's only $540 that day is ROBERT KANE. The page matched them
    // on "robert" alone and counted a $540 close nobody made.
    const result = reconcile(
      [call({ name: "Robert Brown", outcome: "BAMFAM" })],
      [buyer({ email: "robertkane1600@gmail.com", billing: "Robert Kane", paid: 540 })]
    );
    expect(result.missedCloses).toHaveLength(0);
    // The money does not vanish — it becomes a buyer with no call behind them,
    // which is what he actually is.
    expect(result.untracked).toBe(1);
  });

  it("refuses one shared word even when the payment lands near the call", () => {
    // LIVE, 26 August 2026. "Jaden Pierce" (BAMFAM) against Jaden SWANSON, who
    // paid eighteen days BEFORE that call. Nothing about the date saved it;
    // only the surname does.
    const result = reconcile(
      [call({ name: "Jaden Pierce", outcome: "BAMFAM", call_date: "2026-08-26" })],
      [
        buyer({
          email: "jadenswan040607@gmail.com",
          billing: "Jaden Swanson",
          paid: 2000,
          first: "2026-08-08",
        }),
      ]
    );
    expect(result.missedCloses).toHaveLength(0);
  });

  it("still matches a one-word row name on its own", () => {
    // The rule above must not cost this. A single-token name IS the whole name,
    // so a genuine hit scores its token plus the whole-name bonus and reaches
    // two by itself. "Liam" is a real Funded Blueprint customer whose $750
    // shortfall went unreported for the whole of August.
    const result = reconcile(
      [call({ name: "Liam", outcome: "Customer", collected_on_call: 750 })],
      [buyer({ email: "liamb2507@yahoo.com", name: "liamb48", billing: "Liam Beauchamps", paid: 1500 })]
    );
    expect(result.cashOff).toHaveLength(1);
    expect(result.cashOff[0].paid).toBe(1500);
  });
});

describe("the name on the card, not the handle", () => {
  it("matches a buyer whose display name is a handle", () => {
    // LIVE, 30 August 2026. George Segovia's Whop display name is "kokitosh"
    // and his email is kokitosh25@icloud.com — nothing a call row could match.
    // His real name is on the billing fields, which the page never fetched, so
    // a $480-vs-$4,800 typo sat on the tracker unreported.
    const result = reconcile(
      [call({ name: "George Segovia", outcome: "Customer", collected_on_call: 480 })],
      [buyer({ email: "kokitosh25@icloud.com", name: "kokitosh", billing: "George Segovia", paid: 4800 })]
    );
    expect(result.cashOff).toHaveLength(1);
    expect(result.cashOff[0].paid).toBe(4800);
  });

  it("gives the row to the buyer who IS them, not one sharing a first name", () => {
    // LIVE, 23 August 2026. Two Johns. "JJ" (nosmokejones) is billed John Jones
    // and paid the row's exact $3,000; John Carlos paid $500 back in June.
    // Blind to billing names, the page took John Carlos and reported a cash
    // disagreement that did not exist.
    const result = reconcile(
      [call({ name: "John Jones", outcome: "Customer", collected_on_call: 3000 })],
      [
        buyer({ email: "johnadam111804@gmail.com", name: "JJ", billing: "John Jones", paid: 3000 }),
        buyer({ email: "johnlouiscarlos5@gmail.com", billing: "John Carlos", paid: 500 }),
      ]
    );
    // The right buyer, and therefore nothing to report.
    expect(result.cashOff).toHaveLength(0);
    expect(result.untracked).toBe(1);
  });
});

describe("there is one matcher", () => {
  /*
   * The claim these two protect is not "the copies agree today" — it is that
   * there is nothing to keep in agreement. A comment in reconcile.ts asserted
   * the first version of that claim for weeks while it was false.
   */
  it("is imported by both the page and the script", () => {
    expect(read("src/lib/reconcile.ts")).toContain("buyer-match.mjs");
    expect(read("scripts/check-payments.mjs")).toContain("buyer-match.mjs");
  });

  it("is not re-declared in either of them", () => {
    for (const file of ["src/lib/reconcile.ts", "scripts/check-payments.mjs"]) {
      const source = read(file);
      for (const symbol of ["function nameScore", "function tokenHits", "function matchAll"]) {
        expect(source, `${file} declares its own ${symbol}`).not.toContain(symbol);
      }
    }
  });

  it("builds its text from the billing name, so a reader cannot drop it again", () => {
    // The single line whose absence caused four wrong figures.
    expect(read("scripts/lib/buyer-match.mjs")).toContain("buyer.billing");
    expect(read("src/lib/whop.ts")).toContain("billing_first_name");
  });
});

describe("how much a name match is worth", () => {
  /*
   * Every non-email match used to carry one flat label, so the row resting on
   * nothing but a first name read exactly like the one whose deal price agrees
   * to the dollar with what the buyer banked. The deal price is independent of
   * both the matcher and the cash test, which is what makes it a second opinion
   * rather than a restatement.
   */
  it("calls an email match certain and says nothing about it", () => {
    const result = reconcile(
      [call({ name: "Ron Smith", outcome: "Customer", collected_on_call: 100, prospect_email: "ron@x.com" })],
      [buyer({ email: "ron@x.com", billing: "RON RON", paid: 750 })]
    );
    expect(result.cashOff[0].corroboration).toBe("certain");
    expect(corroborationLabel(result.cashOff[0].corroboration)).toBe("");
  });

  it("corroborates a name match whose deal price agrees with what was banked", () => {
    // LIVE, 30 August 2026. Priced 4,800; banked 4,800; the "480" in Collected
    // On Call is a missing zero. Two unrelated facts agreeing about who this is.
    const result = reconcile(
      [call({ name: "George Segovia", outcome: "Customer", collected_on_call: 480, price_closed: 4800 })],
      [buyer({ email: "kokitosh25@icloud.com", name: "kokitosh", billing: "George Segovia", paid: 4800 })]
    );
    expect(result.cashOff[0].corroboration).toBe("corroborated");
  });

  it("marks a name match with no price on the row as resting on the name alone", () => {
    // The shape BOTH August mistakes had: an open call carrying no price and no
    // cash, so nothing on the row could agree or disagree with the payment.
    // Often legitimate — a prospect who says no and pays on Friday looks like
    // this — but it is the weakest evidence here, so it is named as such.
    const result = reconcile(
      [call({ name: "Some Prospect", outcome: "BAMFAM", price_closed: null })],
      [buyer({ email: "s@x.com", billing: "Some Prospect", paid: 2000 })]
    );
    expect(result.missedCloses[0].corroboration).toBe("unpriced");
    expect(corroborationLabel(result.missedCloses[0].corroboration)).toContain("nothing to check");
  });

  it("does not call a differing price a contradiction", () => {
    // A deal priced at 4,000 against 400 banked is a customer paying in
    // instalments as often as it is a wrong match.
    expect(corroborationOf(false, 4000, 400)).toBe("differs");
    // And short enough to survive the truncating cell it renders in.
    for (const g of ["corroborated", "differs", "unpriced"] as const) {
      expect(corroborationLabel(g).length).toBeLessThanOrEqual(40);
    }
    expect(corroborationLabel("differs")).toContain("price differs");
  });

  it("puts the rows needing a person at the top of the list", () => {
    const priced = call({
      name: "Priced Row", outcome: "Customer", collected_on_call: 10,
      price_closed: 4800, call_date: "2026-08-01",
    });
    const bare = call({
      name: "Bare Row", outcome: "Customer", collected_on_call: 10,
      price_closed: null, call_date: "2026-08-29",
    });
    const result = reconcile(
      [priced, bare],
      [
        buyer({ email: "a@x.com", billing: "Priced Row", paid: 4800 }),
        buyer({ email: "b@x.com", billing: "Bare Row", paid: 2000 }),
      ]
    );
    // Later date, but weaker evidence — so it leads.
    expect(result.cashOff.map((d) => d.call.name)).toEqual(["Bare Row", "Priced Row"]);
  });
});
