// SEO tool: 100 conversation cards for engaged couples, in 4 decks of 25.
// One card on screen at a time. Card order inside a deck is shuffled the
// first time the deck is opened and persisted in localStorage so a return
// visit picks up the next card rather than reshuffling from the top.
//
// Pure client state, no backend. Data lives in lib/couple_cards.ts.

import { ArrowLeft, RefreshCcw, Shuffle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { COUPLE_CARD_DECKS, DECK_SIZE, type DeckId } from "../lib/couple_cards";
import { useDocumentMeta } from "../lib/seo";

const STORAGE_KEY = "weddly.couple_cards.v1";

interface DeckProgress {
  order: number[];
  index: number;
}
type ProgressMap = Partial<Record<DeckId, DeckProgress>>;

function loadProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as ProgressMap;
  } catch {
    return {};
  }
}

function saveProgress(map: ProgressMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // localStorage blocked, progress just won't persist
  }
}

/** Fisher-Yates shuffle of indices [0, size). Returns a brand-new array
 *  so callers can store it without aliasing concerns. */
function shuffledIndices(size: number): number[] {
  const arr = Array.from({ length: size }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i] as number;
    const b = arr[j] as number;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

/** Validate a stored DeckProgress. Reject anything that doesn't have a
 *  permutation of [0, DECK_SIZE): corrupted progress would otherwise
 *  break the card-index lookup. */
function isValidProgress(p: unknown): p is DeckProgress {
  if (!p || typeof p !== "object") return false;
  const candidate = p as { order?: unknown; index?: unknown };
  if (!Array.isArray(candidate.order)) return false;
  if (candidate.order.length !== DECK_SIZE) return false;
  if (typeof candidate.index !== "number") return false;
  if (candidate.index < 0 || candidate.index >= DECK_SIZE) return false;
  const seen = new Set<number>();
  for (const n of candidate.order) {
    if (typeof n !== "number" || n < 0 || n >= DECK_SIZE) return false;
    if (seen.has(n)) return false;
    seen.add(n);
  }
  return true;
}

export default function CoupleCardsPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.couple_cards.page_h1", "tools.couple_cards.page_intro");

  const [activeDeck, setActiveDeck] = useState<DeckId | null>(null);
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());

  // Persist progress whenever it changes. Effect rather than inline so a
  // state setter from a callback doesn't race the storage write.
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  const activeDeckDef = useMemo(
    () => (activeDeck ? (COUPLE_CARD_DECKS.find((d) => d.id === activeDeck) ?? null) : null),
    [activeDeck],
  );

  // Lazy-init a deck's progress the first time the user opens it.
  // Existing progress is preserved across visits.
  const openDeck = useCallback((id: DeckId) => {
    setActiveDeck(id);
    setProgress((prev) => {
      const current = prev[id];
      if (current && isValidProgress(current)) return prev;
      return { ...prev, [id]: { order: shuffledIndices(DECK_SIZE), index: 0 } };
    });
  }, []);

  const closeDeck = useCallback(() => setActiveDeck(null), []);

  const nextCard = useCallback(() => {
    if (!activeDeck) return;
    setProgress((prev) => {
      const current = prev[activeDeck];
      if (!current) return prev;
      // Cycle back to the start when the deck is exhausted. The shuffle
      // is preserved across the wrap-around so the user sees the same
      // ordering twice before a manual reshuffle, a deliberate choice:
      // the localStorage-eq prompt becomes "reshuffle if you want a new
      // shuffle", not "every wrap-around silently gives a new mix".
      const nextIndex = (current.index + 1) % DECK_SIZE;
      return { ...prev, [activeDeck]: { ...current, index: nextIndex } };
    });
  }, [activeDeck]);

  const reshuffle = useCallback(() => {
    if (!activeDeck) return;
    setProgress((prev) => ({
      ...prev,
      [activeDeck]: { order: shuffledIndices(DECK_SIZE), index: 0 },
    }));
  }, [activeDeck]);

  const currentQuestion = useMemo(() => {
    if (!activeDeckDef || !activeDeck) return null;
    const p = progress[activeDeck];
    if (!p) return null;
    const questionIdx = p.order[p.index] ?? 0;
    const list = locale === "hu" ? activeDeckDef.questionsHu : activeDeckDef.questionsEn;
    return list[questionIdx] ?? null;
  }, [activeDeckDef, activeDeck, progress, locale]);

  const currentNumber = useMemo(() => {
    if (!activeDeck) return null;
    const p = progress[activeDeck];
    if (!p) return null;
    return p.index + 1;
  }, [activeDeck, progress]);

  return (
    <PublicShell>
      {!activeDeckDef ? <DeckPicker onOpen={openDeck} /> : null}
      {activeDeckDef ? (
        <CardView
          deckId={activeDeckDef.id}
          deckTitle={t(activeDeckDef.titleKey)}
          deckBlurb={t(activeDeckDef.blurbKey)}
          question={currentQuestion}
          cardNumber={currentNumber}
          onNext={nextCard}
          onReshuffle={reshuffle}
          onBack={closeDeck}
        />
      ) : null}

      {/* CTA + FAQ trail only on the picker view: when the user has a
          card open we keep the focus on the question itself. */}
      {!activeDeckDef ? (
        <>
          <section className="relative">
            <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 sm:py-20">
              <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
                {t("tools.couple_cards.cta_h2")}
              </h2>
              <p className="mt-6 text-base leading-relaxed text-ink-700 dark:text-paper-200">
                {t("tools.couple_cards.cta_body")}
              </p>
              <Link to="/signup" className="btn-primary btn-lg mt-8 inline-flex shadow-sm">
                {t("tools.couple_cards.cta_button")}
              </Link>
            </div>
          </section>

          <section className="relative bg-paper-50 dark:bg-umber-900">
            <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
              <h2 className="font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-4xl">
                {t("tools.couple_cards.faq_h2")}
              </h2>
              <div className="mt-8 space-y-3">
                {[
                  { q: t("tools.couple_cards.faq_q1"), a: t("tools.couple_cards.faq_a1") },
                  { q: t("tools.couple_cards.faq_q2"), a: t("tools.couple_cards.faq_a2") },
                  { q: t("tools.couple_cards.faq_q3"), a: t("tools.couple_cards.faq_a3") },
                ].map((entry) => (
                  <details
                    key={entry.q}
                    className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5"
                  >
                    <summary className="cursor-pointer list-none font-serif text-xl text-ink-900 dark:text-paper-50">
                      {entry.q}
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">
                      {entry.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </PublicShell>
  );
}

function DeckPicker({ onOpen }: { onOpen: (id: DeckId) => void }) {
  const { t } = useT();
  return (
    <>
      <section className="relative">
        <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16 sm:pb-12">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-600 dark:text-blush-300">
            {t("tools.couple_cards.page_eyebrow")}
          </p>
          <h1 className="mt-4 font-serif text-4xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("tools.couple_cards.page_h1")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-ink-700 dark:text-paper-200">
            {t("tools.couple_cards.page_intro")}
          </p>
        </div>
      </section>

      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="sr-only">{t("tools.couple_cards.decks_h2")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:gap-6">
            {COUPLE_CARD_DECKS.map((deck, idx) => (
              <button
                key={deck.id}
                type="button"
                onClick={() => onOpen(deck.id)}
                className="group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-paper-300 bg-white px-6 py-7 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-paper-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600 sm:px-7 sm:py-8"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.24em] text-blush-600 dark:text-blush-300">
                  {t("tools.couple_cards.deck_number_label", { n: idx + 1 })}
                </span>
                <span className="font-serif text-2xl italic leading-tight text-ink-900 dark:text-paper-50 sm:text-3xl">
                  {t(deck.titleKey)}
                </span>
                <span className="text-sm leading-relaxed text-ink-600 dark:text-paper-200">
                  {t(deck.blurbKey)}
                </span>
                <span className="mt-2 text-xs text-ink-500 dark:text-umber-300">
                  {t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function CardView({
  deckId,
  deckTitle,
  deckBlurb,
  question,
  cardNumber,
  onNext,
  onReshuffle,
  onBack,
}: {
  deckId: DeckId;
  deckTitle: string;
  deckBlurb: string;
  question: string | null;
  cardNumber: number | null;
  onNext: () => void;
  onReshuffle: () => void;
  onBack: () => void;
}) {
  const { t } = useT();
  return (
    <section className="relative">
      <div className="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12 sm:pb-24">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-ink-600 transition-colors hover:text-ink-900 dark:text-paper-200 dark:hover:text-paper-50"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t("tools.couple_cards.back_to_decks")}
        </button>

        <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blush-600 dark:text-blush-300">
            {deckTitle}
          </p>
          {cardNumber !== null ? (
            <p className="text-xs text-ink-500 dark:text-umber-300">
              {t("tools.couple_cards.card_position", { n: cardNumber, total: DECK_SIZE })}
            </p>
          ) : null}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-paper-200">{deckBlurb}</p>

        <article
          key={`${deckId}-${cardNumber ?? 0}`}
          className="couple-card mt-8 flex min-h-[20rem] flex-col justify-center rounded-3xl border border-paper-300 bg-white px-7 py-12 shadow-md dark:border-umber-700 dark:bg-umber-800 sm:min-h-[24rem] sm:px-12 sm:py-16"
        >
          <p className="font-serif text-2xl italic leading-snug text-ink-900 dark:text-paper-50 sm:text-3xl lg:text-4xl">
            {question ?? t("tools.couple_cards.card_empty")}
          </p>
        </article>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onNext}
            className="btn-primary btn-lg inline-flex items-center gap-2 shadow-sm"
          >
            <Shuffle size={16} aria-hidden="true" />
            {t("tools.couple_cards.next_card")}
          </button>
          <button
            type="button"
            onClick={onReshuffle}
            className="inline-flex items-center gap-2 rounded-md border border-paper-300 bg-paper-50 px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
          >
            <RefreshCcw size={14} aria-hidden="true" />
            {t("tools.couple_cards.reshuffle")}
          </button>
        </div>
      </div>
    </section>
  );
}
