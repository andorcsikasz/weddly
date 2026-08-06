// Live "couple's view" of the vendor listing, rendered beside the editor in
// VendorListingPage. Purely presentational: it takes the in-progress form
// values (plus the locked listing name and current hero URL) and mirrors the
// compact card a couple sees in the public directory, so the vendor can watch
// edits land in real time. No data fetching, no endpoints; props only.
//
// Two deliberate departures from the couple-facing card, both because this card
// is rendered INSIDE the vendor portal:
//
//   - the text is the portal's steel scale, not the couple app's navy `ink`.
//     Ink leaking in here was the one cool-blue block on an otherwise
//     steel/blush page.
//   - the capacity pill carries a lucide glyph rather than the 👥 emoji it used
//     to. An emoji is a different typeface picked by the OS: it renders at a
//     different weight on every platform and cannot take the pill's colour.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { VerifiedBadge } from "../../components/VerifiedBadge";
import { fireConfetti } from "../../lib/confetti";
import { useT } from "../../lib/i18n";

interface VendorListingPreviewProps {
  name: string;
  heroUrl: string | null;
  city: string;
  /** "1".."5" or "" (same string the editor binds to form.price_band). */
  priceBand: string;
  capacityMin: string;
  capacityMax: string;
  /** Locale-appropriate blurb snippet, already chosen by the parent. */
  blurb: string;
  /** Setup checklist finished → the badge fills in. Same `listingChecklistFor`
   *  verdict the server puts on `DirectorySupplier.listing_complete`, so what
   *  the vendor previews is what the couple gets. */
  complete: boolean;
}

/** How long the earn choreography runs. Matches `badge-earn` / `badge-halo` in
 *  tailwind.config.js — the class is removed after it, so the celebration can
 *  play again if the vendor empties a section and fills it back in. */
const BADGE_EARN_MS = 720;

/** Five euro glyphs, the first `level` of them inked and the rest muted: the
 *  same affordance the couple sees in the directory price filter. */
function PriceGlyphs({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={
            n <= level
              ? "text-sm font-semibold text-blush-600 dark:text-paper-400"
              : "text-sm font-semibold text-paper-300 dark:text-umber-700"
          }
        >
          €
        </span>
      ))}
    </span>
  );
}

/** The verified check, plus the one moment it is worth watching: the instant it
 *  goes from outline to solid. Confetti fires FROM the badge (not the viewport
 *  centre) so the celebration points at the thing that changed, and the badge
 *  itself pops out of a fading halo.
 *
 *  A listing that was already complete on arrival never animates: it was
 *  finished last week, and replaying the moment would be a lie. Same rule the
 *  setup checklist follows for its rows. */
function EarnableBadge({ complete }: { complete: boolean }): ReactNode {
  const [earning, setEarning] = useState(false);
  // null until the first render has been recorded, so mount is never a
  // transition. Deliberately a ref: this must not itself cause a render.
  const wasComplete = useRef<boolean | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const prev = wasComplete.current;
    wasComplete.current = complete;
    if (prev === null || prev || !complete) return;

    const box = anchor.current?.getBoundingClientRect();
    // fireConfetti is already a no-op under prefers-reduced-motion, and so is
    // the animation (motion-reduce:animate-none below) — the badge still fills,
    // it just fills quietly.
    fireConfetti(box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined);
    setEarning(true);
    const timer = window.setTimeout(() => setEarning(false), BADGE_EARN_MS);
    return () => window.clearTimeout(timer);
  }, [complete]);

  return (
    <span ref={anchor} className="relative inline-flex shrink-0 items-center">
      {earning && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1 animate-badge-halo rounded-full ring-2 ring-verified motion-reduce:hidden"
        />
      )}
      <span className={earning ? "inline-flex animate-badge-earn motion-reduce:animate-none" : ""}>
        <VerifiedBadge complete={complete} />
      </span>
    </span>
  );
}

export default function VendorListingPreview({
  name,
  heroUrl,
  city,
  priceBand,
  capacityMin,
  capacityMax,
  blurb,
  complete,
}: VendorListingPreviewProps) {
  const { t } = useT();
  const level = (() => {
    const n = Number(priceBand);
    return priceBand.trim().length === 0 || !Number.isFinite(n) ? 0 : Math.max(1, Math.min(5, n));
  })();

  const capacityLabel = (() => {
    const min = capacityMin.trim();
    const max = capacityMax.trim();
    if (min && max) return `${min}-${max}`;
    if (min) return t("vendor_home.preview_capacity_from", { min });
    if (max) return t("vendor_home.preview_capacity_upto", { max });
    return "";
  })();

  return (
    <article className="overflow-hidden rounded-2xl bg-paper-50 ring-1 ring-paper-300 dark:bg-umber-900 dark:ring-umber-700">
      <div className="aspect-[3/2] w-full overflow-hidden bg-paper-100 dark:bg-umber-800">
        {heroUrl ? (
          <img src={heroUrl} alt={name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="px-4 text-center text-xs text-steel-500 dark:text-umber-400">
              {t("vendor_home.preview_no_photo")}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The badge sits beside the name exactly as it does on the public
                card, so the vendor is looking at their own check rather than
                reading a percentage about it somewhere else. */}
            <h3 className="flex items-center gap-1.5 font-grotesk text-base text-steel-900 dark:text-paper-100">
              <span className="truncate">{name}</span>
              <EarnableBadge complete={complete} />
            </h3>
            {city.trim().length > 0 && (
              <p className="mt-0.5 truncate text-xs text-steel-600 dark:text-umber-300">{city}</p>
            )}
          </div>
          {level > 0 && <PriceGlyphs level={level} />}
        </div>

        {blurb.trim().length > 0 && (
          <p className="line-clamp-3 text-sm text-steel-700 dark:text-umber-200">{blurb}</p>
        )}

        {capacityLabel && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-paper-100 px-2.5 py-1 text-xs text-steel-700 ring-1 ring-paper-300 dark:bg-blush-500/15 dark:text-paper-300 dark:ring-umber-700">
            <Users size={12} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            {t("vendor_home.preview_capacity_guests", { range: capacityLabel })}
          </p>
        )}
      </div>
    </article>
  );
}
