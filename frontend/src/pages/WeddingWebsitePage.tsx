// Public couple-branded landing page at `/w/:slug`. The thing the couple
// shares on Instagram and prints on save-the-dates. First-cut minimum:
// names + date + ceremony kind + schedule (if any) + a generic RSVP CTA
// pointing into the existing /rsvp lookup. Story / FAQ / registry sections
// come later — they need couple-authored content fields we haven't added
// to the schema yet.

import { Calendar, Heart, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { weddingWebsiteApi } from "../lib/endpoints";
import { formatDate } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { Shell } from "../components/Shell";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";

// `t` and `formatDate` are imported for use in the dynamic page H1 below;
// they're not part of the SEO title (which is keyed at the wedding_site
// block — no per-couple personalisation in the document title).

function formatTimeOfDay(minutes: number, locale: "hu" | "en"): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  // Same convention as schedule.ts on the in-app surface — HH:MM in HU,
  // h:mm AM/PM-ish in EN. Cheap implementation: pad and join, locale
  // only affects the separator choice.
  const hh = String(h).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return locale === "hu" ? `${hh}:${mm}` : `${hh}:${mm}`;
}

export default function WeddingWebsitePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { t, locale } = useT();
  const [view, setView] = useState<PublicWeddingWebsiteView | null>(null);
  const [error, setError] = useState<"not_found" | "network" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    weddingWebsiteApi
      .get(slug)
      .then((r) => {
        if (!cancelled) {
          setView(r.wedding);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setError("not_found");
        else setError("network");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // SEO meta is keyed; the in-page H1 still carries the dynamic
  // "{names} — {date}" string. Description points crawlers at the
  // RSVP entry point.
  useDocumentMeta("seo.wedding_site_title", "seo.wedding_site_description");

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

  const dateLine = view.wedding_date
    ? formatDate(view.wedding_date, locale)
    : t("wedding_site.date_tbd");

  return (
    <Shell>
      <div className="mx-auto max-w-3xl">
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
          {view.location_lat !== null && view.location_lng !== null && (
            <p className="mt-2 inline-flex items-center justify-center gap-2 text-xs text-ink-500 dark:text-umber-300">
              <MapPin size={14} aria-hidden />
              {t("wedding_site.venue_approx")}
            </p>
          )}
        </section>

        {/* Schedule — only shown if the couple authored one. Pure display,
            no per-guest schedule (that lives behind the household-code
            guest portal). */}
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

        {/* RSVP CTA — generic /rsvp lookup. Guests find their household by
            entering the slug+code from their save-the-date; we deliberately
            don't expose individual codes on the public page. */}
        <section className="card stationery mt-6 text-center">
          <Heart size={28} className="mx-auto text-blush-600 dark:text-blush-300" />
          <h2 className="mt-3 font-serif text-2xl text-ink-900 dark:text-paper-50">
            {t("wedding_site.rsvp_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-600 dark:text-umber-200">
            {t("wedding_site.rsvp_body")}
          </p>
          <Link
            to={`/rsvp?couple=${encodeURIComponent(view.couple_slug)}`}
            className="btn-primary btn-lifted mt-5 inline-flex"
          >
            {t("wedding_site.rsvp_cta")}
          </Link>
        </section>

        <p className="mt-8 text-center text-[11px] text-ink-400 dark:text-umber-400">
          {t("wedding_site.footer_built_with")}
        </p>
      </div>
    </Shell>
  );
}
