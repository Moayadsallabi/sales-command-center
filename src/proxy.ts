import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * HTTP Basic auth over the whole dashboard.
 *
 * **Closed unless told otherwise.** This page renders prospect names, deal
 * sizes, recording links and what was said on private sales calls, so the
 * safe state is the one you get by forgetting to configure something. With
 * `DASHBOARD_PASSWORD` unset the dashboard now refuses to serve at all and
 * says why, rather than serving that page to anyone holding the URL.
 *
 * To publish it deliberately — a demo, a screen on a wall — set
 * `DASHBOARD_PUBLIC=1`. That is a decision someone has to type out.
 */

const REALM = 'Basic realm="Sales Command Center", charset="UTF-8"';

const LOCKED_OUT = `Sales Command Center is not configured.

Set DASHBOARD_PASSWORD to require a login, or DASHBOARD_PUBLIC=1 to publish
this dashboard to anyone with the address. It renders prospect names, deal
sizes and call summaries, so it does not serve without one of the two.`;

/** Length-independent comparison so the check does not leak the password. */
function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const user = process.env.DASHBOARD_USER ?? "admin";

  // Deliberately public, or showing invented data. Demo mode reads nothing
  // from Notion, so there is no private call on the page to protect.
  if (
    !password &&
    (process.env.DASHBOARD_PUBLIC === "1" ||
      process.env.DASHBOARD_DEMO_DATA === "1")
  ) {
    return NextResponse.next();
  }

  // Neither configured. Fail closed and explain, rather than defaulting to
  // publishing a page of private sales calls.
  if (!password) {
    return new NextResponse(LOCKED_OUT, {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const header = request.headers.get("authorization");

  if (header?.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {
      decoded = "";
    }
    const separator = decoded.indexOf(":");
    if (separator !== -1) {
      const okUser = safeEqual(decoded.slice(0, separator), user);
      const okPass = safeEqual(decoded.slice(separator + 1), password);
      if (okUser && okPass) return NextResponse.next();
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": REALM },
  });
}

export const config = {
  // Everything except Next's own static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
