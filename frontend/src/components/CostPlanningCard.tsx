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

/** Per-row slider visual + drag constants.
 *  - `ANCHOR_BLUE_PCT`: the panel-biggest row's *committed* value paints up to
 *    this much of the column. Smaller rows scale linearly under it.
 *  - `FIXED_DRAG_HUF_RANGE`: the gray "headroom" tail beyond the committed
 *    value. Identical HUF range for every row, regardless of size — caps how
 *    far a single drag can grow the value before commit. Without this fix,
 *    rowMax compounded with each release and values shot up too fast. */
const ANCHOR_BLUE_PCT = 75;
const FIXED_DRAG_HUF_RANGE = 200_000;

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

/** Stable display order, grouped by what the couple is actually deciding
 *  about together — keeps related rows adjacent so scanning down the list
 *  feels less random than "biggest first". Clusters:
 *    1. hosting & food         (venue → cake)
 *    2. guest experience       (favours, stationery, transport)
 *    3. couple's appearance    (attire, hair & makeup, rings)
 *    4. atmosphere & memories  (photo, music, decor)
 *    5. after-wedding & misc   (honeymoon, other) */
const CATEGORY_ORDER: BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "cake_dessert",
  "favours",
  "stationery",
  "transport",
  "attire",
  "hair_makeup",
  "rings",
  "photo_video",
  "music_dj",
  "decor_floral",
  "honeymoon",
  "other",
];

export function CostPlanningCard({
  lines,
  baseline,
  boundsMin,
  boundsMax,
  cap,
  count,
  onCountChange,
  onBoundsChange,
  onEditPlanned,
  onCapChange,
}: {
  lines: BudgetLine[];
  baseline: number;
  /** Lower bound of the headcount slider. Comes from couple.guest_count_goal so
   *  both /app and /app/budget show the same number — see DashboardPage /
   *  BudgetPage `guestCountBounds()`. */
  boundsMin: number;
  /** Upper bound of the headcount slider. Same source as boundsMin. */
  boundsMax: number;
  cap: number | null;
  count: number;
  onCountChange: (n: number) => void;
  /** Called when the user commits a new min or max on the bounds inputs.
   *  The parent persists `guest_count_goal = { kind: "range", min, max }`
   *  so both pages stay synchronised. Optional — bounds become read-only
   *  when omitted. */
  onBoundsChange?: (min: number, max: number) => void | Promise<void>;
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

  // Slider bounds — sourced from the couple's guest_count_goal via parent
  // props so /app and /app/budget show identical numbers. The two small
  // inputs under the slider commit changes back through onBoundsChange,
  // which the parents persist to the backend.
  const minCount = boundsMin;
  const maxCount = boundsMax;
  const commitMin = (v: number) => onBoundsChange?.(v, maxCount);
  const commitMax = (v: number) => onBoundsChange?.(minCount, v);

  // Anchor for the per-row slider WIDTH. Computed from the *peak* possible
  // value each row can reach (baseline value × max-headcount factor for
  // per-guest rows, plain baseline value for fixed). Stable across headcount
  // changes — so when the headcount slider moves, per-guest row sliders grow
  // and shrink visibly instead of all proportionally locking together.
  const widthAnchor = useMemo(() => {
    const maxFactor = baseline > 0 ? maxCount / baseline : 1;
    let peak = 0;
    for (const b of buckets) {
      const rowPeak = b.scales ? Math.round(b.plannedBaseline * maxFactor) : b.plannedBaseline;
      if (rowPeak > peak) peak = rowPeak;
    }
    return Math.max(peak, 100_000);
  }, [buckets, baseline, maxCount]);

  // If the user narrows the bounds below the current slider value, clamp
  // it back into range so the thumb doesn't pin off the track.
  useEffect(() => {
    if (count < minCount) onCountChange(minCount);
    else if (count > maxCount) onCountChange(maxCount);
  }, [count, minCount, maxCount, onCountChange]);

  // Single-line status: under/over budget by HUF amount. Coloured red when
  // over so the cap state is readable at a glance from the headline alone.
  const underAmount = cap !== null && !overCap ? cap - totalPlanned : 0;

  // Arithmetic midpoint of the editable bounds, rounded to nearest 5 — the
  // "where 75 vendég sits" tick under the slider, distinct from the live
  // count shown big and centred above.
  const midCount = Math.round((minCount + maxCount) / 2 / 5) * 5;

  return (
    <section className="card pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
          {t("budget.cost_planning_headline")}
        </p>
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

      {/* Big centred live count — number large, "vendég" small below. The
       *  negative top margin pulls the number up under the eyebrow row so
       *  the empty band between them stays minimal. */}
      <div className="-mt-1 text-center">
        <div className="font-serif text-4xl leading-none text-ink-900 sm:text-5xl">
          {formatNumber(count, locale)}
        </div>
        <div className="mt-1 text-xs uppercase tracking-wide text-ink-500">
          {t("budget.cost_planning_unit_label")}
        </div>
      </div>

      {/* Headcount slider — compact single block. */}
      <div className="mt-4">
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
            onCommit={commitMin}
            ariaLabel={t("budget.slider_min_aria")}
            readOnly={!onBoundsChange}
          />
          {/* Midpoint of bounds, snapped to 5 — the geometric centre of the slider. */}
          <span className="stat-num">{formatNumber(midCount, locale)}</span>
          <CountInput
            value={maxCount}
            min={minCount + 5}
            max={2000}
            onCommit={commitMax}
            ariaLabel={t("budget.slider_max_aria")}
            readOnly={!onBoundsChange}
          />
        </div>
      </div>

      {/* Per-category sliders — single line per category, denser spacing. */}
      <ul className="mt-4 divide-y divide-paper-100">
        {buckets.map((b) => (
          <CategoryRow
            key={b.category}
            category={b.category}
            plannedBaseline={b.plannedBaseline}
            actual={b.actual}
            scales={b.scales}
            // Per-guest categories receive the live headcount factor so the
            // slider thumb tracks the count slider and a drag preserves the
            // /fő unit price (not the baseline planned amount).
            scaleFactor={b.scales ? factor : 1}
            count={count}
            widthAnchor={widthAnchor}
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
  plannedBaseline,
  actual,
  scales,
  scaleFactor,
  count,
  widthAnchor,
  onEditPlanned,
}: {
  category: BudgetCategory;
  plannedBaseline: number;
  actual: number;
  scales: boolean;
  /** Live count/baseline ratio for per-guest categories (1 for fixed). The
   *  per-row slider lives in *display* units, so we use this both to convert
   *  the drag input back to baseline before persisting and to keep the /fő
   *  unit price stable when only the headcount changes. */
  scaleFactor: number;
  count: number;
  /** Current biggest row value (in display units). The slider's CSS width is
   *  scaled relative to this so the rows read like a horizontal bar chart.
   *  Floored upstream so it never hits zero. */
  widthAnchor: number;
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
}) {
  const { t, locale } = useT();
  // Local drag state — slider feels instant; commit fires on release only.
  // Stored in *baseline* units so we don't drift when the headcount changes
  // mid-drag (rare, but tidier).
  const [localValue, setLocalValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Drop any local drag state when the upstream baseline changes (e.g. lines
  // refetched, sibling row saved, headcount slider scaled the value).
  useEffect(() => {
    if (!saving) setLocalValue(null);
  }, [plannedBaseline, saving]);

  const Icon = CATEGORY_ICONS[category];
  const editable = !!onEditPlanned;

  const editBaseline = localValue ?? plannedBaseline;
  // Slider operates in display units so the thumb tracks the headcount
  // slider for per-guest categories — drag a per-fő rate, the total moves.
  const liveDisplay = Math.round(editBaseline * scaleFactor);
  // Committed display value drives the slider's CSS width + max so the track
  // stays *stable while dragging* — only the gradient fill animates with
  // localValue. The slider re-sizes after commit.
  const plannedDisplay = Math.round(plannedBaseline * scaleFactor);

  // Drag headroom is a *fixed HUF amount* — one drag can grow the value by
  // at most FIXED_DRAG_HUF_RANGE before release. No compounding rowMax.
  const rowMax = plannedDisplay + FIXED_DRAG_HUF_RANGE;
  // Slider always spans the full row — the user asked for the gray track to
  // reach the right edge of every row rather than ending early on small
  // categories. We keep widthAnchor referenced in the panel-level peak math
  // so the per-row drag step / formatting stays stable, but the row's CSS
  // width is now constant.
  void widthAnchor;
  const widthPct = 100;
  // Gradient fill follows the LIVE value so dragging feels instant; the
  // slider element itself stays the same width during a drag.
  const fillPct = rowMax > 0 ? Math.max(0, Math.min(100, (liveDisplay / rowMax) * 100)) : 0;

  // Slider step — fine enough for big budgets, coarse enough not to spam.
  const step = rowMax >= 1_000_000 ? 25_000 : 10_000;

  // Per-guest unit for the cross-coupling hint.
  const perGuest = scales && count > 0 ? Math.round(liveDisplay / count) : null;

  // Drag input is in display units. Convert back to baseline before storing,
  // so the saved planned amount is normalised to the couple's baseline guest
  // count regardless of where the headcount slider currently sits.
  function applyScaledDrag(scaledNew: number) {
    const baselineNew = scaleFactor > 0 ? Math.round(scaledNew / scaleFactor) : scaledNew;
    setLocalValue(baselineNew);
  }

  async function commit(scaledNext: number) {
    if (!onEditPlanned) {
      setLocalValue(null);
      return;
    }
    const baselineNext = scaleFactor > 0 ? Math.round(scaledNext / scaleFactor) : scaledNext;
    if (baselineNext === plannedBaseline) {
      setLocalValue(null);
      return;
    }
    setSaving(true);
    try {
      await onEditPlanned(category, baselineNext);
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
      {/* The wrapper takes the full grid cell; the input is width-scaled to
       *  read like a horizontal bar chart. Width is fixed by the *committed*
       *  value (stable during drag); only the gradient fill animates as the
       *  user drags. The gray tail (FIXED_DRAG_HUF_RANGE worth of HUF) is
       *  constant across rows so single-drag escalation is capped. */}
      <div className="w-full">
        <input
          type="range"
          min={0}
          max={rowMax}
          step={step}
          value={liveDisplay}
          disabled={!editable || saving}
          onChange={(e) => applyScaledDrag(Number(e.target.value))}
          onMouseUp={(e) => commit(Number(e.currentTarget.value))}
          onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          className="range-fill range-fill-thin block"
          style={{
            width: `${widthPct}%`,
            background: `linear-gradient(to right, #243150 0%, #243150 ${fillPct}%, #efe9d9 ${fillPct}%, #efe9d9 100%)`,
          }}
          aria-label={t("budget.edit_planned_aria", {
            category: t(`budget.cat.${category}`),
          })}
        />
      </div>
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
  readOnly = false,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  ariaLabel: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    if (readOnly) return;
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
      readOnly={readOnly}
      value={draft}
      onFocus={(e) => {
        if (!readOnly) e.currentTarget.select();
      }}
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
