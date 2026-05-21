import type { ReactNode } from "react";

/** Tones available to <Pill>. The colour mapping (see TONE_CLASSES below)
 *  matches what the Admin*Page surfaces were already using inline — pulling
 *  them through one component just lets us bump a shade (e.g. dark-mode
 *  violet text → violet-100 for WCAG AA) in one place. */
export type PillTone = "ink" | "paper" | "violet" | "blush" | "sage" | "muted";

export interface PillProps {
  tone?: PillTone;
  /** Optional leading icon. Lucide icons sized 11 line up with the
   *  text-[11px] type below; consumers should pass `size={11}`. */
  icon?: ReactNode;
  children: ReactNode;
  /** When the pill is the only signal carrying a piece of information
   *  (e.g. an "Active flag — 3 days left" status row), add an `sr-only`
   *  span so screen-reader users get a status word too. */
  srLabel?: string;
  /** "default" → solid filled pill. "dot" → a 6px coloured dot followed
   *  by inline text in the surrounding ink colour, for low-emphasis
   *  status indicators in dense tables. */
  variant?: "default" | "dot";
}

/** Background + text colour mapping per tone. Common shell (size, gap,
 *  radius, weight) lives in BASE_CLS and applies to every variant — only
 *  the colour pair changes here. The blush tone keeps a ring because the
 *  blush-50 fill is too close to paper-50 to read as a chip on its own;
 *  every other tone has enough fill contrast to skip the ring. */
const TONE_CLASSES: Record<PillTone, string> = {
  ink: "bg-ink-800 text-paper-100 dark:bg-paper-100 dark:text-umber-900",
  paper: "bg-paper-100 text-ink-700 dark:bg-umber-700/60 dark:text-paper-100",
  violet:
    "bg-violet-100 text-violet-950 dark:bg-violet-500/20 dark:text-violet-100",
  blush:
    "bg-blush-50 text-blush-800 ring-1 ring-blush-300 dark:bg-blush-400/15 dark:text-blush-200 dark:ring-blush-400/40",
  sage: "bg-sage-100 text-sage-900 dark:bg-sage-400/15 dark:text-sage-200",
  muted: "bg-paper-200 text-ink-600 dark:bg-umber-800 dark:text-umber-300",
};

/** The dot variant uses the tone's text colour as the dot fill so the
 *  same palette key reads consistently across variants. We map tone →
 *  dot colour explicitly (rather than reusing TONE_CLASSES' `text-*`)
 *  because the text colour in the dot variant is the surrounding ink
 *  colour, not the tone — the dot alone carries the status hue. */
const DOT_CLASSES: Record<PillTone, string> = {
  ink: "bg-ink-700 dark:bg-paper-100",
  paper: "bg-ink-400 dark:bg-umber-300",
  violet: "bg-violet-700 dark:bg-violet-300",
  blush: "bg-blush-600 dark:bg-blush-300",
  sage: "bg-sage-600 dark:bg-sage-300",
  muted: "bg-ink-300 dark:bg-umber-500",
};

const BASE_CLS =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium";

const DOT_BASE_CLS =
  "inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-700 dark:text-paper-100";

export function Pill({
  tone = "paper",
  icon,
  children,
  srLabel,
  variant = "default",
}: PillProps) {
  if (variant === "dot") {
    return (
      <span className={DOT_BASE_CLS}>
        <span
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[tone]}`}
        />
        {srLabel != null && <span className="sr-only">{srLabel}</span>}
        <span>{children}</span>
      </span>
    );
  }
  return (
    <span className={`${BASE_CLS} ${TONE_CLASSES[tone]}`}>
      {icon != null && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      {srLabel != null && <span className="sr-only">{srLabel}</span>}
      <span>{children}</span>
    </span>
  );
}
