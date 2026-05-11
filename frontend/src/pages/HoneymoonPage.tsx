// Honeymoon planner — three header tiles (nights / destination / budget) over
// an inline-editable cost grid. Destination + dates live on `couples`. The
// cost cards mirror `budget_lines` rows in the `honeymoon` category, so a
// change here shows up on /app/budget and vice versa.

import type { BudgetLine, Couple } from "@shared/types";
import {
  BedDouble,
  Calendar,
  Compass,
  MapPin,
  MoreHorizontal,
  Plane,
  ShieldCheck,
  Trash2,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { budgetApi, coupleApi } from "../lib/endpoints";
import { formatHuf, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";
import { publish, subscribe } from "../lib/sync";

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
    icon: MoreHorizontal,
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

/** Strip whitespace + dots so HU-formatted "350 000" / "350.000" both parse. */
function parseHuf(raw: string): number | null {
  const cleaned = raw.replace(/[\s.]/g, "").replace(/,/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) return null;
  return Math.round(n);
}

/* ─── Page ─────────────────────────────────────────────────────────────── */

export default function HoneymoonPage() {
  const { t, locale } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [loaded, setLoaded] = useState(false);

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

  const honeymoonLines = useMemo(() => lines.filter((l) => l.category === "honeymoon"), [lines]);
  const totals = useMemo(() => {
    let planned = 0;
    let actual = 0;
    for (const l of honeymoonLines) {
      planned += l.planned_huf;
      actual += l.actual_huf;
    }
    return { planned, actual };
  }, [honeymoonLines]);
  const nights = nightsBetween(
    couple?.honeymoon_start_date ?? null,
    couple?.honeymoon_end_date ?? null,
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
      await budgetApi.updateLine(line.id, { ...line, planned_huf }, { ifMatch: line.updated_at });
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
        <p className="mt-1 text-sm text-ink-500">{t("honeymoon.sub")}</p>
      </header>

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
        />
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>{t("honeymoon.costs_title")}</h2>
            <p className="mt-1 text-sm text-ink-500">{t("honeymoon.costs_sub")}</p>
          </div>
          {honeymoonLines.length > 0 && <PresetChips onPick={addPreset} compact />}
        </div>

        {honeymoonLines.length === 0 ? (
          <div className="card flex flex-col items-start gap-4 text-left">
            <div>
              <h3 className="font-serif text-lg">{t("honeymoon.costs_empty_title")}</h3>
              <p className="mt-1 text-sm text-ink-700">{t("honeymoon.costs_empty_body")}</p>
            </div>
            <PresetChips onPick={addPreset} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {honeymoonLines.map((line) => (
              <CostCard
                key={line.id}
                line={line}
                locale={locale}
                onPlannedChange={(v) => updateLinePlanned(line, v)}
                onRemove={() => removeLine(line)}
              />
            ))}
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
    const nextEnd = draftEnd === "" ? null : draftEnd;
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

  return (
    <div ref={wrapperRef} className="card-hover relative">
      <div className="flex items-center gap-2 text-ink-500">
        <Calendar size={14} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_days")}
        </span>
      </div>

      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-ink-400">
              {t("honeymoon.start_label")}
            </span>
            <input
              type="date"
              className="input mt-1 h-9 min-h-0 py-1 text-sm"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-ink-400">
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
          className="mt-2 block w-full text-left"
          aria-label={t("honeymoon.edit_dates")}
        >
          <span className="font-serif text-4xl font-semibold tabular-nums text-ink-900">
            {nights !== null ? nights : loaded ? "—" : ""}
          </span>
          <span className="ml-2 text-sm text-ink-500">
            {nights !== null
              ? t("honeymoon.day", { count: nights })
              : loaded
                ? t("honeymoon.set_dates_cta")
                : ""}
          </span>
          {dateRange && <p className="mt-1 text-xs text-ink-400">{dateRange}</p>}
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
  const [draft, setDraft] = useState<string>(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  async function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    if (next === value) return;
    await onSave(next);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
  }

  return (
    <div className="card-hover">
      <div className="flex items-center gap-2 text-ink-500">
        <MapPin size={14} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_destination")}
        </span>
      </div>
      {editing ? (
        <input
          type="text"
          className="input mt-3 h-10 min-h-0 text-base"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          maxLength={200}
          placeholder={t("honeymoon.destination_placeholder")}
          aria-label={t("honeymoon.tile_destination")}
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2 block w-full text-left"
          aria-label={t("honeymoon.edit_destination")}
        >
          {value ? (
            <span className="font-serif text-2xl font-semibold text-ink-900 sm:text-3xl">
              {value}
            </span>
          ) : (
            <span className="text-sm text-ink-500">
              {loaded ? t("honeymoon.destination_empty_cta") : ""}
            </span>
          )}
        </button>
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
}: {
  planned: number;
  actual: number;
  count: number;
  locale: "hu" | "en";
  loaded: boolean;
}) {
  const { t } = useT();
  return (
    <Link
      to="/app/budget"
      className="card-hover relative overflow-hidden bg-gradient-to-br from-blush-50 via-paper-50 to-paper-50"
    >
      <div className="flex items-center gap-2 text-ink-500">
        <Wallet size={14} aria-hidden="true" />
        <span className="text-xs font-medium uppercase tracking-wide">
          {t("honeymoon.tile_budget")}
        </span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-serif text-3xl font-semibold tabular-nums text-ink-900 sm:text-4xl">
          {loaded ? formatHuf(planned, locale) : ""}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-400">
        {actual > 0
          ? t("honeymoon.budget_actual_inline", {
              actual: formatHuf(actual, locale),
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
  compact,
}: {
  onPick: (preset: Preset) => Promise<void>;
  compact?: boolean;
}) {
  const { t } = useT();
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "" : "pt-1"}`}>
      {PRESETS.map((p) => {
        const Icon = p.icon;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="inline-flex items-center gap-1.5 rounded-full border border-paper-300 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-blush-300 hover:text-blush-700"
          >
            <Icon size={14} aria-hidden="true" />
            {t(`honeymoon.preset.${p.id}`)}
          </button>
        );
      })}
    </div>
  );
}

function CostCard({
  line,
  locale,
  onPlannedChange,
  onRemove,
}: {
  line: BudgetLine;
  locale: "hu" | "en";
  onPlannedChange: (v: number) => Promise<void>;
  onRemove: () => void;
}) {
  const { t } = useT();
  const preset = presetFor(line.label);
  const Icon = preset.icon;
  const [draft, setDraft] = useState<string>(formatNumber(line.planned_huf, "hu"));
  const [error, setError] = useState(false);

  useEffect(() => {
    setDraft(formatNumber(line.planned_huf, "hu"));
    setError(false);
  }, [line.planned_huf]);

  function commit() {
    const parsed = parseHuf(draft);
    if (parsed === null) {
      setError(true);
      return;
    }
    if (parsed !== line.planned_huf) onPlannedChange(parsed);
    setDraft(formatNumber(parsed, "hu"));
  }

  return (
    <div className="card-hover group relative">
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-3 top-3 rounded-md p-1 text-ink-400 opacity-0 transition hover:bg-paper-100 hover:text-blush-700 focus:opacity-100 group-hover:opacity-100"
        aria-label={t("budget.delete")}
      >
        <Trash2 size={14} />
      </button>
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blush-50 text-blush-700">
          <Icon size={16} aria-hidden="true" />
        </span>
        <p className="truncate text-sm font-medium text-ink-900" title={line.label}>
          {line.label}
        </p>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          className={`input h-9 min-h-0 flex-1 py-1 text-right text-sm tabular-nums ${
            error ? "input-invalid" : ""
          }`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              (e.target as HTMLInputElement).blur();
            }
          }}
          aria-invalid={error || undefined}
          aria-label={t("budget.planned")}
        />
        <span className="text-xs text-ink-500">Ft</span>
      </div>
      {line.actual_huf > 0 && (
        <p className="mt-1 text-[11px] text-ink-500">
          {t("honeymoon.cost_actual_inline", {
            actual: formatHuf(line.actual_huf, locale),
          })}
        </p>
      )}
    </div>
  );
}
