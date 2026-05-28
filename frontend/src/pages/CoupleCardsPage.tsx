// SEO tool: 100 conversation cards for engaged couples, in 4 decks of 25.
// One card on screen at a time. Card order inside a deck is shuffled the
// first time the deck is opened and persisted in localStorage so a return
// visit picks up the next card rather than reshuffling from the top.
//
// Pure client state, no backend. Data lives in lib/couple_cards.ts.

import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  Lock,
  Shuffle,
  Unlock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { COUPLE_CARD_DECKS, DECK_SIZE, type DeckId } from "../lib/couple_cards";
import { coupleCardsApi, type CoupleCardRating } from "../lib/endpoints";
import { useDocumentMeta } from "../lib/seo";

// Bumped v1 → v2 when the deck behaviour switched from "deterministic
// Fisher-Yates with manual reshuffle" to "bag-shuffle: random order per
// pass, auto-reshuffle every 25 cards". The v1 schema (`{ order, index }`)
// is silently ignored; we don't read the legacy key so stale data in old
// browsers can't crash the new validator.
const STORAGE_KEY = "weddly.couple_cards.v2";

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
 *  so callers can store it without aliasing concerns.
 *
 *  When `avoidFirst` is supplied (the previously-surfaced card), we keep
 *  shuffling until the top of the new deck isn't a repeat. Guarantees
 *  the deal feels random across deck-boundaries: a visitor who just saw
 *  card X never sees X again as the first card of the next bag. With 25
 *  unique values the probability of a single re-roll is 1/25, so the loop
 *  almost always terminates on the first pass. */
function shuffledIndices(size: number, avoidFirst?: number): number[] {
  const arr = Array.from({ length: size }, (_, i) => i);
  for (let attempt = 0; attempt < 8; attempt++) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = arr[i] as number;
      const b = arr[j] as number;
      arr[i] = b;
      arr[j] = a;
    }
    if (avoidFirst === undefined || arr[0] !== avoidFirst) return arr;
  }
  // After 8 unlucky shuffles in a row, swap slot 0 with slot 1 by hand
  // and return. This branch is statistically unreachable but keeps the
  // function from ever spinning forever.
  if (avoidFirst !== undefined && arr[0] === avoidFirst && arr.length > 1) {
    const a = arr[0] as number;
    const b = arr[1] as number;
    arr[0] = b;
    arr[1] = a;
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

/** After this many distinct cards have surfaced in the card view, snap
 *  the page into focus mode automatically. Counts both the open-deck
 *  transition (which lands the first card) and every subsequent "next".
 *  Reshuffle doesn't count; the user is just resetting their own deck. */
const AUTOLOCK_THRESHOLD = 4;

export default function CoupleCardsPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.couple_cards.page_h1", "tools.couple_cards.page_intro");

  const [activeDeck, setActiveDeck] = useState<DeckId | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<DeckId>(DEFAULT_SELECTED);

  // Swap the centred deck inside a View Transition so the browser
  // computes a layout morph between the just-tapped mini and the centre
  // card (which share the same `viewTransitionName`). flushSync forces
  // React to commit the new DOM synchronously inside the transition
  // callback, otherwise the API would capture a half-applied frame.
  // Browsers without the API (Firefox today) fall through to a plain
  // setState — no morph, but the swap still works.
  const selectDeck = useCallback(
    (id: DeckId) => {
      if (id === selectedDeck) return;
      const runUpdate = () => {
        flushSync(() => setSelectedDeck(id));
      };
      const doc = document as Document & {
        startViewTransition?: (callback: () => void) => unknown;
      };
      if (typeof doc.startViewTransition === "function") {
        doc.startViewTransition(runUpdate);
      } else {
        runUpdate();
      }
    },
    [selectedDeck],
  );
  const [progress, setProgress] = useState<ProgressMap>(() => loadProgress());
  const [isLocked, setIsLocked] = useState(false);
  const [viewedCount, setViewedCount] = useState(0);
  const [autoLockUsed, setAutoLockUsed] = useState(false);

  // Persist progress whenever it changes. Effect rather than inline so a
  // state setter from a callback doesn't race the storage write.
  useEffect(() => {
    saveProgress(progress);
  }, [progress]);

  // Auto-snap into focus mode the first time the visitor has read four
  // cards in this session. Fires once; if the user manually unlocks
  // afterwards we respect that and don't snap them back in.
  useEffect(() => {
    if (viewedCount >= AUTOLOCK_THRESHOLD && !autoLockUsed && !isLocked) {
      setIsLocked(true);
      setAutoLockUsed(true);
    }
  }, [viewedCount, autoLockUsed, isLocked]);

  // Body scroll lock while the overlay is mounted. Stashes the previous
  // `overflow` so a sibling that set it (e.g. a dialog) isn't trampled
  // on cleanup.
  useEffect(() => {
    if (!isLocked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isLocked]);

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
    // Opening a deck surfaces the first card — count it toward the
    // autolock threshold so a visitor who taps "draw a card" + three
    // "next" presses gets snapped into focus mode.
    setViewedCount((c) => c + 1);
  }, []);

  // Stepping out of the card view via the "Back to decks" link also
  // exits focus mode and resets the auto-lock arm. Earlier this only
  // cleared `activeDeck`, which left `isLocked = true` lingering — and
  // because the focus-overlay only mounts when `activeDeck && isLocked`,
  // the overlay disappeared while the body's scroll lock did not, so the
  // showcase was frozen until a page refresh. Clearing both bits here
  // keeps the page scrollable the moment the visitor steps out, and
  // disarms autolock so a return visit doesn't snap them back into
  // focus mode against their will.
  const closeDeck = useCallback(() => {
    setActiveDeck(null);
    setIsLocked(false);
    setAutoLockUsed(false);
    setViewedCount(0);
  }, []);

  // "Bag shuffle": step through a Fisher-Yates permutation until it's
  // exhausted, then automatically reshuffle for the next round. The first
  // card of the new bag is guaranteed not to be a repeat of the last
  // card of the old bag (avoidFirst). Counter still reads "N / 25 in this
  // round" — when it ticks back to 1, the round flips and the deck looks
  // fresh. Card-face click + the secondary "Next card" link both use this.
  const nextCard = useCallback(() => {
    if (!activeDeck) return;
    setProgress((prev) => {
      const current = prev[activeDeck];
      if (!current) return prev;
      if (current.index + 1 < DECK_SIZE) {
        return { ...prev, [activeDeck]: { ...current, index: current.index + 1 } };
      }
      // Round complete. Reshuffle for the next pass, but avoid putting
      // the just-seen card back at the top.
      const lastSeen = current.order[current.index];
      return {
        ...prev,
        [activeDeck]: { order: shuffledIndices(DECK_SIZE, lastSeen), index: 0 },
      };
    });
    setViewedCount((c) => c + 1);
  }, [activeDeck]);

  // Shuffle-icon callback: jump to a fresh random card from the SAME
  // deck, ignoring the bag-shuffle order. The only invariant kept is
  // "no immediate repeat" — if RNG lands on the current index, bump by
  // one. Distinct from `nextCard` so a visitor who wants a true random
  // shake (instead of the "25-card round" rhythm) gets one.
  const shuffleRandom = useCallback(() => {
    if (!activeDeck) return;
    setProgress((prev) => {
      const current = prev[activeDeck];
      if (!current || DECK_SIZE < 2) return prev;
      let nextIdx = Math.floor(Math.random() * DECK_SIZE);
      if (nextIdx === current.index) {
        nextIdx = (nextIdx + 1) % DECK_SIZE;
      }
      return { ...prev, [activeDeck]: { ...current, index: nextIdx } };
    });
    setViewedCount((c) => c + 1);
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

  // Per-card rating cache: deck-id + card-index → submitted rating.
  // Lets the UI show "you already flagged this one as X" without an
  // extra round-trip, and stops accidental double-submits.
  const [ratings, setRatings] = useState<Map<string, CoupleCardRating>>(() => new Map());
  const ratingKey = (deck: DeckId, cardIdx: number) => `${deck}:${cardIdx}`;

  const submitFeedback = useCallback(
    (rating: CoupleCardRating) => {
      if (!activeDeck || !activeDeckDef || currentQuestion == null) return;
      const p = progress[activeDeck];
      if (!p) return;
      const cardIdx = p.order[p.index] ?? 0;
      const key = ratingKey(activeDeck, cardIdx);
      // Optimistic local cache so the UI flips immediately — POST is fire
      // and forget (rate-limit + validation lives server-side).
      setRatings((prev) => {
        const next = new Map(prev);
        next.set(key, rating);
        return next;
      });
      void coupleCardsApi.submitFeedback({
        deck_id: activeDeck,
        card_index: cardIdx,
        rating,
        locale,
        question_snapshot: currentQuestion,
      });
    },
    [activeDeck, activeDeckDef, currentQuestion, progress, locale],
  );

  const currentRating: CoupleCardRating | null = useMemo(() => {
    if (!activeDeck) return null;
    const p = progress[activeDeck];
    if (!p) return null;
    const cardIdx = p.order[p.index] ?? 0;
    return ratings.get(ratingKey(activeDeck, cardIdx)) ?? null;
  }, [activeDeck, progress, ratings]);

  const cardView = activeDeckDef ? (
    <CardView
      deckId={activeDeckDef.id}
      deckTitle={t(activeDeckDef.titleKey)}
      question={currentQuestion}
      cardNumber={currentNumber}
      isLocked={isLocked}
      currentRating={currentRating}
      onNext={nextCard}
      onShuffle={shuffleRandom}
      onToggleLock={() => setIsLocked((v) => !v)}
      onFeedback={submitFeedback}
      onBack={closeDeck}
    />
  ) : null;

  return (
    <PublicShell>
      {!activeDeckDef ? (
        <DeckShowcase
          selectedId={selectedDeck}
          onSelect={selectDeck}
          onOpen={() => openDeck(selectedDeck)}
        />
      ) : null}
      {/* In-flow card view only when focus mode is OFF. When locked, the
          same component renders inside the fixed overlay below — exclusive
          branches keep the React tree from mounting it twice. */}
      {activeDeckDef && !isLocked ? cardView : null}

      {/* Focus mode overlay: fixed-inset, scroll-locked, covers the entire
          page (header + FAQ) so the card is the only thing the visitor
          sees. Only mounts in card view; the showcase doesn't get a focus
          mode (there's nothing to focus on yet). */}
      {activeDeckDef && isLocked ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-paper-50 px-4 dark:bg-umber-900 sm:px-8">
          <div className="w-full max-w-3xl">{cardView}</div>
        </div>
      ) : null}

      {/* FAQ trail only on the picker view: when the user has a card open
          we keep the focus on the question itself. The signup CTA is
          collapsed away from the tool page entirely — the showcase has
          its own primary action ("draw a card"), and a second competing
          CTA on the same screen muddies the funnel. */}
      {!activeDeckDef ? (
        <section className="relative bg-paper-50 dark:bg-umber-900">
          <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 className="font-display text-2xl font-bold uppercase leading-[0.95] tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl">
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
                  {/* `list-none` hides the default UA disclosure triangle so
                      we can render our own chevron (rotates 180° when the
                      details is open). flex + gap-3 + justify-between keeps
                      the question text and the chevron on opposite ends of
                      the row regardless of question length. */}
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-display text-sm font-bold uppercase tracking-[0.04em] text-ink-900 dark:text-paper-50 sm:text-base">
                    <span>{entry.q}</span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="shrink-0 text-ink-500 transition-transform duration-200 group-open:rotate-180 dark:text-umber-300"
                    />
                  </summary>
                  <p className="mt-3 font-display text-sm leading-relaxed text-ink-700 dark:text-umber-200">
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
        {/* Hero typography is unified with the card face: font-display
            display-sans, bold uppercase for the title, regular weight for
            the body. The Cormorant italic that lived here briefly is
            dropped — the tool page now reads as one consistent type
            system end-to-end (eyebrow / h1 / intro / card / FAQ all in
            the WNRS sans). */}
        <div className="mx-auto max-w-3xl text-center">
          <p className="font-display text-[11px] font-bold uppercase tracking-[0.32em] text-wnrs-red sm:text-xs">
            {t("tools.couple_cards.page_eyebrow")}
          </p>
          {/* Title widened to max-w-3xl + lg:whitespace-nowrap so the
              uppercase HU/EN headline ("100 KÉRDÉS A HÁZASSÁG ELŐTT" /
              "100 QUESTIONS BEFORE YOU SAY YES") stays on a single line at
              desktop sizes. sm/md keep the wrap option for narrower
              viewports where forcing one line would overflow horizontally. */}
          <h1 className="mt-3 font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl lg:whitespace-nowrap lg:text-5xl">
            {t("tools.couple_cards.page_h1")}
          </h1>
          <p className="mx-auto mt-4 max-w-xl font-display text-sm leading-relaxed text-ink-700 dark:text-paper-200 sm:text-base">
            {t("tools.couple_cards.page_intro")}
          </p>
        </div>

        {/* Fixed 4-slot row, scoped to max-w-2xl so the row sits flush
            with the centre card's width below it. Each level keeps a
            permanent slot — Level 1 always slot 1, Level 4 always slot 4
            — and the selected one is rendered as an EMPTY li (no border,
            no label), letting an open gap tell the "this card just rose
            into the centre" story without an extra placeholder shape. */}
        <h2 className="sr-only">{t("tools.couple_cards.decks_h2")}</h2>
        <ul className="mx-auto mt-8 grid max-w-2xl grid-cols-4 gap-2 sm:mt-10 sm:gap-3">
          {COUPLE_CARD_DECKS.map((deck, idx) => {
            const isSelected = deck.id === selectedId;
            return (
              <li key={deck.id} className="aspect-[3/2]" aria-hidden={isSelected}>
                {isSelected ? null : (
                  <button
                    type="button"
                    onClick={() => onSelect(deck.id)}
                    style={
                      {
                        viewTransitionName: `couple-deck-${deck.id}`,
                      } as React.CSSProperties
                    }
                    className="group flex h-full w-full flex-col items-center justify-between rounded-xl bg-wnrs-red px-2 py-2 text-center text-white shadow-[0_18px_36px_-18px_rgba(177,35,42,0.5)] focus:outline-none focus-visible:ring-2 focus-visible:ring-wnrs-red focus-visible:ring-offset-2 sm:px-3 sm:py-3"
                  >
                    <span aria-hidden="true" className="block h-0.5" />
                    <div className="flex flex-1 flex-col items-center justify-center">
                      <span className="font-display text-xs font-bold uppercase leading-[0.95] tracking-tight text-white sm:text-base lg:text-lg">
                        {t("tools.couple_cards.deck_number_label", { n: idx + 1 })}
                      </span>
                      <span className="mt-1 hidden font-display text-[10px] font-bold uppercase tracking-[0.04em] text-white sm:block sm:text-[11px]">
                        ({t(deck.titleKey)})
                      </span>
                    </div>
                    <span className="font-display text-[8px] font-bold uppercase tracking-[0.22em] text-white sm:text-[9px]">
                      {t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {/* Centre: the lifted deck. The card's `viewTransitionName` matches
            the just-tapped mini's, so the browser morphs one into the
            other on swap (Chrome / Safari). The CSS `animate-card-lift`
            keyframe enter has been dropped in favour of that morph —
            running both at once flashes; the morph alone gives the
            cleaner "the tile flew here" effect. Firefox falls through
            to a plain swap (still functional, just no morph). */}
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
            {/* Selected card face: WNRS-red, white display-sans, all caps.
                Click anywhere on this card opens the deck — there's no
                secondary CTA underneath. The accessible name carries the
                deck title so screen readers say "Draw a card · Roots"
                instead of an opaque "Draw a card". */}
            <button
              type="button"
              onClick={onOpen}
              aria-label={`${t("tools.couple_cards.draw_card")} · ${t(selected.titleKey)}`}
              style={
                {
                  viewTransitionName: `couple-deck-${selectedId}`,
                } as React.CSSProperties
              }
              className="relative z-10 flex aspect-[3/2] w-full flex-col items-center justify-between rounded-2xl bg-wnrs-red px-7 py-8 text-center text-white shadow-[0_24px_50px_-22px_rgba(177,35,42,0.55)] transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-wnrs-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-umber-900 sm:px-12 sm:py-10"
            >
              <span aria-hidden="true" className="block h-1" />
              <div className="flex flex-1 flex-col items-center justify-center">
                <h3 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight text-white sm:text-5xl lg:text-6xl">
                  {t("tools.couple_cards.deck_number_label", { n: selectedIdx + 1 })}
                </h3>
                <p className="mt-3 font-display text-base font-bold uppercase tracking-[0.04em] text-white sm:mt-4 sm:text-xl">
                  ({t(selected.titleKey)})
                </p>
              </div>
              <span className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-white sm:text-xs">
                {t("app.name")} · {t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })}
              </span>
            </button>
          </div>
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
  isLocked,
  currentRating,
  onNext,
  onShuffle,
  onToggleLock,
  onFeedback,
  onBack,
}: {
  deckId: DeckId;
  deckTitle: string;
  question: string | null;
  cardNumber: number | null;
  isLocked: boolean;
  currentRating: CoupleCardRating | null;
  onNext: () => void;
  onShuffle: () => void;
  onToggleLock: () => void;
  onFeedback: (rating: CoupleCardRating) => void;
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

        {/* Card-position label: the counter still means something with
            the new bag-shuffle (it counts the position inside the current
            25-card round), and clicking back to 1 / 25 is the visible
            "round complete, deck reshuffled" feedback. */}
        {cardNumber !== null ? (
          <p className="mt-6 text-center font-display text-[11px] font-bold uppercase tracking-[0.32em] text-wnrs-red">
            {t("tools.couple_cards.card_position", { n: cardNumber, total: DECK_SIZE })}
          </p>
        ) : null}

        {/* Card + right-side chrome stack. The stack hangs off the right
            edge of the card wrapper on tablet+ so the shuffle / lock
            controls read as "tools that belong to this card" rather than
            free-floating page chrome. On mobile (under sm) the stack
            falls back to fixed top-right so it doesn't overflow the
            viewport. */}
        <div className="relative mx-auto mt-8 max-w-2xl">
          <button
            type="button"
            onClick={onNext}
            aria-label={t("tools.couple_cards.flip_card")}
            className="couple-card group relative flex aspect-[3/2] w-full cursor-pointer flex-col items-center justify-between rounded-[2.25rem] bg-white px-7 py-8 text-left shadow-[0_30px_60px_-25px_rgba(28,32,56,0.35)] ring-1 ring-paper-200 transition-transform duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-wnrs-red focus-visible:ring-offset-2 sm:px-12 sm:py-12"
          >
          {/* Re-mount the inner article on every card flip so the keyed
              `animate-card-deal` enter animation fires for each new
              question. Article tags also keep the page semantically
              clean — the question is the article, the button is the
              affordance around it. */}
          <article
            key={`${deckId}-${cardNumber ?? 0}`}
            className="flex h-full w-full animate-card-deal flex-col items-center justify-between"
          >
            <span aria-hidden="true" className="block h-1" />

            <p
              data-testid="couple-card-question"
              className="text-balance text-center font-display text-sm font-bold uppercase leading-[1.15] tracking-[0.02em] text-wnrs-red sm:text-2xl lg:text-3xl"
            >
              {question ?? t("tools.couple_cards.card_empty")}
            </p>

            {/* Brand line is full on tablet+ ("Wēddly · 100 kérdés a házasság
                előtt") but compressed on mobile to just the app name, so
                the 3:2 card stays the same shape on a 375px viewport
                instead of bloating into a near-square. The deck title
                line below stays at both sizes — it tells the visitor
                which level this card belongs to. */}
            <div className="text-center">
              <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-wnrs-red sm:text-xs">
                {t("app.name")}
                <span className="hidden sm:inline">
                  {" · "}
                  {t("tools.couple_cards.page_h1")}
                </span>
              </p>
              <p className="mt-1 font-display text-[9px] uppercase tracking-[0.24em] text-wnrs-redInk sm:text-[10px]">
                {deckTitle}
              </p>
            </div>
          </article>
        </button>

          {/* Side chrome — sm+ only. Sits on the right edge of the card
              wrapper, vertically centred, two pill buttons stacked. The
              -mr lifts the stack OUT of the card so it doesn't cover any
              card content. */}
          <div className="absolute left-full top-1/2 ml-3 hidden -translate-y-1/2 flex-col gap-2 sm:flex sm:ml-4">
            <button
              type="button"
              onClick={onShuffle}
              aria-label={t("tools.couple_cards.shuffle_random")}
              title={t("tools.couple_cards.shuffle_random")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              <Shuffle size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onToggleLock}
              aria-label={
                isLocked
                  ? t("tools.couple_cards.unlock_view")
                  : t("tools.couple_cards.lock_view")
              }
              title={
                isLocked
                  ? t("tools.couple_cards.unlock_view")
                  : t("tools.couple_cards.lock_view")
              }
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              {isLocked ? (
                <Lock size={16} aria-hidden="true" />
              ) : (
                <Unlock size={16} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile fallback: under-sm the side stack would overflow the
            viewport, so the same two controls live in a fixed cluster at
            the top-right instead. Hidden from sm and up. */}
        <div
          className={`fixed right-4 z-[60] flex flex-col gap-2 sm:hidden ${
            isLocked ? "top-4" : "top-20"
          }`}
        >
          <button
            type="button"
            onClick={onShuffle}
            aria-label={t("tools.couple_cards.shuffle_random")}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
          >
            <Shuffle size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onToggleLock}
            aria-label={
              isLocked
                ? t("tools.couple_cards.unlock_view")
                : t("tools.couple_cards.lock_view")
            }
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
          >
            {isLocked ? (
              <Lock size={16} aria-hidden="true" />
            ) : (
              <Unlock size={16} aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Rating row: three small pills under the card. Anonymous, fire
            and forget — feeds the admin curator view where bad-rated
            questions surface first. Once the visitor taps, the chosen
            pill highlights and the others fade so they read as "you've
            already voted on this one". */}
        <div className="mt-6 flex justify-center gap-2">
          <FeedbackPill
            rating="bad"
            current={currentRating}
            label={t("tools.couple_cards.feedback_bad")}
            onClick={() => onFeedback("bad")}
          >
            <X size={16} aria-hidden="true" />
          </FeedbackPill>
          <FeedbackPill
            rating="ok"
            current={currentRating}
            label={t("tools.couple_cards.feedback_ok")}
            onClick={() => onFeedback("ok")}
          >
            <Check size={16} aria-hidden="true" />
          </FeedbackPill>
          <FeedbackPill
            rating="great"
            current={currentRating}
            label={t("tools.couple_cards.feedback_great")}
            onClick={() => onFeedback("great")}
          >
            <CheckCheck size={16} aria-hidden="true" />
          </FeedbackPill>
        </div>

        {/* Secondary "next" affordance for visitors who don't realise the
            card itself is clickable. Tertiary visual weight so the card
            stays the headline action. Reshuffle is gone — bag-shuffle
            auto-reshuffles every 25 cards, so manual reshuffle has no
            meaning. */}
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.24em] text-ink-600 transition-colors hover:text-ink-900 dark:text-paper-200 dark:hover:text-paper-50"
          >
            {t("tools.couple_cards.next_card")}
          </button>
        </div>
      </div>
    </section>
  );
}

/** One pill in the rating row under the card. `current` is the rating
 *  the visitor has already given to this card (if any); when it matches
 *  this pill's `rating`, the pill highlights in WNRS red. The other
 *  pills fade to ink-300 so the chosen one stays the only loud signal. */
function FeedbackPill({
  rating,
  current,
  label,
  onClick,
  children,
}: {
  rating: CoupleCardRating;
  current: CoupleCardRating | null;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const isSelected = current === rating;
  const isDimmed = current !== null && !isSelected;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={isSelected}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-wnrs-red focus-visible:ring-offset-2 ${
        isSelected
          ? "border-wnrs-red bg-wnrs-red text-white shadow-md"
          : isDimmed
            ? "border-paper-300 bg-white text-ink-300 hover:border-paper-400 hover:text-ink-500 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-400"
            : "border-paper-300 bg-white text-ink-600 hover:border-wnrs-red hover:text-wnrs-red dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:text-wnrs-red"
      }`}
    >
      {children}
    </button>
  );
}
