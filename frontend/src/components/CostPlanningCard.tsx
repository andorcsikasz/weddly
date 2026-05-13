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
  Eye,
  EyeOff,
  Flower2,
  Gift,
  Home,
  Lock,
  Mail,
  MoreHorizontal,
  Music,
  Plane,
  Scissors,
  Shirt,
  UtensilsCrossed,
  Wine,
} from "lucide-react";
import { type ComponentType, type CSSProperties, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

// (Visual constants previously lived here — per-row tuning is now derived
//  from `widthAnchor` directly so every row shares the same denominator.)

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

/** Pure escalation classifier for the over-cap warning. `safe` when planned
 *  ≤ cap; `soft` when 0–5 % over (noise — calm dot, no alarm); `medium` when
 *  5–20 % over (blush pill); `serious` when >20 % over (pill + action link).
 *  Lifted to a helper so it's trivially unit-testable later. */
export function overCapTier(
  planned: number,
  cap: number | null,
): "safe" | "soft" | "medium" | "serious" {
  if (cap === null || cap <= 0 || planned <= cap) return "safe";
  const pctOver = ((planned - cap) / cap) * 100;
  if (pctOver <= 5) return "soft";
  if (pctOver <= 20) return "medium";
  return "serious";
}

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
  frozenCategories,
  onToggleFreeze,
  amountLinkTo,
  showActualToggle = false,
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
  /** Categories the couple has frozen. Frozen rows render with a lock badge,
   *  disable the slider, ignore the headcount per-guest rescale, and route
   *  the amount click straight to /app/budget for exact entry. */
  frozenCategories?: ReadonlySet<BudgetCategory>;
  /** Toggles freeze state for a category. Parent persists via couplesApi. */
  onToggleFreeze?: (category: BudgetCategory) => void | Promise<void>;
  /** When set, the per-row amount becomes a link to this base path with the
   *  category appended as a hash (e.g. `/app/budget#cat-venue`). Used on the
   *  dashboard to route precise entries into the budget table. */
  amountLinkTo?: string;
  /** Surface a header toggle that overlays a non-interactive red bar under
   *  each category slider showing the live `actual_huf` total — a "what have
   *  we already spent?" second view layer. Only /app/budget passes `true`;
   *  the dashboard hides the toggle to keep the panel compact. */
  showActualToggle?: boolean;
}) {
  const { t, locale } = useT();
  // Second-layer overlay: when on, each category row renders a thin red bar
  // under the planned slider showing the actual spend. Local state — no
  // persistence; toggling is cheap and most users won't keep it on.
  const [showActualOverlay, setShowActualOverlay] = useState(false);
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
      const frozen = frozenCategories?.has(cat) ?? false;
      // Frozen categories opt out of per-guest scaling — the user has pinned
      // a real-world quote and doesn't want it sliding around with the count.
      const scales = isPerGuest && !frozen;
      return {
        category: cat,
        actual: v.actual,
        // Display planned = baseline planned scaled for per-guest categories.
        plannedDisplay: scales ? Math.round(v.planned * factor) : v.planned,
        plannedBaseline: v.planned,
        scales,
        frozen,
      };
    });
  }, [lines, factor, frozenCategories]);

  const totalPlanned = buckets.reduce((s, b) => s + b.plannedDisplay, 0);
  const totalActual = buckets.reduce((s, b) => s + b.actual, 0);
  const overCap = cap !== null && totalPlanned > cap;
  const overage = overCap && cap !== null ? totalPlanned - cap : 0;
  // Escalation tier replaces the binary blush pill. `safe` keeps the
  // "under by" copy; everything else flips the eyebrow stat to over-cap.
  const tier = overCapTier(totalPlanned, cap);

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

  // Whether the overlay actually has anything to show. Without it we keep the
  // toggle clickable so the user understands the feature exists, but skip the
  // empty red bars on every row.
  const hasAnyActual = totalActual > 0;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500">
          {t("budget.cost_planning_headline")}
        </p>
        <div className="flex items-center gap-3">
          {showActualToggle && (
            // Icon-only toggle for the actual-overlay. The eye-on/eye-off
            // glyph carries the state; the red ring when active picks up the
            // overlay's red stroke colour so they read as a single affordance.
            // Title + aria-label keep the action discoverable for keyboard
            // and screen-reader users.
            <button
              type="button"
              onClick={() => setShowActualOverlay((v) => !v)}
              aria-pressed={showActualOverlay}
              aria-label={t(
                showActualOverlay ? "budget.hide_actual_overlay" : "budget.show_actual_overlay",
              )}
              title={t(
                showActualOverlay ? "budget.hide_actual_overlay" : "budget.show_actual_overlay",
              )}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 ${
                showActualOverlay
                  ? "border-red-500 bg-red-50 text-red-700 hover:bg-red-100"
                  : "border-paper-300 text-ink-500 hover:border-paper-400 hover:text-ink-700"
              }`}
            >
              {showActualOverlay ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            </button>
          )}
          {cap !== null &&
            (tier === "safe" ? (
              <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-ink-600">
                <ArrowDown size={12} className="self-center" aria-hidden />
                {t("budget.under_by", { amount: formatHuf(underAmount, locale) })}
              </span>
            ) : tier === "soft" ? (
              // 0–5 % over: calm amber dot, no blush pill — well within the
              // noise floor of cap accuracy, so the warning is muted on purpose.
              <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-ink-600">
                <span
                  className="inline-block h-2 w-2 self-center rounded-full bg-amber-500"
                  aria-hidden="true"
                />
                {t("cost_planning.overcap_soft_label")}
              </span>
            ) : (
              // medium (5–20 %) + serious (>20 %): same blush pill; the serious
              // tier adds an action link below the card total. Keeping the pill
              // shape stable across tiers preserves the visual anchor.
              <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-blush-700">
                <ArrowUp size={12} className="self-center" aria-hidden />
                {t("cost_planning.overcap_medium_label", { amount: formatHuf(overage, locale) })}
              </span>
            ))}
        </div>
      </div>

      {/* Big centred live count — number large, "vendég" small below. The
       *  negative top margin pulls the number up flush under the eyebrow row
       *  so there's no empty band between them. */}
      <div className="-mt-3 text-center">
        <div className="font-serif text-4xl leading-none text-ink-900 sm:text-5xl">
          {formatNumber(count, locale)}
        </div>
        <div className="mt-0.5 text-xs uppercase tracking-wide text-ink-500">
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

      {/* Per-category sliders — single line per category, denser spacing.
       *  Honeymoon is the one exception: its lines live on /app/honeymoon
       *  (a dedicated sub-page with its own breakdown + map), so we show
       *  the same row visual here but route the click through and skip
       *  the slider input — no in-place drag. */}
      <ul className="mt-4 divide-y divide-paper-100">
        {buckets.map((b) => (
          <CategoryRow
            key={b.category}
            category={b.category}
            plannedBaseline={b.plannedBaseline}
            actual={b.actual}
            scales={b.scales}
            frozen={b.frozen}
            // Per-guest categories receive the live headcount factor so the
            // slider thumb tracks the count slider and a drag preserves the
            // /fő unit price (not the baseline planned amount). Frozen rows
            // pass `scales=false` so the factor is 1 — no rescale.
            scaleFactor={b.scales ? factor : 1}
            count={count}
            widthAnchor={widthAnchor}
            onEditPlanned={onEditPlanned}
            onToggleFreeze={onToggleFreeze}
            amountLinkTo={amountLinkTo}
            showActualOverlay={showActualOverlay && hasAnyActual}
            linkTo={b.category === "honeymoon" ? "/app/honeymoon" : undefined}
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
          <div className="mt-1 flex items-baseline justify-between text-[11px]">
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
        {/* Serious tier (>20 % over): the pill alone is too easy to dismiss,
         *  so we add a deep link to the category sliders sorted by overage.
         *  BudgetPage doesn't read the #top-overage hash today — the link
         *  navigates and trusts the user to scroll; wiring the scroll
         *  selector lives in BudgetPage and is Agent B's territory. */}
        {tier === "serious" && (
          <div className="mt-1.5 text-[11px]">
            <Link
              to="/app/budget#top-overage"
              className="text-blush-700 underline-offset-2 hover:text-blush-800 hover:underline"
            >
              {t("cost_planning.overcap_serious_action")}
            </Link>
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
  frozen,
  scaleFactor,
  count,
  widthAnchor,
  onEditPlanned,
  onToggleFreeze,
  amountLinkTo,
  showActualOverlay = false,
  linkTo,
}: {
  category: BudgetCategory;
  plannedBaseline: number;
  actual: number;
  scales: boolean;
  /** Frozen — slider is read-only, per-guest scaling is off, the left side
   *  shows a lock affordance, and the planned amount stays pinned. */
  frozen: boolean;
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
  onToggleFreeze?: (category: BudgetCategory) => void | Promise<void>;
  /** When set, the per-row amount is rendered as a Link to
   *  `${amountLinkTo}#cat-${category}` so a tap routes the user to the budget
   *  table for precise entry. Used on the dashboard. */
  amountLinkTo?: string;
  /** When `true`, a thin non-interactive red bar appears under the planned
   *  slider showing the actual spend (sum of `actual_huf` for this category)
   *  scaled by the same `widthAnchor`. Toggled via the panel header. */
  showActualOverlay?: boolean;
  /** When set, the row is non-interactive (no slider drag) and the whole
   *  row clicks through to this internal route. Used for honeymoon — its
   *  sub-categories live on /app/honeymoon, so we route there instead of
   *  duplicating editing here. */
  linkTo?: string;
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

  // Every row shares `widthAnchor` (the panel's peak possible row value) as
  // its slider denominator. Two consequences this fix relies on:
  //   1. **No commit jump.** Both during drag and after release, the fill
  //      position uses the same formula `liveDisplay / widthAnchor`. The
  //      previous formula used `liveDisplay / (plannedDisplay + 200k)`,
  //      whose denominator shifted on release — same value, different fill,
  //      visible jump.
  //   2. **Proportional rows.** With one shared denominator, each row's
  //      filled segment is linearly proportional to its value — a 1.2 M
  //      row fills twice as much rail as a 600 k row, instead of every row
  //      being squashed near 100 % by its own narrow rowMax.
  const rowMax = widthAnchor;
  const widthPct = 100;
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

  // Track gradient + dimensions are computed identically in both modes so
  // the link-mode honeymoon row reads as the same bar chart as the rest.
  const trackStyle: CSSProperties = {
    width: `${widthPct}%`,
    background: `linear-gradient(to right, #243150 0%, #243150 ${fillPct}%, #efe9d9 ${fillPct}%, #efe9d9 100%)`,
  };

  const categoryLabel = t(`budget.cat.${category}`);
  const canToggleFreeze = !!onToggleFreeze && !linkTo;
  const sliderDisabled = !editable || saving || frozen;

  // Left tile — icon + name. Doubles as the freeze toggle on non-link rows
  // (honeymoon routes the whole row through to /app/honeymoon, so its left
  // tile stays inert). When frozen, a tiny lock badge replaces the icon's
  // ink-500 with the blush tint so the row reads as pinned at a glance.
  const leftTileContent = (
    <>
      {frozen ? (
        <Lock size={14} className="shrink-0 text-blush-700" aria-hidden />
      ) : (
        <Icon size={14} className="shrink-0 text-ink-500" aria-hidden />
      )}
      <span className={`truncate ${frozen ? "text-blush-700" : ""}`}>{categoryLabel}</span>
    </>
  );

  const leftTile = canToggleFreeze ? (
    <button
      type="button"
      onClick={() => onToggleFreeze?.(category)}
      className={`flex items-center gap-2 text-left text-ink-700 transition hover:text-ink-900 ${
        frozen ? "text-blush-700 hover:text-blush-800" : ""
      }`}
      aria-pressed={frozen}
      aria-label={t(frozen ? "budget.unfreeze_aria" : "budget.freeze_aria", {
        category: categoryLabel,
      })}
    >
      {leftTileContent}
    </button>
  ) : (
    <span className="flex items-center gap-2 text-ink-700">{leftTileContent}</span>
  );

  // Right tile — the amount. On the dashboard we promote this to a Link so a
  // tap on the number routes the user to /app/budget for precise entry; the
  // hash drops them at the matching category section.
  const amountInner = (
    <>
      {actual > 0 && <span className="text-ink-400">{formatHuf(actual, locale)} / </span>}
      <span className="font-medium">{formatHuf(liveDisplay, locale)}</span>
      {perGuest !== null && (
        <span className="text-[11px] text-ink-400">
          {" · "}
          {t("budget.per_guest_unit", { n: formatNumber(perGuest, locale) })}
        </span>
      )}
    </>
  );

  const amountTile =
    amountLinkTo && !linkTo ? (
      <Link
        to={`${amountLinkTo}#cat-${category}`}
        className="stat-num whitespace-nowrap rounded text-right text-xs text-ink-700 underline-offset-2 transition hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200"
        aria-label={t("budget.open_table_aria", { category: categoryLabel })}
      >
        {amountInner}
      </Link>
    ) : (
      <span className="stat-num whitespace-nowrap text-right text-xs text-ink-700">
        {amountInner}
      </span>
    );

  const trackEl = linkTo ? (
    // Lookalike static bar — same height/radius/gradient as the real slider,
    // but no thumb and no input affordance. The whole row is the click
    // target (Link wrapper below), so the bar reads as a chart entry.
    <div className="range-fill range-fill-thin block" style={trackStyle} aria-hidden="true" />
  ) : (
    <input
      type="range"
      min={0}
      max={rowMax}
      step={step}
      value={liveDisplay}
      disabled={sliderDisabled}
      onChange={(e) => applyScaledDrag(Number(e.target.value))}
      onMouseUp={(e) => commit(Number(e.currentTarget.value))}
      onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
      onKeyUp={(e) => commit(Number(e.currentTarget.value))}
      className={`range-fill range-fill-thin block ${frozen ? "cursor-not-allowed opacity-60" : ""}`}
      style={trackStyle}
      aria-label={t("budget.edit_planned_aria", { category: categoryLabel })}
    />
  );

  // Actual-spend overlay: a thin red lookalike-slider rendered under the real
  // one, fill width tied to the same widthAnchor as planned so the two bars
  // are visually comparable at a glance. Non-interactive — `aria-hidden`
  // keeps it out of the AT tree (the actual amount is already in the right
  // tile copy). Clamped to 100% so over-spend doesn't bleed past the row.
  const actualFillPct = rowMax > 0 ? Math.max(0, Math.min(100, (actual / rowMax) * 100)) : 0;
  const actualOverlayStyle: CSSProperties = {
    width: `${widthPct}%`,
    background: `linear-gradient(to right, #dc2626 0%, #dc2626 ${actualFillPct}%, #fef2f2 ${actualFillPct}%, #fef2f2 100%)`,
  };
  const actualOverlayEl =
    showActualOverlay && actual > 0 ? (
      <div
        className="range-fill range-fill-thin mt-1 block"
        style={actualOverlayStyle}
        aria-hidden="true"
      />
    ) : null;

  if (linkTo) {
    return (
      <li>
        <Link
          to={linkTo}
          className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-3 py-1.5 text-xs transition hover:bg-paper-50 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:text-sm -mx-2 px-2 rounded-md"
          aria-label={categoryLabel}
        >
          <span className="flex items-center gap-2 text-ink-700">{leftTileContent}</span>
          <div className="w-full">
            {trackEl}
            {actualOverlayEl}
          </div>
          <span className="stat-num whitespace-nowrap text-right text-xs text-ink-700">
            {amountInner}
          </span>
        </Link>
      </li>
    );
  }

  return (
    <li
      id={`cat-${category}`}
      className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] scroll-mt-24 items-center gap-3 py-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:text-sm"
    >
      {leftTile}
      <div className="w-full">
        {trackEl}
        {actualOverlayEl}
      </div>
      {amountTile}
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
