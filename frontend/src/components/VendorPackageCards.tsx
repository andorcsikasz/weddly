// Vendor listing "packages" (árajánlat) card grid, shared by the in-app
// SupplierDetailPage and the public PublicVendorPage so the two never drift.
//
// A package carries only free text (`price_text`, `description`) plus an
// optional PDF — vendors quote in wildly different shapes, so there is no
// structured spec schema to render (see shared/listing_packages.ts). This
// component turns that free text into a scannable card: a headline zone
// (name + a large, dominant price), a divider, and a specs zone where each
// "Label: value" line of the description becomes an icon + fact row. Icons
// are picked by keyword so the eye scans glyphs instead of reading
// sentences; anything unrecognised falls back to a neutral check.
//
// Only the 5 most decision-relevant specs show by default; the rest sit
// behind a per-card "See full details" toggle. One card in the row is
// flagged the recommended anchor (accent top bar + badge + a stronger
// lift), the way a pricing page highlights its default tier.

import type { ListingPackage } from "@shared/listing_packages";
import {
  Camera,
  Check,
  ChevronDown,
  Clock,
  FileText,
  Film,
  type LucideIcon,
  MapPin,
  Mic,
  Music,
  Sparkles,
  Users,
} from "lucide-react";
import { useState } from "react";

/** One parsed line of a package description. `label` is null for a plain
 *  feature line (no "Label: value" colon), in which case only `value` shows. */
interface Spec {
  label: string | null;
  value: string;
}

/** Keyword → icon rules, most-specific first (crew before photo so "2 fotós"
 *  reads as people, not a camera). Matched against the label, falling back to
 *  the value. HU + EN keywords. Anything unmatched gets a neutral check. */
const SPEC_ICON_RULES: { icon: LucideIcon; keywords: string[] }[] = [
  { icon: Film, keywords: ["videó", "video", "film", "reel", "klip", "clip", "highlight"] },
  {
    icon: Clock,
    keywords: [
      "szállítás",
      "delivery",
      "határidő",
      "turnaround",
      "átfutás",
      "hét",
      "week",
      "óra",
      "hour",
      "munkanap",
      "időtartam",
      "duration",
      "express",
      "expressz",
    ],
  },
  {
    icon: Users,
    keywords: [
      "stáb",
      "crew",
      "létszám",
      "fotós",
      "operatőr",
      "assistant",
      "asszisztens",
      "segéd",
      "people",
      "person",
      "team",
      "csapat",
      "vendég",
      "guest",
      "pax",
    ],
  },
  {
    icon: Camera,
    keywords: [
      "fotó",
      "photo",
      "kép",
      "picture",
      "portré",
      "portrait",
      "retus",
      "retouch",
      "felvétel",
      "shoot",
      "session",
    ],
  },
  { icon: Mic, keywords: ["mikrofon", "mic", "hang", "audio", "lavalier", "csiptet"] },
  { icon: Music, keywords: ["zene", "music", "dj", "playlist", "dal", "song"] },
  { icon: MapPin, keywords: ["helyszín", "location", "utazás", "travel", "kiszáll", "km"] },
  {
    icon: Sparkles,
    keywords: [
      "prémium",
      "premium",
      "extra",
      "bónusz",
      "bonus",
      "ajándék",
      "gift",
      "album",
      "print",
      "nyomtat",
      "könyv",
      "book",
    ],
  },
];

function iconForSpec(spec: Spec): LucideIcon {
  const haystack = `${spec.label ?? ""} ${spec.value}`.toLowerCase();
  for (const rule of SPEC_ICON_RULES) {
    if (rule.keywords.some((k) => haystack.includes(k))) return rule.icon;
  }
  return Check;
}

/** Split a free-text description into fact rows. Each non-empty line becomes a
 *  spec; a leading bullet glyph is stripped, and a short "Label: value" prefix
 *  (≤ 32 chars before the first colon) splits into label + value. */
function parseSpecs(description: string | null): Spec[] {
  if (!description) return [];
  return description
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-•·*–]\s*/, ""))
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^:：]{1,32})[:：]\s*(.+)$/);
      if (m?.[1] && m[2]) return { label: m[1].trim(), value: m[2].trim() };
      return { label: null, value: line };
    });
}

/** How many specs show before the "See full details" toggle. Keeps the default
 *  view to the handful of facts that actually drive a booking decision. */
const VISIBLE_SPECS = 5;

type T = (k: string, vars?: Record<string, string | number>) => string;

function SpecRow({ spec }: { spec: Spec }) {
  const Icon = iconForSpec(spec);
  return (
    <li className="flex min-h-[2.25rem] items-center gap-2.5 py-1.5 text-sm">
      <Icon
        size={15}
        strokeWidth={1.75}
        aria-hidden
        className="shrink-0 text-ink-400 dark:text-umber-400"
      />
      {spec.label ? (
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <span className="text-ink-500 dark:text-umber-300">{spec.label}</span>
          <span className="text-right font-medium text-ink-900 dark:text-cream-50">
            {spec.value}
          </span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 text-ink-700 dark:text-umber-100">{spec.value}</span>
      )}
    </li>
  );
}

function PackageCard({
  pkg,
  recommended,
  t,
}: {
  pkg: ListingPackage;
  recommended: boolean;
  t: T;
}) {
  const specs = parseSpecs(pkg.description);
  const [expanded, setExpanded] = useState(false);
  const hasMore = specs.length > VISIBLE_SPECS;
  const shown = expanded ? specs : specs.slice(0, VISIBLE_SPECS);
  const isEmpty = !pkg.price_text && specs.length === 0 && !pkg.pdf_url;

  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-2xl bg-white dark:bg-umber-900 ${
        recommended
          ? "shadow-pop ring-1 ring-blush-500/40 dark:ring-blush-400/40"
          : "shadow-elevated ring-1 ring-black/[0.04] dark:shadow-none dark:ring-umber-700/60"
      }`}
    >
      {/* Accent top bar + badge single out the recommended tier the way a
          pricing page highlights its default choice. This is one of the few
          places the accent colour is allowed to appear. */}
      {recommended && (
        <>
          <span aria-hidden className="block h-1 w-full bg-blush-500 dark:bg-blush-400" />
          <span className="absolute right-4 top-4 inline-flex items-center rounded-full bg-blush-500 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white dark:bg-blush-400 dark:text-umber-900">
            {t("suppliers.detail.packages.recommended")}
          </span>
        </>
      )}

      {/* Headline zone — name + a large, dominant price. Fixed min-height so
          the dividers line up across all three columns. */}
      <div className="flex min-h-[5.5rem] flex-col justify-start gap-1.5 px-5 pb-4 pt-5">
        <h3 className="pr-20 text-base font-semibold leading-snug text-ink-900 dark:text-cream-50">
          {pkg.name}
        </h3>
        {pkg.price_text ? (
          <p className="text-2xl font-bold leading-none tracking-tight text-ink-900 dark:text-cream-50">
            {pkg.price_text}
          </p>
        ) : isEmpty ? (
          <p className="text-sm italic text-ink-500 dark:text-umber-300">
            {t("suppliers.detail.packages.detailsOnRequest")}
          </p>
        ) : null}
      </div>

      {/* Specs zone — flex-1 so the footer pins to the bottom and cards in a
          row stay equal height. */}
      {specs.length > 0 && (
        <div className="flex flex-1 flex-col border-t border-paper-200 px-5 py-2 dark:border-umber-700/70">
          <ul className="divide-y divide-paper-100 dark:divide-umber-800">
            {shown.map((spec, i) => (
              <SpecRow key={i} spec={spec} />
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-2 inline-flex items-center gap-1 self-start rounded-md py-1 text-sm font-medium text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:text-umber-200 dark:hover:text-cream-50"
            >
              {expanded
                ? t("suppliers.detail.packages.showLess")
                : t("suppliers.detail.packages.seeFullDetails")}
              <ChevronDown
                size={14}
                aria-hidden
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              />
            </button>
          )}
        </div>
      )}

      {/* When there are no parsed specs, the specs zone above is skipped —
          spacer keeps the footer at the bottom so mixed cards stay aligned. */}
      {specs.length === 0 && <div className="flex-1" />}

      {pkg.pdf_url && (
        <div className="border-t border-paper-200 px-5 py-3 dark:border-umber-700/70">
          <a
            href={pkg.pdf_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 hover:text-ink-900 hover:underline dark:text-umber-100 dark:hover:text-cream-50"
          >
            <FileText size={15} aria-hidden />
            {pkg.pdf_name ?? t("suppliers.detail.packages.download")}
          </a>
        </div>
      )}
    </div>
  );
}

/** The recommended anchor: the middle tier when a vendor published three
 *  (the classic good/better/best anchor position), the last when they
 *  published two, none for a single package. Positional, not booking-driven —
 *  there is no per-package booking signal to rank on yet. */
function recommendedIndex(count: number): number {
  if (count >= 3) return 1;
  if (count === 2) return 1;
  return -1;
}

/** Responsive comparison grid of package cards. `items-stretch` (grid default)
 *  keeps every card in a row the same height so spec rows align across columns. */
export function VendorPackageGrid({ packages, t }: { packages: ListingPackage[]; t: T }) {
  const recIndex = recommendedIndex(packages.length);
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {packages.map((pkg, i) => (
        <PackageCard key={pkg.id} pkg={pkg} recommended={i === recIndex} t={t} />
      ))}
    </div>
  );
}
