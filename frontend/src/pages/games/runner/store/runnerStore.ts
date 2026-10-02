/**
 * The HUD's own state.
 *
 * THE ENGINE IS NOT IN HERE, and that is the whole design. `RunEngine` is a
 * mutable simulation that has to be stepped at 60 Hz; putting it in a Zustand
 * store would mean either re-rendering every subscriber sixty times a second or
 * keeping it outside the store anyway.
 * (The store itself is a tiny `useSyncExternalStore` wrapper below rather than
 * Zustand: the repo's rule is no state library, and this needs ~20 lines.) So the store holds only what React
 * genuinely needs to re-render for — the numbers the HUD prints, the phase, the
 * currency — and the engine stays a plain object the page owns.
 *
 * The HUD subscribes to a SNAPSHOT of engine state, pushed at about 12 Hz through
 * `onTick`. Twelve is chosen rather than tuned: a score counter cannot be read
 * faster than about 8 Hz, so the frames in between would buy nothing and cost a
 * DOM render each.
 */

import { useSyncExternalStore } from "react";
import {
  MILESTONES,
  POWERUP_SECONDS,
  SPEED_MAX,
  SPEED_START,
  START_HEARTS,
  STREAK_WINDOW,
  multiplierAt,
  nextMilestoneAt,
  verdictFor,
  weddingProfit,
} from "@shared/runner";
import type { Currency } from "@shared/types";
import type { RunnerCharacter, RunState, RunSummary, TickExtras } from "../engine/RunEngine";

/** Everything the HUD renders. Derived in ONE place per tick, so the live HUD and
 *  the game-over card cannot show a profit and a verdict computed from different
 *  numbers. */
export interface RunnerHud {
  phase: RunState["phase"];
  /** Raw cash collected, before the multiplier and before expenses. */
  cash: number;
  /** What the couple is actually WORSE off by, in the couple's currency. This is
   *  the number the game is about, so it is the number the HUD leads with. */
  profit: number;
  bags: number;
  distance: number;
  hits: number;
  hearts: number;
  multiplier: number;
  currency: Currency;
  verdict: ReturnType<typeof verdictFor>;
  /** 1 → 0 right after a milestone, for the "×3!" pop. */
  milestonePulse: number;
  /** Pickups in a row, and how much of the streak window is left (0..1). */
  combo: number;
  comboLeft: number;
  /** Each power-up's remaining time as a fraction of its full length (0..1). */
  magnet: number;
  doubler: number;
  shield: number;
  /** Whole seconds of 3-2-1 left; 0 once the run is moving. */
  countdown: number;
  /** 0 at the opening speed, 1 at the top: drives the speed lines. */
  speedT: number;
  /** 0..1 progress from the current multiplier step to the next; 1 at the top. */
  toNext: number;
  /** The multiplier the next step pays, or null at the top of the ladder. */
  nextMultiplier: number | null;
  /** The most recent hit: which vendor, what it cost. Drives the hit toast. */
  lastHit: RunState["lastHit"];
}

export interface RunnerStore extends RunnerHud {
  /** The best profit this couple has finished on THIS device, IN THIS CURRENCY.
   *  Read for the "new best" line on the game-over card. */
  best: number | null;
  /** The finished run, held so the game-over card has the full summary rather
   *  than a snapshot that keeps ticking behind the overlay. */
  summary: RunSummary | null;
  /** True when the run that just finished was this device's first. The copy needs
   *  it: "new best" and "your first run" are different sentences, and a first run
   *  that beat a zero baseline would otherwise claim a record nobody earned. */
  firstRun: boolean;
  /** The couple's own currency, resolved from their workspace before the first
   *  frame. `null` until it lands, which the menu shows rather than guessing. */
  currency: Currency;
  /** True once the couple lookup has resolved either way. */
  ready: boolean;
  /** Which half of the couple the player is. Picked on the menu, and REMEMBERED
   *  between visits for the same reason the best score is: it is an identity
   *  choice, not a per-run toggle, and asking again on every visit would read as
   *  the app having forgotten. */
  character: RunnerCharacter;
  setCharacter: (character: RunnerCharacter) => void;
  /** How the player plays. Decided by what the device reports; the HUD's control
   *  hints read this rather than running their own media query. */
  touch: boolean;

  setReady: (currency: Currency, touch: boolean) => void;
  /** Called from `onTick`. Recomputes the whole snapshot. */
  tick: (state: RunState, extra: TickExtras, currency: Currency) => void;
  /** Called when a run finishes: freezes the summary and banks a new best. */
  finish: (summary: RunSummary) => void;
  /** Cleared when the player starts another run. The engine's own reset is the
   *  page's job; this only clears the DOM half. */
  reset: () => void;
}

const BEST_KEY = "weddly.runner.best";
const CHARACTER_KEY = "weddly.runner.character";

/** The remembered character. A corrupt or absent value falls back to the bride
 *  rather than throwing, on the same grounds as `readBest`: a bad localStorage
 *  entry must never be the reason the game will not start. */
function readCharacter(): RunnerCharacter {
  try {
    return localStorage.getItem(CHARACTER_KEY) === "groom" ? "groom" : "bride";
  } catch {
    return "bride";
  }
}

/** The stored best is PER CURRENCY, not one global number. A best of 412 000
 *  forints is meaningless beside a €40 best: comparing the two raw numbers would
 *  hand a forint couple a record they never earned and give a euro couple a bar
 *  they can never clear. One key per currency is the only honest version. */
const bestKey = (currency: Currency) => `${BEST_KEY}.${currency}`;

function readBest(currency: Currency): number | null {
  try {
    const raw = localStorage.getItem(bestKey(currency));
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    // A blocked or full localStorage must never stop the game from running.
    return null;
  }
}

function writeBest(currency: Currency, value: number) {
  try {
    localStorage.setItem(bestKey(currency), String(Math.round(value)));
  } catch {
    /* best effort, same reason as readBest */
  }
}

/** The counters the HUD is derived from — the intersection of `RunState` and
 *  `RunSummary`. Naming the slice rather than passing either whole object is what
 *  lets the LIVE tick and the FINISHED run go through ONE derivation: a caller
 *  that handed over `RunState` would force `finish` to invent a fake state, and a
 *  caller that handed over `RunSummary` would force `tick` to invent one too. */
export type HudCounters = Pick<
  RunState,
  "phase" | "cash" | "bags" | "hits" | "hearts" | "multiplier" | "distance"
> &
  Partial<
    Pick<
      RunState,
      | "combo"
      | "comboTimer"
      | "magnet"
      | "doubler"
      | "shield"
      | "countdown"
      | "cruiseSpeed"
      | "expenses"
      | "lastHit"
    >
  >;

/** Where a distance sits between the current multiplier step and the next. */
function milestoneProgress(distance: number): { toNext: number; nextMultiplier: number | null } {
  const next = nextMilestoneAt(distance);
  if (!next) return { toNext: 1, nextMultiplier: null };
  const current = multiplierAt(distance);
  const from = MILESTONES.find((m) => m.multiplier === current)?.at ?? 0;
  const span = Math.max(1, next.at - from);
  return {
    toNext: Math.min(1, Math.max(0, (distance - from) / span)),
    nextMultiplier: next.multiplier,
  };
}

/** The HUD snapshot from the raw counters. Pure and exported so a test can prove
 *  the live HUD and the game-over card agree without rendering anything — and
 *  because every consumer of these numbers has to go through it. */
export function deriveHud(
  state: HudCounters,
  currency: Currency,
  milestonePulse: number,
): RunnerHud {
  const profit = weddingProfit(
    { cash: state.cash, bags: state.bags, hits: state.hits, currency, expenses: state.expenses },
    state.multiplier,
  );
  return {
    phase: state.phase,
    cash: state.cash,
    profit,
    bags: state.bags,
    distance: Math.floor(state.distance),
    hits: state.hits,
    hearts: state.hearts,
    multiplier: state.multiplier,
    currency,
    verdict: verdictFor(profit, currency),
    milestonePulse,
    combo: state.combo ?? 0,
    comboLeft: Math.min(1, (state.comboTimer ?? 0) / STREAK_WINDOW),
    magnet: Math.min(1, (state.magnet ?? 0) / POWERUP_SECONDS.magnet),
    doubler: Math.min(1, (state.doubler ?? 0) / POWERUP_SECONDS.double),
    shield: Math.min(1, (state.shield ?? 0) / POWERUP_SECONDS.shield),
    countdown: Math.ceil(state.countdown ?? 0),
    lastHit: state.lastHit ?? null,
    speedT: Math.min(
      1,
      Math.max(0, ((state.cruiseSpeed ?? SPEED_START) - SPEED_START) / (SPEED_MAX - SPEED_START)),
    ),
    ...milestoneProgress(state.distance),
  };
}

const BLANK: RunnerHud = {
  phase: "menu",
  cash: 0,
  profit: 0,
  bags: 0,
  distance: 0,
  hits: 0,
  hearts: START_HEARTS,
  multiplier: 1,
  currency: "HUF",
  verdict: "bankrupt",
  milestonePulse: 0,
  combo: 0,
  comboLeft: 0,
  magnet: 0,
  doubler: 0,
  shield: 0,
  countdown: 0,
  speedT: 0,
  toNext: 0,
  nextMultiplier: 2,
  lastHit: null,
};

type SetState<T> = (partial: Partial<T>) => void;
type GetState<T> = () => T;

/** A minimal external store with the selector-hook shape the HUD reads:
 *  `useRunnerStore(selector)`, plus `getState` / `setState` for the page and
 *  the tests. Selectors here only pick single fields, so returning the slice
 *  directly is stable under `useSyncExternalStore`'s snapshot comparison. */
function createStore<T>(init: (set: SetState<T>, get: GetState<T>) => T) {
  let state: T;
  const listeners = new Set<() => void>();
  const get: GetState<T> = () => state;
  const set: SetState<T> = (partial) => {
    state = { ...state, ...partial };
    for (const l of listeners) l();
  };
  state = init(set, get);
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  function useStore<S>(selector: (s: T) => S): S {
    return useSyncExternalStore(
      subscribe,
      () => selector(state),
      () => selector(state),
    );
  }
  return Object.assign(useStore, { getState: get, setState: set, subscribe });
}

export const useRunnerStore = createStore<RunnerStore>((set, get) => ({
  ...BLANK,
  best: null,
  summary: null,
  firstRun: false,
  currency: "HUF",
  ready: false,
  touch: false,
  character: "bride",

  setReady: (currency, touch) =>
    set({ currency, ready: true, touch, best: readBest(currency), character: readCharacter() }),

  setCharacter: (character) => {
    // Mirrored straight into localStorage rather than through the engine alone:
    // the engine is thrown away on every reload, so without this the choice
    // would silently reset to the bride every time the page is opened.
    try {
      localStorage.setItem(CHARACTER_KEY, character);
    } catch {
      /* best effort, same reason as writeBest */
    }
    set({ character });
  },

  tick: (state, extra, currency) => set(deriveHud(state, currency, extra.milestonePulse)),

  finish: (summary) => {
    const previous = get().best;
    const isBest = previous === null || summary.profit > previous;
    // Bank it the moment the run ends, not when the card is dismissed: closing
    // the tab on the verdict must not lose the record.
    if (isBest) writeBest(summary.currency, summary.profit);
    set({
      summary,
      best: isBest ? summary.profit : previous,
      firstRun: previous === null,
      // The SAME derivation as the live tick. A finished run has no hearts left
      // and no phase of its own beyond "over", and both are stated here rather
      // than defaulted somewhere else.
      ...deriveHud(
        {
          phase: "over",
          cash: summary.cash,
          bags: summary.bags,
          hits: summary.hits,
          hearts: 0,
          multiplier: summary.multiplier,
          distance: summary.distance,
          expenses: summary.expenses,
        },
        summary.currency,
        0,
      ),
    });
  },

  reset: () =>
    set({
      ...BLANK,
      currency: get().currency,
      best: get().best,
      touch: get().touch,
      character: get().character,
      ready: true,
      summary: null,
      firstRun: false,
    }),
}));

export { bestKey as runnerBestKey, CHARACTER_KEY };
