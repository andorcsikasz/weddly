// Shared cost-planning panel — guest-count slider plus a slider per category.
// Used by the Dashboard and Budget pages. Per-guest categories cross-couple
// with the headcount slider (move headcount → catering/drinks/etc. rescale).

import type { BudgetCategory, BudgetLine, Currency } from "@shared/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bell,
  Briefcase,
  Cake,
  Camera,
  Car,
  ChevronDown,
  Flower2,
  Gift,
  Heart,
  Home,
  Lock,
  LockOpen,
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
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { isSupplierManagedLine, supplierManagedCategories } from "../lib/budget";
import type { CostPlanningSaveStatus } from "../lib/cost_planning";
import { formatMoney, formatNumber, moneySliderStep } from "../lib/format";
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
): { backgroundImage: string } {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  // offset = thumbW * (0.5 − pct/100). At pct=0 → +thumbW/2 (clear of left
  // edge); at pct=100 → −thumbW/2 (clear of right edge); at pct=50 → 0.
  const offsetPx = thumbPx * (0.5 - pct / 100);
  const stop = `calc(${pct}% + ${offsetPx.toFixed(3)}px)`;
  return {
    backgroundImage: `linear-gradient(to right, var(--range-fill-amount) 0%, var(--range-fill-amount) ${stop}, var(--range-fill-remainder) ${stop}, var(--range-fill-remainder) 100%)`,
  };
}

/** Thumb-aware stop for the read-only bars drawn UNDER a slider. Same offset
 *  as `rangeFillStyle` at the thin thumb width, so a bar that equals the
 *  planned amount ends at exactly the planned thumb's x rather than up to 6 px
 *  either side of it. */
function overlayStop(value: number, rowMax: number): string {
  const pct = rowMax > 0 ? Math.max(0, Math.min(100, (value / rowMax) * 100)) : 0;
  const offsetPx = 12 * (0.5 - pct / 100);
  return `calc(${pct}% + ${offsetPx.toFixed(3)}px)`;
}

/** Background for the actual-spend overlay, read left to right as **settled →
 *  still owed → not spent**.
 *
 *  The whole bar used to be red, which said "this money is gone" about an
 *  amount the couple may already have paid off in full — so a row that needed
 *  nothing from them looked identical to one with an invoice still open, and
 *  the only alarm colour on the page marked both. The `paid_huf` share is green
 *  instead: money out of the door, nothing left to do. A fully settled row is
 *  therefore entirely green, which is what finally makes the red on the others
 *  mean "still to pay" rather than just "spent".
 *
 *  `paid_huf` is clamped to `[0, actual_huf]` server-side, so the stops can
 *  never cross; the clamp here only guards a stale optimistic row. Nothing paid
 *  skips the green stop entirely — at 0 the thumb offset is +6 px, so a zero
 *  green segment would still paint a 6 px cap. */
function actualOverlayBackground(actual: number, paid: number, rowMax: number): string {
  const actualStop = overlayStop(actual, rowMax);
  const tail = `var(--range-actual-remainder) ${actualStop}, var(--range-actual-remainder) 100%`;
  const settled = Math.max(0, Math.min(paid, actual));
  if (settled <= 0) {
    return `linear-gradient(to right, var(--range-actual-amount) 0%, var(--range-actual-amount) ${actualStop}, ${tail})`;
  }
  const paidStop = overlayStop(settled, rowMax);
  return `linear-gradient(to right, var(--range-paid-amount) 0%, var(--range-paid-amount) ${paidStop}, var(--range-actual-amount) ${paidStop}, var(--range-actual-amount) ${actualStop}, ${tail})`;
}

// (Visual constants previously lived here — per-row tuning is now derived
//  from `widthAnchor` directly so every row shares the same denominator.)

/** How long a slider sits still before its value is persisted.
 *
 *  A range input only fires pointerup/keyup when the gesture ends ON the
 *  track. Release outside it — or let the browser cancel the touch, or spin
 *  the wheel over a focused slider — and the old commit-on-release wiring
 *  never saved at all, while the preview kept showing the new amount until
 *  something else cleared it. That's the "it looked saved, then jumped back"
 *  report. Persisting a beat after the last move means every gesture lands;
 *  pointerup/keyup just flush it early. It also collapses a run of arrow-key
 *  steps into a single PATCH instead of one per keypress. */
const COMMIT_DELAY_MS = 350;

/** Categories whose planned cost scales with headcount. Everything else is
 *  treated as a fixed cost (venue rental, photographer day rate, rings, …). */
export const PER_GUEST_CATEGORIES = new Set<BudgetCategory>([
  "catering",
  "drinks",
  "cake_dessert",
  "favours",
  "stationery",
]);

/** Rings category glyph. Lucide ships no wedding-ring icon (the old
 *  `rings: Circle` was just a bare band), so this hand-drawn SVG mounts a
 *  brilliant-cut diamond on a round band to read unmistakably as a ring.
 *  Matches the lucide convention (24 viewBox, currentColor, 2px stroke) so it
 *  sits flush with the other category icons at size 14. */
function RingDiamond({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* band */}
      <circle cx="12" cy="17" r="4" />
      {/* brilliant-cut diamond seated above the band */}
      <path d="M12 3.5 15 7 12 11 9 7z" />
      {/* girdle facet line */}
      <path d="M9 7h6" />
    </svg>
  );
}

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
  rings: RingDiamond,
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
 *  about together (so related rows stay adjacent), with clusters themselves
 *  ordered biggest-typical-spend first — the curated share ratios the
 *  landing-page calculator uses (`DEMO_ROWS_HU`/`DEMO_ROWS_EU` in
 *  InteractiveBudgetDemo.tsx) put food/drink and venue clearly first, then
 *  photo+music+decor together outweighing favours/stationery/transport, which
 *  is why cluster 2 and cluster 4 swapped places from the original purely-
 *  topical grouping. Clusters:
 *    1. hosting & food         (venue → cake)          — biggest fixed costs
 *    2. atmosphere & memories  (photo, music, decor)    — usually next-biggest
 *    3. couple's appearance    (attire, hair & makeup, rings)
 *    4. guest experience       (favours, stationery, transport) — smaller line items
 *    5. after-wedding & misc   (honeymoon, other) */
const CATEGORY_ORDER: BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "cake_dessert",
  "photo_video",
  "music_dj",
  "decor_floral",
  "attire",
  "hair_makeup",
  "rings",
  "favours",
  "stationery",
  "transport",
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
  countLocked = false,
  onCountLockToggle,
  currency = "HUF",
  onCountChange,
  countSaveStatus = "idle",
  countUndoAvailable = false,
  onUndoCountChange,
  headcountChanged = false,
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
  currencySelector,
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
  /** When true, the headcount slider collapses out of view and clicking
   *  the big number unlocks it instead of entering edit mode. Defaults
   *  to false for legacy callers (Dashboard) that don't surface the
   *  lock affordance yet. */
  countLocked?: boolean;
  /** Toggles the lock flag. Called with no args; the parent flips
   *  `planning_count_locked` server-side via coupleApi.update. Optional
   *  — when omitted the big number is a non-interactive display. */
  onCountLockToggle?: () => void | Promise<void>;
  onCountChange: (n: number) => void;
  /** Truthful server persistence state for the shared headcount scenario. */
  countSaveStatus?: CostPlanningSaveStatus;
  /** Short-lived undo for the most recent completed headcount gesture. */
  countUndoAvailable?: boolean;
  onUndoCountChange?: () => void;
  /** Highlights only rows whose planned amount changed with headcount. */
  headcountChanged?: boolean;
  /** Called when the user commits a new min or max on the bounds inputs.
   *  The parent persists `guest_count_goal = { kind: "range", min, max }`
   *  so both pages stay synchronised. Optional — bounds become read-only
   *  when omitted. */
  onBoundsChange?: (min: number, max: number) => void | Promise<void>;
  /** Called when the user releases a category slider with a new amount.
   *  The parent applies it to the underlying budget lines. */
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<unknown>;
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
   *  rows (and, per-category, inside each row's expanded sub-item drawer —
   *  see `expanded`/`onToggleExpand` on `CategoryRow`). Couples can add
   *  free-form line items (e.g. "Anyakönyvvezető", "Egyházi szertartás", or
   *  a named split of an existing category like "Fotós"/"Videós") that show
   *  as their own row rather than being lumped into the blended total.
   *  `options.perGuest` opts the row into the same headcount-driven rescale
   *  that built-in per-guest categories get; `options.icon` is a slug from
   *  CUSTOM_ICON_CHOICES that renders in place of the default MoreHorizontal
   *  glyph. `category` defaults to `"other"` (the bottom-of-list affordance
   *  never passes it) — a per-category drawer's add-form passes its own
   *  category so the line lands in that bucket instead of Egyéb. */
  onAddCustomRow?: (
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
    category?: BudgetCategory,
  ) => void | Promise<void>;
  /** Commits a slider drag on a custom row. The lineId identifies the
   *  underlying BudgetLine — custom rows are not aggregated, so we edit by
   *  line instead of by category. */
  onEditCustomRowPlanned?: (lineId: number, plannedHuf: number) => void | Promise<void>;
  /** Removes a custom row. Parent should confirm before calling. */
  onRemoveCustomRow?: (lineId: number) => void | Promise<void>;
  /** Rendered at the top-right of the card, beside the actual-spend toggle
   *  and the cap pill — e.g. an icon-only `<CurrencySelect>`. Optional so
   *  embedders without a currency picker of their own (the dashboard) don't
   *  reserve space for one. */
  currencySelector?: ReactNode;
}) {
  const { t, locale } = useT();
  // Second-layer overlay: each category row renders a thin red bar under the
  // planned slider showing the actual spend.
  //
  // ON by default. Planned-against-actual is the whole reason this panel is a
  // set of sliders rather than a table, and it was parked behind an unlabelled
  // Receipt glyph that most couples never pressed — so the answer the page
  // exists to give ("where am I against what I said?") was the one thing it
  // did not show on arrival. The toggle stays, because a couple who finds the
  // second bar noisy needs a way to quiet it, and now that it starts visible
  // the control reads as "hide this" rather than as a mystery button. It also
  // only renders once some row HAS an actual, so it never sits there dead.
  // Local state, no persistence: it costs one tap to restore.
  const [showActualOverlay, setShowActualOverlay] = useState(true);
  const factor = baseline > 0 ? count / baseline : 1;

  // In-progress drags, ONE ENTRY PER ROW. Lifted out of the row components
  // because the summary total at the bottom of the card has to reflect the
  // drag live — otherwise totalPlanned lags behind the row slider.
  //
  // This used to be a single {key, value} slot, on the reasoning that only one
  // slider can physically be dragged at a time. True, but the slot doubled as
  // the *only* place a released-but-not-yet-saved amount lived: grab a second
  // row before the first row's PATCH came back and the first row visibly
  // snapped to its pre-edit value. Keeping one entry per row means an
  // unrelated drag can never erase a pending one. (The parent now also lands
  // the new amount in `lines` optimistically, so the two layers agree; these
  // entries only cover the window before that happens.)
  const [categoryDrags, setCategoryDrags] = useState<Partial<Record<BudgetCategory, number>>>({});
  const [customDrags, setCustomDrags] = useState<Record<number, number>>({});
  // Stable callbacks the row components call on each pointer-move. Stable
  // identity is what lets React.memo on CategoryRow / CustomRow actually
  // skip re-renders for siblings whose values didn't change.
  const handleCategoryDrag = useCallback((category: BudgetCategory, value: number) => {
    setCategoryDrags((cur) => (cur[category] === value ? cur : { ...cur, [category]: value }));
  }, []);
  const handleCustomDrag = useCallback((lineId: number, value: number) => {
    setCustomDrags((cur) => (cur[lineId] === value ? cur : { ...cur, [lineId]: value }));
  }, []);
  // Drop a row's preview once its own commit lands — by then `lines` carries
  // the same amount, so the entry is redundant. Skipped when the user has
  // dragged further in the meantime: that value has a newer commit on the way
  // and clearing it would yank the thumb backwards mid-gesture.
  const settleCategoryDrag = useCallback((category: BudgetCategory, value: number) => {
    setCategoryDrags((cur) => {
      if (cur[category] !== value) return cur;
      const next = { ...cur };
      delete next[category];
      return next;
    });
  }, []);
  const settleCustomDrag = useCallback((lineId: number, value: number) => {
    setCustomDrags((cur) => {
      if (cur[lineId] !== value) return cur;
      const next = { ...cur };
      delete next[lineId];
      return next;
    });
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

  // Categories the couple cannot re-plan from here, because a booked supplier
  // owns at least one of their lines. The server refuses every write to a
  // mirrored line, so offering the slider anyway was a control whose only
  // possible outcome was a failed save. Derived from the SAME lines the
  // buckets aggregate, so a supplier that mirrored into a custom row (a
  // planner's fee lands in `other` under the business's own name) locks its
  // own row below rather than the whole "Egyéb" bucket.
  const supplierManaged = useMemo(
    () => supplierManagedCategories(aggregatableLines),
    [aggregatableLines],
  );

  // Aggregate lines into category buckets. Every category in CATEGORY_ORDER
  // gets a row (even with 0 planned) so the user can slide it up from zero.
  // Custom rows are excluded — they own their own row below the buckets so
  // we don't want them folded back into "Egyéb" here.
  //
  // `lines` is carried on the bucket too (not just the summed totals) so the
  // expandable drawer below each row can render — and let the couple name —
  // the individual lines making up the total, instead of only the blended
  // number. A category with a booked supplier folded in becomes inspectable
  // here for the first time, same reasoning as `sources` in BudgetPage's
  // CategoryCell.
  const buckets = useMemo(() => {
    const map = new Map<
      BudgetCategory,
      { planned: number; actual: number; paid: number; lines: BudgetLine[] }
    >();
    for (const l of aggregatableLines) {
      const cur = map.get(l.category) ?? { planned: 0, actual: 0, paid: 0, lines: [] };
      cur.lines.push(l);
      map.set(l.category, {
        planned: cur.planned + l.planned_huf,
        actual: cur.actual + l.actual_huf,
        paid: cur.paid + l.paid_huf,
        lines: cur.lines,
      });
    }
    return CATEGORY_ORDER.map((cat) => {
      const v = map.get(cat) ?? { planned: 0, actual: 0, paid: 0, lines: [] };
      const isPerGuest = PER_GUEST_CATEGORIES.has(cat);
      const frozen = frozenCategories?.has(cat) ?? false;
      // Frozen categories opt out of per-guest scaling — the user has pinned
      // a real-world quote and doesn't want it sliding around with the count.
      const scales = isPerGuest && !frozen;
      // Active drag (if any) overrides the committed baseline — that's how
      // totalPlanned tracks the slider live. `??` not `||`: 0 is a real value.
      const liveBaseline = categoryDrags[cat] ?? v.planned;
      return {
        category: cat,
        actual: v.actual,
        paid: v.paid,
        // Display planned = baseline planned scaled for per-guest categories.
        plannedDisplay: scales ? Math.round(liveBaseline * factor) : liveBaseline,
        plannedBaseline: liveBaseline,
        scales,
        frozen,
        lines: v.lines,
      };
    });
  }, [aggregatableLines, factor, frozenCategories, categoryDrags]);

  // Categories the couple has expanded to see/name the individual lines
  // behind the blended total (see `buckets[].lines` above). Session-only,
  // starts empty — every row collapses back to today's single-slider view
  // by default, and expanding one category never affects the others.
  const [expandedCategories, setExpandedCategories] = useState<Set<BudgetCategory>>(
    () => new Set(),
  );
  const toggleExpanded = useCallback((category: BudgetCategory) => {
    setExpandedCategories((cur) => {
      const next = new Set(cur);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  // Live custom-row totals — same drag-aware pattern as `buckets` so the
  // panel's grand total tracks slider movement, not just commits. Per-guest
  // custom rows store the BASELINE amount in `planned_huf`; the display
  // value is `baseline * factor` so a drag of the headcount slider rescales
  // them just like built-in per-guest categories.
  const customDisplays = useMemo(
    () =>
      customRows.map((l) => {
        const liveBaseline = customDrags[l.id] ?? l.planned_huf;
        const scales = l.per_guest;
        return {
          line: l,
          planned: scales ? Math.round(liveBaseline * factor) : liveBaseline,
          plannedBaseline: liveBaseline,
          actual: l.actual_huf,
          scales,
        };
      }),
    [customRows, customDrags, factor],
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

  // Shared denominator for the per-row slider's rail (both visual fill and
  // input.max — keeping them in sync is what stops the thumb from drifting
  // ahead of the painted fill).
  //
  // Dynamic-expansion model: the rail defaults to **25 % of the budget cap**
  // — at a 6 M cap that's 1.5 M, generous for most categories and tight
  // enough that small rows still read as a meaningful fraction of the rail.
  // When any row is pulled into the last 5 % of the current rail, the rail
  // stretches so that row stays at 95 % of the rail, up to a hard ceiling
  // of **75 % of cap**. That gives the "gently grow as you drag" feel and
  // means a single category can never visually claim the entire budget on
  // its own.
  //
  // Fallback (no cap set): keep the old soft-cap formula so the slider still
  // tracks the largest row with some headroom.
  const widthAnchor = useMemo(() => {
    if (cap !== null && cap > 0) {
      const minRail = cap * 0.25;
      const maxRail = cap * 0.75;
      const largestRow = Math.max(
        ...buckets.map((b) => b.plannedDisplay),
        ...customDisplays.map((c) => c.planned),
        0,
      );
      const expanded = largestRow / 0.95;
      return Math.round(Math.min(maxRail, Math.max(minRail, expanded)));
    }
    const maxRowAmount = Math.max(
      ...buckets.map((b) => b.plannedDisplay),
      ...customDisplays.map((c) => c.planned),
      0,
    );
    return Math.max(1_500_000, Math.round(maxRowAmount * 1.2), 100_000);
  }, [cap, buckets, customDisplays]);

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
    <section className="card p-4" aria-label={t("budget.cost_planning_headline")}>
      <div className="flex flex-wrap items-center justify-end gap-3">
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
        {currencySelector}
      </div>

      {/* Big centred live count — number large, "vendég" small below. On
       *  desktop the negative top margin pulls the number flush under the
       *  eyebrow row, but on phones that overlap reads as crowded against
       *  the overage pill that wraps to its own line — so mobile gets a
       *  positive top gap and a touch more breathing room under the label.
       *
       *  Click-to-lock: the lock is its OWN control beside the number, not
       *  the number itself. It used to be the number, with the affordance
       *  carried by an open-lock badge revealed on hover — which does not
       *  exist on a touch screen, so tapping the headcount silently pinned
       *  it and collapsed the slider underneath with nothing having said the
       *  number was a button. Same reasoning as the per-row category lock.
       *  Locking still collapses the slider beneath with a max-height
       *  transition, so the panel reads as having tucked the knob away
       *  rather than greying it out.
       *
       *  The lock occupied layout width even while invisible, so making it
       *  permanent costs no shift in where the number sits. */}
      <div className="mt-3 text-center sm:-mt-3">
        <div className="inline-flex items-center gap-2 px-2 py-0.5">
          <span className="font-grotesk text-5xl leading-none text-ink-900 sm:text-5xl dark:text-paper-50">
            {formatNumber(count, locale)}
          </span>
          {onCountLockToggle && (
            <button
              type="button"
              onClick={() => void onCountLockToggle()}
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-200 dark:focus-visible:ring-paper-50 ${
                countLocked
                  ? "text-ink-600 hover:bg-paper-100 dark:text-umber-200 dark:hover:bg-umber-700"
                  : "text-ink-300 hover:bg-paper-100 hover:text-ink-600 dark:text-umber-500 dark:hover:bg-umber-700 dark:hover:text-umber-200"
              }`}
              aria-pressed={countLocked}
              aria-label={t(
                countLocked
                  ? "budget.cost_planning_count_unlock_aria"
                  : "budget.cost_planning_count_lock_aria",
              )}
              title={t(
                countLocked
                  ? "budget.cost_planning_count_unlock_aria"
                  : "budget.cost_planning_count_lock_aria",
              )}
            >
              {countLocked ? <Lock size={16} aria-hidden /> : <LockOpen size={16} aria-hidden />}
            </button>
          )}
        </div>
        <div className="mt-2 text-[11px] font-medium uppercase tracking-wider text-ink-400 sm:mt-0.5 dark:text-umber-400">
          {t("budget.cost_planning_unit_label")}
        </div>
      </div>

      {/* Headcount slider — compact single block. Wrapped in a
       *  max-height + opacity transition so flipping `countLocked`
       *  smoothly tucks the slider away (and brings it back) rather
       *  than yanking the panel layout. `aria-hidden` + `pointer-events
       *  -none` while collapsed keep keyboard users and screen readers
       *  from landing on an invisible control. */}
      <div
        className={`grid overflow-hidden transition-[grid-template-rows,opacity,margin] duration-300 ease-in-out ${
          countLocked
            ? "mt-0 grid-rows-[0fr] opacity-0"
            : "mt-6 grid-rows-[1fr] opacity-100 sm:mt-4"
        }`}
        aria-hidden={countLocked}
      >
        <div className={`min-h-0 py-1.5 ${countLocked ? "pointer-events-none" : ""}`}>
          <input
            type="range"
            min={minCount}
            max={maxCount}
            step={1}
            value={count}
            onChange={(e) => onCountChange(Number(e.target.value))}
            className="range-fill range-fill-touch block w-full"
            style={rangeFillStyle(count, minCount, maxCount)}
            aria-label={t("budget.cost_planning_title")}
            tabIndex={countLocked ? -1 : undefined}
            disabled={countLocked}
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-ink-400 dark:text-umber-300">
            <CountInput
              value={minCount}
              min={10}
              max={maxCount - 5}
              onCommit={commitMin}
              ariaLabel={t("budget.slider_min_aria")}
              readOnly={!onBoundsChange || countLocked}
            />
            {/* Midpoint of the bounds, snapped to 5 — a scale tick, not a
                number the couple set. It used to render at the same size and
                colour as the two editable bounds either side of it, so the
                three read as one unlabelled triple and invited the question
                "which of these is our headcount?" (the answer is the big
                figure above). Demoted and hidden from screen readers, which
                get min/max from the two inputs' own labels. */}
            <span
              className="stat-num text-[10px] text-ink-300 dark:text-umber-500"
              aria-hidden="true"
            >
              {formatNumber(midCount, locale)}
            </span>
            <CountInput
              value={maxCount}
              min={minCount + 5}
              max={2000}
              onCommit={commitMax}
              ariaLabel={t("budget.slider_max_aria")}
              readOnly={!onBoundsChange || countLocked}
            />
          </div>
          <div
            className="mt-1 flex min-h-5 items-center justify-center gap-2 text-[11px]"
            role="status"
            aria-live="polite"
          >
            {countSaveStatus === "saving" && (
              <span className="text-ink-500 dark:text-umber-300">{t("common.saving")}</span>
            )}
            {countSaveStatus === "saved" && (
              <span className="text-sage-700 dark:text-sage-300">
                {t("budget.cost_planning_saved")}
              </span>
            )}
            {countSaveStatus === "error" && (
              <span className="text-blush-700 dark:text-blush-300">
                {t("budget.cost_planning_save_error")}
              </span>
            )}
            {countUndoAvailable && onUndoCountChange && (
              <button
                type="button"
                onClick={onUndoCountChange}
                className="font-medium text-ink-700 underline underline-offset-2 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
              >
                {t("common.undo")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Per-category sliders — single line per category, denser spacing.
       *  Honeymoon is the one exception: its lines live on /app/honeymoon
       *  (a dedicated sub-page with its own breakdown + map), so we show
       *  the same row visual here but route the click through and skip
       *  the slider input — no in-place drag. */}
      <ul className="mt-4 divide-y divide-paper-100 dark:divide-umber-700">
        {buckets.map((b) => {
          const isHoneymoon = b.category === "honeymoon";
          const isExpanded = expandedCategories.has(b.category);
          const rowScaleFactor = b.scales ? factor : 1;
          return (
            <Fragment key={b.category}>
              <CategoryRow
                category={b.category}
                plannedBaseline={b.plannedBaseline}
                actual={b.actual}
                paid={b.paid}
                scales={b.scales}
                frozen={b.frozen}
                // Per-guest categories receive the live headcount factor so the
                // slider thumb tracks the count slider and a drag preserves the
                // /fő unit price (not the baseline planned amount). Frozen rows
                // pass `scales=false` so the factor is 1 — no rescale.
                scaleFactor={rowScaleFactor}
                count={count}
                widthAnchor={widthAnchor}
                currency={currency}
                supplierManaged={supplierManaged.has(b.category)}
                onEditPlanned={onEditPlanned}
                onToggleFreeze={onToggleFreeze}
                onDrag={handleCategoryDrag}
                onSettle={settleCategoryDrag}
                amountLinkTo={amountLinkTo}
                showActualOverlay={showActualOverlay && hasAnyActual}
                highlighted={headcountChanged && b.scales}
                linkTo={isHoneymoon ? "/app/honeymoon" : undefined}
                // Honeymoon routes straight to its own sub-page — nothing to
                // expand in place. Every other category (including "other",
                // whose bucket only ever holds the anonymous default-labeled
                // line — named "other" rows live in the standalone custom-row
                // list below) can be split into named sub-items.
                expandable={!isHoneymoon}
                expanded={isExpanded}
                onToggleExpand={toggleExpanded}
              />
              {/* Sub-item drawer — each of this category's own lines, editable
               *  individually, plus an "add item" affordance. Reuses `CustomRow`
               *  verbatim (it already only cares about a BudgetLine id, not its
               *  category) so a named sub-item gets the exact same slider,
               *  actual-overlay and delete treatment a standalone custom row
               *  does. */}
              {!isHoneymoon &&
                isExpanded &&
                b.lines.map((line) => {
                  const liveBaseline = customDrags[line.id] ?? line.planned_huf;
                  return (
                    <CustomRow
                      key={line.id}
                      line={line}
                      liveDisplay={Math.round(liveBaseline * rowScaleFactor)}
                      scaleFactor={rowScaleFactor}
                      count={count}
                      widthAnchor={widthAnchor}
                      currency={currency}
                      onEditPlanned={onEditCustomRowPlanned}
                      onRemove={onRemoveCustomRow}
                      onDrag={handleCustomDrag}
                      onSettle={settleCustomDrag}
                      showActualOverlay={showActualOverlay && hasAnyActual}
                    />
                  );
                })}
              {!isHoneymoon && isExpanded && onAddCustomRow && (
                <AddCustomRow
                  onAdd={(label, plannedHuf, options) =>
                    onAddCustomRow(label, plannedHuf, options, b.category)
                  }
                  showPerGuestToggle={false}
                />
              )}
            </Fragment>
          );
        })}
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
            currency={currency}
            onEditPlanned={onEditCustomRowPlanned}
            onRemove={onRemoveCustomRow}
            onDrag={handleCustomDrag}
            onSettle={settleCustomDrag}
            showActualOverlay={showActualOverlay && hasAnyActual}
            highlighted={headcountChanged && c.scales}
          />
        ))}
        {onAddCustomRow && <AddCustomRow onAdd={onAddCustomRow} />}
      </ul>

      <div className="mt-4 border-t border-paper-200 pt-3 dark:border-umber-700">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400 dark:text-umber-400">
            {/* The headline figure is ALWAYS totalPlanned, so the label names
                planned. It used to flip to "Total actual" once any actual spend
                existed, which mislabelled the planned figure as actual. */}
            {t("budget.total_planned")}
          </span>
          <span
            data-testid="cost-planning-total"
            className={`stat-num font-grotesk text-xl font-semibold tracking-tight ${overCap ? "text-blush-700 dark:text-blush-300" : "text-ink-900 dark:text-paper-50"}`}
          >
            {formatMoney(totalPlanned, currency, locale)}
          </span>
        </div>
        {/* Actual spend used to ride the headline as an unlabelled "{actual} /"
            prefix, which made the pair read as one ratio nobody could name (and
            the label above named only the second half of it). It now takes the
            same shape as the cap row below: its own name, its own number, at
            every width. */}
        {totalActual > 0 && (
          <div className="mt-1 flex items-baseline justify-between text-[11px]">
            <span className="text-ink-400 dark:text-umber-300">{t("budget.total_actual")}</span>
            <span className="stat-num text-ink-500 dark:text-umber-200">
              {formatMoney(totalActual, currency, locale)}
            </span>
          </div>
        )}
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
                {cap !== null ? formatMoney(cap, currency, locale) : "-"}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Shared row template for every child of the category `<ul>`. The trailing
 *  column is the freeze lock, and it is reserved on EVERY row variant —
 *  including the ones that can't be frozen (honeymoon's link row, custom
 *  rows) — because they share one list and a per-row column count would
 *  stagger the sliders against each other.
 *
 *  The row WRAPS below `sm:`. One line was only ever affordable by hiding the
 *  category name, which left a phone showing thirteen bar charts labelled
 *  with nothing but a 14 px glyph — and the rail was squeezed to ~9rem to buy
 *  even that. Putting the slider on its own line pays for itself twice: the
 *  name comes back at full width, and the rail roughly doubles, which is the
 *  difference between a bar chart and a smear. Desktop is untouched — it has
 *  the width for one line and keeps it. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[10rem_minmax(0,1fr)_11rem_1.75rem] sm:gap-x-3 sm:gap-y-0 sm:text-sm";
/** Cell placement, so the three row variants can't drift out of step. The
 *  DOM order stays label → track → amount → lock (which is the reading order
 *  on desktop and the tab order everywhere); mobile re-places the track onto
 *  its own line underneath. */
const ROW_LABEL_CELL = "col-start-1 row-start-1";
const ROW_TRACK_CELL =
  "col-start-1 col-span-3 row-start-2 sm:col-start-2 sm:col-span-1 sm:row-start-1";
const ROW_AMOUNT_CELL = "col-start-2 row-start-1 sm:col-start-3";
const ROW_LOCK_CELL = "col-start-3 row-start-1 sm:col-start-4";

function CategoryRowInner({
  category,
  plannedBaseline,
  actual,
  paid,
  scales,
  frozen,
  scaleFactor,
  count,
  widthAnchor,
  currency,
  supplierManaged = false,
  onEditPlanned,
  onToggleFreeze,
  onDrag,
  onSettle,
  amountLinkTo,
  showActualOverlay = false,
  highlighted = false,
  linkTo,
  expandable = false,
  expanded = false,
  onToggleExpand,
}: {
  category: BudgetCategory;
  plannedBaseline: number;
  actual: number;
  /** How much of `actual` the couple has already settled (sum of `paid_huf`).
   *  Colours the settled head of the actual bar green — see
   *  `actualOverlayBackground`. */
  paid: number;
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
  /** Shared denominator for the slider — drives both the visual fill stop and
   *  `<input type="range">.max`. Dynamic: defaults to 25 % of the budget cap,
   *  expands gently up to 75 % of cap as a row is pulled toward the rail's
   *  right edge. Floored upstream so it never hits zero. */
  widthAnchor: number;
  /** A booked supplier owns at least one of this category's lines, so its
   *  planned total is not ours to move: the server 409s every write to a
   *  mirrored line, and the amount is edited on the supplier's own card. The
   *  slider goes read-only and the row says why, rather than offering a drag
   *  whose only outcome is a failed save. */
  supplierManaged?: boolean;
  onEditPlanned?: (category: BudgetCategory, plannedHuf: number) => Promise<unknown>;
  onToggleFreeze?: (category: BudgetCategory) => void | Promise<void>;
  /** Drag handler — fires on each slider change with the row's category and
   *  the new *baseline* value. Identity-stable in the parent so React.memo
   *  on this component can skip re-renders for sibling rows. */
  onDrag?: (category: BudgetCategory, baselineValue: number) => void;
  /** Fires once this row's own commit has landed, with the baseline value
   *  that was saved, so the parent can retire the row's drag preview. */
  onSettle?: (category: BudgetCategory, baselineValue: number) => void;
  /** When set, the per-row amount is rendered as a Link to
   *  `${amountLinkTo}#cat-${category}` so a tap routes the user to the budget
   *  table for precise entry. Used on the dashboard. */
  amountLinkTo?: string;
  /** When `true`, a thin non-interactive red bar appears under the planned
   *  slider showing the actual spend (sum of `actual_huf` for this category)
   *  scaled by the same `widthAnchor`. Toggled via the panel header. */
  showActualOverlay?: boolean;
  /** Brief feedback after a headcount change for rows that were recalculated. */
  highlighted?: boolean;
  /** When set, the row is non-interactive (no slider drag) and the whole
   *  row clicks through to this internal route. Used for honeymoon — its
   *  sub-categories live on /app/honeymoon, so we route there instead of
   *  duplicating editing here. */
  linkTo?: string;
  /** Whether this row may be expanded to reveal its individual lines. False
   *  for honeymoon (no in-place drawer — see `linkTo`). */
  expandable?: boolean;
  /** Whether the sub-item drawer is currently open. The parent owns this —
   *  it also has to render the drawer's rows, which live outside this
   *  component so they can reuse the panel's `CustomRow`/drag-state plumbing
   *  unchanged. */
  expanded?: boolean;
  /** Toggles the drawer. Parent identity-stable, category-keyed. */
  onToggleExpand?: (category: BudgetCategory) => void;
}) {
  const { t, locale } = useT();
  const Icon = CATEGORY_ICONS[category];
  const editable = !!onEditPlanned && !supplierManaged;

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
  // Scales with the row: a fixed 10 000 / 25 000 was forint, and it left a
  // euro budget's whole row spanning two or three positions of the rail.
  const step = moneySliderStep(rowMax);

  // Per-guest unit for the cross-coupling hint. Suppressed while the row is
  // still 0 — a "0/fő" subscript next to "0 Ft" is just noise, and one user
  // in the test cohort read it as "each guest costs 0 forint" instead of
  // "no plan yet". Once the row has a value the hint becomes useful again.
  const perGuest = scales && count > 0 && liveDisplay > 0 ? Math.round(liveDisplay / count) : null;

  // Drag input is in display units. Convert back to baseline immediately —
  // both the parent's preview and the pending commit are stored in baseline
  // units, so the saved amount stays normalised to the couple's baseline
  // guest count no matter where the headcount slider moves in between.
  function toBaseline(scaledNew: number): number {
    return scaleFactor > 0 ? Math.round(scaledNew / scaleFactor) : scaledNew;
  }

  // Debounced persistence — see COMMIT_DELAY_MS. `pending` holds the value
  // waiting to be written (null = nothing to save), so a stray pointerup with
  // no preceding change can't fire a redundant PATCH.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    },
    [],
  );

  async function commit(baselineNext: number) {
    pending.current = null;
    if (!onEditPlanned) return;
    // The parent applies the amount to `lines` before the round trip, so the
    // row keeps its value throughout; `onSettle` just retires the preview.
    // Both parents surface their own save errors (toast + reconcile), so the
    // catch here only stops a fire-and-forget commit from raising an
    // unhandled rejection and stranding the preview.
    try {
      await onEditPlanned(category, baselineNext);
    } catch {
      /* handled upstream */
    } finally {
      onSettle?.(category, baselineNext);
    }
  }

  function scheduleCommit(baselineNext: number) {
    pending.current = baselineNext;
    if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      if (pending.current !== null) void commit(pending.current);
    }, COMMIT_DELAY_MS);
  }

  function flushCommit() {
    if (commitTimer.current !== null) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    if (pending.current !== null) void commit(pending.current);
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
  // NOT disabled while a save is in flight: toggling `disabled` mid-gesture
  // kills the native drag and locks the user out for a whole round trip,
  // which is most of what "the budget saves slowly" felt like. Ordering is
  // handled by the parent's per-row write queue instead.
  const sliderDisabled = !editable || frozen;

  // Left tile — icon + name, and NOTHING else. It used to double as the
  // freeze toggle, which made one glyph mean two things: below `sm:` the
  // label is hidden, so the entire tile was a bare 14 px category icon whose
  // tap silently froze the category. The hover-swap that was supposed to
  // advertise it does not exist on a touch screen. Freezing now has its own
  // control in the trailing column (see `lockTile`); the icon is identity.
  // Frozen rows still tint the whole tile blush so the lock reads at a glance.
  const frozenTint = frozen ? "text-blush-700 dark:text-blush-300" : "";
  const leftTileContent = (
    <>
      <Icon
        size={14}
        className={`shrink-0 ${frozen ? "text-blush-700 dark:text-blush-300" : "text-ink-500 dark:text-umber-300"}`}
        aria-hidden
      />
      {/* Shown at every width now that the slider has its own line on mobile.
       *  `truncate` still guards the long names against the 10rem desktop
       *  column. */}
      <span className={`min-w-0 truncate ${frozenTint}`}>{categoryLabel}</span>
    </>
  );

  // Chevron — reveals/hides this category's own sub-item drawer (rendered
  // by the parent panel, right after this row). Sits before the icon so the
  // whole "is there more here" affordance reads left-to-right ahead of the
  // category identity, same order a disclosure triangle always takes.
  // Collapsed by default on every category (see `expandedCategories` in the
  // parent) — this is purely additive, so a category nobody has split still
  // looks exactly like it did before.
  const expandTile = expandable ? (
    <button
      type="button"
      onClick={() => onToggleExpand?.(category)}
      aria-expanded={expanded}
      aria-label={t(expanded ? "budget.collapse_category_aria" : "budget.expand_category_aria", {
        category: categoryLabel,
      })}
      className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 transition hover:bg-paper-100 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:text-umber-400 dark:hover:bg-umber-700 dark:hover:text-paper-100"
    >
      <ChevronDown
        size={13}
        aria-hidden
        className={`transition-transform ${expanded ? "" : "-rotate-90"}`}
      />
    </button>
  ) : null;

  const leftTile = (
    <span
      className={`${ROW_LABEL_CELL} flex min-w-0 items-center gap-2 text-ink-700 dark:text-paper-100 ${frozenTint}`}
    >
      {expandTile}
      {leftTileContent}
    </span>
  );

  // Trailing tile — the freeze toggle, one fixed position down the whole
  // list so it is learnable, and never the same glyph as anything else in
  // the row. Open shackle = editable, closed = pinned: the state is carried
  // by SHAPE first and colour second, so it survives a glance and a
  // colour-blind reader. Rows that cannot be frozen render an empty cell
  // rather than dropping the column (see ROW_GRID).
  const lockTile = canToggleFreeze ? (
    <button
      type="button"
      onClick={() => onToggleFreeze?.(category)}
      className={`${ROW_LOCK_CELL} inline-flex h-6 w-6 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 ${
        frozen
          ? "text-blush-700 hover:bg-blush-50 dark:text-blush-300 dark:hover:bg-blush-400/15"
          : "text-ink-300 hover:bg-paper-100 hover:text-ink-600 dark:text-umber-500 dark:hover:bg-umber-700 dark:hover:text-umber-200"
      }`}
      aria-pressed={frozen}
      aria-label={t(frozen ? "budget.unfreeze_aria" : "budget.freeze_aria", {
        category: categoryLabel,
      })}
      title={t(frozen ? "budget.unfreeze_aria" : "budget.freeze_aria", {
        category: categoryLabel,
      })}
    >
      {frozen ? <Lock size={12} aria-hidden /> : <LockOpen size={12} aria-hidden />}
    </button>
  ) : (
    <span className={ROW_LOCK_CELL} aria-hidden />
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
  // narrow mobile right-column when both halves are tiny. The pair stays
  // visible at every width: dropping the actual half on phones was data loss,
  // not responsive compression. The rail already wraps to its own row on
  // mobile, so the amount can use the header width without shrinking it.
  // Names both halves of the pair on hover / for assistive tech. The slash is
  // dense enough to scan but says nothing about which number is which, and a
  // per-row visible label would cost more width than the pair itself.
  const pairTitle =
    actual > 0
      ? t("budget.amount_pair_title", {
          actual: formatMoney(actual, currency, locale),
          planned: formatMoney(liveDisplay, currency, locale),
        })
      : undefined;
  const amountInner = (
    <span className="flex flex-col items-end leading-tight" title={pairTitle}>
      <span className="whitespace-nowrap">
        {actual > 0 && (
          <span className="text-ink-400 dark:text-umber-300">
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
  //
  // Zero rows (no planned amount yet) drop to a soft placeholder tint so the
  // "0 Ft" reads as "not filled in" instead of competing with the real
  // numbers — the eye skips to the rows that actually carry value.
  const amountColorClass = frozen
    ? "text-blush-700 dark:text-blush-300"
    : liveDisplay === 0
      ? "text-ink-300 dark:text-umber-500"
      : "text-ink-700 dark:text-paper-100";
  const amountTile =
    amountLinkTo && !linkTo ? (
      <Link
        to={`${amountLinkTo}#cat-${category}`}
        className={`${ROW_AMOUNT_CELL} stat-num block rounded text-right text-xs ${amountColorClass} underline-offset-2 transition hover:text-ink-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:hover:text-paper-50`}
        aria-label={t("budget.open_table_aria", { category: categoryLabel })}
      >
        {amountInner}
      </Link>
    ) : (
      <span className={`${ROW_AMOUNT_CELL} stat-num block text-right text-xs ${amountColorClass}`}>
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
      onChange={(e) => {
        // The attribute is what a browser honours; this is what makes "no
        // write is ever planned for a row we do not own" true however the
        // change arrives. A supplier-managed row would 409, and a frozen one
        // is pinned on purpose.
        if (sliderDisabled) return;
        const baselineNext = toBaseline(Number(e.target.value));
        onDrag?.(category, baselineNext);
        scheduleCommit(baselineNext);
      }}
      onPointerUp={flushCommit}
      onTouchEnd={flushCommit}
      onKeyUp={flushCommit}
      onBlur={flushCommit}
      className={`range-fill range-fill-thin block ${frozen ? "range-fill-frozen" : ""}`}
      style={trackStyle}
      aria-label={t("budget.edit_planned_aria", { category: categoryLabel })}
    />
  );

  // Actual-spend overlay: a thin lookalike-slider rendered under the real one,
  // fill width tied to the same widthAnchor as planned so the two bars are
  // visually comparable at a glance. Green head = already paid, red tail =
  // spent but still owed (see `actualOverlayBackground`). Non-interactive —
  // `aria-hidden` keeps it out of the AT tree (the actual amount is already in
  // the right tile copy). Clamped to 100% so over-spend doesn't bleed past the
  // row.
  const actualOverlayStyle: CSSProperties = {
    width: `${widthPct}%`,
    background: actualOverlayBackground(actual, paid, rowMax),
  };
  // A category whose real spend has passed its own plan. The slider fill only
  // shows the PLANNED position on a rail shared across categories, so an
  // overspent row read as "~85 % full" with no danger cue unless the couple
  // toggled the actual overlay on. Surface it unconditionally instead: the red
  // actual bar always shows when over, plus a "Over by {amount}" callout so the
  // excess is spelled out rather than hidden behind the toggle.
  const overBudget = actual > liveDisplay && actual > 0;
  const actualOverlayEl =
    (showActualOverlay || overBudget) && actual > 0 ? (
      <div
        data-actual-overlay="true"
        className="range-fill range-fill-thin mt-1 block"
        style={actualOverlayStyle}
        aria-hidden="true"
      />
    ) : null;
  const overBudgetEl = overBudget ? (
    <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-blush-700 dark:text-blush-300">
      <AlertTriangle size={11} aria-hidden="true" className="shrink-0" />
      {t("budget.over_by", {
        amount: formatMoney(actual - liveDisplay, currency, locale),
      })}
    </span>
  ) : null;
  // Why the slider under it is dead. A read-only control with no explanation
  // reads as a bug, and this one is a decision: the amount belongs to a
  // supplier the couple has already booked, and it changes on that supplier's
  // card. Muted ink rather than blush — nothing is wrong here, and blush is
  // already spoken for by the freeze lock one column over.
  const supplierManagedEl = supplierManaged ? (
    <span
      data-testid={`supplier-managed-${category}`}
      className="mt-1 block text-[10px] text-ink-400 dark:text-umber-300"
    >
      {t("budget.supplier_managed_hint")}
    </span>
  ) : null;

  if (linkTo) {
    return (
      <li>
        <Link
          to={linkTo}
          /* The compact grid keeps the visual rail readable on phones; the
           * actual/planned amount pair remains visible in the amount cell. */
          className={`${ROW_GRID} -mx-2 rounded-md px-2 py-1.5 transition-colors duration-500 hover:bg-paper-50 dark:hover:bg-umber-700 ${highlighted ? "bg-sage-50 ring-1 ring-inset ring-sage-200 dark:bg-sage-400/10 dark:ring-sage-400/20" : ""}`}
          aria-label={categoryLabel}
        >
          <span
            className={`${ROW_LABEL_CELL} flex min-w-0 items-center gap-2 text-ink-700 dark:text-paper-100`}
          >
            {leftTileContent}
          </span>
          <div className={`${ROW_TRACK_CELL} w-full`}>
            {trackEl}
            {actualOverlayEl}
            {overBudgetEl}
          </div>
          <span
            className={`${ROW_AMOUNT_CELL} stat-num block text-right text-xs text-ink-700 dark:text-paper-100`}
          >
            {amountInner}
          </span>
          <span className={ROW_LOCK_CELL} aria-hidden />
        </Link>
      </li>
    );
  }

  return (
    <li
      id={`cat-${category}`}
      className={`${ROW_GRID} -mx-2 scroll-mt-24 rounded-md px-2 py-1.5 transition-colors duration-500 ${highlighted ? "bg-sage-50 ring-1 ring-inset ring-sage-200 dark:bg-sage-400/10 dark:ring-sage-400/20" : ""}`}
    >
      {leftTile}
      <div className={`${ROW_TRACK_CELL} w-full`}>
        {trackEl}
        {actualOverlayEl}
        {overBudgetEl}
        {supplierManagedEl}
      </div>
      {amountTile}
      {lockTile}
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
  currency,
  onEditPlanned,
  onRemove,
  onDrag,
  onSettle,
  showActualOverlay,
  highlighted = false,
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
  currency: Currency;
  onEditPlanned?: (lineId: number, plannedHuf: number) => void | Promise<void>;
  onRemove?: (lineId: number) => void | Promise<void>;
  /** Receives the row's line id + the new BASELINE value. Identity-stable in
   *  the parent so memo on this component skips re-renders for siblings that
   *  didn't move. */
  onDrag?: (lineId: number, baselineValue: number) => void;
  /** Fires once this row's own commit has landed — see CategoryRow. */
  onSettle?: (lineId: number, baselineValue: number) => void;
  showActualOverlay?: boolean;
  highlighted?: boolean;
}) {
  const { t, locale } = useT();

  const rowMax = widthAnchor;
  const fillPct = rowMax > 0 ? Math.max(0, Math.min(100, (liveDisplay / rowMax) * 100)) : 0;
  const step = moneySliderStep(rowMax);
  const Icon = resolveCustomIcon(line.icon);
  // Same rule as a category row, one line at a time. A supplier whose category
  // has no budget bucket of its own (a planner's fee, a celebrant, equipment
  // hire — see SUPPLIER_TO_BUDGET) mirrors into `other` under the business's
  // own name, which is exactly the shape this component treats as a custom
  // row. Its slider and its delete both 409 server-side, so neither is offered.
  const supplierManaged = isSupplierManagedLine(line);
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

  const actualOverlayStyle: CSSProperties = {
    width: "100%",
    background: actualOverlayBackground(line.actual_huf, line.paid_huf, rowMax),
  };

  // Slider input is in display units; convert back to baseline before
  // pushing into the parent's drag map / persisting. Mirrors CategoryRow.
  function toBaseline(scaledNew: number): number {
    return scaleFactor > 0 ? Math.round(scaledNew / scaleFactor) : scaledNew;
  }

  // Same debounced-commit wiring as CategoryRow — see COMMIT_DELAY_MS.
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    },
    [],
  );

  async function commit(baselineNext: number) {
    pending.current = null;
    if (!onEditPlanned) return;
    // Same error contract as CategoryRow.commit — see the comment there.
    try {
      await onEditPlanned(line.id, baselineNext);
    } catch {
      /* handled upstream */
    } finally {
      onSettle?.(line.id, baselineNext);
    }
  }

  function scheduleCommit(baselineNext: number) {
    pending.current = baselineNext;
    if (commitTimer.current !== null) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      if (pending.current !== null) void commit(pending.current);
    }, COMMIT_DELAY_MS);
  }

  function flushCommit() {
    if (commitTimer.current !== null) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
    if (pending.current !== null) void commit(pending.current);
  }

  return (
    <li
      className={`${ROW_GRID} -mx-2 rounded-md px-2 py-1.5 transition-colors duration-500 ${highlighted ? "bg-sage-50 ring-1 ring-inset ring-sage-200 dark:bg-sage-400/10 dark:ring-sage-400/20" : ""}`}
    >
      <span
        className={`${ROW_LABEL_CELL} flex min-w-0 items-center gap-1.5 text-ink-700 dark:text-paper-100`}
      >
        {/* Delete used to be desktop-only, because on a phone it had to fight
         *  the icon for the same 2rem and the label was hidden anyway — so
         *  removing a custom row meant going to the budget table's mobile
         *  card. The wrapped row gives the label line the full width, so the
         *  glyph, the name and the delete all fit at every size now. */}
        {onRemove && !supplierManaged && (
          <button
            type="button"
            onClick={() => onRemove(line.id)}
            className="-ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-blush-50 hover:text-blush-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:text-umber-300 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
            aria-label={t("budget.custom_row_delete_aria", { label: line.label })}
          >
            <X size={12} aria-hidden />
          </button>
        )}
        <Icon size={14} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
        <span className="min-w-0 truncate">{line.label}</span>
      </span>
      <div className={`${ROW_TRACK_CELL} w-full`}>
        <input
          type="range"
          min={0}
          max={rowMax}
          step={step}
          value={liveDisplay}
          disabled={!onEditPlanned || supplierManaged}
          onChange={(e) => {
            // Same guard as CategoryRow — see the comment there.
            if (supplierManaged) return;
            const baselineNext = toBaseline(Number(e.target.value));
            onDrag?.(line.id, baselineNext);
            scheduleCommit(baselineNext);
          }}
          onPointerUp={flushCommit}
          onTouchEnd={flushCommit}
          onKeyUp={flushCommit}
          onBlur={flushCommit}
          className="range-fill range-fill-thin block"
          style={trackStyle}
          aria-label={t("budget.custom_row_edit_aria", { label: line.label })}
        />
        {showActualOverlay && line.actual_huf > 0 && (
          <div
            data-actual-overlay="true"
            className="range-fill range-fill-thin mt-1 block"
            style={actualOverlayStyle}
            aria-hidden="true"
          />
        )}
        {supplierManaged && (
          <span
            data-testid={`supplier-managed-line-${line.id}`}
            className="mt-1 block text-[10px] text-ink-400 dark:text-umber-300"
          >
            {t("budget.supplier_managed_hint")}
          </span>
        )}
      </div>
      <span
        className={`${ROW_AMOUNT_CELL} stat-num block text-right text-xs text-ink-700 dark:text-paper-100`}
      >
        <span
          className="flex flex-col items-end leading-tight"
          title={
            line.actual_huf > 0
              ? t("budget.amount_pair_title", {
                  actual: formatMoney(line.actual_huf, currency, locale),
                  planned: formatMoney(liveDisplay, currency, locale),
                })
              : undefined
          }
        >
          <span className="whitespace-nowrap">
            {line.actual_huf > 0 && (
              <span className="text-ink-400 dark:text-umber-300">
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
      {/* A custom row has no freeze concept — the column is held open so its
       *  slider still lines up with the category rows above it. */}
      <span className={ROW_LOCK_CELL} aria-hidden />
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
  showPerGuestToggle = true,
}: {
  onAdd: (
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) => void | Promise<void>;
  /** Hidden inside a category's own sub-item drawer — that category's
   *  per-guest scaling already comes from `PER_GUEST_CATEGORIES`, so a
   *  per-line toggle there would be a control that visibly does nothing.
   *  Stays on for the bottom-of-list "other"/Egyéb affordance, where it's
   *  the only thing that decides whether a custom row scales at all. */
  showPerGuestToggle?: boolean;
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
          /* `h-9` on every viewport — the prior `h-11` mobile size made
           *  the placeholder + input chrome read as a desktop hero form
           *  inside a tiny phone card. Keeping `text-base` (16px) is the
           *  iOS auto-zoom guardrail; only the height shrinks. */
          className="input h-9 min-h-0 flex-1 py-1 text-base sm:flex-none sm:basis-44 sm:text-sm"
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
          className="input h-9 min-h-0 flex-1 py-1 text-right text-base tabular-nums sm:flex-none sm:basis-32 sm:text-sm"
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
        {showPerGuestToggle && (
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
        )}
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
      {value !== null ? formatMoney(value, currency, locale) : (placeholder ?? "-")}
    </button>
  );
}
