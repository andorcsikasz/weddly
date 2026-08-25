// Category × city SEO landing pages: /eskuvoi-szolgaltatok/:categorySlug/:citySlug
// (HU) and /wedding-vendors/:categorySlug/:citySlug (EN). Both mount this
// same component — the visitor's locale (from the switcher / the SSR
// data-default-locale for a first visit, see localeForPath in seo_ssr.ts)
// picks which copy renders, same pattern as the /eszkozok/* vs /tools/*
// tool pages.
//
// The slugs are resolved server-side (GET /api/public/vendor-locations/...)
// into the real category + exact city string + country, then the actual
// listings come from the SAME `CatalogueGrid` the general /suppliers/browse
// catalogue uses (exported from VendorBrowsePage.tsx) — one grid, one
// pagination, one "load more", not a second copy for this page.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supplierCategoryLabel, type SupplierCategory } from "@shared/suppliers";
import { CatalogueGrid } from "./VendorBrowsePage";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { contentLocale, useT } from "../lib/i18n";
import { useDocumentMetaLiteral } from "../lib/seo";
import { supplierApi } from "../lib/endpoints";

interface ResolvedLocation {
  category: SupplierCategory;
  city: string;
  country: string;
  count: number;
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0]!.toLowerCase() + s.slice(1) : s;
}

export default function CategoryCityLandingPage() {
  const { t, locale } = useT();
  const params = useParams<{ categorySlug: string; citySlug: string }>();
  const categorySlug = params.categorySlug ?? "";
  const citySlug = params.citySlug ?? "";

  const [resolved, setResolved] = useState<ResolvedLocation | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setResolved(null);
    setNotFound(false);
    supplierApi
      .vendorLocation(categorySlug, citySlug)
      .then((r) => {
        if (cancelled) return;
        setResolved(r);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
          return;
        }
        setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [categorySlug, citySlug]);

  // Narrowed to hu/en: only these two URL prefixes exist, and
  // `supplierCategoryLabel` doesn't know es/hr/de — an es/hr/de visitor sees
  // the EN copy here, same "EN is the default everywhere" rule the rest of
  // the app follows.
  const loc = contentLocale(locale);
  const categoryLabel = resolved ? supplierCategoryLabel(resolved.category, loc) : "";
  const categoryLower = lowerFirst(categoryLabel);
  const title = resolved
    ? loc === "hu"
      ? `Esküvői ${categoryLower} · ${resolved.city}`
      : `Wedding ${categoryLower} · ${resolved.city}`
    : "";
  const intro = resolved
    ? loc === "hu"
      ? `${resolved.count} esküvői szolgáltató a(z) ${categoryLabel} kategóriában, ${resolved.city} térségében. Fotók, árfekvés és elérhetőség egy helyen, regisztráció nélkül böngészhető.`
      : `${resolved.count} wedding ${categoryLower} listings in ${resolved.city}. Photos, price bands and contact details in one place, no signup needed to browse.`
    : "";

  useDocumentMetaLiteral(
    resolved ? `${title} | Wēddly` : t("vendorLocation.notFoundTitle"),
    resolved ? intro : t("vendorLocation.notFoundBody"),
  );

  if (notFound) {
    return (
      <PublicShell>
        <div className="mx-auto max-w-2xl px-4 py-24 text-center sm:px-6">
          <h1 className="font-grotesk text-3xl italic text-ink-900 dark:text-paper-50">
            {t("vendorLocation.notFoundTitle")}
          </h1>
          <p className="mt-3 text-ink-600 dark:text-umber-200">
            {t("vendorLocation.notFoundBody")}
          </p>
          <Link
            to="/suppliers/browse"
            className="mt-6 inline-flex rounded-full bg-ink-900 px-5 py-2.5 text-sm font-medium text-paper-50 transition hover:bg-ink-800 dark:bg-paper-100 dark:text-ink-900"
          >
            {t("publicVendor.browseCta")}
          </Link>
        </div>
      </PublicShell>
    );
  }

  return (
    <PublicShell>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          {resolved ? (
            <>
              <h1 className="font-grotesk text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl">
                {title}
              </h1>
              <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
                {intro}
              </p>
            </>
          ) : (
            <div className="space-y-3">
              <div className="h-10 w-2/3 animate-pulse rounded-lg bg-paper-200 dark:bg-umber-800" />
              <div className="h-5 w-full animate-pulse rounded-lg bg-paper-200 dark:bg-umber-800" />
            </div>
          )}
        </div>
      </section>
      {resolved && (
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
            <CatalogueGrid
              category={resolved.category}
              city={resolved.city}
              country={resolved.country}
              t={t}
            />
          </div>
        </section>
      )}
    </PublicShell>
  );
}
