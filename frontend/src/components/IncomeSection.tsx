// "Befolyt pénz / Gifts received" — the budget page's read-only view of the
// received-gifts ledger, plus the "recovered vs spent" report it feeds.
//
// This used to be an editable grid over its OWN table (`couple_income`), which
// meant the app tracked money-in twice: a cash gift logged on the wishlist's
// "Esküvő után" tab left this section reporting 0, and a gift logged here never
// appeared there. Two grids to keep, and two headline numbers that openly
// disagreed. The wishlist ledger is the single source of truth now — it is the
// one that knows a gift's TYPE, which is what decides whether it is cash at all
// — and this section renders a rollup of it with a link back to the editor.
//
// Same shape as the Nászút row on the budget table above: a read-only card that
// reports a number owned by another page and hands you over to edit it there,
// rather than offering a second place to type the same fact.

import type { ReceivedGift } from "@shared/received_gifts";
import { summarizeReceivedGifts } from "@shared/received_gifts";
import type { Currency } from "@shared/types";
import { ArrowUpRight, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { receivedGiftApi } from "../lib/endpoints";
import { formatMoney } from "../lib/format";
import { useT } from "../lib/i18n";

/** Deep link straight to the ledger, not just the wishlist page: landing on
 *  the gift-list tab after clicking "money received" is a dead end the couple
 *  has to recover from. */
const LEDGER_HREF = "/app/wishlist?phase=after";

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

  const [gifts, setGifts] = useState<ReceivedGift[] | null>(null);

  useEffect(() => {
    receivedGiftApi
      .list()
      .then((r) => setGifts(r.items ?? []))
      .catch(() => {
        // Best-effort: the budget page still works without the ledger. Stays
        // null, so the section renders its empty state rather than a false 0.
      });
  }, []);

  const summary = useMemo(() => summarizeReceivedGifts(gifts ?? [], currency), [gifts, currency]);

  const received = summary.money_total;
  const net = totalSpentHuf - received;
  const recoveredPct = totalSpentHuf > 0 ? Math.round((received / totalSpentHuf) * 100) : 0;
  const hasAnything = summary.money_count > 0 || summary.other_count > 0;

  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-grotesk text-xl text-ink-900 dark:text-paper-50">
          {t("income.title")}
        </h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-umber-300">
          <Lock size={14} aria-hidden />
          {t("income.private_badge")}
        </span>
      </div>
      <p className="mb-3 text-sm text-ink-500 dark:text-umber-300">{t("income.sub")}</p>

      {/* Summary — one warm number, no leaderboard. The whole card is the link
          to the editor, mirroring the Nászút row on the table above. */}
      <Link
        to={LEDGER_HREF}
        aria-label={t("income.open_ledger_aria")}
        className="block rounded-2xl border border-umber-800 bg-paper-50 px-4 py-3 transition hover:border-blush-300 dark:border-umber-700 dark:bg-ink-800 dark:hover:border-blush-400/60"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <Stat label={t("income.received")} value={formatMoney(received, currency, loc)} />
          <Stat label={t("income.spent")} value={formatMoney(totalSpentHuf, currency, loc)} />
          <Stat
            label={net >= 0 ? t("income.net_cost") : t("income.surplus")}
            value={formatMoney(Math.abs(net), currency, loc)}
            hint={received > 0 ? t("income.recovered_pct", { pct: recoveredPct }) : undefined}
          />
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-paper-200 pt-2.5 text-xs text-ink-500 dark:border-umber-700 dark:text-umber-300">
          <span>
            {hasAnything
              ? [
                  summary.money_count > 0
                    ? t("income.count_money", { n: summary.money_count })
                    : null,
                  // Physical gifts are counted, never valued — a blender does
                  // not reduce what is still to pay. Naming them is what stops
                  // a couple with presents and no cash reading this as empty.
                  summary.other_count > 0
                    ? t("income.count_other", { n: summary.other_count })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : t("income.empty")}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-blush-700 dark:text-blush-300">
            {t("income.manage_link")}
            <ArrowUpRight size={13} aria-hidden />
          </span>
        </div>
      </Link>
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
