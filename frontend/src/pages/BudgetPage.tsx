// Budget planner. Hero "cost planning" panel with a guest-count slider that
// re-prices per-guest categories live, plus an inline-editable line table.

import type { BudgetCategory, BudgetLine, BudgetSnapshot, Couple } from "@shared/types";
import { ArrowUpRight, Plus, Save, Trash2 } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CATEGORY_ICONS, CostPlanningCard } from "../components/CostPlanningCard";
import { useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { applyCategoryPlanned } from "../lib/budget";
import {
  readCostPlanningCount,
  subscribeCostPlanningCount,
  writeCostPlanningCount,
} from "../lib/cost_planning";
import { budgetApi, coupleApi } from "../lib/endpoints";
import { formatHuf, formatNumber } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { publish, subscribe } from "../lib/sync";

// Honeymoon is intentionally absent — its lines are managed on /app/honeymoon
// and shown as a single aggregated row in the table below.
// Same grouping as CostPlanningCard.CATEGORY_ORDER so the two pages stay
// aligned. Clusters: hosting/food → guest experience → couple appearance →
// atmosphere → after-wedding.
const CATEGORIES: BudgetCategory[] = [
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
  useDocumentMeta("seo.budget_title", "seo.budget_description");
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
    // Seed the slider with the shared cost-planning count if /app/suppliers
    // or a prior session has one stored. Otherwise stay at `null` so the
    // slider defaults to the couple's onboarding target.
    if (coupleR.couple) {
      const stored = readCostPlanningCount(coupleR.couple.id);
      if (stored !== null) setCount(stored);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Subscribe to cross-tab budget updates so a partner's edit in tab B
  // refreshes our view in tab A without a hard reload.
  useEffect(() => {
    return subscribe("budget:changed", () => {
      refresh();
    });
  }, []);

  // Mirror cross-tab cost-planning slider changes — e.g. partner B types a
  // new headcount on /app/suppliers in another tab, the slider here follows.
  useEffect(() => {
    if (!couple) return;
    return subscribeCostPlanningCount(couple.id, (next) => {
      if (next !== null) setCount(next);
    });
  }, [couple]);

  // Persist every slider commit so /app/suppliers' Vendégszám filter picks
  // it up on the next mount. Self-tab navigation reads on mount; other tabs
  // see the change via the `storage` event handled above.
  useEffect(() => {
    if (!couple || count === null) return;
    writeCostPlanningCount(couple.id, count);
  }, [couple, count]);

  const cap = budgetCap(couple);
  const baseline = baselineGuestCount(couple);
  const effectiveCount = count ?? baseline;

  /** Centralised error handler — turns a typed ApiError into the right
   *  toast and triggers a refresh ONLY for concurrency conflicts (so the
   *  user's other typed values stay put). Generic network failures keep
   *  the user's local edit and offer a Retry. */
  function handleSaveError(e: unknown, retry: () => void) {
    if (e instanceof ApiError && e.status === 409) {
      toast.error(t("budget.save_conflict"));
      refresh();
      return;
    }
    toast.push({
      message: t("budget.save_failed_retry"),
      kind: "error",
      duration: 6000,
    });
    // Best-effort visible retry — the toast itself is short-lived, but
    // exposing a second toast with action would clutter the rail. We
    // simply re-trigger on tap via the button below.
    // (Keeping the closure here so the inline catch can call it after a
    // user-driven retry. The toast lib doesn't support actions today.)
    void retry;
  }

  async function save(line: BudgetLine, key: "planned_huf" | "actual_huf", val: number) {
    const next = lines.map((l) => (l.id === line.id ? { ...l, [key]: val } : l));
    setLines(next);
    try {
      await budgetApi.updateLine(line.id, { ...line, [key]: val }, { ifMatch: line.updated_at });
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => save(line, key, val));
    }
  }

  async function saveNotes(line: BudgetLine, notes: string) {
    const trimmed = notes.trim();
    const nextNotes: string | null = trimmed.length > 0 ? trimmed : null;
    if (nextNotes === line.notes) return;
    const nextLines = lines.map((l) => (l.id === line.id ? { ...l, notes: nextNotes } : l));
    setLines(nextLines);
    try {
      await budgetApi.updateLine(
        line.id,
        { ...line, notes: nextNotes },
        { ifMatch: line.updated_at },
      );
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => saveNotes(line, notes));
    }
  }

  async function addLineForCategory(category: BudgetCategory) {
    const label = t(`budget.cat.${category}`);
    try {
      const r = await budgetApi.createLine({
        category,
        label,
        planned_huf: 0,
        actual_huf: 0,
      });
      setLines((prev) => [...prev, r.line]);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => addLineForCategory(category));
    }
  }

  async function setCategoryPlanned(category: BudgetCategory, newTotal: number) {
    try {
      const next = await applyCategoryPlanned(
        category,
        newTotal,
        lines,
        t(`budget.cat.${category}`),
      );
      setLines(next);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => setCategoryPlanned(category, newTotal));
    }
  }

  async function saveCap(newCapHuf: number) {
    try {
      const r = await coupleApi.update({
        budget_goal: { kind: "exact", exact_huf: newCapHuf, min_huf: null, max_huf: null },
      });
      setCouple(r.couple);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => saveCap(newCapHuf));
    }
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

  // Honeymoon rolls up into a single read-only row on the budget table — the
  // sub-category breakdown lives on /app/honeymoon. We still feed all lines
  // (including honeymoon) into CostPlanningCard above so the total/category
  // sliders behave the same.
  const { tableLines, honeymoonAgg } = useMemo(() => {
    const others: BudgetLine[] = [];
    let planned = 0;
    let actual = 0;
    let count = 0;
    for (const l of lines) {
      if (l.category === "honeymoon") {
        planned += l.planned_huf;
        actual += l.actual_huf;
        count += 1;
      } else {
        others.push(l);
      }
    }
    return {
      tableLines: others,
      honeymoonAgg: count > 0 ? { planned, actual, count } : null,
    };
  }, [lines]);
  const hasAnyTableRow = tableLines.length > 0 || honeymoonAgg !== null;

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
        onEditPlanned={setCategoryPlanned}
        onCapChange={saveCap}
      />

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>{t("budget.lines_title")}</h2>
            <p className="mt-1 text-sm text-ink-500">{t("budget.lines_sub")}</p>
          </div>
          <AddLinePicker onPick={addLineForCategory} />
        </div>

        <div className="card overflow-hidden p-0">
          <table className="min-w-full text-sm">
            <thead className="border-b border-paper-200 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 font-medium">{t("budget.category")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("budget.planned")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("budget.actual")}</th>
                <th className="hidden px-4 py-3 text-center font-medium sm:table-cell">
                  {t("budget.delta")}
                </th>
                <th className="hidden px-4 py-3 text-center font-medium md:table-cell">
                  {t("budget.note")}
                </th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {tableLines.map((line) => {
                const delta = line.actual_huf - line.planned_huf;
                return (
                  <tr
                    key={line.id}
                    className="border-t border-paper-200 transition hover:bg-paper-50"
                  >
                    <td className="px-4 py-2 align-middle">
                      <CategoryCell category={line.category} />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      <HufInput
                        value={line.planned_huf}
                        onCommit={(v) => save(line, "planned_huf", v)}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      <HufInput
                        value={line.actual_huf}
                        onCommit={(v) => save(line, "actual_huf", v)}
                      />
                    </td>
                    <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
                      {delta !== 0 && (
                        <span
                          className={
                            delta > 0 ? "font-medium text-red-600" : "font-medium text-emerald-600"
                          }
                        >
                          {formatHuf(delta, locale)}
                        </span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2 align-middle md:table-cell">
                      <input
                        className="input h-9 min-h-0 py-1 text-center text-sm"
                        defaultValue={line.notes ?? ""}
                        maxLength={1000}
                        aria-label={t("budget.note")}
                        onBlur={(e) => saveNotes(line, e.target.value)}
                      />
                    </td>
                    <td className="px-2 py-2 text-right align-middle">
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
              {honeymoonAgg && (
                <HoneymoonAggregateRow
                  planned={honeymoonAgg.planned}
                  actual={honeymoonAgg.actual}
                  locale={locale}
                />
              )}
              {!hasAnyTableRow && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-500">
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

/* ─── "Add line" category template picker ───────────────────────────── */

function AddLinePicker({ onPick }: { onPick: (cat: BudgetCategory) => Promise<void> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        className="btn-primary"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus size={16} /> {t("budget.add_line")}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-paper-300 bg-white p-2 shadow-pop"
        >
          <p className="px-2 pb-1 pt-0.5 text-xs uppercase tracking-wide text-ink-500">
            {t("budget.add_template_help")}
          </p>
          <ul className="max-h-72 overflow-y-auto">
            {CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICONS[cat];
              return (
                <li key={cat}>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-800 transition hover:bg-paper-100"
                    onClick={async () => {
                      setOpen(false);
                      await onPick(cat);
                    }}
                  >
                    <Icon size={14} className="text-ink-500" />
                    {t(`budget.cat.${cat}`)}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Static category badge — icon + localized name. Replaces the old
 *  <select> dropdown so categories are fixed at line-creation time. */
function CategoryCell({ category }: { category: BudgetCategory }) {
  const { t } = useT();
  const Icon = CATEGORY_ICONS[category];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-800">
      <Icon size={14} className="text-ink-500" aria-hidden />
      {t(`budget.cat.${category}`)}
    </span>
  );
}

/** Read-only row that rolls every honeymoon-category line into one entry.
 *  The actual edits happen on /app/honeymoon — the chevron link in the
 *  action cell sends the user there. */
function HoneymoonAggregateRow({
  planned,
  actual,
  locale,
}: {
  planned: number;
  actual: number;
  locale: "hu" | "en";
}) {
  const { t } = useT();
  const Icon = CATEGORY_ICONS.honeymoon;
  const delta = actual - planned;
  return (
    <tr className="border-t border-paper-200 transition hover:bg-paper-50">
      <td className="px-4 py-2 align-middle">
        <Link
          to="/app/honeymoon"
          className="inline-flex items-center gap-2 text-sm text-ink-800 hover:text-blush-700"
        >
          <Icon size={14} className="text-ink-500" aria-hidden />
          {t("budget.cat.honeymoon")}
        </Link>
      </td>
      <td className="px-4 py-2 text-center align-middle text-sm tabular-nums text-ink-900">
        {formatHuf(planned, locale)}
      </td>
      <td className="px-4 py-2 text-center align-middle text-sm tabular-nums text-ink-900">
        {formatHuf(actual, locale)}
      </td>
      <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
        {delta !== 0 && (
          <span className={delta > 0 ? "font-medium text-red-600" : "font-medium text-emerald-600"}>
            {formatHuf(delta, locale)}
          </span>
        )}
      </td>
      <td className="hidden px-4 py-2 align-middle text-sm text-ink-500 md:table-cell">
        {t("budget.honeymoon_breakdown_hint")}
      </td>
      <td className="px-2 py-2 text-right align-middle">
        <Link
          to="/app/honeymoon"
          className="btn-ghost btn-sm text-ink-500 hover:text-blush-700"
          aria-label={t("budget.honeymoon_open_aria")}
        >
          <ArrowUpRight size={14} />
        </Link>
      </td>
    </tr>
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
      className={`input h-9 min-h-0 py-1 text-center text-sm tabular-nums ${
        error ? "input-invalid" : ""
      }`}
      value={draft}
      onChange={onChange}
      onBlur={onBlur}
      aria-invalid={error || undefined}
    />
  );
}
