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

export function TierBadge({
  tier,
  size = "md",
}: {
  tier: VendorTierKey;
  size?: "sm" | "md";
}) {
  const { t } = useT();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-grotesk font-semibold uppercase tracking-wide ring-1 ${
        size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
      } ${TIER_CLASS[tier]}`}
    >
      {t(`vendor.points.tier.${tier}`)}
    </span>
  );
}
