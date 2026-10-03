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
  /** The couple's opening line for YES, one of `MARKET_OPENING_OPTIONS`
   *  (50 = a coin flip). Fixed at creation — see `marketProbability`. */
  openingProbability: number;
  /** Derived from `pool` + `openingProbability` — see `marketProbability`. */
  probability: number;
  /** The probability's own history, oldest first — one tick recorded at
   *  question creation (the opening line, pool 0/0, see `createQuestion`) and
   *  one more on every bet (see `placeBet`), so a chart always starts flat at
   *  the opening line and bends toward whichever side the room backs.
   *  Capped server-side (`questionPriceHistory`) — a display trend, not a
   *  full audit ledger. */
  priceHistory: MarketPriceTick[];
  /** Only on a resolved question: who backed the outcome and who took home
   *  the most, for the reveal moment on the big screen and every phone.
   *  Null while open/closed/voided, or when nobody backed the winner. */
  settlement: MarketSettlement | null;
}

export interface MarketSettlement {
  winnerCount: number;
  biggestWinner: { name: string; avatar: string; profit: number } | null;
}

export interface MarketPriceTick {
  at: UnixMs;
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
  /** Fun awards derived from the ledger on every read — see `MarketTitle`. */
  titles: MarketTitle[];
}

/** Leaderboard awards, recomputed on every read so they move with the night.
 *  None of them pays points: an award that minted points would break the
 *  no-house rule (`settleMarketQuestion`), so they are bragging rights only.
 *  - `prophet`: top of the table, and actually up on the starting balance
 *  - `degenerate`: most points staked in total
 *  - `oracle`: most wins on a side that held at most a quarter of the pool
 *  - `bailout_king`: most bail-outs taken
 *  - `rock_bottom`: last place and down on the start, once 3+ are playing */
export type MarketTitle = "prophet" | "degenerate" | "oracle" | "bailout_king" | "rock_bottom";

export type MarketTeam = "bride" | "groom";
export const MARKET_TEAMS: readonly MarketTeam[] = ["bride", "groom"];

/** One placed bet, for the live ticker ("Kati put 200 on NOPE"). */
export interface MarketBetEvent {
  id: number;
  questionId: number;
  name: string;
  avatar: string;
  side: MarketSide;
  stake: number;
  at: UnixMs;
}

/** An emoji a guest fired at the room — floats up on the big screen. */
export interface MarketReaction {
  id: number;
  emoji: string;
  name: string;
  at: UnixMs;
}

export interface MarketTeamScore {
  team: MarketTeam;
  players: number;
  /** Sum of the team's balances — the only number points can't fake. */
  balance: number;
}

export interface MarketBoardSummary {
  id: number;
  title: string;
  joinCode: string;
  status: MarketBoardStatus;
  startingBalance: number;
  /** See `MarketPublicState.prize`. */
  prize: string | null;
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
  /** Live mark-to-market: `payout` once settled (the real, final number),
   *  otherwise `currentPositionValue` against the CURRENT pool — an
   *  estimate that moves as the room keeps betting, same caveat as
   *  `estimatedPayout`. Never a promise, always a "right now". */
  currentValue: number;
}

export interface MarketPublicState {
  boardTitle: string;
  hostDisplayName: string;
  status: MarketBoardStatus;
  /** What the winner gets, in the couple's own words ("picks the next
   *  song"). A real-world prize, never points. Null when none is set. */
  prize: string | null;
  questions: MarketQuestion[];
  /** Null when no player token was presented (not joined yet). */
  myBalance: number | null;
  myPositions: MyMarketPosition[];
  /** Null when not joined. */
  me: MarketMe | null;
  totalPlayers: number;
  leaderboard: MarketLeaderboardEntry[];
  /** Newest first, capped — the ticker. */
  recentBets: MarketBetEvent[];
  /** Fired within the last `MARKET_REACTION_WINDOW_MS`, oldest first. */
  reactions: MarketReaction[];
  teams: MarketTeamScore[];
}

export interface MarketMe {
  id: number;
  team: MarketTeam | null;
  /** True when the player is broke (0 points, nothing riding on an open
   *  question) and hasn't had their one pity loan yet. */
  pityAvailable: boolean;
}

// ─── constants ────────────────────────────────────────────────────────────────

export const MARKET_STARTING_BALANCE = 500;
export const MARKET_MIN_STAKE = 5;
export const MARKET_MAX_STAKE = 10_000;
export const MARKET_PROMPT_MAX = 200;
export const MARKET_TITLE_MAX = 80;
export const MARKET_PLAYER_NAME_MAX = 40;

/** Quick-bet chips on the bet slip; "all in" is the balance itself. */
export const MARKET_QUICK_STAKES: readonly number[] = [10, 50, 100];

/** Flash questions: open for this many seconds, with a countdown. */
export const MARKET_FLASH_SECONDS: readonly number[] = [60, 90, 180];
/** A question whose whole window is at most this long is shown as a flash. */
export const MARKET_FLASH_MAX_MS = 5 * 60 * 1000;

export function isFlashQuestion(q: { createdAt: UnixMs; closesAt: UnixMs }): boolean {
  return q.closesAt - q.createdAt <= MARKET_FLASH_MAX_MS;
}

/** A broke guest gets ONE loan of this many points so they can keep playing
 *  instead of spectating. It is the only place points are ever created, it
 *  is once per player, and it is small enough not to move the podium. */
export const MARKET_PITY_LOAN = 50;

/** Bailing out of a position refunds this share of the stake and frees the
 *  player to bet again, either side. The rest is BURNED, not handed to
 *  anyone: paying out the live mark-to-market value instead would let early
 *  sellers drain points the remaining pool needs to pay its winners. The
 *  haircut is also what keeps flip-flopping from being free. */
export const MARKET_BAILOUT_REFUND_PCT = 80;

export function bailoutRefund(stake: number): number {
  return Math.floor((stake * MARKET_BAILOUT_REFUND_PCT) / 100);
}

export const MARKET_REACTIONS: readonly string[] = ["😂", "🔥", "😭", "😱", "🥂", "💍", "👏", "🙈"];
export const MARKET_REACTION_WINDOW_MS = 12_000;
export const MARKET_PRIZE_MAX = 120;
export const MARKET_BULK_MAX = 30;

/** The opening lines a couple can start a question at, as YES's percent:
 *  50/50 by default, or tilted either way in steps of ten down to 10/90.
 *  Never 0 or 100 — a question nobody could win isn't a bet. */
export const MARKET_OPENING_OPTIONS: readonly number[] = [10, 20, 30, 40, 50, 60, 70, 80, 90];
export const MARKET_DEFAULT_OPENING = 50;

/** How much the opening line weighs against real stakes, in points: it acts
 *  like this many VIRTUAL points already sitting in the pool, split at the
 *  opening odds. Without it the opening would be meaningless — one 5-point
 *  bet would swing a pure pool share straight to 100%. A fifth of one
 *  guest's starting balance holds the line until the room has actually
 *  spoken, and fades to nothing once a few hundred points are in. The seed
 *  is DISPLAY ONLY: it never enters a payout, so the no-house rule below
 *  (`settleMarketQuestion`) is untouched. */
export const MARKET_OPENING_WEIGHT = 100;

export function isMarketOpening(value: unknown): value is number {
  return typeof value === "number" && MARKET_OPENING_OPTIONS.includes(value);
}

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
 *  question so far, as a whole percent, with the couple's opening line
 *  mixed in as `MARKET_OPENING_WEIGHT` virtual points. Before anyone bets it
 *  IS the opening line (50 unless the couple tilted it); as real stakes
 *  arrive they outweigh the seed and the number becomes the room's. */
export function marketProbability(
  pool: MarketPool,
  opening: number = MARKET_DEFAULT_OPENING,
): number {
  const total = pool.yes + pool.no;
  if (total <= 0) return opening;
  const seedYes = (MARKET_OPENING_WEIGHT * opening) / 100;
  return Math.round(((pool.yes + seedYes) / (total + MARKET_OPENING_WEIGHT)) * 100);
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

/** Same ratio as `estimatedPayout`, for a stake that's ALREADY sitting in
 *  `pool` rather than one about to be added — the live "what is my existing
 *  position worth right now" number a guest's bet slip shows next to their
 *  stake as the room keeps betting after them. Every other guest's stake
 *  re-weights everyone's estimate the same way theirs does; nobody's
 *  position is priced differently from anyone else's on the same side, so
 *  there is no spread between what two guests on the same side could
 *  claim their stake is "worth" — the one structural precondition for
 *  arbitrage — for this pari-mutuel pool to ever open up. */
export function currentPositionValue(pool: MarketPool, side: MarketSide, stake: number): number {
  if (stake <= 0) return 0;
  const sidePool = pool[side];
  const totalPool = pool.yes + pool.no;
  if (sidePool <= 0) return stake;
  return Math.round(stake * (totalPool / sidePool));
}

/** How far the probability has moved from the question's own opening line
 *  (the first tick — see `createQuestion`), in percentage points. This is the
 *  "since open" momentum shown next to the big number on both the couple's
 *  board and the guest's play screen. Null before anyone has bet, or if the
 *  room has moved it right back to 50/50, so the chip has something real to
 *  report or doesn't render at all — never a printed "+0%". */
export function trendSinceOpen(ticks: readonly MarketPriceTick[]): number | null {
  if (ticks.length < 2) return null;
  const delta = ticks[ticks.length - 1]!.probability - ticks[0]!.probability;
  return delta === 0 ? null : delta;
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
