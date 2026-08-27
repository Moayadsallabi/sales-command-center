/**
 * The two thresholds on the 0–10 call scale, and the rule that neither is ever
 * typed out by hand.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * "Good" was written as a literal in four component files, and one of them said
 * 8 while the other three said 7.5 — so a call scored 7.7 was gold on the closer
 * leaderboard and amber in the call table. Same call, two verdicts, and the
 * comment sitting above one of the copies said "same thresholds everywhere".
 *
 * Nothing could have caught that. Each file was internally consistent, every
 * test passed, and the two screens were never rendered side by side by anything
 * automatic. It was found by reading them.
 *
 * So the number lives in one place now, and this file asserts BOTH halves: the
 * value the ruling set, and that no component has quietly typed its own copy
 * again. The second half is the one that matters — a constant nobody imports is
 * not a single source of truth, it is a fifth opinion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { GOOD_CALL_SCORE, POOR_SCORE } from "../src/lib/stats";
import { GOOD_SCORE as GOOD_DIMENSION_SCORE } from "../src/lib/dimensions";

describe("the call-quality bands", () => {
  it("calls 7.5 and above good", () => {
    // [STATED — Moayad, chat 2026-08-27: "7.5 and above is good"]
    expect(GOOD_CALL_SCORE).toBe(7.5);
  });

  it("puts a 7.7 in the good band, which is the score the two screens disagreed about", () => {
    expect(7.7).toBeGreaterThanOrEqual(GOOD_CALL_SCORE);
  });

  it("keeps amber between poor and good, with no gap and no overlap", () => {
    expect(POOR_SCORE).toBeLessThan(GOOD_CALL_SCORE);
    // 6.0 is amber, 7.4 is amber, 7.5 is gold. A band that starts where the one
    // below it ends leaves no score without a colour.
    expect(6).toBeGreaterThanOrEqual(POOR_SCORE);
    expect(7.4).toBeLessThan(GOOD_CALL_SCORE);
  });

  it("is a DIFFERENT number from the one that judges a single part of a call", () => {
    // dimensions.GOOD_SCORE is 7 and answers "was this one part done well",
    // which splits calls into cohorts for the impact analysis. Two thresholds
    // on one scale, measuring different things. If these ever become equal it
    // should be because somebody decided that, not because a name was reused.
    expect(GOOD_DIMENSION_SCORE).not.toBe(GOOD_CALL_SCORE);
  });
});

describe("nobody keeps their own copy of the thresholds", () => {
  const COMPONENTS = join(__dirname, "..", "src", "components");

  function filesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? filesUnder(join(dir, e.name))
        : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
    );
  }

  it("no component compares a call score against a typed-out number", () => {
    // The shape that caused it: `call.quality_score >= 8`, `score >= 7.5`.
    // Comments are stripped first, so the note explaining the history can still
    // quote the numbers it is about.
    //
    // BOUNDED TO THE 0-10 CALL SCALE, which is what was ruled on. A comparison
    // against 75 is the LEAD scale, a different measurement with its own bands
    // in lead-quality.ts — and those bands are also typed out by hand in two
    // components, which is the same fault one scale over and is NOT covered
    // here because nobody has ruled on it. Widen this when they do.
    const offenders: string[] = [];
    for (const file of filesUnder(COMPONENTS)) {
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:"'\w])\/\/[^\n]*/g, "$1 ");
      const re = /\b(?:quality_)?score\s*[><]=?\s*(\d+(?:\.\d+)?)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) {
        if (Number(m[1]) <= 10) offenders.push(`${file.slice(COMPONENTS.length + 1)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
