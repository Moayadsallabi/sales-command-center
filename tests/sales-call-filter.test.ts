/**
 * Which recordings the automation agrees to score.
 *
 * Read out of the generated workflow rather than restated here, so this tests
 * the rule that actually runs. Every case below is a real meeting title from
 * Brey's calendar or recorder.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// Plain JS, shared with the scripts that read the same rule.
import { readSalesCallFilter } from "../scripts/lib/sales-call-filter.mjs";

// `automation/generated/` is gitignored — it carries the client's real Notion
// database id and offer context. So these tests only run where that client has
// been configured, and say why when they cannot, rather than failing with a
// stack trace on a fresh clone.
const configured = existsSync(
  resolve(__dirname, "../automation/generated/sales-call-tracker-brey.json")
);

const filter = configured ? readSalesCallFilter("brey") : null;
const scores = (title: string, body: Record<string, unknown> = {}): boolean =>
  filter!.isSalesCall(title, body);

describe.skipIf(!configured)("calls the automation scores", () => {
  const sales = [
    "Justin : Profitability Game Plan Call",
    "Nicole O.: Profitability Game Plan Call Team",
    "sushantt_05: Profitability Game Plan Call Tpan",
    "Profitability Game Plan Call.",
    "Profitability Game Plan Session",
    "The Funded Blueprint Enrollment Call",
    "THE FUNDED BLUEPRINT",
    "THE FUNDED BLUEPRINT (STRATEGY SESSION)",
    " The Funded Blueprint — Strategy Call",
  ];
  it.each(sales)("scores %s", (title) => {
    expect(scores(title)).toBe(true);
  });

  it("ignores capitals, because invites are typed in a hurry", () => {
    expect(scores("profitability game plan call")).toBe(true);
  });
});

describe.skipIf(!configured)("calls it must never score", () => {
  it("blocks onboarding even though the name contains a sales phrase", () => {
    // THE case a plain include-list gets wrong: "Funded Blueprint Onboarding
    // Call" contains "Funded Blueprint". A post-sale call scored as a sale
    // inflates the close rate and puts revenue against the wrong call.
    expect(scores("Funded Blueprint Onboarding Call")).toBe(false);
    expect(scores("Profitability Game Plan Call — Onboarding")).toBe(false);
  });

  it("blocks internal meetings", () => {
    expect(scores("Team Meeting")).toBe(false);
    expect(scores("Standup")).toBe(false);
  });

  it("blocks the delivery team's generic link", () => {
    // Three bookings, all one customer who had already bought.
    expect(scores("30 Minute Meeting")).toBe(false);
  });
});

describe.skipIf(!configured)("a recording with no usable name", () => {
  it("is not scored, so an onboarding call cannot be filed as a sale", () => {
    // Google names an ad-hoc call this. It carries no evidence of what kind of
    // call it was, so it takes the false branch into the Slack queue and a
    // person decides. Denis's closed deal and Angel's were both this shape —
    // the answer is a human, not a guess.
    expect(scores("Impromptu Google Meet Meeting")).toBe(false);
    expect(scores("")).toBe(false);
  });
});

describe.skipIf(!configured)("a call a person has vouched for", () => {
  // The form at /form/score-call-brey exists for exactly the calls this rule
  // cannot recognise: an impromptu recording with no invite to take a title
  // from. A person reads the Slack alert, decides it was a sales call, and the
  // form re-posts it with force_score set. Without this branch that form is a
  // button that does nothing.
  it("is scored even though its title matches nothing", () => {
    expect(scores("Impromptu Google Meet Meeting")).toBe(false);
    expect(scores("Impromptu Google Meet Meeting", { force_score: true })).toBe(true);
  });

  it("cannot be used to force an onboarding call through", () => {
    // The blocks come first on purpose. A human ticking a box is not a reason
    // to file a post-sale onboarding call as a sale.
    expect(scores("Funded Blueprint Onboarding Call", { force_score: true })).toBe(false);
  });

  it("is not triggered by the string 'true', only the boolean", () => {
    expect(scores("Impromptu Google Meet Meeting", { force_score: "true" })).toBe(false);
  });
});

/**
 * THE QUESTION HAS TO BE ASKED WITH THE WHOLE RECORDING.
 *
 * On 2026-08-24 the rule stopped being about titles alone: a call whose title
 * names nothing is accepted when it ran 15+ minutes AND somebody other than
 * the closer speaks on it. The library grew a `body` argument for that, and
 * check-dropped.mjs was updated to pass it.
 *
 * backfill-fathom.mjs was not — and it is the only tool that can recover the
 * backlog. So the one script whose job was to rescue 31 ad-hoc recordings went
 * on applying the old title-only rule to them, and reported Christian's two
 * calls as "0 match the sales-call rule" hours after the workflow had been
 * widened specifically to accept them. Nothing failed; it just quietly found
 * nothing, which is the worst way for this to go wrong.
 *
 * These cases pin both halves: what the rule says with the evidence, and what
 * it says without it. The second one is not a bug — it is the trap, written
 * down, so the next caller passing a bare title can see why it answers "no".
 */
describe.skipIf(!configured)("an ad-hoc call judged on evidence", () => {
  // Christian's 23 August recording: 63 minutes, the prospect audible on it,
  // and a $3,000 close his own sheet records. Google titled it "Impromptu
  // Google Meet Meeting" because he started it in a bare room.
  const longCallWithAProspect = {
    recording_start_time: "2026-08-23T15:00:00Z",
    recording_end_time: "2026-08-23T16:03:00Z",
    recorded_by: { name: "Christian Pinto" },
    transcript: [
      { speaker: { display_name: "Christian Pinto" }, text: "so where are you at right now" },
      { speaker: { display_name: "John Jones" }, text: "about four thousand down this month" },
    ],
  };

  it("is scored when it ran long enough and someone else spoke", () => {
    expect(scores("Impromptu Google Meet Meeting", longCallWithAProspect)).toBe(true);
  });

  it("is refused when the same recording is offered as a bare title", () => {
    // THE BACKFILL BUG, pinned. Same call, no evidence attached, opposite answer.
    expect(scores("Impromptu Google Meet Meeting")).toBe(false);
    expect(scores("Impromptu Google Meet Meeting", {})).toBe(false);
  });

  it("is refused when nobody but the closer speaks on it", () => {
    // A recorded no-show, or a closer talking to themselves. Length alone is
    // not evidence of a sales call.
    expect(
      scores("Impromptu Google Meet Meeting", {
        ...longCallWithAProspect,
        transcript: [{ speaker: { display_name: "Christian Pinto" }, text: "anyone there" }],
      })
    ).toBe(false);
  });

  it("is refused when it was too short to be a sales call", () => {
    expect(
      scores("Impromptu Google Meet Meeting", {
        ...longCallWithAProspect,
        recording_end_time: "2026-08-23T15:09:00Z",
      })
    ).toBe(false);
  });

  it("still loses to the block list, however long it ran", () => {
    // The blocks are checked first. A 90-minute team meeting is a team meeting.
    expect(
      scores("Team Meeting", { ...longCallWithAProspect, recording_end_time: "2026-08-23T16:30:00Z" })
    ).toBe(false);
  });
});
