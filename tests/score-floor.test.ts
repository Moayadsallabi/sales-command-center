/**
 * An overall needs enough scored dimensions to mean anything.
 *
 * A dimension with no evidence drops out of the average, which is right — a
 * guessed middle score would poison every mean built on it. But it means a
 * call with six unscorable dimensions is averaged over two, and on Brey's
 * tracker that put a 17-minute payment-processing call (Frame 7, Strategic
 * Awareness 8, nothing else) at the joint top of the board on 7.5. The floor
 * keeps its two scores and denies it an overall.
 */
import { describe, it, expect } from "vitest";
import { overallScore, scoredDimensionCount } from "../src/lib/types";
import { DIMENSIONS, MIN_SCORED_DIMENSIONS } from "../src/lib/dimensions";
import { call } from "./helpers";

function withScores(n: number, value = 8) {
  const scores = Object.fromEntries(
    DIMENSIONS.map((d, i) => [d.key, i < n ? value : null])
  ) as Record<(typeof DIMENSIONS)[number]["key"], number | null>;
  return call({ scores });
}

describe("the overall-score floor", () => {
  it("is five of eight, set in the rubric and read from it", () => {
    expect(MIN_SCORED_DIMENSIONS).toBe(5);
  });

  it("withholds the overall one dimension under the floor, and keeps the dimension scores", () => {
    const thin = withScores(MIN_SCORED_DIMENSIONS - 1);
    expect(overallScore(thin)).toBeNull();
    expect(scoredDimensionCount(thin)).toBe(MIN_SCORED_DIMENSIONS - 1);
  });

  it("averages exactly at the floor, over the scored dimensions only", () => {
    const enough = withScores(MIN_SCORED_DIMENSIONS);
    expect(overallScore(enough)).toBe(8);
  });

  it("still returns null for a call that was never scored", () => {
    expect(overallScore(withScores(0))).toBeNull();
    expect(scoredDimensionCount(withScores(0))).toBe(0);
  });
});
