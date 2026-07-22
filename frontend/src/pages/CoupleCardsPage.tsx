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
  ChevronLeft,
  Lock,
  PenLine,
  Shuffle,
  Unlock,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { TOOL_FAQ } from "@shared/tool_faq";
import { PublicShell } from "../components/PublicShell";
import { contentLocale, useT } from "../lib/i18n";
import {
  COUPLE_CARD_DECKS,
  DECK_SIZE,
  type DeckId,
  isAccentDeck,
  redLevel,
} from "../lib/couple_cards";
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

const VALID_DECK_IDS: ReadonlySet<DeckId> = new Set([
  "firstdate",
  "roots",
  "everyday",
  "closeness",
  "deepwater",
  "lemonade",
]);

/** Read `?deck=…` from the URL on first render so deep-links from the
 *  landing teaser open the matching deck instead of always defaulting
 *  to roots. Invalid values fall through to the default. A `?deck=lemonade`
 *  link also unlocks the easter-egg deck so a curator can share the
 *  hidden pack without forcing the recipient to discover the swipe. */
function initialSelectedDeck(): DeckId {
  if (typeof window === "undefined") return DEFAULT_SELECTED;
  const param = new URLSearchParams(window.location.search).get("deck");
  if (param && VALID_DECK_IDS.has(param as DeckId)) return param as DeckId;
  return DEFAULT_SELECTED;
}

// Lemonade easter egg lives entirely in selectedDeck state: when
// `selectedDeck === "lemonade"`, the mini-row slides left by one slot
// so the lemonade tile rotates into view and Level 1 rotates off the
// left edge. Picking any red deck unshifts the row. No localStorage
// flag — every fresh page load starts back at "hidden". A right-swipe
// (pointer or trackpad wheel) selects lemonade directly, which is the
// same thing as the user finding the easter egg.

/** After this many distinct cards have surfaced in the card view, snap
 *  the page into focus mode automatically. Counts both the open-deck
 *  transition (which lands the first card) and every subsequent "next".
 *  Reshuffle doesn't count; the user is just resetting their own deck. */
const AUTOLOCK_THRESHOLD = 4;

export default function CoupleCardsPage() {
  const { t, locale } = useT();
  useDocumentMeta("tools.couple_cards.page_h1", "tools.couple_cards.page_intro");

  const [activeDeck, setActiveDeck] = useState<DeckId | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<DeckId>(() => initialSelectedDeck());

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
  // 26th-card "blank" suggestion form state. Scoped to whichever deck is
  // currently active; leaving the deck (or switching decks) resets it,
  // because the suggestion is always submitted with that deck's id.
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionText, setSuggestionText] = useState("");
  const [suggestionStatus, setSuggestionStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");

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
    // Decks without questions yet (e.g. a "coming soon" pack) can't be
    // drawn; the card view assumes a full DECK_SIZE bag. Selecting them in
    // the picker still works; "Draw a card" is just a no-op until they ship.
    const def = COUPLE_CARD_DECKS.find((d) => d.id === id);
    if (!def || def.questionsEn.length === 0) return;
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
    setIsSuggesting(false);
    setSuggestionText("");
    setSuggestionStatus("idle");
  }, []);

  const openSuggestion = useCallback(() => {
    setIsSuggesting(true);
    setSuggestionStatus("idle");
  }, []);

  const closeSuggestion = useCallback(() => {
    setIsSuggesting(false);
  }, []);

  const submitSuggestion = useCallback(async () => {
    if (!activeDeck) return;
    const text = suggestionText.trim();
    // Backend enforces min 8; keep the UI guard in sync so a too-short
    // tap doesn't even fire a network round-trip.
    if (text.length < 8) return;
    setSuggestionStatus("submitting");
    try {
      await coupleCardsApi.submitSuggestion({
        deck_id: activeDeck,
        locale: locale === "hu" ? "hu" : "en",
        suggestion: text,
      });
      setSuggestionStatus("success");
      setSuggestionText("");
    } catch {
      setSuggestionStatus("error");
    }
  }, [activeDeck, suggestionText, locale]);

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

  // Step back one card inside the current bag. Bounded at the top of the
  // round — no wrap into the previous shuffle, since the bag's order is
  // ephemeral and the visitor's mental model of "the card I just saw" is
  // only valid within this 25-card pass.
  const prevCard = useCallback(() => {
    if (!activeDeck) return;
    setProgress((prev) => {
      const current = prev[activeDeck];
      if (!current || current.index <= 0) return prev;
      return { ...prev, [activeDeck]: { ...current, index: current.index - 1 } };
    });
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
        locale: contentLocale(locale),
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

  const canGoBack = activeDeck ? (progress[activeDeck]?.index ?? 0) > 0 : false;
  const cardView = activeDeckDef ? (
    <CardView
      deckId={activeDeckDef.id}
      deckTitle={t(activeDeckDef.titleKey)}
      question={currentQuestion}
      cardNumber={currentNumber}
      isLocked={isLocked}
      currentRating={currentRating}
      canGoBack={canGoBack}
      isSuggesting={isSuggesting}
      suggestionText={suggestionText}
      suggestionStatus={suggestionStatus}
      onNext={nextCard}
      onPrev={prevCard}
      onShuffle={shuffleRandom}
      onToggleLock={() => setIsLocked((v) => !v)}
      onFeedback={submitFeedback}
      onBack={closeDeck}
      onOpenSuggestion={openSuggestion}
      onCloseSuggestion={closeSuggestion}
      onSuggestionChange={setSuggestionText}
      onSuggestionSubmit={submitSuggestion}
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
              {TOOL_FAQ[contentLocale(locale)].couple_cards.map((entry) => (
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

  // Easter-egg carousel shift state. The row holds 6 fixed-width cards:
  // [firstdate, 4 reds, lemonade] inside a 4-slot viewport. "none" (the
  // default) frames the 4 reds, with firstdate tucked off the LEFT edge and
  // lemonade off the RIGHT. A left-swipe slides the row right to reveal
  // firstdate; a right-swipe slides it left to reveal lemonade. Revealing
  // only shifts the row; it does NOT auto-select. The visitor still taps
  // the accent tile to lift it into the centre. Card sizes never change.
  type Shift = "first" | "none" | "lemon";
  const shiftFor = (id: DeckId): Shift =>
    id === "firstdate" ? "first" : id === "lemonade" ? "lemon" : "none";
  const [shift, setShift] = useState<Shift>(() => shiftFor(selectedId));
  // Keep the shift in sync with the centred deck: picking a red deck tucks
  // both accent tiles back off-edge; picking (or ?deck=) firstdate/lemonade
  // keeps the matching empty slot inside the viewport.
  useEffect(() => {
    setShift(shiftFor(selectedId));
  }, [selectedId]);

  // Swipe gate: a horizontal gesture (pointer drag or trackpad wheel) from
  // the neutral "none" framing reveals the accent tile on that side. No
  // auto-select. The egg has no visual hint that the row is interactive.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  // Set the instant a horizontal swipe fires the shift, so the trailing
  // click that touch dispatches on release doesn't also select a deck.
  const swipeFired = useRef(false);
  const wheelAcc = useRef(0);
  const handleSwipeStart = (e: React.PointerEvent<HTMLUListElement>) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
    swipeFired.current = false;
  };
  // Evaluate the gesture during the move, not on pointerup. On mobile a
  // vertically-scrollable page makes the browser cancel the pointer (it
  // fires pointercancel, never pointerup) the moment it locks the touch
  // into a scroll, which silently dropped the swipe. The early move
  // events still arrive before that lock, so we catch the shift here.
  const handleSwipeMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const start = swipeStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return;
    // Direction maps to the accent side, from ANY current framing: swipe
    // right reveals lemonade (right edge), swipe left reveals firstdate
    // (left edge). So from the revealed-firstdate state a right-swipe slides
    // straight over to lemonade, and vice-versa, no need to return to the
    // red row first.
    const next: Shift = dx > 0 ? "lemon" : "first";
    if (next === shift) return;
    swipeStart.current = null;
    swipeFired.current = true;
    setShift(next);
  };
  const handleWheel = (e: React.WheelEvent<HTMLUListElement>) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      wheelAcc.current += e.deltaX;
      // Same any-state mapping as the pointer swipe: scroll right → lemonade,
      // scroll left → firstdate, regardless of where the row currently sits.
      if (wheelAcc.current > 60) {
        if (shift !== "lemon") setShift("lemon");
        wheelAcc.current = 0;
      } else if (wheelAcc.current < -60) {
        if (shift !== "first") setShift("first");
        wheelAcc.current = 0;
      }
    } else {
      wheelAcc.current = 0;
    }
  };

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
          {/* Title widened to max-w-3xl + lg:whitespace-nowrap so the
              uppercase HU/EN headline stays on a single line at desktop
              sizes. sm/md keep the wrap option for narrower viewports
              where forcing one line would overflow horizontally. The
              "Eszközök · …" eyebrow that used to sit above the H1 was
              redundant (the URL + nav already place the tool); removed
              per review. */}
          <h1 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl lg:whitespace-nowrap lg:text-5xl">
            {t("tools.couple_cards.page_h1")}
          </h1>
        </div>

        {/* Fixed 4-slot row, scoped to max-w-2xl so the row sits flush
            with the centre card's width below it. Each level keeps a
            permanent slot — Level 1 always slot 1, Level 4 always slot 4
            — and the selected one is rendered as an EMPTY li (no border,
            no label), letting an open gap tell the "this card just rose
            into the centre" story without an extra placeholder shape. */}
        <h2 className="sr-only">{t("tools.couple_cards.decks_h2")}</h2>
        {/* Carousel viewport: a 4-slot wide window onto a 5-card flex row.
            The 5th card (lemonade) is tucked off the right edge until the
            row transforms left by exactly one slot — at which point
            Level 1 rotates off the left edge and lemonade rotates into
            view. Card sizes never change; the row width is fixed at
            "5 × slot + 4 × gap" via the per-li width calculation, and
            the parent overflow-hidden clips the off-screen card. */}
        <div className="mx-auto mt-8 max-w-2xl overflow-hidden sm:mt-10">
          <ul
            onPointerDown={handleSwipeStart}
            onPointerMove={handleSwipeMove}
            onPointerUp={() => {
              swipeStart.current = null;
            }}
            onPointerCancel={() => {
              swipeStart.current = null;
            }}
            onWheel={handleWheel}
            style={{
              touchAction: "pan-y",
              gap: "var(--card-gap)",
              // "none" frames the 4 reds (row shifted one slot left so the
              // off-left firstdate clears the viewport). "first" slides back
              // to 0 to reveal firstdate; "lemon" shifts two slots to reveal
              // lemonade. One slot = 25% + gap/4 of the 4-slot viewport.
              transform:
                shift === "first"
                  ? "translateX(0)"
                  : shift === "lemon"
                    ? "translateX(calc(-50% - var(--card-gap) / 2))"
                    : "translateX(calc(-25% - var(--card-gap) / 4))",
            }}
            className="flex transition-transform duration-500 ease-out [--card-gap:0.5rem] sm:[--card-gap:0.75rem]"
          >
            {COUPLE_CARD_DECKS.map((deck) => {
              const isSelected = deck.id === selectedId;
              const isLemonade = deck.id === "lemonade";
              const isFirstDate = deck.id === "firstdate";
              const isAccent = isLemonade || isFirstDate;
              return (
                <li
                  key={deck.id}
                  className="aspect-[3/2] shrink-0"
                  style={{ width: "calc((100% - 3 * var(--card-gap)) / 4)" }}
                  aria-hidden={isSelected}
                >
                  {isSelected ? null : (
                    <button
                      type="button"
                      onClick={() => {
                        // A horizontal swipe that crossed a card still
                        // dispatches a click on release; ignore it so the
                        // gesture only shifts the row, never selects.
                        if (swipeFired.current) {
                          swipeFired.current = false;
                          return;
                        }
                        onSelect(deck.id);
                      }}
                      // Accent decks (firstdate / lemonade) never participate
                      // in the centre/mini morph view transition. With a name
                      // on every tile the snapshot pulled the off-viewport
                      // accent card into frame during red-to-red swaps, so it
                      // flashed visible on swap. The red decks still morph
                      // against the centre card, same as before.
                      style={
                        isAccent
                          ? undefined
                          : ({
                              viewTransitionName: `couple-deck-${deck.id}`,
                            } as React.CSSProperties)
                      }
                      className={`group flex h-full w-full flex-col items-center justify-between overflow-hidden rounded-xl px-2 py-2 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:px-3 sm:py-3 ${
                        isLemonade
                          ? "bg-lemonade-yellow text-lemonade-ink shadow-[0_18px_36px_-18px_rgba(161,98,7,0.55)] focus-visible:ring-lemonade-yellow"
                          : isFirstDate
                            ? "bg-firstdate-blue text-white shadow-[0_18px_36px_-18px_rgba(30,58,138,0.5)] focus-visible:ring-firstdate-blue"
                            : "bg-wnrs-red text-white shadow-[0_18px_36px_-18px_rgba(204,31,40,0.5)] focus-visible:ring-wnrs-red"
                      }`}
                    >
                      <div className="flex flex-1 flex-col items-center justify-center">
                        <span className="font-display text-xs font-bold uppercase leading-[0.95] tracking-tight sm:text-base lg:text-lg">
                          {isAccent
                            ? t(deck.titleKey).toUpperCase()
                            : t("tools.couple_cards.deck_number_label", {
                                n: redLevel(deck.id),
                              })}
                        </span>
                        {!isAccent ? (
                          <span className="mt-1 hidden font-display text-[10px] font-bold uppercase tracking-[0.04em] sm:block sm:text-[11px]">
                            ({t(deck.titleKey)})
                          </span>
                        ) : null}
                      </div>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

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
              // Same rule as the mini: accent decks are outside the morph so
              // the carousel slide animation owns them cleanly. Red decks
              // still keep the mini-↔-centre morph.
              style={
                isAccentDeck(selectedId)
                  ? undefined
                  : ({
                      viewTransitionName: `couple-deck-${selectedId}`,
                    } as React.CSSProperties)
              }
              className={`relative z-10 flex aspect-[3/2] w-full flex-col items-center justify-between rounded-2xl px-7 py-8 text-center transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-umber-900 sm:px-12 sm:py-10 ${
                selectedId === "lemonade"
                  ? "bg-lemonade-yellow text-lemonade-ink shadow-[0_24px_50px_-22px_rgba(161,98,7,0.6)] focus-visible:ring-lemonade-yellow"
                  : selectedId === "firstdate"
                    ? "bg-firstdate-blue text-white shadow-[0_24px_50px_-22px_rgba(30,58,138,0.55)] focus-visible:ring-firstdate-blue"
                    : "bg-wnrs-red text-white shadow-[0_24px_50px_-22px_rgba(204,31,40,0.55)] focus-visible:ring-wnrs-red"
              }`}
            >
              <span aria-hidden="true" className="block h-1" />
              <div className="flex flex-1 flex-col items-center justify-center">
                <h3 className="font-display text-3xl font-bold uppercase leading-[0.95] tracking-tight sm:text-5xl lg:text-6xl">
                  {isAccentDeck(selectedId)
                    ? t(selected.titleKey).toUpperCase()
                    : t("tools.couple_cards.deck_number_label", { n: redLevel(selectedId) })}
                </h3>
                {!isAccentDeck(selectedId) ? (
                  <p className="mt-3 font-display text-base font-bold uppercase tracking-[0.04em] sm:mt-4 sm:text-xl">
                    ({t(selected.titleKey)})
                  </p>
                ) : null}
              </div>
              <span
                className={`font-display text-[10px] font-bold uppercase tracking-[0.28em] sm:text-xs ${
                  selectedId === "lemonade"
                    ? "text-lemonade-ink"
                    : selectedId === "firstdate"
                      ? "text-white"
                      : "text-white"
                }`}
              >
                {"WĒDDLY · "}
                {selected.questionsEn.length > 0
                  ? t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })
                  : t("tools.couple_cards.deck_soon_label")}
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
  canGoBack,
  isSuggesting,
  suggestionText,
  suggestionStatus,
  onNext,
  onPrev,
  onShuffle,
  onToggleLock,
  onFeedback,
  onBack,
  onOpenSuggestion,
  onCloseSuggestion,
  onSuggestionChange,
  onSuggestionSubmit,
}: {
  deckId: DeckId;
  deckTitle: string;
  question: string | null;
  cardNumber: number | null;
  isLocked: boolean;
  currentRating: CoupleCardRating | null;
  canGoBack: boolean;
  isSuggesting: boolean;
  suggestionText: string;
  suggestionStatus: "idle" | "submitting" | "success" | "error";
  onNext: () => void;
  onPrev: () => void;
  onShuffle: () => void;
  onToggleLock: () => void;
  onFeedback: (rating: CoupleCardRating) => void;
  onBack: () => void;
  onOpenSuggestion: () => void;
  onCloseSuggestion: () => void;
  onSuggestionChange: (value: string) => void;
  onSuggestionSubmit: () => void;
}) {
  const { t } = useT();

  // Swipe-to-navigate: left = next card, right = prev card.
  // Evaluated during pointermove (not pointerup) so the browser's scroll
  // lock (which fires pointercancel, never pointerup) doesn't swallow the gesture.
  const cardSwipeStart = useRef<{ x: number; y: number } | null>(null);
  const cardSwipeFired = useRef(false);
  const handleCardPointerDown = (e: React.PointerEvent) => {
    cardSwipeStart.current = { x: e.clientX, y: e.clientY };
    cardSwipeFired.current = false;
  };
  const handleCardPointerMove = (e: React.PointerEvent) => {
    const start = cardSwipeStart.current;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return;
    cardSwipeStart.current = null;
    cardSwipeFired.current = true;
    if (dx < 0) {
      onNext();
    } else if (canGoBack) {
      onPrev();
    }
  };
  const handleCardPointerClear = () => {
    cardSwipeStart.current = null;
  };
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
            "round complete, deck reshuffled" feedback. Suggestion mode
            shows "26 / 26" so the visitor sees the blank card is the
            26th of a 25 + 1 pack. */}
        {isSuggesting ? (
          <p className="mt-6 text-center font-display text-[11px] font-bold uppercase tracking-[0.32em] text-wnrs-red">
            {t("tools.couple_cards.card_position", {
              n: DECK_SIZE + 1,
              total: DECK_SIZE + 1,
            })}
          </p>
        ) : cardNumber !== null ? (
          <p
            className={`mt-6 text-center font-display text-[11px] font-bold uppercase tracking-[0.32em] ${
              deckId === "lemonade"
                ? "text-lemonade-ink dark:text-paper-50"
                : deckId === "firstdate"
                  ? "text-firstdate-ink dark:text-paper-50"
                  : "text-wnrs-red"
            }`}
          >
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
          {isSuggesting ? (
            <SuggestionCard
              deckTitle={deckTitle}
              text={suggestionText}
              status={suggestionStatus}
              onChange={onSuggestionChange}
              onSubmit={onSuggestionSubmit}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                if (cardSwipeFired.current) {
                  cardSwipeFired.current = false;
                  return;
                }
                onNext();
              }}
              onPointerDown={handleCardPointerDown}
              onPointerMove={handleCardPointerMove}
              onPointerUp={handleCardPointerClear}
              onPointerCancel={handleCardPointerClear}
              style={{ touchAction: "pan-y" }}
              aria-label={t("tools.couple_cards.flip_card")}
              className={`couple-card group relative flex aspect-[3/2] w-full cursor-pointer flex-col items-center justify-between rounded-[2.25rem] px-7 py-8 text-left transition-transform duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:px-12 sm:py-12 ${
                deckId === "lemonade"
                  ? "bg-lemonade-yellow shadow-[0_30px_60px_-25px_rgba(161,98,7,0.55)] ring-1 ring-lemonade-yellowInk/30 focus-visible:ring-lemonade-yellow"
                  : deckId === "firstdate"
                    ? "bg-firstdate-blue shadow-[0_30px_60px_-25px_rgba(30,58,138,0.5)] ring-1 ring-white/20 focus-visible:ring-firstdate-blue"
                    : "bg-white shadow-[0_30px_60px_-25px_rgba(28,32,56,0.35)] ring-1 ring-paper-200 focus-visible:ring-wnrs-red"
              }`}
            >
              {/* Re-mount the inner article on every card flip so the keyed
                `animate-card-deal` enter animation fires for each new
                question. Article tags also keep the page semantically
                clean — the question is the article, the button is the
                affordance around it. */}
              {/* Question fills the card and is centred on both axes. The
                  brand + deck-title line is pulled out below as an absolute
                  footer so the question sits at the true vertical middle
                  instead of being pushed up by the footer's height. */}
              <article
                key={`${deckId}-${cardNumber ?? 0}`}
                className="flex h-full w-full animate-card-deal items-center justify-center"
              >
                <p
                  data-testid="couple-card-question"
                  className={`text-balance text-center font-display text-sm font-bold uppercase leading-[1.15] tracking-[0.02em] sm:text-2xl lg:text-3xl ${
                    deckId === "lemonade"
                      ? "text-lemonade-ink"
                      : deckId === "firstdate"
                        ? "text-white"
                        : "text-wnrs-red"
                  }`}
                >
                  {question ?? t("tools.couple_cards.card_empty")}
                </p>
              </article>

              {/* Brand + deck-title footer — small and pinned low (sits in the
                  card's bottom padding), so it reads as a quiet signature
                  under the centred question. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center sm:bottom-5">
                <p
                  className={`font-display text-[9px] font-bold uppercase tracking-[0.28em] sm:text-[10px] ${
                    deckId === "lemonade"
                      ? "text-lemonade-ink"
                      : deckId === "firstdate"
                        ? "text-white"
                        : "text-wnrs-red"
                  }`}
                >
                  {/* Hard-coded already-uppercase form so the macron above
                      the E renders reliably across font weights. CSS
                      `text-transform: uppercase` was occasionally falling
                      through the font stack to a weight that didn't carry
                      the Ē glyph (U+0112). Keep in sync with app.name. */}
                  {"WĒDDLY"}
                </p>
                <p
                  className={`mt-0.5 font-display text-[8px] uppercase tracking-[0.24em] sm:text-[9px] ${
                    deckId === "lemonade"
                      ? "text-lemonade-ink/70"
                      : deckId === "firstdate"
                        ? "text-white/70"
                        : "text-wnrs-redInk"
                  }`}
                >
                  {deckTitle}
                </p>
              </div>
              {/* Lemonade-only easter-egg flair: a small lemon-slice +
                  lemonade-glass mark tucked into the bottom-left corner.
                  Inline SVG (no extra dependency) inheriting currentColor
                  so it tints with the umber text. */}
              {deckId === "lemonade" ? (
                <LemonadeGlassMark className="absolute bottom-4 left-4 text-lemonade-ink sm:bottom-6 sm:left-6" />
              ) : null}
            </button>
          )}

          {/* Left-side chrome — sm+ only. Two stacked icons:
              - ChevronLeft (previous card), disabled at the start of a
                bag round, hidden in suggestion mode.
              - PenLine (open the 26th blank suggestion card), toggles to
                X when already in suggestion mode. */}
          <div className="absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 flex-col gap-2 sm:flex sm:mr-4">
            {!isSuggesting ? (
              <button
                type="button"
                onClick={onPrev}
                disabled={!canGoBack}
                aria-label={t("tools.couple_cards.previous_card")}
                title={t("tools.couple_cards.previous_card")}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-ink-700 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700 dark:disabled:hover:bg-umber-800 dark:disabled:hover:text-paper-200"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={isSuggesting ? onCloseSuggestion : onOpenSuggestion}
              aria-label={
                isSuggesting
                  ? t("tools.couple_cards.suggest_close")
                  : t("tools.couple_cards.suggest_open")
              }
              title={
                isSuggesting
                  ? t("tools.couple_cards.suggest_close")
                  : t("tools.couple_cards.suggest_open")
              }
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              {isSuggesting ? (
                <X size={16} aria-hidden="true" />
              ) : (
                <PenLine size={16} aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Side chrome — sm+ only. Sits on the right edge of the card
              wrapper, vertically centred, two pill buttons stacked. The
              -mr lifts the stack OUT of the card so it doesn't cover any
              card content. Hidden in suggestion mode — shuffle and lock
              don't apply to the blank card. */}
          <div
            className={`absolute left-full top-1/2 ml-3 ${
              isSuggesting ? "hidden" : "hidden sm:flex"
            } -translate-y-1/2 flex-col gap-2 sm:ml-4`}
          >
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
                isLocked ? t("tools.couple_cards.unlock_view") : t("tools.couple_cards.lock_view")
              }
              title={
                isLocked ? t("tools.couple_cards.unlock_view") : t("tools.couple_cards.lock_view")
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

        {/* Mobile toolbar: the four side-rail controls (prev, suggest,
            shuffle, lock) collapse into a single horizontal row directly
            below the card on phones. The previous `fixed left-4 / right-4`
            stacks floated alongside the card and forced the aspect-[3/2]
            tile into a narrow middle strip, eating ~80 px of horizontal
            room on a 390 px viewport. With the controls below the card,
            the card itself can fill the available width while keeping
            the same aspect ratio. Hidden in suggestion mode where the
            relevant actions live inside the blank card itself. */}
        {!isSuggesting ? (
          <div className="mt-4 flex items-center justify-center gap-3 sm:hidden">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canGoBack}
              aria-label={t("tools.couple_cards.previous_card")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onOpenSuggestion}
              aria-label={t("tools.couple_cards.suggest_open")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              <PenLine size={16} aria-hidden="true" />
            </button>
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
                isLocked ? t("tools.couple_cards.unlock_view") : t("tools.couple_cards.lock_view")
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
        ) : (
          <div className="mt-4 flex justify-center sm:hidden">
            <button
              type="button"
              onClick={onCloseSuggestion}
              aria-label={t("tools.couple_cards.suggest_close")}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-paper-300 bg-white text-ink-700 shadow-md transition-all hover:bg-paper-100 hover:text-ink-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-400 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-200 dark:hover:bg-umber-700"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Rating row: three small pills under the card. Anonymous, fire
            and forget — feeds the admin curator view where bad-rated
            questions surface first. Once the visitor taps, the chosen
            pill highlights and the others fade so they read as "you've
            already voted on this one". Hidden in suggestion mode (no
            question to rate). */}
        <div className={`mt-6 ${isSuggesting ? "hidden" : "flex"} justify-center gap-2`}>
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
            meaning. Hidden in suggestion mode (the Submit button takes
            its place inside the blank card). */}
        {!isSuggesting ? (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-2 font-display text-xs font-bold uppercase tracking-[0.24em] text-ink-600 transition-colors hover:text-ink-900 dark:text-paper-200 dark:hover:text-paper-50"
            >
              {t("tools.couple_cards.next_card")}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Easter-egg flair drawn into the bottom-left corner of every Lemonade
 *  question card: a lemonade glass with a slice of lemon perched on the
 *  rim, a bendy straw, and a few bubbles rising through the drink.
 *  Inline SVG (no extra dependency) inheriting currentColor so it tints
 *  with the surrounding text. Line-art only — thinner strokes + rounded
 *  caps so it reads as a friendly hand-drawn stamp rather than a hard
 *  geometric mark. */
function LemonadeGlassMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 36 36"
      width="56"
      height="56"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Glass tumbler — softly tapered body with a rounded base curve. */}
      <path d="M11 13 Q11 12.4 11.6 12.4 L24.4 12.4 Q25 12.4 25 13 L23.4 30 Q23.2 32 21.2 32 L14.8 32 Q12.8 32 12.6 30 Z" />
      {/* Lemonade waterline, slight curve so it reads as liquid. */}
      <path d="M11.7 16.5 Q18 17.2 24.3 16.5" />
      {/* Three rising bubbles inside the drink. */}
      <circle cx="14.5" cy="22" r="0.7" />
      <circle cx="19" cy="25" r="0.55" />
      <circle cx="16.5" cy="27.5" r="0.65" />
      {/* Bendy straw — gentle S-curve from inside the glass up and out. */}
      <path d="M18 14 Q17 10 19 8 Q20.5 6.5 19.5 4.5" />
      {/* Lemon slice perched on the rim — outer rind + four radial cuts
          so it reads as a citrus cross-section. */}
      <circle cx="25.5" cy="11.5" r="4.2" />
      <line x1="25.5" y1="7.3" x2="25.5" y2="15.7" />
      <line x1="21.3" y1="11.5" x2="29.7" y2="11.5" />
      <line x1="22.5" y1="8.5" x2="28.5" y2="14.5" />
      <line x1="22.5" y1="14.5" x2="28.5" y2="8.5" />
    </svg>
  );
}

/** 26th-card blank suggestion form. Same 3:2 aspect as the question cards,
 *  but the border is dashed instead of a soft ring, signalling "this one's
 *  empty, you fill it in". Inline textarea + Submit button; status feedback
 *  (submitting / thanks / error) lives under the textarea. Hidden in normal
 *  card-flip mode. */
function SuggestionCard({
  deckTitle,
  text,
  status,
  onChange,
  onSubmit,
}: {
  deckTitle: string;
  text: string;
  status: "idle" | "submitting" | "success" | "error";
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useT();
  const canSubmit = text.trim().length >= 8 && status !== "submitting";
  return (
    <div className="couple-card relative flex aspect-[3/2] w-full flex-col items-center justify-between rounded-[2.25rem] border-2 border-dashed border-wnrs-red/40 bg-white px-7 py-8 shadow-[0_30px_60px_-25px_rgba(28,32,56,0.2)] sm:px-12 sm:py-12">
      <div className="text-center">
        <p className="font-display text-[10px] font-bold uppercase tracking-[0.28em] text-wnrs-red sm:text-xs">
          {t("tools.couple_cards.suggest_title")}
        </p>
        <p className="mt-1 font-display text-[9px] uppercase tracking-[0.24em] text-wnrs-redInk sm:text-[10px]">
          {deckTitle}
        </p>
      </div>

      <div className="flex w-full flex-1 flex-col justify-center px-1 sm:px-4">
        <p className="text-balance text-center font-display text-[11px] leading-snug text-ink-600 dark:text-umber-300 sm:text-sm">
          {t("tools.couple_cards.suggest_blurb")}
        </p>
        <textarea
          value={text}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("tools.couple_cards.suggest_placeholder")}
          maxLength={600}
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-paper-300 bg-paper-50 px-3 py-2 font-display text-sm leading-snug text-wnrs-red placeholder:text-ink-400 focus:border-wnrs-red focus:outline-none focus:ring-1 focus:ring-wnrs-red dark:border-umber-700 dark:bg-umber-800 dark:text-paper-50 dark:placeholder:text-umber-400 sm:text-base"
        />
        {status === "success" ? (
          <p className="mt-2 text-center font-display text-[11px] font-bold uppercase tracking-[0.18em] text-sage-700 sm:text-xs">
            {t("tools.couple_cards.suggest_thanks")}
          </p>
        ) : status === "error" ? (
          <p className="mt-2 text-center font-display text-[11px] font-bold uppercase tracking-[0.18em] text-wnrs-red sm:text-xs">
            {t("tools.couple_cards.suggest_error")}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="inline-flex items-center justify-center rounded-full bg-wnrs-red px-5 py-2 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-wnrs-red focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-md sm:text-xs"
      >
        {status === "submitting"
          ? t("tools.couple_cards.suggest_submitting")
          : t("tools.couple_cards.suggest_submit")}
      </button>
    </div>
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
