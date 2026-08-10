import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Optional HTTP Basic auth over the whole dashboard.
 *
 * Off by default: with DASHBOARD_PASSWORD unset, every request passes through
 * and the dashboard is public. Set DASHBOARD_PASSWORD (and optionally
 * DASHBOARD_USER, default "admin") to require a login.
 */

const REALM = 'Basic realm="Sales Command Center", charset="UTF-8"';

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

  // No password configured — the dashboard is intentionally open. Set
  // DASHBOARD_PASSWORD in the environment to turn auth back on.
  if (!password) return NextResponse.next();

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
