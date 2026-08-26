import { NextRequest, NextResponse } from "next/server";
import { VIEWING_COOKIE, servableClients, whoami } from "@/lib/client-config";

export const dynamic = "force-dynamic";

/**
 * Point this dashboard at one of the Lab's clients, or back at its own.
 *
 * ADMIN ONLY, AND CHECKED HERE AS WELL AS ON THE WAY OUT. The page re-checks
 * the role every time it renders, so strictly this route could set the cookie
 * for anyone and the page would ignore it. It refuses anyway, because a switch
 * that appears to work and silently does nothing is a bug report; and because
 * a route whose safety rests entirely on a check somewhere else is one edit
 * away from having no check at all.
 *
 * The chosen client is checked against the same list the switcher offered, so
 * an id typed by hand cannot reach the credential call.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const raw = (body as { clientId?: unknown } | null)?.clientId;
  const clientId = typeof raw === "string" && raw.trim() ? raw.trim() : null;

  // Demo mode reads nothing real: there is no registry, no console to ask, and
  // no client's calls behind any of these names. The page renders invented data
  // whichever one is picked, so the switch is a label change and is allowed to
  // be. Every other path below requires a verified admin.
  const demo = process.env.DASHBOARD_DEMO_DATA === "1";

  if (!demo) {
    const cookieHeader = request.headers.get("cookie");
    const me = await whoami(cookieHeader);
    if (me?.role !== "admin") {
      return NextResponse.json(
        { error: "Only the Lab can switch client." },
        { status: 403 }
      );
    }
    if (clientId) {
      const clients = await servableClients(cookieHeader);
      if (!clients.some((c) => c.id === clientId)) {
        return NextResponse.json(
          { error: "That is not a client this dashboard can open." },
          { status: 400 }
        );
      }
    }
  }

  const res = NextResponse.json({ ok: true, clientId });

  if (clientId) {
    res.cookies.set(VIEWING_COOKIE, clientId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    // Back to whoever this deployment is named after.
    res.cookies.delete(VIEWING_COOKIE);
  }

  return res;
}
