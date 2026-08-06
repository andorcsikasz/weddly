// Weddly Points tier badge. One component, every surface: the dashboard strip,
// (later) the public profile and the directory card.
//
// The entry tier wears the portal's own slate blue rather than a colour of its
// own, because "Blue" is where everybody starts and a loud badge for the
// default state is noise. Gold and Platinum earn their own metal, and Black is
// the only one that fills solid: it is the last rung, and the ladder should be
// visibly darker and quieter the higher it goes, not louder.
//
// Tiers are NOT semantic colours: they are identity. The sage/amber meanings
// (complete / needs attention) stay reserved for state, so a Gold badge must
// never be read as "done".

import type { VendorTierKey } from "@shared/vendor_points";
import { useT } from "../lib/i18n";

const TIER_CLASS: Record<VendorTierKey, string> = {
  blue: "bg-steel-100 text-steel-700 ring-steel-200 dark:bg-steel-600/20 dark:text-steel-100 dark:ring-steel-600/40",
  gold: "bg-star/15 text-paper-900 ring-star/40 dark:bg-star/15 dark:text-star dark:ring-star/30",
  platinum:
    "bg-ink-100 text-ink-700 ring-ink-200 dark:bg-paper-200/15 dark:text-paper-100 dark:ring-paper-200/25",
  black:
    "bg-ink-900 text-paper-100 ring-ink-900 dark:bg-ink-950 dark:text-paper-100 dark:ring-paper-200/30",
};

/** The same four identities as `stroke-*` pairs, for the tier ring that sits
 *  beside the badge (`ProgressRing`'s trackClass/arcClass). They live HERE
 *  rather than in the ring so a rebalanced tier palette moves both at once —
 *  a ring in last season's gold next to this season's badge is the one way this
 *  can look broken.
 *
 *  Gold is the only tier whose two themes take different hues: `star` (#FFD000)
 *  is what the badge wears on dark umber, and a 3px stroke of it on white paper
 *  is very nearly invisible, so light mode uses the brass the couple sidebar's
 *  own dot uses. The other three ride their badge's family directly. */
export const TIER_RING: Record<VendorTierKey, { track: string; arc: string }> = {
  blue: {
    track: "stroke-steel-100 dark:stroke-steel-600/30",
    arc: "stroke-steel-600 dark:stroke-steel-200",
  },
  gold: {
    track: "stroke-umber-100 dark:stroke-star/20",
    arc: "stroke-umber-400 dark:stroke-star",
  },
  platinum: {
    track: "stroke-ink-100 dark:stroke-paper-200/20",
    arc: "stroke-ink-400 dark:stroke-paper-200",
  },
  black: {
    track: "stroke-ink-200 dark:stroke-paper-200/25",
    arc: "stroke-ink-900 dark:stroke-paper-50",
  },
};

/** The same four identities as an OUTLINE: ring and text in the tier's own
 *  colour, no fill.
 *
 *  This is the state the ladder needed and the badge had no way to say. A rung
 *  a vendor has passed, or has not reached yet, is still that tier and should
 *  still look like it — drawing it in the filled style would claim they hold
 *  it, and drawing it in flat grey would say the tier has no identity until you
 *  own it. Blue in particular was invisible: a Gold vendor saw one gold pill and
 *  nothing else, so the rung they started on had simply vanished from the app.
 *
 *  Gold's outline uses the same light/dark split its ring does: `star` (#FFD000)
 *  as a hairline on white paper is very nearly invisible, so light mode borrows
 *  the umber the ring already borrows. */
const TIER_OUTLINE_CLASS: Record<VendorTierKey, string> = {
  blue: "bg-transparent text-steel-600 ring-steel-300 dark:text-steel-200 dark:ring-steel-600/50",
  gold: "bg-transparent text-umber-600 ring-umber-400 dark:text-star dark:ring-star/50",
  platinum: "bg-transparent text-ink-500 ring-ink-300 dark:text-paper-200 dark:ring-paper-200/35",
  black: "bg-transparent text-ink-700 ring-ink-400 dark:text-paper-100 dark:ring-paper-200/45",
};

export function TierBadge({
  tier,
  size = "md",
  variant = "filled",
}: {
  tier: VendorTierKey;
  size?: "sm" | "md";
  /** `outline` for a rung on the ladder the vendor does not currently hold. */
  variant?: "filled" | "outline";
}) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-grotesk font-semibold uppercase tracking-wide ring-1 ${
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      } ${variant === "outline" ? TIER_OUTLINE_CLASS[tier] : TIER_CLASS[tier]}`}
    >
      {t(`vendor.points.tier.${tier}`)}
    </span>
  );
}
