// Shared cost-planning panel — guest-count slider plus a slider per category.
// Used by the Dashboard and Budget pages. Per-guest categories cross-couple
// with the headcount slider (move headcount → catering/drinks/etc. rescale).

import type { BudgetCategory, BudgetLine } from "@shared/types";
import {
  ArrowDown,
  ArrowUp,
  Cake,
  Camera,
  Car,
  Circle,
  Flower2,
  Gift,
  Home,
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

/** Build a left-fill gradient for `<input type="range">`. Native ranges only
 *  paint the thumb via `accent-color` (and patchily fill the track on Firefox
 *  but not Chrome/Safari), so we paint the filled portion ourselves via an
 *  inline gradient. Pair with the `.range-fill` component class. */
function rangeFillStyle(value: number, min: number, max: number): { background: string } {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  // ink-700 → paper-200 hard stop at the thumb position.
  return {
    background: `linear-gradient(to right, #243150 0%, #243150 ${pct}%, #efe9d9 ${pct}%, #efe9d9 100%)`,
  };
}

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
  onCapChange,
}: {
  lines: BudgetLine[];
  baseline: number;
  cap: number | null;
  count: number;
  onCountChange: (n: number) => void;
  /** Called when the user releases a category slider with a new amount.
   *  The parent applies it to the underlying budget lines. */
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
  /** Called when the user inline-edits the budget cap. The parent persists
   *  it via `coupleApi.update({ budget_goal: ... })`. */
  onCapChange?: (newCapHuf: number) => Promise<void>;
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

  // Slider bounds — editable via the small inputs under the slider. Initial
  // values are ±50% around the parent's baseline (snapped to 5). Local state
  // only; the parent's `baseline` stays the math anchor for per-guest scaling.
  const [minCount, setMinCount] = useState(() =>
    Math.max(10, Math.round((baseline * 0.5) / 5) * 5),
  );
  const [maxCount, setMaxCount] = useState(() =>
    Math.max(baseline + 20, Math.round((baseline * 1.5) / 5) * 5),
  );

  // If the user narrows the bounds below the current slider value, clamp
  // it back into range so the thumb doesn't pin off the track.
  useEffect(() => {
    if (count < minCount) onCountChange(minCount);
    else if (count > maxCount) onCountChange(maxCount);
  }, [count, minCount, maxCount, onCountChange]);

  // Single-line status: under/over budget by HUF amount. Coloured red when
  // over so the cap state is readable at a glance from the headline alone.
  const underAmount = cap !== null && !overCap ? cap - totalPlanned : 0;

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="font-serif text-xl">
          {t("budget.cost_planning_with_count", { n: formatNumber(count, locale) })}
        </h2>
        {cap !== null &&
          (overCap ? (
            <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-blush-700">
              <ArrowUp size={12} className="self-center" aria-hidden />
              {t("budget.over_by", { amount: formatHuf(overage, locale) })}
            </span>
          ) : (
            <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-ink-600">
              <ArrowDown size={12} className="self-center" aria-hidden />
              {t("budget.under_by", { amount: formatHuf(underAmount, locale) })}
            </span>
          ))}
      </div>

      {/* Headcount slider — compact single block. */}
      <div className="mt-3">
        <input
          type="range"
          min={minCount}
          max={maxCount}
          step={1}
          value={count}
          onChange={(e) => onCountChange(Number(e.target.value))}
          className="range-fill block w-full"
          style={rangeFillStyle(count, minCount, maxCount)}
          aria-label={t("budget.cost_planning_title")}
        />
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-400">
          <CountInput
            value={minCount}
            min={10}
            max={maxCount - 5}
            onCommit={setMinCount}
            ariaLabel={t("budget.slider_min_aria")}
          />
          <span>{t("budget.cost_planning_baseline_note", { n: formatNumber(count, locale) })}</span>
          <CountInput
            value={maxCount}
            min={minCount + 5}
            max={2000}
            onCommit={setMaxCount}
            ariaLabel={t("budget.slider_max_aria")}
          />
        </div>
      </div>

      {/* Per-category sliders — single line per category, denser spacing. */}
      <ul className="mt-4 divide-y divide-paper-100">
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

      <div className="mt-4 border-t border-paper-200 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {/* Label tracks what's actually shown — pure planned vs. actual/planned. */}
            {totalActual > 0 ? t("budget.total_actual") : t("budget.total_planned")}
          </span>
          <span
            className={`stat-num text-xl font-semibold ${overCap ? "text-blush-700" : "text-ink-900"}`}
          >
            {totalActual > 0 && (
              <span className={`text-sm ${overCap ? "text-blush-400" : "text-ink-500"}`}>
                {formatHuf(totalActual, locale)} /{" "}
              </span>
            )}
            {formatHuf(totalPlanned, locale)}
          </span>
        </div>
        {/* Always render the cap row — when the couple hasn't set a ceiling
         *  during onboarding, the value slot stays empty (with a dash
         *  placeholder) so the layout doesn't shift and the user can click
         *  to fill it in here. */}
        {(cap !== null || onCapChange) && (
          <div className="mt-0.5 flex items-baseline justify-between text-[11px]">
            <span className="text-ink-400">{t("budget.cap")}</span>
            {onCapChange ? (
              <EditableHuf
                value={cap}
                onSave={onCapChange}
                ariaLabel={t("budget.cap")}
                emphasise={overCap}
              />
            ) : (
              <span className={`stat-num ${overCap ? "text-blush-700" : "text-ink-400"}`}>
                {cap !== null ? formatHuf(cap, locale) : "—"}
              </span>
            )}
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

  // Drop any local drag state when the upstream baseline changes (e.g. lines
  // refetched, sibling row saved, headcount slider scaled the value). The
  // [saving] dep keeps the existing post-save reset working when the new
  // baseline happens to equal the value we just sent.
  useEffect(() => {
    if (!saving) setLocalValue(null);
  }, [plannedBaseline, saving]);

  const Icon = CATEGORY_ICONS[category];
  const editable = !!onEditPlanned;

  const editValue = localValue ?? plannedBaseline;
  // The parent already pre-scaled plannedDisplay; recover the factor so the
  // on-screen amount keeps tracking the slider while the user drags.
  const factor = plannedBaseline > 0 ? plannedDisplay / plannedBaseline : 1;
  const liveDisplay = scales ? Math.round(editValue * factor) : editValue;

  // Slider step — fine enough for big budgets, coarse enough not to spam.
  const step = sliderMax >= 5_000_000 ? 25_000 : 10_000;

  // Per-guest unit for cross-coupling hint.
  const perGuest = scales && count > 0 ? Math.round(liveDisplay / count) : null;

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
    <li className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:text-sm">
      <span className="flex items-center gap-2 text-ink-700">
        <Icon size={14} className="shrink-0 text-ink-500" aria-hidden />
        <span className="truncate">{t(`budget.cat.${category}`)}</span>
      </span>
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
        className="range-fill range-fill-thin block w-full"
        style={rangeFillStyle(editValue, 0, sliderMax)}
        aria-label={t("budget.edit_planned_aria", {
          category: t(`budget.cat.${category}`),
        })}
      />
      <span className="stat-num whitespace-nowrap text-right text-xs text-ink-700">
        {actual > 0 && <span className="text-ink-400">{formatHuf(actual, locale)} / </span>}
        <span className="font-medium">{formatHuf(liveDisplay, locale)}</span>
        {perGuest !== null && (
          <span className="text-[11px] text-ink-400">
            {" · "}
            {t("budget.per_guest_unit", { n: formatNumber(perGuest, locale) })}
          </span>
        )}
      </span>
    </li>
  );
}

/** Editable numeric label (used for the slider's min/max). Snaps to nearest 5
 *  on commit, clamps to the supplied bounds. Underline appears on hover so
 *  the affordance is discoverable without dominating the layout. */
function CountInput({
  value,
  min,
  max,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const snapped = Math.round(n / 5) * 5;
    const clamped = Math.max(min, Math.min(max, snapped));
    if (clamped !== value) onCommit(clamped);
    setDraft(String(clamped));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        else if (e.key === "Escape") {
          setDraft(String(value));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      aria-label={ariaLabel}
      className="stat-num w-10 rounded border border-transparent bg-transparent px-1 text-center text-[11px] text-ink-400 transition hover:border-paper-300 hover:text-ink-700 focus:border-blush-500 focus:text-ink-800 focus:outline-none"
    />
  );
}

/** Inline-editable HUF amount used for the budget cap. Click to edit, type a
 *  digit-only amount (auto-grouped HU style), Enter or blur commits, Esc
 *  cancels. `emphasise` flips the colour to the over-cap warning red. Accepts
 *  null so the cap row can render an empty placeholder when no ceiling was
 *  set during onboarding. */
function EditableHuf({
  value,
  onSave,
  ariaLabel,
  placeholder,
  emphasise,
}: {
  value: number | null;
  onSave: (next: number) => Promise<void>;
  ariaLabel: string;
  /** Shown when value is null and the button is at rest. Plain dash by default. */
  placeholder?: string;
  emphasise?: boolean;
}) {
  const { locale } = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDraft(value !== null ? formatNumber(value, "hu") : "");
    setEditing(true);
  }

  async function commit() {
    const cleaned = draft.replace(/\D/g, "");
    if (cleaned === "") {
      setEditing(false);
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000 || n === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(Math.round(n));
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        disabled={saving}
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          setDraft(digits === "" ? "" : formatNumber(Number(digits), "hu"));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          else if (e.key === "Escape") setEditing(false);
        }}
        aria-label={ariaLabel}
        className="stat-num w-28 rounded border border-blush-500 bg-white px-1 py-0.5 text-right text-[11px] text-ink-900 focus:outline-none focus:ring-2 focus:ring-blush-100"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={ariaLabel}
      className={`stat-num rounded border border-transparent px-1 py-0.5 text-right transition hover:border-paper-300 ${
        emphasise ? "text-blush-700 hover:text-blush-800" : "text-ink-400 hover:text-ink-700"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200`}
    >
      {value !== null ? formatHuf(value, locale) : (placeholder ?? "—")}
    </button>
  );
}
