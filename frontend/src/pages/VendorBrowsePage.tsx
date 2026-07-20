// Public, unauthenticated "browse teaser" at `/vendors/browse`. A photos-only
// sample of the directory (max 6 per category from GET /api/public/vendor-
// showcase), deliberately stripped of the in-app directory's search / filters /
// save / contact. The whole point is acquisition: a couple gets a real taste,
// then registers to unlock the full directory; a vendor seeing it is nudged to
// get listed. Data: publicShowcase + the real couples count from publicStats.

import type { PublicShowcaseCategory, PublicShowcaseVendor } from "@shared/suppliers";
import { ArrowRight } from "lucide-react";
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

// Frameless by design: the photo IS the card. A border + surface + shadow
// around every tile turned 90 vendors into 90 boxes; dropping the chrome lets
// the photography carry the page and the caption sit on the page background,
// the way a marketplace feed reads.
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
      className="group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:focus-visible:ring-paper-100"
    >
      <div className="aspect-[3/2] w-full overflow-hidden rounded-2xl bg-paper-200 dark:bg-umber-700">
        {/* Endpoint only returns entries with a hero photo, so src is always set. */}
        <img
          src={hero}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
        />
      </div>
      <p className="mt-2 truncate text-sm font-medium text-ink-900 dark:text-paper-100">{name}</p>
      {/* One muted line, no pin icon: the city and category are the only two
          facts worth carrying at this size. */}
      <p className="truncate text-xs text-ink-500 dark:text-umber-300">
        {city ? `${city} · ${categoryLabel}` : categoryLabel}
      </p>
    </Link>
  );
}

// Planners are a different relationship from vendors: a couple invites them into
// their workspace (via /planners) rather than cold-contacting them from a
// catalog. So the wedding_planner listings get pulled out of the vendor grid and
// reframed here — discoverable, but clearly "collaborator", not "directory card".
function PlannerInviteModule({
  t,
  vendors,
}: {
  t: (k: string) => string;
  vendors: PublicShowcaseVendor[];
}) {
  return (
    // A hairline and air instead of a tinted box: this is a different KIND of
    // relationship, not a promo panel, and the surrounding page is already all
    // photography — one more filled container just added weight.
    <section className="border-t border-paper-200 pt-8 dark:border-umber-700">
      <div className="sm:flex sm:items-start sm:justify-between sm:gap-8">
        <div className="max-w-xl">
          <span className="text-xs font-medium uppercase tracking-widest text-ink-400 dark:text-umber-400">
            {t("vendorBrowse.planner_badge")}
          </span>
          <h2 className="mt-2 font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("vendorBrowse.planner_title")}
          </h2>
          <p className="mt-2 text-ink-600 dark:text-umber-200">{t("vendorBrowse.planner_body")}</p>
          <Link
            to="/planners"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 underline-offset-4 hover:underline dark:text-paper-100"
          >
            {t("vendorBrowse.planner_cta")}
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        {vendors.length > 0 && (
          <div className="mt-6 sm:mt-0 sm:max-w-[16rem]">
            <p className="mb-2 text-xs uppercase tracking-widest text-ink-400 dark:text-umber-400">
              {t("vendorBrowse.planner_featured")}
            </p>
            <ul className="flex flex-wrap gap-2 sm:justify-end">
              {vendors.map((v) => (
                <li key={v.id}>
                  <Link
                    to={`/vendors/${encodeURIComponent(v.id)}`}
                    className="inline-block rounded-full border border-paper-300 bg-paper-50 px-3 py-1 text-xs text-ink-700 transition hover:border-paper-400 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-200"
                  >
                    {v.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
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
  // Pull planners out of the vendor grid — they get their own reframed module.
  const plannerCat = categories?.find((c) => c.category === "wedding_planner") ?? null;
  const gridCategories = categories?.filter((c) => c.category !== "wedding_planner") ?? [];

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
      <TopBar t={t} />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-8 pt-12 sm:px-6 sm:pt-16 lg:px-8">
        <h1 className="max-w-3xl font-grotesk text-4xl tracking-tight text-ink-900 sm:text-5xl dark:text-paper-50">
          {t("vendorBrowse.title")}
        </h1>
        <p className="mt-4 max-w-xl text-ink-600 dark:text-umber-200">
          {t("vendorBrowse.subtitle")}
        </p>
        {/* The live-couples number is proof, not a badge. A pill with its own
            border and tint competed with the headline; a plain line with one
            dot says the same thing and lets the photos start sooner. */}
        {showCouples && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-500 dark:text-umber-300">
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
                      className="aspect-[3/2] animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800"
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
            {gridCategories.map((c) => (
              <section key={c.category}>
                <h2 className="mb-3 font-grotesk text-base font-semibold text-ink-900 dark:text-paper-100">
                  {t(`suppliers.cat.${c.category}`)}
                </h2>
                {/* Phone: one swipeable row per category, snapping card by card.
                    Fifteen categories × three rows of a 2-col grid was a page
                    you scrolled for a minute; a row you flick through is both
                    shorter and closer to how a marketplace feed behaves.
                    sm+ keeps the grid, where the horizontal space is real. */}
                <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-6">
                  {c.vendors.map((v) => (
                    <div key={v.id} className="w-[46vw] shrink-0 snap-start sm:w-auto">
                      <VendorCard
                        id={v.id}
                        name={v.name}
                        city={v.city}
                        categoryLabel={t(`suppliers.cat.${v.category}`)}
                        hero={v.hero_image_url}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {plannerCat && <PlannerInviteModule t={t} vendors={plannerCat.vendors} />}
          </div>
        )}

        {/* Conversion band: couples primary, vendors secondary (audit item 6).
            Solid ink rather than another tinted paper box — after a page of
            light photo rows the dark block is the one thing that stops the
            scroll, and it needs no border to do it. */}
        <div className="mt-16 rounded-3xl bg-ink-900 px-6 py-12 text-center dark:bg-umber-800">
          <h2 className="font-grotesk text-3xl tracking-tight text-paper-50">
            {t("vendorBrowse.convert_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-paper-200/80">{t("vendorBrowse.convert_sub")}</p>
          <div className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              to="/signup"
              className="inline-flex items-center gap-1.5 rounded-full bg-paper-50 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-white"
            >
              {t("vendorBrowse.cta_couple")}
              <ArrowRight size={15} aria-hidden />
            </Link>
            <Link
              to="/vendors/signup"
              className="text-sm font-medium text-paper-200/80 underline-offset-4 transition hover:text-paper-50 hover:underline"
            >
              {t("vendorBrowse.vendor_prompt")}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
