/**
 * The Perceptionism eye. One mark across the whole estate — the KPI dashboard,
 * the Content OS, the validator, the document covers and this. The source
 * files live in `brand/` at the workspace root; change them there first.
 *
 * This used to be a variant: the eye with a bar chart in place of the pupil,
 * on the reasoning that the system watches the call and then measures it. The
 * idea was sound and the result was a fourth slightly-different eye, which is
 * what you get when every product draws its own. A screenshot of this page and
 * a screenshot of the KPI dashboard now carry the same mark.
 *
 * Drawn with `currentColor` rather than the gradient the standalone SVG files
 * use, so the caller sets the colour — gold on the dark dashboard, #B9912F on
 * white for client documents. At the sizes this renders, a gradient is
 * imperceptible anyway.
 *
 * `size` is the WIDTH. The eye is roughly twice as wide as it is tall, so
 * height follows from it; asking for a square would either letterbox the mark
 * inside empty space or squash it.
 *
 * This is the display cut. The browser-tab cut lives in `src/app/icon.svg`,
 * where the iris ring is dropped and the strokes thickened, because these
 * weights disappear at 16px.
 */
const ASPECT = 34 / 64;

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
      height={Math.round(size * ASPECT)}
      viewBox="0 15 64 34"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeLinecap="round">
        <path d="M3 32C14 14 50 14 61 32 50 50 14 50 3 32Z" strokeWidth="5" />
        {/* Broken at two opposing points, as on the master mark. */}
        <circle
          cx="32"
          cy="32"
          r="9"
          strokeWidth="3.4"
          strokeDasharray="22.6 5.7"
          transform="rotate(-40 32 32)"
        />
      </g>
      <circle cx="32" cy="32" r="4.6" fill="currentColor" />
    </svg>
  );
}

/**
 * Mark plus wordmark, stacked the way the Lab's document covers are: product
 * name in the foreground colour, house name below it in small gold caps.
 * Unused by the dashboard header, which shows the client's business name under
 * a gold product line instead — this is here for print and export surfaces.
 */
export function SalesCommandLockup({ className }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ""}`}>
      <SalesCommandMark size={40} className="text-gold-500" />
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
