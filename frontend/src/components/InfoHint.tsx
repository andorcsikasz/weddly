import { Info } from "lucide-react";
import { useId, useState } from "react";

/** Small "i" affordance that tucks a page or section's instruction text into a
 *  tooltip next to the heading, so the always-visible subtitle paragraph can go
 *  away and the page chrome stays clean. Reveals on hover / focus (desktop) and
 *  on tap (touch); the text is wired to the trigger via `aria-describedby` so
 *  screen readers still announce it. */
export function InfoHint({
  text,
  label,
  className = "",
  onClick,
}: {
  text: string;
  /** Accessible name for the button. Defaults to the hint text. */
  label?: string;
  className?: string;
  /** When provided, clicking the icon runs this action (e.g. open a dialog)
   *  instead of just toggling the tooltip. The tooltip text still reveals on
   *  hover / focus, so the icon can carry both a hint and an action. */
  onClick?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={`group relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label={label ?? text}
        aria-describedby={id}
        aria-expanded={onClick ? undefined : open}
        onClick={onClick ?? (() => setOpen((v) => !v))}
        onBlur={() => setOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-400 transition-colors hover:text-ink-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:text-umber-300 dark:hover:text-paper-50"
      >
        <Info size={16} aria-hidden />
      </button>
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute left-0 top-full z-20 mt-2 w-64 rounded-lg bg-umber-900 px-3 py-2 text-xs font-normal normal-case leading-snug tracking-normal text-paper-50 shadow-pop transition-opacity duration-150 sm:w-80 dark:bg-umber-950 ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
      >
        {text}
      </span>
    </span>
  );
}
