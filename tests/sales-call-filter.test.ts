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

/**
 * ANOTHER OFFER'S CALLS, REFUSED ON WHAT THE CALL WAS ABOUT.
 *
 * Tpan sells an Amazon FBA mentorship through the same recorder that feeds
 * Brey's trading tracker. That was survivable while the gate read titles: an
 * FBA call booked outside the funnel had no matching title and fell out. The
 * 2026-08-24 widening — accept any 15-minute call with a second voice — removed
 * that protection entirely, because the block list also reads TITLES and these
 * calls have none. Seven untracked August recordings were FBA business queued
 * to walk into a trading client's numbers.
 *
 * The purpose line of Fathom's own summary is what separates them, and it is
 * already on the webhook payload.
 *
 * READ THE NEXT BLOCK BEFORE ADDING TO THIS ONE. The obvious sibling rule —
 * "refuse anything whose purpose says onboard" — is a trap that deletes real
 * closes, and it is pinned below so nobody adds it back.
 */
describe.skipIf(!configured)("a call sold on another offer", () => {
  const long = {
    recording_start_time: "2026-08-21T15:00:00Z",
    recording_end_time: "2026-08-21T16:10:00Z",
    recorded_by: { name: "Tpan A" },
    transcript: [
      { speaker: { display_name: "Tpan A" }, text: "walk me through it" },
      { speaker: { display_name: "Miguel Esparza" }, text: "sure" },
    ],
  };
  const purpose = (p: string) => ({
    default_summary: { markdown_formatted: `Meeting Purpose [${p}](https://fathom.video/share/x)` },
  });

  it("is refused when the purpose names Amazon FBA", () => {
    expect(
      scores("Impromptu Google Meet Meeting", { ...long, ...purpose("Qualify Miguel for and enroll him in the Amazon FBA mentorship program.") })
    ).toBe(false);
  });

  it("is refused when the purpose says only FBA", () => {
    expect(
      scores("Impromptu Google Meet Meeting", { ...long, ...purpose("Qualify a prospect for The Funded Blueprint's FBA mentorship program.") })
    ).toBe(false);
  });

  it("cannot be waved through with force_score", () => {
    // Same precedence as the blocked titles: a person ticking a box is not a
    // reason to file another coach's sale as this client's.
    expect(
      scores("Impromptu Google Meet Meeting", { ...long, force_score: true, ...purpose("Onboard Ayham Als to The Funded Blueprint's Amazon FBA program.") })
    ).toBe(false);
  });

  it("does not refuse a trading call that merely has no summary", () => {
    // Absence of a purpose is not evidence of a foreign offer. An ad-hoc call
    // with no summary still rides on length and voices, as before.
    expect(scores("Impromptu Google Meet Meeting", long)).toBe(true);
  });

  it("leaves a genuine trading sales call alone", () => {
    expect(
      scores("Impromptu Google Meet Meeting", { ...long, ...purpose("Qualify Angel Flores for The Funded Blueprint mentorship and close the sale.") })
    ).toBe(true);
  });
});

/**
 * THE RULE THAT MUST NOT BE ADDED: "refuse it if the purpose says onboard".
 *
 * It is the obvious next step and it is catastrophic. Fathom writes the
 * purpose from what the call ENDED UP being, and a sales call that CLOSES ends
 * by onboarding the new client — so Fathom summarises a won deal as "Onboard
 * X". Simulated across August before shipping, that rule refused TEN calls
 * already scored on Brey's tracker, among them Alan ($4,000), Jonathan Laguna
 * ($4,000) and Liam ($1,500), all closes from the week of 17 August.
 *
 * A rule that deletes precisely the calls that worked is worse than no rule.
 * These cases exist so the next person to have the idea sees the counter-example
 * before the client does.
 */
describe.skipIf(!configured)("a closed sale that Fathom describes as onboarding", () => {
  const won = {
    recording_start_time: "2026-08-22T15:00:00Z",
    recording_end_time: "2026-08-22T15:40:00Z",
    recorded_by: { name: "Tpan A" },
    transcript: [
      { speaker: { display_name: "Tpan A" }, text: "welcome aboard" },
      { speaker: { display_name: "Alan" }, text: "lets do it" },
    ],
    default_summary: {
      markdown_formatted:
        "Meeting Purpose [Onboard Alan to the Funded Blueprint mentorship program.](https://fathom.video/share/x)",
    },
  };

  it("is still scored, by title", () => {
    expect(scores("Alan: Profitability Game Plan Call", won)).toBe(true);
  });

  it("is still scored when it was ad-hoc and rides on evidence", () => {
    expect(scores("Impromptu Google Meet Meeting", won)).toBe(true);
  });
});

/**
 * A RECORDER WHOSE CALLS ARE ALL UNTITLED, where the evidence rule inverts.
 *
 * Everything above is Brey's shape: sales calls carry a booked title, the other
 * meetings carry their own ("Team Meeting", "Onboarding"), and the evidence
 * path exists to rescue the handful started in a bare room.
 *
 * Moayad's recorder produces one title and one only. All 15 of his August 2026
 * recordings were "Impromptu Zoom Meeting" — Quran lessons, strategy calls with
 * Shahrose, the Kenda onboarding, one partnership pitch. The block list reads
 * TITLES, so it sees none of them, and 15 minutes with a second voice describes
 * every single one. Roughly one call in nine was a sale.
 *
 * So his workflow is generated with --no-evidence-fallback: untitled means
 * alert, and a person vouches through the form. These cases pin the inversion,
 * because the flag's whole effect is a branch that is NOT taken — which is
 * invisible in the generated file and would otherwise be caught by nothing.
 */
const moayadConfigured = existsSync(
  resolve(__dirname, "../automation/generated/sales-call-tracker-moayad.json")
);
const moayad = moayadConfigured ? readSalesCallFilter("moayad") : null;
const moayadScores = (title: string, body: Record<string, unknown> = {}): boolean =>
  moayad!.isSalesCall(title, body);

describe.skipIf(!moayadConfigured)("a client whose calls are all untitled", () => {
  // The 4 September partnership call with Jan: 15+ minutes, his voice on it,
  // and a real prospect conversation. Nothing in the title says so.
  const longCallWithAProspect = {
    recording_start_time: "2026-09-04T17:00:00Z",
    recording_end_time: "2026-09-04T18:05:00Z",
    recorded_by: { name: "MomoFX" },
    transcript: [
      { speaker: { display_name: "MomoFX" }, text: "what are you selling right now" },
      { speaker: { display_name: "Jan" }, text: "four units in forty five days" },
    ],
  };

  it("scores a call whose invite names the offer", () => {
    expect(moayadScores("Perceptionism <> Jan")).toBe(true);
  });

  it("refuses an untitled call even with the full evidence Brey's rule accepts", () => {
    // The same body scores true on Brey's workflow, two describes above. That
    // is the point: this is a per-client choice, not a change to the rule.
    expect(moayadScores("Impromptu Zoom Meeting", longCallWithAProspect)).toBe(false);
  });

  it("keeps a Quran lesson out, which is what the evidence path would let in", () => {
    expect(
      moayadScores("Impromptu Zoom Meeting", {
        ...longCallWithAProspect,
        transcript: [
          { speaker: { display_name: "MomoFX" }, text: "..." },
          { speaker: { display_name: "Jamal" }, text: "..." },
        ],
      })
    ).toBe(false);
  });

  it("still lets a person vouch for one through the form", () => {
    // Without this the flag would not narrow the gate, it would weld it shut:
    // an untitled call could never be scored by any route.
    expect(
      moayadScores("Impromptu Zoom Meeting", { ...longCallWithAProspect, force_score: true })
    ).toBe(true);
  });

  it("does not let the form force an excluded call through", () => {
    expect(moayadScores("Quran Lesson", { force_score: true })).toBe(false);
    expect(moayadScores("Perceptionism Onboarding", { force_score: true })).toBe(false);
  });
});
