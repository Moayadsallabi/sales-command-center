/**
 * The form that rescues a call the tracker refused.
 *
 * The tracker will not guess at a recording Fathom names "Impromptu Google
 * Meet Meeting" — it posts it to Slack instead, and a person decides. This
 * form is how that decision gets carried out, and the two halves have to keep
 * agreeing: the form sets `force_score`, and the tracker's filter is the only
 * thing that reads it. Either half alone is a button that does nothing.
 *
 * The Code node is RUN here rather than read. Its failure mode is silence —
 * a source name that does not resolve is swallowed by a try/catch and simply
 * returns no recordings — so reading it back proves nothing.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
// Plain JS, shared with the scripts that read the same rule.
import { readSalesCallFilter } from "../scripts/lib/sales-call-filter.mjs";

type Params = {
  jsCode?: string;
  url?: string;
  options?: { path?: string };
};
type Node = { name: string; parameters: Params; onError?: string };
/** What the Code node hands the tracker: a Fathom meeting, plus the flag. */
type Sent = {
  json: {
    recording_id: number;
    meeting_title: string;
    force_score: boolean;
  };
};
const formPath = resolve(__dirname, "../automation/generated/score-this-call-brey.json");
// Same gitignored folder as the tracker — see tests/sales-call-filter.test.ts.
const configured =
  existsSync(formPath) &&
  existsSync(resolve(__dirname, "../automation/generated/sales-call-tracker-brey.json"));

const form = !configured
  ? { name: "", nodes: [] as Node[], connections: {} }
  : JSON.parse(
      readFileSync(formPath, "utf8")
    ) as { name: string; nodes: Node[]; connections: Record<string, unknown> };

const node = (name: string) => form.nodes.find((n) => n.name === name)!;
const fathomNodes = form.nodes.filter((n) => n.name.startsWith("Ask Fathom - "));
const code = configured ? node("Find the call").parameters.jsCode! : "";

const meeting = (over: Record<string, unknown> = {}) => ({
  recording_id: 175005047,
  share_url: "https://fathom.video/share/P2svmrqxVkNpsdy1",
  meeting_title: "Impromptu Google Meet Meeting",
  recorded_by: { name: "Tpan A" },
  transcript: Array.from({ length: 60 }, () => ({ text: "word" })),
  ...over,
});

/** Runs the Code node with a stubbed n8n `$`, one bucket of meetings per source. */
const find = (formAnswers: Record<string, string>, bySource: Record<string, unknown[]>) => {
  const $ = (name: string) => {
    if (name === "Score a call") return { first: () => ({ json: formAnswers }) };
    if (!(name in bySource)) throw new Error(`no node named ${name}`);
    return { all: () => [{ json: { items: bySource[name] } }] };
  };
  return new Function("$", code)($) as Sent[];
};

const onlyChristian = (m: unknown[]) => ({
  "Ask Fathom - Christian": m,
  "Ask Fathom - Tpan": [],
});

describe.skipIf(!configured)("the two halves agree", () => {
  it("sets the flag the tracker's filter is looking for", () => {
    const sent = find({ recording: "175005047" }, onlyChristian([meeting()]))[0].json;
    expect(sent.force_score).toBe(true);

    // The other half: that flag, on that title, through the live rule.
    const filter = readSalesCallFilter("brey");
    expect(filter.isSalesCall(sent.meeting_title)).toBe(false);
    expect(filter.isSalesCall(sent.meeting_title, { force_score: true })).toBe(true);
  });

  it("posts to the tracker's own webhook, so nothing is scored twice over", () => {
    expect(node("Send it to the tracker").parameters.url).toBe(
      "https://moayad.app.n8n.cloud/webhook/fathom-webhook-brey"
    );
  });

  it("lives at the path the Slack alert links to", () => {
    expect(node("Score a call").parameters.options?.path).toBe("score-call-brey");
  });
});

describe.skipIf(!configured)("finding the recording", () => {
  it("takes a bare recording id", () => {
    expect(find({ recording: "175005047" }, onlyChristian([meeting()]))[0].json.recording_id).toBe(
      175005047
    );
  });

  it("takes the share link pasted straight out of Slack", () => {
    const m = meeting();
    expect(find({ recording: m.share_url }, onlyChristian([m]))[0].json.recording_id).toBe(175005047);
  });

  it("looks in every closer's account, not just the first", () => {
    const found = find({ recording: "175005047" }, {
      "Ask Fathom - Christian": [],
      "Ask Fathom - Tpan": [meeting()],
    });
    expect(found[0].json.force_score).toBe(true);
  });

  it("names what each account returned when it finds nothing", () => {
    // Otherwise a key that is missing reads as a recording id that is wrong,
    // and someone spends an afternoon on the wrong problem.
    expect(() => find({ recording: "999999999" }, onlyChristian([]))).toThrow(/Christian: 0/);
    expect(() => find({ recording: "999999999" }, onlyChristian([]))).toThrow(/Tpan: 0/);
  });
});

describe.skipIf(!configured)("what it refuses", () => {
  it("refuses a recording with no real transcript, at the screen", () => {
    // Ron's 3-minute recording on 19 August: empty, and the tracker would have
    // filed it as a No show row nobody was watching for. The person asking for
    // it to be scored is told why, instead.
    const empty = meeting({ transcript: [{ text: "hello there" }] });
    expect(() => find({ recording: "175005047" }, onlyChristian([empty]))).toThrow(
      /nothing to score/
    );
  });

  it("refuses an empty form", () => {
    expect(() => find({ recording: "" }, onlyChristian([meeting()]))).toThrow(/No recording/);
  });
});

describe.skipIf(!configured)("the prospect name", () => {
  it("is put on the front of the title, which is where the tracker reads it", () => {
    const sent = find(
      { recording: "175005047", prospect_name: "Ron Smith" },
      onlyChristian([meeting()])
    )[0].json;
    expect(sent.meeting_title).toBe("Ron Smith: Impromptu Google Meet Meeting");
  });

  it("replaces a name already there rather than stacking a second one", () => {
    const sent = find(
      { recording: "175005047", prospect_name: "Ron Smith" },
      onlyChristian([meeting({ meeting_title: "Ron: Profitability Game Plan Call" })])
    )[0].json;
    expect(sent.meeting_title).toBe("Ron Smith: Profitability Game Plan Call");
  });
});

describe.skipIf(!configured)("one closer's broken key cannot take the form away from the rest", () => {
  it("lets every Fathom node continue on error", () => {
    // Christian's node used to hard-fail. It runs first, so his expired key
    // would have taken the form down for Tpan as well.
    for (const n of fathomNodes) expect(n.onError).toBe("continueRegularOutput");
  });

  it("asks every closer's account, by the exact node names on the canvas", () => {
    const declared = JSON.parse(code.match(/const sources = (\[[^\]]*\]);/)![1]) as string[];
    expect(declared).toEqual(fathomNodes.map((n) => n.name));
    expect(declared.length).toBeGreaterThan(1);
  });
});
