// Weddly Points, docked at the foot of the vendor rail.
//
// It used to be a full-width strip on the dashboard, which meant the score was
// visible on exactly one screen and ate the space above the greeting. In the
// rail it sits beside the nav for the whole session, and on the collapsed rail
// it shrinks to the ring alone (with the total inside it, since a bare icon
// there would say nothing).
//
// The rulebook does NOT live in the rail: 224px is too narrow for five rules and
// their point values, so the block is a button that opens the same list in a
// dialog. That also keeps the rail's job intact, which is navigation plus a
// glanceable score, not a panel that pushes the nav around when it expands.

import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  EARNABLE_EVENTS,
  FAST_REPLY_HOURS,
  POINTS_BY_EVENT,
  type VendorPointsStatus,
  perksForTier,
} from "@shared/vendor_points";
import { vendorPointsApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { ProgressRing } from "./ProgressRing";
import { TierBadge } from "./TierBadge";
import { Dialog } from "./ui/Dialog";

/** Where each earning rule sends a vendor who wants to act on it. `null` means
 *  the rule isn't something a vendor can go and do in one click (a repeat
 *  booking is a couple's decision), so the row stays a plain, unlinked line
 *  rather than pretending a button exists for it. */
const EARN_ROUTE: Record<(typeof EARNABLE_EVENTS)[number], string | null> = {
  profile_completeness: "/vendor/listing",
  first_review: "/vendor/reviews",
  review_collected: "/vendor/reviews",
  fast_reply: "/vendor/clients",
  repeat_booking: null,
};

export function VendorPointsRail({ collapsed }: { collapsed: boolean }) {
  const { t } = useT();
  const { pathname } = useLocation();
  const [points, setPoints] = useState<VendorPointsStatus | null>(null);
  const [open, setOpen] = useState(false);

  // Re-read on navigation, like the rail's inquiry badge: the rules are things
  // the vendor does elsewhere in the portal (finish the listing, answer an
  // inquiry), so the number would otherwise sit stale until a full reload.
  useEffect(() => {
    let cancelled = false;
    vendorPointsApi
      .get()
      .then((p) => {
        if (!cancelled) setPoints(p);
      })
      .catch(() => {
        // Non-critical: no points block is better than an error state wedged
        // into the navigation rail.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!points) return null;
  const atTop = points.next_tier === null;
  const status = atTop
    ? t("vendor.points.at_top")
    : t("vendor.points.to_next", {
        points: String(points.points_to_next),
        tier: t(`vendor.points.tier.${points.next_tier}`),
      });

  return (
    <div className="mt-1 border-t border-paper-300 pt-1 dark:border-umber-700">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${t("vendor.points.label")}: ${points.points}`}
        aria-label={`${t("vendor.points.label")}: ${points.points}. ${t("vendor.points.how_to_earn")}`}
        className={`flex w-full shrink-0 flex-col gap-1.5 rounded-xl py-2 text-left transition-colors hover:bg-steel-50 dark:hover:bg-steel-600/15 ${
          collapsed ? "px-3 lg:items-center lg:px-0" : "px-3"
        }`}
      >
        {/* The section's own name, on its own line: sharing a 154px line with
            the tier badge truncated it to "WEDDLY PON…". */}
        <span
          className={`text-[10px] uppercase tracking-wide text-ink-500 dark:text-umber-300 ${
            collapsed ? "lg:hidden" : ""
          }`}
        >
          {t("vendor.points.label")}
        </span>
        {/* justify-center on the collapsed rail, not just items-center on the
            column: the row is w-full, so without it the ring sits at the left
            edge of a 64px rail while every nav icon above it is centred. */}
        <span className={`flex w-full items-center gap-3 ${collapsed ? "lg:justify-center" : ""}`}>
          <ProgressRing
            pct={points.progress * 100}
            size={34}
            stroke={3}
            tone={atTop ? "complete" : "active"}
            label={t("vendor.points.ring_label")}
          >
            <span className="font-grotesk text-[11px] font-semibold tabular-nums leading-none text-ink-900 dark:text-paper-100">
              {points.points}
            </span>
          </ProgressRing>
          <span className={`flex min-w-0 flex-1 flex-col gap-1 ${collapsed ? "lg:hidden" : ""}`}>
            {/* self-start, or the column's default stretch pulls the pill to
                the full rail width. */}
            <span className="self-start">
              <TierBadge tier={points.tier} size="sm" />
            </span>
            <span className="text-[11px] leading-tight text-ink-500 dark:text-umber-300">
              {status}
            </span>
          </span>
        </span>
      </button>

      <VendorPointsDialog
        open={open}
        onClose={() => setOpen(false)}
        points={points}
        status={status}
      />
    </div>
  );
}

/** The rulebook: what earns points, what each rule has paid THIS vendor, and
 *  what the next tier unlocks.
 *
 *  Every value comes from the shared tables (`POINTS_BY_EVENT`, `perksForTier`)
 *  rather than the copy, so a rebalance is one edit in `shared/vendor_points.ts`
 *  and never a translation round. The per-rule totals are what turn this from a
 *  help text into an answer to the question a vendor actually asks: where did MY
 *  points come from. */
function VendorPointsDialog({
  open,
  onClose,
  points,
  status,
}: {
  open: boolean;
  onClose: () => void;
  points: VendorPointsStatus;
  status: string;
}) {
  const { t } = useT();

  // What the NEXT tier unlocks, which is the reason to chase it. Composed from
  // the shared perk table so a tier's perks are described in exactly one place.
  const nextPerks = points.next_tier ? perksForTier(points.next_tier) : null;
  const unlocks: string[] = [];
  if (nextPerks) {
    if (nextPerks.search_boost > 0) unlocks.push(t("vendor.points.perk_search"));
    if (nextPerks.extra_lead_credits > 0) {
      unlocks.push(t("vendor.points.perk_leads", { n: String(nextPerks.extra_lead_credits) }));
    }
    if (nextPerks.subscription_discount_pct > 0) {
      unlocks.push(
        t("vendor.points.perk_discount", { pct: String(nextPerks.subscription_discount_pct) }),
      );
    }
    if (nextPerks.profile_badge) unlocks.push(t("vendor.points.perk_badge"));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("vendor.points.how_to_earn")}
      titleClassName="text-2xl tracking-[-0.02em]"
      role="dialog"
      closeOnBackdrop
    >
      <div className="flex flex-col">
        {/* The total, display-size: the portal lets type carry the hierarchy
            rather than boxing the number. */}
        <div className="flex flex-col gap-1.5 pb-5">
          <span className="flex items-center gap-3">
            <span className="font-grotesk text-5xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink-900 dark:text-paper-50">
              {points.points}
            </span>
            <TierBadge tier={points.tier} size="sm" />
          </span>
          <span className="text-sm text-ink-500 dark:text-paper-400">{status}</span>
        </div>

        {/* Full-bleed rows on hairlines, the whole width tappable: the same list
            anatomy as the dashboard's upcoming events, and the reason the point
            values dropped their tinted pills. A value belongs in the value
            column, right-aligned against its chevron, not in a badge. */}
        <ul className="-mx-4 flex flex-col divide-y divide-paper-200 border-y border-paper-200 sm:-mx-6 dark:divide-umber-700 dark:border-umber-700">
          {EARNABLE_EVENTS.map((event) => {
            const to = EARN_ROUTE[event];
            const earned = points.earned_by_event[event] ?? 0;
            const row = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-medium text-ink-900 dark:text-paper-50">
                    {t(`vendor.points.earn_${event}`, { hours: String(FAST_REPLY_HOURS) })}
                  </span>
                  {earned > 0 && (
                    <span className="block text-sm tabular-nums text-ink-500 dark:text-paper-400">
                      {t("vendor.points.earned_so_far", { n: String(earned) })}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-grotesk font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                  +{POINTS_BY_EVENT[event]}
                </span>
                {/* Kept (invisible) on the unlinked row so every value lands in
                    the same column instead of one line hanging 20px right. */}
                <ChevronRight
                  size={16}
                  aria-hidden="true"
                  className={`shrink-0 transition-transform ${
                    to
                      ? "text-ink-300 group-hover:translate-x-0.5 dark:text-paper-400"
                      : "invisible"
                  }`}
                />
              </>
            );
            const className = "group flex w-full items-center gap-4 px-4 py-4 sm:px-6";
            return (
              <li key={event}>
                {to ? (
                  // The dialog is portal-mounted, so a route change alone would
                  // leave it open on top of the page it just navigated to.
                  <Link
                    to={to}
                    onClick={onClose}
                    className={`${className} transition-colors hover:bg-paper-100 dark:hover:bg-umber-800`}
                  >
                    {row}
                  </Link>
                ) : (
                  <div className={className}>{row}</div>
                )}
              </li>
            );
          })}
        </ul>

        {points.next_tier && unlocks.length > 0 && (
          <p className="pt-4 text-sm text-ink-500 dark:text-paper-400">
            {t("vendor.points.next_unlocks", {
              tier: t(`vendor.points.tier.${points.next_tier}`),
            })}{" "}
            {unlocks.join(" · ")}
          </p>
        )}
      </div>
    </Dialog>
  );
}
