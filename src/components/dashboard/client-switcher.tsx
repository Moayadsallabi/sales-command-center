"use client";

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type SwitcherClient = { id: string; name: string };

/** Two letters off a name, for the collapsed rail where there is no room for one. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * WHOSE DASHBOARD THIS IS, AND — FOR THE LAB ONLY — WHOSE IT COULD BE.
 *
 * The page has always rendered one client, named after the deployment it runs
 * on. This lets the agency point it at any client whose sales tracker is
 * connected, without a second deployment and without signing in as them.
 *
 * IT IS NOT A PERMISSION. The list arrives already filtered by the server,
 * which asks the console who is looking; a client is sent an empty list and
 * this renders nothing at all for them. Nothing here is load-bearing for
 * isolation — the choice is re-checked against the console on every render of
 * the page, so a browser that fakes it gets its own dashboard back.
 */
export function ClientSwitcher({
  clients,
  currentName,
  chosen,
  homeName,
  collapsed,
}: {
  clients: SwitcherClient[];
  /** The name in the header right now — a chosen client, or the deployment's. */
  currentName: string;
  /** The pinned client's id, or null when this is the deployment's own. */
  chosen: string | null;
  /** What this deployment is named after, for the way back. */
  homeName: string | null;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Nothing to offer, nothing to draw. A client is sent an empty list, so this
  // is also how the switcher stays invisible to everyone but the Lab.
  if (clients.length === 0) return null;

  async function choose(clientId: string | null) {
    setPending(clientId ?? "__home__");
    try {
      const res = await fetch("/api/viewing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        setPending(null);
        const body = await res.json().catch(() => null);
        window.alert(body?.error ?? "That client could not be opened.");
        return;
      }
      // A FULL RELOAD, not a router refresh. Every number on this page is read
      // on the server from one client's credentials, so changing the client
      // changes the whole page — there is no partial update to do, and asking
      // for one would leave the previous client's figures on screen while the
      // new ones arrived.
      window.location.reload();
    } catch {
      setPending(null);
      window.alert("That client could not be opened.");
    }
  }

  const menu = (
    <div
      role="menu"
      className="absolute z-50 w-[15rem] rounded-lg border border-white/[0.10] bg-[#141418] p-1.5 shadow-2xl"
      style={collapsed ? { left: "3.25rem", top: 0 } : { left: 0, right: 0, top: "calc(100% + 4px)" }}
    >
      <div className="px-2 py-1.5 t-label text-zinc-500">Open a client</div>

      {clients.map((c) => {
        const on = chosen === c.id;
        return (
          <button
            key={c.id}
            role="menuitem"
            type="button"
            disabled={pending !== null}
            onClick={() => choose(on ? null : c.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-50",
              on ? "text-gold-400" : "text-zinc-300 hover:bg-white/[0.05] hover:text-zinc-100"
            )}
          >
            {pending === c.id ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <Check className={cn("h-3 w-3 shrink-0", on ? "opacity-100" : "opacity-0")} />
            )}
            <span className="truncate">{c.name}</span>
          </button>
        );
      })}

      {/* The way back. Only drawn when there is somewhere to go back TO: on a
          deployment that names no client of its own, clearing the choice would
          land on a dashboard with no data and no explanation. */}
      {chosen && homeName && (
        <>
          <div className="my-1 h-px bg-white/[0.06]" />
          <button
            role="menuitem"
            type="button"
            disabled={pending !== null}
            onClick={() => choose(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100 disabled:opacity-50"
          >
            {pending === "__home__" ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <span className="h-3 w-3 shrink-0" />
            )}
            <span className="truncate">Back to {homeName}</span>
          </button>
        </>
      )}
    </div>
  );

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? `Viewing ${currentName}` : undefined}
        className={cn(
          "flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] transition-colors hover:border-white/[0.14]",
          collapsed ? "justify-center px-0 py-2" : "px-2 py-2"
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gold-500/20 bg-gold-500/10 text-[10px] font-semibold text-gold-400">
          {initials(currentName)}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block t-label text-zinc-500">Viewing</span>
              <span className="block truncate text-[12px] font-medium text-zinc-200">
                {currentName}
              </span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.5} />
          </>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          {menu}
        </>
      )}
    </div>
  );
}

/**
 * The one line that says the switch did not take.
 *
 * Above the numbers, deliberately, and the only thing on this page other than
 * the demo pill that is allowed up there. Everything else amber describes how
 * trustworthy a figure is; this says the figures belong to somebody else than
 * the name at the top of the page, which makes every one of them wrong to read.
 */
export function SwitchFailure({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
      <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" strokeWidth={1.5} />
      <p className="max-w-[80ch] t-body text-amber-200">{message}</p>
    </div>
  );
}
