// The one progress ring in the vendor portal, and in the planner portal too.
// Profile completeness, Weddly Points tier progress and (phase 2) quest
// progress all render through it, so "how far along am I" looks identical
// wherever it is asked.
//
// Colour semantics are fixed and must not be mixed, because the whole point of
// a colour system is that a vendor learns it once:
//
//   active   → blush (the terracotta accent): in progress, the default. It is
//              the portal's one interactive colour, and progress IS the thing
//              the vendor is being asked to act on.
//   complete → sage: earned, finished, nothing left to do
//   warning  → amber: needs attention, at risk, expiring
//
// One ring shows IDENTITY rather than state — Weddly Points tier progress, whose
// arc has to be the tier's own colour or it contradicts the badge sitting 12px
// to its right. That one passes trackClass/arcClass (from `TIER_RING`) and opts
// out of the table above; it is the same exception TierBadge already is to the
// portal's one-interactive-colour rule, and for the same reason: a tier is data.
//
// The PLANNER portal renders this ring as well, and overrides the same two
// classes for the opposite reason: the table above is the vendor palette, whose
// `active` tone is blush, and blush means nothing on a surface whose one
// interactive colour is moss. So planner PROGRESS passes moss track+arc
// (stroke-moss-100 / stroke-moss-600 and their dark pairs) while planner tier
// rings keep `TIER_RING` untouched, since a tier is the same fact on both
// sides. Either way both classes are passed together, never one.
//
// Pure tokenised SVG, no chart library. The arc animates on value change; a
// ring that snaps reads as a redraw rather than as progress.

import type { ReactNode } from "react";

export type ProgressTone = "active" | "complete" | "warning";

const TRACK: Record<ProgressTone, string> = {
  active: "stroke-paper-200 dark:stroke-umber-700",
  complete: "stroke-sage-100 dark:stroke-sage-900/50",
  warning: "stroke-amber-100 dark:stroke-amber-900/40",
};

const ARC: Record<ProgressTone, string> = {
  active: "stroke-blush-500 dark:stroke-blush-400",
  complete: "stroke-sage-600 dark:stroke-sage-400",
  warning: "stroke-amber-500 dark:stroke-amber-400",
};

export function ProgressRing({
  pct,
  size = 20,
  stroke = 3,
  tone = "active",
  trackClass,
  arcClass,
  label,
  children,
}: {
  /** 0..100. Values outside the range are clamped rather than drawn wrong. */
  pct: number;
  size?: number;
  stroke?: number;
  tone?: ProgressTone;
  /** Tailwind `stroke-*` classes that replace the tone's colours, for the one
   *  identity ring (see the header note). Pass BOTH or neither: an arc on a
   *  track from another palette is worse than either alone. */
  trackClass?: string;
  arcClass?: string;
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
        className={trackClass ?? TRACK[tone]}
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
        className={`${arcClass ?? ARC[tone]} transition-[stroke-dashoffset] duration-700 ease-out`}
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
