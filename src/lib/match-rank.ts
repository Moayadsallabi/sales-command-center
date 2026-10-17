/**
 * How well a search-box row matches what was typed — the command bar in
 * components/dashboard/command-palette.tsx. Zero means it does not match.
 *
 * The label counts for more than the hidden keywords, a word that STARTS with
 * the query for more than one that merely contains it, and every word typed has to land somewhere — "sam no
 * deal" finds Sam's lost calls rather than everything mentioning any of them.
 */
export function matchRank(
  query: string,
  item: { label: string; detail?: string; keywords?: string }
): number {
  const label = item.label.toLowerCase();
  const rest = `${item.detail ?? ""} ${item.keywords ?? ""}`.toLowerCase();
  let total = 0;
  for (const word of query.split(/\s+/).filter(Boolean)) {
    const inLabel = label.startsWith(word)
      ? 5
      : new RegExp(`\\b${escapeRegExp(word)}`).test(label)
      ? 4
      : label.includes(word)
      ? 2
      : 0;
    const inRest = new RegExp(`\\b${escapeRegExp(word)}`).test(rest) ? 1 : 0;
    if (inLabel === 0 && inRest === 0) return 0;
    total += Math.max(inLabel, inRest);
  }
  return total;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
