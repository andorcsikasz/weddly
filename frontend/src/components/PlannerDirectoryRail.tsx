// Right-hand "wedding planners" rail on /app/vendors. Surfaces registered
// planner accounts to couples and starts the existing consent flow straight
// from the card: request → planner accepts → linked (or approve an inbound
// planner request on the spot). Renders nothing while the directory is empty
// so the suppliers page stays undisturbed until there is real supply.

import { countryName } from "@shared/country_list";
import type { PlannerDirectoryDetail, PlannerDirectoryEntry } from "@shared/types";
import { Check, Clock, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { couplePlannerApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { Button, Dialog, useToast } from "./ui";

/** Ensure a bare reference link (e.g. "instagram.com/x") gets a scheme so the
 *  anchor navigates off-site instead of within the app. */
function hrefFor(link: string): string {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}

/** Planner style slugs reuse the /planners waitlist vocabulary, so the labels
 *  come from the same `planners.style_*` keys. Unknown slugs render raw. */
function styleLabel(t: (k: string) => string, style: string): string {
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

/** Full planner profile behind a directory card, opened by clicking the name.
 *  Shows bio, styles, availability, references (portfolio + external links) and
 *  the same "Felkérés"/approve consent CTA as the card, kept in sync via
 *  onChanged so the underlying card updates too. */
function PlannerDetailModal({
  plannerUserId,
  initialStatus,
  onClose,
  onChanged,
}: {
  plannerUserId: number;
  initialStatus: PlannerDirectoryEntry["link_status"];
  onClose: () => void;
  onChanged: (id: number, status: PlannerDirectoryEntry["link_status"]) => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [detail, setDetail] = useState<PlannerDirectoryDetail | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    couplePlannerApi
      .plannerDetail(plannerUserId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        setStatus(d.link_status);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      });
    return () => {
      cancelled = true;
    };
  }, [plannerUserId, t, toast]);

  async function act(fn: () => Promise<unknown>, next: PlannerDirectoryEntry["link_status"]) {
    setBusy(true);
    try {
      await fn();
      setStatus(next);
      onChanged(plannerUserId, next);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  const meta = detail
    ? [detail.city, detail.country ? countryName(detail.country, locale) : null]
        .filter(Boolean)
        .join(" · ")
    : "";

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>
        {t("common.close")}
      </Button>
      {status === "none" && (
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            void act(() => couplePlannerApi.invitePlannerById(plannerUserId), "invited")
          }
        >
          {t("planner_directory.connect")}
        </Button>
      )}
      {status === "invited" && (
        <span className="inline-flex items-center gap-1.5 self-center text-sm font-medium text-ink-500 dark:text-umber-300">
          <Clock size={14} /> {t("planner_directory.invited")}
        </span>
      )}
      {status === "requested" && (
        <Button
          variant="primary"
          loading={busy}
          onClick={() => void act(() => couplePlannerApi.acceptPlanner(plannerUserId), "active")}
        >
          {t("planner_directory.approve")}
        </Button>
      )}
      {status === "active" && (
        <span className="inline-flex items-center gap-1.5 self-center text-sm font-medium text-sage-700 dark:text-sage-400">
          <Check size={14} /> {t("planner_directory.linked")}
        </span>
      )}
    </>
  );

  return (
    <Dialog
      open
      role="dialog"
      closeOnBackdrop
      size="lg"
      onClose={onClose}
      title={detail?.business_name || t("planner_directory.title")}
      footer={footer}
    >
      {!detail ? (
        <div className="flex items-center justify-center py-10 text-ink-400 dark:text-umber-400">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-start gap-3">
            {detail.avatar_url ? (
              <img
                src={detail.avatar_url}
                alt=""
                className="h-14 w-14 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink-900 text-base font-semibold text-paper-50 dark:bg-paper-50 dark:text-ink-900"
              >
                {initials(detail.business_name || detail.full_name)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink-900 dark:text-paper-50">
                {detail.business_name}
              </p>
              {meta && <p className="text-xs text-ink-500 dark:text-umber-300">{meta}</p>}
              {detail.website && (
                <a
                  href={hrefFor(detail.website)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-ink-700 hover:underline dark:text-paper-200"
                >
                  <ExternalLink size={12} /> {t("planner_directory.website")}
                </a>
              )}
            </div>
          </div>

          {detail.bio && (
            <p className="whitespace-pre-line leading-relaxed text-ink-700 dark:text-paper-100">
              {detail.bio}
            </p>
          )}

          {detail.styles?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {detail.styles.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-paper-200 px-2.5 py-1 text-xs font-medium text-ink-600 dark:bg-umber-800 dark:text-umber-200"
                >
                  {styleLabel(t, s)}
                </span>
              ))}
            </div>
          ) : null}

          {(detail.weddings_per_year || detail.km_radius) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500 dark:text-umber-400">
              {detail.weddings_per_year ? (
                <span>
                  {t("planner_directory.weddings_per_year", { n: detail.weddings_per_year })}
                </span>
              ) : null}
              {detail.km_radius ? (
                <span>{t("planner_directory.km_radius", { n: detail.km_radius })}</span>
              ) : null}
            </div>
          )}

          {detail.availability && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-umber-400">
                {t("planner_directory.availability_label")}
              </p>
              <p className="text-sm text-ink-700 dark:text-paper-100">{detail.availability}</p>
            </div>
          )}

          {detail.portfolio.length > 0 || detail.reference_links?.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400 dark:text-umber-400">
                {t("planner_directory.references_label")}
              </p>
              {detail.portfolio.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {detail.portfolio.map((p) => (
                    <figure
                      key={p.id}
                      className="overflow-hidden rounded-lg bg-paper-100 dark:bg-umber-800"
                    >
                      {p.image_url && (
                        <img
                          src={p.image_url}
                          alt={p.title}
                          className="aspect-square w-full object-cover"
                        />
                      )}
                      {p.title && (
                        <figcaption className="truncate px-1.5 py-1 text-[10px] text-ink-500 dark:text-umber-300">
                          {p.title}
                        </figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              )}
              {detail.reference_links?.length ? (
                <ul className="mt-2 space-y-1">
                  {detail.reference_links.map((link) => (
                    <li key={link}>
                      <a
                        href={hrefFor(link)}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 break-all text-xs text-ink-700 hover:underline dark:text-paper-200"
                      >
                        <ExternalLink size={11} className="shrink-0" /> {link}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
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
  const [busy, setBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

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
            {initials(planner.business_name || planner.full_name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              aria-label={t("planner_directory.view_profile")}
              className="truncate text-left font-semibold text-ink-900 hover:underline focus:outline-none focus-visible:underline dark:text-paper-50"
            >
              {planner.business_name}
            </button>
            {planner.website && (
              <a
                href={planner.website}
                target="_blank"
                rel="noreferrer noopener"
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
              {styleLabel(t, s)}
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
            onClick={() =>
              void run(() => couplePlannerApi.invitePlannerById(planner.planner_user_id), "invited")
            }
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
      {detailOpen && (
        <PlannerDetailModal
          plannerUserId={planner.planner_user_id}
          initialStatus={planner.link_status}
          onClose={() => setDetailOpen(false)}
          onChanged={onChanged}
        />
      )}
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
        if (!cancelled) setPlanners(r.planners);
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
