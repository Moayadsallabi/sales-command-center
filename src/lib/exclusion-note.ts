/**
 * WHY A ROW WAS LEFT OUT, AND THE SENTENCE THE PAGE MAKES OF IT.
 *
 * Split from `excluded-calls.ts` because that file reads the exclusion list off
 * disk, and the call table is a client component: importing it from there put
 * `node:fs` in the browser bundle and took the whole page to a 500. Nothing
 * here touches the filesystem, so both sides can read it.
 */

/**
 * WHY A ROW IS OUT, in a form the page can count rather than a sentence.
 *
 * The page used to describe every exclusion as "another offer's business",
 * which is what the hand-written list mostly holds and is not true of the
 * others: two of Brey's ten were a team meeting and a recording that was not a
 * sales conversation at all. Saying it in one phrase made the screen assert
 * something about rows it had not looked at.
 */
export type ExclusionKind = "other-offer" | "not-a-sales-call" | "ruled-by-hand";

/** The little the page needs about a left-out row: when it was, and why. */
export interface ExcludedRow {
  call_date: string | null;
  kind?: ExclusionKind;
}

/**
 * The sentence under the table, counting each reason separately.
 *
 * It used to call all of them "another offer's business", which was the
 * hand-written list's usual reason and not true of the rest — two of Brey's ten
 * were a team meeting and a recording that was not a sales conversation. One
 * phrase over three populations is the shape this dashboard keeps paying for.
 */
export function exclusionNote(excluded: ExcludedRow[]): string | null {
  if (excluded.length === 0) return null;
  const count = (kind: ExclusionKind) =>
    excluded.filter((e) => (e.kind ?? "ruled-by-hand") === kind).length;
  const parts = (
    [
      [count("other-offer"), "another offer's business"],
      [count("not-a-sales-call"), "not a sales call"],
      [count("ruled-by-hand"), "ruled out by hand"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`);
  const rows = excluded.length === 1 ? "row is" : "rows are";
  return `${excluded.length} tracker ${rows} left out of this period — ${parts.join(", ")}.`;
}

/** One recording the tracker holds more than once, and how many rows it has. */
export interface DuplicateNote {
  name: string;
  call_date: string | null;
  copies: number;
}
