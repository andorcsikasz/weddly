// "Befolyt pénz / Gifts received" - a standalone money-in ledger on the budget
// page. Records cash gifts + contributions and reports how much of the spend
// was recovered. Deliberately gentle (not an ROI calculator): one warm number,
// no link to the guest list, from-whom is primarily picked from the guest list
// but free text is always allowed (some contributors aren't guests).
//
// Structure mirrors the private "received gifts" ledger on the wishlist editor:
// auto-growing columnar rows (Kitől / mi · Összeg · Megjegyzés) that persist
// each row on blur - create / update / delete - with no separate add form and
// no date field.

import type { Currency, Guest, Household } from "@shared/types";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { guestApi, householdApi, incomeApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";
import { InfoHint } from "./InfoHint";
import { useToast } from "./ui";

const MAX_LABEL_LEN = 120;
const MAX_NOTE_LEN = 500;
const FROM_LIST_ID = "income-from-suggestions";

interface IncRow {
  key: string;
  id: number | null;
  label: string;
  /** Raw input string; parsed to an integer amount on commit. */
  amount: string;
  note: string;
  updated_at: number | null;
  savedSig: string;
}

/** Parse the amount input to a positive integer, or 0 when blank/invalid. */
function parseAmount(raw: string): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Signature of a row's persistable content (trimmed + normalised amount):
 *  drives change detection. */
function incSig(label: string, amount: string, note: string): string {
  return JSON.stringify([label.trim(), parseAmount(amount), note.trim()]);
}
function incNonEmpty(r: IncRow): boolean {
  return r.label.trim() !== "" || parseAmount(r.amount) > 0 || r.note.trim() !== "";
}
/** A row the backend will accept: both a from-whom label and a positive amount. */
function incComplete(r: IncRow): boolean {
  return r.label.trim() !== "" && parseAmount(r.amount) > 0;
}

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

  const keySeq = useRef(0);
  const nextKey = () => `inc-${keySeq.current++}`;

  const makeEmpty = (): IncRow => ({
    key: nextKey(),
    id: null,
    label: "",
    amount: "",
    note: "",
    updated_at: null,
    savedSig: incSig("", "", ""),
  });

  /** Keep every row up to the last filled one, then ensure a small pad of
   *  trailing empties (always at least 2) to keep typing into. Existing
   *  trailing empties are preserved so a row just tabbed into doesn't remount. */
  function withTail(rows: IncRow[]): IncRow[] {
    let lastFilled = -1;
    rows.forEach((r, i) => {
      if (incNonEmpty(r)) lastFilled = i;
    });
    const filled = rows.slice(0, lastFilled + 1);
    const targetEmpties = Math.max(2, 3 - filled.length);
    const empties = rows.slice(lastFilled + 1).slice(0, targetEmpties);
    while (empties.length < targetEmpties) empties.push(makeEmpty());
    return [...filled, ...empties];
  }

  const [rows, setRows] = useState<IncRow[]>(() => withTail([]));
  const [guests, setGuests] = useState<Guest[]>([]);
  const [households, setHouseholds] = useState<Household[]>([]);

  useEffect(() => {
    incomeApi
      .list()
      .then((r) =>
        setRows(
          withTail(
            (r.income ?? []).map((it) => ({
              key: `inc-init-${it.id}`,
              id: it.id,
              label: it.label,
              amount: String(it.amount_huf),
              note: it.notes ?? "",
              updated_at: it.updated_at,
              savedSig: incSig(it.label, String(it.amount_huf), it.notes ?? ""),
            })),
          ),
        ),
      )
      .catch(() => {
        // best-effort - the budget page still works without the ledger
      });
    // From-whom suggestions: the guest list is the primary source; free text
    // stays allowed for contributors who aren't guests.
    guestApi
      .list()
      .then((r) => setGuests(r.guests ?? []))
      .catch(() => {});
    householdApi
      .list()
      .then((r) => setHouseholds(r.households ?? []))
      .catch(() => {});
  }, []);

  // Households (the groups) and their non-supplier members, de-duplicated and
  // sorted - what the couple picks "Kitől" from. Couple households (the hosts)
  // and supplier guests are excluded; they don't give the couple gifts.
  const fromSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const h of households) if (!h.is_couple_household) names.add(h.label);
    for (const g of guests) if (!g.is_supplier) names.add(g.full_name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [guests, households]);

  const received = rows.reduce((a, r) => (r.id === null ? a : a + parseAmount(r.amount)), 0);
  const net = totalSpentHuf - received;
  const recoveredPct = totalSpentHuf > 0 ? Math.round((received / totalSpentHuf) * 100) : 0;

  function patchRow(key: string, patch: Partial<IncRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /** Persist a row on blur. Creates when a draft gains a label + amount,
   *  updates a changed persisted row, deletes one cleared back to empty. */
  async function commit(key: string) {
    const r = rows.find((x) => x.key === key);
    if (!r) return;
    const sig = incSig(r.label, r.amount, r.note);
    if (sig === r.savedSig) {
      setRows((prev) => withTail(prev));
      return;
    }
    const body = {
      label: r.label.trim(),
      amount_huf: parseAmount(r.amount),
      notes: r.note.trim() || null,
    };
    try {
      if (r.id === null) {
        if (!incComplete(r)) return; // incomplete draft - wait for label + amount
        const res = await incomeApi.create(body);
        patchRow(key, { id: res.income.id, updated_at: res.income.updated_at, savedSig: sig });
        setRows((prev) => withTail(prev));
      } else if (!incNonEmpty(r)) {
        await incomeApi.remove(r.id);
        patchRow(key, { id: null, updated_at: null, savedSig: incSig("", "", "") });
        setRows((prev) => withTail(prev));
      } else if (incComplete(r)) {
        const res = await incomeApi.update(r.id, body);
        patchRow(key, { updated_at: res.income.updated_at, savedSig: sig });
        setRows((prev) => withTail(prev));
      }
      // else: incomplete edit of an existing row - leave the server as-is.
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function removeRow(r: IncRow) {
    if (r.id !== null) {
      try {
        await incomeApi.remove(r.id);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
        return;
      }
    }
    setRows((prev) => withTail(prev.filter((x) => x.key !== r.key)));
  }

  const cellInput =
    "w-full bg-transparent py-2.5 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none dark:text-paper-50 dark:placeholder:text-umber-400";
  const rowBubble =
    "flex items-center gap-3 rounded-2xl border border-paper-200 bg-paper-50 px-4 shadow-sm dark:border-umber-700 dark:bg-ink-800";

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-grotesk">{t("income.title")}</h2>
        <InfoHint text={t("income.sub")} />
      </div>

      {/* Summary - one warm number, no leaderboard. */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-paper-300 bg-paper-50 px-4 py-3 dark:border-umber-700 dark:bg-ink-800 sm:grid-cols-3">
        <Stat label={t("income.received")} value={formatMoney(received, currency, loc)} />
        <Stat label={t("income.spent")} value={formatMoney(totalSpentHuf, currency, loc)} />
        <Stat
          label={net >= 0 ? t("income.net_cost") : t("income.surplus")}
          value={formatMoney(Math.abs(net), currency, loc)}
          hint={received > 0 ? t("income.recovered_pct", { pct: recoveredPct }) : undefined}
        />
      </div>

      {/* Standalone bubble rows: each band is its own rounded card, gaps
          between them, no enclosing table. */}
      <div className="mb-1 flex items-center gap-3 px-4 text-xs font-medium text-ink-500 dark:text-umber-300">
        <span className="min-w-0 flex-1">{t("income.field_label")}</span>
        <span className="w-32 shrink-0">{t("income.field_amount")}</span>
        <span className="min-w-0 flex-1">{t("income.col_note")}</span>
        <span className="w-8 shrink-0" aria-hidden />
      </div>

      <datalist id={FROM_LIST_ID}>
        {fromSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.key} className={rowBubble}>
            <input
              type="text"
              list={FROM_LIST_ID}
              className={`${cellInput} min-w-0 flex-1 font-grotesk`}
              value={r.label}
              maxLength={MAX_LABEL_LEN}
              placeholder={t("income.field_label_placeholder")}
              onChange={(e) => patchRow(r.key, { label: e.target.value })}
              onBlur={() => void commit(r.key)}
            />
            <input
              type="number"
              min={1}
              step={1000}
              inputMode="numeric"
              className={`${cellInput} stat-num w-32 shrink-0 tabular-nums`}
              value={r.amount}
              onChange={(e) => patchRow(r.key, { amount: e.target.value })}
              onBlur={() => void commit(r.key)}
              aria-label={t("income.field_amount")}
            />
            <input
              type="text"
              className={`${cellInput} min-w-0 flex-1 font-grotesk`}
              value={r.note}
              maxLength={MAX_NOTE_LEN}
              onChange={(e) => patchRow(r.key, { note: e.target.value })}
              onBlur={() => void commit(r.key)}
            />
            <div className="flex w-8 shrink-0 justify-center">
              {r.id !== null && (
                <button
                  type="button"
                  aria-label={t("common.remove")}
                  title={t("common.remove")}
                  onClick={() => void removeRow(r)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-blush-700 transition-colors hover:bg-blush-100 dark:text-blush-300 dark:hover:bg-blush-400/15"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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
