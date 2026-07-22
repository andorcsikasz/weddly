// Vendor listing "packages" (árajánlat) card grid, shared by the in-app
// SupplierDetailPage and the public PublicVendorPage so the two never drift.
//
// A package carries only free text (`price_text`, `description`) plus an
// optional PDF — vendors quote in wildly different shapes, so there is no
// structured spec schema to render (see shared/listing_packages.ts). This
// component turns that free text into a scannable card: a headline zone
// (name + a compact price), a divider, and a specs zone where each
// "Label: value" line of the description becomes an icon + fact row. Icons
// are picked by keyword so the eye scans glyphs instead of reading
// sentences; anything unrecognised falls back to a neutral check.
//
// The default card shows only its headline (name + price); the subtitle,
// blurb and every spec row sit behind a per-card "See full details" toggle,
// so a grid of packages reads as a clean price list first and opens on
// demand. Every card is uniform: a flat white face with a crisp dark hairline
// outline, Uber-style, with no singled-out "recommended" tier.

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
  t,
}: {
  pkg: ListingPackage;
  t: T;
}) {
  const specs = parseSpecs(pkg.description);
  const [expanded, setExpanded] = useState(false);
  const isEmpty = !pkg.price_text && specs.length === 0 && !pkg.pdf_url;

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-ink-900 dark:bg-umber-900 dark:ring-umber-600">
      {/* Headline zone — the only thing shown by default: name + a compact
          price. The name reserves two lines (min-h) so the divider below it
          lands in the same band across every card, whatever the name length. */}
      <div className="flex flex-col gap-1.5 px-5 pb-4 pt-5">
        <h3 className="line-clamp-2 min-h-[2.75rem] text-base font-semibold leading-snug text-ink-900 dark:text-cream-50">
          {pkg.name}
        </h3>
        {pkg.price_text ? (
          <p className="text-lg font-bold leading-tight tracking-tight text-ink-900 dark:text-cream-50">
            {pkg.price_text}
          </p>
        ) : isEmpty ? (
          <p className="text-sm italic text-ink-500 dark:text-umber-300">
            {t("suppliers.detail.packages.detailsOnRequest")}
          </p>
        ) : null}
      </div>

      {/* Everything else (subtitle, blurb, every spec row) collapses behind one
          toggle so the default card is just name + price. flex-1 keeps the
          footer pinned and equal-height cards aligned in a row. */}
      {specs.length > 0 && (
        <div className="flex flex-1 flex-col border-t border-paper-200 px-5 py-2 dark:border-umber-700/70">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="flex w-full items-center justify-between gap-1 py-1.5 text-sm font-medium text-ink-600 transition hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:text-umber-200 dark:hover:text-cream-50"
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
          {expanded && (
            <ul className="mt-1 divide-y divide-paper-100 border-t border-paper-100 pt-1 dark:divide-umber-800 dark:border-umber-800">
              {specs.map((spec, i) => (
                <SpecRow key={i} spec={spec} />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* No parsed specs, so the collapsible zone is skipped: this spacer keeps
          the footer pinned so mixed cards stay aligned. */}
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

/** Responsive comparison grid of package cards. `items-stretch` (grid default)
 *  keeps every card in a row the same height so spec rows align across columns. */
export function VendorPackageGrid({ packages, t }: { packages: ListingPackage[]; t: T }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {packages.map((pkg) => (
        <PackageCard key={pkg.id} pkg={pkg} t={t} />
      ))}
    </div>
  );
}
