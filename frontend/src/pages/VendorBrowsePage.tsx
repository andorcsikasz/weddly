// Public, unauthenticated "browse teaser" at `/vendors/browse`. A photos-only
// sample of the directory (max 6 per category from GET /api/public/vendor-
// showcase), deliberately stripped of the in-app directory's search / filters /
// save / contact. The whole point is acquisition: a couple gets a real taste,
// then registers to unlock the full directory; a vendor seeing it is nudged to
// get listed. Data: publicShowcase + the real couples count from publicStats.
//
// Visual direction (2026-07-24): the page reads like a marketplace app rather
// than a brochure — near-black chrome on the warm paper ground, one heavy tight
// grotesque, photography carrying everything else. Three structural moves do
// the work:
//   1. A sticky category rail under the header that BOTH jumps to a section and
//      scroll-spies the one you're in. Fifteen headings stacked down the page
//      were a minute of scrolling with no map; now they're a browsable index.
//   2. Every category is a snap rail at every breakpoint (chevron scrubbers
//      from lg up), so a card is a real photo instead of a 176px thumbnail.
//   3. A floating sign-up pill on phones once you're past the hero, hidden
//      again when the closing CTA comes into view so it never doubles up.
// The verified check is the only colour on the page. That restraint is the
// point: one accent, everything else is ink, paper and photographs.

import { countryName } from "@shared/country_list";
import type {
  PublicShowcaseCategory,
  PublicShowcaseVendor,
  SupplierCategory,
  SupplierCountryCount,
} from "@shared/suppliers";
import { ArrowRight, ArrowUpRight, BadgeCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CountryPicker } from "../components/CountryPicker";
import { Wordmark } from "../components/Wordmark";
import { CATEGORY_ICON } from "../lib/category_icons";
import { publicStatsApi, supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

type T = (key: string, vars?: Record<string, string | number>) => string;

// Below this many real couples the demand-side line reads as thin, so we hide
// it rather than undersell — honest either way (audit item 8: no fabricated
// numbers).
const MIN_COUPLES_TO_SHOW = 15;

// Height of the stacked sticky chrome (header 64px + category rail ~59px) plus
// a little air. Single-sourced: it sets the sections' scroll-margin, and the
// scroll-spy band starts at the same line, so a chip jump and the highlight it
// produces always agree.
const STICKY_OFFSET = 140;

const sectionDomId = (category: string) => `cat-${category}`;

/** Programmatic scrolls respect the OS motion preference — `scroll-behavior:
 *  smooth` on <html> covers CSS-driven scrolling, but not these. */
function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || !window.matchMedia) return "smooth";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function TopBar({ t }: { t: T }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-900/10 bg-paper-50/80 backdrop-blur-xl dark:border-paper-50/10 dark:bg-umber-900/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="Weddly" className="inline-flex items-center">
          <Wordmark size="sm" className="text-ink-900 dark:text-paper-50" />
        </Link>
        {/* Two CTAs share the right cluster: couples sign up (the black pill),
            vendors get listed (a quiet text link that only fills on hover). The
            vendor link is sm+ only so the phone header keeps one action. */}
        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            to="/vendors/signup"
            className="hidden rounded-full px-4 py-2.5 text-sm font-medium tracking-tight text-ink-600 transition hover:bg-ink-900/[0.06] hover:text-ink-900 sm:inline-flex dark:text-paper-200 dark:hover:bg-paper-50/10 dark:hover:text-paper-50"
          >
            {t("vendorBrowse.cta_vendor")}
          </Link>
          <Link
            to="/signup"
            className="inline-flex items-center rounded-full bg-ink-900 px-5 py-2.5 text-sm font-semibold tracking-tight text-paper-50 transition hover:bg-ink-950 dark:bg-paper-100 dark:text-ink-900 dark:hover:bg-paper-50"
          >
            {t("vendorBrowse.cta_couple")}
          </Link>
        </div>
      </div>
    </header>
  );
}

// The index. Sticks under the header, one chip per category, black when it is
// the section you're reading. Tapping jumps; scrolling re-selects; the rail
// keeps the active chip near its centre so the next categories are always the
// ones in reach.
function CategoryNav({
  categories,
  active,
  onJump,
  t,
}: {
  categories: SupplierCategory[];
  active: string | null;
  onJump: (category: string) => void;
  t: T;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const rail = railRef.current;
    const chip = active ? chipRefs.current[active] : null;
    if (!rail || !chip) return;
    // Measured against the rail's own box rather than offsetLeft: offsetParent
    // is whichever ancestor happens to be positioned, and that is not something
    // this component should depend on.
    const delta = chip.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    const target = rail.scrollLeft + delta - rail.clientWidth / 2 + chip.offsetWidth / 2;
    rail.scrollTo({ left: Math.max(0, target), behavior: scrollBehavior() });
  }, [active]);

  return (
    <nav
      aria-label={t("vendorBrowse.nav_categories")}
      className="sticky top-16 z-20 border-b border-ink-900/10 bg-paper-50/90 backdrop-blur-xl dark:border-paper-50/10 dark:bg-umber-900/90"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          ref={railRef}
          className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {categories.map((c) => {
            const Icon = CATEGORY_ICON[c];
            const on = active === c;
            return (
              <button
                key={c}
                type="button"
                ref={(el) => {
                  chipRefs.current[c] = el;
                }}
                onClick={() => onJump(c)}
                aria-current={on ? "true" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[13px] font-medium tracking-tight transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100 ${
                  on
                    ? "border-ink-900 bg-ink-900 text-paper-50 dark:border-paper-100 dark:bg-paper-100 dark:text-ink-900"
                    : "border-ink-900/15 text-ink-600 hover:border-ink-900/40 hover:text-ink-900 dark:border-paper-50/20 dark:text-paper-200 dark:hover:text-paper-50"
                }`}
              >
                <Icon size={14} aria-hidden />
                {t(`suppliers.cat.${c}`)}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

// Same band, same height, no chips yet: the rail is the tallest piece of
// chrome on the page, so rendering it only once the fetch lands shoved the
// whole grid down a frame after paint.
function SkeletonNav() {
  return (
    <div
      aria-hidden
      className="border-b border-ink-900/10 bg-paper-50/90 dark:border-paper-50/10 dark:bg-umber-900/90"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex gap-2 overflow-hidden py-3">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-[34px] w-28 shrink-0 animate-pulse rounded-full bg-paper-200 dark:bg-umber-800"
            />
          ))}
        </div>
      </div>
    </div>
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
  verified,
  verifiedLabel,
}: {
  id: string;
  name: string;
  city: string;
  categoryLabel: string;
  hero: string;
  /** Registered Weddly vendor — same blue check as the in-app directory. */
  verified: boolean;
  verifiedLabel: string;
}) {
  return (
    <Link
      to={`/vendors/${encodeURIComponent(id)}`}
      className="group block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 dark:focus-visible:ring-paper-100"
    >
      <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-paper-200 dark:bg-umber-700">
        {/* Endpoint only returns entries with a hero photo, so src is always set. */}
        <img
          src={hero}
          alt={name}
          loading="lazy"
          className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.06]"
        />
        {/* The affordance, not a label: on hover the card admits it opens a
            profile. Pointer-only, so nothing is hidden from touch or AT — the
            whole tile is one link either way. */}
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-3 right-3 grid h-9 w-9 translate-y-2 place-items-center rounded-full bg-paper-50 text-ink-900 opacity-0 shadow-soft transition duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100"
        >
          <ArrowUpRight size={16} strokeWidth={2.5} />
        </span>
      </div>
      <p className="mt-2.5 flex items-center gap-1 text-[15px] font-semibold tracking-tight text-ink-900 dark:text-paper-100">
        <span className="truncate">{name}</span>
        {verified && (
          <BadgeCheck
            size={15}
            aria-label={verifiedLabel}
            className="shrink-0 fill-verified stroke-white"
          />
        )}
      </p>
      {/* One muted line, no pin icon: the city and category are the only two
          facts worth carrying at this size. */}
      <p className="truncate text-[13px] text-ink-500 dark:text-umber-300">
        {city ? `${city} · ${categoryLabel}` : categoryLabel}
      </p>
    </Link>
  );
}

// One category = one snap rail, at every breakpoint. Six cards across a 6-col
// grid gave each vendor 176px of photograph; a rail gives them 280px and keeps
// the page short enough to scan. From lg the rail gets chevron scrubbers, which
// is the only way a mouse can drive a horizontal scroller comfortably.
function CategoryRow({
  category,
  label,
  vendors,
  t,
}: {
  category: SupplierCategory;
  label: string;
  vendors: PublicShowcaseVendor[];
  t: T;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const sync = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

  function page(direction: -1 | 1) {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: scrollBehavior() });
  }

  const arrow =
    "grid h-9 w-9 place-items-center rounded-full border border-ink-900/15 text-ink-900 transition hover:border-ink-900 disabled:pointer-events-none disabled:opacity-25 dark:border-paper-50/20 dark:text-paper-100";

  return (
    <section id={sectionDomId(category)} style={{ scrollMarginTop: STICKY_OFFSET }}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <h2 className="font-grotesk text-xl font-semibold tracking-[-0.02em] text-ink-900 sm:text-2xl dark:text-paper-50">
          {label}
        </h2>
        <div className="hidden gap-2 lg:flex">
          <button
            type="button"
            className={arrow}
            onClick={() => page(-1)}
            disabled={edges.start}
            aria-label={t("vendorBrowse.rail_prev")}
          >
            <ChevronLeft size={17} aria-hidden />
          </button>
          <button
            type="button"
            className={arrow}
            onClick={() => page(1)}
            disabled={edges.end}
            aria-label={t("vendorBrowse.rail_next")}
          >
            <ChevronRight size={17} aria-hidden />
          </button>
        </div>
      </div>
      {/* Cards bleed to the screen edge on phones so the row reads as swipeable
          without a scrollbar having to say so. `scroll-pl-4` is load-bearing:
          a mandatory snap container aligns the first card to its PADDING box,
          which silently ate the 16px inset and left the captions flush against
          the screen edge while the heading above them sat at 16. */}
      <div
        ref={railRef}
        onScroll={sync}
        className="-mx-4 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:scroll-pl-0 sm:px-0 lg:gap-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {vendors.map((v) => (
          <div
            key={v.id}
            className="w-[72vw] shrink-0 snap-start sm:w-[calc((100%-1.5rem)/3)] lg:w-[calc((100%-3rem)/4)]"
          >
            <VendorCard
              id={v.id}
              name={v.name}
              city={v.city}
              categoryLabel={t(`suppliers.cat.${v.category}`)}
              hero={v.hero_image_url}
              verified={v.verified}
              verifiedLabel={t("suppliers.verified_vendor")}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// Planners are a different relationship from vendors: a couple invites them into
// their workspace (via /planners) rather than cold-contacting them from a
// catalog. So the wedding_planner listings get pulled out of the vendor rails
// and reframed here — discoverable, but clearly "collaborator", not "directory
// card".
function PlannerInviteModule({ t, vendors }: { t: T; vendors: PublicShowcaseVendor[] }) {
  return (
    // A hairline and air instead of a tinted box: this is a different KIND of
    // relationship, not a promo panel, and the surrounding page is already all
    // photography — one more filled container just added weight.
    <section className="border-t border-ink-900/10 pt-10 dark:border-paper-50/10">
      <div className="sm:flex sm:items-start sm:justify-between sm:gap-10">
        <div className="max-w-xl">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400 dark:text-umber-400">
            {t("vendorBrowse.planner_badge")}
          </span>
          <h2 className="mt-3 font-grotesk text-2xl font-semibold tracking-[-0.03em] text-ink-900 sm:text-3xl dark:text-paper-50">
            {t("vendorBrowse.planner_title")}
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-500 dark:text-umber-200">
            {t("vendorBrowse.planner_body")}
          </p>
          <Link
            to="/planners"
            className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-ink-900/15 px-4 py-2.5 text-sm font-medium tracking-tight text-ink-900 transition hover:border-ink-900 dark:border-paper-50/20 dark:text-paper-100"
          >
            {t("vendorBrowse.planner_cta")}
            <ArrowRight size={15} aria-hidden />
          </Link>
        </div>
        {vendors.length > 0 && (
          <div className="mt-8 sm:mt-0 sm:max-w-[18rem]">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-400 dark:text-umber-400">
              {t("vendorBrowse.planner_featured")}
            </p>
            <ul className="flex flex-wrap gap-2 sm:justify-end">
              {vendors.map((v) => (
                <li key={v.id}>
                  <Link
                    to={`/vendors/${encodeURIComponent(v.id)}`}
                    className="inline-block rounded-full border border-ink-900/15 px-3 py-1.5 text-[13px] tracking-tight text-ink-700 transition hover:border-ink-900 hover:text-ink-900 dark:border-paper-50/20 dark:text-paper-200"
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

function LoadingRails() {
  return (
    <div className="space-y-10">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <div className="h-7 w-44 animate-pulse rounded-lg bg-paper-200 dark:bg-umber-800" />
          <div className="-mx-4 flex gap-3 px-4 sm:mx-0 sm:px-0 lg:gap-4">
            {[0, 1, 2, 3].map((j) => (
              <div
                key={j}
                className="w-[72vw] shrink-0 sm:w-[calc((100%-1.5rem)/3)] lg:w-[calc((100%-3rem)/4)]"
              >
                <div className="aspect-[3/2] animate-pulse rounded-2xl bg-paper-200 dark:bg-umber-800" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function VendorBrowsePage() {
  const { t, locale } = useT();
  useDocumentMeta("vendorBrowse.title", "vendorBrowse.subtitle");
  const [categories, setCategories] = useState<PublicShowcaseCategory[] | null>(null);
  const [couples, setCouples] = useState<number | null>(null);
  // null = every country. The server still ranks the visitor's own country
  // first in that case, so "Mind" isn't a random pile.
  const [country, setCountry] = useState<string | null>(null);
  // Counted server-side over the whole eligible sample, so the picker keeps
  // every country listed once one is selected (a client-side count would drop
  // to just the filtered country and strand the visitor there).
  const [countries, setCountries] = useState<SupplierCountryCount[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [showPill, setShowPill] = useState(false);
  const closingRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    setCategories(null);
    supplierApi
      .publicShowcase(country)
      .then((r) => {
        if (cancelled) return;
        setCategories(r.categories);
        if (r.countries.length > 0) setCountries(r.countries);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  useEffect(() => {
    let cancelled = false;
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
  // Pull planners out of the vendor rails — they get their own reframed module.
  const plannerCat = categories?.find((c) => c.category === "wedding_planner") ?? null;
  const gridCategories = categories?.filter((c) => c.category !== "wedding_planner") ?? [];
  const navCategories = gridCategories.map((c) => c.category);
  const navKey = navCategories.join(",");

  // Scroll-spy for the sticky rail. The observer watches a thin band starting
  // right under the sticky chrome — whichever section crosses it is the one
  // being read, and in DOM order so overlaps resolve to the upper section.
  useEffect(() => {
    const ids = navKey ? navKey.split(",") : [];
    if (ids.length === 0) {
      setActiveCat(null);
      return;
    }
    setActiveCat((prev) => (prev && ids.includes(prev) ? prev : (ids[0] ?? null)));
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^cat-/, "");
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const first = ids.find((id) => visible.has(id));
        if (first) setActiveCat(first);
      },
      { rootMargin: `-${STICKY_OFFSET}px 0px -55% 0px`, threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(sectionDomId(id));
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [navKey]);

  // The phone sign-up pill: on once you're past the hero, off again as soon as
  // the closing CTA is on screen so the same action never appears twice.
  useEffect(() => {
    let frame = 0;
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const closing = closingRef.current;
        const closingAway =
          !closing || closing.getBoundingClientRect().top > window.innerHeight - 40;
        setShowPill(window.scrollY > 520 && closingAway);
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  function jumpTo(category: string) {
    setActiveCat(category);
    document
      .getElementById(sectionDomId(category))
      ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-umber-900">
      <TopBar t={t} />

      {/* Hero. Short on purpose: on a marketplace the fastest route to trust is
          the catalogue itself, so it is two rows deep and the photos start well
          within the first screen. Row one is the headline alone; row two pairs
          the intro with the controls instead of stacking a third block under
          it, which is where most of the vertical was going. */}
      <section className="mx-auto max-w-7xl px-4 pb-5 pt-8 sm:px-6 sm:pb-7 sm:pt-11 lg:px-8">
        {/* Sized to set on ONE line in every locale, which is what the width
            cap used to prevent: 6.5vw keeps the longest string (ES, "Explora
            proveedores de bodas") inside the content box at every width down to
            ~490px, where the 2rem floor takes over and phones wrap as they
            should. leading-[1.05] rather than tighter because Hungarian sets
            ő/á up top, and at 1 the accents touch the line above on a wrap. */}
        <h1 className="text-balance font-grotesk text-[clamp(2rem,6.5vw,4.25rem)] font-semibold leading-[1.05] tracking-[-0.04em] text-ink-900 dark:text-paper-50">
          {t("vendorBrowse.title")}
        </h1>

        {/* The intro and the one control row share a line from lg: the country
            filter, and the live-couples number as proof rather than a badge.
            The filter only earns its space once the catalogue actually spans
            more than one country. */}
        <div className="mt-4 flex flex-col gap-4 sm:mt-5 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <p className="max-w-xl text-[15px] leading-relaxed text-ink-500 dark:text-umber-200">
            {t("vendorBrowse.subtitle")}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 lg:shrink-0">
            {countries.length > 1 && (
              <CountryPicker
                value={country}
                onChange={setCountry}
                tone="ink"
                allLabel={t("suppliers.country_filter_all")}
                ariaLabel={t("suppliers.country_filter_label")}
                options={countries.map((c) => ({
                  code: c.code,
                  label: countryName(c.code, locale === "hu" ? "hu" : "en"),
                  count: c.count,
                }))}
              />
            )}
            {showCouples && (
              <p className="flex items-center gap-2 text-[13px] text-ink-500 dark:text-umber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-sage-500" aria-hidden />
                {t("vendorBrowse.couples_stat", { count: String(couples) })}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* The rail and the rails it indexes share one box on purpose: `sticky` is
          bounded by its parent, so the index rides along for exactly as long as
          there are categories under it and then scrolls away on its own. No
          scroll listener, and no light bar stranded over the black closing
          slab. */}
      <div>
        {categories === null ? (
          <SkeletonNav />
        ) : navCategories.length > 1 ? (
          <CategoryNav categories={navCategories} active={activeCat} onJump={jumpTo} t={t} />
        ) : null}

        {/* Body */}
        <main className="mx-auto max-w-7xl px-4 pb-14 pt-6 sm:px-6 lg:px-8">
          {categories === null ? (
            <div aria-label={t("common.loading")}>
              <LoadingRails />
            </div>
          ) : categories.length === 0 ? (
            <p className="py-16 text-center text-[15px] text-ink-500 dark:text-umber-300">
              {t("vendorBrowse.empty")}
            </p>
          ) : (
            <div className="space-y-10">
              {gridCategories.map((c) => (
                <CategoryRow
                  key={c.category}
                  category={c.category}
                  label={t(`suppliers.cat.${c.category}`)}
                  vendors={c.vendors}
                  t={t}
                />
              ))}
              {plannerCat && <PlannerInviteModule t={t} vendors={plannerCat.vendors} />}
            </div>
          )}
        </main>
      </div>

      {/* Closing band: couples primary, vendors secondary (audit item 6). Full
          bleed and near-black — after a page of light photo rows, the one thing
          that can stop the scroll is the page changing colour entirely. */}
      <section ref={closingRef} className="bg-ink-950 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="mx-auto max-w-[17ch] font-grotesk text-[clamp(2rem,5vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-paper-50">
            {t("vendorBrowse.convert_title")}
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-paper-200/70">
            {t("vendorBrowse.convert_sub")}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-5 sm:flex-row">
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 rounded-full bg-paper-50 px-7 py-3.5 text-sm font-semibold tracking-tight text-ink-900 transition hover:bg-white"
            >
              {t("vendorBrowse.cta_couple")}
              <ArrowRight size={16} aria-hidden />
            </Link>
            <Link
              to="/vendors/signup"
              className="text-sm font-medium tracking-tight text-paper-200/70 underline-offset-4 transition hover:text-paper-50 hover:underline"
            >
              {t("vendorBrowse.vendor_prompt")}
            </Link>
          </div>
        </div>
      </section>

      {showPill && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:hidden">
          <Link
            to="/signup"
            className="pointer-events-auto inline-flex animate-fade-in-up items-center gap-2 rounded-full bg-ink-900 px-6 py-3.5 text-sm font-semibold tracking-tight text-paper-50 shadow-pop"
          >
            {t("vendorBrowse.cta_couple")}
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      )}
    </div>
  );
}
