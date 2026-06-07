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
//
// The section stack itself lives in the shared <WeddingSiteView>, rendered
// identically here (live) and in the /app/guest-page editor preview, so the
// couple's preview matches what guests actually see.

import { Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { weddingWebsiteApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { Shell } from "../components/Shell";
import { WeddingSiteView } from "../components/WeddingSiteView";
import type {
  PublicWeddingHouseholdContext,
  PublicWeddingResponse,
  PublicWeddingTier,
  PublicWeddingWebsiteView,
} from "@shared/wedding_website";

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
      .catch((err: unknown) => {
        if (signal?.cancelled) return;
        if (err instanceof ApiError && err.status === 404) setError("not_found");
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
  function onToggleWishlistInterest(itemId: number, pledgedAmountMinor?: number | null) {
    if (!hasCode) return;
    const isPledge = pledgedAmountMinor !== undefined;
    const snapshot = view;
    setView((cur) => {
      if (!cur || !cur.wishlist) return cur;
      return {
        ...cur,
        wishlist: cur.wishlist.map((entry) => {
          if (entry.id !== itemId) return entry;
          if (isPledge) {
            // Optimistically join + show the typed amount; the server response
            // reconciles the pledged sum + count (we can't know the new total
            // here without the other households' pledges).
            return {
              ...entry,
              viewer_has_interest: true,
              viewer_pledged_amount_minor: pledgedAmountMinor ?? null,
            };
          }
          // Pure toggle: flip membership + count.
          return {
            ...entry,
            viewer_has_interest: !entry.viewer_has_interest,
            interest_count: entry.interest_count + (entry.viewer_has_interest ? -1 : 1),
          };
        }),
      };
    });
    weddingWebsiteApi
      .toggleWishlistInterest(slug, code, itemId, pledgedAmountMinor)
      .then((res) => {
        setView((cur) => {
          if (!cur || !cur.wishlist) return cur;
          return {
            ...cur,
            wishlist: cur.wishlist.map((entry) =>
              entry.id === itemId
                ? {
                    ...entry,
                    viewer_has_interest: res.viewer_has_interest,
                    interest_count: res.interest_count,
                    pledged_amount_minor: res.pledged_amount_minor,
                    viewer_pledged_amount_minor: res.viewer_pledged_amount_minor,
                  }
                : entry,
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
          <h1 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
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
          <h1 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("wedding_site.network_error_title")}
          </h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-umber-200">
            {t("wedding_site.network_error_body")}
          </p>
        </div>
      </Shell>
    );
  }

  // The personal RSVP CTA pre-fills slug + code so the guest doesn't
  // re-type their household number. After they submit, RsvpCheckinPage
  // navigates back here (`/w/:slug/:code`) — the parent component
  // re-renders and the effect above picks up the URL change.
  const rsvpHref = hasCode
    ? `/rsvp?couple=${encodeURIComponent(view.couple_slug)}&code=${encodeURIComponent(code)}&return=${encodeURIComponent(`/w/${view.couple_slug}/${code}`)}`
    : `/rsvp?couple=${encodeURIComponent(view.couple_slug)}`;

  return (
    // No app chrome on a guest-facing wedding site, and no Shell width cap — the
    // editorial layout is full-bleed (alternating light/dark bands run edge to
    // edge). A compact icon-only language toggle floats over the hero; the
    // Weddly brand lives in the footer.
    <div className="relative min-h-full">
      <div className="absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
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
      <WeddingSiteView
        view={view}
        household={household}
        tier={tier}
        locale={locale}
        hasCode={hasCode}
        rsvpHref={rsvpHref}
        onToggleWishlistInterest={onToggleWishlistInterest}
        confirmedHeadingRef={confirmedHeadingRef}
      />
    </div>
  );
}
