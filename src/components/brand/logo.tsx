/**
 * The Sales Command Center mark: the Perceptionism eye with a bar chart in
 * place of the pupil — the system watches the call, then measures it.
 *
 * Inherits `currentColor`, so the caller sets the colour (gold on the dark
 * dashboard, #B9912F on white for client documents). The bars are laid out to
 * sit inside the lens without touching its stroke; changing the lens curve
 * means re-checking their clearance.
 *
 * This is the display cut. The browser-tab cut lives in `src/app/icon.svg`
 * with thicker strokes and tighter bars, because these weights disappear at
 * 16px.
 */
export function SalesCommandMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2.6 16C7.4 8 24.6 8 29.4 16C24.6 24 7.4 24 2.6 16Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <g fill="currentColor">
        <rect x="10.6" y="15.4" width="2.6" height="4.7" rx="1.3" />
        <rect x="14.7" y="13.2" width="2.6" height="6.9" rx="1.3" />
        <rect x="18.8" y="11.9" width="2.6" height="8.2" rx="1.3" />
      </g>
    </svg>
  );
}

/**
 * Mark plus wordmark, stacked the way the Lab's document covers are: product
 * name in the foreground colour, house name below it in small gold caps.
 * Unused by the dashboard header, which shows a live call count under the
 * title instead — this is here for print and export surfaces.
 */
export function SalesCommandLockup({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <SalesCommandMark size={34} className="text-gold-500" />
      <div className="leading-none">
        <div className="text-[15px] font-semibold tracking-tight text-zinc-100">
          Sales Command Center
        </div>
        <div className="mt-1 text-[8px] font-semibold tracking-[0.18em] text-gold-500">
          PERCEPTIONISM LAB
        </div>
      </div>
    </div>
  );
}
