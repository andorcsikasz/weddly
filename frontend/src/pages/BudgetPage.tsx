// Budget planner. Hero "cost planning" panel with a guest-count slider that
// re-prices per-guest categories live, plus an inline-editable line table.

import type { BudgetCategory, BudgetLine, BudgetSnapshot, Couple } from "@shared/types";
import { Info, Plus, Save, Trash2 } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { budgetApi, coupleApi } from "../lib/endpoints";
import { formatHuf, formatHufCompact, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";

const CATEGORIES: BudgetCategory[] = [
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
];

/** Categories whose planned cost scales with headcount. Everything else is
 *  treated as a fixed cost (venue rental, photographer day rate, rings, …). */
const PER_GUEST_CATEGORIES = new Set<BudgetCategory>([
  "catering",
  "drinks",
  "cake_dessert",
  "favours",
  "stationery",
]);

/** Fall-back baseline if the couple hasn't picked a target headcount yet —
 *  the slider needs a denominator to do its scaling math. */
const DEFAULT_BASELINE = 100;

function baselineGuestCount(couple: Couple | null): number {
  if (!couple) return DEFAULT_BASELINE;
  const g = couple.guest_count_goal;
  if (g.kind === "exact" && g.exact !== null) return g.exact;
  if (g.kind === "range" && g.min !== null && g.max !== null) {
    return Math.round((g.min + g.max) / 2);
  }
  return couple.target_guest_count ?? DEFAULT_BASELINE;
}

function budgetCap(couple: Couple | null): number | null {
  if (!couple) return null;
  if (couple.budget_goal.kind === "exact") return couple.budget_goal.exact_huf;
  if (couple.budget_goal.kind === "range") return couple.budget_goal.max_huf;
  return null;
}

/** Strip whitespace + dots so HU-formatted "350 000" / "350.000" both parse. */
function parseHuf(raw: string): number | null {
  const cleaned = raw.replace(/[\s. ]/g, "").replace(/,/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000_000) return null;
  return Math.round(n);
}

/** Filename-friendly slug. "Anna & Bence" → "Anna-Bence". Strips diacritics so
 *  HU names like "Réka & Márton" become "Reka-Marton". */
function slugifyName(raw: string): string {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "wedding";
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function BudgetPage() {
  const { t, locale } = useT();
  const confirm = useConfirm();
  const promptEntry = useEntryPrompt();
  const toast = useToast();
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [couple, setCouple] = useState<Couple | null>(null);
  // Slider state lives here so saveSnapshot() can read the current scenario
  // headcount and seed the snapshot-name suggestion.
  const [count, setCount] = useState<number | null>(null);

  async function refresh() {
    const [linesR, snapsR, coupleR] = await Promise.all([
      budgetApi.listLines(),
      budgetApi.listSnapshots(),
      coupleApi.current(),
    ]);
    setLines(linesR.lines);
    setSnapshots(snapsR.snapshots);
    setCouple(coupleR.couple);
  }

  useEffect(() => {
    refresh();
  }, []);

  const cap = budgetCap(couple);
  const baseline = baselineGuestCount(couple);
  const effectiveCount = count ?? baseline;

  async function save(line: BudgetLine, key: "planned_huf" | "actual_huf", val: number) {
    const next = lines.map((l) => (l.id === line.id ? { ...l, [key]: val } : l));
    setLines(next);
    try {
      await budgetApi.updateLine(line.id, { ...line, [key]: val });
    } catch {
      refresh();
    }
  }

  async function saveNotes(line: BudgetLine, notes: string) {
    const trimmed = notes.trim();
    const nextNotes: string | null = trimmed.length > 0 ? trimmed : null;
    if (nextNotes === line.notes) return;
    const nextLines = lines.map((l) => (l.id === line.id ? { ...l, notes: nextNotes } : l));
    setLines(nextLines);
    try {
      await budgetApi.updateLine(line.id, { ...line, notes: nextNotes });
    } catch {
      refresh();
    }
  }

  async function rename(line: BudgetLine, label: string) {
    if (!label.trim() || label === line.label) return;
    const next = lines.map((l) => (l.id === line.id ? { ...l, label } : l));
    setLines(next);
    try {
      await budgetApi.updateLine(line.id, { ...line, label });
    } catch {
      refresh();
    }
  }

  async function changeCategory(line: BudgetLine, category: BudgetCategory) {
    if (category === line.category) return;
    const next = lines.map((l) => (l.id === line.id ? { ...l, category } : l));
    setLines(next);
    try {
      await budgetApi.updateLine(line.id, { ...line, category });
    } catch {
      refresh();
    }
  }

  async function addLine() {
    const r = await budgetApi.createLine({
      category: "other",
      label: t("budget.add_line"),
      planned_huf: 0,
      actual_huf: 0,
    });
    setLines([...lines, r.line]);
  }

  async function removeLine(id: number) {
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await budgetApi.removeLine(id);
    setLines(lines.filter((l) => l.id !== id));
  }

  async function saveSnapshot() {
    const suggested = t("budget.snapshot_default_name", {
      names: slugifyName(couple?.display_name ?? "wedding"),
      count: effectiveCount,
      date: todayIso(),
    });
    const name = await promptEntry({
      title: t("budget.save_snapshot"),
      label: t("budget.snapshot_name_label"),
      helperText: t("budget.snapshot_name_help"),
      placeholder: t("budget.snapshot_name_prompt"),
      defaultValue: suggested,
      confirmLabel: t("common.save"),
      cancelLabel: t("common.cancel"),
      validate: (v) => (v.trim().length === 0 ? t("budget.snapshot_name_label") : null),
    });
    if (!name) return;
    try {
      await budgetApi.createSnapshot({ name });
      const r = await budgetApi.listSnapshots();
      setSnapshots(r.snapshots);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("budget.snapshot_save_failed"));
    }
  }

  async function removeSnapshot(id: number) {
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    await budgetApi.removeSnapshot(id);
    setSnapshots(snapshots.filter((s) => s.id !== id));
  }

  // Aggregate the live lines once for snapshot diff comparisons. Cheap; lines
  // count is small.
  const livePlannedTotal = useMemo(() => lines.reduce((s, l) => s + l.planned_huf, 0), [lines]);

  return (
    <AppShell>
      <header className="mb-6">
        <h1>{t("budget.title")}</h1>
        <p className="mt-1 text-sm text-ink-500">{t("budget.sub")}</p>
      </header>

      <CostPlanningCard
        lines={lines}
        baseline={baseline}
        cap={cap}
        count={effectiveCount}
        onCountChange={setCount}
      />

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>{t("budget.lines_title")}</h2>
            <p className="mt-1 text-sm text-ink-500">{t("budget.lines_sub")}</p>
          </div>
          <button type="button" className="btn-primary" onClick={addLine}>
            <Plus size={16} /> {t("budget.add_line")}
          </button>
        </div>

        <div className="card overflow-hidden p-0">
          <table className="min-w-full text-sm">
            <thead className="border-b border-paper-200 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("budget.category")}</th>
                <th className="px-4 py-3 font-medium">{t("budget.label")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("budget.planned")}</th>
                <th className="px-4 py-3 text-right font-medium">{t("budget.actual")}</th>
                <th className="hidden px-4 py-3 text-right font-medium sm:table-cell">
                  {t("budget.delta")}
                </th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">{t("budget.note")}</th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const delta = line.actual_huf - line.planned_huf;
                return (
                  <tr
                    key={line.id}
                    className="border-t border-paper-200 transition hover:bg-paper-50"
                  >
                    <td className="px-4 py-2 align-top">
                      <select
                        className="input h-9 min-h-0 py-1 text-sm"
                        value={line.category}
                        onChange={(e) => changeCategory(line, e.target.value as BudgetCategory)}
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {t(`budget.cat.${cat}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 align-top">
                      <input
                        className="input h-9 min-h-0 py-1 text-sm"
                        defaultValue={line.label}
                        onBlur={(e) => rename(line, e.target.value)}
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <HufInput
                        value={line.planned_huf}
                        onCommit={(v) => save(line, "planned_huf", v)}
                      />
                    </td>
                    <td className="px-4 py-2 align-top">
                      <HufInput
                        value={line.actual_huf}
                        onCommit={(v) => save(line, "actual_huf", v)}
                      />
                    </td>
                    <td className="hidden px-4 py-2 text-right align-top tabular-nums sm:table-cell">
                      <span
                        className={
                          delta > 0 ? "text-blush-700" : delta < 0 ? "text-ink-500" : "text-ink-400"
                        }
                      >
                        {delta === 0 ? "—" : formatHuf(delta, locale)}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2 align-top md:table-cell">
                      <input
                        className="input h-9 min-h-0 py-1 text-sm"
                        defaultValue={line.notes ?? ""}
                        placeholder={t("budget.note_placeholder")}
                        maxLength={1000}
                        aria-label={t("budget.note")}
                        onBlur={(e) => saveNotes(line, e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-2 text-right align-top">
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-ink-500 hover:text-blush-700"
                        onClick={() => removeLine(line.id)}
                        aria-label={t("budget.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-500">
                    {t("budget.lines_empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>{t("budget.snapshots_title")}</h2>
            <p className="mt-1 text-sm text-ink-500">{t("budget.snapshots_sub")}</p>
          </div>
          <button type="button" className="btn-outline" onClick={saveSnapshot}>
            <Save size={16} /> {t("budget.save_snapshot")}
          </button>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-sm text-ink-500">{t("budget.no_snapshots")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshots.map((s) => (
              <SnapshotCard
                key={s.id}
                snapshot={s}
                livePlannedTotal={livePlannedTotal}
                locale={locale}
                onRemove={() => removeSnapshot(s.id)}
              />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

/* ─── Cost-planning hero ────────────────────────────────────────────── */

function CostPlanningCard({
  lines,
  baseline,
  cap,
  count,
  onCountChange,
}: {
  lines: BudgetLine[];
  baseline: number;
  cap: number | null;
  count: number;
  onCountChange: (n: number) => void;
}) {
  const { t, locale } = useT();

  // Slider range: ±50% around baseline, snapped to 5-guest steps. If the couple
  // set a real range goal, prefer those bounds — they reflect intent.
  const minCount = Math.max(10, Math.round((baseline * 0.5) / 5) * 5);
  const maxCount = Math.max(baseline + 20, Math.round((baseline * 1.5) / 5) * 5);

  // Aggregate lines into category buckets, scaling per-guest categories by
  // the slider's deviation from baseline.
  const buckets = useMemo(() => {
    const factor = baseline > 0 ? count / baseline : 1;
    const map = new Map<BudgetCategory, { planned: number; actual: number }>();
    for (const l of lines) {
      const cur = map.get(l.category) ?? { planned: 0, actual: 0 };
      map.set(l.category, {
        planned: cur.planned + l.planned_huf,
        actual: cur.actual + l.actual_huf,
      });
    }
    return Array.from(map.entries())
      .map(([cat, v]) => ({
        category: cat,
        actual: v.actual,
        planned: PER_GUEST_CATEGORIES.has(cat) ? Math.round(v.planned * factor) : v.planned,
        scales: PER_GUEST_CATEGORIES.has(cat),
      }))
      .filter((b) => b.planned > 0 || b.actual > 0)
      .sort((a, b) => b.planned - a.planned);
  }, [lines, count, baseline]);

  const totalPlanned = buckets.reduce((s, b) => s + b.planned, 0);
  const totalActual = buckets.reduce((s, b) => s + b.actual, 0);
  const overCap = cap !== null && totalPlanned > cap;
  const overage = overCap && cap !== null ? totalPlanned - cap : 0;

  return (
    <section className="card">
      {/* Top-of-card warning strip when over cap. Tints the totals row below. */}
      {overCap && (
        <div className="mb-4 rounded-xl border border-blush-300 bg-blush-50 px-4 py-2 text-sm font-medium text-blush-700">
          {t("budget.over_budget_strip", { amount: formatHuf(overage, locale) })}
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-500">
            {t("budget.cost_planning_title")}
          </p>
          <h2 className="mt-1 font-serif">
            {t("budget.cost_planning_with_count", { n: formatNumber(count, locale) })}
          </h2>
        </div>
        <p className="max-w-sm text-xs text-ink-500">{t("budget.cost_planning_help")}</p>
      </div>

      <div className="mt-5">
        <input
          type="range"
          min={minCount}
          max={maxCount}
          step={1}
          value={count}
          onChange={(e) => onCountChange(Number(e.target.value))}
          className="block w-full cursor-pointer accent-blush-500"
          aria-label={t("budget.cost_planning_title")}
        />
        <div className="mt-1 flex justify-between text-xs text-ink-500">
          <span>{formatNumber(minCount, locale)}</span>
          <span className="text-ink-400">
            {t("budget.cost_planning_baseline_note", { n: formatNumber(baseline, locale) })}
          </span>
          <span>{formatNumber(maxCount, locale)}</span>
        </div>
        {/* Slider scales planned only; actual stays as-recorded. Without this
         *  note the bar fills look wrong at slider extremes. */}
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-400">
          <Info size={11} aria-hidden />
          <span>{t("budget.slider_scope_note")}</span>
        </p>
      </div>

      <ul className="mt-6 space-y-3">
        {buckets.map((b) => (
          <CategoryBar
            key={b.category}
            category={b.category}
            planned={b.planned}
            actual={b.actual}
          />
        ))}
        {buckets.length === 0 && (
          <li className="py-4 text-center text-sm text-ink-500">{t("budget.lines_empty")}</li>
        )}
      </ul>

      <div className="mt-6 border-t border-paper-200 pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-ink-700">{t("budget.total_actual")}</span>
          <span className={`font-serif text-2xl ${overCap ? "text-blush-700" : "text-ink-900"}`}>
            {formatHufCompact(totalActual, locale)}
            <span className={overCap ? "text-blush-400" : "text-ink-400"}>
              {" / "}
              {formatHufCompact(totalPlanned, locale)} Ft
            </span>
          </span>
        </div>
        {cap !== null && (
          <div className="mt-1 flex items-baseline justify-between text-xs">
            <span className="text-ink-500">{t("budget.cap")}</span>
            <span className={overCap ? "text-blush-700" : "text-ink-500"}>
              {formatHufCompact(cap, locale)} Ft
              {overCap && ` · ${t("budget.over_budget")}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function CategoryBar({
  category,
  planned,
  actual,
}: {
  category: BudgetCategory;
  planned: number;
  actual: number;
}) {
  const { t, locale } = useT();
  const denom = Math.max(planned, 1);
  const pct = Math.min(100, (actual / denom) * 100);
  const overFill = actual > planned && planned > 0;

  // Bigger spends get the bolder fill, mirroring the mockup's two-tone bars.
  // Crude but readable: above 100k actual = strong, otherwise soft.
  const fillColor = overFill
    ? "bg-blush-700"
    : actual === 0
      ? "bg-paper-300"
      : actual >= 100_000
        ? "bg-blush-500"
        : "bg-blush-300";

  return (
    <li className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <span className="truncate text-ink-700">{t(`budget.cat.${category}`)}</span>
      <div className="h-2 w-full overflow-hidden rounded-full bg-paper-200">
        <div
          className={`h-full rounded-full transition-all ${fillColor}`}
          style={{ width: `${Math.max(planned > 0 ? 2 : 0, pct)}%` }}
        />
      </div>
      <span className="whitespace-nowrap text-xs tabular-nums text-ink-700">
        {formatHufCompact(actual, locale)}
        <span className="text-ink-400"> / {formatHufCompact(planned, locale)}</span>
      </span>
    </li>
  );
}

/* ─── Snapshots ────────────────────────────────────────────────────── */

function SnapshotCard({
  snapshot,
  livePlannedTotal,
  locale,
  onRemove,
}: {
  snapshot: BudgetSnapshot;
  livePlannedTotal: number;
  locale: "hu" | "en";
  onRemove: () => void;
}) {
  const { t } = useT();
  let planned = 0;
  let actual = 0;
  try {
    const arr = JSON.parse(snapshot.payload_json) as {
      planned_huf?: unknown;
      actual_huf?: unknown;
    }[];
    for (const l of arr) {
      planned += Number(l.planned_huf) || 0;
      actual += Number(l.actual_huf) || 0;
    }
  } catch {
    // ignore — bad payload still shows zeros, not a crash.
  }
  const diff = livePlannedTotal - planned;
  const created = formatSnapshotDate(snapshot.created_at, locale);
  const diffStr = (diff >= 0 ? "+" : "") + formatHuf(diff, locale);

  return (
    <div className="card-hover">
      <h3 className="text-base font-semibold">{snapshot.name}</h3>
      <p className="mt-0.5 text-xs uppercase tracking-wide text-ink-400">{created}</p>
      <dl className="mt-3 space-y-1 text-xs text-ink-700">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500">{t("budget.snapshot_planned_label")}</dt>
          <dd className="tabular-nums">{formatHuf(planned, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500">{t("budget.snapshot_actual_label")}</dt>
          <dd className="tabular-nums">{formatHuf(actual, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500">{t("budget.snapshot_diff_label")}</dt>
          <dd
            className={`tabular-nums ${diff > 0 ? "text-blush-700" : diff < 0 ? "text-ink-500" : "text-ink-400"}`}
          >
            {diffStr}
          </dd>
        </div>
      </dl>
      <button type="button" className="btn-ghost btn-sm mt-3 text-blush-700" onClick={onRemove}>
        <Trash2 size={14} /> {t("budget.delete")}
      </button>
    </div>
  );
}

function formatSnapshotDate(unixMs: number, locale: "hu" | "en"): string {
  // Stored as ms (UnixMs). Be defensive: if the value looks like seconds (small
  // 10-digit), upscale.
  const ms = unixMs > 1e12 ? unixMs : unixMs * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

/* ─── HUF mask input ────────────────────────────────────────────────── */

/** Numeric HUF input that accepts space- and dot-separated thousands. Stores
 *  the canonical integer Forint via `onCommit`. Live-formats on blur for
 *  legibility. Rejects negatives and bogus chars. */
function HufInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string>(formatNumber(value, "hu"));
  const [error, setError] = useState(false);

  // Reset when the upstream value changes (e.g. snapshot reload, refresh).
  useEffect(() => {
    setDraft(formatNumber(value, "hu"));
    setError(false);
  }, [value]);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    setDraft(e.target.value);
    if (error) setError(false);
  }

  function onBlur() {
    const parsed = parseHuf(draft);
    if (parsed === null) {
      setError(true);
      return;
    }
    if (parsed !== value) onCommit(parsed);
    // Always re-format so the user sees grouping after they leave the field.
    setDraft(formatNumber(parsed, "hu"));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={`input h-9 min-h-0 py-1 text-right text-sm tabular-nums ${
        error ? "input-invalid" : ""
      }`}
      value={draft}
      onChange={onChange}
      onBlur={onBlur}
      aria-invalid={error || undefined}
    />
  );
}
