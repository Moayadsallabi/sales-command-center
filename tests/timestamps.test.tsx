/**
 * The [mm:ss] marks that make a score arguable rather than asserted.
 *
 * A closer who disputes a 4 on Tension clicks the mark and hears the nine
 * seconds in question. So the rule is that a mark must NEVER be silently
 * dropped: a call scored before timestamps existed renders unchanged, and a
 * recording URL that cannot be parsed renders the time as plain text rather
 * than a dead link that goes to the start of the call and looks like it worked.
 */
import { describe, it, expect } from "vitest";
import { isValidElement, type ReactElement } from "react";
import {
  stampToSeconds,
  recordingLinkAt,
  withTimestamps,
  RECORDING_TIME_PARAM,
} from "../src/lib/timestamps";

const REC = "https://fathom.video/calls/12345";

/** The rendered children, flattened, without needing a DOM. */
function childrenOf(node: unknown): unknown[] {
  if (!isValidElement(node)) return [node];
  const props = (node as ReactElement<{ children?: unknown }>).props;
  const kids = props.children;
  return Array.isArray(kids) ? kids : [kids];
}

describe("stampToSeconds", () => {
  it("reads mm:ss", () => {
    expect(stampToSeconds("0:00")).toBe(0);
    expect(stampToSeconds("1:30")).toBe(90);
    expect(stampToSeconds("12:05")).toBe(725);
  });

  it("reads h:mm:ss on the long calls", () => {
    expect(stampToSeconds("1:00:00")).toBe(3600);
    expect(stampToSeconds("1:02:03")).toBe(3723);
  });

  it("returns the start rather than NaN on nonsense", () => {
    // A link to the start is recoverable; ?timestamp=NaN is not.
    expect(stampToSeconds("ab:cd")).toBe(0);
  });
});

describe("recordingLinkAt", () => {
  it("opens the recording at the mark", () => {
    expect(recordingLinkAt(REC, "1:30")).toBe(
      `${REC}?${RECORDING_TIME_PARAM}=90`
    );
  });

  it("replaces a timestamp already on the URL instead of adding a second", () => {
    const url = recordingLinkAt(`${REC}?${RECORDING_TIME_PARAM}=10`, "0:45");
    expect(url).toBe(`${REC}?${RECORDING_TIME_PARAM}=45`);
  });

  it("keeps the other query parameters", () => {
    const url = recordingLinkAt(`${REC}?share=abc`, "0:30");
    expect(url).toContain("share=abc");
    expect(url).toContain(`${RECORDING_TIME_PARAM}=30`);
  });

  it("has nothing to link to without a recording", () => {
    expect(recordingLinkAt(null, "1:30")).toBeNull();
  });

  it("refuses an unparseable URL rather than building a broken link", () => {
    expect(recordingLinkAt("not a url", "1:30")).toBeNull();
  });
});

describe("withTimestamps", () => {
  it("leaves text with no marks exactly as it was", () => {
    // Every call scored before timestamps existed goes through here.
    const text = "He never asked what the last attempt cost.";
    expect(withTimestamps(text, REC)).toBe(text);
  });

  it("passes empty text straight through", () => {
    expect(withTimestamps("", REC)).toBe("");
  });

  it("turns each mark into a link and keeps the words around it", () => {
    const out = withTimestamps('"I need to think" [12:05] then he closed.', REC);
    const kids = childrenOf(out);

    const link = kids.find((k) => isValidElement(k) && k.type === "a") as ReactElement<{
      href: string;
      children: string;
    }>;
    expect(link).toBeDefined();
    expect(link.props.href).toBe(`${REC}?${RECORDING_TIME_PARAM}=725`);
    expect(link.props.children).toBe("12:05");

    // the prose either side survives
    const text = kids.filter((k) => typeof k === "string").join("");
    expect(text).toBe('"I need to think"  then he closed.');
  });

  it("links every mark, not just the first", () => {
    const out = withTimestamps("[0:10] and [1:00] and [2:00]", REC);
    const links = childrenOf(out).filter((k) => isValidElement(k) && k.type === "a");
    expect(links).toHaveLength(3);
  });

  it("renders the time as plain text when there is no recording to open", () => {
    // Not a link to nowhere: a dead link looks like it worked.
    const out = withTimestamps("He hesitated [0:42].", null);
    const kids = childrenOf(out);

    expect(kids.some((k) => isValidElement(k) && k.type === "a")).toBe(false);
    const span = kids.find((k) => isValidElement(k) && k.type === "span") as ReactElement<{
      children: string;
    }>;
    expect(span.props.children).toBe("0:42");
  });

  it("ignores a bracketed number that is not a time", () => {
    const text = "Point [3] was never made.";
    expect(withTimestamps(text, REC)).toBe(text);
  });

  it("ignores an impossible time rather than linking to a wrong moment", () => {
    // [1:75] has no meaning; sixty-plus seconds is not a timestamp.
    const text = "Around [1:75] he moved on.";
    expect(withTimestamps(text, REC)).toBe(text);
  });
});
