/**
 * The chase list, and the two ways it can quietly lie.
 *
 * It is a worklist, not a metric, so both failure directions cost real money
 * in opposite ways. Leave a prospect on it after they were spoken to again and
 * somebody chases a closed customer for a month — which is what happened to
 * Zay, closed nine days after his BAMFAM and still on the list. Drop one who
 * was NOT spoken to and a five-figure deal ages out with nothing on screen
 * saying so.
 *
 * The dangerous case sits between them: two rows the tracker calls "Unknown".
 * Matching those to each other would retire a real follow-up because a
 * different anonymous prospect happened to be called later.
 */
import { describe, it, expect } from "vitest";
import {
  followUps,
  silentClosers,
  recordingWeeks,
  FOLLOW_UP_STALE_DAYS,
  FOLLOW_UP_COLD_DAYS,
  SILENCE_DAYS,
} from "../src/lib/follow-ups";
import { call } from "./helpers";

const TODAY = "2026-08-27";
const open = (over = {}) => call({ outcome: "BAMFAM", ...over });
/* A REAL CUSTOMER NEEDS MONEY ON IT (2026-09-07). Since the money gate shipped,
   `outcome: "Customer"` with nothing collected is a follow-up — so a fixture
   meant to be a settled sale has to bank something, or it lands back on the
   list and every "ignores settled outcomes" assertion measures the wrong
   thing. The demoted case is asserted on its own further down. */
const won = (over = {}) =>
  call({ outcome: "Customer", collected_on_call: 500, ...over });

describe("who is still on the list", () => {
  it("holds open deals and ignores every settled outcome", () => {
    const result = followUps(
      [
        open({ name: "Ada Lovelace", call_date: "2026-08-20" }),
        won({ name: "Won", call_date: "2026-08-20" }),
        call({ name: "Lost", outcome: "No deal", call_date: "2026-08-20" }),
        call({ name: "Absent", outcome: "No show", call_date: "2026-08-20" }),
      ],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual(["Ada Lovelace"]);
  });

  /* A PRICE AGREED WITH NOTHING COLLECTED IS A FOLLOW-UP, AND THIS LIST IS
     WHERE IT GOES (2026-09-07).

     [STATED — Moayad, chat 2026-09-06] "if a price was agreed but no cash was
     collected then its simply a follow up". `isWin` enforced that from the day
     it was said; this list went on finding follow-ups by the word BAMFAM, so
     twelve of Brey's deals were in no worklist in either app — $29,250 of
     agreed price nobody could have found.

     Both sides are asserted, because either one alone passes whichever way the
     code reads: the demoted row IS here, and the paid one beside it is NOT. */
  it("holds a call the tracker calls won when no money ever moved", () => {
    const result = followUps(
      [
        call({ name: "Agreed Nothing Paid", outcome: "Customer",
               price_closed: 8000, call_date: "2026-08-20" }),
        won({ name: "Paid A Deposit", price_closed: 8000, call_date: "2026-08-20" }),
      ],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual(["Agreed Nothing Paid"]);
    // The price agreed is what is on the table. Reading `price_discussed` alone
    // — which a demoted row does not carry — put it on the list at nothing.
    expect(result.worth).toBe(8000);
  });

  it("lets go of it the moment a deposit lands", () => {
    const result = followUps(
      [
        won({ name: "Agreed Nothing Paid", price_closed: 8000,
              collected_on_call: 200, call_date: "2026-08-20" }),
      ],
      TODAY
    );

    expect(result.items).toHaveLength(0);
  });

  it("puts the oldest first, because that is the one going cold", () => {
    const result = followUps(
      [
        open({ name: "Recent", call_date: "2026-08-25" }),
        open({ name: "Ancient", call_date: "2026-08-02" }),
        open({ name: "Middle", call_date: "2026-08-15" }),
      ],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual([
      "Ancient",
      "Middle",
      "Recent",
    ]);
    expect(result.items.map((i) => i.age)).toEqual([25, 12, 2]);
  });

  it("counts the stale and cold marks inclusively", () => {
    const daysAgo = (n: number) => {
      const d = new Date(`${TODAY}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    const result = followUps(
      [
        open({ name: "exactly cold", call_date: daysAgo(FOLLOW_UP_COLD_DAYS) }),
        open({ name: "exactly stale", call_date: daysAgo(FOLLOW_UP_STALE_DAYS) }),
        open({ name: "fresh", call_date: daysAgo(FOLLOW_UP_STALE_DAYS - 1) }),
      ],
      TODAY
    );

    // cold is a subset of stale, not a separate tier
    expect(result.cold).toBe(1);
    expect(result.stale).toBe(2);
  });

  it("adds up what is on the table, and counts an unpriced deal as nothing", () => {
    const result = followUps(
      [
        open({ name: "Ada Lovelace", call_date: "2026-08-20", price_discussed: 4500 }),
        open({ name: "Grace Hopper", call_date: "2026-08-21", price_discussed: 1500 }),
        open({ name: "Alan Turing", call_date: "2026-08-22", price_discussed: null }),
      ],
      TODAY
    );

    expect(result.worth).toBe(6000);
    expect(result.items).toHaveLength(3);
  });
});

describe("how a row leaves the list", () => {
  it("drops a prospect who shows up on a later call, and says so", () => {
    // Nothing ever edits the BAMFAM row, so a later row under the same name is
    // the only evidence the tracker produces that the conversation continued.
    const result = followUps(
      [
        open({ name: "Zay Mensah", call_date: "2026-08-05" }),
        won({ name: "Zay Mensah", call_date: "2026-08-14" }),
      ],
      TODAY
    );

    expect(result.items).toHaveLength(0);
    expect(result.spokenAgain).toBe(1);
  });

  it("prefers the email when both rows carry one", () => {
    const result = followUps(
      [
        open({
          name: "Sam Booking-Name",
          prospect_email: "sam@x.com",
          call_date: "2026-08-05",
        }),
        won({
          name: "Samuel Different-Spelling",
          prospect_email: "sam@x.com",
          call_date: "2026-08-14",
        }),
      ],
      TODAY
    );

    expect(result.spokenAgain).toBe(1);
  });

  it("does not retire one anonymous row against another", () => {
    // THE EXPENSIVE CASE. Both rows are called "Unknown" because Fathom gave
    // the tracker no invitee. They are not the same person, and matching them
    // would silently drop a real follow-up.
    const result = followUps(
      [
        open({ name: "Unknown", call_date: "2026-08-05" }),
        won({ name: "Unknown", call_date: "2026-08-14" }),
      ],
      TODAY
    );

    expect(result.items).toHaveLength(1);
    expect(result.spokenAgain).toBe(0);
  });

  it("does not treat two people whose names differ only by a digit as one", () => {
    // comparableName used to delete digits, so "Client 1" and "Client 2"
    // reduced to the same string and the first one's follow-up was retired
    // because the second one was called later.
    const result = followUps(
      [
        open({ name: "Client 1", call_date: "2026-08-10" }),
        call({ name: "Client 2", outcome: "No deal", call_date: "2026-08-20" }),
      ],
      TODAY
    );

    expect(result.items).toHaveLength(1);
    expect(result.spokenAgain).toBe(0);
  });

  it("still matches the same person written with different punctuation", () => {
    const result = followUps(
      [
        open({ name: "Ada O'Brien-Smith", call_date: "2026-08-05" }),
        call({ name: "ada o brien smith", outcome: "Customer", call_date: "2026-08-14" }),
      ],
      TODAY
    );

    expect(result.spokenAgain).toBe(1);
  });

  it("does not count an EARLIER call as having spoken to them again", () => {
    const result = followUps(
      [
        call({ name: "Ada Lovelace", outcome: "No deal", call_date: "2026-08-01" }),
        open({ name: "Ada Lovelace", call_date: "2026-08-20" }),
      ],
      TODAY
    );

    expect(result.items).toHaveLength(1);
    expect(result.spokenAgain).toBe(0);
  });

  it("does not treat two calls on the same day as a follow-up", () => {
    const result = followUps(
      [
        open({ name: "Ada Lovelace", call_date: "2026-08-20" }),
        call({ name: "Ada Lovelace", outcome: "No deal", call_date: "2026-08-20" }),
      ],
      TODAY
    );

    expect(result.items).toHaveLength(1);
  });
});

describe("the list does not carry over", () => {
  it("moves last month's open deals to lapsed rather than dropping them", () => {
    const result = followUps(
      [
        open({ name: "This month", call_date: "2026-08-02", price_discussed: 3000 }),
        open({ name: "Last month", call_date: "2026-07-28", price_discussed: 9000 }),
      ],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual(["This month"]);
    expect(result.worth).toBe(3000);
    // counted, never silent
    expect(result.lapsed).toBe(1);
    expect(result.lapsedWorth).toBe(9000);
  });

  it("keeps the first of the month on the list on the first of the month", () => {
    const result = followUps([open({ call_date: "2026-08-01" })], "2026-08-01");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].age).toBe(0);
  });
});

describe("silentClosers", () => {
  const busy = (closer: string, dates: string[]) =>
    dates.map((d) => call({ closer, call_date: d }));

  it("names a closer who was running and stopped", () => {
    const result = silentClosers(
      busy("Quiet", ["2026-08-01", "2026-08-02", "2026-08-03"]),
      TODAY
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ closer: "Quiet", lastCall: "2026-08-03", calls: 3 });
    expect(result[0].days).toBe(24);
  });

  it("ignores somebody who never really started", () => {
    // Two calls and then nothing is not a broken pipeline.
    expect(silentClosers(busy("Barely", ["2026-08-01", "2026-08-02"]), TODAY)).toEqual([]);
  });

  it("treats a short gap as a holiday, not a broken pipe", () => {
    const recent = new Date(`${TODAY}T00:00:00Z`);
    recent.setUTCDate(recent.getUTCDate() - (SILENCE_DAYS - 1));
    const iso = recent.toISOString().slice(0, 10);

    expect(silentClosers(busy("Away", [iso, iso, iso]), TODAY)).toEqual([]);
  });

  it("measures from the LAST call, not the first", () => {
    const result = silentClosers(
      busy("Mixed", ["2026-01-01", "2026-01-02", "2026-08-10"]),
      TODAY
    );

    expect(result[0].lastCall).toBe("2026-08-10");
    expect(result[0].days).toBe(17);
  });

  it("puts the longest silence first", () => {
    const result = silentClosers(
      [
        ...busy("Recent", ["2026-08-10", "2026-08-10", "2026-08-10"]),
        ...busy("Older", ["2026-07-01", "2026-07-01", "2026-07-01"]),
      ],
      TODAY
    );

    expect(result.map((c) => c.closer)).toEqual(["Older", "Recent"]);
  });
});

describe("recordingWeeks", () => {
  it("keeps the empty weeks, because a gap is the finding", () => {
    // Four bars all showing calls reads as four working weeks even when two of
    // them are missing entirely.
    const weeks = recordingWeeks(
      [call({ call_date: "2026-08-24" }), call({ call_date: "2026-08-10" })],
      TODAY,
      4
    );

    expect(weeks.map((w) => w.calls)).toEqual([0, 1, 0, 1]);
    expect(weeks).toHaveLength(4);
  });

  it("runs oldest to newest and ends on this week", () => {
    const weeks = recordingWeeks([], TODAY, 3);

    expect(weeks.map((w) => w.week)).toEqual(["2026-08-10", "2026-08-17", "2026-08-24"]);
  });

  it("gives Sunday to the week that began six days earlier", () => {
    // 2026-08-30 is a Sunday; it belongs to the week starting Monday the 24th
    // rather than opening one of its own.
    const weeks = recordingWeeks([call({ call_date: "2026-08-30" })], "2026-08-30", 2);

    expect(weeks[weeks.length - 1]).toEqual({ week: "2026-08-24", calls: 1 });
  });

  it("ignores rows with no date rather than counting them somewhere", () => {
    const weeks = recordingWeeks([call({ call_date: null })], TODAY, 2);
    expect(weeks.every((w) => w.calls === 0)).toBe(true);
  });

  it("drops a date it cannot read instead of taking the whole page down", () => {
    // This threw. weekStart built `${date}T00:00:00Z`, which on a value that
    // already carries a time is not a date, and toISOString raised a
    // RangeError -- so one unreadable row out of 148 returned a 500 for every
    // number on Brey's dashboard on 2026-09-07. notion.ts now cuts call dates
    // back to a day, and this is the second lock behind it.
    expect(() =>
      recordingWeeks([call({ call_date: "2026-09-07T20:56:00.000+00:00" })], TODAY, 2)
    ).not.toThrow();

    const weeks = recordingWeeks(
      [call({ call_date: "nonsense" }), call({ call_date: "2026-08-24" })],
      TODAY,
      2
    );
    // The readable row still counts. A bad row costs its own bar, nothing else.
    expect(weeks.reduce((n, w) => n + w.calls, 0)).toBe(1);
  });

  it("draws no chart at all when today itself cannot be read", () => {
    // Rather than a run of weeks computed from an invented date, which would be
    // a chart of the wrong dates instead of no chart.
    expect(recordingWeeks([call({ call_date: "2026-08-24" })], "not a day", 4)).toEqual([]);
  });
});
