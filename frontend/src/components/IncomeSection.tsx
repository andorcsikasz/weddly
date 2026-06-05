// "Befolyt pénz / Gifts received" — a standalone money-in ledger on the budget
// page. Records cash gifts + contributions and reports how much of the spend
// was recovered. Deliberately gentle (not an ROI calculator): one warm number,
// no link to the guest list, from-whom is optional free text.

import type { CoupleIncome, Currency } from "@shared/types";
import { Gift, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError } from "../lib/api";
import { incomeApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { InfoHint } from "./InfoHint";
import { useConfirm, useToast } from "./ui";

export function IncomeSection({
  currency,
  totalSpentHuf,
}: {
  currency: Currency;
  /** Realized spend (sum of budget actual) to compare the received total against. */
  totalSpentHuf: number;
}) {
  const { t, locale } = useT();
  const loc = locale === "hu" ? "hu" : "en";
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<CoupleIncome[]>([]);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    incomeApi
      .list()
      .then((r) => setItems(r.income ?? []))
      .catch(() => {
        // best-effort — the budget page still works without the ledger
      });
  }, []);

  const received = items.reduce((a, i) => a + i.amount_huf, 0);
  const net = totalSpentHuf - received;
  const recoveredPct = totalSpentHuf > 0 ? Math.round((received / totalSpentHuf) * 100) : 0;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const amt = Math.round(Number(amount));
    if (!trimmedLabel || !Number.isFinite(amt) || amt <= 0 || busy) return;
    setBusy(true);
    try {
      const r = await incomeApi.create({
        label: trimmedLabel,
        amount_huf: amt,
        received_on: receivedOn || null,
      });
      setItems((prev) => [r.income, ...prev]);
      setLabel("");
      setAmount("");
      setReceivedOn("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(item: CoupleIncome) {
    const ok = await confirm({
      title: t("income.delete_confirm_title"),
      body: t("income.delete_confirm_body", { label: item.label }),
      confirmLabel: t("common.confirm_delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await incomeApi.remove(item.id);
    } catch (err) {
      setItems(snapshot);
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    }
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-grotesk">{t("income.title")}</h2>
        <InfoHint text={t("income.sub")} />
      </div>

      {/* Summary — one warm number, no leaderboard. */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-paper-300 bg-paper-50 px-4 py-3 dark:border-umber-700 dark:bg-ink-800 sm:grid-cols-3">
        <Stat label={t("income.received")} value={formatMoney(received, currency, loc)} />
        <Stat label={t("income.spent")} value={formatMoney(totalSpentHuf, currency, loc)} />
        <Stat
          label={net >= 0 ? t("income.net_cost") : t("income.surplus")}
          value={formatMoney(Math.abs(net), currency, loc)}
          hint={received > 0 ? t("income.recovered_pct", { pct: recoveredPct }) : undefined}
        />
      </div>

      <form onSubmit={onAdd} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[8rem]">
          <span className="field-label">{t("income.field_label")}</span>
          <input
            className="input"
            type="text"
            value={label}
            maxLength={120}
            placeholder={t("income.field_label_placeholder")}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="w-28">
          <span className="field-label">{t("income.field_amount")}</span>
          <input
            className="input"
            type="number"
            min={1}
            step={1000}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="w-[9rem]">
          <span className="field-label">{t("income.field_date")}</span>
          <input
            className="input"
            type="date"
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !label.trim() || !(Number(amount) > 0)}
          className="btn-primary inline-flex items-center gap-1.5"
        >
          <Plus size={15} />
          {t("income.add")}
        </button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-paper-300 px-4 py-6 text-center text-sm text-ink-400 dark:border-umber-700 dark:text-umber-300">
          {t("income.empty")}
        </p>
      ) : (
        <ul className="card divide-y divide-paper-200 p-0 dark:divide-umber-700">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5">
              <Gift size={15} aria-hidden className="shrink-0 text-umber-500 dark:text-umber-300" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink-900 dark:text-paper-50">
                  {i.label}
                </span>
                {i.received_on && (
                  <span className="text-xs text-ink-400 dark:text-umber-300">
                    {new Date(`${i.received_on}T00:00:00`).toLocaleDateString(
                      loc === "hu" ? "hu-HU" : "en-GB",
                    )}
                  </span>
                )}
              </span>
              <span className="stat-num shrink-0 text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
                {formatMoney(i.amount_huf, currency, loc)}
              </span>
              <button
                type="button"
                onClick={() => onDelete(i)}
                aria-label={t("income.delete")}
                className="shrink-0 rounded-md p-1 text-ink-400 hover:bg-paper-100 hover:text-blush-600 dark:hover:bg-umber-700"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-500 dark:text-umber-300">{label}</div>
      <div className="stat-num text-sm font-semibold tabular-nums text-ink-900 dark:text-paper-50">
        {value}
      </div>
      {hint && <div className="text-[11px] text-ink-400 dark:text-umber-300">{hint}</div>}
    </div>
  );
}
