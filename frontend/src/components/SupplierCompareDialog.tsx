// Side-by-side supplier comparison. Couples tick 2–4 suppliers on
// /app/suppliers and this dialog lines them up as columns, with each row
// of facts annotated against the couple's known params (target guest
// count, per-category budget, the city they're filtering to). The point
// is to surface trade-offs at a glance — like comparing two iPhones and
// realising the cheaper one's camera is good enough.

import {
  CalendarCheck,
  Check,
  Mail,
  MapPin,
  Navigation,
  Phone,
  ScanEye,
  Star,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import type { DirectorySupplier } from "@shared/suppliers";
import { SUPPLIER_TO_BUDGET } from "@shared/suppliers";
import type { BudgetCategory, BudgetLine, Currency } from "@shared/types";
import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { supplierApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { haversineKm } from "../lib/geo";
import { Dialog } from "./ui/Dialog";

type Locale = "hu" | "en";

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
  if (loading && detail === undefined) return { text: "…", tone: "muted" };
  const iso = detail?.next_available ?? null;
  if (!iso) return { text: t("suppliers.compare.available_ask"), tone: "muted" };
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime()))
    return { text: t("suppliers.compare.available_ask"), tone: "muted" };
  const text = d.toLocaleDateString(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return { text, tone: "ok" };
}

function VerdictIcon({ kind }: { kind: "ok" | "warn" | "info" | "none" }) {
  if (kind === "ok")
    return <Check size={14} aria-hidden className="text-sage-600 dark:text-sage-300" />;
  if (kind === "warn")
    return <X size={14} aria-hidden className="text-blush-600 dark:text-blush-300" />;
  if (kind === "info")
    return <ScanEye size={14} aria-hidden className="text-ink-400 dark:text-umber-300" />;
  return null;
}

function PriceBandRow({ band }: { band: number | null }) {
  if (band === null) return <span className="text-ink-400 dark:text-umber-400">—</span>;
  return (
    <span className="font-mono text-ink-700 dark:text-paper-100">
      {"$".repeat(Math.max(0, Math.min(5, band)))}
    </span>
  );
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
  // Fetch them per column when the dialog opens (≤4 small requests). The map
  // keeps whatever has resolved so far; rows render a dash until each lands.
  const [details, setDetails] = useState<Map<string, CompareDetail>>(new Map());
  const [detailsLoading, setDetailsLoading] = useState(false);
  const columnIds = useMemo(() => columns.map((s) => s.id).join(","), [columns]);
  useEffect(() => {
    if (!open || columns.length === 0) return;
    let cancelled = false;
    setDetailsLoading(true);
    Promise.all(
      columns.map((s) =>
        supplierApi
          .detail(s.id)
          .then((d): [string, CompareDetail] => [
            s.id,
            {
              avg_rating: d.reviews_summary.avg_rating,
              reviews_count: d.reviews_summary.reviews_count,
              next_available: d.next_available ?? null,
            },
          ])
          .catch((): [string, CompareDetail] | null => null),
      ),
    ).then((entries) => {
      if (cancelled) return;
      const next = new Map<string, CompareDetail>();
      for (const e of entries) if (e) next.set(e[0], e[1]);
      setDetails(next);
      setDetailsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, columnIds, columns]);

  // Nearest column among those we can actually measure — only used to tint a
  // "winner" when there's more than one measurable distance to compare.
  const measuredDistances = columns
    .map((s) => supplierDistanceKm(s, coupleLocation))
    .filter((d): d is number => d !== null);
  const closestKm = measuredDistances.length > 1 ? Math.min(...measuredDistances) : null;

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
            className="inline-flex h-9 items-center rounded-full border border-paper-300 bg-paper-50 px-4 text-sm text-ink-700 transition hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-umber-500"
          >
            {t("suppliers.compare.dialog_close_aria")}
          </button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-ink-500 dark:text-umber-300">
        {t("suppliers.compare.dialog_intro")}
      </p>
      {columns.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-500 dark:text-umber-300">
          {t("suppliers.compare.floating_min_hint")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          {/* Column headers: name + category + remove ×. Each header pins
           *  to the top of its column inside the scrollable wrapper. */}
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `9rem repeat(${columns.length}, minmax(11rem, 1fr))`,
            }}
          >
            <div />
            {columns.map((s) => (
              <div
                key={s.id}
                className="rounded-2xl border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-700/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-ink-900 dark:text-paper-50">
                      {s.name}
                    </h3>
                    <p className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-500 dark:text-umber-300">
                      {t(`suppliers.cat.${s.category}`)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(s.id)}
                    aria-label={t("suppliers.compare.remove_column")}
                    title={t("suppliers.compare.remove_column")}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-ink-800 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
                  >
                    <X size={14} aria-hidden />
                  </button>
                </div>
              </div>
            ))}

            {/* Row: quote (planned_huf) vs category budget. */}
            <RowLabel
              icon={<Wallet size={14} aria-hidden />}
              label={t("suppliers.compare.row_quote")}
            />
            {columns.map((s) => {
              const cell = quoteCell(s, supplierCosts, budgetLines, currency, locale, t);
              return (
                <Cell key={`q-${s.id}`}>
                  {cell.primary ? (
                    <span className="text-base font-semibold text-ink-900 dark:text-paper-50">
                      {cell.primary}
                    </span>
                  ) : null}
                  {cell.secondary && (
                    <span
                      className={
                        cell.tone === "ok"
                          ? "mt-0.5 text-[11px] text-sage-700 dark:text-sage-300"
                          : cell.tone === "warn"
                            ? "mt-0.5 text-[11px] text-blush-700 dark:text-blush-300"
                            : "mt-0.5 text-[11px] text-ink-500 dark:text-umber-300"
                      }
                    >
                      {cell.secondary}
                    </span>
                  )}
                </Cell>
              );
            })}

            {/* Row: declared price band. */}
            <RowLabel label={t("suppliers.compare.row_price_band")} />
            {columns.map((s) => (
              <Cell key={`p-${s.id}`}>
                <PriceBandRow band={s.price_band} />
              </Cell>
            ))}

            {/* Row: published rating + review count. Null below the 3-review
                cold-start gate → "no ratings yet". */}
            <RowLabel
              icon={<Star size={14} aria-hidden />}
              label={t("suppliers.compare.row_rating")}
            />
            {columns.map((s) => {
              const d = details.get(s.id);
              const rating = d?.avg_rating ?? null;
              return (
                <Cell key={`r-${s.id}`}>
                  {detailsLoading && d === undefined ? (
                    <span className="text-sm text-ink-400 dark:text-umber-400">…</span>
                  ) : rating === null ? (
                    <span className="text-[11px] text-ink-500 dark:text-umber-300">
                      {t("suppliers.compare.rating_none")}
                    </span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-900 dark:text-paper-50">
                        <Star
                          size={13}
                          aria-hidden
                          className="fill-current text-amber-500 dark:text-amber-300"
                        />
                        {rating.toFixed(1)}
                      </span>
                      <span className="mt-0.5 text-[11px] text-ink-500 dark:text-umber-300">
                        {t("suppliers.compare.rating_count", { n: d?.reviews_count ?? 0 })}
                      </span>
                    </>
                  )}
                </Cell>
              );
            })}

            {/* Row: capacity (with tailored verdict against target). */}
            <RowLabel
              icon={<Users size={14} aria-hidden />}
              label={t("suppliers.compare.row_capacity")}
            />
            {columns.map((s) => {
              const cap = capacityCell(s, targetGuestCount, t);
              return (
                <Cell key={`c-${s.id}`}>
                  {cap.range ? (
                    <span className="text-sm text-ink-800 dark:text-paper-100">{cap.range}</span>
                  ) : null}
                  <span
                    className={
                      cap.icon === "ok"
                        ? "mt-0.5 inline-flex items-center gap-1 text-[11px] text-sage-700 dark:text-sage-300"
                        : cap.icon === "warn"
                          ? "mt-0.5 inline-flex items-center gap-1 text-[11px] text-blush-700 dark:text-blush-300"
                          : "mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-500 dark:text-umber-300"
                    }
                  >
                    <VerdictIcon kind={cap.icon} />
                    {cap.line}
                  </span>
                </Cell>
              );
            })}

            {/* Row: city (with same/different verdict if the couple is
                actively filtering to a city). */}
            <RowLabel
              icon={<MapPin size={14} aria-hidden />}
              label={t("suppliers.compare.row_city")}
            />
            {columns.map((s) => {
              const match =
                coupleCityFilter.length > 0 &&
                s.city.toLowerCase() === coupleCityFilter.toLowerCase();
              return (
                <Cell key={`city-${s.id}`}>
                  <span className="text-sm text-ink-800 dark:text-paper-100">{s.city}</span>
                  {coupleCityFilter.length > 0 && (
                    <span
                      className={
                        match
                          ? "mt-0.5 inline-flex items-center gap-1 text-[11px] text-sage-700 dark:text-sage-300"
                          : "mt-0.5 inline-flex items-center gap-1 text-[11px] text-ink-500 dark:text-umber-300"
                      }
                    >
                      <VerdictIcon kind={match ? "ok" : "info"} />
                      {match
                        ? t("suppliers.compare.same_city")
                        : t("suppliers.compare.different_city")}
                    </span>
                  )}
                </Cell>
              );
            })}

            {/* Row: distance from the couple's venue pin. Falls back to a
                "set your venue" hint when the couple has no pin, or "—" when a
                supplier lacks coordinates. */}
            <RowLabel
              icon={<Navigation size={14} aria-hidden />}
              label={t("suppliers.compare.row_distance")}
            />
            {columns.map((s) => {
              const km = supplierDistanceKm(s, coupleLocation);
              const noOrigin = coupleLocation.lat === null || coupleLocation.lng === null;
              const isClosest = km !== null && closestKm !== null && Math.abs(km - closestKm) < 0.5;
              return (
                <Cell key={`d-${s.id}`}>
                  {noOrigin ? (
                    <span className="text-[11px] text-ink-500 dark:text-umber-300">
                      {t("suppliers.compare.distance_no_origin")}
                    </span>
                  ) : km === null ? (
                    <span className="text-ink-400 dark:text-umber-400">—</span>
                  ) : (
                    <span
                      className={
                        isClosest
                          ? "inline-flex items-center gap-1 text-sm font-semibold text-sage-700 dark:text-sage-300"
                          : "text-sm text-ink-800 dark:text-paper-100"
                      }
                    >
                      {isClosest && <VerdictIcon kind="ok" />}
                      {t("suppliers.compare.distance_km", { km: Math.max(0, Math.round(km)) })}
                    </span>
                  )}
                </Cell>
              );
            })}

            {/* Row: earliest available date (claimed vendors only). */}
            <RowLabel
              icon={<CalendarCheck size={14} aria-hidden />}
              label={t("suppliers.compare.row_available")}
            />
            {columns.map((s) => {
              const cell = availableCell(details.get(s.id), detailsLoading, locale, t);
              return (
                <Cell key={`av-${s.id}`}>
                  <span
                    className={
                      cell.tone === "ok"
                        ? "text-sm text-ink-800 dark:text-paper-100"
                        : "text-[11px] text-ink-500 dark:text-umber-300"
                    }
                  >
                    {cell.text}
                  </span>
                </Cell>
              );
            })}

            {/* Row: community votes. */}
            <RowLabel label={t("suppliers.compare.row_votes")} />
            {columns.map((s) => (
              <Cell key={`v-${s.id}`}>
                <span className="text-sm tabular-nums text-ink-800 dark:text-paper-100">
                  {s.votes_score > 0 ? `+${s.votes_score}` : s.votes_score}
                </span>
              </Cell>
            ))}

            {/* Row: contact channels. */}
            <RowLabel label={t("suppliers.compare.row_contact")} />
            {columns.map((s) => {
              const channels: { icon: ReactElement; label: string }[] = [];
              if (s.website)
                channels.push({
                  icon: <MapPin size={12} aria-hidden />,
                  label: t("suppliers.compare.contact_website"),
                });
              if (s.contact_email)
                channels.push({
                  icon: <Mail size={12} aria-hidden />,
                  label: t("suppliers.compare.contact_email"),
                });
              if (s.contact_phone)
                channels.push({
                  icon: <Phone size={12} aria-hidden />,
                  label: t("suppliers.compare.contact_phone"),
                });
              return (
                <Cell key={`co-${s.id}`}>
                  {channels.length === 0 ? (
                    <span className="text-[11px] text-ink-500 dark:text-umber-300">
                      {t("suppliers.compare.contact_none")}
                    </span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {channels.map((c) => (
                        <li
                          key={c.label}
                          className="inline-flex items-center gap-1 text-[11px] text-ink-700 dark:text-paper-100"
                        >
                          {c.icon}
                          {c.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </Cell>
              );
            })}

            {/* Row: about (blurb). Locale-aware. */}
            <RowLabel label={t("suppliers.compare.row_about")} />
            {columns.map((s) => (
              <Cell key={`a-${s.id}`}>
                <p className="text-xs leading-relaxed text-ink-700 dark:text-paper-100">
                  {locale === "hu" ? s.blurb_hu : s.blurb_en}
                </p>
              </Cell>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function RowLabel({ icon, label }: { icon?: ReactElement; label: string }) {
  return (
    <div className="flex items-center gap-2 self-center text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 dark:text-umber-300">
      {icon}
      {label}
    </div>
  );
}

function Cell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-700/40">
      {children}
    </div>
  );
}
