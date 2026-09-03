// Live wedding prediction markets — a couple authors a set of Yes/No
// questions about their own wedding ("will the groom cry during the vows?"),
// shares one board with their guests via a join code (no login), and the
// room bets points on the outcome. Sibling feature to shared/quiz.ts under
// the same "Wēddly Games" umbrella — same guest posture (no account, an
// ad-hoc name+avatar identity scoped to the board, plain token not hashed:
// a party game, not auth) and the same QUIZ_AVATARS cast so the two games
// feel like one room.
//
// STATUS IS DERIVED, NEVER STORED, same rule `quizAnswersOpen` follows in
// quiz.ts and `holdState` follows in date_holds.ts. What the DB keeps is
// `closes_at` plus `outcome`/`voided_at`; whether a question still takes bets
// is computed against `now` on every read, so a closing time needs no cron.
//
// THE PAYOUT MODEL IS PARI-MUTUEL POOLED BETTING, not a fixed-odds exchange.
// Every YES stake and every NO stake on a question just adds to that side's
// pool. The displayed "probability" is nothing but the YES pool's share of
// the total — it moves on its own as people bet, with no market-maker
// setting a price. On resolution the LOSING side's whole pool is handed to
// the winners, split in proportion to their own stake. This is deliberate:
// there is no real money and no house backing this game, so a fixed-price
// model (buy a share at the quoted probability, same as Polymarket/Kalshi)
// would need somebody willing to always sell at that price — and be on the
// hook if the crowd is right. Pari-mutuel can't go insolvent: payouts always
// sum to exactly what was staked, because nothing is ever created, only
// redistributed. See `settleMarketQuestion` below.

import { QUIZ_AVATARS } from "./quiz";
import type { UnixMs } from "./types";

export type MarketSide = "yes" | "no";
export type MarketOutcome = MarketSide;
export type MarketQuestionStatus = "open" | "closed" | "resolved" | "voided";
export type MarketBoardStatus = "draft" | "live" | "ended";

export interface MarketPool {
  yes: number;
  no: number;
}

// ─── domain objects ──────────────────────────────────────────────────────────

export interface MarketQuestion {
  id: number;
  boardId: number;
  prompt: string;
  closesAt: UnixMs;
  outcome: MarketOutcome | null;
  resolvedAt: UnixMs | null;
  voidedAt: UnixMs | null;
  createdAt: UnixMs;
  updatedAt: UnixMs;
  /** Total points staked on each side right now. */
  pool: MarketPool;
  /** Derived from closesAt/outcome/voidedAt — see `marketQuestionStatus`. */
  status: MarketQuestionStatus;
  /** Derived from `pool` — see `marketProbability`. */
  probability: number;
}

export interface MarketPlayer {
  id: number;
  boardId: number;
  name: string;
  avatar: string;
  balance: number;
  joinedAt: UnixMs;
}

export interface MarketLeaderboardEntry {
  player: MarketPlayer;
  rank: number;
}

export interface MarketBoardSummary {
  id: number;
  title: string;
  joinCode: string;
  status: MarketBoardStatus;
  startingBalance: number;
  questionCount: number;
  playerCount: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface MarketBoardDetail extends MarketBoardSummary {
  questions: MarketQuestion[];
}

// ─── guest-facing public state ─────────────────────────────────────────────────

export interface MyMarketPosition {
  questionId: number;
  side: MarketSide;
  stake: number;
  /** Set once the question resolves/voids — the TOTAL credited back, not
   *  profit. Null while the question is still open or closed-but-unresolved. */
  payout: number | null;
}

export interface MarketPublicState {
  boardTitle: string;
  hostDisplayName: string;
  status: MarketBoardStatus;
  questions: MarketQuestion[];
  /** Null when no player token was presented (not joined yet). */
  myBalance: number | null;
  myPositions: MyMarketPosition[];
  totalPlayers: number;
  leaderboard: MarketLeaderboardEntry[];
}

// ─── constants ────────────────────────────────────────────────────────────────

export const MARKET_STARTING_BALANCE = 500;
export const MARKET_MIN_STAKE = 5;
export const MARKET_MAX_STAKE = 10_000;
export const MARKET_PROMPT_MAX = 200;
export const MARKET_TITLE_MAX = 80;
export const MARKET_PLAYER_NAME_MAX = 40;

// Same alphabet as quiz.ts's QUIZ_JOIN_CODE_ALPHABET (avoids 0/O/1/I/L — read
// off a phone across a room and typed by hand) and invite_codes.ts's
// household codes, so every "read this code out loud" surface in the app
// looks and behaves the same way.
export const MARKET_JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const MARKET_JOIN_CODE_LENGTH = 6;

/** Same cast of characters as the quiz join screen — one wedding, one guest
 *  list of avatars, whichever game they're playing. */
export const MARKET_AVATARS: readonly string[] = QUIZ_AVATARS;

// ─── question status (derived) ─────────────────────────────────────────────────

export interface MarketQuestionFacts {
  closesAt: UnixMs;
  outcome: MarketOutcome | null;
  voidedAt: UnixMs | null;
}

/** `voided` and `resolved` are permanent end states set by a deliberate
 *  couple action, so they outrank the clock even if `closesAt` hasn't
 *  arrived yet (a couple can void or resolve a question early — see
 *  domain/markets.ts). Otherwise it's `closed` the instant `now` reaches
 *  `closesAt` and `open` before that. */
export function marketQuestionStatus(q: MarketQuestionFacts, nowMs: UnixMs): MarketQuestionStatus {
  if (q.voidedAt !== null) return "voided";
  if (q.outcome !== null) return "resolved";
  if (nowMs >= q.closesAt) return "closed";
  return "open";
}

// ─── the math ─────────────────────────────────────────────────────────────────

/** The pool's implied probability: YES's share of everything staked on this
 *  question so far, as a whole percent. 50 (a coin flip) is the "nobody has
 *  bet yet" default — there is no signal to report, not a 0% chance. */
export function marketProbability(pool: MarketPool): number {
  const total = pool.yes + pool.no;
  if (total <= 0) return 50;
  return Math.round((pool.yes / total) * 100);
}

/** What `stake` more points on `side` would be worth back if the pools froze
 *  at this instant and `side` won: your stake's share of the (post-stake)
 *  total pool. This is always an ESTIMATE while a question is open — it can
 *  only move as more guests bet before close, in either direction, because a
 *  pari-mutuel payout ratio isn't fixed until the pool itself stops moving.
 *  Callers should label this "estimated" rather than promise it; the real
 *  number is only known at `settleMarketQuestion` time. */
export function estimatedPayout(pool: MarketPool, side: MarketSide, stake: number): number {
  if (stake <= 0) return 0;
  const after: MarketPool = { ...pool, [side]: pool[side] + stake };
  const sidePool = after[side];
  const totalPool = after.yes + after.no;
  if (sidePool <= 0) return stake;
  return Math.round(stake * (totalPool / sidePool));
}

export interface MarketPosition {
  playerId: number;
  side: MarketSide;
  stake: number;
}

/** Settle a resolved question: split the LOSING side's pool across the
 *  winners, each getting their own stake back plus a share of the losing
 *  pool proportional to how much of the winning pool was theirs. Returns
 *  every affected player's payout (their stake back plus winnings, i.e. the
 *  TOTAL credited to their balance — not "profit"; profit is payout minus
 *  their original stake).
 *
 *  Payouts always sum to exactly the total staked on the question: there is
 *  no house, so a resolution can only redistribute points, never create or
 *  destroy them (aside from per-position rounding, at most ±1 point, which
 *  is immaterial for a points-only game with no real-money settlement).
 *
 *  When NOBODY backed the outcome that happened, there is no winning pool to
 *  split — every stake is refunded instead of vanishing into a house that
 *  doesn't exist. This mirrors `voidQuestion` in domain/markets.ts, which is
 *  the couple's own manual version of the same refund (used when a moment
 *  never happened, or the question turned out unanswerable). */
export function settleMarketQuestion(
  positions: readonly MarketPosition[],
  outcome: MarketOutcome,
): Map<number, number> {
  const winningPool = positions
    .filter((p) => p.side === outcome)
    .reduce((sum, p) => sum + p.stake, 0);
  const losingPool = positions
    .filter((p) => p.side !== outcome)
    .reduce((sum, p) => sum + p.stake, 0);

  const payouts = new Map<number, number>();
  const credit = (playerId: number, amount: number) =>
    payouts.set(playerId, (payouts.get(playerId) ?? 0) + amount);

  if (winningPool <= 0) {
    for (const p of positions) credit(p.playerId, p.stake);
    return payouts;
  }
  for (const p of positions) {
    if (p.side !== outcome) continue;
    const share = p.stake / winningPool;
    credit(p.playerId, Math.round(p.stake + share * losingPool));
  }
  return payouts;
}

/** Refund every stake on a question with nobody winning or losing — the
 *  couple voided it (the moment never happened, the question turned out
 *  unanswerable, ...). Same shape as the nobody-backed-the-winner branch of
 *  `settleMarketQuestion`, pulled out under its own name so a call site
 *  reads as "void", not as a settlement with a coincidental empty pool. */
export function voidMarketQuestion(positions: readonly MarketPosition[]): Map<number, number> {
  const payouts = new Map<number, number>();
  for (const p of positions) payouts.set(p.playerId, (payouts.get(p.playerId) ?? 0) + p.stake);
  return payouts;
}
