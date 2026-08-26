import { Building2 } from "lucide-react";

/* The client PICKER used to live here, in the section rail. It moved into the
   bar across the top of every system: a picker that only changed this
   dashboard meant the same question had to be answered again on the KPI
   dashboard and the calendar, and two pickers on one screen would have been
   the exact incoherence the bar exists to remove. What stayed is the one line
   below, which is about this page's numbers and belongs on this page.
   See public/shell.js in the KPI service. */

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
