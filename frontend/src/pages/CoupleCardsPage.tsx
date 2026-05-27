// SEO tool: 100 conversation cards for engaged couples, in 4 decks of 25.
// One card on screen at a time. Card order inside a deck is shuffled the
// first time the deck is opened and persisted in localStorage so a return
// visit picks up the next card rather than reshuffling from the top.
//
// Pure client state, no backend. Data lives in lib/couple_cards.ts.

import { ArrowLeft, RefreshCcw, Shuffle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

/** Default "currently highlighted" deck on the showcase. Roots is the
 *  on-ramp question set, so first-time visitors land on it; returning
 *  visitors who tap another deck just override this in state. */
const DEFAULT_SELECTED: DeckId = "roots";

export default function CoupleCardsPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.couple_cards.page_h1", "tools.couple_cards.page_intro");

  const [activeDeck, setActiveDeck] = useState<DeckId | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<DeckId>(DEFAULT_SELECTED);
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
      {!activeDeckDef ? (
        <DeckShowcase
          selectedId={selectedDeck}
          onSelect={setSelectedDeck}
          onOpen={() => openDeck(selectedDeck)}
        />
      ) : null}
      {activeDeckDef ? (
        <CardView
          deckId={activeDeckDef.id}
          deckTitle={t(activeDeckDef.titleKey)}
          question={currentQuestion}
          cardNumber={currentNumber}
          onNext={nextCard}
          onReshuffle={reshuffle}
          onBack={closeDeck}
        />
      ) : null}

      {/* FAQ trail only on the picker view: when the user has a card open
          we keep the focus on the question itself. The signup CTA is
          collapsed away from the tool page entirely — the showcase has
          its own primary action ("draw a card"), and a second competing
          CTA on the same screen muddies the funnel. */}
      {!activeDeckDef ? (
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
      ) : null}
    </PublicShell>
  );
}

/** Single-screen showcase: the three non-selected decks sit as a row of
 *  miniatures up top; the selected deck dominates the centre as a large
 *  landscape card stacked over two phantom siblings so the whole cluster
 *  reads as a real deck. Hover fans the phantoms further out. The mini
 *  tiles swap into the centre on click; the big card (and the CTA below
 *  it) opens the chosen deck and drops the user into the card view. */
function DeckShowcase({
  selectedId,
  onSelect,
  onOpen,
}: {
  selectedId: DeckId;
  onSelect: (id: DeckId) => void;
  onOpen: () => void;
}) {
  const { t } = useT();
  const selectedIdx = COUPLE_CARD_DECKS.findIndex((d) => d.id === selectedId);
  const selected = COUPLE_CARD_DECKS[selectedIdx];
  if (!selected) return null;

  return (
    <section className="relative">
      <div className="mx-auto max-w-5xl px-4 pt-10 pb-12 sm:px-6 sm:pt-14 sm:pb-16">
        {/* Compact hero: shorter than the original DeckPicker so the full
            showcase (mini row + big card + CTA) lands in one viewport on
            laptop. */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("tools.couple_cards.page_eyebrow")}
          </p>
          <h1 className="mt-3 font-serif text-3xl italic leading-[1.05] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-5xl">
            {t("tools.couple_cards.page_h1")}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-ink-600 dark:text-paper-200 sm:text-base">
            {t("tools.couple_cards.page_intro")}
          </p>
        </div>

        {/* Mini deck row: the three non-selected decks. Click swaps the
            centre. Mobile: scrollable single row to avoid wrapping. */}
        <h2 className="sr-only">{t("tools.couple_cards.decks_h2")}</h2>
        <ul className="mt-8 flex items-stretch justify-center gap-3 overflow-x-auto pb-1 sm:mt-10 sm:gap-4 sm:overflow-x-visible">
          {COUPLE_CARD_DECKS.map((deck, idx) => {
            if (deck.id === selectedId) return null;
            return (
              <li key={deck.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onSelect(deck.id)}
                  className="group flex aspect-[3/2] w-36 flex-col justify-between rounded-xl border border-paper-300 bg-white px-3 py-3 text-left shadow-sm transition-all hover:-translate-y-1 hover:border-paper-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:hover:border-umber-600 sm:w-44 sm:px-4 sm:py-4"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-blush-700 dark:text-blush-300">
                    {t("tools.couple_cards.deck_number_label", { n: idx + 1 })}
                  </span>
                  <span className="font-serif text-lg italic leading-tight text-ink-900 dark:text-paper-50 sm:text-xl">
                    {t(deck.titleKey)}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
                    {t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Centre: the selected deck as a hover-animated stack. Two phantom
            cards sit behind the front face; group-hover fans them out. */}
        <div className="relative mx-auto mt-10 max-w-2xl sm:mt-12">
          <div className="group relative isolate">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-0 translate-x-1.5 translate-y-2 rotate-[2deg] rounded-2xl border border-paper-300 bg-paper-100 transition-transform duration-300 ease-out group-hover:translate-x-4 group-hover:translate-y-5 group-hover:rotate-[5deg] dark:border-umber-700 dark:bg-umber-700"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1] translate-x-3 translate-y-4 rotate-[4deg] rounded-2xl border border-paper-300 bg-paper-50 transition-transform duration-300 ease-out group-hover:translate-x-8 group-hover:translate-y-10 group-hover:rotate-[8deg] dark:border-umber-700 dark:bg-umber-800"
            />
            <button
              type="button"
              onClick={onOpen}
              className="relative z-10 flex aspect-[3/2] w-full flex-col justify-between rounded-2xl border-2 border-blush-300 bg-blush-100 px-7 py-7 text-left shadow-[0_24px_50px_-22px_rgba(199,113,98,0.5)] transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-500 focus-visible:ring-offset-2 dark:border-blush-700 dark:bg-blush-900/30 dark:focus-visible:ring-offset-umber-900 sm:px-12 sm:py-10"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.32em] text-blush-800 dark:text-blush-300">
                {t("tools.couple_cards.deck_number_label", { n: selectedIdx + 1 })}
              </span>
              <div className="flex flex-1 flex-col justify-center">
                <h3 className="font-serif text-4xl italic leading-[0.95] text-ink-900 dark:text-paper-50 sm:text-6xl">
                  {t(selected.titleKey)}
                </h3>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-ink-700 dark:text-paper-200 sm:mt-4 sm:text-base">
                  {t(selected.blurbKey)}
                </p>
              </div>
              <span className="self-end text-[10px] uppercase tracking-[0.24em] text-blush-800 dark:text-blush-300">
                {t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })}
              </span>
            </button>
          </div>
        </div>

        {/* Primary action under the deck. Mirrors the big card's click
            handler so a visitor can hit either surface and end up in the
            same card view. */}
        <div className="mt-12 flex justify-center sm:mt-14">
          <button
            type="button"
            onClick={onOpen}
            className="btn-primary btn-lifted btn-lg inline-flex items-center gap-2 shadow-sm"
          >
            {t("tools.couple_cards.draw_card")}
          </button>
        </div>
      </div>
    </section>
  );
}

function CardView({
  deckId,
  deckTitle,
  question,
  cardNumber,
  onNext,
  onReshuffle,
  onBack,
}: {
  deckId: DeckId;
  deckTitle: string;
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

        {/* Card-position label only — the deck title is printed on the
            card face itself, so the header line stays unfussy. */}
        {cardNumber !== null ? (
          <p className="mt-6 text-center text-xs uppercase tracking-[0.24em] text-ink-500 dark:text-umber-300">
            {t("tools.couple_cards.card_position", { n: cardNumber, total: DECK_SIZE })}
          </p>
        ) : null}

        {/* "We're Not Really Strangers"-inspired card face: white stock,
            heavily rounded corners, capslock red type centred in the card,
            tiny brand + deck line at the bottom. The dark border is dropped
            so the card reads as a real printable physical card rather than
            a UI tile, and the white background is kept in dark mode too —
            the surface has its own visual identity. */}
        <article
          key={`${deckId}-${cardNumber ?? 0}`}
          className="couple-card relative mx-auto mt-8 flex aspect-[3/2] max-w-2xl flex-col items-center justify-between rounded-[2.25rem] bg-white px-7 py-8 shadow-[0_30px_60px_-25px_rgba(28,32,56,0.35)] ring-1 ring-paper-200 sm:px-12 sm:py-12"
        >
          {/* Optical-centring spacer: with justify-between, the question
              sits between this empty span and the brand line below, which
              looks balanced regardless of how many lines the question wraps
              to. */}
          <span aria-hidden="true" className="block h-1" />

          <p
            data-testid="couple-card-question"
            className="text-center font-sans text-lg font-bold uppercase leading-[1.15] tracking-[0.04em] text-blush-700 sm:text-2xl lg:text-3xl"
          >
            {question ?? t("tools.couple_cards.card_empty")}
          </p>

          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-blush-700 sm:text-xs">
              {t("app.name")} · {t("tools.couple_cards.page_h1")}
            </p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.2em] text-blush-600 sm:text-[10px]">
              {deckTitle}
            </p>
          </div>
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
