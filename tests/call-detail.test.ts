/**
 * The written half of a call, now that it is fetched rather than sent.
 *
 * WHY THIS FILE EXISTS. Five fields on a call are prose, and prose was 59% of
 * the page payload — re-sent every sixty seconds and on every tab focus, for
 * calls nobody had opened. They now stay on the server until somebody clicks a
 * call, which turns a field on an object into a LOOKUP BY ID, and a lookup by
 * id is a door.
 *
 * Two things it must never open, and both are asserted below:
 *
 *   - a call belonging to another CLIENT — held by the caller passing only one
 *     client's calls, so an id from outside that list finds nothing;
 *   - a call belonging to another OFFER — dropped from every figure on the
 *     dashboard, and it must not be readable through this side door either.
 *
 * The third thing is not security but honesty: a call whose scorer wrote
 * nothing comes back as a detail object full of empty strings, NOT as null.
 * Null is what the panel reads as "not fetched yet", and the two must never
 * arrive looking alike.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detailFor } from "../src/lib/call-detail";
import { call } from "./helpers";

function emptyList(): string {
  const dir = mkdtempSync(join(tmpdir(), "call-detail-"));
  const path = join(dir, "excluded-calls.json");
  writeFileSync(path, JSON.stringify({}));
  return path;
}

const withProse = (over: Parameters<typeof call>[0] = {}) =>
  call({
    detail: {
      summary: "Went long on price.",
      lead_read: "Warm, under-qualified.",
      the_moment: "He asked what happens if it does not work.",
      next_call_drill: "Name the guarantee first.",
      offer_evidence: "",
    },
    ...over,
  });

describe("fetching one call's write-up", () => {
  it("hands over the prose for a call in this client's list", () => {
    const wanted = withProse({ id: "call-1", name: "Angel" });
    const other = withProse({ id: "call-2", name: "Sam" });

    const detail = detailFor([wanted, other], "call-1", emptyList());

    expect(detail?.the_moment).toBe("He asked what happens if it does not work.");
    expect(detail?.next_call_drill).toBe("Name the guarantee first.");
  });

  it("finds nothing for an id that is not in the list it was given", () => {
    /* THE CLIENT WALL. The caller reads `calls` through one client's
       credentials, so another client's call is simply not here — which is
       what makes a guessable id useless rather than merely unlikely. */
    const mine = withProse({ id: "call-1" });

    expect(detailFor([mine], "call-belonging-to-someone-else", emptyList())).toBeNull();
  });

  it("refuses a call the dashboard excluded as another offer", () => {
    /* A row dropped from every figure on the page must not be readable
       through a lookup by id. The scorer's own verdict is what excludes it,
       so no list entry is needed. */
    const foreign = withProse({ id: "call-foreign", offer_match: "different offer" });
    const ours = withProse({ id: "call-ours" });

    expect(detailFor([foreign, ours], "call-foreign", emptyList())).toBeNull();
    expect(detailFor([foreign, ours], "call-ours", emptyList())).not.toBeNull();
  });

  it("refuses a call excluded by the hand-written list", () => {
    const listed = withProse({ id: "call-listed", name: "Carmine", call_date: "2026-08-03" });
    const dir = mkdtempSync(join(tmpdir(), "call-detail-"));
    const path = join(dir, "excluded-calls.json");
    writeFileSync(
      path,
      JSON.stringify({ calls: [{ prospect_name: "Carmine", call_date: "2026-08-03", reason: "another offer" }] })
    );

    expect(detailFor([listed], "call-listed", path)).toBeNull();
  });

  it("says a scorer wrote nothing WITHOUT saying the fetch failed", () => {
    /* The distinction the whole three-state panel rests on. An empty write-up
       is a detail object of empty strings; null means "not fetched". Collapse
       them and a call with no summary is indistinguishable from a request
       that never landed — and one of those is a fault nobody would chase. */
    const blank = call({ id: "call-blank" }); // the fixture's detail is all ""

    const detail = detailFor([blank], "call-blank", emptyList());

    expect(detail).not.toBeNull();
    expect(detail?.summary).toBe("");
  });

  it("refuses an empty id even when a call somehow has one", () => {
    /* The guard only bites on this shape, so the fixture has to carry it:
       without a call whose own id is empty, `find` misses regardless and the
       assertion passes whether the guard is there or not. Deleting the guard
       and re-running is what showed that — the test went green either way. */
    const broken = withProse({ id: "" });
    const normal = withProse({ id: "call-1" });

    expect(detailFor([broken, normal], "", emptyList())).toBeNull();
    expect(detailFor([broken, normal], "call-1", emptyList())).not.toBeNull();
  });
});
