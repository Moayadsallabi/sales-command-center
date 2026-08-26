import { cache } from "react";
import { cookies, headers } from "next/headers";
import { VIEWING_COOKIE, Viewing, resolveViewing } from "./client-config";

/**
 * WHOSE DASHBOARD THIS REQUEST IS, WORKED OUT ONCE.
 *
 * Two places need it and they are rendered together: the page, which reads a
 * client's calls with these credentials, and the layout, which tells the shared
 * bar whose figures are about to appear. Resolving it twice would mean two
 * round trips to the identity service and two to the credential store on every
 * single page view — and, worse, two answers that could in principle differ,
 * which is exactly the disagreement the bar exists to prevent.
 *
 * `cache` from React deduplicates for the life of one render, so both callers
 * get the same object from one resolution. It is deliberately NOT in
 * client-config.ts: that file is read by the tests under plain Node, where
 * React's request cache does not exist.
 */
export const currentViewing = cache(async (): Promise<Viewing> => {
  const cookieHeader = (await headers()).get("cookie");
  const chosen = (await cookies()).get(VIEWING_COOKIE)?.value ?? null;
  return resolveViewing(cookieHeader, chosen);
});
