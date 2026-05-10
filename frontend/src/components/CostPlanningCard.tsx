// Shared cost-planning panel — guest-count slider that re-prices per-guest
// categories live, plus per-category bars with inline editable planned amounts.
// Used by the Dashboard and Budget pages.

import type { BudgetCategory, BudgetLine } from "@shared/types";
import { Check, Info, Pencil, X } from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { formatHuf, formatHufCompact, formatNumber } from "../lib/format";
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
  /** Called when the user inline-edits a category's planned amount. The
   *  parent decides how to apply it (create a line, update a single line, or
   *  proportionally scale multiple lines). */
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
}) {
  const { t, locale } = useT();

  // Slider range: ±50% around baseline, snapped to 5-guest steps.
  const minCount = Math.max(10, Math.round((baseline * 0.5) / 5) * 5);
  const maxCount = Math.max(baseline + 20, Math.round((baseline * 1.5) / 5) * 5);

  // Aggregate lines into category buckets, scaling per-guest categories by
  // the slider's deviation from baseline.
  const buckets = useMemo(() => {
    const factor = baseline > 0 ? count / baseline : 1;
    const map = new Map<BudgetCategory, { planned: number; actual: number }>();
    for (const l of lines) {
      const cur = map.get(l.category) ?? { planned: 0, actual: 0 };
      map.set(l.category, {
        planned: cur.planned + l.planned_huf,
        actual: cur.actual + l.actual_huf,
      });
    }
    return Array.from(map.entries())
      .map(([cat, v]) => ({
        category: cat,
        actual: v.actual,
        // The bar shows the *projected* planned (slider-scaled); inline edit
        // operates on the raw baseline value so the math doesn't drift.
        plannedDisplay: PER_GUEST_CATEGORIES.has(cat) ? Math.round(v.planned * factor) : v.planned,
        plannedBaseline: v.planned,
        scales: PER_GUEST_CATEGORIES.has(cat),
      }))
      .filter((b) => b.plannedDisplay > 0 || b.actual > 0)
      .sort((a, b) => b.plannedDisplay - a.plannedDisplay);
  }, [lines, count, baseline]);

  const totalPlanned = buckets.reduce((s, b) => s + b.plannedDisplay, 0);
  const totalActual = buckets.reduce((s, b) => s + b.actual, 0);
  const overCap = cap !== null && totalPlanned > cap;
  const overage = overCap && cap !== null ? totalPlanned - cap : 0;

  return (
    <section className="card">
      {/* Top-of-card warning strip when over cap. */}
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

      <ul className="mt-6 space-y-3">
        {buckets.map((b) => (
          <CategoryBar
            key={b.category}
            category={b.category}
            plannedDisplay={b.plannedDisplay}
            plannedBaseline={b.plannedBaseline}
            actual={b.actual}
            onEditPlanned={onEditPlanned}
          />
        ))}
        {buckets.length === 0 && (
          <li className="py-4 text-center text-sm text-ink-500">{t("budget.lines_empty")}</li>
        )}
      </ul>

      <div className="mt-6 border-t border-paper-200 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink-700">{t("budget.total_actual")}</span>
          <span
            className={`stat-num text-2xl font-semibold ${overCap ? "text-blush-700" : "text-ink-900"}`}
          >
            {formatHufCompact(totalActual, locale)}
            <span className={overCap ? "text-blush-400" : "text-ink-400"}>
              {" / "}
              {formatHufCompact(totalPlanned, locale)} Ft
            </span>
          </span>
        </div>
        {cap !== null && (
          <div className="mt-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-500">{t("budget.cap")}</span>
            <span className={overCap ? "text-blush-700" : "text-ink-500"}>
              {formatHufCompact(cap, locale)} Ft
              {overCap && ` · ${t("budget.over_budget")}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryBar({
  category,
  plannedDisplay,
  plannedBaseline,
  actual,
  onEditPlanned,
}: {
  category: BudgetCategory;
  plannedDisplay: number;
  plannedBaseline: number;
  actual: number;
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
}) {
  const { t, locale } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const denom = Math.max(plannedDisplay, 1);
  const pct = Math.min(100, (actual / denom) * 100);
  const overFill = actual > plannedDisplay && plannedDisplay > 0;

  // Bigger spends get the bolder fill, mirroring the mockup's two-tone bars.
  const fillColor = overFill
    ? "bg-blush-700"
    : actual === 0
      ? "bg-paper-300"
      : actual >= 100_000
        ? "bg-blush-500"
        : "bg-blush-300";

  function startEdit() {
    setDraft(formatNumber(plannedBaseline, locale));
    setEditing(true);
  }

  async function commit() {
    if (!onEditPlanned) {
      setEditing(false);
      return;
    }
    const parsed = parsePlannedDigits(draft);
    if (parsed === null || parsed === plannedBaseline) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onEditPlanned(category, parsed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") setEditing(false);
  }

  return (
    <li className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <span className="truncate text-ink-700">{t(`budget.cat.${category}`)}</span>
      <div className="h-2 w-full overflow-hidden rounded-full bg-paper-200">
        <div
          className={`h-full rounded-full transition-all ${fillColor}`}
          style={{ width: `${Math.max(plannedDisplay > 0 ? 2 : 0, pct)}%` }}
        />
      </div>
      <span className="stat-num flex items-center gap-1 whitespace-nowrap text-xs font-medium text-ink-700">
        {formatHufCompact(actual, locale)}
        <span className="text-ink-400">/</span>
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              disabled={saving}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              className="stat-num w-20 rounded border border-paper-400 bg-white px-1 py-0.5 text-right text-xs"
              aria-label={t("budget.edit_planned_aria", {
                category: t(`budget.cat.${category}`),
              })}
            />
            <button
              type="button"
              className="text-blush-700 hover:text-blush-800"
              onClick={commit}
              disabled={saving}
              aria-label={t("common.save")}
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              className="text-ink-400 hover:text-ink-700"
              onClick={() => setEditing(false)}
              disabled={saving}
              aria-label={t("common.cancel")}
            >
              <X size={12} />
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={`group inline-flex items-center gap-1 rounded px-1 py-0.5 text-ink-400 transition ${
              onEditPlanned ? "hover:bg-paper-100 hover:text-ink-700" : "cursor-default"
            }`}
            onClick={onEditPlanned ? startEdit : undefined}
            disabled={!onEditPlanned}
            aria-label={
              onEditPlanned
                ? t("budget.edit_planned_aria", {
                    category: t(`budget.cat.${category}`),
                  })
                : undefined
            }
          >
            {formatHufCompact(plannedDisplay, locale)}
            {onEditPlanned && (
              <Pencil
                size={10}
                className="opacity-0 transition group-hover:opacity-100"
                aria-hidden
              />
            )}
          </button>
        )}
      </span>
    </li>
  );
}

/** Strip whitespace + dots so HU-formatted "350 000" / "350.000" both parse. */
function parsePlannedDigits(raw: string): number | null {
  const cleaned = raw.replace(/[\s.]/g, "").replace(/,/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) return null;
  return Math.round(n);
}
