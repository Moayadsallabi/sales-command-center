/**
 * THE OWNERSHIP RULE, ASSERTED.
 *
 * `npm run verify` exists because the same argument about the same figure kept
 * happening. What makes it worth trusting is what it REFUSES to say: it never
 * settles a fact from two sources that do not own it, and it never counts money
 * it matched on a name. Both of those are one line of code away from being lost,
 * so both are held here.
 */
import { describe, it, expect } from "vitest";
import { candidates, disagreements, moneyLines, sharedParts, STRENGTH } from "../scripts/lib/verify.mjs";

interface Gap {
  fact: string;
  owner: string;
  says: string;
  against: string;
  note: string;
}

/**
 * The gap this test is about, or a failure naming what was actually found.
 * `find(...)!` would turn a missing finding into "cannot read property of
 * undefined" three lines later, which says nothing about what broke.
 */
function gapAbout(found: Gap[], fact: string): Gap {
  const hit = found.find((f) => f.fact === fact);
  if (!hit) throw new Error(`no finding about "${fact}" — got: ${found.map((f) => f.fact).join(", ") || "none"}`);
  return hit;
}

const read = { email: (r: { email: string | null }) => r.email, name: (r: { name: string }) => r.name };

describe("matching a person across systems", () => {
  const pool = [
    { email: "muthamibrian@yahoo.com", name: "Brian Muthami" },
    { email: "other@example.com", name: "Brian Gonzalez" },
    { email: null, name: "Brian" },
  ];

  it("calls an address an identifier and a name an inference", () => {
    const byEmail = candidates(pool, { email: "muthamibrian@yahoo.com", name: null }, read);
    expect(byEmail[0].strength).toBe(STRENGTH.email);

    const byName = candidates(pool, { email: null, name: "Brian Muthami" }, read);
    // Both Brians come back — narrowing to one is what produced the confident
    // wrong answers — but only the full-name agreement ranks above a first name.
    expect(byName[0].strength).toBe(STRENGTH.bothNames);
    expect(byName.some((c: { strength: string }) => c.strength === STRENGTH.oneName)).toBe(true);
  });

  it("does not treat one shared first name as a match", () => {
    expect(sharedParts("Brian Muthami", "Brian Gonzalez")).toBe(1);
    expect(sharedParts("Brian Muthami", "brian muthami")).toBe(2);
  });

  it("ignores a bracketed alias when comparing names", () => {
    // The tracker writes "Pluto (A'sha Andrews)" — the booking name with the
    // real name behind it.
    expect(sharedParts("A'sha Andrews", "Pluto (A'sha Andrews)")).toBeGreaterThanOrEqual(2);
  });
});

describe("what the tool refuses to decide", () => {
  it("never calls a part-paid deal a wrong deal — only the recording owns the price", () => {
    // THE CASE THAT PROMPTED ALL OF THIS. Brian: $1,000 in Whop, $4,000 on the
    // tracker, $2,000 on the closer's sheet. The recording settled it at $4,000.
    // If this ever reports "the tracker is wrong", the tool has started doing
    // the thing that caused the argument.
    const found = disagreements({
      trackerRows: [{ priceClosed: 4000, cash: 1000, outcome: "Customer" }],
      whopPaid: 1000,
      recordingExists: true,
    });
    const agreed = gapAbout(found, "what was agreed");
    expect(agreed.owner).toBe("the recording");
    expect(agreed.note).toContain("Whop cannot settle it");
    // And it must NOT claim money is missing: $1,000 typed as collected against
    // $1,000 banked is not a gap.
    expect(found.some((f: Gap) => f.fact === "money received")).toBe(false);
  });

  it("says nothing owns the price when there is no recording", () => {
    const found = disagreements({
      trackerRows: [{ priceClosed: 5000, cash: 3250, outcome: "Customer" }],
      whopPaid: 0,
      recordingExists: false,
    });
    expect(gapAbout(found, "what was agreed").note).toContain("NOTHING owns this figure");
  });
});

describe("the gaps it does report", () => {
  it("flags money typed as collected that the processor never saw", () => {
    // Alan Campos, 4 September: $3,250 typed as collected, nothing in Whop
    // under any of his three addresses.
    const found = disagreements({
      trackerRows: [{ priceClosed: 5000, cash: 3250, outcome: "Customer" }],
      whopPaid: 0,
      recordingExists: true,
    });
    const cash = gapAbout(found, "money received");
    expect(cash.owner).toBe("Whop");
    expect(cash.note).toContain("money-claims.json");
  });

  it("does not flag a payment plan that is simply unfinished", () => {
    // $4,000 agreed, $4,000 typed as collected over time, $4,000 banked.
    const found = disagreements({
      trackerRows: [{ priceClosed: 4000, cash: 4000, outcome: "Customer" }],
      whopPaid: 4000,
      recordingExists: true,
    });
    expect(found).toEqual([]);
  });

  it("flags a sale with no money behind it at all", () => {
    const found = disagreements({
      trackerRows: [{ priceClosed: null, cash: 0, outcome: "Customer" }],
      whopPaid: 0,
      recordingExists: true,
    });
    // The Jacobo Vargas row: marked Customer, nothing collected, nothing banked.
    expect(found.some((f: Gap) => f.against.includes("marked Customer"))).toBe(true);
  });
});

describe("reading the agreed price out of a summary", () => {
  it("keeps the money lines and strips the timestamp links", () => {
    const summary = [
      "## Meeting Purpose",
      "[Qualify Brian for the program.](https://fathom.video/share/x?timestamp=1)",
      "  - [**Program & Cost:** The lifetime program is $4,000. Brian paid a $1,000 down payment.](https://fathom.video/share/x?timestamp=2)",
      "  - [**Goal:** Replace his 9-to-5.](https://fathom.video/share/x?timestamp=3)",
    ].join("\n");
    const lines = moneyLines(summary);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("$4,000");
    expect(lines[0]).not.toContain("https://");
    expect(lines[0]).not.toContain("**");
  });

  it("returns nothing rather than guessing when no money is mentioned", () => {
    expect(moneyLines("## Meeting Purpose\n[Say hello.](https://x)")).toEqual([]);
    expect(moneyLines(null)).toEqual([]);
  });
});
