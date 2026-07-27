// The one progress ring in the vendor portal. Profile completeness, Weddly
// Points tier progress and (phase 2) quest progress all render through it, so
// "how far along am I" looks identical wherever it is asked.
//
// Colour semantics are fixed and must not be mixed, because the whole point of
// a colour system is that a vendor learns it once:
//
//   active   → steel (the slate blue): in progress, the default
//   complete → sage: earned, finished, nothing left to do
//   warning  → amber: needs attention, at risk, expiring
//
// Pure tokenised SVG, no chart library. The arc animates on value change; a
// ring that snaps reads as a redraw rather than as progress.

import type { ReactNode } from "react";

export type ProgressTone = "active" | "complete" | "warning";

const TRACK: Record<ProgressTone, string> = {
  active: "stroke-steel-200 dark:stroke-steel-600/40",
  complete: "stroke-sage-100 dark:stroke-sage-900/50",
  warning: "stroke-amber-100 dark:stroke-amber-900/40",
};

const ARC: Record<ProgressTone, string> = {
  active: "stroke-steel-600 dark:stroke-steel-300",
  complete: "stroke-sage-600 dark:stroke-sage-400",
  warning: "stroke-amber-500 dark:stroke-amber-400",
};

export function ProgressRing({
  pct,
  size = 20,
  stroke = 3,
  tone = "active",
  label,
  children,
}: {
  /** 0..100. Values outside the range are clamped rather than drawn wrong. */
  pct: number;
  size?: number;
  stroke?: number;
  tone?: ProgressTone;
  /** Accessible description. Without it the ring is decorative (aria-hidden),
   *  which is correct when an adjacent number already says the same thing. */
  label?: string;
  /** Rendered centred inside the ring: a percentage, a tier initial, an icon. */
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - clamped / 100);
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90 shrink-0"
      {...(label
        ? { role: "img", "aria-label": label, "aria-valuenow": Math.round(clamped) }
        : { "aria-hidden": "true" })}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        className={TRACK[tone]}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={`${ARC[tone]} transition-[stroke-dashoffset] duration-700 ease-out`}
      />
    </svg>
  );
  if (!children) return svg;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center">
      {svg}
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  );
}
