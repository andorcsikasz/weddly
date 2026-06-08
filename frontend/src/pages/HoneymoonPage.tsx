// Honeymoon planner — three header tiles (nights / destination / budget) over
// a slider-driven cost grid. Destination + dates live on `couples`; the
// destination field is autocompleted against /api/places/search (Nominatim
// proxy). Cost cards mirror `budget_lines` rows in the `honeymoon` category,
// so a slider drag here shows up on /app/budget and vice versa.

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
  BedDouble,
  Briefcase,
  Calendar,
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
  ShieldCheck,
  Trash2,
  UtensilsCrossed,
  Wallet,
  Wand2,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  lazy,
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
  TASK_TEMPLATE_GROUPS,
  localizeText,
} from "../lib/planning_templates";
import { ApiError } from "../lib/api";
import { type AirportOrigin, searchAirportOrigins } from "../lib/airport_origins";
import { budgetApi, coupleApi, honeymoonApi, placesApi, planningApi } from "../lib/endpoints";
import { formatMoney, maxIsoDate, todayIso } from "../lib/format";
import { useT } from "../lib/i18n";
import { publish, subscribe } from "../lib/sync";

// Lazy — Leaflet (~150KB) only ships when the user opens the map popup.
const HoneymoonMapModal = lazy(() => import("../components/HoneymoonMapModal"));

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

function formatDateShort(iso: string | null, locale: "hu" | "en"): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
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

  async function addHoneymoonTask(title: string): Promise<boolean> {
    try {
      const r = await planningApi.create({ kind: "task", topic: "honeymoon", title });
      setHoneymoonTasks((prev) => [...prev, r.item]);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      return false;
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
  // stale result for the old trip never lingers and the "Get flight prices"
  // button comes back for a fresh search. We deliberately do NOT auto-fetch
  // here. The upstream search runs only on an explicit button press.
  useEffect(() => {
    setFlightEstimate(null);
    setFlightSearched(false);
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
        });
      }
      publish("budget:changed");

      // 2) Todo — single canonical "buy the ticket" task; body carries the
      // dated price caveat + the Google Flights deeplink.
      const noteParts = [
        t("honeymoon.flight_save_todo_note", {
          carrier: offer.carrier || "—",
          price: priceLabel,
          date: dateLabel,
        }),
      ];
      if (offer.booking_url) noteParts.push(offer.booking_url);
      const body = noteParts.join("\n\n");
      const todoTitle = t("honeymoon.flight_save_todo_title");
      const existingTodo = honeymoonTasks.find((i) => i.title === todoTitle);
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
      <header className="mb-6 flex items-center gap-2">
        <h1 className="font-grotesk">{t("honeymoon.title")}</h1>
        <InfoHint text={t("honeymoon.sub")} />
      </header>

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
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-ink-900 dark:text-paper-50">
              {t("honeymoon.before_wedding_title")}
            </p>
            <p className="mt-0.5 text-ink-700 dark:text-paper-200">
              {t("honeymoon.before_wedding_body", {
                wedding: formatDateShort(couple.wedding_date, locale),
                honeymoon: formatDateShort(couple.honeymoon_start_date, locale),
              })}
            </p>
          </div>
        </section>
      )}

      {/* 1+2 mobile layout: the countdown tile gets a full row on mobile
          (the date range + "122 days to go" pill needs the horizontal
          room — at 1/3 width on a 393px phone they wrap or truncate),
          then Destination + Budget share row 2 in a 2-col grid. On sm+
          the three tiles become equal peers. Saves ~120px of vertical
          chrome vs the prior single-column stack. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="col-span-2 flex sm:col-span-1">
          <DaysTile
            start={couple?.honeymoon_start_date ?? null}
            end={couple?.honeymoon_end_date ?? null}
            nights={nights}
            locale={locale}
            loaded={loaded}
            onSave={(start, end) =>
              saveTrip({ honeymoon_start_date: start, honeymoon_end_date: end })
            }
          />
        </div>
        <DestinationTile
          value={couple?.honeymoon_destination ?? null}
          loaded={loaded}
          onSave={(v) => saveTrip({ honeymoon_destination: v })}
        />
        <BudgetSummaryTile
          planned={totals.planned}
          actual={totals.actual}
          count={honeymoonLines.length}
          locale={locale}
          loaded={loaded}
          currency={currency}
        />
      </section>

      {/* Flight prices are never fetched automatically. The upstream search
       *  costs money, so we wait for an explicit button press. Once offers
       *  come back the card replaces the button; changing the destination or
       *  dates clears it and the button returns for a fresh search. */}
      {tripReady &&
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

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-grotesk">{t("honeymoon.costs_title")}</h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
              {t("honeymoon.costs_sub")}
            </p>
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

      <HoneymoonTodoSection
        items={honeymoonTasks}
        onToggle={toggleTaskDone}
        onAdd={addHoneymoonTask}
      />
    </>
  );
}

/* ─── Tiles ────────────────────────────────────────────────────────────── */

function DaysTile({
  start,
  end,
  nights,
  locale,
  loaded,
  onSave,
}: {
  start: string | null;
  end: string | null;
  nights: number | null;
  locale: "hu" | "en";
  loaded: boolean;
  onSave: (start: string | null, end: string | null) => Promise<void>;
}) {
  const { t } = useT();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draftStart, setDraftStart] = useState<string>(start ?? "");
  const [draftEnd, setDraftEnd] = useState<string>(end ?? "");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftStart(start ?? "");
    setDraftEnd(end ?? "");
  }, [start, end]);

  useEffect(() => {
    if (!editing) return;
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) commit();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
    // commit reads draft state; we want the latest values via closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draftStart, draftEnd]);

  async function commit() {
    const nextStart = draftStart === "" ? null : draftStart;
    let nextEnd = draftEnd === "" ? null : draftEnd;
    // Return < depart is almost always a typo. Refuse the save and revert
    // the end draft to whatever was last persisted so the user sees the
    // inconsistency cleared rather than a silent rollback.
    if (nextStart && nextEnd && nextEnd < nextStart) {
      toast.error(t("honeymoon.end_before_start"));
      setDraftEnd(end ?? "");
      nextEnd = end;
    }
    setEditing(false);
    if (nextStart === start && nextEnd === end) return;
    await onSave(nextStart, nextEnd);
  }

  const dateRange = useMemo(() => {
    if (!start && !end) return null;
    const s = formatDateShort(start, locale);
    const e = formatDateShort(end, locale);
    if (s && e) return `${s} → ${e}`;
    return s || e;
  }, [start, end, locale]);

  // Countdown to honeymoon start. We also compute "ended N days ago" / "now
  // travelling" so the pill stays informative on every leg of the trip.
  const countdown = useMemo(() => {
    const dToStart = daysToStart(start);
    if (dToStart === null) return null;
    if (dToStart > 0) return { kind: "future" as const, days: dToStart };
    if (dToStart === 0) return { kind: "today" as const };
    const dToEnd = daysToStart(end);
    if (dToEnd !== null && dToEnd >= 0) return { kind: "ongoing" as const };
    return { kind: "past" as const, days: Math.abs(dToStart) };
  }, [start, end]);

  return (
    <div ref={wrapperRef} className="card stationery-ink relative flex h-full w-full flex-col !p-4">
      <div className="flex items-center gap-2 text-paper-200">
        <Calendar size={14} aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_days")}
        </span>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-paper-200">
              {t("honeymoon.start_label")}
            </span>
            <input
              type="date"
              className="input mt-1 h-11 min-h-0 py-1 text-base sm:h-9 sm:text-sm"
              value={draftStart}
              min={todayIso()}
              onChange={(e) => {
                const v = e.target.value;
                setDraftStart(v);
                // Keep the range valid: if the new depart is past the
                // current return, pull the return forward to match. Also
                // make sure the return never lands in the past.
                const floor = maxIsoDate(v || todayIso(), todayIso());
                if (draftEnd && draftEnd < floor) setDraftEnd(floor);
              }}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-paper-200">
              {t("honeymoon.end_label")}
            </span>
            <input
              type="date"
              className="input mt-1 h-11 min-h-0 py-1 text-base sm:h-9 sm:text-sm"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              min={maxIsoDate(draftStart || todayIso(), todayIso())}
            />
          </label>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-full flex-1 flex-col items-center justify-center text-center"
          aria-label={t("honeymoon.edit_dates")}
        >
          {nights !== null ? (
            <span className="flex items-baseline justify-center">
              <span className="font-grotesk text-3xl font-semibold leading-none tabular-nums text-paper-50">
                {nights}
              </span>
              <span className="ml-2 text-sm text-paper-200">
                {t("honeymoon.day", { count: nights })}
              </span>
            </span>
          ) : loaded ? (
            // No dates yet: keep the slot at the same visual size as a filled
            // number by making the CTA the prominent serif line (responsive,
            // matching the budget tile) instead of a thin "—" + small caption.
            <span className="font-grotesk text-lg font-semibold leading-none text-paper-50 sm:text-2xl md:text-3xl">
              {t("honeymoon.set_dates_cta")}
            </span>
          ) : null}
          {dateRange && <p className="mt-1 text-xs text-paper-300">{dateRange}</p>}
          {countdown && (
            <p className="mt-1 text-[11px] text-paper-300">
              {countdown.kind === "future" &&
                t("honeymoon.countdown_future", { count: countdown.days })}
              {countdown.kind === "today" && t("honeymoon.countdown_today")}
              {countdown.kind === "ongoing" && t("honeymoon.countdown_ongoing")}
              {countdown.kind === "past" &&
                t("honeymoon.countdown_past", { count: countdown.days })}
            </p>
          )}
        </button>
      )}
    </div>
  );
}

function DestinationTile({
  value,
  loaded,
  onSave,
}: {
  value: string | null;
  loaded: boolean;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="card stationery-ink relative flex h-full flex-col !p-4">
      <div className="flex items-center gap-2 text-paper-200">
        <MapPin size={14} aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_destination")}
        </span>
      </div>
      {editing ? (
        <DestinationAutocomplete
          initial={value ?? ""}
          onCancel={() => setEditing(false)}
          onCommit={async (next) => {
            setEditing(false);
            if (next === value) return;
            await onSave(next);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex flex-1 w-full items-center justify-center"
          aria-label={t("honeymoon.edit_destination")}
        >
          {value ? (
            // The destination string is often Nominatim's full breadcrumb
            // ("Málaga, Málaga-Costa del Sol, Malaga, Andalúzia, Spanyolország") —
            // crop the displayed text to the first comma-separated segment so
            // the tile shows the headline (city / venue) only. The full
            // string stays in `value` (and the title tooltip) and is what the
            // autocomplete pre-fills when the user clicks to edit.
            <span
              className="line-clamp-2 font-grotesk text-xl font-semibold text-paper-50 sm:text-2xl"
              title={value}
            >
              {(value.split(",")[0] ?? value).trim() || value}
            </span>
          ) : (
            <span className="text-sm text-paper-200">
              {loaded ? t("honeymoon.destination_empty_cta") : ""}
            </span>
          )}
        </button>
      )}

      {/* Corner trigger — only when a destination is set and we're not in
       *  edit mode (the autocomplete dropdown would overlap otherwise). */}
      {value && !editing && (
        <button
          type="button"
          onClick={(e) => {
            // Don't bubble — the tile body acts as the edit-trigger button.
            e.stopPropagation();
            setMapOpen(true);
          }}
          className="absolute bottom-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-paper-50/20 bg-paper-50/10 text-paper-100 shadow-soft transition hover:border-blush-300 hover:bg-paper-50 hover:text-blush-700"
          aria-label={t("honeymoon.show_on_map")}
          title={t("honeymoon.show_on_map")}
        >
          <MapIcon size={14} aria-hidden="true" />
        </button>
      )}

      {mapOpen && value && (
        <Suspense fallback={null}>
          <HoneymoonMapModal destination={value} onClose={() => setMapOpen(false)} />
        </Suspense>
      )}
    </div>
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
  const { t } = useT();
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
        const r = await placesApi.search(q);
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
  }, [draft]);

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
    <div ref={wrapperRef} className="relative mt-3">
      <input
        type="text"
        className="input h-10 min-h-0 w-full text-base"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        maxLength={200}
        placeholder={t("honeymoon.destination_placeholder")}
        aria-label={t("honeymoon.tile_destination")}
        aria-autocomplete="list"
        aria-expanded={open}
        autoComplete="off"
        autoFocus
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-paper-300 bg-white py-1 shadow-pop dark:border-umber-700 dark:bg-umber-800"
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

function BudgetSummaryTile({
  planned,
  actual,
  count,
  locale,
  loaded,
  currency,
}: {
  planned: number;
  actual: number;
  count: number;
  locale: "hu" | "en";
  loaded: boolean;
  currency: Currency;
}) {
  const { t } = useT();
  return (
    <Link
      to="/app/budget"
      className="card stationery-ink relative flex h-full flex-col overflow-hidden !p-4"
    >
      <div className="flex items-center gap-2 text-paper-200">
        <Wallet size={14} aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_budget")}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        <div className="flex items-baseline justify-center gap-2">
          {/* Mobile (half-width cell after the 1+2 layout) needs a smaller
              value font — text-3xl was clipping "HUF 320,000" at both edges
              because the centered flex item overflowed the ~115px content
              area. text-lg fits with room to spare; text-2xl/3xl restore
              the hero feel at sm+/md+ widths where the cell is wider. */}
          <span className="font-grotesk text-lg font-semibold leading-none tabular-nums text-paper-50 sm:text-2xl md:text-3xl">
            {loaded ? formatMoney(planned, currency, locale) : ""}
          </span>
        </div>
        <p className="mt-1 text-center text-xs text-paper-300">
          {actual > 0
            ? t("honeymoon.budget_actual_inline", {
                actual: formatMoney(actual, currency, locale),
              })
            : count === 0
              ? loaded
                ? t("honeymoon.budget_no_lines")
                : ""
              : t("honeymoon.budget_lines_count", { count })}
        </p>
      </div>
    </Link>
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
        const Icon = used ? Check : p.icon;
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
  locale: "hu" | "en";
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
  const preset = presetFor(line.label);
  const Icon = preset.icon;
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
    <li className="group grid items-center gap-x-3 gap-y-1 px-4 py-1.5 sm:grid-cols-[14rem_minmax(0,1fr)_auto_auto] sm:gap-x-4 sm:gap-y-0 sm:py-2 grid-cols-[minmax(0,1fr)_auto_auto]">
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
            {line.label}
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
  locale: "hu" | "en";
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
  const updated = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
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
  locale: "hu" | "en";
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
              {offer.carrier || "—"}
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
          className="flex shrink-0 items-center gap-1.5 border-l border-paper-200 px-3 text-xs font-medium text-blush-700 transition hover:bg-blush-50 disabled:opacity-60 dark:border-umber-700 dark:text-blush-300 dark:hover:bg-blush-400/10"
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
                    {seg.flight_number || seg.carrier || "—"}
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
function formatOfferPrice(offer: FlightOffer, locale: "hu" | "en"): string {
  return new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    style: "currency",
    currency: offer.currency,
    maximumFractionDigits: 0,
  }).format(offer.price);
}

function formatOfferTime(iso: string, locale: "hu" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
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
}: {
  items: PlanningItem[];
  onToggle: (item: PlanningItem) => Promise<void>;
  /** Create a new honeymoon-topic task with the given title. Returns true on
   *  success so the inline form can clear its input; false leaves the typed
   *  value in place so the user can retry without re-typing. */
  onAdd: (title: string) => Promise<boolean>;
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
        const ok = await onAdd(localizeText(it.title, locale));
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
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-grotesk">{t("honeymoon.todo_title")}</h2>
          <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
            {items.length > 0
              ? t("honeymoon.todo_sub_count", { done, total: items.length })
              : t("honeymoon.todo_sub_empty")}
          </p>
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
          <Link
            to="/app/planning"
            className="text-sm text-ink-700 underline decoration-dotted underline-offset-2 hover:text-ink-900 dark:text-paper-100 dark:hover:text-paper-50"
          >
            {t("honeymoon.todo_manage_link")}
          </Link>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="card !p-4">
          <p className="text-sm text-ink-700 dark:text-paper-100">
            {t("honeymoon.todo_empty_body")}
          </p>
          <div className="mt-3">{addForm}</div>
        </div>
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
