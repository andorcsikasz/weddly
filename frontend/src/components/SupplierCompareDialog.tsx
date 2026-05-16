// Side-by-side supplier comparison. Couples tick 2–4 suppliers on
// /app/suppliers and this dialog lines them up as columns, with each row
// of facts annotated against the couple's known params (target guest
// count, per-category budget, the city they're filtering to). The point
// is to surface trade-offs at a glance — like comparing two iPhones and
// realising the cheaper one's camera is good enough.

import { Check, Mail, MapPin, Phone, ScanEye, Users, Wallet, X } from "lucide-react";
import { type ReactElement, type ReactNode, useMemo } from "react";
import type { DirectorySupplier } from "@shared/suppliers";
import { SUPPLIER_TO_BUDGET } from "@shared/suppliers";
import type { BudgetCategory, BudgetLine, Currency } from "@shared/types";
import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { formatMoney } from "../lib/format";
import { Dialog } from "./ui/Dialog";

type Locale = "hu" | "en";

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
