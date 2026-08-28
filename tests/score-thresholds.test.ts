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
import { FAIR_LEAD_SCORE, GOOD_LEAD_SCORE } from "../src/lib/lead-quality";
import { AMBER, GOLD, NEGATIVE, POSITIVE } from "../src/lib/palette";
import { callScoreHex, leadFactorHex, leadScoreHex } from "../src/lib/score-tone";

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
    // BOUNDED TO THE 0-10 CALL SCALE. The lead scale has its own check below,
    // added 2026-08-28 when the same two literals were pulled out of the call
    // table and the scorecard — this comment used to say that fault was
    // uncovered "because nobody has ruled on it".
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

describe("the lead bands, one scale over", () => {
  it("reads its two thresholds off the bands themselves", () => {
    expect(GOOD_LEAD_SCORE).toBe(75);
    expect(FAIR_LEAD_SCORE).toBe(55);
    expect(FAIR_LEAD_SCORE).toBeLessThan(GOOD_LEAD_SCORE);
  });

  it("no component compares a lead score against a typed-out number", () => {
    // The shape that caused it: `lead >= 75 ? GOLD : lead >= 55 ? AMBER : ...`,
    // written out in the call table and again in the scorecard, while the bands
    // those numbers came from lived in lead-quality.ts.
    const COMPONENTS = join(__dirname, "..", "src", "components");
    const files = (function under(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? under(join(dir, e.name))
          : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []
      );
    })(COMPONENTS);

    const offenders: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:"'\w])\/\/[^\n]*/g, "$1 ");
      // `lead_time_days` is how long a booking sat before the call, not a
      // score, and it is the one other identifier on the page starting with
      // "lead" that gets compared to a number. Excluded by name rather than by
      // a numeric bound, so a future `lead >= 40` would still be caught.
      const re = /\blead(?!_time)\w*\s*[><]=?\s*(\d+(?:\.\d+)?)/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) offenders.push(`${file.slice(COMPONENTS.length + 1)}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * GREEN MEANS GOOD, AND GOLD MEANS OURS.
 *
 * palette.ts has always said gold "carries no verdict", and the top band was
 * painted gold anyway — so the page had no colour for "well done", and a Strong
 * lead at 78 sat one shade from a Moderate one at 58. [STATED — Moayad, chat
 * 2026-08-28: "when we have a good lead or call performance lets make it green
 * since yellow isnt working well".]
 *
 * Asserted on the ramp rather than on a rendered pixel, because the thing that
 * can silently regress is a fourth copy of the ladder appearing in a component,
 * not the hex in palette.ts.
 */
describe("the colour a score is painted", () => {
  it("paints a good call green and never gold", () => {
    expect(callScoreHex(GOOD_CALL_SCORE)).toBe(POSITIVE);
    expect(callScoreHex(10)).toBe(POSITIVE);
    expect(callScoreHex(GOOD_CALL_SCORE)).not.toBe(GOLD);
  });

  it("paints a good lead green, on either the whole scale or one factor", () => {
    expect(leadScoreHex(GOOD_LEAD_SCORE)).toBe(POSITIVE);
    // A factor scored 9 out of its own 10 is 90 on the 0-100 scale. Passing the
    // raw 9 would read as Poor, which is the mistake scaling at the call site
    // used to invite.
    expect(leadFactorHex(9, 10)).toBe(POSITIVE);
    expect(leadFactorHex(4, 10)).toBe(NEGATIVE);
  });

  it("keeps the middle band amber and the bottom red, on both scales", () => {
    expect(callScoreHex(POOR_SCORE)).toBe(AMBER);
    expect(callScoreHex(POOR_SCORE - 0.1)).toBe(NEGATIVE);
    expect(leadScoreHex(FAIR_LEAD_SCORE)).toBe(AMBER);
    expect(leadScoreHex(FAIR_LEAD_SCORE - 1)).toBe(NEGATIVE);
  });

  it("hands every score on both scales exactly one of the three colours", () => {
    const three = [POSITIVE, AMBER, NEGATIVE];
    for (let s = 0; s <= 10; s += 0.1) {
      expect(three).toContain(callScoreHex(Number(s.toFixed(1))));
    }
    for (let s = 0; s <= 100; s += 1) expect(three).toContain(leadScoreHex(s));
  });
});
