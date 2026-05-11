// Per-card "Tervezett / Tényleges" cost inputs. Both fields are integer Forint;
// blur triggers an upsert against /api/couples/supplier-costs/:supplier_id.
// A subtle "Mentve" indicator flashes for ~1.5s after a successful save.

import type { CoupleSupplierCost } from "@shared/supplier_costs";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { supplierCostApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";

type Props = {
  supplierId: string;
  initial: CoupleSupplierCost | undefined;
  onSaved: (cost: CoupleSupplierCost) => void;
};

/** Strip everything that isn't a digit, then parse. Empty → 0. */
function parseHufInput(raw: string): number {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Display helper: 1234567 → "1 234 567". Empty string for 0 so the field
 *  doesn't show a confusing "0" placeholder. */
function formatHuf(n: number): string {
  if (n <= 0) return "";
  return n.toLocaleString("hu-HU");
}

export function SupplierCostRow({ supplierId, initial, onSaved }: Props) {
  const { t } = useT();
  const [planned, setPlanned] = useState(formatHuf(initial?.planned_huf ?? 0));
  const [actual, setActual] = useState(formatHuf(initial?.actual_huf ?? 0));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  // Hold the last server-side values so we can short-circuit no-op saves
  // (e.g. blur without any edit).
  const lastSyncedRef = useRef({
    planned: initial?.planned_huf ?? 0,
    actual: initial?.actual_huf ?? 0,
  });

  // Reload when the initial value changes (e.g. after async list fetch).
  useEffect(() => {
    if (!initial) return;
    setPlanned(formatHuf(initial.planned_huf));
    setActual(formatHuf(initial.actual_huf));
    lastSyncedRef.current = {
      planned: initial.planned_huf,
      actual: initial.actual_huf,
    };
  }, [initial]);

  // Tick down the "Saved" indicator after a beat.
  useEffect(() => {
    if (!savedAt) return;
    const t = window.setTimeout(() => setSavedAt(0), 1500);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  async function commit() {
    const plannedNum = parseHufInput(planned);
    const actualNum = parseHufInput(actual);
    if (
      plannedNum === lastSyncedRef.current.planned &&
      actualNum === lastSyncedRef.current.actual
    ) {
      // Reformat the field in case the user typed "1234" (no spaces).
      setPlanned(formatHuf(plannedNum));
      setActual(formatHuf(actualNum));
      return;
    }
    setSaving(true);
    try {
      const r = await supplierCostApi.upsert(supplierId, {
        planned_huf: plannedNum,
        actual_huf: actualNum,
        notes: initial?.notes ?? null,
      });
      lastSyncedRef.current = {
        planned: r.cost.planned_huf,
        actual: r.cost.actual_huf,
      };
      setPlanned(formatHuf(r.cost.planned_huf));
      setActual(formatHuf(r.cost.actual_huf));
      setSavedAt(Date.now());
      onSaved(r.cost);
    } catch (e) {
      // Revert to last known good — the input would otherwise stay in a
      // misleading "looks edited" state.
      setPlanned(formatHuf(lastSyncedRef.current.planned));
      setActual(formatHuf(lastSyncedRef.current.actual));
      if (e instanceof ApiError) {
        console.warn("[supplier-cost] save failed", e.status, e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  const suffix = t("suppliers.cost_currency_suffix");

  return (
    <div className="mt-4 grid grid-cols-2 gap-2 border-t border-paper-200 pt-3">
      <CostField
        id={`cost-planned-${supplierId}`}
        label={t("suppliers.cost_planned_label")}
        suffix={suffix}
        value={planned}
        onChange={setPlanned}
        onBlur={commit}
        disabled={saving}
      />
      <CostField
        id={`cost-actual-${supplierId}`}
        label={t("suppliers.cost_actual_label")}
        suffix={suffix}
        value={actual}
        onChange={setActual}
        onBlur={commit}
        disabled={saving}
      />
      <p
        className="col-span-2 flex h-4 items-center gap-1 text-[10px] uppercase tracking-wide text-ink-400"
        aria-live="polite"
      >
        {savedAt ? (
          <span className="inline-flex items-center gap-1 text-blush-700">
            <Check size={11} /> {t("suppliers.cost_saved_indicator")}
          </span>
        ) : (
          t("suppliers.cost_help")
        )}
      </p>
    </div>
  );
}

function CostField({
  id,
  label,
  suffix,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-500">
        {label}
      </span>
      <span className="relative block">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          className="input h-9 pr-9 text-right text-sm tabular-nums"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          placeholder="0"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">
          {suffix}
        </span>
      </span>
    </label>
  );
}
