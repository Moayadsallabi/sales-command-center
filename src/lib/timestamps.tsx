import { Fragment, ReactNode } from "react";

/**
 * The scorer ends every quote with the time it happened, as [mm:ss]. This turns
 * those into links straight into the recording at that moment.
 *
 * It is what makes a score arguable rather than asserted. A closer who disputes
 * a 4 on Tension can click the mark and hear the nine seconds in question, and
 * an argument about whether the AI was fair becomes an argument about what was
 * actually said — which is the only one worth having.
 */

// mm:ss, or h:mm:ss on the long calls.
const STAMP = /\[(\d{1,3}:[0-5]\d(?::[0-5]\d)?)\]/g;

/**
 * The query parameter the recording host uses to open at a given second.
 *
 * Fathom is the default source, and this is the one value to change if a link
 * opens at the start instead of at the mark. Everything else about the feature
 * is host-agnostic: an unparseable URL renders the timestamp as plain text
 * rather than a dead link, so getting this wrong degrades quietly.
 */
export const RECORDING_TIME_PARAM = "timestamp";

export function stampToSeconds(stamp: string): number {
  const parts = stamp.split(":").map(Number);
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + parts[1];
}

/** The recording URL, opened at `stamp`. Null when there is nothing to link to. */
export function recordingLinkAt(
  recordingUrl: string | null,
  stamp: string
): string | null {
  if (!recordingUrl) return null;
  try {
    const url = new URL(recordingUrl);
    url.searchParams.set(RECORDING_TIME_PARAM, String(stampToSeconds(stamp)));
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Text with every [mm:ss] turned into a link into the recording.
 *
 * Calls scored before timestamps existed contain none and render unchanged, so
 * this is safe to wrap every piece of written feedback in.
 */
export function withTimestamps(
  text: string,
  recordingUrl: string | null
): ReactNode {
  if (!text) return text;

  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(STAMP)) {
    const at = match.index ?? 0;
    const stamp = match[1];
    if (at > cursor) out.push(text.slice(cursor, at));

    const href = recordingLinkAt(recordingUrl, stamp);
    out.push(
      href ? (
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          // Tabular figures so a column of times does not jitter, and the
          // underline offset keeps the brackets legible at 11px.
          className="font-mono text-[0.9em] tabular-nums text-[#d4af37]/80 underline decoration-[#d4af37]/30 underline-offset-2 transition-colors hover:text-[#d4af37] hover:decoration-[#d4af37]"
          title="Open the recording at this moment"
        >
          {stamp}
        </a>
      ) : (
        <span key={key++} className="font-mono text-[0.9em] tabular-nums text-zinc-500">
          {stamp}
        </span>
      )
    );
    cursor = at + match[0].length;
  }

  if (cursor === 0) return text;
  if (cursor < text.length) out.push(text.slice(cursor));

  return <Fragment>{out}</Fragment>;
}
