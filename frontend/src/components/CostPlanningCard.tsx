// Shared cost-planning panel — guest-count slider plus a slider per category.
// Used by the Dashboard and Budget pages. Per-guest categories cross-couple
// with the headcount slider (move headcount → catering/drinks/etc. rescale).

import type { BudgetCategory, BudgetLine, Currency } from "@shared/types";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Briefcase,
  Cake,
  Camera,
  Car,
  Circle,
  Flower2,
  Gift,
  Heart,
  Home,
  Lock,
  Mail,
  MoreHorizontal,
  Music,
  Plane,
  Plus,
  Receipt,
  Scissors,
  Shirt,
  ShoppingBag,
  Sparkles,
  Star,
  UtensilsCrossed,
  Users,
  Wine,
  X,
} from "lucide-react";
import {
  type ComponentType,
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { formatMoney, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";

/** Build a left-fill gradient for `<input type="range">`. Native ranges only
 *  paint the thumb via `accent-color` (and patchily fill the track on Firefox
 *  but not Chrome/Safari), so we paint the filled portion ourselves via an
 *  inline gradient. Pair with the `.range-fill` component class. Colors come
 *  from CSS vars (`--range-fill-amount` / `--range-fill-remainder`) so the
 *  fill inverts under `html.dark` (filled = bright, remainder = dark).
 *
 *  `thumbPx` aligns the gradient stop with the native thumb's centre. Browsers
 *  travel the thumb between `thumbW/2` and `width − thumbW/2`, so the raw
 *  value% diverges from the visual thumb position — visible as a fill overshoot
 *  near the middle and a fill→thumb gap near the ends. The calc-based stop
 *  pins the gradient edge to where the thumb actually paints. Pass 14 for the
 *  default thumb, 12 for `.range-fill-thin`. Static bars (no thumb at all)
 *  reuse this so they line up pixel-for-pixel with their interactive twin. */
function rangeFillStyle(
  value: number,
  min: number,
  max: number,
  thumbPx = 14,
): { background: string } {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  // offset = thumbW * (0.5 − pct/100). At pct=0 → +thumbW/2 (clear of left
  // edge); at pct=100 → −thumbW/2 (clear of right edge); at pct=50 → 0.
  const offsetPx = thumbPx * (0.5 - pct / 100);
  const stop = `calc(${pct}% + ${offsetPx.toFixed(3)}px)`;
  return {
    background: `linear-gradient(to right, var(--range-fill-amount) 0%, var(--range-fill-amount) ${stop}, var(--range-fill-remainder) ${stop}, var(--range-fill-remainder) 100%)`,
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

/** Curated Lucide icons the couple can attach to a custom budget row. Keep
 *  the list short — the picker is a single inline strip under the label
 *  input, and too many choices would push the form below the fold. Keys are
 *  the slugs persisted to `budget_lines.icon`; the backend allow-pattern
 *  matches `[A-Za-z0-9_-]{1,40}` so renaming a slug means a one-way schema
 *  change. Unknown slugs (legacy / removed icons) fall back to the default. */
export const CUSTOM_ICON_CHOICES: Array<{
  slug: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}> = [
  { slug: "Sparkles", Icon: Sparkles },
  { slug: "Heart", Icon: Heart },
  { slug: "Star", Icon: Star },
  { slug: "Bell", Icon: Bell },
  { slug: "Briefcase", Icon: Briefcase },
  { slug: "ShoppingBag", Icon: ShoppingBag },
];

/** Resolve a stored icon slug to a Lucide component. Falls back to the
 *  generic `MoreHorizontal` when the slug is null/unknown so an old row or
 *  a slug we later remove still renders. */
export function resolveCustomIcon(
  slug: string | null,
): ComponentType<{ size?: number; className?: string }> {
  if (!slug) return MoreHorizontal;
  const match = CUSTOM_ICON_CHOICES.find((c) => c.slug === slug);
  return match ? match.Icon : MoreHorizontal;
}

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
  currency = "HUF",
  onCountChange,
  onBoundsChange,
  onEditPlanned,
  onCapChange,
  frozenCategories,
  onToggleFreeze,
  amountLinkTo,
  showActualToggle = false,
  onAddCustomRow,
  onEditCustomRowPlanned,
  onRemoveCustomRow,
}: {
  lines: BudgetLine[];
  baseline: number;
  /** Display currency for the cap, totals and per-row amounts. Defaults to
   *  HUF so legacy embedders (or anywhere the couple is still loading) keep
   *  their pre-currency behaviour. */
  currency?: Currency;
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
  /** When set, the panel renders an "Új sor" affordance under the category
   *  rows. Couples can add free-form line items (e.g. "Anyakönyvvezető",
   *  "Egyházi szertartás") that show as their own row in the panel rather
   *  than being lumped into Egyéb. Stored as `category="other"` lines with
   *  a non-default label. `options.perGuest` opts the row into the same
   *  headcount-driven rescale that built-in per-guest categories get;
   *  `options.icon` is a slug from CUSTOM_ICON_CHOICES that renders in
   *  place of the default MoreHorizontal glyph. */
  onAddCustomRow?: (
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) => void | Promise<void>;
  /** Commits a slider drag on a custom row. The lineId identifies the
   *  underlying BudgetLine — custom rows are not aggregated, so we edit by
   *  line instead of by category. */
  onEditCustomRowPlanned?: (lineId: number, plannedHuf: number) => void | Promise<void>;
  /** Removes a custom row. Parent should confirm before calling. */
  onRemoveCustomRow?: (lineId: number) => void | Promise<void>;
}) {
  const { t, locale } = useT();
  // Second-layer overlay: when on, each category row renders a thin red bar
  // under the planned slider showing the actual spend. Local state — no
  // persistence; toggling is cheap and most users won't keep it on.
  const [showActualOverlay, setShowActualOverlay] = useState(false);
  const factor = baseline > 0 ? count / baseline : 1;

  // In-progress drag for ONE slider at a time. The user can only physically
  // drag a single slider at once, so a single {key, value} slot is enough —
  // and it sidesteps the Map allocation that the previous design did on every
  // pointer-move event. Lifted out of the row components because:
  //   1. The summary total at the bottom of the card needs to reflect the
  //      drag live — otherwise totalPlanned lags behind the row slider.
  //   2. Row-local state could get stranded when the browser drops a mouseup
  //      outside the slider element; centralising lets us clear stale entries
  //      whenever `lines` rehydrates from the server.
  const [categoryDrag, setCategoryDrag] = useState<{
    category: BudgetCategory;
    value: number;
  } | null>(null);
  const [customDrag, setCustomDrag] = useState<{ lineId: number; value: number } | null>(null);
  // Wipe stale drag state whenever the source-of-truth lines change. Any
  // committed save (own or partner-via-`budget:changed`) propagates a fresh
  // `lines` array — at that point the parent's view IS the truth and any
  // lingering drag baseline would only confuse the total.
  useEffect(() => {
    setCategoryDrag(null);
    setCustomDrag(null);
  }, [lines]);
  // Stable callbacks the row components call on each pointer-move. Stable
  // identity is what lets React.memo on CategoryRow / CustomRow actually
  // skip re-renders for siblings whose values didn't change.
  const handleCategoryDrag = useCallback((category: BudgetCategory, value: number) => {
    setCategoryDrag({ category, value });
  }, []);
  const handleCustomDrag = useCallback((lineId: number, value: number) => {
    setCustomDrag({ lineId, value });
  }, []);

  // Custom rows: `category="other"` lines whose label diverges from the
  // localized default ("Egyéb" / "Other"). Identify them once so we can:
  //   1. exclude them from the "Egyéb" bucket so they don't double-count, and
  //   2. render them as standalone rows after the category sliders.
  // Both HU and EN defaults are matched so a couple switching locales doesn't
  // suddenly see their old "Egyéb" rows promoted to custom.
  const defaultOtherLabels = useMemo(() => new Set(["Egyéb", "Other"]), []);
  const customRows = useMemo(
    () => lines.filter((l) => l.category === "other" && !defaultOtherLabels.has(l.label)),
    [lines, defaultOtherLabels],
  );
  const aggregatableLines = useMemo(
    () => lines.filter((l) => !(l.category === "other" && !defaultOtherLabels.has(l.label))),
    [lines, defaultOtherLabels],
  );

  // Aggregate lines into category buckets. Every category in CATEGORY_ORDER
  // gets a row (even with 0 planned) so the user can slide it up from zero.
  // Custom rows are excluded — they own their own row below the buckets so
  // we don't want them folded back into "Egyéb" here.
  const buckets = useMemo(() => {
    const map = new Map<BudgetCategory, { planned: number; actual: number }>();
    for (const l of aggregatableLines) {
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
      // Active drag (if any) overrides the committed baseline — that's how
      // totalPlanned tracks the slider live.
      const liveBaseline =
        categoryDrag !== null && categoryDrag.category === cat ? categoryDrag.value : v.planned;
      return {
        category: cat,
        actual: v.actual,
        // Display planned = baseline planned scaled for per-guest categories.
        plannedDisplay: scales ? Math.round(liveBaseline * factor) : liveBaseline,
        plannedBaseline: liveBaseline,
        scales,
        frozen,
      };
    });
  }, [aggregatableLines, factor, frozenCategories, categoryDrag]);

  // Live custom-row totals — same drag-aware pattern as `buckets` so the
  // panel's grand total tracks slider movement, not just commits. Per-guest
  // custom rows store the BASELINE amount in `planned_huf`; the display
  // value is `baseline * factor` so a drag of the headcount slider rescales
  // them just like built-in per-guest categories.
  const customDisplays = useMemo(
    () =>
      customRows.map((l) => {
        const liveBaseline =
          customDrag !== null && customDrag.lineId === l.id ? customDrag.value : l.planned_huf;
        const scales = l.per_guest;
        return {
          line: l,
          planned: scales ? Math.round(liveBaseline * factor) : liveBaseline,
          plannedBaseline: liveBaseline,
          actual: l.actual_huf,
          scales,
        };
      }),
    [customRows, customDrag, factor],
  );

  const totalPlanned =
    buckets.reduce((s, b) => s + b.plannedDisplay, 0) +
    customDisplays.reduce((s, c) => s + c.planned, 0);
  const totalActual =
    buckets.reduce((s, b) => s + b.actual, 0) + customDisplays.reduce((s, c) => s + c.actual, 0);
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

  // Anchor for the per-row slider WIDTH (visual rail) and `dragMax` (input's
  // hard max). When a budget cap is set, the rail spans the whole budget so
  // every row reads as a fraction of the total at a glance, and the drag stop
  // is the cap itself — pulling a row to the right end means "this category
  // alone uses the entire budget". The rail extends 3 % past the cap so a
  // thin non-draggable tail sits at the right edge, visually signalling the
  // ceiling without making the thumb hit a hard wall mid-rail.
  // Fallback (no cap set): keep the soft-cap formula so the slider still
  // tracks the largest row with some headroom.
  const widthAnchor = useMemo(() => {
    if (cap !== null && cap > 0) return Math.round(cap * 1.03);
    const maxRowAmount = Math.max(
      ...buckets.map((b) => b.plannedDisplay),
      ...customDisplays.map((c) => c.planned),
      0,
    );
    return Math.max(1_500_000, Math.round(maxRowAmount * 1.2), 100_000);
  }, [cap, buckets, customDisplays]);
  const dragMax = cap !== null && cap > 0 ? cap : widthAnchor;

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
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t("budget.cost_planning_headline")}
        </p>
        <div className="flex items-center gap-3">
          {showActualToggle && hasAnyActual && (
            // Icon-only toggle for the actual-overlay. The receipt glyph signals
            // "actual paid spend"; the red ring when active picks up the overlay's
            // red stroke colour so they read as a single affordance. Title +
            // aria-label keep the action discoverable for keyboard and SR users.
            // Hidden until at least one row has an actual amount — otherwise
            // toggling does nothing visible and the icon reads as a dead chip.
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
                  ? "border-red-500 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-400/60 dark:bg-red-400/15 dark:text-red-300 dark:hover:bg-red-400/25"
                  : "border-paper-300 text-ink-500 hover:border-paper-400 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
              }`}
            >
              <Receipt size={14} aria-hidden />
            </button>
          )}
          {cap !== null &&
            (tier === "safe" ? (
              <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-ink-600 dark:text-umber-200">
                <ArrowDown size={12} className="self-center" aria-hidden />
                {t("budget.under_by", { amount: formatMoney(underAmount, currency, locale) })}
              </span>
            ) : tier === "soft" ? (
              // 0–5 % over: calm amber dot, no blush pill — well within the
              // noise floor of cap accuracy, so the warning is muted on purpose.
              // Copy still includes the exact overage amount so the couple can
              // see the actual gap, not a vague "a touch over" hand-wave.
              <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-ink-600 dark:text-umber-200">
                <span
                  className="inline-block h-2 w-2 self-center rounded-full bg-amber-500 dark:bg-amber-400"
                  aria-hidden="true"
                />
                {t("cost_planning.overcap_medium_label", {
                  amount: formatMoney(overage, currency, locale),
                })}
              </span>
            ) : (
              // medium (5–20 %) + serious (>20 %): same blush pill; the serious
              // tier adds an action link below the card total. Keeping the pill
              // shape stable across tiers preserves the visual anchor.
              <span className="stat-num inline-flex items-baseline gap-1 text-sm font-medium text-blush-700 dark:text-blush-300">
                <ArrowUp size={12} className="self-center" aria-hidden />
                {t("cost_planning.overcap_medium_label", {
                  amount: formatMoney(overage, currency, locale),
                })}
              </span>
            ))}
        </div>
      </div>

      {/* Big centred live count — number large, "vendég" small below. The
       *  negative top margin pulls the number up flush under the eyebrow row
       *  so there's no empty band between them. */}
      <div className="-mt-3 text-center">
        <div className="font-serif text-4xl leading-none text-ink-900 sm:text-5xl dark:text-paper-50">
          {formatNumber(count, locale)}
        </div>
        <div className="mt-0.5 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
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
        <div className="mt-1 flex items-center justify-between text-[11px] text-ink-400 dark:text-umber-300">
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
      <ul className="mt-4 divide-y divide-paper-100 dark:divide-umber-700">
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
            dragMax={dragMax}
            currency={currency}
            onEditPlanned={onEditPlanned}
            onToggleFreeze={onToggleFreeze}
            onDrag={handleCategoryDrag}
            amountLinkTo={amountLinkTo}
            showActualOverlay={showActualOverlay && hasAnyActual}
            linkTo={b.category === "honeymoon" ? "/app/honeymoon" : undefined}
          />
        ))}
        {/* Custom rows live in the same list so the grid template + dividers
         *  carry over. Each row owns its own slider tied to a specific
         *  BudgetLine.id rather than a category bucket. */}
        {customDisplays.map((c) => (
          <CustomRow
            key={c.line.id}
            line={c.line}
            liveDisplay={c.planned}
            scaleFactor={c.scales ? factor : 1}
            count={count}
            widthAnchor={widthAnchor}
            dragMax={dragMax}
            currency={currency}
            onEditPlanned={onEditCustomRowPlanned}
            onRemove={onRemoveCustomRow}
            onDrag={handleCustomDrag}
            showActualOverlay={showActualOverlay && hasAnyActual}
          />
        ))}
        {onAddCustomRow && <AddCustomRow onAdd={onAddCustomRow} />}
      </ul>

      <div className="mt-4 border-t border-paper-200 pt-3 dark:border-umber-700">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {/* Label tracks what's actually shown — pure planned vs. actual/planned. */}
            {totalActual > 0 ? t("budget.total_actual") : t("budget.total_planned")}
          </span>
          <span
            data-testid="cost-planning-total"
            className={`stat-num text-xl font-semibold ${overCap ? "text-blush-700 dark:text-blush-300" : "text-ink-900 dark:text-paper-50"}`}
          >
            {totalActual > 0 && (
              <span
                className={`text-sm ${overCap ? "text-blush-400 dark:text-blush-300" : "text-ink-500 dark:text-umber-300"}`}
              >
                {formatMoney(totalActual, currency, locale)} /{" "}
              </span>
            )}
            {formatMoney(totalPlanned, currency, locale)}
          </span>
        </div>
        {/* Always render the cap row — when the couple hasn't set a ceiling
         *  during onboarding, the value slot stays empty (with a dash
         *  placeholder) so the layout doesn't shift and the user can click
         *  to fill it in here. */}
        {(cap !== null || onCapChange) && (
          <div className="mt-1 flex items-baseline justify-between text-[11px]">
            <span className="text-ink-400 dark:text-umber-300">{t("budget.cap")}</span>
            {onCapChange ? (
              <EditableHuf
                value={cap}
                onSave={onCapChange}
                ariaLabel={t("budget.cap")}
                emphasise={overCap}
                currency={currency}
              />
            ) : (
              <span
                className={`stat-num ${overCap ? "text-blush-700 dark:text-blush-300" : "text-ink-400 dark:text-umber-300"}`}
              >
                {cap !== null ? formatMoney(cap, currency, locale) : "—"}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryRowInner({
  category,
  plannedBaseline,
  actual,
  scales,
  frozen,
  scaleFactor,
  count,
  widthAnchor,
  dragMax,
  currency,
  onEditPlanned,
  onToggleFreeze,
  onDrag,
  amountLinkTo,
  showActualOverlay = false,
  linkTo,
}: {
  category: BudgetCategory;
  plannedBaseline: number;
  actual: number;
  scales: boolean;
  /** Display currency for the amount tile. Passed through from the parent
   *  CostPlanningCard so every row matches the couple's preference. */
  currency: Currency;
  /** Frozen — slider is read-only, per-guest scaling is off, the left side
   *  shows a lock affordance, and the planned amount stays pinned. */
  frozen: boolean;
  /** Live count/baseline ratio for per-guest categories (1 for fixed). The
   *  per-row slider lives in *display* units, so we use this both to convert
   *  the drag input back to baseline before persisting and to keep the /fő
   *  unit price stable when only the headcount changes. */
  scaleFactor: number;
  count: number;
  /** Shared denominator for the visual rail. The slider's CSS width is scaled
   *  relative to this so the rows read like a horizontal bar chart. Set 3 %
   *  above the budget cap so a thin non-draggable tail sits past `dragMax`.
   *  Floored upstream so it never hits zero. */
  widthAnchor: number;
  /** Hard right stop for `<input type="range">`. Equals the couple's budget
   *  cap when set, so a row can be dragged up to (but not past) "this single
   *  category eats the entire budget". When the cap is null, matches the
   *  visual rail. */
  dragMax: number;
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<void>;
  onToggleFreeze?: (category: BudgetCategory) => void | Promise<void>;
  /** Drag handler — fires on each slider change with the row's category and
   *  the new *baseline* value. Identity-stable in the parent so React.memo
   *  on this component can skip re-renders for sibling rows. */
  onDrag?: (category: BudgetCategory, baselineValue: number) => void;
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
  // `saving` blocks the slider while a commit is in flight so a chatty drag
  // can't queue duplicate PATCHes. Drag state itself lives in the parent —
  // see the `drags` map in CostPlanningCard.
  const [saving, setSaving] = useState(false);
  // Hover preview — when the user mouses over the left tile of an unfrozen
  // row, swap the category icon to Lock so the freeze affordance is
  // discoverable without a click. Click is what actually freezes.
  const [tilePreview, setTilePreview] = useState(false);

  const Icon = CATEGORY_ICONS[category];
  const editable = !!onEditPlanned;

  // `plannedBaseline` already reflects any active drag (parent merges drag
  // state into the bucket value). Slider operates in display units so the
  // thumb tracks the headcount slider for per-guest categories — drag a
  // per-fő rate, the total moves.
  const liveDisplay = Math.round(plannedBaseline * scaleFactor);

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

  // Per-guest unit for the cross-coupling hint. Suppressed while the row is
  // still 0 — a "0/fő" subscript next to "0 Ft" is just noise, and one user
  // in the test cohort read it as "each guest costs 0 forint" instead of
  // "no plan yet". Once the row has a value the hint becomes useful again.
  const perGuest = scales && count > 0 && liveDisplay > 0 ? Math.round(liveDisplay / count) : null;

  // Drag input is in display units. Convert back to baseline before pushing
  // up to the parent's drag map, so the saved planned amount is normalised
  // to the couple's baseline guest count regardless of where the headcount
  // slider currently sits.
  function applyScaledDrag(scaledNew: number) {
    const baselineNew = scaleFactor > 0 ? Math.round(scaledNew / scaleFactor) : scaledNew;
    onDrag?.(category, baselineNew);
  }

  async function commit(scaledNext: number) {
    if (!onEditPlanned) return;
    const baselineNext = scaleFactor > 0 ? Math.round(scaledNext / scaleFactor) : scaledNext;
    // Parent will rehydrate `lines` after the PATCH and the drag clears via
    // the useEffect on `lines` in CostPlanningCard; nothing to do here when
    // the slider released on the same value it started on.
    setSaving(true);
    try {
      await onEditPlanned(category, baselineNext);
    } finally {
      setSaving(false);
    }
  }

  // Track gradient + dimensions are computed identically in both modes so
  // the link-mode honeymoon row reads as the same bar chart as the rest.
  // Thin variant → 12 px thumb (see `.range-fill-thin` CSS).
  // For frozen rows, override `--range-fill-amount` so the gradient picks up
  // a muted blush instead of the default ink. Paired with `range-fill-frozen`
  // (thumb colour) and the blush amount text below, this turns the whole row
  // into one "locked" visual unit — readable at a glance from across the
  // table, but soft enough not to compete with the live editable rows.
  const trackStyle: CSSProperties = {
    width: `${widthPct}%`,
    ...rangeFillStyle(liveDisplay, 0, rowMax, 12),
    ...(frozen ? ({ "--range-fill-amount": "var(--range-fill-frozen)" } as CSSProperties) : {}),
  };

  const categoryLabel = t(`budget.cat.${category}`);
  const canToggleFreeze = !!onToggleFreeze && !linkTo;
  const sliderDisabled = !editable || saving || frozen;

  // Left tile — icon + name. Doubles as the freeze toggle on non-link rows
  // (honeymoon routes the whole row through to /app/honeymoon, so its left
  // tile stays inert). When frozen, a tiny lock badge replaces the icon's
  // ink-500 with the blush tint so the row reads as pinned at a glance.
  // Hover-preview: on a toggleable, unfrozen row, mousing over swaps the
  // icon to Lock so the freeze affordance is discoverable pre-click.
  const showLockIcon = frozen || (canToggleFreeze && tilePreview);
  const leftTileContent = (
    <>
      {showLockIcon ? (
        <Lock size={14} className="shrink-0 text-blush-700 dark:text-blush-300" aria-hidden />
      ) : (
        <Icon size={14} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
      )}
      <span className={`truncate ${frozen ? "text-blush-700 dark:text-blush-300" : ""}`}>
        {categoryLabel}
      </span>
    </>
  );

  const leftTile = canToggleFreeze ? (
    <button
      type="button"
      onClick={() => onToggleFreeze?.(category)}
      onMouseEnter={() => setTilePreview(true)}
      onMouseLeave={() => setTilePreview(false)}
      onFocus={() => setTilePreview(true)}
      onBlur={() => setTilePreview(false)}
      className={`flex items-center gap-2 text-left text-ink-700 transition hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50 ${
        frozen
          ? "text-blush-700 hover:text-blush-800 dark:text-blush-300 dark:hover:text-blush-200"
          : ""
      }`}
      aria-pressed={frozen}
      aria-label={t(frozen ? "budget.unfreeze_aria" : "budget.freeze_aria", {
        category: categoryLabel,
      })}
    >
      {leftTileContent}
    </button>
  ) : (
    <span className="flex items-center gap-2 text-ink-700 dark:text-paper-100">
      {leftTileContent}
    </span>
  );

  // Right tile — the amount. On the dashboard we promote this to a Link so a
  // tap on the number routes the user to /app/budget for precise entry; the
  // hash drops them at the matching category section.
  // Two-line amount tile so the right-hand column can stay a fixed width —
  // see the grid template below. Inline per-guest hint blew the column out
  // on per-guest categories, which made the bar rail width inconsistent
  // across rows; with the hint on its own line the rail length is the
  // same for every row and "x px = y HUF" reads correctly.
  // The "actual / planned" pair (e.g. "120 000 / 350 000") only fits on the
  // narrow mobile right-column when both halves are tiny. Hiding the actual
  // prefix on `<sm` lets us tighten the right column from 8rem → 5.5rem and
  // hand those 2.5rem back to the slider — a noticeable gain in the bar
  // chart's effective length on a 360 px viewport. The actual spend is
  // still visible in the budget table and reappears on `sm:` widths.
  const amountInner = (
    <span className="flex flex-col items-end leading-tight">
      <span className="whitespace-nowrap">
        {actual > 0 && (
          <span className="hidden text-ink-400 sm:inline dark:text-umber-300">
            {formatMoney(actual, currency, locale)} /{" "}
          </span>
        )}
        <span className="font-medium">{formatMoney(liveDisplay, currency, locale)}</span>
      </span>
      {perGuest !== null && (
        <span className="whitespace-nowrap text-[10px] text-ink-400 dark:text-umber-300">
          {t("budget.per_guest_unit", { n: formatNumber(perGuest, locale) })}
        </span>
      )}
    </span>
  );

  // Frozen rows render the amount in blush so the whole row (label, slider,
  // amount) shares one palette and reads as a single locked unit.
  const amountColorClass = frozen
    ? "text-blush-700 dark:text-blush-300"
    : "text-ink-700 dark:text-paper-100";
  const amountTile =
    amountLinkTo && !linkTo ? (
      <Link
        to={`${amountLinkTo}#cat-${category}`}
        className={`stat-num block rounded text-right text-xs ${amountColorClass} underline-offset-2 transition hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:hover:text-paper-50`}
        aria-label={t("budget.open_table_aria", { category: categoryLabel })}
      >
        {amountInner}
      </Link>
    ) : (
      <span className={`stat-num block text-right text-xs ${amountColorClass}`}>{amountInner}</span>
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
      max={dragMax}
      step={step}
      value={liveDisplay}
      disabled={sliderDisabled}
      onChange={(e) => applyScaledDrag(Number(e.target.value))}
      onMouseUp={(e) => commit(Number(e.currentTarget.value))}
      onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
      onKeyUp={(e) => commit(Number(e.currentTarget.value))}
      className={`range-fill range-fill-thin block ${frozen ? "range-fill-frozen" : ""}`}
      style={trackStyle}
      aria-label={t("budget.edit_planned_aria", { category: categoryLabel })}
    />
  );

  // Actual-spend overlay: a thin red lookalike-slider rendered under the real
  // one, fill width tied to the same widthAnchor as planned so the two bars
  // are visually comparable at a glance. Non-interactive — `aria-hidden`
  // keeps it out of the AT tree (the actual amount is already in the right
  // tile copy). Clamped to 100% so over-spend doesn't bleed past the row.
  // Mirrors the planned slider's thumb-aware stop so an actual == planned row
  // ends both bars at exactly the same x — without the offset they'd diverge
  // by up to 6 px and read as slightly different values.
  const actualFillPct = rowMax > 0 ? Math.max(0, Math.min(100, (actual / rowMax) * 100)) : 0;
  const actualFillOffsetPx = 12 * (0.5 - actualFillPct / 100);
  const actualFillStop = `calc(${actualFillPct}% + ${actualFillOffsetPx.toFixed(3)}px)`;
  const actualOverlayStyle: CSSProperties = {
    width: `${widthPct}%`,
    background: `linear-gradient(to right, var(--range-actual-amount) 0%, var(--range-actual-amount) ${actualFillStop}, var(--range-actual-remainder) ${actualFillStop}, var(--range-actual-remainder) 100%)`,
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
          className="grid grid-cols-[7rem_minmax(0,1fr)_5.5rem] items-center gap-2 py-1.5 text-xs transition hover:bg-paper-50 sm:grid-cols-[10rem_minmax(0,1fr)_11rem] sm:gap-3 sm:text-sm -mx-2 px-2 rounded-md dark:hover:bg-umber-700"
          aria-label={categoryLabel}
        >
          <span className="flex items-center gap-2 text-ink-700 dark:text-paper-100">
            {leftTileContent}
          </span>
          <div className="w-full">
            {trackEl}
            {actualOverlayEl}
          </div>
          <span className="stat-num block text-right text-xs text-ink-700 dark:text-paper-100">
            {amountInner}
          </span>
        </Link>
      </li>
    );
  }

  return (
    <li
      id={`cat-${category}`}
      className="grid grid-cols-[7rem_minmax(0,1fr)_5.5rem] scroll-mt-24 items-center gap-2 py-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)_11rem] sm:gap-3 sm:text-sm"
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

// Memoized so a headcount-slider drag only re-renders the per-guest rows
// whose `scaleFactor` / `count` actually moved. Fixed-cost rows (venue,
// rings, …) skip the render entirely.
const CategoryRow = memo(CategoryRowInner);

/** Standalone budget row whose value lives in a single BudgetLine rather than
 *  an aggregated category bucket. Visually mirrors `CategoryRow` (left tile +
 *  slider rail + amount tile) so the panel reads as one continuous bar chart,
 *  but the left tile shows the user-supplied label and a remove handle, the
 *  slider edits the line's `planned_huf` directly, and there's no per-guest
 *  scaling (custom rows are treated as fixed costs). */
function CustomRowInner({
  line,
  liveDisplay,
  scaleFactor,
  count,
  widthAnchor,
  dragMax,
  currency,
  onEditPlanned,
  onRemove,
  onDrag,
  showActualOverlay,
}: {
  line: BudgetLine;
  liveDisplay: number;
  /** 1 for fixed rows; `count/baseline` for per-guest rows. The slider runs
   *  in display units, so we divide by this factor before persisting so the
   *  saved `planned_huf` stays normalised to the baseline guest count. */
  scaleFactor: number;
  /** Current headcount slider value — used to compute the per-guest hint. */
  count: number;
  widthAnchor: number;
  dragMax: number;
  currency: Currency;
  onEditPlanned?: (lineId: number, plannedHuf: number) => void | Promise<void>;
  onRemove?: (lineId: number) => void | Promise<void>;
  /** Receives the row's line id + the new BASELINE value. Identity-stable in
   *  the parent so memo on this component skips re-renders for siblings that
   *  didn't move. */
  onDrag?: (lineId: number, baselineValue: number) => void;
  showActualOverlay?: boolean;
}) {
  const { t, locale } = useT();
  const [saving, setSaving] = useState(false);

  const rowMax = widthAnchor;
  const fillPct = rowMax > 0 ? Math.max(0, Math.min(100, (liveDisplay / rowMax) * 100)) : 0;
  const step = rowMax >= 1_000_000 ? 25_000 : 10_000;
  const Icon = resolveCustomIcon(line.icon);
  // Match CategoryRow: a "0/fő" subscript next to "0 Ft" is just noise, so
  // suppress it until the row actually has a plan.
  const perGuest =
    line.per_guest && count > 0 && liveDisplay > 0 ? Math.round(liveDisplay / count) : null;

  // Thin variant → 12 px thumb. See `rangeFillStyle` for why the stop has to
  // be calc-anchored to the thumb centre.
  const trackStyle: CSSProperties = {
    width: "100%",
    ...rangeFillStyle(liveDisplay, 0, rowMax, 12),
  };

  const actualFillPct =
    rowMax > 0 ? Math.max(0, Math.min(100, (line.actual_huf / rowMax) * 100)) : 0;
  const actualFillOffsetPx = 12 * (0.5 - actualFillPct / 100);
  const actualFillStop = `calc(${actualFillPct}% + ${actualFillOffsetPx.toFixed(3)}px)`;
  const actualOverlayStyle: CSSProperties = {
    width: "100%",
    background: `linear-gradient(to right, var(--range-actual-amount) 0%, var(--range-actual-amount) ${actualFillStop}, var(--range-actual-remainder) ${actualFillStop}, var(--range-actual-remainder) 100%)`,
  };

  // Slider input is in display units; convert back to baseline before
  // pushing into the parent's drag map / persisting. Mirrors CategoryRow.
  function toBaseline(scaledNew: number): number {
    return scaleFactor > 0 ? Math.round(scaledNew / scaleFactor) : scaledNew;
  }

  async function commit(scaledNext: number) {
    if (!onEditPlanned) return;
    setSaving(true);
    try {
      await onEditPlanned(line.id, toBaseline(scaledNext));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="grid grid-cols-[7rem_minmax(0,1fr)_5.5rem] items-center gap-2 py-1.5 text-xs sm:grid-cols-[10rem_minmax(0,1fr)_11rem] sm:gap-3 sm:text-sm">
      <span className="flex items-center gap-1.5 text-ink-700 dark:text-paper-100">
        {onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(line.id)}
            className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-blush-50 hover:text-blush-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:text-umber-300 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
            aria-label={t("budget.custom_row_delete_aria", { label: line.label })}
          >
            <X size={12} aria-hidden />
          </button>
        ) : (
          <Icon size={14} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
        )}
        <span className="truncate">{line.label}</span>
      </span>
      <div className="w-full">
        <input
          type="range"
          min={0}
          max={dragMax}
          step={step}
          value={liveDisplay}
          disabled={!onEditPlanned || saving}
          onChange={(e) => onDrag?.(line.id, toBaseline(Number(e.target.value)))}
          onMouseUp={(e) => commit(Number(e.currentTarget.value))}
          onTouchEnd={(e) => commit(Number(e.currentTarget.value))}
          onKeyUp={(e) => commit(Number(e.currentTarget.value))}
          className="range-fill range-fill-thin block"
          style={trackStyle}
          aria-label={t("budget.custom_row_edit_aria", { label: line.label })}
        />
        {showActualOverlay && line.actual_huf > 0 && (
          <div
            className="range-fill range-fill-thin mt-1 block"
            style={actualOverlayStyle}
            aria-hidden="true"
          />
        )}
      </div>
      <span className="stat-num block text-right text-xs text-ink-700 dark:text-paper-100">
        <span className="flex flex-col items-end leading-tight">
          <span className="whitespace-nowrap">
            {line.actual_huf > 0 && (
              <span className="hidden text-ink-400 sm:inline dark:text-umber-300">
                {formatMoney(line.actual_huf, currency, locale)} /{" "}
              </span>
            )}
            <span className="font-medium">{formatMoney(liveDisplay, currency, locale)}</span>
          </span>
          {perGuest !== null && (
            <span className="whitespace-nowrap text-[10px] text-ink-400 dark:text-umber-300">
              {t("budget.per_guest_unit", { n: formatNumber(perGuest, locale) })}
            </span>
          )}
        </span>
      </span>
    </li>
  );
}

// Memoized so a single custom-row drag (or a save commit on one custom row)
// doesn't re-render the sibling custom rows.
const CustomRow = memo(CustomRowInner);

/** "Új sor" affordance — collapsed pill by default, expands to a label +
 *  amount form on click. Commits via `onAdd` which the parent wires to a
 *  POST /api/budget/lines call with `category="other"` and the custom label.
 *  We keep the form inline (not a modal) because the panel sits in a card —
 *  staying in-flow preserves the user's place in the list. */
function AddCustomRow({
  onAdd,
}: {
  onAdd: (
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) => void | Promise<void>;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [perGuest, setPerGuest] = useState(false);
  const [iconSlug, setIconSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLabel("");
    setAmountDraft("");
    setPerGuest(false);
    setIconSlug(null);
    setError(null);
    setExpanded(false);
  }

  async function commit() {
    const trimmed = label.trim();
    if (trimmed.length === 0) {
      setError(t("budget.custom_row_label_required"));
      return;
    }
    const digits = amountDraft.replace(/\D/g, "");
    const amount = digits === "" ? 0 : Number(digits);
    if (!Number.isFinite(amount) || amount < 0) {
      setError(t("budget.custom_row_label_required"));
      return;
    }
    setSaving(true);
    try {
      await onAdd(trimmed, Math.round(amount), { perGuest, icon: iconSlug });
      reset();
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <li className="py-2">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-paper-300 px-2.5 py-1 text-xs text-ink-500 transition hover:border-paper-400 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
        >
          <Plus size={12} aria-hidden />
          {t("budget.add_custom_row")}
        </button>
      </li>
    );
  }

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <input
          type="text"
          autoFocus
          maxLength={80}
          value={label}
          disabled={saving}
          placeholder={t("budget.custom_row_label_placeholder")}
          onChange={(e) => {
            setLabel(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            else if (e.key === "Escape") reset();
          }}
          aria-label={t("budget.custom_row_label_placeholder")}
          className="input h-11 min-h-0 flex-1 py-1 text-base sm:h-9 sm:flex-none sm:basis-44 sm:text-sm"
        />
        <input
          type="text"
          inputMode="numeric"
          maxLength={14}
          value={amountDraft}
          disabled={saving}
          placeholder={t("budget.custom_row_amount_placeholder")}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setAmountDraft(digits === "" ? "" : formatNumber(Number(digits), "hu"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            else if (e.key === "Escape") reset();
          }}
          aria-label={t("budget.custom_row_amount_placeholder")}
          className="input h-11 min-h-0 flex-1 py-1 text-right text-base tabular-nums sm:h-9 sm:flex-none sm:basis-32 sm:text-sm"
        />
        <button
          type="button"
          onClick={commit}
          disabled={saving}
          className="btn-primary btn-sm whitespace-nowrap"
        >
          {t("budget.custom_row_save")}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          className="btn-ghost btn-sm whitespace-nowrap text-ink-500 dark:text-umber-300"
        >
          {t("budget.custom_row_cancel")}
        </button>
      </div>
      {/* Secondary options row — icon picker + per-guest toggle. Sits below
       *  the main inputs so it stays out of the way for couples who just
       *  want a quick label + amount, but is visible while the form is
       *  open so the affordance is discoverable. */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          aria-label={t("budget.custom_row_icon_label")}
          className="flex flex-wrap items-center gap-1"
        >
          <span className="mr-1 text-[11px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
            {t("budget.custom_row_icon_label")}
          </span>
          {CUSTOM_ICON_CHOICES.map(({ slug, Icon }) => {
            const selected = iconSlug === slug;
            return (
              <button
                key={slug}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={saving}
                onClick={() => setIconSlug(selected ? null : slug)}
                title={t(`budget.custom_row_icon_choice.${slug}`)}
                aria-label={t(`budget.custom_row_icon_choice.${slug}`)}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 ${
                  selected
                    ? "border-blush-500 bg-blush-50 text-blush-700 dark:border-blush-400/60 dark:bg-blush-400/15 dark:text-blush-300"
                    : "border-paper-300 text-ink-500 hover:border-paper-400 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
                }`}
              >
                <Icon size={14} aria-hidden />
              </button>
            );
          })}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-500 dark:text-umber-300">
          <input
            type="checkbox"
            checked={perGuest}
            disabled={saving}
            onChange={(e) => setPerGuest(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-blush-600 dark:accent-blush-400"
          />
          <Users size={12} aria-hidden className="text-ink-400 dark:text-umber-300" />
          <span>{t("budget.custom_row_per_guest_toggle")}</span>
        </label>
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-blush-700 dark:text-blush-300" role="alert">
          {error}
        </p>
      )}
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
      className="stat-num w-10 rounded border border-transparent bg-transparent px-1 text-center text-[11px] text-ink-400 transition hover:border-paper-300 hover:text-ink-700 focus:border-blush-500 focus:text-ink-800 focus:outline-none dark:text-umber-300 dark:hover:border-umber-700 dark:hover:text-paper-100 dark:focus:text-paper-50"
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
  currency = "HUF",
}: {
  value: number | null;
  onSave: (next: number) => Promise<void>;
  ariaLabel: string;
  /** Shown when value is null and the button is at rest. Plain dash by default. */
  placeholder?: string;
  emphasise?: boolean;
  /** Display currency for the rest-state amount. Editing still parses as a
   *  plain integer — the picker lives on the parent (Profile / Dashboard
   *  cap tile), so we don't surface a sub-picker here. */
  currency?: Currency;
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
        className="stat-num w-28 rounded border border-blush-500 bg-white px-1 py-0.5 text-right text-[11px] text-ink-900 focus:outline-none focus:ring-2 focus:ring-blush-100 dark:bg-umber-800 dark:text-paper-50"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      aria-label={ariaLabel}
      className={`stat-num rounded border border-transparent px-1 py-0.5 text-right transition hover:border-paper-300 dark:hover:border-umber-700 ${
        emphasise
          ? "text-blush-700 hover:text-blush-800 dark:text-blush-300 dark:hover:text-blush-200"
          : "text-ink-400 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200`}
    >
      {value !== null ? formatMoney(value, currency, locale) : (placeholder ?? "—")}
    </button>
  );
}
