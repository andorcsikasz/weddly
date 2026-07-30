// The planner's settings hub: a branded hero over the tab nav.
//
// The hero is a moss band, moss being the planner portal's own colour, and it
// is a WASH (moss-100 / dark moss-950) rather than the deep fill a vendor
// header wears. That is a contrast decision, not a taste one: three things
// inside it are drawn for a paper-like surface and none of them are ours to
// restyle. `PlannerAvatarUpload`'s initials fallback is an umber-900 disc with
// a moss-600 camera button (both would sink into a dark green ground),
// `TierBadge`'s gold variant is a translucent light pill with dark type, and
// `TIER_RING`'s light-mode arcs are mid greys and browns. On a pale moss wash
// all three keep the contrast they were built with, in both themes.

import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { countryName } from "@shared/country_list";
import type { PlannerProfile } from "@shared/types";
import { usePlannerPoints } from "../../components/PlannerPointsRail";
import { ProgressRing } from "../../components/ProgressRing";
import { TIER_RING, TierBadge } from "../../components/TierBadge";
import { plannerApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useDocumentMeta } from "../../lib/seo";
import { PlannerAvatarUpload } from "./PlannerAvatarUpload";

const TABS = [
  { id: "account", path: "account", labelKey: "planner_profile.tab_account" },
  { id: "offerings", path: "offerings", labelKey: "planner_profile.tab_offerings" },
  { id: "subscription", path: "subscription", labelKey: "planner_profile.tab_subscription" },
  { id: "data", path: "data", labelKey: "planner_profile.tab_data" },
] as const;

function getInitials(fullName: string, email: string): string {
  const source = fullName.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase();
  }
  const single = parts[0] ?? "";
  return single.slice(0, 2).toUpperCase() || "?";
}

export default function PlannerSettingsLayout() {
  const { t, locale } = useT();
  // The subscription tab gets its own browser-tab title; account/data keep the
  // generic settings title.
  const { pathname } = useLocation();
  const onSubscription = pathname.endsWith("/subscription");
  useDocumentMeta(
    onSubscription ? "planner_billing.meta_title" : "planner_profile.meta_title",
    onSubscription ? "planner_billing.meta_description" : "planner_profile.meta_description",
  );
  const [profile, setProfile] = useState<PlannerProfile | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Its own fetch, deliberately not blocking: a failed or slow points call
  // leaves the hero without its score block and changes nothing else.
  const points = usePlannerPoints();

  const load = useCallback(() => {
    setLoadError(false);
    plannerApi
      .getProfile()
      .then((p) => setProfile(p))
      .catch(() => setLoadError(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const initials = profile ? getInitials(profile.full_name, profile.email) : "?";
  // The business is what a couple meets in the directory, so it leads; the
  // person's name is the fallback for a planner who hasn't named one yet. The
  // last fallback is a non-breaking space (kept from the previous hero): a
  // plain one collapses in JSX and the H1 would lose its height mid-load,
  // dragging the whole band up and then back down.
  const displayName = profile?.business_name?.trim() || profile?.full_name || " ";

  const rank = points?.rank ?? null;
  // The rank is SHOWN as "#3 / 12", which is right for a compact block and
  // useless read aloud, so the screen reader gets the whole sentence instead.
  // That sentence is also the only home the all-planners variant has: with no
  // country there is no short scope label to print under the numbers.
  const rankSentence = rank
    ? rank.country
      ? t("planner_points.rank_position_country", {
          rank: rank.rank,
          total: rank.total,
          country: countryName(rank.country, locale),
        })
      : t("planner_points.rank_position_all", { rank: rank.rank, total: rank.total })
    : null;

  return (
    <div className="mx-auto max-w-2xl py-2">
      <div>
        {/* Hero. Wraps rather than shrinks: at 360px the score block drops to
            its own full-width row under the name instead of squeezing the
            avatar and truncating the business name to three letters. */}
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-moss-100 p-4 ring-1 ring-inset ring-moss-200 sm:gap-5 sm:p-5 dark:bg-moss-950 dark:ring-moss-900">
          {/* Only the wrapper is ours here: the control's disc, camera button
              and remove button are shared with any other surface that mounts
              it. The band's padding is what keeps its two negatively-offset
              buttons inside the moss instead of bleeding over the edge. */}
          <div className="shrink-0 pr-1">
            <PlannerAvatarUpload
              url={profile?.planner_avatar_url ?? null}
              initials={initials}
              onUpdated={setProfile}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-grotesk text-2xl font-semibold leading-tight tracking-tight text-umber-900 dark:text-paper-50">
              {displayName}
            </h1>
            {/* Wraps, because the row can hold three things now (the email, the
                planner pill, the tier pill) and at 360px they do not fit on one
                line. */}
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate text-sm text-umber-600 dark:text-moss-100">
                {profile?.email ?? ""}
              </span>
              {/* Re-tinted from the neutral paper pill it used to be: inside a
                  moss band the planner marker may as well BE the moss. */}
              <span className="shrink-0 rounded-md bg-moss-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-moss-900 dark:bg-moss-900 dark:text-moss-100">
                {t("planner_profile.badge_planner")}
              </span>
              {points && <TierBadge tier={points.tier} size="sm" />}
            </div>
            {/* The upload instruction that used to sit here is gone. It was
                three lines of "click the camera icon, JPEG/PNG/WebP up to 5 MB"
                inside a coloured band, and every part of it is already carried
                by something that cannot be missed: the camera button is labelled
                (aria-label + title), the file input only accepts those three
                types, and a rejected file toasts. On a phone it was the tallest
                thing in the hero, which is a lot of band spent on chrome. The
                `planner_profile.avatar_hint` key is kept for whatever surface
                wants it next. */}
          </div>

          {/* The compact points read. Absent until the fetch lands, and absent
              for good if it fails, which costs the hero this block and nothing
              else: it is the last item of a wrapping row, so its arrival never
              moves the avatar or the name. */}
          {points && (
            <div
              {...(rankSentence ? { title: rankSentence } : {})}
              className="flex w-full items-center gap-3 rounded-xl bg-paper-50/80 px-3 py-2.5 ring-1 ring-inset ring-moss-200 sm:w-auto dark:bg-umber-900/70 dark:ring-moss-900"
            >
              {/* The arc wears the TIER's colour rather than the portal's moss:
                  it sits a few pixels from the tier badge, and two colours for
                  one fact read as two facts. The same exception the vendor rail
                  makes, for the same reason: a tier is identity, not progress.
                  The pale plate under it is what keeps TIER_RING's light-mode
                  greys and browns legible inside a coloured band. */}
              <ProgressRing
                pct={points.progress * 100}
                size={40}
                stroke={3}
                trackClass={TIER_RING[points.tier].track}
                arcClass={TIER_RING[points.tier].arc}
                label={t("planner_points.ring_label")}
              >
                <span className="font-grotesk text-[11px] font-semibold leading-none tabular-nums text-umber-900 dark:text-paper-50">
                  {points.points}
                </span>
              </ProgressRing>
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-umber-500 dark:text-moss-200">
                  {t("planner_points.label")}
                </p>
                {rank && (
                  <>
                    <span className="sr-only">{rankSentence}</span>
                    <p aria-hidden="true" className="flex items-baseline gap-1">
                      <span className="font-grotesk text-xl font-semibold leading-none tracking-[-0.02em] tabular-nums text-umber-900 dark:text-paper-50">
                        #{rank.rank}
                      </span>
                      <span className="font-grotesk text-xs font-medium leading-none tabular-nums text-umber-500 dark:text-moss-200">
                        / {rank.total}
                      </span>
                    </p>
                    {rank.country && (
                      <p
                        aria-hidden="true"
                        className="truncate text-[11px] leading-tight text-umber-500 dark:text-moss-200"
                      >
                        {countryName(rank.country, locale)}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Tab nav */}
        <nav
          aria-label={t("planner_profile.tabs_aria")}
          className="-mb-px mt-6 flex gap-1 overflow-x-auto border-b border-paper-200 px-1 dark:border-umber-700"
        >
          {TABS.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.path}
              end
              className={({ isActive }) =>
                `whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-ink-900 text-ink-900 dark:border-paper-50 dark:text-paper-50"
                    : "border-transparent text-ink-500 hover:border-ink-300 hover:text-ink-800 dark:text-umber-300 dark:hover:border-umber-500 dark:hover:text-paper-100"
                }`
              }
            >
              {t(
                tab.labelKey as
                  | "planner_profile.tab_account"
                  | "planner_profile.tab_offerings"
                  | "planner_profile.tab_subscription"
                  | "planner_profile.tab_data",
              )}
            </NavLink>
          ))}
        </nav>

        {loadError && (
          <div
            role="alert"
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blush-200 bg-blush-50 px-4 py-3 text-sm text-blush-800 dark:border-blush-900/40 dark:bg-blush-950/30 dark:text-blush-300"
          >
            <span>{t("planner_profile.load_error")}</span>
            <button type="button" onClick={load} className="btn-outline btn-sm shrink-0">
              {t("planner_profile.load_retry")}
            </button>
          </div>
        )}

        <div className="pb-16">
          <Outlet context={{ profile, setProfile, loadError }} />
        </div>
      </div>
    </div>
  );
}
