// Honeymoon planner — three header tiles (nights / destination / budget) over
// a slider-driven cost grid. Destination + dates live on `couples`; the
// destination field is autocompleted against /api/places/search (Nominatim
// proxy). Cost cards mirror `budget_lines` rows in the `honeymoon` category,
// so a slider drag here shows up on /app/budget and vice versa.

import type { BudgetLine, Couple, Currency, FlightEstimate, PlaceSuggestion } from "@shared/types";
import {
  BedDouble,
  Calendar,
  Check,
  Compass,
  Map as MapIcon,
  AlertTriangle,
  MapPin,
  Plane,
  ShieldCheck,
  Trash2,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { budgetApi, coupleApi, honeymoonApi, placesApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
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
 *  under `html.dark` (filled = bright paper, remainder = dark umber). */
function rangeFillStyle(value: number, min: number, max: number): { background: string } {
  const span = max - min;
  const pct = span > 0 ? Math.max(0, Math.min(100, ((value - min) / span) * 100)) : 0;
  return {
    background: `linear-gradient(to right, var(--range-fill-amount) 0%, var(--range-fill-amount) ${pct}%, var(--range-fill-remainder) ${pct}%, var(--range-fill-remainder) 100%)`,
  };
}

/** Shared slider ceiling for every honeymoon cost card. Computed once per
 *  render from the couple's overall budget cap (if set) so the headroom
 *  scales with the wedding size. Falls back to a sensible default that
 *  fits a typical Hungarian honeymoon. */
function honeymoonSliderMax(couple: Couple | null, totalPlanned: number): number {
  // Up to 30% of the wedding cap — generous, but keeps the rails feeling
  // bounded for a small wedding.
  if (couple?.budget_goal.kind === "exact" && couple.budget_goal.exact_huf) {
    return Math.max(500_000, Math.round(couple.budget_goal.exact_huf * 0.3));
  }
  if (couple?.budget_goal.kind === "range" && couple.budget_goal.max_huf) {
    return Math.max(500_000, Math.round(couple.budget_goal.max_huf * 0.3));
  }
  // No cap → at least 500k, or 2× the biggest current line.
  return Math.max(500_000, totalPlanned * 2);
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
  // Amadeus flight estimate for the current destination + dates. Loaded
  // lazily on mount and whenever the couple's destination/dates change;
  // server-side cache (12 h) keeps the upstream API call rare. `null` while
  // loading, on miss, or when Amadeus isn't configured — the card just hides.
  const [flightEstimate, setFlightEstimate] = useState<FlightEstimate | null>(null);

  async function refresh() {
    const [c, l] = await Promise.all([coupleApi.current(), budgetApi.listLines()]);
    setCouple(c.couple);
    setLines(l.lines);
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    return subscribe("budget:changed", () => {
      refresh();
    });
  }, []);

  // (Re)fetch the flight estimate whenever the destination or dates change.
  // Bail when any of the three is missing so we don't hammer the server with
  // empty-input requests during onboarding.
  useEffect(() => {
    if (
      !couple?.honeymoon_destination ||
      !couple?.honeymoon_start_date ||
      !couple?.honeymoon_end_date
    ) {
      setFlightEstimate(null);
      return;
    }
    let cancelled = false;
    honeymoonApi
      .flightEstimate()
      .then((r) => {
        if (!cancelled) setFlightEstimate(r.estimate);
      })
      .catch(() => {
        if (!cancelled) setFlightEstimate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [couple?.honeymoon_destination, couple?.honeymoon_start_date, couple?.honeymoon_end_date]);

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

  /* ─── Trip-detail saves (destination + dates) ─────────────────────── */

  async function saveTrip(patch: {
    honeymoon_destination?: string | null;
    honeymoon_start_date?: string | null;
    honeymoon_end_date?: string | null;
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
    if (usedPresetIds.has(preset.id)) return;
    const label = t(`honeymoon.preset.${preset.id}`);
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

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("honeymoon.title")}</h1>
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("honeymoon.sub")}</p>
      </header>

      {honeymoonBeforeWedding && couple?.wedding_date && couple?.honeymoon_start_date && (
        <section
          role="alert"
          className="stationery-blush mb-4 flex items-start gap-3 rounded-2xl border-2 border-blush-500 px-4 py-3"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-blush-700" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-blush-800">{t("honeymoon.before_wedding_title")}</p>
            <p className="mt-0.5 text-ink-700">
              {t("honeymoon.before_wedding_body", {
                wedding: formatDateShort(couple.wedding_date, locale),
                honeymoon: formatDateShort(couple.honeymoon_start_date, locale),
              })}
            </p>
          </div>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
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

      {flightEstimate && <FlightEstimateCard estimate={flightEstimate} locale={locale} t={t} />}

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>{t("honeymoon.costs_title")}</h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
              {t("honeymoon.costs_sub")}
            </p>
          </div>
          {honeymoonLines.length > 0 && (
            <PresetChips onPick={addPreset} usedIds={usedPresetIds} compact />
          )}
        </div>

        {honeymoonLines.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 text-left">
            <div>
              <h3 className="font-serif text-lg">{t("honeymoon.costs_empty_title")}</h3>
              <p className="mt-1 text-sm text-ink-700 dark:text-paper-100">
                {t("honeymoon.costs_empty_body")}
              </p>
            </div>
            <PresetChips onPick={addPreset} usedIds={usedPresetIds} />
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
                  onRemove={() => removeLine(line)}
                />
              ))}
            </ul>
          </div>
        )}
      </section>
    </AppShell>
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
    <div ref={wrapperRef} className="card-hover stationery-dark relative !p-5">
      <div className="flex items-center gap-2 text-paper-200">
        <Calendar size={14} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
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
              className="input mt-1 h-9 min-h-0 py-1 text-sm"
              value={draftStart}
              onChange={(e) => {
                const v = e.target.value;
                setDraftStart(v);
                // Keep the range valid: if the new depart is past the
                // current return, pull the return forward to match.
                if (v && draftEnd && draftEnd < v) setDraftEnd(v);
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
              className="input mt-1 h-9 min-h-0 py-1 text-sm"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              min={draftStart || undefined}
            />
          </label>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 block w-full text-center"
          aria-label={t("honeymoon.edit_dates")}
        >
          <span className="font-serif text-4xl font-semibold tabular-nums text-paper-50">
            {nights !== null ? nights : loaded ? "—" : ""}
          </span>
          <span className="ml-2 text-sm text-paper-200">
            {nights !== null
              ? t("honeymoon.day", { count: nights })
              : loaded
                ? t("honeymoon.set_dates_cta")
                : ""}
          </span>
          {dateRange && <p className="mt-1 text-xs text-paper-300">{dateRange}</p>}
          {countdown && (
            <p className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-full border border-blush-400/40 bg-blush-400/15 px-2.5 py-0.5 text-[11px] font-medium text-blush-200">
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
    <div className="card-hover stationery-dark relative !p-5">
      <div className="flex items-center gap-2 text-paper-200">
        <MapPin size={14} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
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
          className="mt-2 block w-full text-left"
          aria-label={t("honeymoon.edit_destination")}
        >
          {value ? (
            <span
              className="line-clamp-2 font-serif text-xl font-semibold text-paper-50 sm:text-2xl"
              title={value}
            >
              {value}
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
    <Link to="/app/budget" className="card-hover stationery-dark relative overflow-hidden !p-5">
      <div className="flex items-center gap-2 text-paper-200">
        <Wallet size={14} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_budget")}
        </span>
      </div>
      <div className="mt-2 flex items-baseline justify-center gap-2">
        <span className="font-serif text-3xl font-semibold tabular-nums text-paper-50 sm:text-4xl">
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
    </Link>
  );
}

/* ─── Cost grid ────────────────────────────────────────────────────────── */

function PresetChips({
  onPick,
  usedIds,
  compact,
}: {
  onPick: (preset: Preset) => Promise<void>;
  /** Preset IDs that already have a matching honeymoon line. Their chip
   *  goes disabled with a check icon — one category per line. */
  usedIds: Set<Preset["id"]>;
  compact?: boolean;
}) {
  const { t } = useT();
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "pt-1"}`}>
      {PRESETS.map((p) => {
        const used = usedIds.has(p.id);
        const Icon = used ? Check : p.icon;
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
            <Icon size={14} aria-hidden="true" />
            {t(`honeymoon.preset.${p.id}`)}
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
  onRemove: () => void;
}) {
  const { t } = useT();
  const preset = presetFor(line.label);
  const Icon = preset.icon;
  const [localValue, setLocalValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
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
        <Icon
          size={18}
          className="shrink-0 text-blush-700 dark:text-blush-300"
          aria-hidden="true"
        />
        <p
          className="truncate text-sm font-medium text-ink-900 dark:text-paper-50"
          title={line.label}
        >
          {line.label}
        </p>
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
        style={rangeFillStyle(editValue, 0, sliderMax)}
        aria-label={t("honeymoon.slider_aria", { label: line.label })}
      />

      {/* Amount — right-aligned next to the label on mobile, dedicated col on desktop. */}
      <div className="col-start-2 row-start-1 flex flex-col items-end whitespace-nowrap sm:col-start-3">
        <span className="stat-num text-base font-semibold text-ink-900 sm:text-lg dark:text-paper-50">
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

/** Suggestion card showing Amadeus's cheapest round-trip offer for the
 *  couple's destination + dates. Hidden by the caller when the estimate is
 *  null — so this component renders only when we have *something* to say,
 *  even if `price_amount` is null (no offer found for these dates). */
function FlightEstimateCard({
  estimate,
  locale,
  t,
}: {
  estimate: FlightEstimate;
  locale: "hu" | "en";
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const updated = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(estimate.fetched_at));

  return (
    <section
      className="card-hover stationery-light relative !p-5 mt-4 flex items-start gap-3"
      aria-label={t("honeymoon.flight_estimate_title")}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-50 text-blush-700 dark:bg-blush-400/15 dark:text-blush-300"
      >
        <Plane size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500 dark:text-umber-300">
          {t("honeymoon.flight_estimate_title")}
        </p>
        {estimate.price_amount !== null ? (
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="stat-num text-lg font-semibold text-ink-900 sm:text-xl dark:text-paper-50">
              ~{" "}
              {new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-GB", {
                style: "currency",
                currency: estimate.currency,
                maximumFractionDigits: 0,
              }).format(estimate.price_amount)}
            </span>
            <span className="text-xs text-ink-500 dark:text-umber-300">
              {t("honeymoon.flight_estimate_basis", {
                origin: estimate.origin,
                destination: estimate.destination_iata ?? "",
                adults: estimate.adults,
              })}
            </span>
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-ink-600 dark:text-umber-200">
            {t("honeymoon.flight_estimate_empty")}
          </p>
        )}
        <p className="mt-1 text-[11px] text-ink-400 dark:text-umber-300">
          {t("honeymoon.flight_estimate_attribution", { updated })}
        </p>
      </div>
    </section>
  );
}
