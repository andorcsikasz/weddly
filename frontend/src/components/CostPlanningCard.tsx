// Shared cost-planning panel — guest-count slider plus a slider per category.
// Used by the Dashboard and Budget pages. Per-guest categories cross-couple
// with the headcount slider (move headcount → catering/drinks/etc. rescale).

import type { BudgetCategory, BudgetLine } from "@shared/types";
import {
  Cake,
  Camera,
  Car,
  Circle,
  Flower2,
  Gift,
  Heart,
  Home,
  Info,
  Mail,
  MoreHorizontal,
  Music,
  Plane,
  Scissors,
  Shirt,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { formatHuf, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";

/** Categories whose planned cost scales with headcount. Everything else is
 *  treated as a fixed cost (venue rental, photographer day rate, rings, …). */
export const PER_GUEST_CATEGORIES = new Set<BudgetCategory>([
  "catering",
  "drinks",
  "cake_dessert",
  "favours",
  "stationery",
]);

/** Lucide icon per category — minimalist 14–16px, ink-600 stroke. */
export const CATEGORY_ICONS: Record<
  BudgetCategory,
  ComponentType<{ size?: number; className?: string }>
> = {
  venue: Home,
  catering: UtensilsCrossed,
  drinks: Wine,
  attire: Shirt,
  decor_floral: Flower2,
  photo_video: Camera,
  music_dj: Music,
  cake_dessert: Cake,
  hair_makeup: Scissors,
  transport: Car,
  honeymoon: Plane,
  stationery: Mail,
  favours: Gift,
  rings: Circle,
  other: MoreHorizontal,
};

/** Stable display order for the category list — heuristic: largest typical
 *  spends first, niceties last. Keeps row order from jumping around as the
 *  user edits amounts (we no longer sort by current planned). */
const CATEGORY_ORDER: BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "photo_video",
  "music_dj",
  "decor_floral",
  "attire",
  "cake_dessert",
  "hair_makeup",
  "stationery",
  "favours",
  "transport",
  "honeymoon",
  "rings",
  "other",
];

export function CostPlanningCard({
  lines,
  baseline,
  cap,
  count,
  onCountChange,
  onEditPlanned,
}: {
  lines: BudgetLine[];
  baseline: number;
  cap: number | null;
  count: number;
  onCountChange: (n: number) => void;
  /** Called when the user releases a category slider with a new amount.
   *  The parent applies it to the underlying budget lines. */
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
}) {
  const { t, locale } = useT();
  const factor = baseline > 0 ? count / baseline : 1;

  // Aggregate lines into category buckets. Every category in CATEGORY_ORDER
  // gets a row (even with 0 planned) so the user can slide it up from zero.
  const buckets = useMemo(() => {
    const map = new Map<BudgetCategory, { planned: number; actual: number }>();
    for (const l of lines) {
      const cur = map.get(l.category) ?? { planned: 0, actual: 0 };
      map.set(l.category, {
        planned: cur.planned + l.planned_huf,
        actual: cur.actual + l.actual_huf,
      });
    }
    return CATEGORY_ORDER.map((cat) => {
      const v = map.get(cat) ?? { planned: 0, actual: 0 };
      const isPerGuest = PER_GUEST_CATEGORIES.has(cat);
      return {
        category: cat,
        actual: v.actual,
        // Display planned = baseline planned scaled for per-guest categories.
        plannedDisplay: isPerGuest ? Math.round(v.planned * factor) : v.planned,
        plannedBaseline: v.planned,
        scales: isPerGuest,
      };
    });
  }, [lines, factor]);

  const totalPlanned = buckets.reduce((s, b) => s + b.plannedDisplay, 0);
  const totalActual = buckets.reduce((s, b) => s + b.actual, 0);
  const overCap = cap !== null && totalPlanned > cap;
  const overage = overCap && cap !== null ? totalPlanned - cap : 0;

  // Per-row slider max — derived from cap if set, else a generous default.
  // 60% of the cap is enough room for any single category to grow without
  // making small-budget categories look like empty rails.
  const sliderMax = useMemo(() => {
    if (cap !== null && cap > 0) return Math.round(cap * 0.6);
    return Math.max(1_000_000, totalPlanned > 0 ? totalPlanned : 1_000_000);
  }, [cap, totalPlanned]);

  // Slider headcount range: ±50% around baseline, snapped to 5-guest steps.
  const minCount = Math.max(10, Math.round((baseline * 0.5) / 5) * 5);
  const maxCount = Math.max(baseline + 20, Math.round((baseline * 1.5) / 5) * 5);

  return (
    <section className="card">
      {overCap && (
        <div className="mb-4 rounded-xl border border-blush-300 bg-blush-50 px-4 py-2 text-sm font-medium text-blush-700">
          {t("budget.over_budget_strip", { amount: formatHuf(overage, locale) })}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">
            {t("budget.cost_planning_title")}
          </p>
          <h2 className="mt-1 font-serif">
            {t("budget.cost_planning_with_count", { n: formatNumber(count, locale) })}
          </h2>
        </div>
        <p className="max-w-sm text-xs text-ink-500">{t("budget.cost_planning_help")}</p>
      </div>

      {/* Headcount slider. */}
      <div className="mt-5">
        <input
          type="range"
          min={minCount}
          max={maxCount}
          step={1}
          value={count}
          onChange={(e) => onCountChange(Number(e.target.value))}
          className="block w-full cursor-pointer accent-blush-500"
          aria-label={t("budget.cost_planning_title")}
        />
        <div className="mt-1 flex justify-between text-xs text-ink-500">
          <span>{formatNumber(minCount, locale)}</span>
          <span className="text-ink-400">
            {t("budget.cost_planning_baseline_note", { n: formatNumber(baseline, locale) })}
          </span>
          <span>{formatNumber(maxCount, locale)}</span>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Info size={11} aria-hidden />
          <span>{t("budget.slider_scope_note")}</span>
        </p>
      </div>

      {/* Per-category sliders. */}
      <ul className="mt-6 space-y-4">
        {buckets.map((b) => (
          <CategoryRow
            key={b.category}
            category={b.category}
            plannedDisplay={b.plannedDisplay}
            plannedBaseline={b.plannedBaseline}
            actual={b.actual}
            scales={b.scales}
            count={count}
            sliderMax={sliderMax}
            onEditPlanned={onEditPlanned}
          />
        ))}
      </ul>

      {/* Totals — full digits, not compact, per design feedback. */}
      <div className="mt-6 border-t border-paper-200 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink-700">{t("budget.total_actual")}</span>
          <span
            className={`stat-num text-2xl font-semibold ${overCap ? "text-blush-700" : "text-ink-900"}`}
          >
            {formatHuf(totalActual, locale)}
            <span className={`text-sm ${overCap ? "text-blush-400" : "text-ink-400"}`}>
              {" / "}
              {formatHuf(totalPlanned, locale)}
            </span>
          </span>
        </div>
        {cap !== null && (
          <div className="mt-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-500">{t("budget.cap")}</span>
            <span className={`stat-num ${overCap ? "text-blush-700" : "text-ink-500"}`}>
              {formatHuf(cap, locale)}
              {overCap && ` · ${t("budget.over_budget")}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryRow({
  category,
  plannedDisplay,
  plannedBaseline,
  actual,
  scales,
  count,
  sliderMax,
  onEditPlanned,
}: {
  category: BudgetCategory;
  plannedDisplay: number;
  plannedBaseline: number;
  actual: number;
  scales: boolean;
  count: number;
  sliderMax: number;
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
}) {
  const { t, locale } = useT();
  // Local drag state — slider feels instant; commit fires on release only.
  const [localValue, setLocalValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Whenever the underlying baseline changes (e.g. saved value), drop the
  // local override so we re-display the canonical value.
  useEffect(() => {
    if (!saving) setLocalValue(null);
  }, [saving]);

  const Icon = CATEGORY_ICONS[category];
  const editable = !!onEditPlanned;

  // The slider operates on the *baseline* planned amount (unscaled). For
  // per-guest categories the displayed amount applies the headcount factor on
  // top so the on-screen value matches what the bar shows in the parent.
  const editValue = localValue ?? plannedBaseline;
  // The parent already pre-scaled plannedDisplay; recover the factor so the
  // on-screen amount keeps tracking the slider while the user drags.
  const factor = plannedBaseline > 0 ? plannedDisplay / plannedBaseline : 1;
  const liveDisplay = scales ? Math.round(editValue * factor) : editValue;

  // Slider step — fine enough for big budgets, coarse enough not to spam.
  const step = sliderMax >= 5_000_000 ? 25_000 : 10_000;

  // Per-guest unit for cross-coupling hint ("X Ft / fő").
  const perGuest = scales && count > 0 ? Math.round(liveDisplay / count) : null;

  const overFill = actual > liveDisplay && liveDisplay > 0;
  const fillColor = overFill
    ? "bg-blush-700"
    : actual === 0
      ? "bg-paper-300"
      : actual >= 100_000
        ? "bg-blush-500"
        : "bg-blush-300";

  async function commit(next: number) {
    if (!onEditPlanned || next === plannedBaseline) {
      setLocalValue(null);
      return;
    }
    setSaving(true);
    try {
      await onEditPlanned(category, next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-3 text-sm sm:grid-cols-[1.5rem_minmax(0,1fr)]">
      <Icon size={16} className="mt-0.5 text-ink-500" aria-hidden />
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-ink-700">{t(`budget.cat.${category}`)}</span>
          <span className="stat-num whitespace-nowrap text-xs font-medium text-ink-700">
            {formatHuf(actual, locale)}
            <span className="text-ink-400"> / {formatHuf(liveDisplay, locale)}</span>
          </span>
        </div>

        {/* Slider track + actual-fill underneath. The actual-fill is
            absolute-positioned behind the slider so the user sees how much of
            their planned budget is already spent. */}
        <div className="relative mt-2 h-4">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-paper-200">
            <div
              className={`h-full rounded-full transition-all ${fillColor}`}
              style={{
                width: `${Math.min(100, liveDisplay > 0 ? (actual / Math.max(liveDisplay, 1)) * 100 : 0)}%`,
              }}
            />
          </div>
          <input
            type="range"
            min={0}
            max={sliderMax}
            step={step}
            value={editValue}
            disabled={!editable || saving}
            onChange={(e) => setLocalValue(Number(e.target.value))}
            onMouseUp={(e) => commit(Number(e.currentTarget.value))}
            onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
            onKeyUp={(e) => commit(Number(e.currentTarget.value))}
            className="relative block h-4 w-full cursor-pointer appearance-none bg-transparent accent-blush-500 disabled:cursor-not-allowed"
            aria-label={t("budget.edit_planned_aria", {
              category: t(`budget.cat.${category}`),
            })}
          />
        </div>

        {perGuest !== null && (
          <p className="mt-0.5 text-[11px] text-ink-400">
            {t("budget.per_guest_unit", { n: formatNumber(perGuest, locale) })}
          </p>
        )}
      </div>
    </li>
  );
}
