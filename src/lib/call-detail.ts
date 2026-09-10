import { CallDetail, CallRecord } from "./types";
import { partitionCalls } from "./excluded-calls";

/**
 * ONE CALL'S WRITTEN HALF, PICKED OUT OF A CLIENT'S OWN CALLS.
 *
 * The prose no longer travels with the page — it was 59% of the payload, sent
 * again every sixty seconds for calls nobody had opened (see CallDetail in
 * types.ts) — so the panel asks for a call's write-up when someone opens it.
 * This is the part of that answer with no Next.js in it: the shell that
 * resolves WHOSE calls these are lives in app/call-detail.ts.
 *
 * TWO THINGS IT MUST NOT HAND OVER, and they are the reason this is a function
 * rather than a lookup:
 *
 *   - A call belonging to another CLIENT. Guaranteed by the caller, which
 *     reads `calls` through one client's credentials. A call id is guessable
 *     in a way a client's credentials are not, so the list is the wall.
 *   - A call belonging to another OFFER. `partitionCalls` drops those, and the
 *     page drops them too — a row excluded from every figure on the dashboard
 *     must not be readable through a side door.
 *
 * An unknown id returns null and says nothing else. There is deliberately no
 * answer here that distinguishes "no such call" from "not yours": one of those
 * confirms an id exists, and the difference is worth nothing to a reader who
 * is entitled to it.
 */
export function detailFor(
  calls: CallRecord[],
  callId: string,
  exclusionsPath?: string
): CallDetail | null {
  if (typeof callId !== "string" || callId === "") return null;
  const { kept } = partitionCalls(calls, exclusionsPath);
  return kept.find((call) => call.id === callId)?.detail ?? null;
}
