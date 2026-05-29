// Admin triage for the couple-cards (100 kérdés az esküvő előtt)
// feedback. Each row is a (deck × card × locale) aggregate with three
// rating tallies: bad ("X"), ok ("✓"), great ("✓✓"). Default sort
// surfaces the cards visitors flag as bad most often — those are the
// curation candidates for the next copy iteration.

import { Inbox } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdminEmptyState, AdminFilterChip, AdminPageHeader } from "../components/admin";
import { Skeleton } from "../components/ui";
import { ApiError } from "../lib/api";
import { adminCoupleCardsApi, type CoupleCardFeedbackAggregate } from "../lib/endpoints";
import { useDocumentMetaLiteral } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

const DECK_LABELS: Record<string, string> = {
  roots: "Gyökerek",
  everyday: "Hétköznapok",
  closeness: "Közelség",
  deepwater: "Mély víz",
};

const LOCALE_OPTIONS = ["all", "hu", "en"] as const;
type LocaleFilter = (typeof LOCALE_OPTIONS)[number];

export default function AdminCoupleCardsPage() {
  useDocumentMetaLiteral(
    "Admin — 100 kérdés visszajelzések",
    "Couple-cards rating aggregates for admin curation.",
  );

  const [state, setState] = useState<Loadable<CoupleCardFeedbackAggregate[]>>({
    status: "loading",
  });
  const [localeFilter, setLocaleFilter] = useState<LocaleFilter>("all");
  const [deckFilter, setDeckFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    adminCoupleCardsApi
      .list()
      .then((res) => {
        if (!cancelled) setState({ status: "ok", data: res.items });
      })
      .catch((err) => {
        if (!cancelled) {
          const code = err instanceof ApiError ? err.status : 0;
          // 404 = the endpoint isn't shipped yet on whichever environment
          // is being looked at; surface "no data" instead of a scary error.
          if (code === 404) setState({ status: "ok", data: [] });
          else setState({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.status !== "ok") return [];
    return state.data.filter((row) => {
      if (localeFilter !== "all" && row.locale !== localeFilter) return false;
      if (deckFilter !== "all" && row.deck_id !== deckFilter) return false;
      return true;
    });
  }, [state, localeFilter, deckFilter]);

  return (
    <div className="space-y-6 px-4 sm:px-6 lg:px-8 xl:px-10">
      <AdminPageHeader
        title="100 kérdés — visszajelzések"
        subtitle="Visitor-kattintások a kártya alatti X / ✓ / ✓✓ ikonokra. A legtöbb 'X'-szel jelölt kérdés kerül felülre — ezek a következő copy-iteráció kandidánsai."
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
          Nyelv:
        </span>
        {LOCALE_OPTIONS.map((opt) => (
          <AdminFilterChip
            key={opt}
            active={localeFilter === opt}
            onClick={() => setLocaleFilter(opt)}
            label={opt === "all" ? "összes" : opt.toUpperCase()}
          />
        ))}
        <span className="ml-4 text-xs font-semibold uppercase tracking-wider text-ink-500 dark:text-umber-300">
          Pakli:
        </span>
        <AdminFilterChip
          active={deckFilter === "all"}
          onClick={() => setDeckFilter("all")}
          label="összes"
        />
        {Object.entries(DECK_LABELS).map(([id, label]) => (
          <AdminFilterChip
            key={id}
            active={deckFilter === id}
            onClick={() => setDeckFilter(id)}
            label={label}
          />
        ))}
      </div>

      {state.status === "loading" ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : state.status === "error" ? (
        <AdminEmptyState
          icon={<Inbox size={28} aria-hidden="true" />}
          title="Nem sikerült betölteni"
          description="Az API hibát adott. Próbáld újra később."
        />
      ) : filtered.length === 0 ? (
        <AdminEmptyState
          icon={<Inbox size={28} aria-hidden="true" />}
          title="Még nincs visszajelzés"
          description="Amint a látogatók elkezdik értékelni a kártyákat, ide kerülnek a tallyk."
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-paper-300 dark:border-umber-700">
          <table className="min-w-full divide-y divide-paper-300 dark:divide-umber-700">
            <thead className="bg-paper-100 dark:bg-umber-800">
              <tr>
                <Th>Pakli</Th>
                <Th>#</Th>
                <Th>Nyelv</Th>
                <Th>Kérdés</Th>
                <Th className="text-right text-wnrs-red">✗</Th>
                <Th className="text-right">✓</Th>
                <Th className="text-right text-sage-700">✓✓</Th>
                <Th className="text-right">Össz</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-200 bg-white dark:divide-umber-700 dark:bg-umber-900">
              {filtered.map((row) => {
                const key = `${row.deck_id}-${row.card_index}-${row.locale}`;
                const dominant: "bad" | "ok" | "great" | null =
                  row.bad_count >= row.ok_count &&
                  row.bad_count >= row.great_count &&
                  row.bad_count > 0
                    ? "bad"
                    : row.great_count >= row.ok_count && row.great_count > 0
                      ? "great"
                      : row.ok_count > 0
                        ? "ok"
                        : null;
                return (
                  <tr
                    key={key}
                    className={
                      dominant === "bad" ? "bg-wnrs-red/[0.05] dark:bg-wnrs-red/[0.08]" : ""
                    }
                  >
                    <Td className="font-medium">{DECK_LABELS[row.deck_id] ?? row.deck_id}</Td>
                    <Td className="text-ink-500 dark:text-umber-300">{row.card_index + 1}</Td>
                    <Td className="uppercase text-ink-500 dark:text-umber-300">{row.locale}</Td>
                    <Td className="max-w-xl text-sm leading-snug">
                      {row.question_snapshot || <span className="text-ink-400">(üres)</span>}
                    </Td>
                    <Td className="text-right text-wnrs-red tabular-nums font-medium">
                      {row.bad_count}
                    </Td>
                    <Td className="text-right tabular-nums">{row.ok_count}</Td>
                    <Td className="text-right tabular-nums text-sage-700 font-medium">
                      {row.great_count}
                    </Td>
                    <Td className="text-right tabular-nums text-ink-700 dark:text-paper-200">
                      {row.total}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-600 dark:text-umber-300 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-ink-800 dark:text-paper-200 ${className}`}>
      {children}
    </td>
  );
}
