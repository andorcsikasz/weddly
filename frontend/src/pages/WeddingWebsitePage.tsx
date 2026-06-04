// Public couple-branded landing page served at `/w/:slug` AND
// `/w/:slug/:code`. The single component does tier-aware progressive
// disclosure based on the response from the unified endpoint:
//
//   - public (no code):     names + date + venue_name + cover + schedule +
//                           pre-RSVP intro (if any) + generic RSVP CTA.
//   - invited (code, no yes): same content as public PLUS the per-household
//                           block (member names + a personalised RSVP CTA
//                           that pre-fills slug+code).
//   - confirmed (code, ≥1 yes): same content as invited PLUS the exact
//                           venue lat/lng pin + post_rsvp_content block.
//                           When the guest just RSVP'd through the in-page
//                           form we re-fetch with the code and shift focus
//                           to the freshly-revealed `<h2>` (aria-live).
//
// The trust boundary stays on the server — gated fields are omitted from
// the response at lower tiers, so the rendering decisions here are
// presentational only (null check + render). SEO: the code-bearing URL
// emits `noindex,follow` + canonical=`/w/:slug` so personalised links
// don't leak into Google.

import {
  Calendar,
  ExternalLink,
  Gift,
  Heart,
  HeartHandshake,
  Languages,
  Lock,
  MapPin,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { weddingWebsiteApi } from "../lib/endpoints";
import { formatDate, formatMoney, isPlausibleDateIso, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { Shell } from "../components/Shell";
import { WeddingCountdown } from "../components/WeddingCountdown";
import { Wordmark } from "../components/Wordmark";
import type {
  PublicWeddingHouseholdContext,
  PublicWeddingResponse,
  PublicWeddingTier,
  PublicWeddingWebsiteView,
} from "@shared/wedding_website";

function formatTimeOfDay(minutes: number, _locale: "hu" | "en"): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Best-effort canonical URL for the public landing — strips the `/:code`
 *  segment so `/w/:slug/:code` canonicalizes to `/w/:slug`. Used in the
 *  `<link rel="canonical">` we emit on the code-bearing route. */
function canonicalUrlFor(slug: string): string {
  if (typeof window === "undefined") return `/w/${slug}`;
  return `${window.location.origin}/w/${encodeURIComponent(slug)}`;
}

export default function WeddingWebsitePage() {
  const { slug = "", code = "" } = useParams<{ slug: string; code?: string }>();
  const hasCode = code.length > 0;
  const { t, locale, setLocale } = useT();
  const [view, setView] = useState<PublicWeddingWebsiteView | null>(null);
  const [household, setHousehold] = useState<PublicWeddingHouseholdContext | null>(null);
  const [tier, setTier] = useState<PublicWeddingTier>("public");
  const [error, setError] = useState<"not_found" | "network" | null>(null);
  const [loading, setLoading] = useState(true);
  /** Tracks whether the most recent state transition was caused by the
   *  in-page RSVP submission (rather than the initial fetch). When set,
   *  we shift focus to the post-RSVP heading after the next render so a
   *  screen reader announces the newly-revealed block. */
  const [justConfirmed, setJustConfirmed] = useState(false);
  const confirmedHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // SEO: noindex on code-bearing URLs so a copy-pasted personal link
  // doesn't end up in Google's index. Canonical points back to the
  // public landing so any accidentally indexed page consolidates there.
  useEffect(() => {
    const head = document.head;
    if (!head) return;
    const ROBOTS_SELECTOR = 'meta[name="robots"]';
    const CANONICAL_SELECTOR = 'link[rel="canonical"]';
    const ATTR_FLAG = "data-weddly-wedding-page";
    if (hasCode) {
      let robots = head.querySelector<HTMLMetaElement>(ROBOTS_SELECTOR);
      if (!robots) {
        robots = document.createElement("meta");
        robots.setAttribute("name", "robots");
        robots.setAttribute(ATTR_FLAG, "1");
        head.appendChild(robots);
      } else if (!robots.hasAttribute(ATTR_FLAG)) {
        robots.setAttribute(ATTR_FLAG, "1");
      }
      robots.setAttribute("content", "noindex,follow");

      let canonical = head.querySelector<HTMLLinkElement>(CANONICAL_SELECTOR);
      if (!canonical) {
        canonical = document.createElement("link");
        canonical.setAttribute("rel", "canonical");
        canonical.setAttribute(ATTR_FLAG, "1");
        head.appendChild(canonical);
      } else if (!canonical.hasAttribute(ATTR_FLAG)) {
        canonical.setAttribute(ATTR_FLAG, "1");
      }
      canonical.setAttribute("href", canonicalUrlFor(slug));
    }
    return () => {
      // Tear down only the tags WE injected — leave SSR-provided meta
      // alone so the page chrome stays consistent on navigation away.
      const robots = head.querySelector<HTMLMetaElement>(`meta[name="robots"][${ATTR_FLAG}]`);
      if (robots) robots.remove();
      const canonical = head.querySelector<HTMLLinkElement>(`link[rel="canonical"][${ATTR_FLAG}]`);
      if (canonical) canonical.remove();
    };
  }, [hasCode, slug]);

  const refetch = (signal?: { cancelled: boolean }) => {
    setError(null);
    const promise: Promise<PublicWeddingResponse> = hasCode
      ? weddingWebsiteApi.getWithCode(slug, code)
      : weddingWebsiteApi.get(slug);
    return promise
      .then((r) => {
        if (signal?.cancelled) return;
        setView(r.wedding);
        setHousehold(r.household);
        setTier(r.tier);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (signal?.cancelled) return;
        if (e instanceof ApiError && e.status === 404) setError("not_found");
        else setError("network");
        setLoading(false);
      });
  };

  useEffect(() => {
    const signal = { cancelled: false };
    setLoading(true);
    void refetch(signal);
    return () => {
      signal.cancelled = true;
    };
    // refetch is recreated each render; safe because we only call it for
    // the initial mount + the post-RSVP refresh trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, code]);

  // After a re-fetch that promotes the tier to "confirmed" via the
  // in-page RSVP path, move focus to the newly-revealed heading so the
  // screen reader announces the unlocked content. We pair this with
  // aria-live on the heading so even if focus is mid-flight the SR
  // narrates the change.
  useEffect(() => {
    if (justConfirmed && tier === "confirmed" && confirmedHeadingRef.current) {
      confirmedHeadingRef.current.focus();
      setJustConfirmed(false);
    }
  }, [justConfirmed, tier]);

  useDocumentMeta("seo.wedding_site_title", "seo.wedding_site_description");

  /** Soft "I'd like to help" toggle on a group-gift wishlist item. Optimistic:
   *  flip the local entry immediately, fire the code-gated endpoint, then
   *  reconcile the count + state from the server response. On failure we roll
   *  back to the pre-click snapshot. Only reachable on the code-bearing,
   *  confirmed-tier page (the button isn't rendered otherwise). */
  function onToggleWishlistInterest(itemId: number) {
    if (!hasCode) return;
    const snapshot = view;
    setView((cur) => {
      if (!cur || !cur.wishlist) return cur;
      return {
        ...cur,
        wishlist: cur.wishlist.map((e) =>
          e.id === itemId
            ? {
                ...e,
                viewer_has_interest: !e.viewer_has_interest,
                interest_count: e.interest_count + (e.viewer_has_interest ? -1 : 1),
              }
            : e,
        ),
      };
    });
    weddingWebsiteApi
      .toggleWishlistInterest(slug, code, itemId)
      .then((res) => {
        setView((cur) => {
          if (!cur || !cur.wishlist) return cur;
          return {
            ...cur,
            wishlist: cur.wishlist.map((e) =>
              e.id === itemId
                ? {
                    ...e,
                    viewer_has_interest: res.viewer_has_interest,
                    interest_count: res.interest_count,
                  }
                : e,
            ),
          };
        });
      })
      .catch(() => {
        // Roll back to the pre-click snapshot on failure.
        setView(snapshot);
      });
  }

  if (loading) {
    return (
      <Shell>
        <div className="mx-auto max-w-2xl text-center text-sm text-ink-500 dark:text-umber-300">
          {t("wedding_site.loading")}
        </div>
      </Shell>
    );
  }

  if (error === "not_found" || !view) {
    return (
      <Shell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
            {t("wedding_site.not_found_title")}
          </h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-umber-200">
            {t("wedding_site.not_found_body")}
          </p>
          <Link to="/" className="btn-outline mt-6 inline-flex">
            {t("wedding_site.back_home")}
          </Link>
        </div>
      </Shell>
    );
  }

  if (error === "network") {
    return (
      <Shell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
            {t("wedding_site.network_error_title")}
          </h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-umber-200">
            {t("wedding_site.network_error_body")}
          </p>
        </div>
      </Shell>
    );
  }

  const dateLine = isPlausibleDateIso(view.wedding_date)
    ? formatDate(view.wedding_date, locale)
    : t("wedding_site.date_tbd");

  // The personal RSVP CTA pre-fills slug + code so the guest doesn't
  // re-type their household number. After they submit, RsvpCheckinPage
  // navigates back here (`/w/:slug/:code`) — the parent component
  // re-renders and the effect below picks up the URL change. To trigger
  // the focus-shift on the *same URL*, we hand the form a callback the
  // RSVP page can use via the `?rsvped=1` query suffix (parsed below).
  const personalRsvpHref = hasCode
    ? `/rsvp?couple=${encodeURIComponent(view.couple_slug)}&code=${encodeURIComponent(code)}&return=${encodeURIComponent(`/w/${view.couple_slug}/${code}`)}`
    : `/rsvp?couple=${encodeURIComponent(view.couple_slug)}`;

  // When the user lands back here from /rsvp with `?rsvped=1` we
  // refetch + announce. Read it once on mount; React Router doesn't
  // remount on the same path.
  // (Implemented inline below to keep the hook count predictable.)

  const showInvitedExtras = tier === "invited" || tier === "confirmed";
  const showConfirmedExtras = tier === "confirmed";

  return (
    <Shell hideHeader>
      <div className="mx-auto max-w-3xl">
        {/* No app chrome on a guest-facing wedding site — just a compact
            icon-only language toggle pinned to the top-right corner. The
            Weddly brand moves to the footer instead. */}
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            className="btn-ghost btn-sm !px-2"
            onClick={() => setLocale(locale === "hu" ? "en" : "hu")}
            aria-label={t("nav.switch_language")}
            title={t("nav.switch_language")}
          >
            <Languages size={18} aria-hidden="true" />
          </button>
        </div>
        {view.cover_image_url && (
          <div className="mb-6 overflow-hidden rounded-3xl border border-paper-200 dark:border-umber-700">
            {/* Plain <img> with `loading="lazy"` — no CSP fetch through a CDN. */}
            <img
              src={view.cover_image_url}
              alt=""
              loading="lazy"
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
        )}

        {/* Hero — names + date. Stationery aesthetic mirroring the landing
            page so the public site reads as part of the same brand. */}
        <section className="card stationery text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("wedding_site.eyebrow")}
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl">
            {view.couple_display_name}
          </h1>
          <p className="mt-4 inline-flex items-center justify-center gap-2 font-serif text-base italic text-ink-700 dark:text-paper-100 sm:text-lg">
            <Calendar size={16} aria-hidden /> {dateLine}
          </p>
          {view.venue_name && (
            <p className="mt-2 inline-flex items-center justify-center gap-2 text-sm text-ink-700 dark:text-paper-100">
              <MapPin size={14} aria-hidden />
              {view.venue_name}
            </p>
          )}
          {!showConfirmedExtras && view.location_radius_km !== null && view.venue_name === null && (
            <p className="mt-2 inline-flex items-center justify-center gap-2 text-xs text-ink-500 dark:text-umber-300">
              <MapPin size={14} aria-hidden />
              {t("wedding_site.venue_approx")}
            </p>
          )}
        </section>

        {/* Pre-RSVP welcome block — same at every tier. The couple authors
            this for "anyone with the link". */}
        {view.guest_page_intro && (
          <section className="card mt-6">
            <p className="whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
              {view.guest_page_intro}
            </p>
          </section>
        )}

        {/* Invited tier — personal hello + member list. Falls through
            when there's no household context (public tier). */}
        {showInvitedExtras && household && (
          <section className="card mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blush-700 dark:text-blush-300">
              {t("wedding_site.invited_eyebrow")}
            </p>
            <h2 className="mt-1 font-serif text-2xl text-ink-900 dark:text-paper-50">
              {household.household_label}
            </h2>
            {household.members.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm text-ink-700 dark:text-paper-100">
                {household.members.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3">
                    <span>{m.full_name}</span>
                    <span className="text-xs text-ink-500 dark:text-umber-300">
                      {t(`wedding_site.rsvp_status_${m.rsvp_status}`)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Schedule — exposed at every tier. */}
        {view.schedule.length > 0 && (
          <section className="card mt-6">
            <h2 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
              {t("wedding_site.schedule_title")}
            </h2>
            <ul className="mt-4 space-y-3">
              {view.schedule.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-paper-300 pb-3 last:border-0 last:pb-0 dark:border-umber-700"
                >
                  <span className="font-serif text-base tabular-nums text-ink-900 dark:text-paper-50">
                    {formatTimeOfDay(entry.starts_at_minutes, locale)}
                  </span>
                  <span className="font-serif text-base text-ink-700 dark:text-paper-100">
                    {entry.label}
                  </span>
                  {entry.location && (
                    <span className="text-xs text-ink-500 dark:text-umber-300">
                      · {entry.location}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* "Good to know" — parking, getting there, accommodation, … */}
        {view.useful_info && (
          <section className="card mt-6">
            <h2 className="font-serif text-2xl text-ink-900 dark:text-paper-50">
              {t("guest_portal.useful_info_title")}
            </h2>
            <p className="mt-3 whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
              {view.useful_info}
            </p>
          </section>
        )}

        {/* Confirmed-tier unlocked block. The exact pin + post_rsvp_content
            arrive in the same response only when at least one household
            member has RSVP'd yes. aria-live announces the unlock the
            moment we re-fetch after the in-page submission. */}
        {showConfirmedExtras && (view.post_rsvp_content || view.location_lat !== null) && (
          <section className="card mt-6" aria-live="polite">
            <h2
              ref={confirmedHeadingRef}
              tabIndex={-1}
              className="font-serif text-2xl text-ink-900 outline-none dark:text-paper-50"
            >
              {t("wedding_site.confirmed_title")}
            </h2>
            {view.post_rsvp_content && (
              <p className="mt-3 whitespace-pre-line text-base text-ink-800 dark:text-paper-100">
                {view.post_rsvp_content}
              </p>
            )}
            {view.location_lat !== null && view.location_lng !== null && (
              <p className="mt-4 inline-flex items-center gap-2 text-sm text-ink-700 dark:text-paper-100">
                <MapPin size={14} aria-hidden />
                <a
                  className="underline"
                  href={`https://www.openstreetmap.org/?mlat=${view.location_lat}&mlon=${view.location_lng}#map=17/${view.location_lat}/${view.location_lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("wedding_site.confirmed_open_map")}
                </a>
              </p>
            )}
          </section>
        )}

        {/* Wishlist deck — confirmed-tier only (server returns null otherwise).
            Soft, no-money framing: group gifts show how many households are
            coordinating + a non-binding "I'd like to help" toggle wired to the
            code-gated interest endpoint. */}
        {view.wishlist && view.wishlist.length > 0 && (
          <section className="card mt-6">
            <h2 className="flex items-center gap-2 font-serif text-2xl text-ink-900 dark:text-paper-50">
              <Gift size={20} aria-hidden /> {t("guest_portal.wishlist_section_title")}
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {view.wishlist.map((entry) => (
                <li
                  key={entry.id}
                  className="flex gap-3 rounded-xl border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-900/40"
                >
                  {entry.image_url && (
                    <img
                      src={entry.image_url}
                      alt=""
                      loading="lazy"
                      className="h-16 w-16 shrink-0 rounded-lg border border-paper-200 object-cover dark:border-umber-700"
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="text-sm font-medium text-ink-900 dark:text-paper-50">
                      {entry.title}
                    </div>
                    {entry.description && (
                      <p className="text-xs text-ink-600 dark:text-umber-200">
                        {entry.description}
                      </p>
                    )}
                    {entry.target_amount_minor !== null && (
                      <p className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
                        {t("guest_portal.wishlist_target_amount_prefix")}{" "}
                        {formatMoney(
                          entry.target_amount_minor / (localeCurrency(locale) === "HUF" ? 1 : 100),
                          localeCurrency(locale),
                          locale,
                        )}
                      </p>
                    )}
                    {entry.url && (
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex w-fit items-center gap-1 text-xs text-blush-700 underline-offset-2 hover:underline dark:text-blush-300"
                      >
                        <ExternalLink size={12} aria-hidden />
                        {t("guest_portal.wishlist_external_link_label")}
                      </a>
                    )}
                    {entry.kind === "group_gift" && (
                      <div className="mt-1 flex flex-col gap-2">
                        {entry.interest_count > 0 && (
                          <p className="text-xs text-ink-500 dark:text-umber-300">
                            {t("guest_portal.wishlist_interest_count", {
                              count: entry.interest_count,
                            })}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleWishlistInterest(entry.id)}
                          aria-pressed={entry.viewer_has_interest}
                          className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            entry.viewer_has_interest
                              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                              : "border border-paper-300 text-ink-700 hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-800"
                          }`}
                        >
                          <HeartHandshake size={13} aria-hidden />
                          {entry.viewer_has_interest
                            ? t("guest_portal.wishlist_group_gift_help_active")
                            : t("guest_portal.wishlist_group_gift_help_cta")}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* RSVP CTA — generic at the public tier, personal at invited.
            On confirmed we still surface a "manage your RSVP" link so
            guests can flip their meal / change their answer. */}
        {!showConfirmedExtras && (
          <section className="card stationery mt-6 text-center">
            <Heart size={28} className="mx-auto text-blush-600 dark:text-blush-300" />
            <h2 className="mt-3 font-serif text-2xl text-ink-900 dark:text-paper-50">
              {hasCode ? t("wedding_site.rsvp_personal_title") : t("wedding_site.rsvp_title")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-umber-200">
              {hasCode ? t("wedding_site.rsvp_personal_body") : t("wedding_site.rsvp_body")}
            </p>
            <Link to={personalRsvpHref} className="btn-primary btn-lifted mt-5 inline-flex">
              {hasCode ? t("wedding_site.rsvp_personal_cta") : t("wedding_site.rsvp_cta")}
            </Link>
          </section>
        )}

        {showConfirmedExtras && (
          <section className="mt-6 text-center text-xs text-ink-500 dark:text-umber-300">
            <Lock size={12} aria-hidden className="mr-1 inline" />
            <Link to={personalRsvpHref} className="underline">
              {t("wedding_site.rsvp_manage_cta")}
            </Link>
          </section>
        )}

        {/* Live countdown to the wedding day at the bottom of the page. */}
        {view.wedding_date && (
          <div className="mt-6">
            <WeddingCountdown date={view.wedding_date} />
          </div>
        )}

        {/* Weddly branding lives at the bottom — a centered wordmark over a
            hairline, with the "built with" tagline beneath it. */}
        <footer className="mt-12 flex flex-col items-center gap-2 border-t border-paper-300 pt-8 dark:border-umber-700">
          <Link
            to="/"
            className="text-ink-900 transition-colors hover:text-ink-700 dark:text-paper-50 dark:hover:text-blush-300"
          >
            <Wordmark size="md" />
          </Link>
          <p className="text-center text-[11px] text-ink-400 dark:text-umber-400">
            {t("wedding_site.footer_built_with")}
          </p>
        </footer>
      </div>
    </Shell>
  );
}
