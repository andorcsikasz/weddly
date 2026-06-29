// Live "couple's view" of the vendor listing, rendered beside the editor in
// VendorListingPage. Purely presentational: it takes the in-progress form
// values (plus the locked listing name and current hero URL) and mirrors the
// compact card a couple sees in the public directory, so the vendor can watch
// edits land in real time. No data fetching, no endpoints; props only.

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
}

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
              ? "text-sm font-semibold text-steel-600 dark:text-steel-300"
              : "text-sm font-semibold text-paper-300 dark:text-umber-700"
          }
        >
          €
        </span>
      ))}
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
            <span className="px-4 text-center text-xs text-ink-400 dark:text-umber-400">
              {t("vendor_home.preview_no_photo")}
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-grotesk text-base text-ink-900 dark:text-paper-100">
              {name}
            </h3>
            {city.trim().length > 0 && (
              <p className="mt-0.5 truncate text-xs text-ink-500 dark:text-umber-300">{city}</p>
            )}
          </div>
          {level > 0 && <PriceGlyphs level={level} />}
        </div>

        {blurb.trim().length > 0 && (
          <p className="line-clamp-3 text-sm text-ink-600 dark:text-umber-200">{blurb}</p>
        )}

        {capacityLabel && (
          <p className="inline-flex items-center gap-1 rounded-full bg-steel-50 px-2.5 py-1 text-xs text-steel-700 ring-1 ring-steel-200 dark:bg-steel-600/15 dark:text-steel-200 dark:ring-steel-600/40">
            <span aria-hidden="true">{"\u{1F465}"}</span>
            {t("vendor_home.preview_capacity_guests", { range: capacityLabel })}
          </p>
        )}
      </div>
    </article>
  );
}
