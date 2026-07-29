// The blue verified check that sits next to a name — one component, so the
// mark means exactly one thing wherever a couple meets it.
//
// TWO STATES, not two badges:
//
//   solid    the business/planner is really on Weddly AND has finished their
//            profile — cover photo, price, the rest of the setup checklist.
//   outline  same account, same claim to the check, but the profile is still
//            half-filled.
//
// The check is never WITHHELD for an unfinished profile: "is this a registered
// vendor?" and "have they filled everything in?" are different questions, and
// dropping the badge would answer the first one wrong. Filling it in is what
// the second question earns. A vendor at 29% therefore looks unmistakably
// unfinished on every card without being demoted to "unverified".
//
// Completeness itself is computed server-side and rides on the DTOs
// (`DirectorySupplier.listing_complete`, `PlannerDirectoryEntry.profile_complete`),
// from the SAME checklist that drives the vendor's own progress ring — so the
// hollow badge a couple sees and the "29%" the vendor sees can never disagree.

import { BadgeCheck } from "lucide-react";
import { useT } from "../lib/i18n";

export interface VerifiedBadgeProps {
  /** Profile finished → solid check. Unfinished → outline. */
  complete: boolean;
  /** Matches the type scale it sits in: 15 on a card, 28 next to an h1. */
  size?: number;
  /** Which aggregate's wording the tooltip uses. Same mark either way. */
  kind?: "vendor" | "planner";
}

export function VerifiedBadge({ complete, size = 15, kind = "vendor" }: VerifiedBadgeProps) {
  const { t } = useT();
  const base = kind === "planner" ? "planner_directory.verified" : "suppliers.verified_vendor";
  const label = t(complete ? base : `${base}_incomplete`);
  return (
    <span className="inline-flex shrink-0 items-center" title={label} aria-label={label}>
      <BadgeCheck
        size={size}
        aria-hidden
        // Solid: azure body, white check cut out of it (the familiar social
        // mark). Outline: the same silhouette drawn in azure on nothing, which
        // reads as "started, not finished" rather than as a second colour or a
        // greyed-out/disabled badge.
        className={complete ? "fill-verified stroke-white" : "fill-none stroke-verified"}
      />
    </span>
  );
}
