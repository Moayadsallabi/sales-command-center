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

/**
 * The shared sign-in, checked with the console that issues it.
 *
 * VERIFIED THERE, NOT HERE. The token is HMAC-signed and this file could check
 * the signature itself in about fifteen lines -- and then a credential format
 * would live in two repos that deploy independently, which is the drift this
 * workspace has already paid for with sales-rules.json. So it asks instead.
 *
 * FAILS SOFT, DELIBERATELY. If the identity service is unreachable this returns
 * null and the Basic-auth path below still answers. During the migration that
 * is the difference between "the shared login is not working yet" and "nobody
 * can open their dashboard", and only one of those is acceptable to discover
 * the morning after.
 */
async function sharedSession(request: NextRequest): Promise<{ role: string; clientId: string | null } | null> {
  const cookie = request.cookies.get("kpi_token")?.value;
  if (!cookie) return null;
  const base = process.env.IDENTITY_URL ?? "https://kpi.perceptionismlab.com";
  try {
    const res = await fetch(base + "/api/session/whoami", {
      headers: { Cookie: "kpi_token=" + cookie },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const me = await res.json();
    if (!me?.authenticated) return null;
    return { role: String(me.role), clientId: me.client_id ?? null };
  } catch {
    return null;   // unreachable, expired, malformed: all "no shared session"
  }
}

/**
 * Whose dashboard is this deployment? One service per client today, so it is a
 * variable rather than a lookup. Unset means nobody is let in by the shared
 * session -- an unnamed deployment cannot check that the person in front of it
 * is the client it holds, and letting them in anyway is how one client reads
 * another's calls.
 */
function servesClient(): string | null {
  return process.env.CLIENT_ID?.trim() || null;
}

export async function proxy(request: NextRequest) {
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

  // THE SHARED SIGN-IN FIRST, the password second. Both are accepted for now:
  // taking the password away in the same change that adds the session means a
  // single mistake locks the client out with no way back in.
  const session = await sharedSession(request);
  if (session) {
    const mine = servesClient();
    if (session.role === "admin") return NextResponse.next();
    if (mine && session.clientId === mine) return NextResponse.next();
    // A real session belonging to somebody else. Not a login prompt -- they are
    // signed in, just not to this. A 401 here would invite them to try the
    // password, which is the wrong instruction for the wrong client.
    if (session.clientId && mine && session.clientId !== mine) {
      return new NextResponse(
        "You are signed in, but this dashboard belongs to a different client.\n\n" +
        "Go to https://app.perceptionismlab.com to reach yours.",
        { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
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
