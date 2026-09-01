/**
 * When the daily payments check is allowed to speak.
 *
 * The fault these pin: running daily without memory posts the same unfixed
 * rows every morning, and a channel that cries the same wolf seven times a week
 * gets muted. The opposite fault is worse — going quiet so completely that a
 * broken check and a clean week look identical.
 */
import { describe, it, expect } from "vitest";
import { decide, fingerprintOf, reasonLine, HEARTBEAT_DAYS } from "../scripts/lib/report-state.mjs";

const DAY = 86400000;
const now = Date.parse("2026-08-18T10:00:00Z");
const agoDays = (d: number) => new Date(now - d * DAY).toISOString();

const state = (fingerprint: string, days: number) => ({
  fingerprint,
  lastPostedAt: agoDays(days),
});

describe("fingerprint", () => {
  it("ignores the order the sections happened to print in", () => {
    expect(fingerprintOf(["a", "b"])).toBe(fingerprintOf(["b", "a"]));
  });

  it("changes when a row joins the list, because the count is in the text", () => {
    const nine = ["9 rows took money but are not marked Customer — $12,000 missing"];
    const ten = ["10 rows took money but are not marked Customer — $14,000 missing"];
    expect(fingerprintOf(nine)).not.toBe(fingerprintOf(ten));
  });

  it("treats a clean run as its own stable identity", () => {
    expect(fingerprintOf([])).toBe(fingerprintOf([]));
  });
});

describe("deciding whether to speak", () => {
  it("speaks on the first run, having no memory to compare against", () => {
    expect(decide({ mustFix: [], previous: null, now }).post).toBe(true);
  });

  it("speaks when a new problem appears", () => {
    const v = decide({ mustFix: ["2 rows disagree"], previous: state("", 1), now });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("changed");
  });

  it("STAYS QUIET when the same problem is still there tomorrow", () => {
    const fp = fingerprintOf(["2 rows disagree"]);
    const v = decide({ mustFix: ["2 rows disagree"], previous: state(fp, 1), now });
    expect(v.post).toBe(false);
    expect(v.reason).toBe("unchanged");
  });

  it("stays quiet for six consecutive days of the same problem", () => {
    const fp = fingerprintOf(["2 rows disagree"]);
    for (let day = 1; day <= 6; day++) {
      const v = decide({ mustFix: ["2 rows disagree"], previous: state(fp, day), now });
      expect(v.post, `day ${day} should be quiet`).toBe(false);
    }
  });

  it("speaks again once a week even when nothing has changed", () => {
    const fp = fingerprintOf(["2 rows disagree"]);
    const v = decide({ mustFix: ["2 rows disagree"], previous: state(fp, HEARTBEAT_DAYS), now });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("heartbeat");
  });

  it("speaks when the problem grows, without waiting for the weekly slot", () => {
    const fp = fingerprintOf(["2 rows disagree"]);
    const v = decide({ mustFix: ["2 rows disagree", "1 row took money"], previous: state(fp, 1), now });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("changed");
  });

  it("announces recovery, so a fix is not indistinguishable from being ignored", () => {
    const fp = fingerprintOf(["2 rows disagree"]);
    const v = decide({ mustFix: [], previous: state(fp, 1), now });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("recovered");
  });

  it("does not announce recovery twice", () => {
    const clean = fingerprintOf([]);
    const v = decide({ mustFix: [], previous: state(clean, 1), now });
    expect(v.post).toBe(false);
  });

  it("still reports weekly on a run of clean days", () => {
    const clean = fingerprintOf([]);
    const v = decide({ mustFix: [], previous: state(clean, 8), now });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("heartbeat");
  });

  it("speaks when the stored date is unreadable rather than trusting it", () => {
    const clean = fingerprintOf([]);
    const v = decide({ mustFix: [], previous: { fingerprint: clean, lastPostedAt: "not a date" }, now });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("heartbeat");
  });
});

describe("the message says why it arrived", () => {
  it("explains a weekly all-clear, so it is not read as a new alarm", () => {
    expect(reasonLine("heartbeat", 7)).toContain("running, not broken");
  });

  it("explains a change", () => {
    expect(reasonLine("changed")).toContain("changed");
  });

  it("says nothing when nothing was sent", () => {
    expect(reasonLine("unchanged")).toBe("");
  });
});

describe("everything that should break silence is in the same list", () => {
  /*
   * The report has three sources of must-fix items: the payments check, a
   * reopened money claim, and calls arriving with no address on them. They
   * reach `decide` as one array of strings, and these pin why that shape and
   * not another.
   *
   * It used to be `pay.mustFix || !claimsHold`. `pay.mustFix` is always an
   * array and an empty array is truthy in JavaScript, so that expression
   * returned it every time and the claims half could not run — the comment
   * above it described behaviour the line had never had. Nothing errored. A
   * reopened claim simply never broke silence, in a report whose entire job is
   * to break silence, and it looked exactly like a quiet week.
   */
  it("speaks when the only problem is one a boolean used to be folded in for", () => {
    const v = decide({
      mustFix: ["a money claim has been reopened"],
      previous: state(fingerprintOf([]), 1),
      now,
    });
    expect(v.post).toBe(true);
    expect(v.reason).toBe("changed");
  });

  it("speaks when a second source starts complaining and the first has not changed", () => {
    const payments = ["3 rows record money the processor does not hold"];
    const v = decide({
      mustFix: [...payments, "recent calls arriving with no prospect email"],
      previous: state(fingerprintOf(payments), 1),
      now,
    });
    expect(v.post).toBe(true);
  });

  it("stays quiet while a bad rate stays bad, and speaks once when it clears", () => {
    // The identification item deliberately carries no percentage, so a rate
    // wobbling between 41% and 46% is the same finding and not a new one.
    const bad = ["recent calls arriving with no prospect email"];
    const yesterday = state(fingerprintOf(bad), 1);
    expect(decide({ mustFix: bad, previous: yesterday, now }).post).toBe(false);

    const cleared = decide({ mustFix: [], previous: yesterday, now });
    expect(cleared.post).toBe(true);
    expect(cleared.reason).toBe("recovered");
  });
});
