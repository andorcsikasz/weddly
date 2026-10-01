// Side-by-side supplier comparison. Couples tick 2–15 suppliers on
// /app/suppliers and this dialog lines them up as columns, with each row
// of facts annotated against the couple's known params (target guest
// count, per-category budget, the city they're filtering to). The point
// is to surface trade-offs at a glance — like comparing two iPhones and
// realising the cheaper one's camera is good enough.

import { Check, MapPin, Star, X } from "lucide-react";
import { type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { pickListingBlurb } from "@shared/listing_language";
import type { DirectorySupplier } from "@shared/suppliers";
import { SUPPLIER_TO_BUDGET, capacityKindFor } from "@shared/suppliers";
import type { BudgetCategory, BudgetLine, Currency } from "@shared/types";
import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { supplierApi } from "../lib/endpoints";
import { formatMoney, intlLocale } from "../lib/format";
import type { Locale } from "../lib/i18n";
import { haversineKm } from "../lib/geo";
import { lazyWithReload } from "../lib/lazy_reload";
import { Dialog } from "./ui/Dialog";
import { Skeleton } from "./ui/Skeleton";

// Leaflet is ~150KB; it ships only when a couple clicks a city.
const CompareMap = lazyWithReload(() => import("./CompareMap"));

/** The detail-only facts the comparison needs that aren't on the list DTO:
 *  the published rating + how many reviews back it, and the earliest free
 *  date (claimed vendors only). Fetched per column when the dialog opens. */
interface CompareDetail {
  avg_rating: number | null;
  reviews_count: number;
  next_available: string | null;
}

type Props = {
  open: boolean;
  onClose: () => void;
  compareIds: string[];
  /** Public directory entries — curated + community. DIY ("self") entries
   *  are intentionally not in this set because comparing a stub note to a
   *  real listing isn't apples-to-apples. */
  items: DirectorySupplier[];
  supplierCosts: CoupleSupplierCost[];
  budgetLines: BudgetLine[];
  targetGuestCount: number | null;
  /** City the couple is actively filtering to on /app/suppliers, if any —
   *  the closest signal we have for "this is where we want to get married". */
  coupleCityFilter: string;
  /** The couple's wedding-venue pin (location_lat/lng on the couple). Drives
   *  the distance row. Null lat/lng → the row shows a "set your venue" hint. */
  coupleLocation: { lat: number | null; lng: number | null };
  currency: Currency;
  locale: Locale;
  /** Called when a column's × is clicked. Same toggle used on the cards. */
  onRemove: (id: string) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
};

/** Resolve a supplier id back to the directory entry, ignoring DIY rows. */
function resolveSupplier(id: string, items: DirectorySupplier[]): DirectorySupplier | null {
  return items.find((s) => s.id === id) ?? null;
}

/** Total planned budget for the budget category a supplier maps into. */
function plannedForCategory(category: BudgetCategory, lines: BudgetLine[]): number {
  let total = 0;
  for (const l of lines) {
    if (l.category === category) total += l.planned_huf ?? 0;
  }
  return total;
}

/** Verdict cell for the capacity row: green check when the supplier covers
 *  the target guest count, red warn when it falls short, neutral when the
 *  couple hasn't set a target yet. */
function capacityCell(
  supplier: DirectorySupplier,
  target: number | null,
  t: Props["t"],
): { icon: "ok" | "warn" | "info" | "none"; line: string; range: string | null } {
  // Categories with no guest capacity get a neutral "not relevant" rather than
  // the "unknown" line below: a photographer hasn't forgotten to fill this in,
  // the question just doesn't apply, and reading it as missing data would push
  // the couple to discount them against a vendor who did answer.
  if (capacityKindFor(supplier.category) == null) {
    return { icon: "none", line: t("suppliers.compare.capacity_not_relevant"), range: null };
  }
  const min = supplier.capacity_min;
  const max = supplier.capacity_max;
  const hasRange = min !== null || max !== null;
  const range = hasRange
    ? min !== null && max !== null
      ? `${min}–${max}`
      : max !== null
        ? `≤${max}`
        : `≥${min}`
    : null;
  if (!hasRange) {
    return { icon: "none", line: t("suppliers.compare.capacity_unknown"), range: null };
  }
  if (target === null) {
    return { icon: "info", line: t("suppliers.compare.capacity_no_target"), range };
  }
  // Fit: target falls within whatever bounds the supplier declared. A
  // supplier with only an upper bound (caterers, etc.) is "fits" as long
  // as the count is at or under it; a supplier with only a lower bound
  // is "fits" if the count is at or above it.
  const underMin = min !== null && target < min;
  const overMax = max !== null && target > max;
  if (underMin) {
    return {
      icon: "warn",
      line: t("suppliers.compare.capacity_too_large", { n: target }),
      range,
    };
  }
  if (overMax) {
    return {
      icon: "warn",
      line: t("suppliers.compare.capacity_too_small", { n: target }),
      range,
    };
  }
  return {
    icon: "ok",
    line: t("suppliers.compare.capacity_fits", { n: target }),
    range,
  };
}

/** Verdict cell for the quote row: shows the couple's saved planned_huf
 *  for this supplier (if any) plus how it sits against the per-category
 *  budget. The point is to make "this one's 250k more but on-budget" obvious. */
function quoteCell(
  supplier: DirectorySupplier,
  costs: CoupleSupplierCost[],
  budgetLines: BudgetLine[],
  currency: Currency,
  locale: Locale,
  t: Props["t"],
): { primary: string | null; secondary: string | null; tone: "ok" | "warn" | "muted" } {
  const cost = costs.find((c) => c.supplier_id === supplier.id);
  const planned = cost?.planned_huf ?? 0;
  if (planned <= 0) {
    return {
      primary: null,
      secondary: t("suppliers.compare.quote_none"),
      tone: "muted",
    };
  }
  const primary = formatMoney(planned, currency, locale);
  const budgetCat = SUPPLIER_TO_BUDGET[supplier.category] as BudgetCategory;
  const categoryBudget = plannedForCategory(budgetCat, budgetLines);
  if (categoryBudget <= 0) {
    return { primary, secondary: t("suppliers.compare.quote_no_budget"), tone: "muted" };
  }
  const delta = categoryBudget - planned;
  if (delta >= 0) {
    return {
      primary,
      secondary: t("suppliers.compare.quote_vs_budget_under", {
        amount: formatMoney(delta, currency, locale),
      }),
      tone: "ok",
    };
  }
  return {
    primary,
    secondary: t("suppliers.compare.quote_vs_budget_over", {
      amount: formatMoney(-delta, currency, locale),
    }),
    tone: "warn",
  };
}

/** Great-circle km from the couple's venue pin to a supplier, or null when
 *  either end has no coordinates. */
function supplierDistanceKm(
  supplier: DirectorySupplier,
  origin: { lat: number | null; lng: number | null },
): number | null {
  if (origin.lat === null || origin.lng === null) return null;
  if (supplier.lat === null || supplier.lng === null) return null;
  return haversineKm(origin.lat, origin.lng, supplier.lat, supplier.lng);
}

/** Format the earliest available date, or a neutral "ask to confirm" when the
 *  supplier is unclaimed (next_available null). */
function availableCell(
  detail: CompareDetail | undefined,
  loading: boolean,
  locale: Locale,
  t: Props["t"],
): { text: string; tone: "ok" | "muted" } {
  if (loading) return { text: "", tone: "muted" };
  const iso = detail?.next_available ?? null;
  if (!iso) return { text: t("suppliers.compare.available_ask"), tone: "muted" };
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime()))
    return { text: t("suppliers.compare.available_ask"), tone: "muted" };
  const text = d.toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return { text, tone: "ok" };
}

export function SupplierCompareDialog({
  open,
  onClose,
  compareIds,
  items,
  supplierCosts,
  budgetLines,
  targetGuestCount,
  coupleCityFilter,
  coupleLocation,
  currency,
  locale,
  onRemove,
  t,
}: Props) {
  // Resolve ids → suppliers once, in URL order. Missing ids (deleted
  // entries, stale URL) silently drop so the dialog still shows something.
  const columns = useMemo(() => {
    return compareIds
      .map((id) => resolveSupplier(id, items))
      .filter((s): s is DirectorySupplier => s !== null);
  }, [compareIds, items]);

  // Rating + earliest-free-date live on the detail payload, not the list DTO.
  // Fetch them per column when the dialog opens (≤15 small requests). Each
  // column fills in the moment ITS request settles rather than waiting on the
  // slowest of fifteen, and `settled` (success or failure) is what stops a
  // cell shimmering: a failed fetch reads as the unclaimed fallback, never as
  // a skeleton that runs forever.
  const [details, setDetails] = useState<Map<string, CompareDetail>>(new Map());
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const columnIds = useMemo(() => columns.map((s) => s.id).join(","), [columns]);
  useEffect(() => {
    if (!open || columns.length === 0) return;
    let cancelled = false;
    setDetails(new Map());
    setSettled(new Set());
    for (const s of columns) {
      supplierApi
        .detail(s.id)
        .then((d) => {
          if (cancelled) return;
          setDetails((prev) =>
            new Map(prev).set(s.id, {
              avg_rating: d.reviews_summary.avg_rating,
              reviews_count: d.reviews_summary.reviews_count,
              next_available: d.next_available ?? null,
            }),
          );
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setSettled((prev) => new Set(prev).add(s.id));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, columnIds, columns]);
  // The supplier whose city the couple clicked, or null while the map is shut.
  // Reset on close so the next opening starts on the table, not a stale map.
  const [mapFor, setMapFor] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setMapFor(null);
  }, [open]);
  const mapActive = mapFor !== null && columns.some((s) => s.id === mapFor) ? mapFor : null;
  const template = `8rem repeat(${columns.length}, minmax(10.5rem, 1fr))`;
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Whichever way a supplier gets selected (its tile, its city, its pin on the
  // map), bring its column into view beside the pinned label column.
  useEffect(() => {
    const body = bodyRef.current;
    const col = headRef.current?.querySelector<HTMLElement>(
      `[data-compare-col="${CSS.escape(mapActive ?? "")}"]`,
    );
    if (!mapActive || !body || !col) return;
    const labelWidth = col.parentElement?.firstElementChild?.getBoundingClientRect().width ?? 0;
    const left = col.offsetLeft - labelWidth;
    const right = col.offsetLeft + col.offsetWidth - body.clientWidth;
    if (body.scrollLeft > left || body.scrollLeft < right)
      body.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [mapActive]);
  const settledCount = columns.filter((s) => settled.has(s.id)).length;
  const detailsLoading = open && settledCount < columns.length;
  const isLoading = (id: string) => open && !settled.has(id);

  // Nearest column among those we can actually measure — only used to tint a
  // "winner" when there's more than one measurable distance to compare.
  const measuredDistances = columns
    .map((s) => supplierDistanceKm(s, coupleLocation))
    .filter((d): d is number => d !== null);
  const closestKm = measuredDistances.length > 1 ? Math.min(...measuredDistances) : null;

  // Every row is a list of cells, one per column, and a cell is either a value
  // or an EMPTY state carrying the sentence that explains it. Rendering from
  // that shape is what lets a row whose every cell is the same empty state
  // ("Set your venue to see distance" fifteen times) collapse into ONE line
  // across the table, while a mixed row shows a quiet dash with the sentence
  // in its tooltip. The sentence never disappears, it just stops repeating.
  const rows: CompareRow[] = [
    {
      key: "quote",
      label: t("suppliers.compare.row_quote"),
      cells: columns.map((s) => {
        const cell = quoteCell(s, supplierCosts, budgetLines, currency, locale, t);
        if (!cell.primary) return { empty: cell.secondary ?? "" };
        return {
          node: (
            <>
              <span className="text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                {cell.primary}
              </span>
              {cell.secondary && (
                <span
                  className={`mt-0.5 text-[11px] ${
                    cell.tone === "ok"
                      ? "text-sage-700 dark:text-sage-300"
                      : cell.tone === "warn"
                        ? "text-blush-700 dark:text-blush-300"
                        : "text-ink-500 dark:text-umber-300"
                  }`}
                >
                  {cell.secondary}
                </span>
              )}
            </>
          ),
        };
      }),
    },
    {
      key: "price",
      label: t("suppliers.compare.row_price_band"),
      cells: columns.map((s) =>
        s.price_band === null
          ? { empty: t("suppliers.compare.row_price_band") }
          : {
              node: (
                <span className="text-sm font-semibold tracking-wider text-ink-900 dark:text-paper-50">
                  {"$".repeat(Math.max(0, Math.min(5, s.price_band)))}
                </span>
              ),
            },
      ),
    },
    {
      key: "rating",
      label: t("suppliers.compare.row_rating"),
      cells: columns.map((s) => {
        if (isLoading(s.id)) return { node: <CellSkeleton /> };
        const d = details.get(s.id);
        const rating = d?.avg_rating ?? null;
        if (rating === null) return { empty: t("suppliers.compare.rating_none") };
        return {
          node: (
            <span className="inline-flex items-baseline gap-1.5 text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
              <Star size={12} aria-hidden className="fill-current self-center" />
              {rating.toFixed(1)}
              <span className="text-[11px] font-normal text-ink-500 dark:text-umber-300">
                {t("suppliers.compare.rating_count", { n: d?.reviews_count ?? 0 })}
              </span>
            </span>
          ),
        };
      }),
    },
    {
      key: "capacity",
      label: t("suppliers.compare.row_capacity"),
      cells: columns.map((s) => {
        const cap = capacityCell(s, targetGuestCount, t);
        if (!cap.range) return { empty: cap.line };
        const verdict = cap.icon === "ok" || cap.icon === "warn";
        return {
          node: (
            <span
              title={verdict ? undefined : cap.line}
              className="inline-flex items-center gap-1.5 text-sm tabular-nums text-ink-900 dark:text-paper-50"
            >
              {cap.range}
              {verdict && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[11px] ${
                    cap.icon === "ok"
                      ? "text-sage-700 dark:text-sage-300"
                      : "text-blush-700 dark:text-blush-300"
                  }`}
                >
                  {cap.icon === "ok" ? (
                    <Check size={12} aria-hidden />
                  ) : (
                    <X size={12} aria-hidden />
                  )}
                  {cap.line}
                </span>
              )}
            </span>
          ),
        };
      }),
    },
    {
      key: "city",
      label: t("suppliers.compare.row_city"),
      cells: columns.map((s) => {
        const filtering = coupleCityFilter.length > 0;
        const match = filtering && s.city.toLowerCase() === coupleCityFilter.toLowerCase();
        const title = filtering
          ? match
            ? t("suppliers.compare.same_city")
            : t("suppliers.compare.different_city")
          : undefined;
        const text = (
          <>
            {match && <Check size={12} aria-hidden />}
            {s.city}
          </>
        );
        const tone = match
          ? "font-semibold text-sage-700 dark:text-sage-300"
          : "text-ink-900 dark:text-paper-50";
        // A city with a coordinate opens the map with every compared place
        // on it. One without stays plain text: a button that opens a map
        // with this supplier missing from it would answer nothing.
        if (s.lat === null || s.lng === null)
          return {
            node: (
              <span title={title} className={`inline-flex items-center gap-1 text-sm ${tone}`}>
                {text}
              </span>
            ),
          };
        const isOn = mapActive === s.id;
        return {
          node: (
            <button
              type="button"
              onClick={() => setMapFor(isOn ? null : s.id)}
              aria-pressed={isOn}
              title={title ?? t("suppliers.compare.show_on_map")}
              aria-label={`${s.city}, ${t("suppliers.compare.show_on_map")}`}
              className={`-mx-1.5 inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-sm underline decoration-1 underline-offset-4 transition ${tone} ${
                isOn
                  ? "bg-ink-900 text-white no-underline dark:bg-paper-50 dark:text-ink-900"
                  : "decoration-ink-300 hover:bg-paper-100 hover:decoration-ink-900 dark:decoration-umber-500 dark:hover:bg-umber-700"
              }`}
            >
              {text}
            </button>
          ),
        };
      }),
    },
    {
      key: "distance",
      label: t("suppliers.compare.row_distance"),
      cells: columns.map((s) => {
        if (coupleLocation.lat === null || coupleLocation.lng === null)
          return { empty: t("suppliers.compare.distance_no_origin") };
        const km = supplierDistanceKm(s, coupleLocation);
        if (km === null) return { empty: t("suppliers.compare.row_distance") };
        const isClosest = closestKm !== null && Math.abs(km - closestKm) < 0.5;
        return {
          node: (
            <span
              className={`inline-flex items-center gap-1 text-sm tabular-nums ${
                isClosest
                  ? "font-semibold text-sage-700 dark:text-sage-300"
                  : "text-ink-900 dark:text-paper-50"
              }`}
            >
              {isClosest && <Check size={12} aria-hidden />}
              {t("suppliers.compare.distance_km", { km: Math.max(0, Math.round(km)) })}
            </span>
          ),
        };
      }),
    },
    {
      key: "available",
      label: t("suppliers.compare.row_available"),
      cells: columns.map((s) => {
        const loading = isLoading(s.id);
        if (loading) return { node: <CellSkeleton /> };
        const cell = availableCell(details.get(s.id), false, locale, t);
        if (cell.tone === "muted") return { empty: cell.text };
        return {
          node: (
            <span className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {cell.text}
            </span>
          ),
        };
      }),
    },
    {
      key: "votes",
      label: t("suppliers.compare.row_votes"),
      cells: columns.map((s) => ({
        node: (
          <span className="text-sm tabular-nums text-ink-900 dark:text-paper-50">
            {s.votes_score > 0 ? `+${s.votes_score}` : s.votes_score}
          </span>
        ),
      })),
    },
    {
      key: "about",
      label: t("suppliers.compare.row_about"),
      cells: columns.map((s) => {
        const blurb = pickListingBlurb(s, locale);
        if (!blurb) return { empty: t("suppliers.compare.row_about") };
        return {
          node: (
            <p
              title={blurb}
              className="line-clamp-4 text-xs leading-relaxed text-ink-600 dark:text-paper-200"
            >
              {blurb}
            </p>
          ),
        };
      }),
    },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("suppliers.compare.dialog_title")}
      role="dialog"
      closeOnBackdrop
      size="xl"
      footer={
        <div className="flex w-full justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-full bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800 dark:bg-paper-50 dark:text-ink-900 dark:hover:bg-paper-200"
          >
            {t("suppliers.compare.dialog_close_aria")}
          </button>
        </div>
      }
    >
      {columns.length > 0 && detailsLoading && (
        <div className="mb-4" role="status" aria-live="polite">
          <p className="mb-1.5 text-[11px] text-ink-500 dark:text-umber-300">
            {t("suppliers.compare.loading_details", {
              done: settledCount,
              total: columns.length,
            })}
          </p>
          <div className="h-0.5 overflow-hidden rounded-full bg-paper-200 dark:bg-umber-700">
            <div
              className="h-full rounded-full bg-ink-900 motion-safe:transition-[width] motion-safe:duration-300 dark:bg-paper-50"
              style={{ width: `${Math.max(8, (settledCount / columns.length) * 100)}%` }}
            />
          </div>
        </div>
      )}
      {columns.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-500 dark:text-umber-300">
          {t("suppliers.compare.floating_min_hint")}
        </p>
      ) : (
        <>
          {mapActive && (
            <div className="relative mb-4 h-64 overflow-hidden rounded-2xl border border-paper-200 bg-paper-100 dark:border-umber-700 dark:bg-umber-900">
              <Suspense fallback={<Skeleton className="h-full w-full" />}>
                <CompareMap
                  suppliers={columns}
                  activeId={mapActive}
                  onSelect={setMapFor}
                  venue={coupleLocation}
                  venueLabel={t("suppliers.compare.map_venue")}
                />
              </Suspense>
              <button
                type="button"
                onClick={() => setMapFor(null)}
                aria-label={t("suppliers.compare.map_close")}
                title={t("suppliers.compare.map_close")}
                className="absolute right-2 top-2 z-[500] inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink-900 shadow-soft transition hover:bg-paper-100 dark:bg-umber-800 dark:text-paper-50 dark:hover:bg-umber-700"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
          )}
          {/* The name row lives OUTSIDE the table's scroller so it can stick
           *  to the top of the dialog while the rows scroll under it: a
           *  sideways scroller is also a vertical scroll container, and
           *  `sticky top` inside it would pin to the scroller, not the
           *  dialog. The two halves share one column template and their
           *  horizontal scroll is mirrored both ways. */}
          <div
            ref={headRef}
            onScroll={() => mirrorScroll(headRef.current, bodyRef.current)}
            className="sticky top-0 z-20 -mx-1 overflow-x-auto bg-white [scrollbar-width:none] dark:bg-umber-800 [&::-webkit-scrollbar]:hidden"
          >
            <div className="grid" style={{ gridTemplateColumns: template }}>
              <div className="sticky left-0 z-10 bg-white dark:bg-umber-800" />
              {columns.map((s) => {
                const isOn = mapActive === s.id;
                const placeable = s.lat !== null && s.lng !== null;
                return (
                  <div key={s.id} data-compare-col={s.id} className="px-1 pb-3 pt-1">
                    {/* The name tile is the one solid block in the table: every
                     *  column is anchored by it, and everything under it is
                     *  flat type on hairlines. Clicking it puts that supplier
                     *  on the map, and a pin clicked on the map lights the tile
                     *  up, so the two always point at the same place. */}
                    <div
                      className={`relative flex h-full items-start justify-between gap-2 rounded-xl bg-ink-900 p-3 text-white transition dark:bg-paper-50 dark:text-ink-900 ${
                        isOn
                          ? "ring-2 ring-ink-900 ring-offset-2 ring-offset-white dark:ring-paper-50 dark:ring-offset-umber-800"
                          : ""
                      }`}
                    >
                      <button
                        type="button"
                        disabled={!placeable}
                        onClick={() => setMapFor(s.id)}
                        aria-pressed={isOn}
                        title={placeable ? t("suppliers.compare.show_on_map") : s.name}
                        className="min-w-0 flex-1 text-left after:absolute after:inset-0 after:rounded-xl disabled:cursor-default"
                      >
                        <h3 className="line-clamp-2 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
                          {s.name}
                        </h3>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-white/60 dark:text-ink-500">
                          {isOn && (
                            <MapPin
                              size={11}
                              aria-hidden
                              className="text-white dark:text-ink-900"
                            />
                          )}
                          {t(`suppliers.cat.${s.category}`)}
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(s.id)}
                        aria-label={t("suppliers.compare.remove_column")}
                        title={t("suppliers.compare.remove_column")}
                        className="relative z-10 -mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/15 hover:text-white dark:text-ink-500 dark:hover:bg-ink-900/10 dark:hover:text-ink-900"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div
            ref={bodyRef}
            onScroll={() => mirrorScroll(bodyRef.current, headRef.current)}
            className="-mx-1 overflow-x-auto pb-1"
          >
            {/* Row labels pin to the left edge: with up to 15 columns the
             *  grid scrolls sideways and a cell without its label is a number
             *  about nothing. */}
            <div className="grid" style={{ gridTemplateColumns: template }}>
              {rows.map((row) => (
                <CompareRowView key={row.key} row={row} span={columns.length} />
              ))}
            </div>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Copy one scroller's horizontal offset onto its twin. Guarded so the echo
 *  from the twin's own scroll event is a no-op rather than a feedback loop. */
function mirrorScroll(from: HTMLElement | null, to: HTMLElement | null) {
  if (from && to && to.scrollLeft !== from.scrollLeft) to.scrollLeft = from.scrollLeft;
}

type CompareCell = { node: ReactNode } | { empty: string };
interface CompareRow {
  key: string;
  label: string;
  cells: CompareCell[];
}

function CompareRowView({ row, span }: { row: CompareRow; span: number }) {
  const first = row.cells[0];
  const uniformEmpty =
    first !== undefined &&
    "empty" in first &&
    row.cells.every((c) => "empty" in c && c.empty === first.empty);
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center border-b border-paper-200 bg-white py-3 pr-3 text-xs text-ink-500 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300">
        {row.label}
      </div>
      {uniformEmpty ? (
        <div
          className="flex items-center border-b border-paper-200 px-1 py-3 dark:border-umber-700"
          style={{ gridColumn: `span ${span}` }}
        >
          {/* Sticky so the one sentence stays in view while the columns
           *  scroll under it. */}
          <span className="sticky left-[8.25rem] text-xs text-ink-400 dark:text-umber-400">
            {first.empty}
          </span>
        </div>
      ) : (
        row.cells.map((c, i) => (
          <div
            key={i}
            className="flex flex-col justify-center border-b border-paper-200 px-1 py-3 dark:border-umber-700"
          >
            {"node" in c ? (
              c.node
            ) : (
              <span title={c.empty} className="text-sm text-ink-300 dark:text-umber-500">
                -<span className="sr-only">{c.empty}</span>
              </span>
            )}
          </div>
        ))
      )}
    </>
  );
}

/** Placeholder for a value still on its way: two shimmering bars the size of
 *  the text that replaces them, so the row doesn't jump when it lands. */
function CellSkeleton() {
  return (
    <div className="flex flex-col gap-1.5 py-0.5">
      <Skeleton variant="line" height={12} width="55%" />
      <Skeleton variant="line" height={8} width="80%" />
    </div>
  );
}
