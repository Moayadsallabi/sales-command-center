import { Building2 } from "lucide-react";

/**
 * The whole page, when the pinned client cannot be opened.
 *
 * This replaces a banner that sat ABOVE the deployment's own numbers — which
 * meant the fallback client's calls, cash and closers rendered under the
 * pinned client's name in the bar, with one amber line saying so. A banner
 * over wrong numbers still shows wrong numbers; Moayad read his own tracker
 * under Karan Thind's name on 2026-08-28. So a refused switch now renders
 * this screen and nothing else, the same way a broken Notion connection
 * renders SetupNotice and nothing else.
 */
export function SwitchRefused({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl rounded-xl border border-white/[0.06] bg-white/[0.02] p-8">
        <div className="flex items-center gap-3">
          <Building2 className="h-4 w-4 text-gold-500" strokeWidth={1.5} />
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-gold-500">
            Nothing to show
          </span>
        </div>

        <h1 className="mt-4 text-xl font-semibold text-zinc-100">
          This dashboard cannot be opened
        </h1>
        <p className="mt-2 text-[13px] text-zinc-400">{message}</p>

        <p className="mt-8 border-t border-white/[0.04] pt-4 text-[11px] text-zinc-400">
          No numbers are shown instead — this page never falls back to another
          client&apos;s figures. Pick a different client in the bar at the top.
        </p>
      </div>
    </div>
  );
}
