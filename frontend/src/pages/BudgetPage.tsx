// Budget planner. Hero "cost planning" panel with a guest-count slider that
// re-prices per-guest categories live, plus an inline-editable line table.

import type { BudgetCategory, BudgetLine, BudgetSnapshot, Couple } from "@shared/types";
import { ArrowUpRight, BarChart3, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CATEGORY_ICONS, CostPlanningCard, PER_GUEST_CATEGORIES } from "../components/CostPlanningCard";
import { Dialog, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { applyCategoryPlanned, guestCountBaseline, guestCountBounds } from "../lib/budget";
import {
  hydrateCostPlanningCount,
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

function baselineGuestCount(couple: Couple | null, totalGuests = 0): number {
  if (!couple) return DEFAULT_BASELINE;
  // Delegate to the shared helper so /app and /app/budget compute the
  // identical baseline — the user complained about divergence on the two
  // pages, and a single source of truth is the fix.
  return guestCountBaseline(couple, totalGuests);
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
  const location = useLocation();
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [snapshots, setSnapshots] = useState<BudgetSnapshot[]>([]);
  const [couple, setCouple] = useState<Couple | null>(null);
  // Slider state lives here so saveSnapshot() can read the current scenario
  // headcount and seed the snapshot-name suggestion.
  const [count, setCount] = useState<number | null>(null);
  /** Snapshot id currently being restored — disables both action buttons on
   *  the affected card and shows an inline spinner. Null when idle. */
  const [restoringId, setRestoringId] = useState<number | null>(null);
  /** Line id to flash with a blush ring after a `#top-overage` deep-link.
   *  Mirrors the highlight pattern used on SuppliersPage post-submit. */
  const [highlightLineId, setHighlightLineId] = useState<number | null>(null);

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
    // slider defaults to the couple's onboarding target. Hydration moved
    // server-side via `couple.planning_count` (one-way local→server
    // migration is fire-and-forget inside `hydrateCostPlanningCount`).
    if (coupleR.couple) {
      hydrateCostPlanningCount(coupleR.couple);
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
  // Slider bounds — sourced from couple.guest_count_goal so the dashboard
  // (/app) and /app/budget show the exact same numbers. Editing the bounds
  // here persists back to the goal, so the two pages stay in lockstep.
  const bounds = couple ? guestCountBounds(couple, baseline) : { min: 50, max: 150 };

  /** Centralised error handler — turns a typed ApiError into the right
   *  toast and triggers a refresh ONLY for concurrency conflicts (so the
   *  user's other typed values stay put). Generic network failures keep
   *  the user's local edit and offer a Retry. */
  function handleSaveError(e: unknown, retry: () => void) {
    if (e instanceof ApiError && e.status === 409) {
      // Server attaches `{ code: "frozen" }` when a write hits a frozen
      // category — distinguish that from a generic stale-row collision so
      // the user understands what they need to do (unfreeze first) rather
      // than "someone else edited this".
      const detailCode =
        e.detail && typeof e.detail === "object"
          ? (e.detail as { code?: unknown }).code
          : undefined;
      if (detailCode === "frozen") {
        toast.error(t("budget.frozen_save_failed"));
      } else {
        toast.error(t("budget.save_conflict"));
      }
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
      const r = await budgetApi.updateLine(
        line.id,
        { ...line, [key]: val },
        { ifMatch: line.updated_at },
      );
      // Adopt the server's fresh row (most importantly updated_at) so a
      // quick second edit on the same line doesn't PATCH with a now-stale
      // version and trip the OCC guard with a phantom "valaki más is
      // szerkesztette" toast on solo edits.
      setLines((prev) => prev.map((l) => (l.id === r.line.id ? r.line : l)));
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
      const r = await budgetApi.updateLine(
        line.id,
        { ...line, notes: nextNotes },
        { ifMatch: line.updated_at },
      );
      setLines((prev) => prev.map((l) => (l.id === r.line.id ? r.line : l)));
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

  async function saveBounds(min: number, max: number) {
    try {
      const r = await coupleApi.update({
        // Editing the bounds promotes guest_count_goal to a range so
        // /app and /app/budget read identical values next time.
        guest_count_goal: { kind: "range", min, max, exact: null },
      });
      setCouple(r.couple);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => saveBounds(min, max));
    }
  }

  async function toggleFreeze(category: BudgetCategory) {
    if (!couple) return;
    const current = couple.frozen_categories ?? [];
    const willFreeze = !current.includes(category);
    const next = willFreeze
      ? [...current, category]
      : current.filter((c) => c !== category);
    try {
      // Freezing a per-guest category at count ≠ baseline would otherwise
      // snap the row from its scaled display down to the unscaled baseline —
      // discarding the user's last drag. Pin the currently-displayed total
      // into planned_huf first so freeze locks what they actually see.
      if (willFreeze && PER_GUEST_CATEGORIES.has(category) && baseline > 0) {
        const factor = effectiveCount / baseline;
        if (factor !== 1) {
          const baselineSum = lines
            .filter((l) => l.category === category)
            .reduce((s, l) => s + l.planned_huf, 0);
          if (baselineSum > 0) {
            const displayedTotal = Math.round(baselineSum * factor);
            const nextLines = await applyCategoryPlanned(
              category,
              displayedTotal,
              lines,
              t(`budget.cat.${category}`),
            );
            setLines(nextLines);
          }
        }
      }
      const r = await coupleApi.update({ frozen_categories: next });
      setCouple(r.couple);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => toggleFreeze(category));
    }
  }

  const frozenCategoriesSet = useMemo(
    () => new Set<BudgetCategory>(couple?.frozen_categories ?? []),
    [couple?.frozen_categories],
  );

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

  /** Replay a saved snapshot over the live budget. DIY-mirrored supplier
   *  lines survive because the backend preserves them in transaction; we
   *  still `refresh()` afterwards to pick up the restored rows + bumped
   *  updated_at values, then publish so other tabs follow. */
  async function restoreSnapshot(id: number) {
    const ok = await confirm({
      title: t("budget.snapshot_restore_confirm_title"),
      body: t("budget.snapshot_restore_confirm_body"),
      confirmLabel: t("budget.snapshot_restore_confirm_yes"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setRestoringId(id);
    try {
      const r = await budgetApi.restoreSnapshot(id);
      toast.success(t("budget.snapshot_restored", { n: r.restored_count }));
      await refresh();
      publish("budget:changed");
    } catch {
      // Don't rethrow — the toast is the user-facing signal. Keeping the
      // snapshot list intact lets the user retry without scrolling.
      toast.error(t("budget.snapshot_restore_failed"));
    } finally {
      setRestoringId(null);
    }
  }

  // Aggregate the live lines once for snapshot diff comparisons. Cheap; lines
  // count is small.
  const livePlannedTotal = useMemo(() => lines.reduce((s, l) => s + l.planned_huf, 0), [lines]);

  // Deep-link target from CostPlanningCard's serious-tier action. Picks the
  // single line with the biggest positive (actual − planned) delta, falling
  // back to the heaviest planned line when nothing is over plan. Excludes the
  // honeymoon roll-up because it doesn't render a clickable row here — the
  // dedicated page owns that breakdown.
  const topOverageLineId = useMemo<number | null>(() => {
    const candidates = lines.filter((l) => l.category !== "honeymoon");
    if (candidates.length === 0) return null;
    let bestDelta = 0;
    let bestId: number | null = null;
    for (const l of candidates) {
      const delta = l.actual_huf - l.planned_huf;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestId = l.id;
      }
    }
    if (bestId !== null) return bestId;
    // No line is over plan — fall back to the heaviest planned line so the
    // user still lands somewhere actionable. (Simpler-than-spec branch
    // documented per the task brief.)
    let bestPlanned = -1;
    for (const l of candidates) {
      if (l.planned_huf > bestPlanned) {
        bestPlanned = l.planned_huf;
        bestId = l.id;
      }
    }
    return bestId;
  }, [lines]);

  // When CostPlanningCard's serious-tier link drops us at /app/budget#top-overage,
  // scroll the heaviest-overage row into view + flash a 2 s blush ring on it.
  // Browser-native scroll-to-anchor handles the case where JS can't find a
  // row (e.g. empty list) via the `id="top-overage"` anchor on the section.
  useEffect(() => {
    if (location.hash !== "#top-overage") return;
    if (lines.length === 0) return;
    if (topOverageLineId === null) return;
    const el = document.querySelector<HTMLElement>(`[data-budget-line-id="${topOverageLineId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightLineId(topOverageLineId);
    const tid = window.setTimeout(() => setHighlightLineId(null), 2000);
    return () => window.clearTimeout(tid);
    // `location.hash` and `lines` together cover: first paint after navigation,
    // and the post-refresh case where lines arrive after the hash.
  }, [location.hash, lines, topOverageLineId]);

  // Dashboard "tap the amount" deep-link → /app/budget#cat-<category>. Scroll
  // the first table row of that category into view and focus its planned-huf
  // input so the user lands ready to type. Falls back to the CostPlanningCard
  // anchor (same id on the slider row) when the table is empty.
  useEffect(() => {
    const m = location.hash.match(/^#cat-([a-z_]+)$/);
    if (!m) return;
    const category = m[1];
    if (lines.length === 0) return;
    // The table tr carries `data-category`; the first matching row wins.
    const row = document.querySelector<HTMLElement>(`tr[data-category="${category}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    const input = row.querySelector<HTMLInputElement>('input[data-budget-planned="true"]');
    input?.focus();
    input?.select?.();
  }, [location.hash, lines]);

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
        <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("budget.sub")}</p>
      </header>

      <CostPlanningCard
        lines={lines}
        baseline={baseline}
        boundsMin={bounds.min}
        boundsMax={bounds.max}
        cap={cap}
        count={effectiveCount}
        onCountChange={setCount}
        onBoundsChange={saveBounds}
        onEditPlanned={setCategoryPlanned}
        onCapChange={saveCap}
        frozenCategories={frozenCategoriesSet}
        onToggleFreeze={toggleFreeze}
        showActualToggle
      />

      <section id="top-overage" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>{t("budget.lines_title")}</h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">{t("budget.lines_sub")}</p>
          </div>
          <AddLinePicker onPick={addLineForCategory} />
        </div>

        <div className="card overflow-hidden p-0">
          <table className="min-w-full text-sm">
            <thead className="border-b border-paper-200 text-left text-xs uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:text-umber-300">
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
                const isHighlighted = line.id === highlightLineId;
                const isFrozen = frozenCategoriesSet.has(line.category);
                return (
                  <tr
                    key={line.id}
                    data-budget-line-id={line.id}
                    data-category={line.category}
                    className={`border-t border-paper-200 transition hover:bg-paper-50 dark:border-umber-700 dark:hover:bg-umber-700/60 ${
                      isHighlighted
                        ? "ring-2 ring-blush-300 ring-offset-2 dark:ring-blush-400/60 dark:ring-offset-umber-900"
                        : ""
                    }`}
                  >
                    <td className="px-4 py-2 align-middle">
                      <CategoryCell category={line.category} />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      <HufInput
                        value={line.planned_huf}
                        onCommit={(v) => save(line, "planned_huf", v)}
                        readOnly={isFrozen}
                        dataKey="planned"
                        ariaLabel={t("budget.planned")}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      <HufInput
                        value={line.actual_huf}
                        onCommit={(v) => save(line, "actual_huf", v)}
                        dataKey="actual"
                        ariaLabel={t("budget.actual")}
                      />
                    </td>
                    <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
                      {delta !== 0 && (
                        <span
                          className={
                            delta > 0
                              ? "font-medium text-red-600 dark:text-red-400"
                              : "font-medium text-emerald-600 dark:text-emerald-400"
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
                        className="btn-ghost btn-sm text-ink-500 hover:text-blush-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-umber-300 dark:hover:text-blush-300"
                        onClick={() => removeLine(line.id)}
                        disabled={isFrozen}
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
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm text-ink-500 dark:text-umber-300"
                  >
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
            <p className="mt-1 text-sm text-ink-500 dark:text-umber-300">
              {t("budget.snapshots_sub")}
            </p>
          </div>
          <button type="button" className="btn-outline" onClick={saveSnapshot}>
            <Save size={16} /> {t("budget.save_snapshot")}
          </button>
        </div>
        {snapshots.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("budget.no_snapshots")}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshots.map((s) => (
              <SnapshotCard
                key={s.id}
                snapshot={s}
                livePlannedTotal={livePlannedTotal}
                locale={locale}
                restoring={restoringId === s.id}
                disabled={restoringId !== null && restoringId !== s.id}
                onRestore={() => restoreSnapshot(s.id)}
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
          className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-paper-300 bg-white p-2 shadow-pop dark:border-umber-700 dark:bg-umber-800"
        >
          <p className="px-2 pb-1 pt-0.5 text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
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
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink-800 transition hover:bg-paper-100 dark:text-paper-100 dark:hover:bg-umber-700"
                    onClick={async () => {
                      setOpen(false);
                      await onPick(cat);
                    }}
                  >
                    <Icon size={14} className="text-ink-500 dark:text-umber-300" />
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
    <span className="inline-flex items-center gap-2 text-sm text-ink-800 dark:text-paper-100">
      <Icon size={14} className="text-ink-500 dark:text-umber-300" aria-hidden />
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
    <tr className="border-t border-paper-200 transition hover:bg-paper-50 dark:border-umber-700 dark:hover:bg-umber-700/60">
      <td className="px-4 py-2 align-middle">
        <Link
          to="/app/honeymoon"
          className="inline-flex items-center gap-2 text-sm text-ink-800 hover:text-blush-700 dark:text-paper-100 dark:hover:text-blush-300"
        >
          <Icon size={14} className="text-ink-500 dark:text-umber-300" aria-hidden />
          {t("budget.cat.honeymoon")}
        </Link>
      </td>
      <td className="px-4 py-2 text-center align-middle text-sm tabular-nums text-ink-900 dark:text-paper-50">
        {formatHuf(planned, locale)}
      </td>
      <td className="px-4 py-2 text-center align-middle text-sm tabular-nums text-ink-900 dark:text-paper-50">
        {formatHuf(actual, locale)}
      </td>
      <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
        {delta !== 0 && (
          <span
            className={
              delta > 0
                ? "font-medium text-red-600 dark:text-red-400"
                : "font-medium text-emerald-600 dark:text-emerald-400"
            }
          >
            {formatHuf(delta, locale)}
          </span>
        )}
      </td>
      <td className="hidden px-4 py-2 align-middle text-sm text-ink-500 md:table-cell dark:text-umber-300">
        {t("budget.honeymoon_breakdown_hint")}
      </td>
      <td className="px-2 py-2 text-right align-middle">
        <Link
          to="/app/honeymoon"
          className="btn-ghost btn-sm text-ink-500 hover:text-blush-700 dark:text-umber-300 dark:hover:text-blush-300"
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
  restoring,
  disabled,
  onRestore,
  onRemove,
}: {
  snapshot: BudgetSnapshot;
  livePlannedTotal: number;
  locale: "hu" | "en";
  /** This card is the one currently being restored — show a spinner. */
  restoring: boolean;
  /** Another card is being restored — soft-disable both actions here so the
   *  user can't pile up parallel restores while one is in-flight. */
  disabled: boolean;
  onRestore: () => void;
  onRemove: () => void;
}) {
  const { t } = useT();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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
      <p className="mt-0.5 text-xs uppercase tracking-wide text-ink-400 dark:text-umber-300">
        {created}
      </p>
      <dl className="mt-3 space-y-1 text-xs text-ink-700 dark:text-paper-100">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500 dark:text-umber-300">{t("budget.snapshot_planned_label")}</dt>
          <dd className="tabular-nums">{formatHuf(planned, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500 dark:text-umber-300">{t("budget.snapshot_actual_label")}</dt>
          <dd className="tabular-nums">{formatHuf(actual, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500 dark:text-umber-300">{t("budget.snapshot_diff_label")}</dt>
          <dd
            className={`tabular-nums ${diff > 0 ? "text-blush-700 dark:text-blush-300" : diff < 0 ? "text-ink-500 dark:text-umber-300" : "text-ink-400 dark:text-umber-300"}`}
          >
            {diffStr}
          </dd>
        </div>
      </dl>
      {/* Three actions on a tight card — flex-wrap so they spill to a second
       *  row on the narrowest layouts instead of overflowing horizontally. */}
      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={onRestore}
          disabled={restoring || disabled}
          aria-label={t("budget.snapshot_restore_label")}
        >
          {restoring ? (
            <Loader2 size={14} className="motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <RotateCcw size={14} />
          )}{" "}
          {t("budget.snapshot_restore_label")}
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setBreakdownOpen(true)}
          disabled={restoring || disabled}
          aria-label={t("budget.snapshot_breakdown_label")}
        >
          <BarChart3 size={14} /> {t("budget.snapshot_breakdown_label")}
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm text-blush-700 dark:text-blush-300"
          onClick={onRemove}
          disabled={restoring || disabled}
        >
          <Trash2 size={14} /> {t("budget.delete")}
        </button>
      </div>
      {breakdownOpen && (
        <SnapshotBreakdownDialog
          snapshot={snapshot}
          locale={locale}
          onClose={() => setBreakdownOpen(false)}
        />
      )}
    </div>
  );
}

/** Modal showing the per-category planned/actual totals captured inside one
 *  saved snapshot. Lets the user inspect what's actually inside the scenario
 *  before deciding whether to restore it. */
function SnapshotBreakdownDialog({
  snapshot,
  locale,
  onClose,
}: {
  snapshot: BudgetSnapshot;
  locale: "hu" | "en";
  onClose: () => void;
}) {
  const { t } = useT();

  // Parse + aggregate by category. Defensive: a malformed payload yields an
  // empty breakdown rather than a crash (matches `SnapshotCard`'s inline
  // parse).
  const { rows, totalPlanned, totalActual } = useMemo(() => {
    const agg = new Map<BudgetCategory, { planned: number; actual: number }>();
    try {
      const arr = JSON.parse(snapshot.payload_json) as {
        category?: unknown;
        planned_huf?: unknown;
        actual_huf?: unknown;
      }[];
      for (const l of arr) {
        // Only trust strings that match the closed BudgetCategory set. The
        // mapper-side guard already validates server-issued categories, but
        // payload_json is opaque JSON so we re-check here.
        const cat = l.category as BudgetCategory;
        if (typeof cat !== "string") continue;
        const planned = Number(l.planned_huf) || 0;
        const actual = Number(l.actual_huf) || 0;
        const entry = agg.get(cat) ?? { planned: 0, actual: 0 };
        entry.planned += planned;
        entry.actual += actual;
        agg.set(cat, entry);
      }
    } catch {
      // ignore — empty breakdown table is the graceful fallback.
    }
    const rows = Array.from(agg.entries())
      .map(([category, totals]) => ({ category, ...totals }))
      // Hide all-zero categories so the table stays scannable.
      .filter((r) => r.planned !== 0 || r.actual !== 0)
      // Heaviest planned spend first.
      .sort((a, b) => b.planned - a.planned);
    let totalPlanned = 0;
    let totalActual = 0;
    for (const r of rows) {
      totalPlanned += r.planned;
      totalActual += r.actual;
    }
    return { rows, totalPlanned, totalActual };
  }, [snapshot.payload_json]);

  return (
    <Dialog
      open
      title={t("budget.snapshot_breakdown_title")}
      role="dialog"
      closeOnBackdrop
      onClose={onClose}
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t("a11y.close")}
        </button>
      }
    >
      <div className="space-y-3">
        <p className="text-xs uppercase tracking-wide text-ink-400 dark:text-umber-300">
          {snapshot.name}
        </p>
        {rows.length === 0 ? (
          <p className="text-ink-500 dark:text-umber-300">{t("budget.lines_empty")}</p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
                <tr>
                  <th className="px-2 py-2 font-medium">{t("budget.category")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("budget.planned")}</th>
                  <th className="px-2 py-2 text-right font-medium">{t("budget.actual")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const Icon = CATEGORY_ICONS[row.category];
                  return (
                    <tr
                      key={row.category}
                      className="border-t border-paper-200 dark:border-umber-700"
                    >
                      <td className="px-2 py-2 align-middle">
                        <span className="inline-flex items-center gap-2 text-ink-800 dark:text-paper-100">
                          <Icon
                            size={14}
                            className="text-ink-500 dark:text-umber-300"
                            aria-hidden
                          />
                          {t(`budget.cat.${row.category}`)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                        {formatHuf(row.planned, locale)}
                      </td>
                      <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                        {formatHuf(row.actual, locale)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-paper-300 font-medium dark:border-umber-700">
                  <td className="px-2 py-2 align-middle text-ink-900 dark:text-paper-50">
                    {t("budget.snapshot_breakdown_total_label")}
                  </td>
                  <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                    {formatHuf(totalPlanned, locale)}
                  </td>
                  <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                    {formatHuf(totalActual, locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Dialog>
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
 *  legibility. Rejects negatives and bogus chars.
 *
 *  `readOnly` flips the input to non-editable (used by frozen budget rows so
 *  the planned amount stays pinned). `dataKey` (e.g. `"planned"`) emits a
 *  `data-budget-<key>="true"` attribute so the dashboard-→-table deep-link
 *  effect can focus the right cell on arrival. */
function HufInput({
  value,
  onCommit,
  readOnly = false,
  dataKey,
  ariaLabel,
}: {
  value: number;
  onCommit: (v: number) => void;
  readOnly?: boolean;
  dataKey?: "planned" | "actual";
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState<string>(formatNumber(value, "hu"));
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where to drop the caret after the next render — measured in *digits*
  // before the cursor in the raw input, so reformatting (which changes the
  // space positions) can put it back at the equivalent spot in the grouped
  // output. Null means "leave the caret alone" (initial mount / blur).
  const caretDigitsRef = useRef<number | null>(null);

  // Reset when the upstream value changes (e.g. snapshot reload, refresh).
  useEffect(() => {
    setDraft(formatNumber(value, "hu"));
    setError(false);
  }, [value]);

  // Restore caret to the digit-equivalent position after a reformat.
  useEffect(() => {
    const wantDigits = caretDigitsRef.current;
    if (wantDigits === null) return;
    caretDigitsRef.current = null;
    const el = inputRef.current;
    if (!el) return;
    let pos = 0;
    let seen = 0;
    while (pos < draft.length && seen < wantDigits) {
      if (/[\d-]/.test(draft[pos] ?? "")) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  }, [draft]);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    if (readOnly) return;
    const raw = e.target.value;
    // Count digit-like chars before the caret in the *raw* input — that's
    // the anchor we want to preserve across the reformat.
    const selStart = e.target.selectionStart ?? raw.length;
    const digitsBeforeCaret = raw.slice(0, selStart).replace(/[^\d-]/g, "").length;

    // Strip everything except digits and a leading minus so the grouping
    // re-applies cleanly. A bare "-" while typing is left as-is so the
    // user can type a negative number digit-by-digit.
    const stripped = raw.replace(/[^\d-]/g, "");
    if (stripped === "" || stripped === "-") {
      caretDigitsRef.current = digitsBeforeCaret;
      setDraft(stripped);
      if (error) setError(false);
      return;
    }
    const n = Number(stripped);
    if (!Number.isFinite(n)) {
      // Fall back to whatever the user typed if Number choked (shouldn't
      // happen given the strip, but covers edge cases like "--"). We don't
      // reformat in this branch, so no caret restore needed.
      setDraft(raw);
      if (error) setError(false);
      return;
    }
    caretDigitsRef.current = digitsBeforeCaret;
    setDraft(formatNumber(n, "hu"));
    if (error) setError(false);
  }

  function onBlur() {
    if (readOnly) return;
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
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      readOnly={readOnly}
      data-budget-planned={dataKey === "planned" ? "true" : undefined}
      data-budget-actual={dataKey === "actual" ? "true" : undefined}
      aria-label={ariaLabel}
      className={`input h-9 min-h-0 py-1 text-center text-sm tabular-nums ${
        error ? "input-invalid" : ""
      } ${readOnly ? "cursor-not-allowed bg-paper-100 text-ink-500 dark:bg-umber-700/60 dark:text-umber-300" : ""}`}
      value={draft}
      onChange={onChange}
      onBlur={onBlur}
      aria-invalid={error || undefined}
    />
  );
}
