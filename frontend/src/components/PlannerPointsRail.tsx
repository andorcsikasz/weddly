// Weddly Points, planner side: the same score in three places, each sized for
// the room it is in.
//
//   PlannerPointsRail   the block docked at the foot of the vertical nav rail,
//                       which only exists from lg. It shrinks to the ring alone
//                       on the collapsed 4rem rail (with the total inside it,
//                       because a bare glyph there says nothing).
//   PlannerPointsChip   the header form below lg, where the planner nav is a
//                       horizontal strip of tabs and has no foot to dock to.
//                       This is the one difference from the vendor shell worth
//                       knowing: the vendor rail turns vertical at md, so its
//                       chip hides at md. Here the cutover is lg, and exactly
//                       one of the two is ever visible.
//   PlannerPointsPanel  the account-page card, mounted by the settings page.
//                       It is the only surface with room for the rulebook
//                       inline, so it does not need the dialog at all.
//
// The rulebook is a dialog for the two cramped surfaces: five rules and their
// point values do not fit a 224px rail, and expanding in place would push the
// navigation around. The list itself is ONE component (`PointsRules`) shared by
// the dialog and the panel, so a rule can never be described two ways.
//
// Colour: this is the planner portal, whose interactive colour is moss and whose
// header bar is light paper. So the chip is styled like its neighbouring header
// controls rather than like the vendor's chip on its steel bar. The tier ring is
// the one exception and keeps `TIER_RING`: the arc wears the tier's identity,
// never the portal accent, or it contradicts the badge sitting beside it.

import { countryName } from "@shared/country_list";
import {
  PLANNER_EARNABLE_EVENTS,
  PLANNER_POINTS_BY_EVENT,
  type PlannerPointsStatus,
  plannerPerksForTier,
} from "@shared/planner_points";
import { Award, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { plannerPointsApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";
import { ProgressRing } from "./ProgressRing";
import { TIER_RING, TierBadge } from "./TierBadge";
import { Dialog } from "./ui/Dialog";

/** Where each earning rule sends a planner who wants to act on it.
 *
 *  `first_review` and `review_collected` are deliberately null: reviews land on
 *  the couple-facing planner profile and the portal has no reviews screen yet.
 *  An unlinked line is better than a button that goes nowhere, which is the
 *  same call the vendor file makes for a rule with no home. */
const EARN_ROUTE: Record<(typeof PLANNER_EARNABLE_EVENTS)[number], string | null> = {
  profile_completeness: "/app/planner/settings/account",
  first_review: null,
  review_collected: null,
  client_linked: "/app/planner/clients",
  couple_invited: "/app/planner/clients",
};

type Translate = (path: string, vars?: Record<string, string | number>) => string;

// Module-level cache, which the vendor hook does not need and this one does: the
// shell (rail + chip) and the settings account page (panel) are mounted at the
// same time, so two components ask for one number on the same navigation. The
// promise is keyed by pathname so concurrent callers share ONE GET, and the last
// answer paints a late mount immediately instead of flashing empty.
let cachedPoints: PlannerPointsStatus | null = null;
let inflightPath: string | null = null;
let inflight: Promise<PlannerPointsStatus> | null = null;

/** The one fetch behind all three surfaces. Re-reads on navigation, because
 *  every rule is something the planner does elsewhere in the portal (finish the
 *  profile, accept a client), so the total would otherwise sit stale until a
 *  full reload. Failures are swallowed: no points block is better than an error
 *  state wedged into the navigation. */
export function usePlannerPoints(): PlannerPointsStatus | null {
  const { pathname } = useLocation();
  const [points, setPoints] = useState<PlannerPointsStatus | null>(cachedPoints);
  useEffect(() => {
    let cancelled = false;
    if (!inflight || inflightPath !== pathname) {
      inflightPath = pathname;
      inflight = plannerPointsApi.get();
    }
    inflight
      .then((p) => {
        cachedPoints = p;
        if (!cancelled) setPoints(p);
      })
      .catch(() => {
        /* non-critical, see above */
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  return points;
}

/** The two sentences every surface needs: how far the next tier is, and where
 *  this planner stands in the pool a couple actually browses. */
function pointsCopy(
  t: Translate,
  locale: Locale,
  points: PlannerPointsStatus,
): { status: string; rankLine: string | null } {
  const status =
    points.next_tier === null
      ? t("planner_points.at_top")
      : t("planner_points.to_next", {
          points: String(points.points_to_next),
          // Tier NAMES come from the vendor keys on purpose: Blue/Gold/Platinum/
          // Black is one shared vocabulary (see shared/planner_points.ts), and a
          // second copy of four words is just drift waiting to happen.
          tier: t(`vendor.points.tier.${points.next_tier}`),
        });
  const rank = points.rank;
  let rankLine: string | null = null;
  if (rank) {
    // A rank scoped to a country says something ("3rd of 12 in Hungary"); the
    // raw ISO code says nothing, so the pool is always named. A planner who
    // never told us where they work is ranked globally and gets the unscoped
    // sentence rather than a country they never claimed.
    rankLine = rank.country
      ? t("planner_points.rank_position_country", {
          rank: String(rank.rank),
          total: String(rank.total),
          country: countryName(rank.country, locale),
        })
      : t("planner_points.rank_position_all", {
          rank: String(rank.rank),
          total: String(rank.total),
        });
  }
  return { status, rankLine };
}

/** Phone and tablet form: a badge glyph and the total, coloured like the other
 *  controls on the planner header bar, opening the same rulebook. No ring at
 *  this size: the arc would say less than the number already does. */
export function PlannerPointsChip({
  points,
  className = "",
}: {
  points: PlannerPointsStatus | null;
  className?: string;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  if (!points) return null;
  const { status, rankLine } = pointsCopy(t, locale, points);
  const label = `${t("planner_points.label")}: ${points.points}`;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={[label, rankLine, t("planner_points.how_to_earn")].filter(Boolean).join(". ")}
        title={label}
        className={`inline-flex h-11 items-center gap-1.5 rounded-lg px-2.5 text-umber-700 transition-colors hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:ring-offset-2 dark:text-paper-200 dark:hover:bg-umber-800 dark:focus-visible:ring-moss-300 ${className}`}
      >
        <Award size={18} aria-hidden="true" />
        <span className="font-grotesk text-sm font-semibold tabular-nums leading-none">
          {points.points}
        </span>
      </button>
      <PlannerPointsDialog
        open={open}
        onClose={() => setOpen(false)}
        points={points}
        status={status}
        rankLine={rankLine}
      />
    </>
  );
}

/** Rail form. Only rendered from lg, where the planner nav is a vertical column:
 *  below that the nav is a single horizontally scrolling row of tabs, and a
 *  full-width block appended to it would either be pushed off the right edge or
 *  force the tabs off it. The chip covers those widths. */
export function PlannerPointsRail({
  collapsed,
  points,
}: {
  collapsed: boolean;
  points: PlannerPointsStatus | null;
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);

  if (!points) return null;
  const { status, rankLine } = pointsCopy(t, locale, points);
  const rank = points.rank;

  return (
    <div className="mt-1 hidden border-t border-paper-300 pt-1 lg:block dark:border-umber-700">
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`${t("planner_points.label")}: ${points.points}`}
        // The place is drawn as "#3 / 12" over a bare country name, which is
        // right for a 224px rail and useless read aloud, so the screen reader
        // gets the whole sentence instead of the shorthand.
        aria-label={[
          `${t("planner_points.label")}: ${points.points}`,
          rankLine,
          t("planner_points.how_to_earn"),
        ]
          .filter(Boolean)
          .join(". ")}
        className={`flex w-full shrink-0 flex-col gap-1.5 rounded-xl py-2 text-left transition-colors hover:bg-moss-50 dark:hover:bg-umber-800 ${
          collapsed ? "items-center px-0" : "px-3"
        }`}
      >
        {/* The section's own name on its own line: sharing the line with the
            tier badge truncates it to "WEDDLY PON...". */}
        <span
          className={`text-[10px] uppercase tracking-wide text-ink-500 dark:text-umber-300 ${
            collapsed ? "hidden" : ""
          }`}
        >
          {t("planner_points.label")}
        </span>
        {/* justify-center rather than only items-center on the column: the row
            is w-full, so without it the ring hugs the left edge of a 4rem rail
            while every nav icon above it is centred. */}
        <span className={`flex w-full items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
          <ProgressRing
            pct={points.progress * 100}
            size={34}
            stroke={3}
            trackClass={TIER_RING[points.tier].track}
            arcClass={TIER_RING[points.tier].arc}
            label={t("planner_points.ring_label")}
          >
            <span className="font-grotesk text-[11px] font-semibold tabular-nums leading-none text-ink-900 dark:text-paper-100">
              {points.points}
            </span>
          </ProgressRing>
          <span className={`flex min-w-0 flex-1 flex-col gap-1 ${collapsed ? "hidden" : ""}`}>
            {/* self-start, or the column's default stretch pulls the pill out
                to the full rail width. */}
            <span className="self-start">
              <TierBadge tier={points.tier} size="sm" />
            </span>
            <span className="text-[11px] leading-tight text-ink-500 dark:text-umber-300">
              {status}
            </span>
          </span>
        </span>

        {/* The standing, and deliberately the biggest number in the block: the
            total says how much, the place says how much compared to whom, which
            is the question a planner actually asks. Neutral ink, never moss:
            the portal's accent marks what a planner can act on, and a rank is a
            fact about them. */}
        {rank && (
          <span
            className={`flex w-full flex-col gap-0.5 border-t border-paper-200 pt-2 dark:border-umber-700 ${
              collapsed ? "hidden" : ""
            }`}
          >
            <span className="flex items-baseline gap-1">
              <span className="font-grotesk text-2xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink-900 dark:text-paper-50">
                #{rank.rank}
              </span>
              <span className="font-grotesk text-xs font-medium leading-none tabular-nums text-ink-400 dark:text-umber-300">
                / {rank.total}
              </span>
            </span>
            {/* The pool, named under the number. Only when it HAS a name: an
                unscoped rank has no second line to write, and repeating the
                sentence the numbers already say would just be "#3 / 12" twice.
                The screen reader still gets the full sentence from aria-label. */}
            {rank.country && (
              <span className="truncate text-[11px] leading-tight text-ink-500 dark:text-umber-300">
                {countryName(rank.country, locale)}
              </span>
            )}
          </span>
        )}
      </button>

      <PlannerPointsDialog
        open={open}
        onClose={() => setOpen(false)}
        points={points}
        status={status}
        rankLine={rankLine}
      />
    </div>
  );
}

/** What the NEXT tier unlocks, which is the whole reason to chase it. Composed
 *  from the shared perk table, so a tier's perks are described in exactly one
 *  place and a rebalance never needs a translation round. The planner perk table
 *  has two enforced fields (directory order, directory badge) and lists nothing
 *  else, because a perk no code enforces is a lie.
 *
 *  It is the DELTA against the tier the planner already holds, not the next
 *  tier's perk list. Every tier from Gold up carries `profile_badge`, so the
 *  absolute reading promised a Gold planner a badge they were already wearing,
 *  which is the fastest way to teach someone the ladder is decoration. An empty
 *  delta prints nothing rather than an empty "At Platinum:" lead-in. */
function unlockLines(t: Translate, points: PlannerPointsStatus): string[] {
  if (!points.next_tier) return [];
  const next = plannerPerksForTier(points.next_tier);
  const held = points.perks;
  const lines: string[] = [];
  if (next.directory_boost > held.directory_boost) lines.push(t("planner_points.perk_directory"));
  if (next.profile_badge && !held.profile_badge) lines.push(t("planner_points.perk_badge"));
  return lines;
}

/** The rulebook list itself, shared by the dialog and the account panel so the
 *  five rules and their values have one implementation.
 *
 *  Full-bleed rows on hairlines with the whole width tappable, the same list
 *  anatomy the rest of the product uses. The point value lives in its own
 *  right-aligned column against the chevron rather than in a tinted pill, and
 *  the per-rule totals are what turn help text into an answer to the question a
 *  planner actually has: where did MY points come from.
 *
 *  `surface` only picks the negative margin that lets the rows reach the edge of
 *  their container: the dialog body is padded px-4 sm:px-6, a `card` is p-6. */
function PointsRules({
  points,
  surface,
  onNavigate,
}: {
  points: PlannerPointsStatus;
  surface: "dialog" | "panel";
  onNavigate?: () => void;
}) {
  const { t } = useT();
  const bleed = surface === "dialog" ? "-mx-4 sm:-mx-6" : "-mx-6";
  const pad = surface === "dialog" ? "px-4 sm:px-6" : "px-6";
  return (
    <ul
      className={`${bleed} flex flex-col divide-y divide-paper-200 border-y border-paper-200 dark:divide-umber-700 dark:border-umber-700`}
    >
      {PLANNER_EARNABLE_EVENTS.map((event) => {
        const to = EARN_ROUTE[event];
        const earned = points.earned_by_event[event] ?? 0;
        const row = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-medium text-ink-900 dark:text-paper-50">
                {t(`planner_points.earn_${event}`)}
              </span>
              {earned > 0 && (
                <span className="block text-sm tabular-nums text-ink-500 dark:text-umber-300">
                  {t("planner_points.earned_so_far", { n: String(earned) })}
                </span>
              )}
            </span>
            <span className="shrink-0 font-grotesk font-semibold tabular-nums text-ink-900 dark:text-paper-50">
              +{PLANNER_POINTS_BY_EVENT[event]}
            </span>
            {/* Kept, invisible, on an unlinked row so every value lands in the
                same column instead of one line hanging 20px to the right. */}
            <ChevronRight
              size={16}
              aria-hidden="true"
              className={`shrink-0 transition-transform ${
                to ? "text-ink-300 group-hover:translate-x-0.5 dark:text-umber-400" : "invisible"
              }`}
            />
          </>
        );
        const className = `group flex w-full items-center gap-4 py-4 ${pad}`;
        return (
          <li key={event}>
            {to ? (
              <Link
                to={to}
                onClick={onNavigate}
                className={`${className} transition-colors hover:bg-moss-50 dark:hover:bg-umber-800`}
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
  );
}

/** The rank sentence plus the one number that turns it into something to act on:
 *  how far the planner immediately above is. Shared by the dialog and the panel,
 *  which say it identically. */
function RankSentence({
  points,
  rankLine,
}: {
  points: PlannerPointsStatus;
  rankLine: string;
}) {
  const { t } = useT();
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-500 dark:text-umber-300">
      <span className="font-grotesk font-semibold text-ink-900 dark:text-paper-50">{rankLine}</span>
      {points.rank?.points_to_climb != null && (
        <span>{t("planner_points.rank_gap", { points: String(points.rank.points_to_climb) })}</span>
      )}
    </span>
  );
}

/** The rulebook, for the rail and the chip. The account panel renders the same
 *  content inline instead, since it has the width the rail does not. */
function PlannerPointsDialog({
  open,
  onClose,
  points,
  status,
  rankLine,
}: {
  open: boolean;
  onClose: () => void;
  points: PlannerPointsStatus;
  status: string;
  rankLine: string | null;
}) {
  const { t } = useT();
  const unlocks = unlockLines(t, points);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("planner_points.how_to_earn")}
      titleClassName="text-2xl tracking-[-0.02em]"
      role="dialog"
      closeOnBackdrop
    >
      <div className="flex flex-col">
        {/* The total at display size: type carries the hierarchy rather than a
            box around the number. */}
        <div className="flex flex-col gap-1.5 pb-5">
          <span className="flex items-center gap-3">
            <span className="font-grotesk text-5xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink-900 dark:text-paper-50">
              {points.points}
            </span>
            <TierBadge tier={points.tier} size="sm" />
          </span>
          <span className="text-sm text-ink-500 dark:text-umber-300">{status}</span>
          {rankLine && <RankSentence points={points} rankLine={rankLine} />}
        </div>

        {/* The dialog is portal-mounted, so a route change alone would leave it
            open on top of the page it just navigated to. */}
        <PointsRules points={points} surface="dialog" onNavigate={onClose} />

        {points.next_tier && unlocks.length > 0 && (
          <p className="pt-4 text-sm text-ink-500 dark:text-umber-300">
            {t("planner_points.next_unlocks", {
              tier: t(`vendor.points.tier.${points.next_tier}`),
            })}{" "}
            {unlocks.join(" · ")}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** Account-page card, mounted by /app/planner/settings/account. The one surface
 *  with room for the whole story, so the rules are inline and there is no
 *  dialog to open: a planner who came looking for their score should not have to
 *  tap again to read the rules. Renders nothing until the status lands, like the
 *  other two surfaces. */
export function PlannerPointsPanel({ points }: { points: PlannerPointsStatus | null }) {
  const { t, locale } = useT();
  if (!points) return null;
  const { status, rankLine } = pointsCopy(t, locale, points);
  const unlocks = unlockLines(t, points);

  return (
    <section className="card">
      <p className="text-[10px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
        {t("planner_points.label")}
      </p>
      <div className="mt-1.5 flex flex-col gap-1.5 pb-5">
        <span className="flex flex-wrap items-center gap-3">
          <span className="font-grotesk text-5xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink-900 dark:text-paper-50">
            {points.points}
          </span>
          <TierBadge tier={points.tier} size="sm" />
        </span>
        <span className="text-sm text-ink-500 dark:text-umber-300">{status}</span>
        {rankLine && <RankSentence points={points} rankLine={rankLine} />}
      </div>

      <h3 className="pb-2 text-sm font-semibold text-ink-900 dark:text-paper-50">
        {t("planner_points.how_to_earn")}
      </h3>
      <PointsRules points={points} surface="panel" />

      {points.next_tier && unlocks.length > 0 && (
        <p className="pt-4 text-sm text-ink-500 dark:text-umber-300">
          {t("planner_points.next_unlocks", {
            tier: t(`vendor.points.tier.${points.next_tier}`),
          })}{" "}
          {unlocks.join(" · ")}
        </p>
      )}
    </section>
  );
}
