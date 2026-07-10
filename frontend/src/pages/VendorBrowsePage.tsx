// Public, unauthenticated "browse teaser" at `/vendors/browse`. A photos-only
// sample of the directory (max 6 per category from GET /api/public/vendor-
// showcase), deliberately stripped of the in-app directory's search / filters /
// save / contact. The whole point is acquisition: a couple gets a real taste,
// then registers to unlock the full directory; a vendor seeing it is nudged to
// get listed. Data: publicShowcase + the real couples count from publicStats.

import type { PublicShowcaseCategory } from "@shared/suppliers";
import { ArrowRight, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Wordmark } from "../components/Wordmark";
import { publicStatsApi, supplierApi } from "../lib/endpoints";
import { useDocumentMeta } from "../lib/seo";
import { useT } from "../lib/i18n";

// Below this many real couples the demand-side line reads as thin, so we hide
// it rather than undersell — honest either way (audit item 8: no fabricated
// numbers).
const MIN_COUPLES_TO_SHOW = 15;

function TopBar({ t }: { t: (k: string) => string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-paper-200 bg-paper-50/90 backdrop-blur dark:border-umber-700 dark:bg-umber-900/90">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Weddly" className="inline-flex items-center">
          <Wordmark size="sm" className="text-ink-900 dark:text-paper-50" />
        </Link>
        <Link
          to="/signup"
          className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900 dark:hover:bg-paper-200"
        >
          {t("vendorBrowse.cta_couple")}
        </Link>
      </div>
    </header>
  );
}

function VendorCard({
  id,
  name,
  city,
  categoryLabel,
  hero,
}: {
  id: string;
  name: string;
  city: string;
  categoryLabel: string;
  hero: string;
}) {
  return (
    <Link
      to={`/vendors/${encodeURIComponent(id)}`}
      className="group block overflow-hidden rounded-2xl border border-paper-200 bg-paper-50 transition hover:border-paper-300 hover:shadow-sm dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-paper-200 dark:bg-umber-700">
        {/* Endpoint only returns entries with a hero photo, so src is always set. */}
        <img
          src={hero}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      </div>
      <div className="p-3">
        <p className="truncate font-medium text-ink-900 dark:text-paper-100">{name}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-500 dark:text-umber-300">
          <MapPin size={11} aria-hidden />
          <span className="truncate">{city ? `${city} · ${categoryLabel}` : categoryLabel}</span>
        </p>
      </div>
    </Link>
  );
}

export default function VendorBrowsePage() {
  const { t } = useT();
  useDocumentMeta("vendorBrowse.title", "vendorBrowse.subtitle");
  const [categories, setCategories] = useState<PublicShowcaseCategory[] | null>(null);
  const [couples, setCouples] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    supplierApi
      .publicShowcase()
      .then((r) => {
        if (!cancelled) setCategories(r.categories);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    publicStatsApi
      .get()
      .then((r) => {
        if (!cancelled) setCouples(r.couples);
      })
      .catch(() => {
        /* stat is optional — the page works without it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showCouples = couples !== null && couples >= MIN_COUPLES_TO_SHOW;

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
      <TopBar t={t} />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-6 pt-10 sm:px-6 lg:px-8">
        <h1 className="max-w-2xl font-grotesk text-3xl text-ink-900 sm:text-4xl dark:text-paper-50">
          {t("vendorBrowse.title")}
        </h1>
        <p className="mt-3 max-w-2xl text-ink-600 dark:text-umber-200">
          {t("vendorBrowse.subtitle")}
        </p>
        {showCouples && (
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-sage-300 bg-sage-50 px-3 py-1 text-sm text-sage-700 dark:border-sage-400/40 dark:bg-sage-400/15 dark:text-sage-300">
            <span className="h-1.5 w-1.5 rounded-full bg-sage-500" aria-hidden />
            {t("vendorBrowse.couples_stat", { count: String(couples) })}
          </p>
        )}
      </section>

      {/* Body */}
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 lg:px-8">
        {categories === null ? (
          <div className="space-y-8" aria-label={t("common.loading")}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-3">
                <div className="h-5 w-40 animate-pulse rounded bg-paper-200 dark:bg-umber-800" />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[0, 1, 2, 3, 4, 5].map((j) => (
                    <div
                      key={j}
                      className="aspect-[4/3] animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <p className="rounded-2xl border border-paper-200 bg-paper-50 p-8 text-center text-ink-500 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300">
            {t("vendorBrowse.empty")}
          </p>
        ) : (
          <div className="space-y-10">
            {categories.map((c) => (
              <section key={c.category}>
                <h2 className="mb-3 font-grotesk text-lg text-ink-900 dark:text-paper-100">
                  {t(`suppliers.cat.${c.category}`)}
                </h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {c.vendors.map((v) => (
                    <VendorCard
                      key={v.id}
                      id={v.id}
                      name={v.name}
                      city={v.city}
                      categoryLabel={t(`suppliers.cat.${v.category}`)}
                      hero={v.hero_image_url}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {/* Conversion band: couples primary, vendors secondary (audit item 6). */}
        <div className="mt-14 rounded-3xl border border-paper-200 bg-paper-100/70 p-8 text-center dark:border-umber-700 dark:bg-umber-800/60">
          <h2 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("vendorBrowse.convert_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-ink-600 dark:text-umber-200">
            {t("vendorBrowse.convert_sub")}
          </p>
          <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-5 py-2.5 text-sm font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900 dark:hover:bg-paper-200"
            >
              {t("vendorBrowse.cta_couple")}
              <ArrowRight size={15} aria-hidden />
            </Link>
            <Link
              to="/vendors/signup"
              className="text-sm font-medium text-ink-700 underline-offset-4 hover:underline dark:text-paper-200"
            >
              {t("vendorBrowse.vendor_prompt")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
