// "Now the names" rail: a photographed sample of the vendor directory, shown
// right after the budget calculator has produced per-category numbers.
//
// The job is a registration lead, but framed as the couple-facing feature it
// actually is: you just decided what you'd spend on photo and decor, here are
// real photographers and florists, sign up to see all of them. Cards link to
// the public vendor profile, so the browse is real rather than a locked
// preview; the register button stays the one filled action.
//
// Data is GET /api/public/vendor-showcase, the same photos-only teaser feed
// /vendors/browse renders. Two honesty rules ride along:
//   - the headline count is the WHOLE eligible set (`countries[].count`, every
//     active listing with a hero photo), never the capped sample size;
//   - below MIN_COUNT_TO_SHOW we drop the number and keep the plain line, and
//     an empty / failed fetch drops the whole block.

import type { PublicVendorShowcase, PublicShowcaseVendor } from "@shared/suppliers";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supplierApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

/** Under this many photographed listings the count argues against us, so the
 *  line runs without it. The rail itself still shows real vendors. */
const MIN_COUNT_TO_SHOW = 40;

/** Cards in the rail. Enough to feel like a catalogue, few enough to stay one
 *  swipe on a phone. */
const RAIL_SIZE = 12;

/** Round-robin across categories so the rail reads as a directory (venue,
 *  photo, decor, music) instead of six pictures of the same barn. */
function interleave(showcase: PublicVendorShowcase): PublicShowcaseVendor[] {
  const out: PublicShowcaseVendor[] = [];
  const depth = Math.max(0, ...showcase.categories.map((c) => c.vendors.length));
  for (let i = 0; i < depth && out.length < RAIL_SIZE; i++) {
    for (const cat of showcase.categories) {
      const vendor = cat.vendors[i];
      if (vendor) out.push(vendor);
      if (out.length >= RAIL_SIZE) break;
    }
  }
  return out;
}

export function VendorDirectoryTeaser({
  signupHref = "/signup",
  onSignupClick,
}: {
  /** Register link, so a caller can carry its own draft params (the budget
   *  calculator passes guests + budget). */
  signupHref?: string;
  /** Fires before navigation, for callers that stash a draft first. */
  onSignupClick?: () => void;
}) {
  const { t } = useT();
  const [showcase, setShowcase] = useState<PublicVendorShowcase | null>(null);

  useEffect(() => {
    let cancelled = false;
    supplierApi
      .publicShowcase()
      .then((r) => {
        if (!cancelled) setShowcase(r);
      })
      .catch(() => {
        // Acquisition garnish, never block the calculator on it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!showcase) return null;
  const vendors = interleave(showcase);
  if (vendors.length === 0) return null;

  const catalogue = showcase.countries.reduce((n, c) => n + c.count, 0);
  const line =
    catalogue >= MIN_COUNT_TO_SHOW
      ? t("landing.demo_vendors_body", { n: catalogue })
      : t("landing.demo_vendors_body_plain");

  return (
    <div className="mt-10 border-t border-paper-300 pt-8 sm:mt-12 sm:pt-10 dark:border-umber-700">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h3 className="font-grotesk text-xl text-umber-900 sm:text-2xl dark:text-paper-50">
          {t("landing.demo_vendors_title")}
        </h3>
        <p className="text-sm text-umber-600 dark:text-umber-300">{line}</p>
      </div>

      {/* One swipeable row at every breakpoint: a card is a real photograph
          rather than a thumbnail, and the overflow itself says "there is more
          where this came from". */}
      {/* `scroll-pl-4` matches the bleed padding: without it the mandatory snap
          aligns the first card to the padding box and parks it flush against
          the screen edge, out of line with the heading above it. */}
      <div className="-mx-4 mt-5 flex snap-x snap-mandatory scroll-pl-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-pl-0 sm:px-0">
        {vendors.map((v) => (
          <Link
            key={v.id}
            to={`/vendors/${encodeURIComponent(v.id)}`}
            className="group w-40 shrink-0 snap-start rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 sm:w-48 dark:focus-visible:ring-paper-100"
          >
            <div className="relative aspect-[3/2] w-full overflow-hidden rounded-2xl bg-paper-200 dark:bg-umber-700">
              {/* The feed only returns entries with a hero photo. */}
              <img
                src={v.hero_image_url}
                alt={v.name}
                loading="lazy"
                className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-[1.06]"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute right-2 bottom-2 grid h-8 w-8 translate-y-2 place-items-center rounded-full bg-paper-50 text-ink-900 opacity-0 shadow-soft transition duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100"
              >
                <ArrowUpRight size={15} strokeWidth={2.5} />
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1 text-sm font-semibold tracking-tight text-ink-900 dark:text-paper-100">
              <span className="truncate">{v.name}</span>
              {v.verified && (
                <BadgeCheck
                  size={14}
                  aria-label={t("suppliers.verified_vendor")}
                  className="shrink-0 fill-verified stroke-white"
                />
              )}
            </p>
            <p className="truncate text-xs text-ink-500 dark:text-umber-300">
              {v.city
                ? `${v.city} · ${t(`suppliers.cat.${v.category}`)}`
                : t(`suppliers.cat.${v.category}`)}
            </p>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link to={signupHref} onClick={onSignupClick} className="btn-primary btn-lifted">
          {t("landing.demo_vendors_cta")}
        </Link>
        <Link
          to="/vendors/browse"
          className="text-sm font-medium text-umber-700 underline-offset-2 hover:underline dark:text-umber-200"
        >
          {t("landing.demo_vendors_browse")}
        </Link>
      </div>
    </div>
  );
}
