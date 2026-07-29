// Right-hand "wedding planners" rail on /app/vendors. Surfaces registered
// planner accounts to couples and starts the existing consent flow straight
// from the card: request → planner accepts → linked (or approve an inbound
// planner request on the spot). Renders nothing while the directory is empty
// so the suppliers page stays undisturbed until there is real supply.

import { countryName } from "@shared/country_list";
import type { PlannerDirectoryEntry, PlannerEventInput } from "@shared/types";
import { Check, Clock, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/api";
import { couplePlannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useToast } from "./ui";
import { VerifiedBadge } from "./VerifiedBadge";

/** Fire-and-forget directory analytics beacon (card impressions + click-
 *  throughs). Best-effort by design: a failed send never disrupts the couple. */
function trackPlannerEvents(events: PlannerEventInput[]): void {
  if (events.length === 0) return;
  void couplePlannerApi.recordCardEvents(events).catch(() => {
    /* analytics are best-effort */
  });
}

/** Ensure a bare reference link (e.g. "instagram.com/x") gets a scheme so the
 *  anchor navigates off-site instead of within the app. */
export function hrefFor(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

export function plannerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Planner style slugs reuse the /planners waitlist vocabulary, so the labels
 *  come from the same `planners.style_*` keys. Unknown slugs render raw. */
export function plannerStyleLabel(t: (k: string) => string, style: string): string {
  const known = [
    "romantic",
    "classic",
    "rustic",
    "modern",
    "bohemian",
    "elegant",
    "vintage",
    "outdoor",
    "other",
  ];
  return known.includes(style) ? t(`planners.style_${style}`) : style;
}

export function PlannerCard({
  planner,
  onChanged,
}: {
  planner: PlannerDirectoryEntry;
  onChanged: (id: number, status: PlannerDirectoryEntry["link_status"]) => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, next: PlannerDirectoryEntry["link_status"]) {
    setBusy(true);
    try {
      await fn();
      onChanged(planner.planner_user_id, next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const meta = [planner.city, planner.country ? countryName(planner.country, locale) : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="card !p-4 flex h-full flex-col">
      <div className="flex items-start gap-3">
        {planner.avatar_url ? (
          <img
            src={planner.avatar_url}
            alt=""
            className="h-11 w-11 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink-900 text-sm font-semibold text-paper-50 dark:bg-paper-50 dark:text-ink-900"
          >
            {plannerInitials(planner.business_name || planner.full_name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                trackPlannerEvents([
                  { planner_user_id: planner.planner_user_id, type: "profile_click" },
                ]);
                navigate(`/app/planners/${planner.planner_user_id}`);
              }}
              aria-label={t("planner_directory.view_profile")}
              className="truncate text-left font-semibold text-ink-900 hover:underline focus:outline-none focus-visible:underline dark:text-paper-50"
            >
              {planner.business_name || planner.full_name}
            </button>
            {planner.verified && (
              <VerifiedBadge size={14} kind="planner" complete={planner.profile_complete} />
            )}
            {planner.website && (
              <a
                href={hrefFor(planner.website)}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() =>
                  trackPlannerEvents([
                    { planner_user_id: planner.planner_user_id, type: "website_click" },
                  ])
                }
                aria-label={t("planner_directory.website_aria")}
                className="shrink-0 text-ink-400 transition hover:text-ink-700 dark:text-umber-400 dark:hover:text-umber-200"
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>
          {meta && <p className="truncate text-xs text-ink-500 dark:text-umber-300">{meta}</p>}
        </div>
      </div>

      {planner.bio && (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-600 dark:text-umber-300">
          {planner.bio}
        </p>
      )}

      {(planner.styles?.length || planner.weddings_per_year != null) && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {(planner.styles ?? []).slice(0, 3).map((s) => (
            <span
              key={s}
              className="rounded-full bg-paper-200 px-2 py-0.5 text-[10px] font-medium text-ink-600 dark:bg-umber-800 dark:text-umber-200"
            >
              {plannerStyleLabel(t, s)}
            </span>
          ))}
          {planner.weddings_per_year != null && planner.weddings_per_year > 0 && (
            <span className="text-[10px] text-ink-500 dark:text-umber-400">
              {t("planner_directory.weddings_per_year", { n: planner.weddings_per_year })}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-3">
        {planner.link_status === "none" && (
          <button
            type="button"
            className="btn-outline btn-sm w-full"
            disabled={busy}
            onClick={() => {
              trackPlannerEvents([
                { planner_user_id: planner.planner_user_id, type: "connect_click" },
              ]);
              void run(
                () => couplePlannerApi.invitePlannerById(planner.planner_user_id),
                "invited",
              );
            }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : t("planner_directory.connect")}
          </button>
        )}
        {planner.link_status === "invited" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 dark:text-umber-300">
            <Clock size={12} /> {t("planner_directory.invited")}
          </span>
        )}
        {planner.link_status === "requested" && (
          <button
            type="button"
            className="btn-primary btn-sm w-full"
            disabled={busy}
            onClick={() =>
              void run(() => couplePlannerApi.acceptPlanner(planner.planner_user_id), "active")
            }
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : t("planner_directory.approve")}
          </button>
        )}
        {planner.link_status === "active" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-sage-700 dark:text-sage-400">
            <Check size={12} /> {t("planner_directory.linked")}
          </span>
        )}
      </div>
    </div>
  );
}

export function PlannerDirectoryRail() {
  const { t } = useT();
  const [planners, setPlanners] = useState<PlannerDirectoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    couplePlannerApi
      .directory()
      .then((r) => {
        if (cancelled) return;
        setPlanners(r.planners);
        // One impression per card actually rendered to this couple.
        trackPlannerEvents(
          r.planners.map((p) => ({
            planner_user_id: p.planner_user_id,
            type: "impression" as const,
          })),
        );
      })
      .catch(() => {
        /* the rail is an extra; a failed load just leaves it hidden */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChanged(id: number, status: PlannerDirectoryEntry["link_status"]) {
    setPlanners((prev) =>
      prev.map((p) => (p.planner_user_id === id ? { ...p, link_status: status } : p)),
    );
  }

  if (!loaded || planners.length === 0) return null;

  // The aside carries its own column width so that when the directory is
  // empty (null return above) the suppliers grid keeps the full page width.
  return (
    <aside
      aria-label={t("planner_directory.title")}
      className="mt-10 lg:mt-0 lg:w-72 lg:shrink-0 xl:w-80"
    >
      <div className="mb-1 flex items-center gap-2">
        <Sparkles size={16} className="text-umber-600 dark:text-umber-400" aria-hidden />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-700 dark:text-umber-200">
          {t("planner_directory.title")}
        </h2>
      </div>
      <p className="mb-3 text-xs text-ink-500 dark:text-umber-300">
        {t("planner_directory.subtitle")}
      </p>
      <div className="space-y-3">
        {planners.map((p) => (
          <PlannerCard key={p.planner_user_id} planner={p} onChanged={handleChanged} />
        ))}
      </div>
    </aside>
  );
}
