// Dashboard spending visuals: a paid-vs-planned progress donut and a
// category-distribution donut, both hand-rolled SVG (the project ships no
// chart library — see CLAUDE.md "What NOT to do"). Everything is computed from
// the budget `lines` already loaded on the dashboard, so there's no extra
// fetch. Colours come from tailwind tokens via `stroke-*` / `bg-*` utilities,
// never raw hex.

import { RotateCcw } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { BudgetCategory, BudgetLine, Currency } from "@shared/types";
import { formatHufCompact, formatMoney } from "../lib/format";
import { CATEGORY_ICONS } from "./CostPlanningCard";

/** Where every clickable figure on these cards drills into. The budget table
 *  reads `#cat-<slug>` to scroll to a category; a bare `/app/budget` lands at
 *  the top, which is the right default for the roll-up totals. */
const BUDGET_LINK = "/app/budget";

type Locale = "hu" | "en";
type T = (key: string, params?: Record<string, string | number>) => string;

/** One slice of a donut. `colorClass` is an SVG `stroke-*` utility; `key` is a
 *  stable React key (segments are otherwise a positional list). */
interface Segment {
  key: string;
  value: number;
  colorClass: string;
}

/** Generic SVG donut. Draws a muted track, then one arc per segment laid out
 *  clockwise from 12 o'clock. `total` overrides the denominator (for a
 *  progress ring where the remainder shouldn't be drawn); otherwise it's the
 *  sum of segment values. `children` render centred over the hole. */
function Donut({
  segments,
  total,
  size = 132,
  thickness = 14,
  rounded = false,
  overflow,
  children,
}: {
  segments: Segment[];
  total?: number;
  size?: number;
  thickness?: number;
  rounded?: boolean;
  /** Amount that ran past `total`. When set (>0) the base ring fills fully and
   *  this value is drawn as a fresh lap on top, in `colorClass` — an Uber-style
   *  "second loop" that signals you've gone over without distorting the arc. */
  overflow?: { value: number; colorClass: string };
  children?: ReactNode;
}) {
  const r = (100 - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const denom = total ?? segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  // The base ring never draws past a full lap; the overage rides on top instead.
  const cap = total ?? Number.POSITIVE_INFINITY;
  let offset = 0;
  const overLen =
    overflow && denom > 0
      ? Math.min((Math.max(0, overflow.value) / denom) * circumference, circumference)
      : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="-rotate-90" aria-hidden role="presentation">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={thickness}
          className="stroke-paper-200 dark:stroke-umber-700"
        />
        {denom > 0 &&
          segments.map((seg) => {
            const drawable = Math.max(0, Math.min(seg.value, cap - offset));
            const len = (drawable / denom) * circumference;
            const el = (
              <circle
                key={seg.key}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                strokeWidth={thickness}
                strokeLinecap={rounded ? "round" : "butt"}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={-offset}
                className={seg.colorClass}
              />
            );
            offset += len;
            return el;
          })}
        {overLen > 0 ? (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${overLen} ${circumference - overLen}`}
            strokeDashoffset={0}
            className={overflow?.colorClass}
          />
        ) : null}
      </svg>
      {children ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Stable display order so the breakdown reads the same way every render. */
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

/** Warm "low-cortisol" categorical palette for the breakdown slices (see the
 *  `chart` tokens in tailwind.config). Each entry pairs the SVG `stroke-*` with
 *  the matching legend `bg-*` swatch. Ordered so no two browns sit adjacent on
 *  the ring; the 7th colour catches the grouped "Other" bucket. */
const SLICE_PALETTE: Array<{ stroke: string; dot: string }> = [
  { stroke: "stroke-chart-terracotta", dot: "bg-chart-terracotta" },
  { stroke: "stroke-chart-sage", dot: "bg-chart-sage" },
  { stroke: "stroke-chart-taupe", dot: "bg-chart-taupe" },
  { stroke: "stroke-chart-rose", dot: "bg-chart-rose" },
  { stroke: "stroke-chart-olive", dot: "bg-chart-olive" },
  { stroke: "stroke-chart-ochre", dot: "bg-chart-ochre" },
  { stroke: "stroke-chart-sand", dot: "bg-chart-sand" },
];

const MAX_SLICES = 6; // top N categories; the rest collapse into "Other".

/** Integer percentages that sum to exactly 100 (largest-remainder method).
 *  Rounding each share independently with `Math.round` lets the legend add up
 *  to 99 or 101 — e.g. 25+23+15+10+7+5+16 = 101 — which reads as a bug. We
 *  floor every share, then hand the leftover points to the largest fractional
 *  remainders so the visible numbers always total 100. */
function percentagesTo100(amounts: number[], total: number): number[] {
  if (total <= 0) return amounts.map(() => 0);
  const exact = amounts.map((a) => (Math.max(0, a) / total) * 100);
  const floors = exact.map((x) => Math.floor(x));
  let leftover = 100 - floors.reduce((s, x) => s + x, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; leftover > 0 && k < byRemainder.length; k++, leftover--) {
    const entry = byRemainder[k];
    if (entry) out[entry.i] = (out[entry.i] ?? 0) + 1;
  }
  return out;
}

interface Slice {
  key: string;
  label: string;
  amount: number;
  stroke: string;
  dot: string;
}

/** Roll the budget lines up into at most MAX_SLICES + 1 ("Other") slices,
 *  largest first, dropping zero-cost categories. */
function buildDistribution(lines: BudgetLine[], t: T): { slices: Slice[]; total: number } {
  const byCategory = new Map<BudgetCategory, number>();
  for (const l of lines) {
    if (l.planned_huf <= 0) continue;
    byCategory.set(l.category, (byCategory.get(l.category) ?? 0) + l.planned_huf);
  }
  const ranked = CATEGORY_ORDER.filter((c) => (byCategory.get(c) ?? 0) > 0)
    .map((c) => ({ category: c, amount: byCategory.get(c) ?? 0 }))
    .sort((a, b) => b.amount - a.amount);
  const total = ranked.reduce((s, r) => s + r.amount, 0);

  const head = ranked.slice(0, MAX_SLICES);
  const tail = ranked.slice(MAX_SLICES);
  const slices: Slice[] = head.map((r, i) => ({
    key: r.category,
    label: t(`budget.cat.${r.category}`),
    amount: r.amount,
    stroke: SLICE_PALETTE[i]?.stroke ?? "stroke-ink-400",
    dot: SLICE_PALETTE[i]?.dot ?? "bg-ink-400",
  }));
  if (tail.length > 0) {
    const otherAmount = tail.reduce((s, r) => s + r.amount, 0);
    const last = SLICE_PALETTE[MAX_SLICES];
    slices.push({
      key: "__other",
      label: t("dashboard.charts.other"),
      amount: otherAmount,
      stroke: last?.stroke ?? "stroke-ink-300",
      dot: last?.dot ?? "bg-ink-300",
    });
  }
  return { slices, total };
}

/** Legend label that gracefully degrades when the row is too narrow for the
 *  category name. The full label is always rendered (and measured) so the
 *  `scrollWidth > clientWidth` check stays stable; when it overflows we fade
 *  the text out (`opacity-0` keeps the box, so the measurement never toggles)
 *  and surface the category icon with an immediate hover tooltip instead. */
function LegendLabel({
  label,
  Icon,
}: {
  label: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <span className="group relative min-w-0 flex-1">
      <span
        ref={ref}
        className={`block truncate text-ink-700 dark:text-paper-100 ${overflow ? "opacity-0" : ""}`}
      >
        {label}
      </span>
      {overflow ? (
        <span className="absolute inset-y-0 left-0 flex items-center">
          <Icon size={14} className="text-ink-500 dark:text-umber-300" aria-hidden />
          <span className="sr-only">{label}</span>
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md border border-paper-200 bg-paper-50 px-2 py-1 text-[11px] font-medium text-ink-700 shadow-pop group-hover:block dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100"
          >
            {label}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/** Tones map to a `text-*` class so the same row reads as neutral, paid (green),
 *  or over-budget (amber). */
const STAT_TONES = {
  neutral: "text-ink-800 dark:text-paper-100",
  paid: "text-sage-700 dark:text-sage-300",
  over: "text-amber-700 dark:text-amber-300",
} as const;

/** A label + figure row where the figure is a link into the budget table.
 *  `to` defaults to the budget root; pass a `#cat-` anchor to deep-link. The
 *  link keeps the figure's tone and only reveals an underline on hover/focus so
 *  the cards stay calm until you reach for a number. */
function StatRow({
  label,
  value,
  tone = "neutral",
  to = BUDGET_LINK,
}: {
  label: string;
  value: string;
  tone?: keyof typeof STAT_TONES;
  to?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-ink-500 dark:text-umber-300">{label}</span>
      <Link
        to={to}
        className={`rounded-sm text-sm font-semibold tabular-nums underline-offset-2 transition-colors hover:underline focus-visible:underline focus-visible:outline-none ${STAT_TONES[tone]}`}
      >
        {value}
      </Link>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-umber-800 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-800/50">
      <h3 className="mb-4 font-grotesk text-sm font-medium tracking-tight text-ink-700 dark:text-paper-100">
        {title}
      </h3>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </section>
  );
}

/** The card-header title + the round flip toggle, shared by both faces of a
 *  FlipCard so the corner control sits in the same place front and back. */
function CardHeader({
  title,
  flipped,
  onFlip,
  flipLabel,
}: {
  title: string;
  flipped: boolean;
  onFlip: () => void;
  flipLabel: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <h3 className="font-grotesk text-sm font-medium tracking-tight text-ink-700 dark:text-paper-100">
        {title}
      </h3>
      <button
        type="button"
        onClick={onFlip}
        aria-pressed={flipped}
        aria-label={flipLabel}
        title={flipLabel}
        className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-paper-200 text-ink-400 transition-colors hover:border-paper-300 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400 dark:border-umber-700 dark:text-umber-300 dark:hover:text-paper-100"
      >
        <RotateCcw size={14} aria-hidden />
      </button>
    </div>
  );
}

/** A two-faced card whose corner toggle swaps `front` for `back` in place — no
 *  3-D flip animation, just a content switch (per design: the spin was noise).
 *  The shell is a full-height flex column so, when the grid stretches both cards
 *  to equal height, the active face stays vertically centred instead of clumping
 *  at the top. */
function FlipCard({
  frontTitle,
  backTitle,
  toFrontLabel,
  toBackLabel,
  front,
  back,
}: {
  frontTitle: string;
  backTitle: string;
  toFrontLabel: string;
  toBackLabel: string;
  front: ReactNode;
  back: ReactNode;
}) {
  const [flipped, setFlipped] = useState(false);
  return (
    <section className="flex h-full flex-col rounded-2xl border border-umber-800 bg-paper-50 p-5 dark:border-umber-600 dark:bg-umber-800/50">
      <CardHeader
        title={flipped ? backTitle : frontTitle}
        flipped={flipped}
        onFlip={() => setFlipped((v) => !v)}
        flipLabel={flipped ? toFrontLabel : toBackLabel}
      />
      <div className="flex flex-1 flex-col justify-center">{flipped ? back : front}</div>
    </section>
  );
}

/** Back face of the paid card: a handful of roll-ups the front ring can't show
 *  — how the spend is settling line by line, and where it ran over. Every
 *  figure links into the budget table (deep-linking to the relevant category
 *  where there's an obvious one). */
function PaidDetails({
  lines,
  paid,
  planned,
  overBudget,
  currency,
  locale,
  t,
}: {
  lines: BudgetLine[];
  paid: number;
  planned: number;
  overBudget: number;
  currency: Currency;
  locale: Locale;
  t: T;
}) {
  const active = lines.filter((l) => l.planned_huf > 0);
  const settled = active.filter((l) => l.actual_huf >= l.planned_huf).length;
  const overLines = active.filter((l) => l.actual_huf > l.planned_huf);
  const avgPerLine = active.length > 0 ? Math.round(paid / active.length) : 0;
  // Biggest line by actual spend — the single entry moving the needle most.
  const largest = active.reduce<BudgetLine | null>(
    (top, l) => (top === null || l.actual_huf > top.actual_huf ? l : top),
    null,
  );

  return (
    <div className="space-y-2.5">
      <StatRow label={t("dashboard.charts.lines_count")} value={String(active.length)} />
      <StatRow
        label={t("dashboard.charts.settled_count")}
        value={`${settled} / ${active.length}`}
        tone="paid"
      />
      <StatRow
        label={t("dashboard.charts.over_lines")}
        value={String(overLines.length)}
        tone={overLines.length > 0 ? "over" : "neutral"}
      />
      <StatRow
        label={t("dashboard.charts.avg_per_line")}
        value={formatMoney(avgPerLine, currency, locale)}
      />
      {largest ? (
        <StatRow
          label={t("dashboard.charts.largest_line", { name: largest.label })}
          value={formatMoney(largest.actual_huf, currency, locale)}
          to={`${BUDGET_LINK}#cat-${largest.category}`}
        />
      ) : null}
      {overBudget > 0 ? (
        <p className="pt-1 text-[11px] leading-snug text-ink-500 dark:text-umber-300">
          {t("dashboard.charts.over_hint", {
            amount: formatMoney(overBudget, currency, locale),
            pct: planned > 0 ? Math.round((overBudget / planned) * 100) : 0,
          })}
        </p>
      ) : null}
    </div>
  );
}

export function SpendingCharts({
  lines,
  currency,
  locale,
  t,
}: {
  lines: BudgetLine[];
  currency: Currency;
  locale: Locale;
  t: T;
}) {
  const planned = lines.reduce((s, l) => s + l.planned_huf, 0);
  const paid = lines.reduce((s, l) => s + l.actual_huf, 0);
  const remaining = Math.max(0, planned - paid);
  const overBudget = Math.max(0, paid - planned);
  const isOver = planned > 0 && paid > planned;
  const paidPct = planned > 0 ? Math.round((paid / planned) * 100) : 0;

  const { slices, total } = buildDistribution(lines, t);

  return (
    <section className="mb-8">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Paid-vs-planned progress ring — flips to a details face. */}
        <FlipCard
          frontTitle={t("dashboard.charts.paid_title")}
          backTitle={t("dashboard.charts.details_title")}
          toBackLabel={t("dashboard.charts.flip_to_details")}
          toFrontLabel={t("dashboard.charts.flip_to_chart")}
          front={
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
              <Link
                to={BUDGET_LINK}
                aria-label={t("dashboard.charts.paid_title")}
                className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-400"
              >
                <Donut
                  segments={[
                    {
                      key: "paid",
                      value: paid,
                      colorClass: "stroke-sage-500 dark:stroke-sage-400",
                    },
                  ]}
                  total={planned > 0 ? planned : 1}
                  rounded
                  overflow={
                    isOver
                      ? { value: overBudget, colorClass: "stroke-amber-500 dark:stroke-amber-400" }
                      : undefined
                  }
                >
                  <span className="text-2xl font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                    {paidPct}%
                  </span>
                  <span className="text-[11px] text-ink-500 dark:text-umber-300">
                    {t("dashboard.charts.paid_center")}
                  </span>
                </Donut>
              </Link>
              <div className="w-full min-w-0 space-y-2 sm:flex-1">
                <StatRow
                  label={t("dashboard.charts.paid_label")}
                  value={formatMoney(paid, currency, locale)}
                  tone="paid"
                />
                <StatRow
                  label={t("dashboard.charts.planned_label")}
                  value={formatMoney(planned, currency, locale)}
                />
                {isOver ? (
                  <StatRow
                    label={t("dashboard.charts.over_label")}
                    value={`+${formatMoney(overBudget, currency, locale)}`}
                    tone="over"
                  />
                ) : (
                  <StatRow
                    label={t("dashboard.charts.remaining_label")}
                    value={formatMoney(remaining, currency, locale)}
                  />
                )}
              </div>
            </div>
          }
          back={
            <PaidDetails
              lines={lines}
              paid={paid}
              planned={planned}
              overBudget={overBudget}
              currency={currency}
              locale={locale}
              t={t}
            />
          }
        />

        {/* Category distribution. */}
        <Card title={t("dashboard.charts.distribution_title")}>
          {total <= 0 ? (
            <p className="py-6 text-center text-sm text-ink-500 dark:text-umber-300">
              {t("dashboard.charts.distribution_empty")}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
              <Donut
                segments={slices.map((s) => ({
                  key: s.key,
                  value: s.amount,
                  colorClass: s.stroke,
                }))}
              >
                <span className="text-base font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                  {formatHufCompact(total, locale)}
                </span>
                <span className="text-[11px] text-ink-500 dark:text-umber-300">
                  {t("dashboard.charts.planned_label")}
                </span>
              </Donut>
              <ul className="w-full min-w-0 space-y-1.5 sm:flex-1">
                {(() => {
                  const pcts = percentagesTo100(
                    slices.map((s) => s.amount),
                    total,
                  );
                  return slices.map((s, i) => {
                    const pct = pcts[i] ?? 0;
                    const Icon = CATEGORY_ICONS[s.key as BudgetCategory] ?? CATEGORY_ICONS.other;
                    return (
                      <li key={s.key} className="flex items-center gap-2 text-xs">
                        <span
                          aria-hidden
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.dot}`}
                        />
                        <LegendLabel label={s.label} Icon={Icon} />
                        <span className="shrink-0 tabular-nums text-ink-500 dark:text-umber-300">
                          {pct}%
                        </span>
                        <span className="w-20 shrink-0 text-right tabular-nums font-medium text-ink-800 dark:text-paper-100">
                          {formatHufCompact(s.amount, locale)}
                        </span>
                      </li>
                    );
                  });
                })()}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}
