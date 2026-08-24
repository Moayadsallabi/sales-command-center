/**
 * The hand-written list of calls that belong to another offer.
 *
 * What these protect, in order of how much it would cost to get wrong: that a
 * row named "Unknown" can be excluded without taking every other Unknown row
 * with it, that a missing file leaves the dashboard alone rather than emptying
 * it, and that what was dropped is always returned so the page can say so.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { partitionCalls, isExcluded, loadExclusions } from "../src/lib/excluded-calls";
import { call } from "./helpers";

function fileWith(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "excluded-"));
  const path = join(dir, "excluded-calls.json");
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

const REAL = join(process.cwd(), "excluded-calls.json");

describe("excluded calls", () => {
  it("drops the row whose page id is listed, and keeps its namesakes", () => {
    const file = fileWith({
      "Funded Blueprint": [
        { call_date: "2026-08-22", prospect_name: "Unknown", notion_page_id: "aaa-bbb" },
      ],
    });
    const target = call({ id: "aaa-bbb", name: "Unknown", call_date: "2026-08-22" });
    // Same name, same day, different row. The reason the page id exists.
    const other = call({ id: "ccc-ddd", name: "Unknown", call_date: "2026-08-22" });

    const { kept, excluded } = partitionCalls([target, other], file);

    expect(excluded.map((e) => e.call.id)).toEqual(["aaa-bbb"]);
    expect(kept.map((c) => c.id)).toEqual(["ccc-ddd"]);
  });

  it("matches on the recording, so a re-created row is still caught", () => {
    // The exact regression this key exists for: the row was archived, the
    // automation was widened, and the same call came back as a NEW page.
    const entries = [
      {
        recording_share_id: "JarxFotD6Gc7kq4PPPGrroyNLxYqEumk",
        notion_page_id: "3c4a6b94-d53c-815b-9501-fbbde6ffbee8",
      },
    ];
    const reimported = call({
      id: "a-brand-new-page-id",
      name: "Unknown",
      recording_url: "https://fathom.video/share/JarxFotD6Gc7kq4PPPGrroyNLxYqEumk",
    });
    expect(isExcluded(reimported, entries)).toBe(entries[0]);

    // And the original row, whose recording link may never have been filled in.
    const original = call({ id: "3c4a6b94-d53c-815b-9501-fbbde6ffbee8", recording_url: null });
    expect(isExcluded(original, entries)).toBe(entries[0]);

    // A different call is untouched by either key.
    expect(
      isExcluded(call({ recording_url: "https://fathom.video/share/somethingelse" }), entries)
    ).toBeNull();
  });

  it("matches a page id however its dashes are written", () => {
    const entries = [{ notion_page_id: "3c3a6b94-d53c-816d-a543-e9727964967b" }];
    const c = call({ id: "3c3a6b94d53c816da543e9727964967b" });
    expect(isExcluded(c, entries)).toBe(entries[0]);
  });

  it("falls back to date and name together, never name alone", () => {
    const entries = [{ call_date: "2026-08-21", prospect_name: "Jonathan Laguna" }];
    expect(isExcluded(call({ name: "Jonathan Laguna", call_date: "2026-08-21" }), entries)).toBe(
      entries[0]
    );
    expect(isExcluded(call({ name: "Jonathan Laguna", call_date: "2026-08-28" }), entries)).toBeNull();
    expect(isExcluded(call({ name: "Someone Else", call_date: "2026-08-21" }), entries)).toBeNull();
  });

  it("excludes nothing when the file is missing or malformed", () => {
    const calls = [call(), call()];
    expect(partitionCalls(calls, join(tmpdir(), "no-such-file.json")).kept).toHaveLength(2);

    const dir = mkdtempSync(join(tmpdir(), "excluded-"));
    const broken = join(dir, "excluded-calls.json");
    writeFileSync(broken, "{ not json");
    expect(partitionCalls(calls, broken).kept).toHaveLength(2);
  });

  it("reads every client key in the file, and no key that starts with _", () => {
    const file = fileWith({
      _README: ["a note, not an exclusion"],
      "Funded Blueprint": [{ notion_page_id: "one" }],
      "Another Client": [{ notion_page_id: "two" }],
    });
    expect(loadExclusions(file).map((e) => e.notion_page_id)).toEqual(["one", "two"]);
  });

  it("holds the ruled rows, each with a page id and a reason", () => {
    const entries = loadExclusions(REAL);
    const dates = entries.map((e) => e.call_date);
    expect(dates).toContain("2026-08-22");
    // Jonathan Laguna, 2026-08-21, must NOT be here. He was excluded on
    // 2026-08-22 for money Whop turned out to have received two days earlier,
    // and put back on 2026-08-24. This asserts the correction stays corrected.
    expect(dates).not.toContain("2026-08-21");
    for (const entry of entries) {
      expect(
        entry.recording_share_id || entry.notion_page_id,
        `${entry.prospect_name} needs a recording id or a page id`
      ).toBeTruthy();
      expect(entry.reason, `${entry.prospect_name} needs a reason`).toBeTruthy();
      expect(entry.ruled_by, `${entry.prospect_name} needs who ruled it`).toBeTruthy();
    }
  });
});
