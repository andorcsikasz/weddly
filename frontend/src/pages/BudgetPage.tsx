// Budget planner. Hero "cost planning" panel with a guest-count slider that
// re-prices per-guest categories live, plus an inline-editable line table.

import type { CoupleSupplier } from "@shared/couple_suppliers";
import {
  type BudgetCategory,
  type BudgetDocument,
  type BudgetLine,
  type BudgetPayment,
  type BudgetSnapshot,
  type Couple,
  type Currency,
  CURRENCIES,
} from "@shared/types";
import {
  ArrowUpRight,
  BarChart3,
  CircleCheck,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  Receipt,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  CATEGORY_ICONS,
  CostPlanningCard,
  CUSTOM_ICON_CHOICES,
  PER_GUEST_CATEGORIES,
  resolveCustomIcon,
} from "../components/CostPlanningCard";
import { IncomeSection } from "../components/IncomeSection";
import { InfoHint } from "../components/InfoHint";
import { Dialog, SegmentedControl, useConfirm, useEntryPrompt, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import {
  applyCategoryActual,
  applyCategoryPaid,
  applyCategoryPlanned,
  guestCountBaseline,
  guestCountBounds,
} from "../lib/budget";
import {
  hydrateCostPlanningCount,
  readCostPlanningCount,
  subscribeCostPlanningCount,
  writeCostPlanningCount,
} from "../lib/cost_planning";
import {
  budgetApi,
  budgetDocApi,
  budgetPaymentApi,
  coupleApi,
  coupleSupplierApi,
} from "../lib/endpoints";
import { currencySymbol, formatDateMs, formatMoney, formatNumber, todayIso } from "../lib/format";
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

/** Filename-friendly slug. "Allie & Noah" → "Allie-Noah". Strips diacritics so
 *  HU names like "Réka & Márton" become "Reka-Marton". */
function slugifyName(raw: string): string {
  const cleaned = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "wedding";
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
  // Uploaded invoices / receipts, keyed by scope below. Loaded alongside the
  // lines so the bill icon can show its count badge without a per-row fetch.
  const [documents, setDocuments] = useState<BudgetDocument[]>([]);
  // Timestamped payment ledger behind the PAID column, keyed by scope below.
  // Loaded alongside the lines so the record-payment dialog can show history
  // without a per-row fetch.
  const [budgetPayments, setBudgetPayments] = useState<BudgetPayment[]>([]);
  const [couple, setCouple] = useState<Couple | null>(null);
  // DIY/booked suppliers — only their payment schedules matter here, for the
  // "Payments due" roll-up band above the budget table.
  const [coupleSuppliers, setCoupleSuppliers] = useState<CoupleSupplier[]>([]);
  // Slider state lives here so saveSnapshot() can read the current scenario
  // headcount and seed the snapshot-name suggestion.
  const [count, setCount] = useState<number | null>(null);
  /** Snapshot id currently being restored — disables both action buttons on
   *  the affected card and shows an inline spinner. Null when idle. */
  const [restoringId, setRestoringId] = useState<number | null>(null);
  async function refresh() {
    const [linesR, snapsR, coupleR, suppliersR, docsR, paymentsR] = await Promise.all([
      budgetApi.listLines(),
      budgetApi.listSnapshots(),
      coupleApi.current(),
      coupleSupplierApi.list(),
      budgetDocApi.list(),
      budgetPaymentApi.list(),
    ]);
    setLines(linesR.lines);
    setSnapshots(snapsR.snapshots);
    setCouple(coupleR.couple);
    setCoupleSuppliers(suppliersR.suppliers ?? []);
    setDocuments(docsR.documents);
    setBudgetPayments(paymentsR.payments);
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

  // Re-pull just the documents after an upload / delete — cheaper than a full
  // refresh and keeps the user's in-flight amount edits untouched.
  const reloadDocuments = useCallback(async () => {
    try {
      const r = await budgetDocApi.list();
      setDocuments(r.documents);
    } catch {
      // Non-fatal — the next full refresh will reconcile.
    }
  }, []);

  // Group documents by their scope ('cat:<category>' | 'line:<id>') so each
  // PaidCell can hand its bill icon the matching subset in O(1).
  const docsByScope = useMemo(() => {
    const map = new Map<string, BudgetDocument[]>();
    for (const doc of documents) {
      const list = map.get(doc.scope);
      if (list) list.push(doc);
      else map.set(doc.scope, [doc]);
    }
    return map;
  }, [documents]);

  // Re-pull just the payment ledger after a record / edit / delete — cheaper
  // than a full refresh and keeps in-flight amount edits untouched.
  const reloadPayments = useCallback(async () => {
    try {
      const r = await budgetPaymentApi.list();
      setBudgetPayments(r.payments);
    } catch {
      // Non-fatal — the next full refresh will reconcile.
    }
  }, []);

  // Group payments by scope ('cat:<category>' | 'line:<id>') so each PaidCell
  // can hand its dialog the matching history in O(1).
  const paymentsByScope = useMemo(() => {
    const map = new Map<string, BudgetPayment[]>();
    for (const p of budgetPayments) {
      const list = map.get(p.scope);
      if (list) list.push(p);
      else map.set(p.scope, [p]);
    }
    return map;
  }, [budgetPayments]);

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

  // Mirror perf-critical state into refs so the callbacks below can be
  // identity-stable via `useCallback([])`. Without this, every headcount
  // slider tick would change the callbacks' identity (because they close
  // over `lines` / `effectiveCount` / etc.), defeating React.memo on the
  // CategoryRow / CustomRow components inside CostPlanningCard.
  const linesRef = useRef(lines);
  const coupleRef = useRef(couple);
  const baselineRef = useRef(baseline);
  const effectiveCountRef = useRef(effectiveCount);
  useEffect(() => {
    linesRef.current = lines;
    coupleRef.current = couple;
    baselineRef.current = baseline;
    effectiveCountRef.current = effectiveCount;
  });

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

  async function save(
    line: BudgetLine,
    key: "planned_huf" | "actual_huf" | "paid_huf",
    val: number,
  ) {
    // Functional updater so stale-closure callers (e.g. the useCallback'd
    // setCustomRowPlanned) still see the latest lines.
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, [key]: val } : l)));
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
    setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, notes: nextNotes } : l)));
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

  const addCustomRow = useCallback(async function addCustomRow(
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) {
    try {
      const r = await budgetApi.createLine({
        category: "other",
        label,
        planned_huf: plannedHuf,
        actual_huf: 0,
        per_guest: options?.perGuest ?? false,
        icon: options?.icon ?? null,
      });
      setLines((prev) => [...prev, r.line]);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => addCustomRow(label, plannedHuf, options));
    }
  }, []);

  const setCustomRowPlanned = useCallback(async function setCustomRowPlanned(
    lineId: number,
    plannedHuf: number,
  ) {
    const line = linesRef.current.find((l) => l.id === lineId);
    if (!line) return;
    await save(line, "planned_huf", plannedHuf);
  }, []);

  const removeCustomRow = useCallback(async function removeCustomRow(lineId: number) {
    await removeLine(lineId);
  }, []);

  /** Aggregated "Egyéb" needs the same scaling math as the widget slider, but
   *  without dragging the custom rows along — they share `category === "other"`
   *  but live as their own rows in the table and would jump every time the
   *  user tweaks the Egyéb aggregate otherwise. The widget's CostPlanningCard
   *  uses the localised default label to identify custom rows; mirror that
   *  here so the two views stay in lockstep. */
  const isDefaultOtherLine = (line: BudgetLine) => line.label === "Egyéb" || line.label === "Other";

  // Wrapped in useCallback so React.memo on the CostPlanningCard rows can
  // skip re-renders when only the headcount slider moves. `lines` and `t`
  // are stable during a drag (only `count` changes), so the callback
  // identity holds for the duration of the drag.
  const setAggregatedPlanned = useCallback(
    async function setAggregatedPlanned(category: BudgetCategory, newTotal: number) {
      try {
        const next = await applyCategoryPlanned(
          category,
          newTotal,
          lines,
          t(`budget.cat.${category}`),
          category === "other" ? isDefaultOtherLine : undefined,
        );
        setLines(next);
        publish("budget:changed");
      } catch (e) {
        handleSaveError(e, () => setAggregatedPlanned(category, newTotal));
      }
    },
    [lines, t],
  );

  const setAggregatedActual = useCallback(
    async function setAggregatedActual(category: BudgetCategory, newTotal: number) {
      try {
        const next = await applyCategoryActual(
          category,
          newTotal,
          lines,
          t(`budget.cat.${category}`),
          category === "other" ? isDefaultOtherLine : undefined,
        );
        setLines(next);
        publish("budget:changed");
      } catch (e) {
        handleSaveError(e, () => setAggregatedActual(category, newTotal));
      }
    },
    [lines, t],
  );

  const setAggregatedPaid = useCallback(
    async function setAggregatedPaid(category: BudgetCategory, newTotal: number) {
      try {
        const next = await applyCategoryPaid(
          category,
          newTotal,
          lines,
          category === "other" ? isDefaultOtherLine : undefined,
        );
        setLines(next);
        publish("budget:changed");
      } catch (e) {
        handleSaveError(e, () => setAggregatedPaid(category, newTotal));
      }
    },
    [lines],
  );

  async function removeAllInCategory(category: BudgetCategory) {
    const candidates =
      category === "other"
        ? lines.filter(
            (l) => l.category === "other" && isDefaultOtherLine(l) && l.couple_supplier_id === null,
          )
        : lines.filter((l) => l.category === category && l.couple_supplier_id === null);
    if (candidates.length === 0) return;
    const ok = await confirm({
      title: t("common.confirm_delete_title"),
      body: t("common.confirm_delete_body"),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await Promise.all(candidates.map((l) => budgetApi.removeLine(l.id)));
      const removed = new Set(candidates.map((l) => l.id));
      setLines((prev) => prev.filter((l) => !removed.has(l.id)));
      publish("budget:changed");
    } catch {
      const r = await budgetApi.listLines();
      setLines(r.lines);
    }
  }

  const saveCap = useCallback(async function saveCap(newCapHuf: number) {
    try {
      const r = await coupleApi.update({
        budget_goal: { kind: "exact", exact_huf: newCapHuf, min_huf: null, max_huf: null },
      });
      setCouple(r.couple);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => saveCap(newCapHuf));
    }
  }, []);

  const saveBounds = useCallback(async function saveBounds(min: number, max: number) {
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
  }, []);

  /** Toggle the cost-planning headcount lock. Persists alongside the live
   *  count so the next time the page mounts the slider stays where the
   *  user left it. We also pin the active drag-display count into
   *  `planning_count` on lock so a partner opening the page on a fresh
   *  device sees the same number rather than the legacy baseline. */
  const toggleCountLock = useCallback(async () => {
    const c = coupleRef.current;
    if (!c) return;
    const next = !c.planning_count_locked;
    const liveCount = effectiveCountRef.current;
    try {
      const r = await coupleApi.update(
        next
          ? { planning_count_locked: true, planning_count: liveCount }
          : { planning_count_locked: false },
      );
      setCouple(r.couple);
      publish("budget:changed");
    } catch (e) {
      handleSaveError(e, () => toggleCountLock());
    }
  }, []);

  // Reads through refs so identity stays stable across headcount-slider
  // drags (where `effectiveCount` would otherwise change every tick).
  const toggleFreeze = useCallback(
    async function toggleFreeze(category: BudgetCategory) {
      const couple = coupleRef.current;
      if (!couple) return;
      const lines = linesRef.current;
      const baseline = baselineRef.current;
      const effectiveCount = effectiveCountRef.current;
      const current = couple.frozen_categories ?? [];
      const willFreeze = !current.includes(category);
      const next = willFreeze ? [...current, category] : current.filter((c) => c !== category);
      const factor = baseline > 0 ? effectiveCount / baseline : 1;
      const rewriteLines = PER_GUEST_CATEGORIES.has(category) && factor !== 1;
      const sumFor = (ls: BudgetLine[]) =>
        ls.filter((l) => l.category === category).reduce((s, l) => s + l.planned_huf, 0);
      try {
        // Freeze: pin the displayed total (scaled) into planned_huf so the
        // lock captures what the user sees. Must precede the flag flip —
        // PATCH on a frozen line is rejected when planned_huf changes.
        if (willFreeze && rewriteLines) {
          const displayed = Math.round(sumFor(lines) * factor);
          if (displayed > 0) {
            const upd = await applyCategoryPlanned(
              category,
              displayed,
              lines,
              t(`budget.cat.${category}`),
            );
            setLines(upd);
          }
        }
        const r = await coupleApi.update({ frozen_categories: next });
        setCouple(r.couple);
        // Unfreeze: planned_huf still holds the displayed total written on the
        // prior freeze. Scaling is about to resume, so divide by factor to
        // cancel it — otherwise the display jumps by × factor on unfreeze.
        // Has to run AFTER the flag flips for the same frozen-line guard.
        if (!willFreeze && rewriteLines) {
          const cur = sumFor(linesRef.current);
          if (cur > 0) {
            const perBaseline = Math.round(cur / factor);
            const upd = await applyCategoryPlanned(
              category,
              perBaseline,
              linesRef.current,
              t(`budget.cat.${category}`),
            );
            setLines(upd);
          }
        }
        publish("budget:changed");
      } catch (e) {
        handleSaveError(e, () => toggleFreeze(category));
      }
    },
    [t],
  );

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
    setLines((prev) => prev.filter((l) => l.id !== id));
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

  // Pre-bucket lines per CATEGORIES entry so the table render is O(N) instead
  // of O(N × 15). Previously every row did its own `lines.filter(...)` pass.
  // `other` is special — only default-labeled "Egyéb" rows aggregate into
  // the "other" bucket; custom rows render as their own rows below.
  const categoryBuckets = useMemo(() => {
    type Bucket = {
      lines: BudgetLine[];
      planned: number;
      actual: number;
      paid: number;
      editable: boolean;
    };
    const map = new Map<BudgetCategory, Bucket>();
    for (const cat of CATEGORIES) {
      map.set(cat, { lines: [], planned: 0, actual: 0, paid: 0, editable: true });
    }
    for (const l of lines) {
      if (l.category === "honeymoon") continue;
      if (l.category === "other" && !(l.label === "Egyéb" || l.label === "Other")) continue;
      const b = map.get(l.category);
      if (!b) continue;
      b.lines.push(l);
      b.planned += l.planned_huf;
      b.actual += l.actual_huf;
      b.paid += l.paid_huf;
      if (l.couple_supplier_id !== null) b.editable = false;
    }
    return map;
  }, [lines]);
  const hasAnyTableRow = tableLines.length > 0 || honeymoonAgg !== null;

  // Sum across every line for the table's footer totals row. Delta only counts
  // rows that have a real actual spend — `actual_huf === 0` means the couple
  // hasn't paid yet, so a "negative delta" there is just the full plan
  // pretending to be an overage. Rolling those into the sum would make the
  // total delta meaningless. Matches the per-row rule below.
  const tableTotals = useMemo(() => {
    let planned = 0;
    let actual = 0;
    let paid = 0;
    let delta = 0;
    for (const l of lines) {
      planned += l.planned_huf;
      actual += l.actual_huf;
      paid += l.paid_huf;
      if (l.actual_huf > 0) delta += l.actual_huf - l.planned_huf;
    }
    // Outstanding = what's been priced but not yet settled. Never negative.
    return { planned, actual, paid, remaining: Math.max(0, actual - paid), delta };
  }, [lines]);

  // Pulled once near the top so every money render below — table, totals,
  // snapshot card, breakdown dialog — shares one source of truth and stays
  // in sync with whatever the couple picked on /app/profile.
  const currency: Currency = couple?.currency ?? "HUF";

  // Mirrors the picker on /app/profile so the couple can switch display
  // currency without leaving /app/budget. Stored amounts keep their integer
  // values — only the symbol re-skins, matching ProfilePage.saveCurrency.
  async function saveCurrency(next: Currency) {
    if (next === currency) return;
    const ok = await confirm({
      title: t("profile.budget_currency_confirm_title"),
      body: t("profile.budget_currency_confirm_body"),
      confirmLabel: t("profile.budget_currency_confirm_yes"),
      cancelLabel: t("common.cancel"),
    });
    if (!ok) return;
    try {
      const r = await coupleApi.update({ currency: next });
      setCouple(r.couple);
      publish("budget:changed");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  // Realized spend across the budget — the denominator for the income
  // "recovered vs spent" report.
  const totalSpentHuf = useMemo(() => lines.reduce((a, l) => a + l.actual_huf, 0), [lines]);

  // "Payments due" roll-up — flattens every supplier's payment schedule into
  // paid-so-far / outstanding / next-due / due-in-30-days. This is the thing
  // that replaces the couple's "by when, how much" spreadsheet.
  const payments = useMemo(() => {
    const all = coupleSuppliers.flatMap((s) =>
      s.installments.map((i) => ({ ...i, supplierName: s.name })),
    );
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    const unpaid = all.filter((i) => !i.paid);
    const paidSum = all.filter((i) => i.paid).reduce((a, i) => a + i.amount_huf, 0);
    const outstanding = unpaid.reduce((a, i) => a + i.amount_huf, 0);
    const dueSoon = unpaid
      .filter((i) => i.due_date && i.due_date <= cutoffIso)
      .reduce((a, i) => a + i.amount_huf, 0);
    const next =
      unpaid.filter((i) => i.due_date).sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0] ??
      null;
    return { count: all.length, paidSum, outstanding, dueSoon, next };
  }, [coupleSuppliers]);

  return (
    <>
      <header
        data-tour-target="budget-header"
        className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="font-grotesk">{t("budget.title")}</h1>
          <InfoHint text={t("budget.sub")} />
        </div>
        <div
          role="radiogroup"
          aria-label={t("profile.budget_currency_label")}
          className="inline-flex shrink-0 overflow-hidden rounded-full border border-ink-200 dark:border-umber-700"
        >
          {CURRENCIES.map((c) => {
            const active = c === currency;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={c}
                onClick={() => saveCurrency(c)}
                className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-ink-900 text-paper-50 dark:bg-paper-50 dark:text-ink-900"
                    : "bg-paper-50 text-ink-600 hover:bg-paper-100 dark:bg-ink-800 dark:text-umber-200 dark:hover:bg-umber-700"
                }`}
              >
                {currencySymbol(c, locale)}
              </button>
            );
          })}
        </div>
      </header>

      {payments.count > 0 && (
        <section
          aria-label={t("budget.payments_due_title")}
          className="mb-6 rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-ink-800 px-4 py-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
              {t("budget.payments_due_title")}
            </h2>
            <InfoHint text={t("budget.payments_due_sub")} />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-500 dark:text-umber-300">
                {t("budget.payments_paid")}
              </dt>
              <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {formatMoney(payments.paidSum, currency, locale === "hu" ? "hu" : "en")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500 dark:text-umber-300">
                {t("budget.payments_outstanding")}
              </dt>
              <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {formatMoney(payments.outstanding, currency, locale === "hu" ? "hu" : "en")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500 dark:text-umber-300">
                {t("budget.payments_due_30")}
              </dt>
              <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {formatMoney(payments.dueSoon, currency, locale === "hu" ? "hu" : "en")}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-500 dark:text-umber-300">
                {t("budget.payments_next")}
              </dt>
              <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
                {payments.next ? (
                  <>
                    {new Date(`${payments.next.due_date}T00:00:00`).toLocaleDateString(
                      locale === "hu" ? "hu-HU" : "en-GB",
                    )}
                    <span className="ml-1 font-normal text-ink-500 dark:text-umber-300">
                      · {payments.next.supplierName}
                    </span>
                  </>
                ) : (
                  <span className="font-normal text-ink-400 dark:text-umber-300">
                    {t("budget.payments_none_dated")}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      <CostPlanningCard
        lines={lines}
        baseline={baseline}
        boundsMin={bounds.min}
        boundsMax={bounds.max}
        cap={cap}
        count={effectiveCount}
        countLocked={couple?.planning_count_locked ?? false}
        onCountLockToggle={toggleCountLock}
        currency={currency}
        onCountChange={setCount}
        onBoundsChange={saveBounds}
        onEditPlanned={setAggregatedPlanned}
        onCapChange={saveCap}
        frozenCategories={frozenCategoriesSet}
        onToggleFreeze={toggleFreeze}
        showActualToggle
        onAddCustomRow={addCustomRow}
        onEditCustomRowPlanned={setCustomRowPlanned}
        onRemoveCustomRow={removeCustomRow}
      />

      <section data-tour-target="budget-lines" className="mt-8">
        <div className="mb-3">
          <h2 className="font-grotesk tracking-tight leading-tight">{t("budget.lines_title")}</h2>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-umber-300">{t("budget.lines_sub")}</p>
        </div>

        {/* Mobile: each line is a stacked card so the planned/actual inputs
            get full width and the delta hugs the category header. Reuses the
            same setter + state as the desktop table. */}
        <div className="space-y-2 md:hidden">
          {CATEGORIES.map((cat) => {
            if (cat === "honeymoon") {
              return (
                <HoneymoonAggregateCard
                  key={cat}
                  planned={honeymoonAgg?.planned ?? 0}
                  actual={honeymoonAgg?.actual ?? 0}
                  locale={locale}
                  currency={currency}
                />
              );
            }
            const bucket = categoryBuckets.get(cat);
            const linesForCat = bucket?.lines ?? [];
            const planned = bucket?.planned ?? 0;
            const actual = bucket?.actual ?? 0;
            const isFrozen = frozenCategoriesSet.has(cat);
            const editable = bucket?.editable ?? true;
            const canDelete = !isFrozen && linesForCat.length > 0 && editable;
            return (
              <BudgetMobileCard
                key={cat}
                id={`cat-${cat}-mobile`}
                category={cat}
                planned={planned}
                actual={actual}
                paid={bucket?.paid ?? 0}
                currency={currency}
                locale={locale}
                // Planned is always read-only at the row level — the slider on
                // the CostPlanningCard above is the single edit surface for
                // "how much we plan to spend on this category". Letting both
                // surfaces edit the same value created a confusing "two
                // sliders for one number" mental glitch (10-agent debate
                // Agent 5). Actual stays editable so the couple can still
                // log real spend per row.
                readOnlyPlanned
                readOnlyActual={!editable}
                canDelete={canDelete}
                scope={`cat:${cat}`}
                documents={docsByScope.get(`cat:${cat}`) ?? []}
                payments={paymentsByScope.get(`cat:${cat}`) ?? []}
                onPlannedCommit={(v) => setAggregatedPlanned(cat, v)}
                onActualCommit={(v) => setAggregatedActual(cat, v)}
                onPaidCommit={(v) => setAggregatedPaid(cat, v)}
                onDocsChanged={reloadDocuments}
                onPaymentsChanged={reloadPayments}
                onDelete={() => removeAllInCategory(cat)}
              />
            );
          })}
          {lines
            .filter((l) => l.category === "other" && !isDefaultOtherLine(l))
            .map((line) => (
              <BudgetMobileCustomCard
                key={line.id}
                line={line}
                currency={currency}
                locale={locale}
                scope={`line:${line.id}`}
                documents={docsByScope.get(`line:${line.id}`) ?? []}
                payments={paymentsByScope.get(`line:${line.id}`) ?? []}
                onPlannedCommit={(v) => save(line, "planned_huf", v)}
                onActualCommit={(v) => save(line, "actual_huf", v)}
                onPaidCommit={(v) => save(line, "paid_huf", v)}
                onDocsChanged={reloadDocuments}
                onPaymentsChanged={reloadPayments}
                onDelete={() => removeLine(line.id)}
              />
            ))}
          <AddCustomRowMobile onAdd={addCustomRow} />
        </div>

        <div data-tour-target="budget-table" className="card hidden overflow-hidden p-0 md:block">
          <table className="min-w-full text-sm">
            <thead className="border-b border-paper-200 text-left text-xs uppercase tracking-wide text-ink-500 dark:border-umber-700 dark:text-umber-300">
              <tr>
                <th className="px-4 py-3 font-medium">{t("budget.category")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("budget.planned")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("budget.actual")}</th>
                <th className="px-4 py-3 text-center font-medium">{t("budget.paid")}</th>
                <th className="hidden px-4 py-3 text-center font-medium sm:table-cell">
                  {t("budget.delta")}
                </th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {CATEGORIES.map((cat) => {
                if (cat === "honeymoon") {
                  // Honeymoon row stays read-only — its breakdown lives on
                  // /app/honeymoon. Render it at the same slot as the widget
                  // even when no honeymoon lines exist (0/0) so the two views
                  // stay element-aligned.
                  return (
                    <HoneymoonAggregateRow
                      key={cat}
                      planned={honeymoonAgg?.planned ?? 0}
                      actual={honeymoonAgg?.actual ?? 0}
                      locale={locale}
                      currency={currency}
                    />
                  );
                }
                // Bucket is precomputed once per `lines` change — see
                // `categoryBuckets` useMemo above. Avoids 15× O(N) filter
                // passes on every BudgetPage re-render.
                const bucket = categoryBuckets.get(cat);
                const linesForCat = bucket?.lines ?? [];
                const planned = bucket?.planned ?? 0;
                const actual = bucket?.actual ?? 0;
                const delta = actual - planned;
                const isFrozen = frozenCategoriesSet.has(cat);
                // Lines from DIY suppliers are read-only here; if a category
                // is entirely supplier-managed the aggregate edit would fail,
                // so disable the inputs in that case.
                const editable = bucket?.editable ?? true;
                const canDelete = !isFrozen && linesForCat.length > 0 && editable;
                return (
                  <tr
                    key={cat}
                    id={`cat-${cat}`}
                    data-category={cat}
                    className="scroll-mt-24 border-t border-paper-200 transition hover:bg-paper-50 dark:border-umber-700 dark:hover:bg-umber-700/60"
                  >
                    <td className="px-4 py-2 align-middle">
                      <CategoryCell category={cat} />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      {/* Planned is read-only at the row level — the per-
                          category slider on the CostPlanningCard above is
                          the single edit surface. See the mirrored mobile
                          card prop comment for the rationale. */}
                      <HufInput
                        value={planned}
                        onCommit={(v) => setAggregatedPlanned(cat, v)}
                        readOnly
                        dataKey="planned"
                        ariaLabel={t("budget.planned")}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      <HufInput
                        value={actual}
                        onCommit={(v) => setAggregatedActual(cat, v)}
                        readOnly={!editable}
                        dataKey="actual"
                        ariaLabel={t("budget.actual")}
                      />
                    </td>
                    <td className="px-4 py-2 align-middle">
                      <PaidCell
                        paid={bucket?.paid ?? 0}
                        actual={actual}
                        readOnly={!editable}
                        scope={`cat:${cat}`}
                        documents={docsByScope.get(`cat:${cat}`) ?? []}
                        payments={paymentsByScope.get(`cat:${cat}`) ?? []}
                        currency={currency}
                        locale={locale}
                        onCommitAmount={(v) => setAggregatedPaid(cat, v)}
                        onDocsChanged={reloadDocuments}
                        onPaymentsChanged={reloadPayments}
                      />
                    </td>
                    <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
                      {actual > 0 && delta !== 0 && (
                        <span
                          className={
                            delta > 0
                              ? "font-medium text-red-600 dark:text-red-400"
                              : "font-medium text-emerald-600 dark:text-emerald-400"
                          }
                        >
                          {formatMoney(delta, currency, locale)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right align-middle">
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-ink-500 hover:text-blush-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-umber-300 dark:hover:text-blush-300"
                        onClick={() => removeAllInCategory(cat)}
                        disabled={!canDelete}
                        aria-label={t("budget.delete")}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {/* Custom rows — `category="other"` lines whose label diverges
               *  from the default. Each is 1:1 with a BudgetLine so the
               *  inputs commit per-line. */}
              {lines
                .filter((l) => l.category === "other" && !isDefaultOtherLine(l))
                .map((line) => {
                  const delta = line.actual_huf - line.planned_huf;
                  return (
                    <tr
                      key={line.id}
                      data-budget-line-id={line.id}
                      data-category="other-custom"
                      className="border-t border-paper-200 transition hover:bg-paper-50 dark:border-umber-700 dark:hover:bg-umber-700/60"
                    >
                      <td className="px-4 py-2 align-middle">
                        <CustomRowLabel icon={line.icon} label={line.label} />
                      </td>
                      <td className="px-4 py-2 align-middle">
                        <HufInput
                          value={line.planned_huf}
                          onCommit={(v) => save(line, "planned_huf", v)}
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
                      <td className="px-4 py-2 align-middle">
                        <PaidCell
                          paid={line.paid_huf}
                          actual={line.actual_huf}
                          readOnly={false}
                          scope={`line:${line.id}`}
                          documents={docsByScope.get(`line:${line.id}`) ?? []}
                          payments={paymentsByScope.get(`line:${line.id}`) ?? []}
                          currency={currency}
                          locale={locale}
                          onCommitAmount={(v) => save(line, "paid_huf", v)}
                          onDocsChanged={reloadDocuments}
                          onPaymentsChanged={reloadPayments}
                        />
                      </td>
                      <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
                        {line.actual_huf > 0 && delta !== 0 && (
                          <span
                            className={
                              delta > 0
                                ? "font-medium text-red-600 dark:text-red-400"
                                : "font-medium text-emerald-600 dark:text-emerald-400"
                            }
                          >
                            {formatMoney(delta, currency, locale)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right align-middle">
                        <button
                          type="button"
                          className="btn-ghost btn-sm text-ink-500 hover:text-blush-700 dark:text-umber-300 dark:hover:text-blush-300"
                          onClick={() => removeLine(line.id)}
                          aria-label={t("budget.delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              <AddCustomRowTr onAdd={addCustomRow} />
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-paper-300 bg-paper-50 font-medium dark:border-umber-600 dark:bg-umber-800/40">
                <td className="px-4 py-3 align-middle text-ink-900 dark:text-paper-50">
                  {t("budget.lines_totals_label")}
                </td>
                <td className="px-4 py-3 text-center align-middle tabular-nums text-ink-900 dark:text-paper-50">
                  {formatMoney(tableTotals.planned, currency, locale)}
                </td>
                <td className="px-4 py-3 text-center align-middle tabular-nums text-ink-900 dark:text-paper-50">
                  {formatMoney(tableTotals.actual, currency, locale)}
                </td>
                <td className="px-4 py-3 text-center align-middle tabular-nums text-ink-900 dark:text-paper-50">
                  {formatMoney(tableTotals.paid, currency, locale)}
                  {tableTotals.remaining > 0 && (
                    <span className="mt-0.5 block text-xs font-normal text-ink-500 dark:text-umber-300">
                      {t("budget.remaining_label", {
                        amount: formatMoney(tableTotals.remaining, currency, locale),
                      })}
                    </span>
                  )}
                </td>
                <td className="hidden px-4 py-3 text-center align-middle tabular-nums sm:table-cell">
                  {tableTotals.delta !== 0 && (
                    <span
                      className={
                        tableTotals.delta > 0
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {formatMoney(tableTotals.delta, currency, locale)}
                    </span>
                  )}
                </td>
                <td className="px-2 py-3" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-grotesk tracking-tight leading-tight">
              {t("budget.snapshots_title")}
            </h2>
            <p className="mt-0.5 text-sm text-ink-500 dark:text-umber-300">
              {t("budget.snapshots_sub")}
            </p>
          </div>
          <button type="button" className="btn-outline shrink-0" onClick={saveSnapshot}>
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
                currency={currency}
                restoring={restoringId === s.id}
                disabled={restoringId !== null && restoringId !== s.id}
                onRestore={() => restoreSnapshot(s.id)}
                onRemove={() => removeSnapshot(s.id)}
              />
            ))}
          </div>
        )}
      </section>

      <IncomeSection currency={currency} totalSpentHuf={totalSpentHuf} />
    </>
  );
}

/* ─── Inline "Új sor" form rendered as the final tbody row ────────── */

/** Custom-row category cell — resolves the stored icon slug via the shared
 *  helper so a row picked an icon in the widget shows up with the same
 *  glyph here. */
function CustomRowLabel({ icon, label }: { icon: string | null; label: string }) {
  const Icon = resolveCustomIcon(icon);
  return (
    <span className="inline-flex items-center gap-2 text-sm text-ink-800 dark:text-paper-100">
      <Icon size={14} className="text-ink-500 dark:text-umber-300" aria-hidden />
      {label}
    </span>
  );
}

/** Mirrors the AddCustomRow affordance in CostPlanningCard but expressed as
 *  a table row so the column structure stays intact. Collapsed by default,
 *  expands inline to a label + amount form when clicked. Carries the same
 *  icon picker the widget exposes so an icon picked here renders both in
 *  this table and in the Élő költségvetés widget above. */
function AddCustomRowTr({
  onAdd,
}: {
  onAdd: (
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) => Promise<void> | void;
}) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [label, setLabel] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [iconSlug, setIconSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setLabel("");
    setAmountDraft("");
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
      await onAdd(trimmed, Math.round(amount), { icon: iconSlug });
      reset();
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <tr className="border-t border-paper-200 dark:border-umber-700">
        <td colSpan={6} className="px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-paper-300 px-2.5 py-1 text-xs text-ink-500 transition hover:border-paper-400 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
          >
            <Plus size={12} aria-hidden />
            {t("budget.add_custom_row")}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-paper-200 dark:border-umber-700">
      <td colSpan={6} className="px-4 py-2">
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
            className="input h-11 min-h-0 flex-1 py-1 text-base sm:h-9 sm:flex-none sm:basis-56 sm:text-sm"
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
        {/* Icon picker — matches the same six-glyph strip the widget's add
         *  form exposes so a row picks the same icon regardless of where
         *  the user opened the form. */}
        <div
          role="radiogroup"
          aria-label={t("budget.custom_row_icon_label")}
          className="mt-2 flex flex-wrap items-center gap-1"
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
                title={t(`budget.custom_row_icon_choice.${slug}` as const)}
                aria-label={t(`budget.custom_row_icon_choice.${slug}` as const)}
                className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 sm:h-7 sm:w-7 ${
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
        {error && (
          <p className="mt-1 text-[11px] text-blush-700 dark:text-blush-300" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
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
type PaidState = "paid" | "partial" | "unpaid";

/** Small circular gauge that fills clockwise to `pct`. Renders a solid check
 *  glyph once fully settled. Tone follows the paid state: grey = nothing,
 *  amber = partial, green = settled. */
function PercentRing({ pct, state }: { pct: number; state: PaidState }) {
  const tone =
    state === "paid"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "partial"
        ? "text-amber-600 dark:text-amber-400"
        : "text-ink-300 dark:text-umber-500";
  if (state === "paid") return <CircleCheck size={18} aria-hidden className={tone} />;
  const size = 18;
  const cx = size / 2;
  const r = 7;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={tone} aria-hidden>
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.25}
      />
      {clamped > 0 && (
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ - dash}`}
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      )}
    </svg>
  );
}

/** Paid cell: two icons, no inline number. The percentage check opens a dialog
 *  to record payments over time (each entry is one payment with a date); the
 *  ring fills to the cumulative fraction. The bill icon attaches invoices /
 *  receipts and shows a count badge. `align` centres the pair under the
 *  centred column header on desktop, or keeps it left-aligned in mobile cards. */
function PaidCell({
  paid,
  actual,
  readOnly,
  align = "center",
  scope,
  documents,
  payments,
  currency,
  locale,
  onCommitAmount,
  onDocsChanged,
  onPaymentsChanged,
}: {
  paid: number;
  actual: number;
  readOnly: boolean;
  align?: "center" | "start";
  scope: string;
  documents: BudgetDocument[];
  payments: BudgetPayment[];
  currency: Currency;
  locale: "hu" | "en";
  onCommitAmount: (v: number) => void;
  onDocsChanged: () => void;
  onPaymentsChanged: () => void;
}) {
  const { t } = useT();
  const [entryOpen, setEntryOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const pct = actual > 0 ? Math.round((Math.min(paid, actual) / actual) * 100) : 0;
  const state: PaidState = actual > 0 && paid >= actual ? "paid" : paid > 0 ? "partial" : "unpaid";
  const docCount = documents.length;
  // "20% + 80%" breakdown for the hover tooltip when there's a recorded history.
  const breakdown =
    actual > 0 && payments.length > 0
      ? payments.map((p) => `${Math.round((p.amount_huf / actual) * 100)}%`).join(" + ")
      : null;
  const ringTitle =
    actual === 0
      ? t("budget.paid_needs_actual")
      : breakdown
        ? `${t("budget.paid")}: ${breakdown} = ${pct}%`
        : `${t("budget.paid")}: ${pct}%`;
  return (
    <div className={`flex items-center gap-1 ${align === "center" ? "justify-center" : ""}`}>
      <button
        type="button"
        disabled={readOnly || actual === 0}
        onClick={() => setEntryOpen(true)}
        aria-label={t("budget.paid_record")}
        title={ringTitle}
        className="inline-flex items-center gap-1 rounded-md px-1 py-1 transition hover:bg-paper-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-umber-700"
      >
        <PercentRing pct={pct} state={state} />
        {state === "partial" && (
          <span className="text-xs font-medium tabular-nums text-amber-600 dark:text-amber-400">
            {pct}%
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => setDocsOpen(true)}
        aria-label={t("budget.docs_title")}
        title={t("budget.docs_title")}
        className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-paper-100 hover:text-ink-700 dark:text-umber-300 dark:hover:bg-umber-700 dark:hover:text-paper-100"
      >
        <Receipt size={16} aria-hidden />
        {docCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-600 px-0.5 text-[9px] font-semibold leading-none text-white">
            {docCount}
          </span>
        )}
      </button>
      {entryOpen && (
        <PaidEntryDialog
          open={entryOpen}
          onClose={() => setEntryOpen(false)}
          paid={paid}
          actual={actual}
          scope={scope}
          payments={payments}
          currency={currency}
          locale={locale}
          onCommitTotal={onCommitAmount}
          onPaymentsChanged={onPaymentsChanged}
        />
      )}
      {docsOpen && (
        <DocumentsDialog
          open={docsOpen}
          onClose={() => setDocsOpen(false)}
          scope={scope}
          documents={documents}
          readOnly={readOnly}
          onChanged={onDocsChanged}
        />
      )}
    </div>
  );
}

/** Convert a `YYYY-MM-DD` date-input value to epoch ms, anchored at local noon
 *  so a timezone shift can never roll the stored day backwards. */
function dateInputToMs(iso: string): number {
  return new Date(`${iso}T12:00:00`).getTime();
}

/** Modal that records payments against a budget row over time. Each entry is one
 *  payment with its own date ("20% paid today"); the list shows the running
 *  breakdown (e.g. 20% + 80% = 100%). The cumulative total is committed back to
 *  the row's `paid_huf` through `onCommitTotal`, so the ring and all budget
 *  maths stay driven by that single value. A read-only "opening balance" row
 *  reconciles any pre-existing paid amount that has no ledger entry. */
function PaidEntryDialog({
  open,
  onClose,
  paid,
  actual,
  scope,
  payments,
  currency,
  locale,
  onCommitTotal,
  onPaymentsChanged,
}: {
  open: boolean;
  onClose: () => void;
  paid: number;
  actual: number;
  scope: string;
  payments: BudgetPayment[];
  currency: Currency;
  locale: "hu" | "en";
  onCommitTotal: (paidHuf: number) => void;
  onPaymentsChanged: () => Promise<void> | void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [mode, setMode] = useState<"pct" | "amount">("pct");
  const [draft, setDraft] = useState<string>("");
  const [date, setDate] = useState<string>(() => todayIso());
  const [busy, setBusy] = useState(false);

  const ledgerSum = payments.reduce((s, p) => s + p.amount_huf, 0);
  // Captured once at mount: any paid amount that predates the ledger (legacy
  // data, or a value set elsewhere) shows as a read-only opening balance so the
  // history always reconciles to the ring.
  const [opening] = useState(() =>
    Math.max(0, paid - payments.reduce((s, p) => s + p.amount_huf, 0)),
  );
  const total = opening + ledgerSum;
  const share = (amt: number) => (actual > 0 ? Math.round((amt / actual) * 100) : 0);
  const totalPct = actual > 0 ? Math.round((Math.min(total, actual) / actual) * 100) : 0;
  const remaining = Math.max(0, actual - total);

  const num = Number(draft.replace(/[^\d]/g, ""));
  const safeNum = Number.isFinite(num) ? num : 0;
  // The entered value is a NEW payment to add, expressed as a % of the row's
  // actual or as a plain amount.
  const increment =
    mode === "pct" ? Math.round((Math.max(0, safeNum) / 100) * actual) : Math.max(0, safeNum);
  const incrementPct = actual > 0 ? Math.round((increment / actual) * 100) : 0;
  const sym = currencySymbol(currency, locale);

  const breakdown = payments.map((p) => `${share(p.amount_huf)}%`);
  if (opening > 0) breakdown.unshift(`${share(opening)}%`);

  async function addPayment() {
    if (busy) return;
    if (increment <= 0) {
      toast.error(t("budget.payment_amount_required"));
      return;
    }
    setBusy(true);
    try {
      await budgetPaymentApi.create({ scope, amount_huf: increment, paid_at: dateInputToMs(date) });
      onCommitTotal(total + increment);
      await onPaymentsChanged();
      setDraft("");
      toast.success(t("budget.payment_added"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function deletePayment(p: BudgetPayment) {
    if (busy) return;
    setBusy(true);
    try {
      await budgetPaymentApi.remove(p.id);
      onCommitTotal(Math.max(0, total - p.amount_huf));
      await onPaymentsChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }
  const groupedDraft = draft.replace(/\B(?=(\d{3})+(?!\d))/g, locale === "hu" ? " " : ",");
  return (
    <Dialog
      open={open}
      role="dialog"
      closeOnBackdrop
      title={t("budget.paid_record")}
      onClose={onClose}
      footer={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t("common.done")}
        </button>
      }
    >
      <div className="space-y-5">
        {/* Running total: the "20% + 80% = 100%" the user asked for. */}
        <div className="rounded-xl border border-paper-200 bg-paper-50 px-4 py-3 text-center dark:border-umber-700 dark:bg-umber-800/50">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.payment_total")}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900 dark:text-paper-50">
            {formatMoney(total, currency, locale)}
            <span className="ml-2 text-sm font-medium text-amber-600 dark:text-amber-400">
              {totalPct}%
            </span>
          </p>
          {breakdown.length > 1 && (
            <p className="mt-0.5 text-xs tabular-nums text-ink-500 dark:text-umber-300">
              {breakdown.join(" + ")} = {totalPct}%
            </p>
          )}
        </div>

        {/* Payment history */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.payment_history")}
          </p>
          {opening === 0 && payments.length === 0 ? (
            <p className="py-2 text-center text-sm text-ink-400 dark:text-umber-400">
              {t("budget.payment_empty")}
            </p>
          ) : (
            <ul className="divide-y divide-paper-200 dark:divide-umber-700">
              {opening > 0 && (
                <li className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="flex items-center gap-2 text-ink-700 dark:text-paper-200">
                    <span className="inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded-full bg-ink-100 px-2 text-xs font-semibold tabular-nums text-ink-600 dark:bg-umber-700 dark:text-umber-100">
                      {share(opening)}%
                    </span>
                    <span className="tabular-nums">{formatMoney(opening, currency, locale)}</span>
                  </span>
                  <span className="text-xs text-ink-400 dark:text-umber-400">
                    {t("budget.payment_opening")}
                  </span>
                </li>
              )}
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2 text-ink-700 dark:text-paper-200">
                    <span className="inline-flex h-6 min-w-[2.75rem] items-center justify-center rounded-full bg-amber-100 px-2 text-xs font-semibold tabular-nums text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">
                      {share(p.amount_huf)}%
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(p.amount_huf, currency, locale)}
                    </span>
                    <span className="truncate text-xs text-ink-400 dark:text-umber-400">
                      {formatDateMs(p.paid_at, locale)}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => deletePayment(p)}
                    aria-label={t("budget.payment_delete")}
                    title={t("budget.payment_delete")}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-400 transition hover:bg-blush-50 hover:text-blush-700 disabled:opacity-40 dark:text-umber-300 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
                  >
                    <Trash2 size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add a payment: enter a % or amount, pick a date, append it. */}
        <div className="space-y-3 rounded-xl border border-paper-200 p-3 dark:border-umber-700">
          <div className="flex items-center justify-between gap-3">
            <SegmentedControl
              ariaLabel={t("budget.paid_unit")}
              value={mode}
              onChange={(m) => {
                if (m === "amount" && mode === "pct")
                  setDraft(increment > 0 ? String(increment) : "");
                else if (m === "pct" && mode === "amount")
                  setDraft(incrementPct > 0 ? String(incrementPct) : "");
                setMode(m);
              }}
              options={[
                { value: "pct", label: "%" },
                { value: "amount", label: sym },
              ]}
            />
            <label className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-umber-300">
              {t("budget.payment_date")}
              <input
                type="date"
                value={date}
                max={todayIso()}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg border border-paper-300 bg-white px-2 py-1 text-sm tabular-nums text-ink-900 outline-none focus:border-umber-500 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100"
                aria-label={t("budget.payment_date")}
              />
            </label>
          </div>
          <input
            type="text"
            inputMode="numeric"
            value={groupedDraft}
            placeholder="0"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            className="w-full rounded-xl border border-paper-300 bg-white px-3 py-3 text-center text-3xl font-semibold tabular-nums text-ink-900 outline-none focus:border-umber-500 dark:border-umber-600 dark:bg-umber-800 dark:text-paper-100 dark:focus:border-umber-300"
            aria-label={mode === "pct" ? t("budget.paid_unit_pct") : t("budget.paid_unit_amount")}
          />
          <p className="text-center text-sm text-ink-500 dark:text-umber-300">
            {mode === "pct"
              ? `= ${formatMoney(increment, currency, locale)}`
              : `= ${incrementPct}%`}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setMode("pct");
                  setDraft(String(p));
                }}
                className="rounded-full border border-paper-300 px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:border-umber-400 hover:text-umber-800 dark:border-umber-600 dark:text-umber-200 dark:hover:border-umber-400 dark:hover:text-paper-50"
              >
                {p}%
              </button>
            ))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => {
                  setMode("amount");
                  setDraft(String(remaining));
                }}
                className="rounded-full border border-umber-300 bg-umber-50 px-3 py-1.5 text-xs font-medium text-umber-800 transition hover:border-umber-400 dark:border-umber-500 dark:bg-umber-700/40 dark:text-umber-100"
              >
                {t("budget.payment_remaining")}
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={busy || increment <= 0}
            onClick={addPayment}
          >
            <Plus size={16} aria-hidden />
            {t("budget.payment_add")}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** Modal listing the invoices / receipts attached to one budget row, with an
 *  upload control and per-document open / delete. PDFs + images, ≤8 MB each. */
function DocumentsDialog({
  open,
  onClose,
  scope,
  documents,
  readOnly,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  scope: string;
  documents: BudgetDocument[];
  readOnly: boolean;
  onChanged: () => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file after a delete
    if (!file) return;
    setBusy(true);
    try {
      await budgetDocApi.upload(scope, file);
      onChanged();
      toast.success(t("budget.docs_uploaded"));
    } catch (err) {
      const code =
        err instanceof ApiError && err.detail && typeof err.detail === "object"
          ? (err.detail as { code?: unknown }).code
          : undefined;
      toast.error(
        code === "file_too_large"
          ? t("budget.docs_too_large")
          : code === "unsupported_type"
            ? t("budget.docs_bad_type")
            : code === "upload_limit"
              ? t("budget.docs_limit")
              : t("budget.docs_upload_failed"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function onOpen(doc: BudgetDocument) {
    // These are private documents: no public URL anymore, so fetch the bytes
    // with the auth token and open the resulting blob. Open the tab BEFORE the
    // await (without noopener so we keep the handle) so popup blockers don't
    // kill it, then point it at the blob.
    const win = window.open("about:blank", "_blank");
    setOpeningId(doc.id);
    try {
      const blob = await budgetDocApi.fetchBlob(doc.id);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else window.location.href = url; // popup blocked — same-tab fallback
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      win?.close();
      toast.error(t("budget.docs_upload_failed"));
    } finally {
      setOpeningId(null);
    }
  }

  async function onDelete(doc: BudgetDocument) {
    const ok = await confirm({
      title: t("budget.docs_delete_confirm_title"),
      body: doc.file_name,
      confirmLabel: t("budget.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await budgetDocApi.remove(doc.id);
      onChanged();
    } catch {
      toast.error(t("budget.docs_upload_failed"));
    }
  }

  return (
    <Dialog
      open={open}
      role="dialog"
      closeOnBackdrop
      title={t("budget.docs_title")}
      onClose={onClose}
      footer={
        <button type="button" className="btn-ghost" onClick={onClose}>
          {t("common.dismiss")}
        </button>
      }
    >
      <div className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("budget.docs_empty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((doc) => {
              const isPdf = doc.mime === "application/pdf";
              return (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 rounded-lg border border-paper-200 px-2.5 py-2 dark:border-umber-700"
                >
                  {isPdf ? (
                    <FileText
                      size={16}
                      className="shrink-0 text-ink-400 dark:text-umber-300"
                      aria-hidden
                    />
                  ) : (
                    <ImageIcon
                      size={16}
                      className="shrink-0 text-ink-400 dark:text-umber-300"
                      aria-hidden
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onOpen(doc)}
                    disabled={openingId === doc.id}
                    className="flex min-w-0 flex-1 items-center gap-1 truncate text-left text-sm text-ink-800 hover:text-blush-700 disabled:opacity-60 dark:text-paper-100 dark:hover:text-blush-300"
                  >
                    <span className="truncate">{doc.file_name}</span>
                    <ExternalLink size={12} className="shrink-0 opacity-60" aria-hidden />
                  </button>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => onDelete(doc)}
                      aria-label={t("budget.delete")}
                      className="shrink-0 text-ink-400 transition hover:text-blush-700 dark:text-umber-300 dark:hover:text-blush-300"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!readOnly && (
          <div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={onPick}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-dashed border-paper-300 px-3 py-2 text-sm font-medium text-ink-600 transition hover:border-blush-300 hover:text-blush-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-umber-600 dark:text-umber-200 dark:hover:text-blush-300"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <Upload size={16} aria-hidden />
              )}
              {t("budget.docs_upload")}
            </button>
            <p className="mt-1.5 text-xs text-ink-400 dark:text-umber-300">
              {t("budget.docs_hint")}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function HoneymoonAggregateRow({
  planned,
  actual,
  locale,
  currency,
}: {
  planned: number;
  actual: number;
  locale: "hu" | "en";
  currency: Currency;
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
        {formatMoney(planned, currency, locale)}
      </td>
      <td className="px-4 py-2 text-center align-middle text-sm tabular-nums text-ink-900 dark:text-paper-50">
        {formatMoney(actual, currency, locale)}
      </td>
      <td className="px-4 py-2 text-center align-middle text-sm text-ink-400 dark:text-umber-300">
        —
      </td>
      <td className="hidden px-4 py-2 text-center align-middle tabular-nums sm:table-cell">
        {actual > 0 && delta !== 0 && (
          <span
            className={
              delta > 0
                ? "font-medium text-red-600 dark:text-red-400"
                : "font-medium text-emerald-600 dark:text-emerald-400"
            }
          >
            {formatMoney(delta, currency, locale)}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-right align-middle">
        <Link
          to="/app/honeymoon"
          className="btn-ghost btn-sm text-ink-500 hover:text-blush-700 dark:text-umber-300 dark:hover:text-blush-300"
          aria-label={t("budget.honeymoon_open_aria")}
          title={t("budget.honeymoon_breakdown_hint")}
        >
          <ArrowUpRight size={14} />
        </Link>
      </td>
    </tr>
  );
}

/* ─── Mobile card variants ────────────────────────────────────────── */

/** Mobile card for a regular category row. Renders the same HufInputs as the
 *  desktop table but stacked vertically so the inputs get full width on a
 *  360 px viewport. Diff lives in the header next to the category name. */
function BudgetMobileCard({
  id,
  category,
  planned,
  actual,
  currency,
  locale,
  paid,
  readOnlyPlanned,
  readOnlyActual,
  canDelete,
  scope,
  documents,
  payments,
  onPlannedCommit,
  onActualCommit,
  onPaidCommit,
  onDocsChanged,
  onPaymentsChanged,
  onDelete,
}: {
  id: string;
  category: BudgetCategory;
  planned: number;
  actual: number;
  paid: number;
  currency: Currency;
  locale: "hu" | "en";
  readOnlyPlanned: boolean;
  readOnlyActual: boolean;
  canDelete: boolean;
  scope: string;
  documents: BudgetDocument[];
  payments: BudgetPayment[];
  onPlannedCommit: (v: number) => void | Promise<void>;
  onActualCommit: (v: number) => void | Promise<void>;
  onPaidCommit: (v: number) => void | Promise<void>;
  onDocsChanged: () => void;
  onPaymentsChanged: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const delta = actual - planned;
  return (
    <article id={id} data-category={category} className="card scroll-mt-24 p-2.5">
      <header className="flex items-start justify-between gap-2">
        <CategoryCell category={category} />
        {/* Delta + bin sit together on the header row so the bin never
         *  earns its own line at the bottom of the card — saving ~36 px
         *  of vertical per category × 13 categories. Icon-only on mobile
         *  per the explicit "icon alone enough" instruction. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {actual > 0 && <DeltaPill delta={delta} currency={currency} locale={locale} />}
          {canDelete && (
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition hover:bg-blush-50 hover:text-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:text-umber-300 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
              onClick={onDelete}
              aria-label={t("budget.delete")}
              title={t("budget.delete")}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {/* Planned + Actual in a 2-col grid on mobile — the prior stacked
          layout had each label+input on its own row, so a 13-category list
          racked up an extra ~200px of vertical scroll. Tightened gaps
          (`mt-2 gap-2 mb-0.5`) cut another ~12 px per card × 13 cards. */}
      <dl className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
        <div className="min-w-0">
          <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.planned")}
          </dt>
          <dd>
            <HufInput
              value={planned}
              onCommit={onPlannedCommit}
              readOnly={readOnlyPlanned}
              dataKey="planned"
              ariaLabel={t("budget.planned")}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.actual")}
          </dt>
          <dd>
            <HufInput
              value={actual}
              onCommit={onActualCommit}
              readOnly={readOnlyActual}
              dataKey="actual"
              ariaLabel={t("budget.actual")}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.paid")}
          </dt>
          <dd>
            <PaidCell
              paid={paid}
              actual={actual}
              readOnly={readOnlyActual}
              align="start"
              scope={scope}
              documents={documents}
              payments={payments}
              currency={currency}
              locale={locale}
              onCommitAmount={onPaidCommit}
              onDocsChanged={onDocsChanged}
              onPaymentsChanged={onPaymentsChanged}
            />
          </dd>
        </div>
      </dl>
    </article>
  );
}

/** Mobile card for a user-added custom line. Same layout as the category
 *  card but with the user's icon + label and an always-on delete button. */
function BudgetMobileCustomCard({
  line,
  currency,
  locale,
  scope,
  documents,
  payments,
  onPlannedCommit,
  onActualCommit,
  onPaidCommit,
  onDocsChanged,
  onPaymentsChanged,
  onDelete,
}: {
  line: BudgetLine;
  currency: Currency;
  locale: "hu" | "en";
  scope: string;
  documents: BudgetDocument[];
  payments: BudgetPayment[];
  onPlannedCommit: (v: number) => void | Promise<void>;
  onActualCommit: (v: number) => void | Promise<void>;
  onPaidCommit: (v: number) => void | Promise<void>;
  onDocsChanged: () => void;
  onPaymentsChanged: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const delta = line.actual_huf - line.planned_huf;
  return (
    <article data-budget-line-id={line.id} data-category="other-custom" className="card p-2.5">
      <header className="flex items-start justify-between gap-2">
        <CustomRowLabel icon={line.icon} label={line.label} />
        {/* Bin lives inline with the delta pill — see BudgetMobileCard
         *  for the rationale. Custom lines are always deletable so the
         *  icon is unconditional here. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {line.actual_huf > 0 && <DeltaPill delta={delta} currency={currency} locale={locale} />}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-400 transition hover:bg-blush-50 hover:text-blush-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 dark:text-umber-300 dark:hover:bg-blush-400/15 dark:hover:text-blush-300"
            onClick={onDelete}
            aria-label={t("budget.delete")}
            title={t("budget.delete")}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <dl className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
        <div className="min-w-0">
          <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.planned")}
          </dt>
          <dd>
            <HufInput
              value={line.planned_huf}
              onCommit={onPlannedCommit}
              dataKey="planned"
              ariaLabel={t("budget.planned")}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.actual")}
          </dt>
          <dd>
            <HufInput
              value={line.actual_huf}
              onCommit={onActualCommit}
              dataKey="actual"
              ariaLabel={t("budget.actual")}
            />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.paid")}
          </dt>
          <dd>
            <PaidCell
              paid={line.paid_huf}
              actual={line.actual_huf}
              readOnly={false}
              align="start"
              scope={scope}
              documents={documents}
              payments={payments}
              currency={currency}
              locale={locale}
              onCommitAmount={onPaidCommit}
              onDocsChanged={onDocsChanged}
              onPaymentsChanged={onPaymentsChanged}
            />
          </dd>
        </div>
      </dl>
    </article>
  );
}

/** Read-only mobile card mirror of HoneymoonAggregateRow. Tapping anywhere
 *  on it routes to /app/honeymoon where the breakdown actually lives. */
function HoneymoonAggregateCard({
  planned,
  actual,
  locale,
  currency,
}: {
  planned: number;
  actual: number;
  locale: "hu" | "en";
  currency: Currency;
}) {
  const { t } = useT();
  const Icon = CATEGORY_ICONS.honeymoon;
  const delta = actual - planned;
  return (
    <Link
      to="/app/honeymoon"
      className="card flex flex-col gap-2 p-3 transition hover:border-blush-300 dark:hover:border-blush-400/60"
      aria-label={t("budget.honeymoon_open_aria")}
    >
      <header className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-sm text-ink-800 dark:text-paper-100">
          <Icon size={14} className="text-ink-500 dark:text-umber-300" aria-hidden />
          {t("budget.cat.honeymoon")}
        </span>
        <ArrowUpRight size={14} className="shrink-0 text-ink-400 dark:text-umber-300" aria-hidden />
      </header>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.planned")}
          </dt>
          <dd className="tabular-nums text-ink-900 dark:text-paper-50">
            {formatMoney(planned, currency, locale)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500 dark:text-umber-300">
            {t("budget.actual")}
          </dt>
          <dd className="tabular-nums text-ink-900 dark:text-paper-50">
            {formatMoney(actual, currency, locale)}
          </dd>
        </div>
      </dl>
      {actual > 0 && delta !== 0 && (
        <DeltaPill delta={delta} currency={currency} locale={locale} className="self-end" />
      )}
    </Link>
  );
}

/** Inline "add custom line" affordance for mobile — `<button>` that toggles
 *  into a stacked form. Mirrors the desktop AddCustomRowTr's contract so the
 *  same `onAdd` callback feeds both. */
function AddCustomRowMobile({
  onAdd,
}: {
  onAdd: (
    label: string,
    plannedHuf: number,
    options?: { perGuest?: boolean; icon?: string | null },
  ) => Promise<void>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [iconSlug, setIconSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setLabel("");
    setAmountDraft("");
    setIconSlug(null);
    setError(null);
    setSaving(false);
  }

  async function commit() {
    const trimmed = label.trim();
    const amount = Number(amountDraft.replace(/\D/g, "") || "0");
    if (!trimmed) {
      setError(t("budget.custom_row_label_placeholder"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed, amount, { icon: iconSlug });
      reset();
    } catch {
      setError(t("common.error_generic"));
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border border-dashed border-paper-300 px-3 py-3 text-sm text-ink-500 transition hover:border-ink-400 hover:text-ink-700 dark:border-umber-700 dark:text-umber-300 dark:hover:border-umber-600 dark:hover:text-paper-100"
      >
        + {t("budget.custom_row_add_aria")}
      </button>
    );
  }

  return (
    <article className="card p-3">
      <label className="block">
        <span className="field-label">{t("budget.custom_row_label_placeholder")}</span>
        <input
          autoFocus
          type="text"
          maxLength={80}
          value={label}
          disabled={saving}
          onChange={(e) => {
            setLabel(e.target.value);
            if (error) setError(null);
          }}
          className="input"
        />
      </label>
      <label className="mt-2 block">
        <span className="field-label">{t("budget.custom_row_amount_placeholder")}</span>
        <input
          type="text"
          inputMode="numeric"
          maxLength={14}
          value={amountDraft}
          disabled={saving}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "");
            setAmountDraft(digits === "" ? "" : formatNumber(Number(digits), "hu"));
          }}
          className="input text-right tabular-nums"
        />
      </label>
      <div
        role="radiogroup"
        aria-label={t("budget.custom_row_icon_label")}
        className="mt-3 flex flex-wrap items-center gap-1"
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
              aria-label={t(`budget.custom_row_icon_choice.${slug}` as const)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blush-200 ${
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
      {error && (
        <p className="mt-2 text-[11px] text-blush-700 dark:text-blush-300" role="alert">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost btn-sm" onClick={reset} disabled={saving}>
          {t("budget.custom_row_cancel")}
        </button>
        <button type="button" className="btn-primary btn-sm" onClick={commit} disabled={saving}>
          {t("budget.custom_row_save")}
        </button>
      </div>
    </article>
  );
}

/** Compact diff chip — colored by sign, hidden when zero. Shared by all
 *  mobile budget cards so the visual treatment is consistent. */
function DeltaPill({
  delta,
  currency,
  locale,
  className = "",
}: {
  delta: number;
  currency: Currency;
  locale: "hu" | "en";
  className?: string;
}) {
  if (delta === 0) return null;
  const positive = delta > 0;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
        positive
          ? "bg-red-50 text-red-700 dark:bg-red-400/15 dark:text-red-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
      } ${className}`}
    >
      {formatMoney(delta, currency, locale)}
    </span>
  );
}

/* ─── Snapshots ────────────────────────────────────────────────────── */

function SnapshotCard({
  snapshot,
  livePlannedTotal,
  locale,
  currency,
  restoring,
  disabled,
  onRestore,
  onRemove,
}: {
  snapshot: BudgetSnapshot;
  livePlannedTotal: number;
  locale: "hu" | "en";
  currency: Currency;
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
  const diffStr = (diff >= 0 ? "+" : "") + formatMoney(diff, currency, locale);

  return (
    <div className="card-hover">
      <h3 className="text-base font-semibold">{snapshot.name}</h3>
      <p className="mt-0.5 text-xs uppercase tracking-wide text-ink-400 dark:text-umber-300">
        {created}
      </p>
      <dl className="mt-3 space-y-1 text-xs text-ink-700 dark:text-paper-100">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500 dark:text-umber-300">{t("budget.snapshot_planned_label")}</dt>
          <dd className="tabular-nums">{formatMoney(planned, currency, locale)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-ink-500 dark:text-umber-300">{t("budget.snapshot_actual_label")}</dt>
          <dd className="tabular-nums">{formatMoney(actual, currency, locale)}</dd>
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
          currency={currency}
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
  currency,
  onClose,
}: {
  snapshot: BudgetSnapshot;
  locale: "hu" | "en";
  currency: Currency;
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
                        {formatMoney(row.planned, currency, locale)}
                      </td>
                      <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                        {formatMoney(row.actual, currency, locale)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t border-paper-300 font-medium dark:border-umber-700">
                  <td className="px-2 py-2 align-middle text-ink-900 dark:text-paper-50">
                    {t("budget.snapshot_breakdown_total_label")}
                  </td>
                  <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                    {formatMoney(totalPlanned, currency, locale)}
                  </td>
                  <td className="px-2 py-2 text-right align-middle tabular-nums text-ink-900 dark:text-paper-50">
                    {formatMoney(totalActual, currency, locale)}
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
  dataKey?: "planned" | "actual" | "paid";
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
