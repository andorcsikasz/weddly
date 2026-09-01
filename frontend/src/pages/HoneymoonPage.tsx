// Honeymoon planner — a full-bleed photo of where the couple is going, a
// three-segment trip bar overlapping its bottom edge, then a slider-driven
// cost grid. Destination + dates live on `couples`; the destination field is
// autocompleted against /api/places/search (Nominatim proxy). Cost cards
// mirror `budget_lines` rows in the `honeymoon` category, so a slider drag
// here shows up on /app/budget and vice versa.

import type {
  BudgetLine,
  Couple,
  Currency,
  FlightEstimate,
  FlightOffer,
  PlaceSuggestion,
  PlanningItem,
} from "@shared/types";
import {
  BadgeCheck,
  BedDouble,
  Briefcase,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CheckCircle2,
  Clock,
  Compass,
  ExternalLink,
  Loader2,
  Map as MapIcon,
  ArrowRightLeft,
  AlertTriangle,
  MapPin,
  Plane,
  Plus,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Trash2,
  Umbrella,
  UtensilsCrossed,
  Wallet,
  Wand2,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { InfoHint } from "../components/InfoHint";
import { Dialog, useConfirm, useToast } from "../components/ui";
import {
  HONEYMOON_EXTRA_TASKS,
  HONEYMOON_FLIGHTS_TASK,
  TASK_TEMPLATE_GROUPS,
  localizeText,
  packDueDate,
} from "../lib/planning_templates";
import {
  type KonzinfoInfo,
  KONZINFO_APP_INFO_URL,
  KONZINFO_INDEX_URL,
  KONZINFO_REGISTER_URL,
} from "@shared/konzinfo";
import { ApiError } from "../lib/api";
import { lazyWithReload } from "../lib/lazy_reload";
import { type AirportOrigin, searchAirportOrigins } from "../lib/airport_origins";
import { budgetApi, coupleApi, honeymoonApi, placesApi, planningApi } from "../lib/endpoints";
import { formatMoney, intlLocale, maxIsoDate, todayIso } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { publish, subscribe } from "../lib/sync";

// Lazy — Leaflet (~150KB) only ships when the user opens the map popup.
const HoneymoonMapModal = lazyWithReload(() => import("../components/HoneymoonMapModal"));

/* ─── Honey-jar easter egg ─────────────────────────────────────────────
 * Lucide ships no honey-pot icon, so here's a small inline SVG drawn to
 * match Lucide's stroke style (24×24, stroke-width 2, round caps/joins).
 * Used as the "other" preset on the honeymoon page — thematic flourish. */
function HoneyJar({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 7V3" />
      <path d="M11 3h2" />
      <path d="M5 7h14" />
      <path d="M6 7c0 8 1 14 6 14s6-6 6-14" />
      <path d="M9 13c1 0 2 1 3 1s2-1 3-1" />
    </svg>
  );
}

/* ─── Sub-category presets ─────────────────────────────────────────────
 * Fixed list of friendly sub-categories surfaced as one-tap "add cost"
 * chips. Each maps to a localised label key (so HU + EN stay in sync) and
 * a Lucide icon. The match() predicate picks the right icon for an
 * existing budget line by sniffing its label — covers HU + EN keywords
 * so the icon stays sensible after the user renames a line in /app/budget. */

type Preset = {
  id: "travel" | "stay" | "food" | "activities" | "insurance" | "other";
  icon: ComponentType<{ size?: number; className?: string }>;
  /** Substrings (lowercased) that mark a budget line as this preset. */
  match: string[];
};

const PRESETS: readonly Preset[] = [
  {
    id: "travel",
    icon: Plane,
    match: ["utaz", "repjegy", "repülő", "vonatjegy", "bus", "transfer", "flight", "travel"],
  },
  {
    id: "stay",
    icon: BedDouble,
    match: ["szállás", "szálloda", "szallas", "szalloda", "hotel", "airbnb", "accommod", "stay"],
  },
  {
    id: "food",
    icon: UtensilsCrossed,
    match: ["étkez", "etkez", "vacsora", "ebéd", "food", "dining", "restaur"],
  },
  {
    id: "activities",
    icon: Compass,
    match: ["program", "kirándul", "kirandul", "túra", "tura", "activit", "excurs", "tour"],
  },
  {
    id: "insurance",
    icon: ShieldCheck,
    match: ["biztos", "insurance"],
  },
  {
    id: "other",
    icon: HoneyJar,
    match: [],
  },
];

/** The "Egyéb / Other" catch-all can be added up to this many times (every
 *  other preset stays single-use). Each extra row gets a numbered default
 *  label until the couple renames it. */
const MAX_OTHER_LINES = 5;

function presetFor(label: string): Preset {
  const lc = label.toLowerCase();
  for (const p of PRESETS) {
    if (p.match.some((m) => lc.includes(m))) return p;
  }
  return PRESETS[PRESETS.length - 1] ?? PRESETS[0]!;
}

/* ─── Date helpers ─────────────────────────────────────────────────────── */

/** Inclusive day count between two ISO dates. `2026-05-15 → 2026-05-22` = 8 days. */
function nightsBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const diffMs = e - s;
  if (diffMs < 0) return null;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/** Whole-day countdown to the honeymoon start, measured in local time.
 *  Returns positive when the trip is in the future, 0 the day it starts,
 *  negative once it's begun. Null when no start date is set or unparseable. */
function daysToStart(start: string | null): number | null {
  if (!start) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startDate = new Date(`${start}T00:00:00`);
  if (Number.isNaN(startDate.getTime())) return null;
  startDate.setHours(0, 0, 0, 0);
  return Math.round((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateShort(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

/** Day + month only. The trip bar has about 110px per segment on a phone, and
 *  the year is already implied by the countdown sitting on the photo above. */
function formatDayMonth(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", day: "numeric" }).format(d);
}

type Countdown =
  | { kind: "future"; days: number }
  | { kind: "today" }
  | { kind: "ongoing" }
  | { kind: "past"; days: number };

/** Where the couple is on the trip: counting down, leaving today, away, or
 *  back. Null until a start date exists. */
function tripCountdown(start: string | null, end: string | null): Countdown | null {
  const toStart = daysToStart(start);
  if (toStart === null) return null;
  if (toStart > 0) return { kind: "future", days: toStart };
  if (toStart === 0) return { kind: "today" };
  const toEnd = daysToStart(end);
  if (toEnd !== null && toEnd >= 0) return { kind: "ongoing" };
  return { kind: "past", days: Math.abs(toStart) };
}

/* ─── Slider helpers ───────────────────────────────────────────────────── */

/** Mirror of CostPlanningCard's range-fill trick — paint the filled portion
 *  of a native range input ourselves so the look stays consistent across
 *  Chromium / Firefox / WebKit. Colors come from the shared CSS vars
 *  (`--range-fill-amount` / `--range-fill-remainder`) so the fill inverts
 *  under `html.dark` (filled = bright paper, remainder = dark umber).
 *  `thumbPx` anchors the gradient stop to the thumb centre — see the twin in
 *  CostPlanningCard for why a raw `${pct}%` stop visibly misaligns. */
function rangeFillStyle(
  value: number,
  min: number,
  max: number,
  thumbPx = 14,
): { background: string } {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  const offsetPx = thumbPx * (0.5 - pct / 100);
  const stop = `calc(${pct}% + ${offsetPx.toFixed(3)}px)`;
  return {
    background: `linear-gradient(to right, var(--range-fill-amount) 0%, var(--range-fill-amount) ${stop}, var(--range-fill-remainder) ${stop}, var(--range-fill-remainder) 100%)`,
  };
}

/** Shared slider ceiling for every honeymoon cost card. Soft-cap formula:
 *    max( 500k floor,  30 % of overall budget,  biggest line × 1.2 )
 *
 *  The 30 % baseline scales with the couple's wedding cap so a small
 *  wedding has tighter rails; the `biggestLine × 1.2` term keeps the rail
 *  ahead of the largest line so a couple budgeting > 1.8 M HUF on a
 *  honeymoon doesn't hit a hard wall mid-drag. (Originally `biggestLine`
 *  was passed in as `totalPlanned` — same value, more honest name.) */
function honeymoonSliderMax(couple: Couple | null, biggestLine: number): number {
  const capBased =
    couple?.budget_goal.kind === "exact" && couple.budget_goal.exact_huf
      ? Math.round(couple.budget_goal.exact_huf * 0.3)
      : couple?.budget_goal.kind === "range" && couple.budget_goal.max_huf
        ? Math.round(couple.budget_goal.max_huf * 0.3)
        : biggestLine * 2;
  return Math.max(500_000, capBased, Math.round(biggestLine * 1.2));
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function HoneymoonPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Per-line draft amounts published from each CostRow while its slider is
  // being dragged. Lets the planned-total tile read the in-flight value
  // before mouseup commits the PATCH, so the figure tracks the drag instead
  // of jumping only on release. Keyed by line id; cleared when the row
  // settles (save lands or drag returns to the saved value).
  const [drafts, setDrafts] = useState<Record<number, number>>({});
  // Amadeus flight estimate for the current destination + dates. NOT loaded
  // automatically. The upstream search is kicked off only when the couple
  // presses the "Get flight prices" button (see loadFlightEstimate). Changing
  // the destination or dates clears it so the button reappears for a fresh
  // search. `null` before the first search, on miss, or when the upstream
  // isn't configured. Server-side cache (12 h) keeps repeat calls cheap.
  const [flightEstimate, setFlightEstimate] = useState<FlightEstimate | null>(null);
  // Whether a flight search is in flight (button → spinner).
  const [flightLoading, setFlightLoading] = useState(false);
  // Whether the user has run a search for the current destination/dates. Lets
  // us tell "not searched yet" (show the button) apart from "searched, no live
  // offer came back" (show the empty hint + a retry).
  const [flightSearched, setFlightSearched] = useState(false);
  // Whether the flight estimate section is visible. Off by default — the plane
  // icon on the WHERE tile toggles it. Auto-fetches on first open.
  const [flightSectionOpen, setFlightSectionOpen] = useState(false);
  // Honeymoon-topic todos pulled from /api/planning. The planning page is
  // the source of truth; we mirror the rows here so couples can tick items
  // off without leaving /app/honeymoon. Tasks with topic === null are
  // treated as wedding-scoped and filtered out.
  const [honeymoonTasks, setHoneymoonTasks] = useState<PlanningItem[]>([]);

  async function refresh() {
    const [c, l, p] = await Promise.all([
      coupleApi.current(),
      budgetApi.listLines(),
      planningApi.list().catch(() => ({ items: [] as PlanningItem[] })),
    ]);
    setCouple(c.couple);
    setLines(l.lines);
    setHoneymoonTasks(p.items.filter((i) => i.kind === "task" && i.topic === "honeymoon"));
    setLoaded(true);
  }

  async function toggleTaskDone(item: PlanningItem) {
    const nextDone = !item.done;
    // Optimistic flip — the planning page does the same, and refresh()
    // brings the canonical state back on the next paint.
    setHoneymoonTasks((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: nextDone } : i)));
    try {
      await planningApi.update(item.id, { done: nextDone });
    } catch (e) {
      setHoneymoonTasks((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)),
      );
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  /** `dueDate` is optional because the two callers differ: the wand knows each
   *  pack item's lead time and dates the row on the spot, while the free-text
   *  add box has nothing to date it from and leaves that to the couple or to
   *  the timeline's schedule wizard. */
  async function addHoneymoonTask(title: string, dueDate?: string | null): Promise<boolean> {
    try {
      const r = await planningApi.create({
        kind: "task",
        topic: "honeymoon",
        title,
        ...(dueDate ? { due_date: dueDate } : {}),
      });
      setHoneymoonTasks((prev) => [...prev, r.item]);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      return false;
    }
  }

  async function deleteHoneymoonTask(item: PlanningItem) {
    // Optimistic removal; restore the row in place on failure.
    setHoneymoonTasks((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await planningApi.remove(item.id);
    } catch (e) {
      setHoneymoonTasks((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    return subscribe("budget:changed", () => {
      refresh();
    });
  }, []);

  // Clear any prior estimate whenever the destination or dates change so a
  // stale result for the old trip never lingers. Also collapse the section so
  // the new trip always starts fresh. We deliberately do NOT auto-fetch here.
  useEffect(() => {
    setFlightEstimate(null);
    setFlightSearched(false);
    setFlightSectionOpen(false);
  }, [couple?.honeymoon_destination, couple?.honeymoon_start_date, couple?.honeymoon_end_date]);

  // Kick off the flight-price search for the current destination + dates.
  // Wired to the button (and re-run after an origin change inside the card).
  async function loadFlightEstimate() {
    if (
      !couple?.honeymoon_destination ||
      !couple?.honeymoon_start_date ||
      !couple?.honeymoon_end_date
    ) {
      return;
    }
    setFlightLoading(true);
    try {
      const r = await honeymoonApi.flightEstimate();
      setFlightEstimate(r.estimate);
    } catch {
      setFlightEstimate(null);
    } finally {
      setFlightSearched(true);
      setFlightLoading(false);
    }
  }

  const honeymoonLines = useMemo(() => lines.filter((l) => l.category === "honeymoon"), [lines]);
  // Each preset chip is single-use. We resolve every existing line back to
  // its preset via the same label-keyword matcher used by the cost rows, so
  // a renamed line still counts toward "already added" (e.g. user renamed
  // "Utazás" → "Repjegy" — the Travel chip should still gray out).
  const usedPresetIds = useMemo(() => {
    const used = new Set<Preset["id"]>();
    for (const l of honeymoonLines) used.add(presetFor(l.label).id);
    return used;
  }, [honeymoonLines]);
  // "Egyéb / Other" is the exception to single-use: it can hold up to
  // MAX_OTHER_LINES rows, so we count them to gate the chip + the default name.
  const otherCount = useMemo(
    () => honeymoonLines.filter((l) => presetFor(l.label).id === "other").length,
    [honeymoonLines],
  );
  const totals = useMemo(() => {
    let planned = 0;
    let actual = 0;
    let biggest = 0;
    for (const l of honeymoonLines) {
      // Prefer the in-flight draft from a row that's currently being
      // dragged so the planned-total tile updates live with the slider.
      const p = drafts[l.id] ?? l.planned_huf;
      planned += p;
      actual += l.actual_huf;
      if (p > biggest) biggest = p;
    }
    return { planned, actual, biggest };
  }, [honeymoonLines, drafts]);
  const currency: Currency = couple?.currency ?? "HUF";
  const nights = nightsBetween(
    couple?.honeymoon_start_date ?? null,
    couple?.honeymoon_end_date ?? null,
  );
  // Sliders share a max so the rails stay comparable. We feed `biggest`
  // (not `totalPlanned`) into the fallback so one outsize line doesn't
  // push the others into a tiny strip of the track.
  const sliderMax = honeymoonSliderMax(couple, totals.biggest);
  // Sanity check: a honeymoon that starts before the wedding date is almost
  // certainly a typo — surface it as a soft warning rather than letting it
  // sit silently in the date tile. ISO YYYY-MM-DD compares lexicographically
  // correctly, so a plain string compare is enough.
  const honeymoonBeforeWedding = Boolean(
    couple?.wedding_date &&
      couple?.honeymoon_start_date &&
      couple.honeymoon_start_date < couple.wedding_date,
  );
  // Destination + both dates are needed before a flight search makes sense.
  const tripReady = Boolean(
    couple?.honeymoon_destination && couple?.honeymoon_start_date && couple?.honeymoon_end_date,
  );
  const countdown = useMemo(
    () => tripCountdown(couple?.honeymoon_start_date ?? null, couple?.honeymoon_end_date ?? null),
    [couple?.honeymoon_start_date, couple?.honeymoon_end_date],
  );
  // Cheapest live offer. It rides the trip bar's flight segment so the number
  // is on the page instead of behind a toggle nobody presses.
  const bestOffer = useMemo(() => {
    const offers = flightEstimate?.offers ?? [];
    if (offers.length === 0) return null;
    return offers.reduce((min, o) => (o.price < min.price ? o : min), offers[0]!);
  }, [flightEstimate]);

  /* ─── Trip-detail saves (destination + dates) ─────────────────────── */

  async function saveTrip(patch: {
    honeymoon_destination?: string | null;
    honeymoon_start_date?: string | null;
    honeymoon_end_date?: string | null;
    honeymoon_origin_iata?: string | null;
  }) {
    if (!couple) return;
    const prev = couple;
    setCouple({ ...couple, ...patch });
    try {
      const r = await coupleApi.update(patch);
      setCouple(r.couple);
    } catch (e) {
      setCouple(prev);
      toast.error(e instanceof ApiError ? e.message : t("budget.save_failed_retry"));
    }
  }

  /* ─── Cost-line saves ─────────────────────────────────────────────── */

  async function addPreset(preset: Preset) {
    // Belt-and-suspenders — the chip is disabled in the UI when used, but
    // guard the action too so a stale click can't double-add a category.
    // "Other" is the exception: addable up to MAX_OTHER_LINES times.
    if (preset.id === "other") {
      if (otherCount >= MAX_OTHER_LINES) return;
    } else if (usedPresetIds.has(preset.id)) {
      return;
    }
    const base = t(`honeymoon.preset.${preset.id}`);
    // Number the extra "Other" rows (Egyéb 2, Egyéb 3, …) so they're
    // distinguishable until the couple renames them.
    const label = preset.id === "other" && otherCount > 0 ? `${base} ${otherCount + 1}` : base;
    try {
      const r = await budgetApi.createLine({
        category: "honeymoon",
        label,
        planned_huf: 0,
        actual_huf: 0,
        preset_key: preset.id,
      });
      setLines((prev) => [...prev, r.line]);
      publish("budget:changed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("budget.save_failed_retry"));
    }
  }

  async function updateLinePlanned(line: BudgetLine, planned_huf: number) {
    const next = lines.map((l) => (l.id === line.id ? { ...l, planned_huf } : l));
    setLines(next);
    try {
      const r = await budgetApi.updateLine(
        line.id,
        { ...line, planned_huf },
        { ifMatch: line.updated_at },
      );
      // Adopt the server's fresh row (most importantly updated_at) so a
      // quick second slider release doesn't PATCH with the now-stale version
      // and trip the optimistic-concurrency guard with a phantom "someone
      // else edited this row" toast.
      setLines((prev) => prev.map((l) => (l.id === r.line.id ? r.line : l)));
      publish("budget:changed");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("budget.save_conflict"));
        refresh();
        return;
      }
      toast.error(t("budget.save_failed_retry"));
    }
  }

  async function renameLine(line: BudgetLine, rawLabel: string) {
    const label = rawLabel.trim();
    if (!label || label === line.label) return;
    const next = lines.map((l) => (l.id === line.id ? { ...l, label } : l));
    setLines(next);
    try {
      const r = await budgetApi.updateLine(
        line.id,
        { ...line, label },
        { ifMatch: line.updated_at },
      );
      setLines((prev) => prev.map((l) => (l.id === r.line.id ? r.line : l)));
      publish("budget:changed");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(t("budget.save_conflict"));
        refresh();
        return;
      }
      toast.error(e instanceof ApiError ? e.message : t("budget.save_failed_retry"));
      refresh();
    }
  }

  async function removeLine(line: BudgetLine) {
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setLines(lines.filter((l) => l.id !== line.id));
    try {
      await budgetApi.removeLine(line.id);
      publish("budget:changed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("budget.save_failed_retry"));
      refresh();
    }
  }

  /* ─── "We'll take this flight" → budget + todo ────────────────────────
   * Picking an offer writes its price into the honeymoon budget as a
   * "Travel" line (upserted — re-picking just refreshes the figure) and
   * drops a single "Buy the flight ticket" todo carrying the Google Flights
   * link in its body. A confirm step gates the writes (the deliberate
   * second click) and spells out the price-volatility caveat. */
  async function saveFlightSelection(offer: FlightOffer) {
    const price = Math.max(0, Math.round(offer.price));
    const priceLabel = formatOfferPrice(offer, locale);
    const dateLabel = formatDateShort(todayIso(), locale);

    const ok = await confirm({
      title: t("honeymoon.flight_save_confirm_title"),
      body: (
        <div className="space-y-2 text-sm">
          <p>{t("honeymoon.flight_save_confirm_body", { price: priceLabel })}</p>
          <p className="text-ink-500 dark:text-umber-300">
            {t("honeymoon.flight_price_disclaimer_dated", { date: dateLabel })}
          </p>
        </div>
      ),
      confirmLabel: t("honeymoon.flight_save_confirm_cta"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;

    try {
      // 1) Budget — upsert the Travel line so re-picking never duplicates it.
      const existingTravel = honeymoonLines.find((l) => presetFor(l.label).id === "travel");
      if (existingTravel) {
        await budgetApi.updateLine(
          existingTravel.id,
          { ...existingTravel, planned_huf: price },
          { ifMatch: existingTravel.updated_at },
        );
      } else {
        await budgetApi.createLine({
          category: "honeymoon",
          label: t("honeymoon.preset.travel"),
          planned_huf: price,
          actual_huf: 0,
          preset_key: "travel",
        });
      }
      publish("budget:changed");

      // 2) Todo — single canonical "buy the ticket" task; body carries the
      // dated price caveat + the Google Flights deeplink.
      const noteParts = [
        t("honeymoon.flight_save_todo_note", {
          carrier: offer.carrier || "-",
          price: priceLabel,
          date: dateLabel,
        }),
      ];
      if (offer.booking_url) noteParts.push(offer.booking_url);
      const body = noteParts.join("\n\n");
      // The SAME task the honeymoon pack offers, not a second title for the
      // same action, and matched against both authored titles rather than the
      // one the current locale happens to render. Both writers freeze the
      // localized string into planning_items.title, so a pack applied in
      // Hungarian was invisible to a flight saved in English and the couple got
      // the ticket task twice, once per language.
      const todoTitle = localizeText(HONEYMOON_FLIGHTS_TASK.title, locale);
      const existingTodo = honeymoonTasks.find(
        (i) =>
          i.title === HONEYMOON_FLIGHTS_TASK.title.hu ||
          i.title === HONEYMOON_FLIGHTS_TASK.title.en,
      );
      if (existingTodo) {
        await planningApi.update(existingTodo.id, { body, done: false });
      } else {
        await planningApi.create({ kind: "task", topic: "honeymoon", title: todoTitle, body });
      }

      await refresh();
      toast.success(t("honeymoon.flight_save_done"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      refresh();
    }
  }

  return (
    <>
      {/* The photo is the page header. No title row above it: the sidebar
          already says "Honeymoon" and a picture of where you are going says
          the rest. Bleeds edge to edge (and up under the shell's top padding)
          on a phone; sits inside the content column from sm up, where the
          sidebar shares the row. */}
      <section
        data-tour-target="honeymoon-tiles"
        className="-mx-4 -mt-6 mb-8 sm:mx-0 sm:mt-0 sm:mb-10"
      >
        <TripHero
          destination={couple?.honeymoon_destination ?? null}
          customCoverPath={couple?.honeymoon_cover_path ?? null}
          countdown={countdown}
          loaded={loaded}
          onSaveDestination={(v) => saveTrip({ honeymoon_destination: v })}
          onCoupleChange={setCouple}
          onCoverReset={() =>
            setCouple((prev) => (prev ? { ...prev, honeymoon_cover_path: null } : prev))
          }
        />
        <TripBar
          start={couple?.honeymoon_start_date ?? null}
          end={couple?.honeymoon_end_date ?? null}
          nights={nights}
          locale={locale}
          loaded={loaded}
          currency={currency}
          planned={totals.planned}
          actual={totals.actual}
          lineCount={honeymoonLines.length}
          tripReady={tripReady}
          flightOpen={flightSectionOpen}
          flightLoading={flightLoading}
          bestOffer={bestOffer}
          onFlightToggle={() => {
            setFlightSectionOpen((prev) => {
              const next = !prev;
              if (next && !flightSearched && !flightLoading) void loadFlightEstimate();
              return next;
            });
          }}
          onSaveDates={(start, end) =>
            saveTrip({ honeymoon_start_date: start, honeymoon_end_date: end })
          }
        />
      </section>

      {honeymoonBeforeWedding && couple?.wedding_date && couple?.honeymoon_start_date && (
        <section
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-2xl border-2 border-ink-900 bg-white px-4 py-3 dark:border-paper-100/40 dark:bg-umber-800"
        >
          <AlertTriangle
            size={18}
            className="mt-0.5 shrink-0 text-ink-900 dark:text-paper-100"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 text-sm sm:flex sm:items-baseline sm:gap-2">
            <p className="font-semibold text-ink-900 dark:text-paper-50 sm:shrink-0">
              {t("honeymoon.before_wedding_title")}
            </p>
            <p className="mt-0.5 text-ink-700 dark:text-paper-200 sm:mt-0">
              {t("honeymoon.before_wedding_body", {
                wedding: formatDateShort(couple.wedding_date, locale),
                honeymoon: formatDateShort(couple.honeymoon_start_date, locale),
              })}
            </p>
          </div>
        </section>
      )}

      {/* Flight estimate section — hidden until the plane segment of the trip
       *  bar is toggled on. Auto-fetches on first open; stays cached until
       *  destination or dates change. */}
      {tripReady &&
        flightSectionOpen &&
        (flightEstimate && flightEstimate.offers.length > 0 ? (
          <FlightEstimateCard
            estimate={flightEstimate}
            locale={locale}
            t={t}
            currentOrigin={couple?.honeymoon_origin_iata ?? null}
            onOriginSave={async (iata) => {
              await saveTrip({ honeymoon_origin_iata: iata });
              await loadFlightEstimate();
            }}
            onSaveFlight={saveFlightSelection}
          />
        ) : (
          <section className="card stationery-light mt-4 mx-4 !p-5 sm:mx-8">
            <div className="flex flex-wrap items-center gap-3">
              <Plane
                size={18}
                aria-hidden="true"
                className="shrink-0 text-ink-900 dark:text-paper-50"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
                  {t("honeymoon.flight_estimate_title")}
                </p>
                <p className="mt-0.5 text-sm text-ink-700 dark:text-paper-100">
                  {flightSearched
                    ? t("honeymoon.flight_estimate_empty")
                    : t("honeymoon.flight_estimate_prompt")}
                </p>
              </div>
              <button
                type="button"
                onClick={loadFlightEstimate}
                disabled={flightLoading}
                className="btn-primary btn-sm inline-flex items-center gap-1.5"
              >
                {flightLoading ? (
                  <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Plane size={15} aria-hidden="true" />
                )}
                {flightLoading
                  ? t("honeymoon.flight_estimate_searching")
                  : flightSearched
                    ? t("honeymoon.flight_estimate_retry")
                    : t("honeymoon.flight_estimate_search")}
              </button>
            </div>
          </section>
        ))}

      <section data-tour-target="honeymoon-costs" className="mt-12">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          {/* The empty state's own card already says "start with a category"
              and the chips name the categories, so the subtitle that used to
              sit here was the third explanation of one thing. It moves behind
              the info hint, same pattern as the page title. */}
          <div className="flex items-center gap-2">
            <h2 className="font-grotesk">{t("honeymoon.costs_title")}</h2>
            <InfoHint text={t("honeymoon.costs_sub")} />
          </div>
          {honeymoonLines.length > 0 && (
            <PresetChips
              onPick={addPreset}
              usedIds={usedPresetIds}
              otherCount={otherCount}
              compact
            />
          )}
        </div>

        {honeymoonLines.length === 0 ? (
          // Compact empty state — short prompt + the chips inline so the
          // section doesn't take a tall card just to say "no rows yet". The
          // chips already carry "Utazás / Szállás / ..." copy, so the body
          // line is reduced to the action verb only.
          <div className="card flex flex-wrap items-center gap-3 !p-4 text-left">
            <p className="text-sm text-ink-700 dark:text-paper-100">
              {t("honeymoon.costs_empty_short")}
            </p>
            <PresetChips
              onPick={addPreset}
              usedIds={usedPresetIds}
              otherCount={otherCount}
              compact
            />
          </div>
        ) : (
          <div className="card overflow-hidden p-0">
            <ul className="divide-y divide-paper-200 dark:divide-umber-700">
              {honeymoonLines.map((line) => (
                <CostRow
                  key={line.id}
                  line={line}
                  locale={locale}
                  sliderMax={sliderMax}
                  currency={currency}
                  onPlannedChange={(v) => updateLinePlanned(line, v)}
                  onDraft={(v) =>
                    setDrafts((d) => {
                      if (v === null) {
                        if (!(line.id in d)) return d;
                        const { [line.id]: _omit, ...rest } = d;
                        return rest;
                      }
                      return { ...d, [line.id]: v };
                    })
                  }
                  onRename={(label) => renameLine(line, label)}
                  onRemove={() => removeLine(line)}
                />
              ))}
            </ul>
          </div>
        )}
      </section>

      <div data-tour-target="honeymoon-todos">
        <HoneymoonTodoSection
          items={honeymoonTasks}
          onToggle={toggleTaskDone}
          onAdd={addHoneymoonTask}
          onDelete={deleteHoneymoonTask}
          weddingDate={couple?.wedding_date ?? null}
        />
      </div>

      {/* Hungarian consular info is only relevant when the couple is getting
       *  married in Hungary (i.e. they're Hungarian travellers abroad). */}
      {couple?.country === "HU" && couple?.honeymoon_destination && (
        <TravelSafetyBlock destination={couple.honeymoon_destination} t={t} />
      )}
    </>
  );
}

/* ─── Hero ─────────────────────────────────────────────────────────────
 * A full-height photo of the destination with the place name set over it and
 * nothing else but glass icons. Everything that used to be a labelled tile is
 * either an icon here (its name lives in title + aria-label) or a segment of
 * the trip bar below.
 *
 * The photo comes from /api/honeymoon/destination-photo, which walks the
 * saved Nominatim breadcrumb outward — venue → city → region → country — and
 * returns the first rung it can find a picture of, plus which rung that was.
 * So a couple who saved a church address in Rome gets Rome rather than the
 * empty gradient the old strip fell back to. A couple's own upload always
 * wins over whatever the wikis had.
 */
function TripHero({
  destination,
  customCoverPath,
  countdown,
  loaded,
  onSaveDestination,
  onCoupleChange,
  onCoverReset,
}: {
  destination: string | null;
  customCoverPath: string | null;
  countdown: Countdown | null;
  loaded: boolean;
  onSaveDestination: (v: string | null) => Promise<void>;
  onCoupleChange: (couple: Couple) => void;
  onCoverReset: () => void;
}) {
  const { t, locale } = useT();
  const toast = useToast();
  const [auto, setAuto] = useState<{ url: string; matched: string | null } | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (customCoverPath || !destination) {
      setAuto(null);
      return;
    }
    let cancelled = false;
    setAuto(null);
    // Send the WHOLE breadcrumb, not its first segment — the fallback ladder
    // is the server's job and it needs the rungs to walk.
    honeymoonApi
      .destinationPhoto(destination, locale)
      .then((r) => {
        if (cancelled || !r.photo_url) return;
        setAuto({ url: r.photo_url, matched: r.matched });
      })
      .catch(() => {
        if (!cancelled) setAuto(null);
      });
    return () => {
      cancelled = true;
    };
  }, [destination, customCoverPath, locale]);

  const photoUrl = customCoverPath ?? auto?.url ?? null;
  useEffect(() => {
    setImgReady(false);
  }, [photoUrl]);

  // Nominatim breadcrumbs run to five or six segments; the headline is the
  // first one (the city or venue the couple actually picked). The full string
  // stays in the title attribute and is what the autocomplete pre-fills.
  const headline = destination
    ? (destination.split(",")[0] ?? destination).trim() || destination
    : null;
  // Worth saying only when the picture is of a different rung than the
  // headline: a shot of Rome captioned with a church name is a small lie.
  const photoOf =
    !customCoverPath &&
    auto?.matched &&
    headline &&
    auto.matched.toLowerCase() !== headline.toLowerCase()
      ? auto.matched
      : null;

  async function handleFile(file: File) {
    if (uploading) return;
    setUploading(true);
    try {
      const result = await honeymoonApi.uploadCover(file);
      onCoupleChange(result.couple);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setUploading(false);
    }
  }

  async function handleReset() {
    const ok = await honeymoonApi.deleteCover().catch(() => null);
    if (ok) onCoverReset();
  }

  return (
    <div
      className={`relative isolate overflow-hidden bg-umber-900 sm:rounded-3xl ${
        // `editing` takes the tall shape too: the picker's list opens upward
        // inside this box, and the empty-state height has no room for it.
        destination || editing
          ? "h-[64svh] min-h-[400px] max-h-[620px]"
          : "h-[42svh] min-h-[260px] max-h-[360px]"
      }${dragging ? " ring-2 ring-paper-50" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
    >
      {/* Base layer under every photo: a warm dusk gradient, so a slow image
          fades in over something intentional rather than over flat black. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-umber-500 via-umber-700 to-umber-950"
      />
      {photoUrl && (
        <img
          key={photoUrl}
          src={photoUrl}
          alt={headline ?? ""}
          onLoad={() => setImgReady(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            imgReady ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {/* Two scrims: one under the glass buttons at the top, one carrying the
          headline at the bottom. Kept separate so the middle of the photo,
          which is the part worth looking at, stays untouched. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink-900/55 to-transparent"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-ink-900/95 via-ink-900/55 to-transparent"
      />

      {/* Top row: where you are in the trip on the left, actions on the right.
          Every action is an icon; the words live in title + aria-label. */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-4 sm:p-5">
        {countdown ? (
          <span className="rounded-full bg-ink-900/45 px-3 py-1 text-xs font-medium text-paper-50 backdrop-blur-sm">
            {countdown.kind === "future" &&
              t("honeymoon.countdown_future", { count: countdown.days })}
            {countdown.kind === "today" && t("honeymoon.countdown_today")}
            {countdown.kind === "ongoing" && t("honeymoon.countdown_ongoing")}
            {countdown.kind === "past" && t("honeymoon.countdown_past", { count: countdown.days })}
          </span>
        ) : (
          <span />
        )}
        <div className="flex shrink-0 items-center gap-2">
          {destination && (
            <GlassButton
              label={t("honeymoon.show_on_map")}
              onClick={() => setMapOpen(true)}
              icon={<MapIcon size={16} aria-hidden="true" />}
            />
          )}
          {customCoverPath && (
            <GlassButton
              label={t("honeymoon.cover_reset")}
              onClick={() => void handleReset()}
              icon={<RotateCcw size={16} aria-hidden="true" />}
            />
          )}
          <GlassButton
            label={uploading ? t("honeymoon.cover_uploading") : t("honeymoon.cover_upload")}
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            icon={
              uploading ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Camera size={16} aria-hidden="true" />
              )
            }
          />
        </div>
      </div>

      {/* Bottom: the destination name, sized as the page's actual headline.
          Clicking it opens the autocomplete in place. */}
      <div className="absolute inset-x-0 bottom-0 p-4 pb-7 sm:p-6 sm:pb-9">
        {editing ? (
          <DestinationAutocomplete
            initial={destination ?? ""}
            onCancel={() => setEditing(false)}
            onCommit={async (next) => {
              setEditing(false);
              if (next === destination) return;
              await onSaveDestination(next);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={t("honeymoon.edit_destination")}
            className="block max-w-full text-left"
          >
            {headline ? (
              <>
                {/* `!text-paper-50` is load-bearing: index.css paints every
                    h1/h2 inside [data-app-shell] umber-900 in light mode, and
                    that selector outranks a plain text-* utility. Without the
                    bang the headline renders near-black on the photo. */}
                <h1
                  title={destination ?? undefined}
                  className="line-clamp-2 font-grotesk text-4xl font-semibold leading-[1.05] tracking-tight !text-paper-50 [text-shadow:0_2px_18px_rgba(16,12,8,0.55)] sm:text-6xl lg:text-7xl"
                >
                  {headline}
                </h1>
                {photoOf && (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-paper-200/90">
                    <Camera size={12} aria-hidden="true" />
                    {t("honeymoon.photo_of", { place: photoOf })}
                  </p>
                )}
              </>
            ) : (
              <span className="inline-flex items-center gap-2.5 rounded-full bg-paper-50 px-5 py-2.5 font-grotesk text-base font-semibold text-ink-900 shadow-pop">
                <Compass size={18} aria-hidden="true" />
                {loaded ? t("honeymoon.destination_empty_cta") : ""}
              </span>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      {mapOpen && destination && (
        <Suspense fallback={null}>
          <HoneymoonMapModal destination={destination} onClose={() => setMapOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Circular frosted control for the hero's photo overlay. Icon only — the
 *  name is carried by title + aria-label, which is what keeps the picture
 *  readable underneath. */
function GlassButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-paper-50/25 bg-ink-900/35 text-paper-50 backdrop-blur-sm transition hover:bg-paper-50 hover:text-ink-900 disabled:opacity-60"
    >
      {icon}
    </button>
  );
}

/** Debounced Nominatim-backed picker. Keystrokes are typed freely; after a
 *  brief pause we hit /api/places/search and drop a 5-row dropdown. Picking
 *  a suggestion commits the suggestion's full address. Pressing Enter or
 *  blurring commits whatever's typed (so users can still enter free text
 *  if Nominatim has nothing for their destination). */
function DestinationAutocomplete({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, locale } = useT();
  const [draft, setDraft] = useState(initial);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  // Tracks whether a commit() has already run for this mount so blur-after-
  // pick doesn't fire a second save with the now-stale draft.
  const committed = useRef(false);

  // Debounced fetch. Skips network for short / unchanged queries.
  useEffect(() => {
    const q = draft.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const myId = ++requestId.current;
    const handle = setTimeout(async () => {
      try {
        const r = await placesApi.search(q, { lang: locale });
        // Discard stale responses — only the latest typed query wins.
        if (myId !== requestId.current) return;
        setSuggestions(r.places);
        setHighlight(-1);
        setOpen(true);
      } catch {
        if (myId !== requestId.current) return;
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [draft, locale]);

  // Click-outside closes the dropdown AND commits whatever's typed — same
  // pattern as DaysTile so the tile feels uniform.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) commitDraft();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  /** Commit on Enter / blur / click-outside. If Nominatim has suggestions
   *  visible, snap to the explicit highlight or the first hit — we'd rather
   *  save a real, map-searchable address than free text the map can't find.
   *  Fall back to raw text only when no suggestions are available
   *  (network failure or string too short). */
  function commitDraft() {
    if (committed.current) return;
    committed.current = true;
    const explicit = highlight >= 0 ? suggestions[highlight] : null;
    const fallback = suggestions[0] ?? null;
    const picked = explicit ?? fallback;
    if (picked) {
      onCommit(picked.secondary || picked.primary);
      return;
    }
    const trimmed = draft.trim();
    onCommit(trimmed.length > 0 ? trimmed : null);
  }

  function pick(s: PlaceSuggestion) {
    committed.current = true;
    setOpen(false);
    // Prefer the full address (secondary) — that's the precise location
    // string the map modal hands back to Nominatim later.
    const value = s.secondary || s.primary;
    onCommit(value);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setOpen(true);
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    } else if (e.key === "Escape") {
      e.preventDefault();
      committed.current = true;
      onCancel();
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* Typed at the exact scale of the headline it replaces (same font,
          size and shadow as the <h1> above), so committing a name doesn't
          resize the thing you were just looking at. The only chrome is an
          underline — a boxed field over a photo reads as a form. */}
      <input
        type="text"
        className="w-full border-0 border-b-2 border-paper-50/40 bg-transparent p-0 pb-1 font-grotesk text-4xl font-semibold leading-[1.05] tracking-tight text-paper-50 caret-paper-50 outline-none [text-shadow:0_2px_18px_rgba(16,12,8,0.55)] placeholder:text-paper-100/45 focus:border-paper-50/85 focus:outline-none focus:ring-0 sm:text-6xl lg:text-7xl"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        maxLength={200}
        // The old "e.g. Bali, Tuscany, Santorini" placeholder was written for a
        // small field; at headline size it runs off the photo. One word does.
        placeholder={t("honeymoon.tile_destination")}
        aria-label={t("honeymoon.tile_destination")}
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        autoFocus
      />
      {open && suggestions.length > 0 && (
        /* Opens UPWARD, over the photo. Downward it fell outside the hero's
           `overflow-hidden` and underneath the trip bar (which overlaps the
           hero's bottom edge with z-10), so the list was invisible exactly
           when it mattered. */
        <ul
          role="listbox"
          className="absolute bottom-full left-0 right-0 z-30 mb-3 max-h-64 max-w-xl overflow-y-auto rounded-xl border border-paper-300 bg-white py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          {suggestions.map((s, i) => (
            <li key={`${s.primary}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                onMouseDown={(e) => {
                  // Use mousedown so the click fires BEFORE the input blurs.
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left ${
                  i === highlight
                    ? "bg-blush-50 dark:bg-blush-400/15"
                    : "hover:bg-paper-50 dark:hover:bg-umber-700"
                }`}
              >
                <MapPin
                  size={14}
                  className="mt-0.5 shrink-0 text-blush-700 dark:text-blush-300"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-900 dark:text-paper-50">
                    {s.primary}
                  </span>
                  {s.secondary && s.secondary !== s.primary && (
                    <span className="block truncate text-[11px] text-ink-500 dark:text-umber-300">
                      {s.secondary}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Trip bar ─────────────────────────────────────────────────────────
 * Three segments overlapping the bottom edge of the photo: how long you are
 * away, what the trip is budgeted at, what the flights cost. Each is a number
 * with an icon over it — no field labels, because a calendar over "30 nap"
 * over "jún. 8. → júl. 8." does not need the word "dates" as well.
 */
function TripBar({
  start,
  end,
  nights,
  locale,
  loaded,
  currency,
  planned,
  actual,
  lineCount,
  tripReady,
  flightOpen,
  flightLoading,
  bestOffer,
  onFlightToggle,
  onSaveDates,
}: {
  start: string | null;
  end: string | null;
  nights: number | null;
  locale: Locale;
  loaded: boolean;
  currency: Currency;
  planned: number;
  actual: number;
  lineCount: number;
  tripReady: boolean;
  flightOpen: boolean;
  flightLoading: boolean;
  /** Cheapest live offer, or null before a search / on a miss. */
  bestOffer: FlightOffer | null;
  onFlightToggle: () => void;
  onSaveDates: (start: string | null, end: string | null) => Promise<void>;
}) {
  const { t } = useT();
  const [editingDates, setEditingDates] = useState(false);

  const dateRange =
    start || end
      ? [formatDayMonth(start, locale), formatDayMonth(end, locale)].filter(Boolean).join(" → ")
      : null;

  return (
    <div className="relative z-10 -mt-7 px-4 sm:px-6">
      <div className="overflow-hidden rounded-2xl border border-paper-200 bg-white shadow-pop dark:border-umber-600 dark:bg-umber-800">
        <div className="grid grid-cols-3 divide-x divide-paper-200 dark:divide-umber-700">
          <TripStat
            icon={<Calendar size={15} aria-hidden="true" />}
            label={t("honeymoon.tile_days")}
            value={
              nights !== null
                ? `${nights} ${t("honeymoon.day", { count: nights })}`
                : loaded
                  ? t("honeymoon.set_dates_cta")
                  : ""
            }
            hint={dateRange}
            muted={nights === null}
            active={editingDates}
            onClick={() => setEditingDates((v) => !v)}
            actionLabel={t("honeymoon.edit_dates")}
          />
          <TripStat
            icon={<Wallet size={15} aria-hidden="true" />}
            label={t("honeymoon.tile_budget")}
            value={loaded ? formatMoney(planned, currency, locale) : ""}
            // No hint at all on an empty budget: "0 Ft" already says there is
            // nothing here, and the longer sentence only truncated.
            hint={
              actual > 0
                ? t("honeymoon.budget_actual_inline", {
                    actual: formatMoney(actual, currency, locale),
                  })
                : lineCount > 0
                  ? t("honeymoon.budget_lines_count", { count: lineCount })
                  : null
            }
            to="/app/budget"
            actionLabel={t("honeymoon.tile_budget")}
          />
          <TripStat
            icon={
              flightLoading ? (
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Plane size={15} aria-hidden="true" />
              )
            }
            label={t("honeymoon.flight_estimate_title")}
            // Once a search has landed, the cheapest fare IS the label. Before
            // that the segment is the button that runs the search. Both use
            // the one-word form: "Repjegy becslés" truncated at a third of a
            // 393px phone.
            value={
              bestOffer ? `~ ${formatOfferPrice(bestOffer, locale)}` : t("honeymoon.flight_short")
            }
            hint={bestOffer ? t("honeymoon.flight_short") : null}
            muted={!bestOffer}
            active={flightOpen}
            disabled={!tripReady}
            onClick={onFlightToggle}
            actionLabel={t("honeymoon.flight_estimate_search")}
          />
        </div>

        {editingDates && (
          <DateRangeRow
            start={start}
            end={end}
            onClose={() => setEditingDates(false)}
            onSave={onSaveDates}
          />
        )}
      </div>
    </div>
  );
}

/** One segment of the trip bar. Renders as a link when `to` is set, otherwise
 *  a button; `label` never paints, it is the accessible name behind the icon. */
function TripStat({
  icon,
  label,
  value,
  hint,
  to,
  onClick,
  disabled,
  muted,
  active,
  actionLabel,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint?: string | null;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  muted?: boolean;
  active?: boolean;
  actionLabel: string;
}) {
  const body = (
    <>
      <span
        aria-hidden="true"
        className={
          active ? "text-blush-700 dark:text-blush-300" : "text-ink-400 dark:text-umber-300"
        }
      >
        {icon}
      </span>
      <span
        className={`mt-1 block max-w-full truncate font-grotesk text-sm font-semibold leading-tight tabular-nums sm:text-base ${
          muted ? "text-ink-500 dark:text-umber-200" : "text-ink-900 dark:text-paper-50"
        }`}
      >
        {value}
      </span>
      {hint && (
        <span className="mt-0.5 block max-w-full truncate text-[11px] leading-tight text-ink-500 dark:text-umber-300">
          {hint}
        </span>
      )}
    </>
  );
  const cls = `flex min-w-0 flex-col items-center px-2 py-3 text-center transition ${
    disabled ? "cursor-not-allowed opacity-45" : "hover:bg-paper-50 dark:hover:bg-umber-700/50"
  }`;

  if (to) {
    return (
      <Link to={to} aria-label={actionLabel} title={label} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={actionLabel}
      aria-pressed={active}
      title={label}
      className={cls}
    >
      {body}
    </button>
  );
}

/** Depart / return pickers, opened by the trip bar's first segment. Each pick
 *  saves on the spot — an explicit Save button for two date fields is one tap
 *  of ceremony too many. Picking a departure after the current return drags
 *  the return along rather than leaving the range inverted. */
function DateRangeRow({
  start,
  end,
  onSave,
  onClose,
}: {
  start: string | null;
  end: string | null;
  onSave: (start: string | null, end: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const floor = maxIsoDate(start || todayIso(), todayIso());

  return (
    <div
      ref={wrapperRef}
      className="flex items-center gap-2 border-t border-paper-200 px-3 py-3 dark:border-umber-700"
    >
      <input
        type="date"
        className="input h-11 min-h-0 flex-1 py-1 text-base sm:h-9 sm:text-sm"
        value={start ?? ""}
        min={todayIso()}
        aria-label={t("honeymoon.start_label")}
        onChange={(e) => {
          const next = e.target.value || null;
          // Keep the range valid: a departure past the current return pulls
          // the return forward with it.
          const nextFloor = maxIsoDate(next || todayIso(), todayIso());
          const nextEnd = end && end < nextFloor ? nextFloor : end;
          void onSave(next, nextEnd);
        }}
        autoFocus
      />
      <span aria-hidden="true" className="shrink-0 text-ink-400 dark:text-umber-300">
        →
      </span>
      <input
        type="date"
        className="input h-11 min-h-0 flex-1 py-1 text-base sm:h-9 sm:text-sm"
        value={end ?? ""}
        min={floor}
        aria-label={t("honeymoon.end_label")}
        onChange={(e) => {
          const next = e.target.value || null;
          // Return before departure is almost always a typo, so refuse it
          // rather than persisting an inverted range.
          if (next && start && next < start) {
            toast.error(t("honeymoon.end_before_start"));
            return;
          }
          void onSave(start, next);
        }}
      />
    </div>
  );
}

/* ─── Cost grid ────────────────────────────────────────────────────────── */

function PresetChips({
  onPick,
  usedIds,
  otherCount,
  compact,
}: {
  onPick: (preset: Preset) => Promise<void>;
  /** Preset IDs that already have a matching honeymoon line. Their chip
   *  goes disabled with a check icon — one category per line. */
  usedIds: Set<Preset["id"]>;
  /** How many "Other" rows exist. The Other chip stays active (and shows an
   *  n/max counter) until MAX_OTHER_LINES are used. */
  otherCount: number;
  compact?: boolean;
}) {
  const { t } = useT();
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "pt-1"}`}>
      {PRESETS.map((p) => {
        const isOther = p.id === "other";
        const used = isOther ? otherCount >= MAX_OTHER_LINES : usedIds.has(p.id);
        // Keep the category's own icon even once added. `used` only means the
        // category is already on the cost list (its line may still be 0 Ft), so
        // a checkmark read as "done" when nothing had been filled in. The greyed,
        // disabled chip already says "already added" without implying completion.
        const Icon = p.icon;
        const label =
          isOther && otherCount > 0
            ? `${t("honeymoon.preset.other")} (${otherCount}/${MAX_OTHER_LINES})`
            : t(`honeymoon.preset.${p.id}`);
        return (
          <button
            key={p.id}
            type="button"
            disabled={used}
            onClick={() => onPick(p)}
            aria-pressed={used || undefined}
            className={
              used
                ? "inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-paper-200 bg-paper-100 px-3 py-1.5 text-xs font-medium text-ink-400 dark:border-umber-700 dark:bg-umber-700/60 dark:text-umber-300"
                : "inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-blush-300 hover:text-blush-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-blush-400/40 dark:hover:text-blush-300"
            }
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Single stacked row in the cost list — mirrors BudgetPage's line-table
 *  density but keeps the slider control. Layout adapts: label + amount on
 *  one line on mobile (slider wraps beneath), full single-row grid on
 *  desktop where the slider spans the middle column. */
function CostRow({
  line,
  locale,
  sliderMax,
  currency,
  onPlannedChange,
  onDraft,
  onRename,
  onRemove,
}: {
  line: BudgetLine;
  locale: Locale;
  sliderMax: number;
  currency: Currency;
  onPlannedChange: (v: number) => Promise<void>;
  /** Publish the row's in-flight value to the parent so the planned-total
   *  tile can update live during drag. Call with `null` once the row has
   *  settled (commit landed, drag returned to the saved value, etc.). */
  onDraft: (v: number | null) => void;
  onRename: (label: string) => Promise<void>;
  onRemove: () => void;
}) {
  const { t } = useT();
  const preset = line.preset_key
    ? (PRESETS.find((p) => p.id === line.preset_key) ?? presetFor(line.label))
    : presetFor(line.label);
  const Icon = preset.icon;
  // Resolve display label respecting current locale.
  // For preset_key rows: translate directly (handles locale switches).
  // For legacy rows without preset_key: try label-based detection via presetFor;
  //   if it matches a specific preset, translate it; if it's a default "other"
  //   label (Hungarian or English), translate the base word and preserve any
  //   ordinal suffix; otherwise leave the custom label untouched.
  function resolveDisplayLabel(): string {
    if (line.preset_key) {
      if (line.preset_key === "other") {
        const base = t("honeymoon.preset.other");
        const numMatch = line.label.match(/\s(\d+)$/);
        return numMatch ? `${base} ${numMatch[1]}` : base;
      }
      return t(`honeymoon.preset.${line.preset_key}`);
    }
    // Legacy line without preset_key -- `preset` already resolved via presetFor()
    if (preset.id !== "other") {
      return t(`honeymoon.preset.${preset.id}`);
    }
    // "other" catch-all: only translate if the label looks like a default
    // "Egyéb [N]" or "Other [N]" string; preserve genuinely custom names.
    const defaultOther = /^(?:egyéb|other)\s*(\d+)?$/i.exec(line.label);
    if (defaultOther) {
      const base = t("honeymoon.preset.other");
      return defaultOther[1] ? `${base} ${defaultOther[1]}` : base;
    }
    return line.label;
  }
  const displayLabel = resolveDisplayLabel();
  const [localValue, setLocalValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Inline rename: click the label to edit it. Draft re-syncs whenever the
  // saved label changes (after a successful rename or external refresh).
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(line.label);
  useEffect(() => {
    setLabelDraft(line.label);
  }, [line.label]);

  function commitLabel() {
    setEditingLabel(false);
    const trimmed = labelDraft.trim();
    if (!trimmed || trimmed === line.label) {
      setLabelDraft(line.label);
      return;
    }
    void onRename(trimmed);
  }
  // Ref-guard prevents a duplicate save when blur fires immediately after
  // mouseup — state updates haven't flushed yet, so a useState gate would
  // see `saving === false` on the second call.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!saving) setLocalValue(null);
  }, [line.planned_huf, saving]);

  const editValue = localValue ?? line.planned_huf;
  const step = sliderMax >= 2_000_000 ? 10_000 : 5_000;

  async function commit(next: number) {
    if (inFlightRef.current) return;
    const snapped = Math.round(next / step) * step;
    if (snapped === line.planned_huf) {
      setLocalValue(null);
      onDraft(null);
      return;
    }
    inFlightRef.current = true;
    setSaving(true);
    try {
      await onPlannedChange(snapped);
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      // Hand control back to the saved line value once the PATCH settles.
      onDraft(null);
    }
  }

  // Commit whatever's been dragged but not yet persisted. Called from every
  // release-style event (mouseup / touchend / keyup) AND blur — blur is the
  // safety net for the "drag thumb, drift cursor off slider, release outside"
  // path where onMouseUp never fires on the input element.
  function commitPending() {
    if (localValue === null) return;
    void commit(localValue);
  }

  return (
    // Label column is a range, not a fixed 14rem: a preset row ("Utazás") wastes
    // most of a fixed column, while a renamed or seeded one ("Nászút, Bali
    // (szállás)") got cut mid-word with room to spare on the same screen.
    <li className="group grid items-center gap-x-3 gap-y-1 px-4 py-1.5 sm:grid-cols-[minmax(8rem,20rem)_minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:gap-y-0 sm:py-2 grid-cols-[minmax(0,1fr)_auto_auto]">
      {/* Icon + label — col 1 on both layouts. */}
      <div className="col-start-1 row-start-1 flex items-center gap-2.5 min-w-0">
        <Icon size={18} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden="true" />
        {editingLabel ? (
          <input
            type="text"
            value={labelDraft}
            autoFocus
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitLabel();
              } else if (e.key === "Escape") {
                setLabelDraft(line.label);
                setEditingLabel(false);
              }
            }}
            className="input min-w-0 flex-1 px-2 py-1 text-sm"
            aria-label={t("honeymoon.rename")}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingLabel(true)}
            className="truncate text-left text-sm font-medium text-ink-900 decoration-dotted hover:underline dark:text-paper-50"
            title={t("honeymoon.rename")}
          >
            {displayLabel}
          </button>
        )}
      </div>

      {/* Slider — row 2 spanning all cols on mobile, col 2 inline on desktop. */}
      <input
        type="range"
        min={0}
        max={sliderMax}
        step={step}
        value={editValue}
        disabled={saving}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocalValue(v);
          // Publish on every tick so the planned-total tile tracks the drag.
          onDraft(v);
        }}
        onMouseUp={commitPending}
        onTouchEnd={commitPending}
        onKeyUp={commitPending}
        onBlur={commitPending}
        className="range-fill range-fill-thin col-span-3 col-start-1 row-start-2 w-full sm:col-span-1 sm:col-start-2 sm:row-start-1"
        style={rangeFillStyle(editValue, 0, sliderMax, 12)}
        aria-label={t("honeymoon.slider_aria", { label: line.label })}
      />

      {/* Amount — right-aligned next to the label on mobile, dedicated col on desktop. */}
      <div className="col-start-2 row-start-1 flex flex-col items-end whitespace-nowrap sm:col-start-3">
        <span className="stat-num text-sm font-medium text-ink-900 dark:text-paper-50">
          {formatMoney(editValue, currency, locale)}
        </span>
        {line.actual_huf > 0 && (
          <span className="stat-num text-[11px] text-ink-500 dark:text-umber-300">
            {t("honeymoon.cost_actual_inline", {
              actual: formatMoney(line.actual_huf, currency, locale),
            })}
          </span>
        )}
      </div>

      {/* Delete — last col, fades in on hover/focus. */}
      <button
        type="button"
        onClick={onRemove}
        className="col-start-3 row-start-1 p-1 text-ink-400 opacity-0 transition hover:text-blush-700 focus:opacity-100 group-hover:opacity-100 sm:col-start-4 dark:text-umber-300 dark:hover:text-blush-300"
        aria-label={t("budget.delete")}
      >
        <Trash2 size={14} />
      </button>
    </li>
  );
}

// Shared outbound-link chip styling for the Konzinfo block.
const KONZINFO_LINK_CLS =
  "inline-flex items-center gap-1 rounded border border-paper-300 bg-white px-2 py-1 text-xs font-medium text-ink-700 hover:border-blush-400 hover:text-blush-700 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100";

/** "Travel Safety & Entry Basics" — the official Hungarian consular info block
 *  for the couple's honeymoon destination. Resolves the destination to a
 *  Konzinfo country page server-side and shows its security rating + last-update
 *  date when scrapable. Honeymoon-friendly tone (a reassuring checklist, not a
 *  warning wall); the official link is always the prominent, authoritative
 *  source, and a failed fetch still renders at least the country-picker link. */
function TravelSafetyBlock({
  destination,
  t,
}: {
  destination: string;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const [info, setInfo] = useState<KonzinfoInfo | null>(null);
  // Collapsed by default — the block is reference material, not a primary
  // action, so it sits at the bottom of the page as a single compact row that
  // expands on demand (mirrors the flight-estimate card's footprint).
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    honeymoonApi
      .konzinfo()
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        // Even on a transport error, keep the block useful: show the generic
        // country-picker index so the couple can still reach the official source.
        if (!cancelled) {
          setInfo({ destination, matched: null, status: null, index_url: KONZINFO_INDEX_URL });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [destination]);

  const matched = info?.matched ?? null;
  const status = info?.status ?? null;
  const indexUrl = info?.index_url ?? KONZINFO_INDEX_URL;

  const checklist = [
    t("travel_safety.check_passport"),
    t("travel_safety.check_visa"),
    t("travel_safety.check_entry"),
    t("travel_safety.check_health"),
    t("travel_safety.check_insurance"),
    t("travel_safety.check_copies"),
    t("travel_safety.check_register"),
  ];

  return (
    <section className="card stationery-light mt-12 mx-4 !p-5 sm:mx-8">
      {/* Compact, single-row header that doubles as the collapse toggle. */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 text-left"
      >
        <ShieldCheck
          size={18}
          aria-hidden="true"
          className="shrink-0 text-ink-900 dark:text-paper-50"
        />
        {/* Collapsed, this row is one line: the title carries it, and the
            "what is this" sentence only appears once the block is open, where
            it is context rather than a second headline. */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-900 dark:text-paper-50">
            {t("travel_safety.title")}
          </p>
          {!collapsed && (
            <p className="mt-0.5 truncate text-sm text-ink-500 dark:text-umber-300">
              {t("travel_safety.intro")}
            </p>
          )}
        </div>
        {collapsed ? (
          <ChevronDown
            size={18}
            aria-hidden="true"
            className="shrink-0 text-ink-500 dark:text-umber-300"
          />
        ) : (
          <ChevronUp
            size={18}
            aria-hidden="true"
            className="shrink-0 text-ink-500 dark:text-umber-300"
          />
        )}
      </button>

      {!collapsed && (
        <>
          {/* Official country card — the prominent, authoritative source. The
           *  open-page link sits to the right of the country, not below it. */}
          <div className="mt-4 rounded-xl border border-paper-300 bg-paper-50/60 p-3 dark:border-umber-700 dark:bg-umber-900/40">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
              {t("travel_safety.block_title")}
            </p>
            {info === null ? (
              <p className="mt-1 text-sm text-ink-400 dark:text-umber-300">
                {t("travel_safety.loading")}
              </p>
            ) : matched ? (
              <>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="inline-flex items-center gap-1.5 text-base font-semibold text-ink-900 dark:text-paper-50">
                    <MapPin size={15} aria-hidden="true" className="shrink-0" />
                    {matched.country_hu}
                  </p>
                  <a
                    href={matched.konzinfo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={KONZINFO_LINK_CLS}
                  >
                    {t("travel_safety.konzinfo_link")}
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                </div>
                {(status?.safety_category || status?.last_modified || status?.valid_today) && (
                  <dl className="mt-2 space-y-1 text-xs text-ink-700 dark:text-paper-100">
                    {status?.safety_category && (
                      <div className="flex flex-wrap gap-x-1.5">
                        <dt className="text-ink-500 dark:text-umber-300">
                          {t("travel_safety.safety_label")}:
                        </dt>
                        <dd className="font-medium">{status.safety_category}</dd>
                      </div>
                    )}
                    {status?.last_modified && (
                      <div className="flex flex-wrap gap-x-1.5">
                        <dt className="text-ink-500 dark:text-umber-300">
                          {t("travel_safety.last_update_label")}:
                        </dt>
                        <dd className="font-medium">{status.last_modified}</dd>
                      </div>
                    )}
                    {status?.valid_today && (
                      <div className="flex flex-wrap gap-x-1.5">
                        <dt className="text-ink-500 dark:text-umber-300">
                          {t("travel_safety.valid_today_label")}:
                        </dt>
                        <dd className="font-medium">{status.valid_today}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </>
            ) : (
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink-700 dark:text-paper-100">
                  {t("travel_safety.no_match")}
                </p>
                <a
                  href={indexUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={KONZINFO_LINK_CLS}
                >
                  {t("travel_safety.index_link")}
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            )}
          </div>

          {/* Honeymoon pre-trip checklist — reassuring, not alarming. Two
           *  columns on wider viewports to keep the expanded block shallow. */}
          <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("travel_safety.checklist_title")}
          </p>
          <ul className="mt-1.5 grid gap-1.5 text-sm text-ink-700 dark:text-paper-100 sm:grid-cols-2">
            {checklist.map((item) => (
              <li key={item} className="flex items-start gap-1.5">
                <Check
                  size={14}
                  aria-hidden="true"
                  className="mt-0.5 shrink-0 text-ink-900 dark:text-paper-50"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>

          {/* Consular protection + app + insurance. */}
          <div className="mt-4 flex flex-wrap gap-2">
            <a
              href={KONZINFO_REGISTER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={KONZINFO_LINK_CLS}
            >
              <BadgeCheck size={12} aria-hidden="true" />
              {t("travel_safety.register_link")}
            </a>
            <a
              href={KONZINFO_APP_INFO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={KONZINFO_LINK_CLS}
            >
              <Smartphone size={12} aria-hidden="true" />
              {t("travel_safety.app_link")}
            </a>
          </div>

          <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-ink-600 dark:text-paper-100">
            <Umbrella size={13} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{t("travel_safety.insurance_reminder")}</span>
          </p>

          <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-ink-400 dark:text-umber-300">
            <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>{t("travel_safety.disclaimer")}</span>
          </p>
        </>
      )}
    </section>
  );
}

/** Suggestion card showing Amadeus's three cheapest round-trip offers for
 *  the couple's destination + dates, with an inline-editable origin IATA.
 *  Hidden by the caller when the estimate is null. */
function FlightEstimateCard({
  estimate,
  locale,
  t,
  currentOrigin,
  onOriginSave,
  onSaveFlight,
}: {
  estimate: FlightEstimate;
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Couple's explicit override (3-letter IATA) or null when the backend
   *  is using the locale default. The input pre-fills with this; clearing
   *  it saves null and reverts to the default. */
  currentOrigin: string | null;
  onOriginSave: (iata: string | null) => Promise<void>;
  /** Pick an offer → write it into the budget + todos (gated by a confirm
   *  in the parent). Resolves once the writes settle. */
  onSaveFlight: (offer: FlightOffer) => Promise<void>;
}) {
  const updated = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(estimate.fetched_at));
  const [editingOrigin, setEditingOrigin] = useState(false);
  // The whole offer list folds away — the card can sit quietly once the
  // couple has eyeballed the prices. Header chevron toggles it.
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section
      className="card stationery-light relative !p-5 mt-4 mx-4 sm:mx-8"
      aria-label={t("honeymoon.flight_estimate_title")}
    >
      <header className="flex items-start gap-3">
        <Plane
          size={18}
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-ink-900 dark:text-paper-50"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("honeymoon.flight_estimate_title")}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-500 dark:text-umber-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="uppercase tracking-wide">
                {t("honeymoon.flight_estimate_origin_label")}:
              </span>
              {editingOrigin ? (
                <OriginAutocomplete
                  currentIata={currentOrigin}
                  onCommit={async (iata) => {
                    setEditingOrigin(false);
                    if (iata === currentOrigin) return;
                    await onOriginSave(iata);
                  }}
                  onCancel={() => setEditingOrigin(false)}
                  t={t}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingOrigin(true)}
                  className="rounded border border-paper-300 bg-white px-1.5 py-0.5 text-xs font-semibold uppercase tabular-nums tracking-wider text-ink-900 hover:border-blush-400 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-50"
                  aria-label={t("honeymoon.flight_estimate_origin_edit_aria")}
                >
                  {estimate.origin}
                </button>
              )}
            </span>
            <span aria-hidden="true">→</span>
            <span>
              {/* Nominatim breadcrumbs ("Ronda, Serranía de Ronda, Málaga,
               *  Andalúzia, Spanyolország") are too long for the card chrome
               *  — crop to the first segment so we render "Ronda (AGP)"
               *  rather than the full address. */}
              {(estimate.destination_text.split(",")[0] ?? estimate.destination_text).trim() ||
                estimate.destination_text}
              {estimate.destination_iata ? ` (${estimate.destination_iata})` : ""}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t("honeymoon.flight_estimate_party", { adults: estimate.adults })}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? t("honeymoon.flight_expand_aria") : t("honeymoon.flight_collapse_aria")
          }
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-ink-900/5 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-paper-50/10 dark:hover:text-paper-50"
        >
          {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </header>

      {!collapsed && (
        <>
          <ul className="mt-3 space-y-2">
            {estimate.offers.map((offer, idx) => (
              <FlightOfferRow
                key={`${offer.carrier}-${offer.depart_iso}-${idx}`}
                offer={offer}
                locale={locale}
                t={t}
                onSave={onSaveFlight}
              />
            ))}
          </ul>

          <p className="mt-3 inline-flex items-start gap-1.5 text-[11px] text-ink-400 dark:text-umber-300">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{t("honeymoon.flight_price_disclaimer")}</span>
          </p>

          <p className="mt-1 text-[11px] text-ink-400 dark:text-umber-300">
            {t("honeymoon.flight_estimate_attribution", { updated })}
          </p>
        </>
      )}
    </section>
  );
}

/** One row in the FlightEstimateCard's offer list. Compact when collapsed
 *  (carrier · times · duration · stops · price); clicking the chevron
 *  expands a segment-by-segment breakdown with layovers and a Google
 *  Flights deeplink for the parts we can't surface (baggage allowance). */
function FlightOfferRow({
  offer,
  locale,
  t,
  onSave,
}: {
  offer: FlightOffer;
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Pick this offer → push it to the budget + todos via the parent. */
  onSave: (offer: FlightOffer) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const priceLabel = formatOfferPrice(offer, locale);
  const hasSegments = offer.segments.length > 0;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(offer);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-xl border border-paper-200 bg-white/60 dark:border-umber-700 dark:bg-umber-900/40">
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => hasSegments && setOpen((v) => !v)}
          className={`flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2 text-left ${
            hasSegments ? "cursor-pointer" : "cursor-default"
          }`}
          aria-expanded={open}
          aria-label={
            hasSegments
              ? open
                ? t("honeymoon.flight_estimate_collapse")
                : t("honeymoon.flight_estimate_expand")
              : undefined
          }
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
            <span className="rounded bg-ink-900/5 px-1.5 py-0.5 text-xs font-semibold tracking-wider text-ink-900 dark:bg-paper-50/10 dark:text-paper-50">
              {offer.carrier || "-"}
            </span>
            <span className="text-ink-800 tabular-nums dark:text-paper-100">
              {formatOfferTime(offer.depart_iso, locale)} →{" "}
              {formatOfferTime(offer.arrival_iso, locale)}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
              <Clock size={12} aria-hidden="true" />
              {formatDurationLabel(offer.duration_min, t)}
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-ink-500 dark:text-umber-300">
              <ArrowRightLeft size={12} aria-hidden="true" />
              {formatStopsLabel(offer.stops, t)}
            </span>
          </div>
          <span className="flex items-center gap-2">
            <span className="stat-num text-sm font-medium text-ink-900 dark:text-paper-50">
              ~ {priceLabel}
            </span>
            {hasSegments && (
              <span
                aria-hidden="true"
                className="inline-flex h-5 w-5 items-center justify-center text-ink-400 dark:text-umber-300"
              >
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex shrink-0 items-center gap-1.5 border-l border-paper-200 px-3 text-xs font-medium text-green-700 transition hover:bg-green-50 disabled:opacity-60 dark:border-umber-700 dark:text-green-400 dark:hover:bg-green-400/10"
          aria-label={t("honeymoon.flight_save_cta_aria")}
          title={t("honeymoon.flight_save_cta_aria")}
        >
          {saving ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{t("honeymoon.flight_save_cta")}</span>
        </button>
      </div>
      {open && hasSegments && (
        <div className="border-t border-paper-200 bg-white/40 px-3 py-3 dark:border-umber-700 dark:bg-umber-900/30">
          <ol className="space-y-3 text-xs">
            {offer.segments.map((seg, i) => (
              <li key={`${seg.flight_number}-${seg.depart_iso}-${i}`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="rounded bg-ink-900/5 px-1.5 py-0.5 text-[11px] font-semibold tracking-wider text-ink-900 dark:bg-paper-50/10 dark:text-paper-50">
                    {seg.flight_number || seg.carrier || "-"}
                  </span>
                  <span className="text-ink-800 tabular-nums dark:text-paper-100">
                    {formatOfferTime(seg.depart_iso, locale)} {seg.depart_iata}{" "}
                    <span aria-hidden="true">→</span> {formatOfferTime(seg.arrival_iso, locale)}{" "}
                    {seg.arrival_iata}
                  </span>
                  <span className="inline-flex items-center gap-1 text-ink-500 dark:text-umber-300">
                    <Clock size={11} aria-hidden="true" />
                    {formatDurationLabel(seg.duration_min, t)}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-500 dark:text-umber-300">
                  {seg.airline_name && <span>{seg.airline_name}</span>}
                  {seg.airplane && (
                    <span>{t("honeymoon.flight_estimate_aircraft", { model: seg.airplane })}</span>
                  )}
                  {seg.travel_class && (
                    <span>{t("honeymoon.flight_estimate_class", { class: seg.travel_class })}</span>
                  )}
                </div>
                {offer.layovers[i] && (
                  <p className="mt-2 ml-1 inline-flex items-center gap-1.5 rounded bg-blush-50 px-2 py-0.5 text-[11px] text-blush-700 dark:bg-blush-400/15 dark:text-blush-200">
                    <ArrowRightLeft size={11} aria-hidden="true" />
                    {t(
                      offer.layovers[i]?.overnight
                        ? "honeymoon.flight_estimate_layover_overnight"
                        : "honeymoon.flight_estimate_layover",
                      {
                        airport: offer.layovers[i]?.iata ?? "",
                        duration: formatDurationLabel(offer.layovers[i]?.duration_min ?? 0, t),
                      },
                    )}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-paper-200 pt-2 dark:border-umber-700">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-500 dark:text-umber-300">
              <Briefcase size={12} aria-hidden="true" />
              {t("honeymoon.flight_estimate_baggage_unknown")}
            </span>
            {offer.booking_url && (
              <a
                href={offer.booking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-paper-300 bg-white px-2 py-0.5 text-[11px] font-medium text-ink-700 hover:border-blush-400 hover:text-blush-700 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100"
              >
                {t("honeymoon.flight_estimate_view_on_google")}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Inline IATA picker for the flight estimate card. Accepts free-text city
 *  names ("Budapest", "Bécs") OR raw 3-letter IATA codes ("BUD"). Surfaces
 *  the top 5 curated airports as a dropdown so couples don't need to know
 *  IATA codes by heart. Click / Enter commits the selection; clearing the
 *  input commits null (revert to locale default). */
function OriginAutocomplete({
  currentIata,
  onCommit,
  onCancel,
  t,
}: {
  currentIata: string | null;
  onCommit: (iata: string | null) => Promise<void>;
  onCancel: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const toast = useToast();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(currentIata ?? "");
  const [suggestions, setSuggestions] = useState<AirportOrigin[]>([]);
  const [highlight, setHighlight] = useState(-1);
  // Single-shot guard: blur fires after Enter / click commits, and we don't
  // want a stale draft re-running the commit logic.
  const committed = useRef(false);

  useEffect(() => {
    setSuggestions(draft.trim().length >= 1 ? searchAirportOrigins(draft, 5) : []);
    setHighlight(-1);
  }, [draft]);

  function pick(iata: string) {
    if (committed.current) return;
    committed.current = true;
    void onCommit(iata);
  }

  function commitTyped() {
    if (committed.current) return;
    const raw = draft.trim();
    // Empty input → revert to locale default (null on the row).
    if (raw.length === 0) {
      committed.current = true;
      void onCommit(null);
      return;
    }
    // Prefer the highlighted suggestion. If nothing is highlighted but a
    // dropdown row exists, take the top hit — typing "Buda" + Enter should
    // snap to BUD without forcing the user to press ↓ first.
    const picked = (highlight >= 0 ? suggestions[highlight] : null) ?? suggestions[0] ?? null;
    if (picked) {
      committed.current = true;
      void onCommit(picked.iata);
      return;
    }
    // No suggestion → fall back to direct IATA mode (3 uppercase letters).
    const upper = raw.toUpperCase();
    if (/^[A-Z]{3}$/.test(upper)) {
      committed.current = true;
      void onCommit(upper);
      return;
    }
    // Reject ambiguous input — toast the error, revert the draft, and bail.
    toast.error(t("honeymoon.flight_estimate_origin_invalid"));
    committed.current = true;
    onCancel();
  }

  // Click-outside cancels (same UX as the destination tile).
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) commitTyped();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, suggestions, highlight]);

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitTyped();
    } else if (e.key === "Escape") {
      e.preventDefault();
      committed.current = true;
      onCancel();
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        placeholder={t("honeymoon.flight_estimate_origin_placeholder")}
        className="w-32 rounded border border-paper-300 bg-white px-1.5 py-0.5 text-xs font-medium text-ink-900 focus:border-blush-500 focus:outline-none dark:border-umber-600 dark:bg-umber-800 dark:text-paper-50"
        aria-label={t("honeymoon.flight_estimate_origin_edit_aria")}
        autoFocus
      />
      {suggestions.length > 0 && (
        <ul
          className="absolute left-0 top-full z-20 mt-1 w-64 overflow-hidden rounded-lg border border-paper-300 bg-white shadow-pop dark:border-umber-600 dark:bg-umber-800"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <li key={s.iata} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                // Click handler can't use onClick alone — the outer
                // mousedown listener would commitTyped() and clobber the
                // selection. Bind onMouseDown so we run before the outside
                // click handler fires.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s.iata);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-xs ${
                  i === highlight
                    ? "bg-blush-50 dark:bg-blush-400/15"
                    : "hover:bg-paper-100 dark:hover:bg-umber-700"
                }`}
              >
                <span className="rounded bg-ink-900/5 px-1.5 py-0.5 text-[11px] font-semibold tracking-wider text-ink-900 tabular-nums dark:bg-paper-50/10 dark:text-paper-50">
                  {s.iata}
                </span>
                <span className="min-w-0 truncate text-ink-700 dark:text-paper-100">{s.city}</span>
                <span className="ml-auto shrink-0 text-[11px] text-ink-400 dark:text-umber-300">
                  {s.country}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whole-unit offer price in its own currency, e.g. "603 138 Ft" / "€1,240". */
function formatOfferPrice(offer: FlightOffer, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: offer.currency,
    maximumFractionDigits: 0,
  }).format(offer.price);
}

function formatOfferTime(iso: string, locale: Locale): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatDurationLabel(
  minutes: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!minutes || minutes <= 0) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return t("honeymoon.flight_estimate_duration", {
    hours,
    minutes: String(mins).padStart(2, "0"),
  });
}

function formatStopsLabel(
  stops: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (stops <= 0) return t("honeymoon.flight_estimate_direct");
  if (stops === 1) return t("honeymoon.flight_estimate_stops_one");
  return t("honeymoon.flight_estimate_stops_other", { count: stops });
}

/** Honeymoon-scoped todo checklist. Mirrors the rows on /app/tervezés
 *  filtered to topic === "honeymoon", so couples can tick items off
 *  without leaving the trip page. The header links over to the planning
 *  page where the wand lives and where items can be renamed, reordered,
 *  or deleted. Empty state CTA points to the same place. */
function HoneymoonTodoSection({
  items,
  onToggle,
  onAdd,
  onDelete,
  weddingDate,
}: {
  items: PlanningItem[];
  onToggle: (item: PlanningItem) => Promise<void>;
  /** Create a new honeymoon-topic task with the given title. Returns true on
   *  success so the inline form can clear its input; false leaves the typed
   *  value in place so the user can retry without re-typing. `dueDate` is set
   *  only by the pack wizard, which knows each item's lead time. */
  onAdd: (title: string, dueDate?: string | null) => Promise<boolean>;
  /** Counted back from, to date each applied pack item. Null before the couple
   *  sets a date, in which case the rows arrive undated exactly as before. */
  weddingDate: string | null;
  /** Remove a task from the list (optimistic; parent restores on failure). */
  onDelete: (item: PlanningItem) => Promise<void>;
}) {
  const { t, locale } = useT();
  const done = items.filter((i) => i.done).length;
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [wandOpen, setWandOpen] = useState(false);
  const [wandApplying, setWandApplying] = useState(false);

  // Honeymoon-group items from the shared task template. Pulled from
  // TASK_TEMPLATE_GROUPS so the wand on this page stays in lockstep with
  // the planning page's honeymoon section — adding a template item there
  // surfaces it here automatically.
  const wandBaseItems = useMemo(
    () => TASK_TEMPLATE_GROUPS.find((g) => g.id === "honeymoon")?.items ?? [],
    [],
  );
  // Track which existing task titles match a template item so the dialog
  // can default-deselect duplicates — couples shouldn't get two "Repjegyet
  // lefoglalni" rows just for re-opening the wand. Match across both
  // locales so a HU-typed task hides the EN template entry too.
  const existingTitles = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) set.add(item.title);
    return set;
  }, [items]);
  // The pack is one ordered pool: the honeymoon base set first, then the reserve
  // extras. The dialog reveals a sliding window of it — a full batch of
  // actionable rows stays at the top, and as each gets checked it drops to the
  // "queued / already on the list" pile at the bottom while the next reserve
  // suggestion slides up into its place. So the couple can work the whole pool
  // in one view, then commit the batch with a single confirm.
  const wandPool = useMemo(() => [...wandBaseItems, ...HONEYMOON_EXTRA_TASKS], [wandBaseItems]);
  const isOnList = useMemo(
    () => (it: { title: { hu: string; en: string } }) =>
      existingTitles.has(it.title.hu) || existingTitles.has(it.title.en),
    [existingTitles],
  );
  // Selection keyed by EN title so a row keeps its identity as the window slides.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Reset to an empty selection each time the dialog opens — the couple opts in
  // by checking, rather than opting out of a pre-checked set.
  useEffect(() => {
    if (wandOpen) setSelected(new Set());
  }, [wandOpen]);

  // Reveal the smallest prefix of the pool that still surfaces a full batch of
  // actionable rows (not yet checked, not already on the list). Checking a row —
  // or finding one already on the list — frees a slot, so the window grows to
  // pull in the next reserve suggestion, until the pool runs out.
  const activeTarget = wandBaseItems.length;
  const revealCount = useMemo(() => {
    let active = 0;
    for (let i = 0; i < wandPool.length; i++) {
      const it = wandPool[i];
      if (!it) continue;
      if (!isOnList(it) && !selected.has(it.title.en)) {
        active++;
        if (active >= activeTarget) return i + 1;
      }
    }
    return wandPool.length;
  }, [wandPool, isOnList, selected, activeTarget]);

  // Top: still-actionable rows. Bottom: checked (queued) + already-on-list rows.
  const wandItems = useMemo(() => {
    const revealed = wandPool.slice(0, revealCount);
    const active: typeof revealed = [];
    const settled: typeof revealed = [];
    for (const it of revealed) {
      if (!isOnList(it) && !selected.has(it.title.en)) active.push(it);
      else settled.push(it);
    }
    return [...active, ...settled];
  }, [wandPool, revealCount, isOnList, selected]);

  // FLIP: when the window reorders (a checked row drops, a reserve row appears),
  // animate each surviving row from its prior position to its new one so the
  // change reads as a slide rather than a jump. No-ops where layout metrics are
  // absent (test DOM reports zeroes), so it never affects behaviour.
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const prevRects = useRef<Map<string, DOMRect>>(new Map());
  const orderKey = wandItems.map((it) => it.title.en).join("|");
  useLayoutEffect(() => {
    const refs = rowRefs.current;
    for (const [key, el] of refs) {
      const next = el.getBoundingClientRect();
      const prev = prevRects.current.get(key);
      const dy = prev ? prev.top - next.top : 0;
      if (dy) {
        el.style.transform = `translateY(${dy}px)`;
        el.style.transition = "none";
        void el.offsetHeight;
        requestAnimationFrame(() => {
          el.style.transition = "transform 220ms ease";
          el.style.transform = "";
        });
      }
      prevRects.current.set(key, next);
    }
    for (const key of prevRects.current.keys()) {
      if (!refs.has(key)) prevRects.current.delete(key);
    }
  }, [orderKey]);

  async function applyWand() {
    if (wandApplying) return;
    setWandApplying(true);
    let added = 0;
    try {
      for (const it of wandPool) {
        if (!selected.has(it.title.en)) continue;
        // Dated on the spot from the item's own lead time. Before this, applying
        // the pack produced a pile of undated rows that the timeline wizard then
        // had to be opened to schedule, and every one of them landed on the same
        // fallback day because the lead times were unreachable from there.
        const ok = await onAdd(
          localizeText(it.title, locale),
          packDueDate(weddingDate, it.deadline_days),
        );
        if (ok) added++;
      }
    } finally {
      setWandApplying(false);
      if (added > 0) setWandOpen(false);
    }
  }

  function toggleSelected(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Select-all targets the whole pool (minus already-on-list rows); selecting
  // everything naturally reveals the full pool as each row settles.
  const selectableKeys = useMemo(
    () => wandPool.filter((it) => !isOnList(it)).map((it) => it.title.en),
    [wandPool, isOnList],
  );
  const allSelected = selectableKeys.length > 0 && selectableKeys.every((k) => selected.has(k));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onAdd(trimmed);
      if (ok) setDraft("");
    } finally {
      setSubmitting(false);
    }
  }

  /** Single-line "+ Add a task" form. Used in both the empty state and at the
   *  bottom of the list so the affordance is always visible. */
  const addForm = (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={t("honeymoon.todo_add_placeholder")}
        aria-label={t("honeymoon.todo_add_placeholder")}
        disabled={submitting}
        maxLength={200}
        className="input h-9 min-h-0 flex-1 py-1 text-sm"
      />
      <button
        type="submit"
        disabled={!draft.trim() || submitting}
        aria-label={t("honeymoon.todo_add_aria")}
        title={t("honeymoon.todo_add_aria")}
        className="btn-primary inline-flex h-9 w-9 items-center justify-center !p-0"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
    </form>
  );

  return (
    <section className="mt-12">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-grotesk">{t("honeymoon.todo_title")}</h2>
          {items.length > 0 && (
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
              {t("honeymoon.todo_sub_count", { done, total: items.length })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setWandOpen(true)}
            className="btn-outline btn-sm inline-flex items-center gap-1.5"
          >
            <Wand2 size={14} aria-hidden="true" />
            {t("honeymoon.todo_wand_button")}
          </button>
          <Link to="/app/planning" className="btn-ghost btn-sm inline-flex items-center gap-1.5">
            {t("honeymoon.todo_manage_link")}
          </Link>
        </div>
      </div>
      {items.length === 0 ? (
        // Empty state is the input, nothing else. The paragraph that used to
        // sit above it explained where the wand lives while the wand button
        // was already in this section's header, two rows up.
        <div className="card !p-4">{addForm}</div>
      ) : (
        <div className="card p-0">
          <ul className="divide-y divide-paper-200 dark:divide-umber-700">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-paper-50 dark:hover:bg-umber-700/40"
              >
                <button
                  type="button"
                  onClick={() => onToggle(item)}
                  aria-pressed={item.done}
                  aria-label={
                    item.done ? t("honeymoon.todo_uncheck_aria") : t("honeymoon.todo_check_aria")
                  }
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition ${
                    item.done
                      ? "border-sage-500 bg-sage-500 text-white dark:border-sage-400 dark:bg-sage-400 dark:text-umber-900"
                      : "border-paper-300 bg-paper-50 text-transparent hover:border-ink-400 dark:border-umber-700 dark:bg-umber-800"
                  }`}
                >
                  <Check size={14} aria-hidden="true" />
                </button>
                <p
                  className={`min-w-0 flex-1 truncate text-sm ${
                    item.done
                      ? "text-ink-400 line-through dark:text-umber-300"
                      : "text-ink-900 dark:text-paper-50"
                  }`}
                  title={item.title}
                >
                  {item.title}
                </p>
                {item.assignee && (
                  <span className="shrink-0 text-xs text-ink-500 dark:text-umber-300">
                    {item.assignee}
                  </span>
                )}
                {/* Per-row delete. Always visible (subtle) so it works on touch
                    too; darkens on hover/focus on pointer devices. */}
                <button
                  type="button"
                  onClick={() => void onDelete(item)}
                  aria-label={t("honeymoon.todo_delete_aria")}
                  title={t("honeymoon.todo_delete_aria")}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-paper-200 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-300 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-50 dark:focus-visible:ring-paper-100"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
            <li className="px-4 py-2.5">{addForm}</li>
          </ul>
        </div>
      )}
      {wandOpen && (
        <Dialog
          open
          role="dialog"
          title={t("honeymoon.todo_wand_dialog_title")}
          closeOnBackdrop
          onClose={() => {
            if (!wandApplying) setWandOpen(false);
          }}
          footer={
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setWandOpen(false)}
                disabled={wandApplying}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={applyWand}
                disabled={wandApplying || selected.size === 0}
              >
                {wandApplying
                  ? t("common.loading")
                  : t("honeymoon.todo_wand_confirm", { count: selected.size })}
              </button>
            </>
          }
        >
          <p className="text-sm text-ink-700 dark:text-paper-100">
            {t("honeymoon.todo_wand_dialog_body")}
          </p>
          <div className="mt-3 rounded-lg border border-paper-200 bg-paper-50 p-3 dark:border-umber-700 dark:bg-umber-800">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-ink-500 dark:text-umber-300">
                {t("planning.template_select_label", {
                  count: selected.size,
                  total: revealCount,
                })}
              </p>
              <button
                type="button"
                onClick={() => setSelected(allSelected ? new Set() : new Set(selectableKeys))}
                className="text-xs text-ink-600 underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
              >
                {allSelected
                  ? t("planning.template_select_none")
                  : t("planning.template_select_all")}
              </button>
            </div>
            <ul className="space-y-0.5">
              {wandItems.map((tmpl) => {
                const key = tmpl.title.en;
                const on = selected.has(key);
                const onList = isOnList(tmpl);
                return (
                  <li
                    key={key}
                    ref={(el) => {
                      if (el) rowRefs.current.set(key, el);
                      else rowRefs.current.delete(key);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!onList) toggleSelected(key);
                      }}
                      aria-pressed={onList ? undefined : on}
                      disabled={onList}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        on
                          ? "bg-paper-100 text-ink-900 hover:bg-paper-200 dark:bg-umber-700/60 dark:text-paper-50 dark:hover:bg-umber-700"
                          : onList
                            ? "cursor-default text-ink-400 dark:text-umber-300"
                            : "text-ink-700 hover:bg-paper-100 hover:text-ink-900 dark:text-paper-100 dark:hover:bg-umber-700 dark:hover:text-paper-50"
                      }`}
                    >
                      {on ? (
                        <CheckCircle2
                          size={14}
                          className="shrink-0 text-sage-700 dark:text-sage-300"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle size={14} className="shrink-0" aria-hidden="true" />
                      )}
                      <span className={onList ? "line-through" : ""}>
                        {localizeText(tmpl.title, locale)}
                      </span>
                      {onList && (
                        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-400 dark:text-umber-300">
                          {t("honeymoon.todo_wand_already_added")}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </Dialog>
      )}
    </section>
  );
}
