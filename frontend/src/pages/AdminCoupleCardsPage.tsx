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
import { COUPLE_CARD_DECKS } from "../lib/couple_cards";
import {
  adminCoupleCardsApi,
  type CoupleCardFeedbackAggregate,
  type CoupleCardSuggestion,
} from "../lib/endpoints";
import { useDocumentMetaLiteral } from "../lib/seo";

type Loadable<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error" };

const DECK_LABELS: Record<string, string> = {
  roots: "Gyökerek",
  everyday: "Hétköznapok",
  closeness: "Közelség",
  deepwater: "Mély víz",
  lemonade: "Limonádé",
  firstdate: "Első randi",
};

// Canonical current question text per (deck_id : card_index : locale).
// Votes are keyed by that tuple and carry a snapshot of the wording the
// visitor saw — but the decks get re-worded over time. A feedback row is
// only "still a card" if its snapshot matches the live question at that
// slot; reworded or removed questions ("not in the cards anymore") are
// dropped from the table below.
const CURRENT_QUESTIONS: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const deck of COUPLE_CARD_DECKS) {
    deck.questionsHu.forEach((q, i) => m.set(`${deck.id}:${i}:hu`, q));
    deck.questionsEn.forEach((q, i) => m.set(`${deck.id}:${i}:en`, q));
  }
  return m;
})();

function isCurrentCard(row: CoupleCardFeedbackAggregate): boolean {
  const current = CURRENT_QUESTIONS.get(`${row.deck_id}:${row.card_index}:${row.locale}`);
  return current !== undefined && current.trim() === row.question_snapshot.trim();
}

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
  const [suggestions, setSuggestions] = useState<Loadable<CoupleCardSuggestion[]>>({
    status: "loading",
  });
  const [localeFilter, setLocaleFilter] = useState<LocaleFilter>("all");
  const [deckFilter, setDeckFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setSuggestions({ status: "loading" });
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
    adminCoupleCardsApi
      .listSuggestions()
      .then((res) => {
        if (!cancelled) setSuggestions({ status: "ok", data: res.items });
      })
      .catch((err) => {
        if (!cancelled) {
          const code = err instanceof ApiError ? err.status : 0;
          if (code === 404) setSuggestions({ status: "ok", data: [] });
          else setSuggestions({ status: "error" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Weighted score per row: X = -2, ✓ = +1, ✓✓ = +2. Sort ascending so the
  // worst-rated questions surface first (the copy-iteration candidates).
  // Stable secondary sort by deck + card index so ties (lots of empty rows
  // at score 0) read consistently across refreshes.
  const filteredSuggestions = useMemo(() => {
    if (suggestions.status !== "ok") return [];
    return suggestions.data.filter((row) => {
      if (localeFilter !== "all" && row.locale !== localeFilter) return false;
      if (deckFilter !== "all" && row.deck_id !== deckFilter) return false;
      return true;
    });
  }, [suggestions, localeFilter, deckFilter]);

  const filtered = useMemo(() => {
    if (state.status !== "ok") return [];
    const rows = state.data.filter((row) => {
      // Drop feedback for questions that are no longer in the decks (reworded
      // copy or removed cards) — only show rows that match a live question.
      if (!isCurrentCard(row)) return false;
      if (localeFilter !== "all" && row.locale !== localeFilter) return false;
      if (deckFilter !== "all" && row.deck_id !== deckFilter) return false;
      return true;
    });
    const scoreOf = (r: CoupleCardFeedbackAggregate) =>
      -2 * r.bad_count + r.ok_count + 2 * r.great_count;
    return rows.slice().sort((a, b) => {
      const diff = scoreOf(a) - scoreOf(b);
      if (diff !== 0) return diff;
      if (a.deck_id !== b.deck_id) return a.deck_id.localeCompare(b.deck_id);
      return a.card_index - b.card_index;
    });
  }, [state, localeFilter, deckFilter]);

  return (
    <div className="space-y-6 px-4 sm:px-6 lg:px-8 xl:px-10">
      <AdminPageHeader
        title="100 kérdés — visszajelzések"
        subtitle="Visitor-kattintások a kártya alatti X / ✓ / ✓✓ ikonokra. Súlyozott rangsor (X: -2, ✓: +1, ✓✓: +2) — a legrosszabb értékelésű kérdések kerülnek felülre, ezek a következő copy-iteráció kandidánsai."
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-umber-300">
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
        <span className="ml-4 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-umber-300">
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
                    <Td className="text-neutral-500 dark:text-umber-300">{row.card_index + 1}</Td>
                    <Td className="uppercase text-neutral-500 dark:text-umber-300">{row.locale}</Td>
                    <Td className="max-w-xl text-sm leading-snug">
                      {row.question_snapshot || <span className="text-neutral-400">(üres)</span>}
                    </Td>
                    <Td className="text-right text-wnrs-red tabular-nums font-medium">
                      {row.bad_count}
                    </Td>
                    <Td className="text-right tabular-nums">{row.ok_count}</Td>
                    <Td className="text-right tabular-nums text-sage-700 font-medium">
                      {row.great_count}
                    </Td>
                    <Td className="text-right tabular-nums text-neutral-700 dark:text-paper-200">
                      {row.total}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Visitor-submitted suggestions from the 26th blank card. Same
          deck + locale filter chips above apply to this list too. */}
      <div className="mt-12">
        <h2 className="font-display text-lg font-bold uppercase tracking-tight text-neutral-900 dark:text-paper-50">
          Beérkezett javaslatok
        </h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-umber-300">
          A 26. üres kártyán keresztül beküldött javaslatok. A legfrissebbek kerülnek felülre.
        </p>

        {suggestions.status === "loading" ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : suggestions.status === "error" ? (
          <div className="mt-4">
            <AdminEmptyState
              icon={<Inbox size={28} aria-hidden="true" />}
              title="Nem sikerült betölteni"
              description="Az API hibát adott. Próbáld újra később."
            />
          </div>
        ) : filteredSuggestions.length === 0 ? (
          <div className="mt-4">
            <AdminEmptyState
              icon={<Inbox size={28} aria-hidden="true" />}
              title="Még nincs javaslat"
              description="Amikor a látogatók beküldenek egy saját kérdést, itt jelennek meg."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-paper-300 dark:border-umber-700">
            <table className="min-w-full divide-y divide-paper-300 dark:divide-umber-700">
              <thead className="bg-paper-100 dark:bg-umber-800">
                <tr>
                  <Th>Mikor</Th>
                  <Th>Pakli</Th>
                  <Th>Nyelv</Th>
                  <Th>Javaslat</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200 bg-white dark:divide-umber-700 dark:bg-umber-900">
                {filteredSuggestions.map((row) => (
                  <tr key={row.id}>
                    <Td className="whitespace-nowrap text-neutral-500 dark:text-umber-300">
                      {formatSuggestionDate(row.created_at)}
                    </Td>
                    <Td className="font-medium">{DECK_LABELS[row.deck_id] ?? row.deck_id}</Td>
                    <Td className="uppercase text-neutral-500 dark:text-umber-300">{row.locale}</Td>
                    <Td className="max-w-xl text-sm leading-snug">{row.suggestion}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSuggestionDate(epoch: number): string {
  // Stored as seconds-since-epoch in the backend (via `now()`); JS wants ms.
  const ms = epoch < 1e12 ? epoch * 1000 : epoch;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-600 dark:text-umber-300 ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-sm text-neutral-800 dark:text-paper-200 ${className}`}>
      {children}
    </td>
  );
}
