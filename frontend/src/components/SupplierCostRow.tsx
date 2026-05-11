// Per-card "Tervezett / Tényleges" row. Both numbers are scoped to the
// supplier's BUDGET CATEGORY — they read from /api/budget/lines and write back
// to the same lines. Tervezett is read-only here (a deep-link to the budget
// page); Tényleges is editable and writes through to the first matching line
// in that category. Two suppliers in the same category share one number — the
// canonical store is the budget, and this card is just a window onto it.

import { Check, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/api";
import { useT } from "../lib/i18n";

type Props = {
  supplierId: string;
  /** Sum of planned_huf across matching budget lines. Source of truth lives
   *  in /app/budget — the card is read-only for this field. */
  plannedHuf: number;
  /** Sum of actual_huf across matching budget lines. */
  actualHuf: number;
  /** True when at least one budget line exists in the matching category.
   *  Disables the actual input + shows a hint when false. */
  hasLine: boolean;
  /** Called when the user commits a new actual value (on blur, debounced
   *  no-op for unchanged values). The parent issues the budgetApi call. */
  onSetActual: (huf: number) => Promise<void>;
};

function parseHufInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatHuf(n: number): string {
  if (n <= 0) return "";
  return n.toLocaleString("hu-HU");
}

export function SupplierCostRow({
  supplierId,
  plannedHuf,
  actualHuf,
  hasLine,
  onSetActual,
}: Props) {
  const { t } = useT();
  const [actual, setActual] = useState(formatHuf(actualHuf));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const lastSyncedRef = useRef(actualHuf);

  // Re-sync when the parent's actualHuf changes (e.g. after another card
  // in the same category writes, or after the initial budget fetch). Keeps
  // every card in the category showing the same number.
  useEffect(() => {
    setActual(formatHuf(actualHuf));
    lastSyncedRef.current = actualHuf;
  }, [actualHuf]);

  useEffect(() => {
    if (!savedAt) return;
    const tid = window.setTimeout(() => setSavedAt(0), 1500);
    return () => window.clearTimeout(tid);
  }, [savedAt]);

  async function commit() {
    const next = parseHufInput(actual);
    if (next === lastSyncedRef.current) {
      // Reformat in case the user typed without spaces, but don't round-trip.
      setActual(formatHuf(next));
      return;
    }
    setSaving(true);
    try {
      await onSetActual(next);
      lastSyncedRef.current = next;
      setActual(formatHuf(next));
      setSavedAt(Date.now());
    } catch (e) {
      setActual(formatHuf(lastSyncedRef.current));
      if (e instanceof ApiError) {
        console.warn("[supplier-cost] save failed", e.status, e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  const suffix = t("suppliers.cost_currency_suffix");
  const plannedDisplay = formatHuf(plannedHuf) || "0";

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-paper-200 pt-3">
      <Link
        to="/app/budget"
        title={t("suppliers.cost_planned_help")}
        aria-label={t("suppliers.cost_planned_help")}
        className="block focus:outline-none"
      >
        <span className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-ink-500">
          <span>{t("suppliers.cost_planned_label")}</span>
          <ExternalLink size={10} aria-hidden className="text-ink-400" />
        </span>
        <span className="relative block">
          <span className="input flex h-9 items-center justify-end gap-1 bg-paper-100 pr-9 text-sm tabular-nums text-ink-700 cursor-pointer hover:bg-paper-200">
            {plannedDisplay}
          </span>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">
            {suffix}
          </span>
        </span>
      </Link>
      <label htmlFor={`cost-actual-${supplierId}`} className="block">
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-500">
          {t("suppliers.cost_actual_label")}
        </span>
        <span className="relative block">
          <input
            id={`cost-actual-${supplierId}`}
            type="text"
            inputMode="numeric"
            className="input h-9 pr-9 text-right text-sm tabular-nums"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            onBlur={commit}
            disabled={saving || !hasLine}
            placeholder="0"
            title={!hasLine ? t("suppliers.cost_no_line_hint") : undefined}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">
            {suffix}
          </span>
        </span>
      </label>
      <p
        className="col-span-2 flex h-4 items-center gap-1 text-[10px] uppercase tracking-wide text-ink-400"
        aria-live="polite"
      >
        {savedAt ? (
          <span className="inline-flex items-center gap-1 text-blush-700">
            <Check size={11} /> {t("suppliers.cost_saved_indicator")}
          </span>
        ) : !hasLine ? (
          t("suppliers.cost_no_line_hint")
        ) : (
          t("suppliers.cost_planned_help")
        )}
      </p>
    </div>
  );
}
