// "Esedékes kifizetések" — every supplier payment schedule from /app/suppliers,
// flattened into one due-date ordered list. The four summary numbers answer
// "where do we stand"; the grouped list under them answers "what do I pay
// next", which until now meant opening each supplier card in turn to read its
// own schedule.
//
// Buckets are cut by DUE DATE, and deliberately by a rolling 7 / 30 days
// rather than "this week": a calendar week and the next seven days disagree
// every Friday, and no label can state both. Undated installments ("balance on
// the day") get their own bucket instead of quietly falling out of the list,
// which is what the summary-only strip used to do to them.
//
// Marking an installment paid here writes through the same endpoint the
// supplier card uses, so the mirrored budget line's actual amount is recomputed
// server-side (see supplier_installments in schema.sql). The caller therefore
// refreshes the whole page after a successful mark.

import type { CoupleSupplier, SupplierInstallment } from "@shared/couple_suppliers";
import type { Currency } from "@shared/types";
import { CircleCheck, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoney, intlLocale, localYmd, todayIso } from "../lib/format";
import { type Locale, useT } from "../lib/i18n";
import { InfoHint } from "./InfoHint";

type Row = SupplierInstallment & { supplierId: string; supplierName: string };

/** Bucket order is render order: what's already late first, the archive last. */
const BUCKETS = ["overdue", "d7", "d30", "later", "undated", "paid"] as const;
type BucketKey = (typeof BUCKETS)[number];

/** Open on first paint. Everything the couple can still act on this month is
 *  expanded; "later" and the paid archive stay folded so a long schedule can't
 *  bury the two buckets that need a decision. */
const OPEN_BY_DEFAULT: BucketKey[] = ["overdue", "d7"];

const BUCKET_LABEL_KEY: Record<BucketKey, string> = {
  overdue: "budget.payments_group_overdue",
  d7: "budget.payments_group_7",
  d30: "budget.payments_due_30",
  later: "budget.payments_group_later",
  undated: "budget.payments_group_undated",
  paid: "budget.payments_group_paid",
};

/** `YYYY-MM-DD` n days from today, read in the LOCAL timezone. Going through
 *  `toISOString()` here would shift the boundary by a day for every evening
 *  user east of UTC, which is most of them. */
function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localYmd(d);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00`).getTime();
  const b = new Date(`${toIso}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function PaymentsDuePanel({
  suppliers,
  currency,
  locale,
  onMarkPaid,
}: {
  suppliers: CoupleSupplier[];
  currency: Currency;
  locale: Locale;
  /** Resolves once the server has recorded the payment. Rejects are surfaced
   *  by the caller's toast; this component only clears its spinner. */
  onMarkPaid: (supplierId: string, installmentId: number) => Promise<void>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<Set<BucketKey>>(() => new Set(OPEN_BY_DEFAULT));
  const [marking, setMarking] = useState<number | null>(null);

  const { rows, buckets, paidSum, outstanding, dueSoon, next } = useMemo(() => {
    const all: Row[] = suppliers.flatMap((s) =>
      s.installments.map((i) => ({ ...i, supplierId: s.id, supplierName: s.name })),
    );
    const today = todayIso();
    const in7 = isoPlusDays(7);
    const in30 = isoPlusDays(30);

    const grouped = new Map<BucketKey, Row[]>();
    for (const row of all) {
      const key: BucketKey = row.paid
        ? "paid"
        : !row.due_date
          ? "undated"
          : row.due_date < today
            ? "overdue"
            : row.due_date <= in7
              ? "d7"
              : row.due_date <= in30
                ? "d30"
                : "later";
      const list = grouped.get(key);
      if (list) list.push(row);
      else grouped.set(key, [row]);
    }
    // Within a bucket: earliest first, undated last, then by supplier name so
    // the order is stable across refreshes.
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        if (a.due_date !== b.due_date) {
          if (!a.due_date) return 1;
          if (!b.due_date) return -1;
          return a.due_date < b.due_date ? -1 : 1;
        }
        return a.supplierName.localeCompare(b.supplierName);
      });
    }

    const unpaid = all.filter((i) => !i.paid);
    return {
      rows: all,
      buckets: grouped,
      paidSum: all.filter((i) => i.paid).reduce((a, i) => a + i.amount_huf, 0),
      outstanding: unpaid.reduce((a, i) => a + i.amount_huf, 0),
      dueSoon: unpaid
        .filter((i) => i.due_date && i.due_date <= in30)
        .reduce((a, i) => a + i.amount_huf, 0),
      // Earliest unpaid DATED installment, wherever it falls — an empty week
      // must not report "nothing dated" while a payment sits 45 days out.
      next:
        unpaid
          .filter((i) => i.due_date)
          .sort((a, b) => ((a.due_date ?? "") < (b.due_date ?? "") ? -1 : 1))[0] ?? null,
    };
  }, [suppliers]);

  if (rows.length === 0) return null;

  const today = todayIso();
  const money = (v: number) => formatMoney(v, currency, locale === "hu" ? "hu" : "en");
  const shortDate = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(intlLocale(locale), {
      month: "short",
      day: "numeric",
    });

  function toggle(key: BucketKey) {
    setOpen((prev) => {
      const nextOpen = new Set(prev);
      if (nextOpen.has(key)) nextOpen.delete(key);
      else nextOpen.add(key);
      return nextOpen;
    });
  }

  async function markPaid(row: Row) {
    setMarking(row.id);
    try {
      await onMarkPaid(row.supplierId, row.id);
    } finally {
      setMarking(null);
    }
  }

  return (
    <section
      aria-label={t("budget.payments_due_title")}
      className="mb-6 rounded-2xl border border-paper-300 bg-paper-50 px-4 py-3 dark:border-umber-700 dark:bg-ink-800"
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-paper-50">
          {t("budget.payments_due_title")}
        </h2>
        <InfoHint text={t("budget.payments_due_sub")} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-500 dark:text-umber-300">{t("budget.payments_paid")}</dt>
          <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {money(paidSum)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500 dark:text-umber-300">
            {t("budget.payments_outstanding")}
          </dt>
          <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {money(outstanding)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500 dark:text-umber-300">
            {t("budget.payments_due_30")}
          </dt>
          <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {money(dueSoon)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-500 dark:text-umber-300">{t("budget.payments_next")}</dt>
          <dd className="text-sm font-semibold text-ink-900 dark:text-paper-50">
            {next?.due_date ? (
              <>
                {shortDate(next.due_date)}
                <span className="ml-1 font-normal text-ink-500 dark:text-umber-300">
                  · {next.supplierName}
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

      <div className="mt-3 border-t border-paper-200 pt-1 dark:border-umber-700">
        {BUCKETS.map((key) => {
          const list = buckets.get(key);
          if (!list || list.length === 0) return null;
          const sum = list.reduce((a, i) => a + i.amount_huf, 0);
          const isOpen = open.has(key);
          const isOverdue = key === "overdue";
          return (
            <div
              key={key}
              className="border-b border-paper-200 last:border-0 dark:border-umber-700"
            >
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                aria-controls={`payments-bucket-${key}`}
                className="flex w-full items-center gap-2 py-2 text-left text-xs transition hover:text-ink-900 dark:hover:text-paper-50"
              >
                <ChevronDown
                  size={14}
                  aria-hidden
                  className={`shrink-0 text-ink-400 transition-transform dark:text-umber-300 ${
                    isOpen ? "" : "-rotate-90"
                  }`}
                />
                {isOverdue && (
                  <TriangleAlert
                    size={13}
                    aria-hidden
                    className="shrink-0 text-blush-700 dark:text-blush-300"
                  />
                )}
                <span
                  className={`font-medium ${
                    isOverdue
                      ? "text-blush-700 dark:text-blush-300"
                      : "text-ink-700 dark:text-paper-100"
                  }`}
                >
                  {t(BUCKET_LABEL_KEY[key])}
                </span>
                <span className="stat-num text-ink-400 dark:text-umber-300">{list.length}</span>
                <span className="stat-num ml-auto text-ink-500 dark:text-umber-200">
                  {money(sum)}
                </span>
              </button>

              {isOpen && (
                <ul id={`payments-bucket-${key}`} className="pb-2">
                  {list.map((row) => {
                    const late =
                      isOverdue && row.due_date ? daysBetween(row.due_date, today) : null;
                    return (
                      <li
                        key={row.id}
                        className="flex items-center gap-2 py-1 pl-5 text-xs sm:text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className={row.paid ? "text-ink-500 dark:text-umber-300" : ""}>
                            {row.supplierName}
                          </span>
                          {row.label && (
                            <span className="text-ink-400 dark:text-umber-300"> · {row.label}</span>
                          )}
                        </span>
                        {late !== null && late > 0 && (
                          <span className="stat-num shrink-0 text-[11px] font-medium text-blush-700 dark:text-blush-300">
                            {t("budget.payments_overdue_by", { n: String(late) })}
                          </span>
                        )}
                        <span className="stat-num shrink-0 text-[11px] text-ink-400 dark:text-umber-300">
                          {row.due_date ? shortDate(row.due_date) : "-"}
                        </span>
                        <span className="stat-num w-24 shrink-0 text-right font-medium text-ink-800 dark:text-paper-100">
                          {money(row.amount_huf)}
                        </span>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                          {row.paid ? (
                            <CircleCheck
                              size={14}
                              aria-hidden
                              className="text-sage-600 dark:text-sage-400"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => markPaid(row)}
                              disabled={marking !== null}
                              aria-label={t("budget.payments_mark_paid_aria", {
                                name: row.supplierName,
                              })}
                              title={t("budget.payments_mark_paid_aria", {
                                name: row.supplierName,
                              })}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-400 transition hover:bg-sage-50 hover:text-sage-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-200 disabled:opacity-50 dark:text-umber-300 dark:hover:bg-sage-400/15 dark:hover:text-sage-300"
                            >
                              {marking === row.id ? (
                                <Loader2 size={14} aria-hidden className="animate-spin" />
                              ) : (
                                <CircleCheck size={14} aria-hidden />
                              )}
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
