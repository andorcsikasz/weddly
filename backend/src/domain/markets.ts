// Live wedding prediction markets — couple-authoring domain logic. Guest-
// facing (public, no-auth) logic lives in domain/markets_play.ts, which
// imports the row→DTO mappers and pool math from here rather than
// duplicating them, so the couple's own management screen and a guest's
// screen can never read the same rows two different ways. Mirrors the split
// in domain/quiz.ts / domain/quiz_play.ts.

import { randomBytes } from "node:crypto";
import {
  MARKET_JOIN_CODE_ALPHABET,
  MARKET_DEFAULT_OPENING,
  MARKET_JOIN_CODE_LENGTH,
  MARKET_PROMPT_MAX,
  MARKET_STARTING_BALANCE,
  MARKET_TITLE_MAX,
  isMarketOpening,
  marketProbability,
  marketQuestionStatus,
  settleMarketQuestion,
  voidMarketQuestion,
  type MarketBoardDetail,
  type MarketBoardStatus,
  type MarketBoardSummary,
  type MarketLeaderboardEntry,
  type MarketOutcome,
  type MarketPlayer,
  type MarketPool,
  type MarketPosition,
  type MarketPriceTick,
  type MarketQuestion,
  type MarketSettlement,
  type MarketSide,
  type MarketTeam,
  type MarketTitle,
  MARKET_BULK_MAX,
  MARKET_PRIZE_MAX,
} from "@shared/markets";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

// ─── row shapes ────────────────────────────────────────────────────────────────

export interface MarketBoardRow {
  id: number;
  couple_id: number;
  title: string;
  join_code: string;
  status: MarketBoardStatus;
  starting_balance: number;
  prize: string | null;
  created_at: number;
  updated_at: number;
}

export interface MarketQuestionRow {
  id: number;
  board_id: number;
  prompt: string;
  closes_at: number;
  opening_probability: number;
  outcome: MarketOutcome | null;
  resolved_at: number | null;
  voided_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface MarketPlayerRow {
  id: number;
  board_id: number;
  token: string;
  name: string;
  avatar: string;
  balance: number;
  team: MarketTeam | null;
  pity_loans: number;
  bailouts: number;
  joined_at: number;
  last_seen_at: number;
  removed_at: number | null;
}

export interface MarketPositionRow {
  id: number;
  question_id: number;
  player_id: number;
  side: "yes" | "no";
  stake: number;
  payout: number | null;
  created_at: number;
  updated_at: number;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

export function questionPool(questionId: number): MarketPool {
  const rows = db
    .prepare(
      "SELECT side, COALESCE(SUM(stake), 0) AS total FROM market_positions WHERE question_id = ? GROUP BY side",
    )
    .all(questionId) as { side: "yes" | "no"; total: number }[];
  const pool: MarketPool = { yes: 0, no: 0 };
  for (const row of rows) pool[row.side] = row.total;
  return pool;
}

// A display trend, not a full audit ledger — see the schema.sql comment on
// market_price_ticks. Capped well past anything a wedding-scale board could
// realistically produce (one tick per bet), so a busy board's chart is
// still complete, not just recent.
const PRICE_HISTORY_LIMIT = 300;

export function questionPriceHistory(questionId: number): MarketPriceTick[] {
  const rows = db
    .prepare(
      `SELECT probability, at FROM market_price_ticks
        WHERE question_id = ? ORDER BY at ASC LIMIT ?`,
    )
    .all(questionId, PRICE_HISTORY_LIMIT) as { probability: number; at: number }[];
  return rows.map((r) => ({ at: r.at, probability: r.probability }));
}

/** Records where the probability stands right now — called inside the SAME
 *  transaction as whatever just moved `pool` (question creation, a bet), so
 *  a tick can never exist without the write that produced it or vice versa.
 *  See `MarketPriceTick` in shared/markets.ts for why this table exists at
 *  all instead of deriving history from market_positions. */
export function recordPriceTick(
  questionId: number,
  pool: MarketPool,
  opening: number,
  at: number,
  bet?: { playerId: number; side: MarketSide; stake: number },
): void {
  db.prepare(
    `INSERT INTO market_price_ticks (question_id, probability, pool_yes, pool_no, at, player_id, side, stake)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    questionId,
    marketProbability(pool, opening),
    pool.yes,
    pool.no,
    at,
    bet?.playerId ?? null,
    bet?.side ?? null,
    bet?.stake ?? null,
  );
}

/** The reveal-moment summary: how many backed the outcome and who profited
 *  most. Read off the stamped `payout`s, so it is the settled truth rather
 *  than a recomputation that could disagree with what was credited. */
function questionSettlement(row: MarketQuestionRow): MarketSettlement | null {
  if (row.outcome === null) return null;
  const winners = db
    .prepare(
      `SELECT pl.name AS name, pl.avatar AS avatar, mp.payout - mp.stake AS profit
         FROM market_positions mp JOIN market_players pl ON pl.id = mp.player_id
        WHERE mp.question_id = ? AND mp.side = ? AND mp.payout IS NOT NULL
        ORDER BY profit DESC, mp.created_at ASC`,
    )
    .all(row.id, row.outcome) as { name: string; avatar: string; profit: number }[];
  if (winners.length === 0) return null;
  const top = winners[0]!;
  return {
    winnerCount: winners.length,
    // Everyone on one side means nobody lost and nobody won anything; "+0"
    // on the big screen is not a moment worth naming anyone for.
    biggestWinner:
      top.profit > 0 ? { name: top.name, avatar: top.avatar, profit: top.profit } : null,
  };
}

export function toMarketQuestion(row: MarketQuestionRow): MarketQuestion {
  const pool = questionPool(row.id);
  return {
    id: row.id,
    boardId: row.board_id,
    prompt: row.prompt,
    closesAt: row.closes_at,
    openingProbability: row.opening_probability,
    outcome: row.outcome,
    resolvedAt: row.resolved_at,
    voidedAt: row.voided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pool,
    status: marketQuestionStatus(
      { closesAt: row.closes_at, outcome: row.outcome, voidedAt: row.voided_at },
      now(),
    ),
    probability: marketProbability(pool, row.opening_probability),
    priceHistory: questionPriceHistory(row.id),
    settlement: questionSettlement(row),
  };
}

export function toMarketPlayer(row: MarketPlayerRow): MarketPlayer {
  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    avatar: row.avatar,
    balance: row.balance,
    joinedAt: row.joined_at,
  };
}

export function toMarketBoardSummary(row: MarketBoardRow): MarketBoardSummary {
  return {
    id: row.id,
    title: row.title,
    joinCode: row.join_code,
    status: row.status,
    startingBalance: row.starting_balance,
    prize: row.prize,
    questionCount: countQuestions(row.id),
    playerCount: countPlayers(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toMarketBoardDetail(row: MarketBoardRow): MarketBoardDetail {
  return { ...toMarketBoardSummary(row), questions: listQuestions(row.id).map(toMarketQuestion) };
}

// ─── input validation ──────────────────────────────────────────────────────────
// Hand-validated at the boundary, no runtime schema library — same convention
// as domain/quiz.ts and every other feature route.

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new HttpError(400, `${field} must be a non-empty string (max ${max} chars)`);
  }
  return value.trim();
}

export function parseBoardTitle(raw: unknown): string {
  return requireString(raw, "title", MARKET_TITLE_MAX);
}

export function parseQuestionPrompt(raw: unknown): string {
  return requireString(raw, "prompt", MARKET_PROMPT_MAX);
}

/** `closesAt` just needs to be a real, non-past instant — how far out is the
 *  couple's call (a card that closes in 3 minutes for a moment about to
 *  happen at the reception is completely normal). */
export function parseClosesAt(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw new HttpError(400, "closesAt must be a unix-ms integer");
  }
  if (raw <= now()) throw new HttpError(400, "closesAt must be in the future");
  return raw;
}

/** Optional on the body: absent means the coin flip. Anything else must be
 *  one of the offered steps, so a hand-rolled request can't open a question
 *  at 0% or 100%. */
export function parseOpeningProbability(raw: unknown): number {
  if (raw === undefined || raw === null) return MARKET_DEFAULT_OPENING;
  if (!isMarketOpening(raw)) {
    throw new HttpError(400, "openingProbability must be one of 10, 20, ... 90");
  }
  return raw;
}

/** Absent leaves the prize alone; null or an empty string clears it. */
export function parsePrize(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > MARKET_PRIZE_MAX) {
    throw new HttpError(400, `prize must be a string (max ${MARKET_PRIZE_MAX} chars)`);
  }
  return raw.trim() || null;
}

export interface BulkQuestionInput {
  prompt: string;
  openingProbability: number;
}

/** A question pack arrives as a list; each entry is validated with the same
 *  rules as a single add, so a pack can never smuggle in what the form
 *  can't. */
export function parseBulkQuestions(raw: unknown): BulkQuestionInput[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MARKET_BULK_MAX) {
    throw new HttpError(400, `questions must be a list of 1-${MARKET_BULK_MAX}`);
  }
  return raw.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    return {
      prompt: parseQuestionPrompt(obj.prompt),
      openingProbability: parseOpeningProbability(obj.openingProbability),
    };
  });
}

// ─── join codes ────────────────────────────────────────────────────────────────

export function generateMarketJoinCode(): string {
  const bytes = randomBytes(MARKET_JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < MARKET_JOIN_CODE_LENGTH; i++) {
    out += MARKET_JOIN_CODE_ALPHABET[bytes[i]! % MARKET_JOIN_CODE_ALPHABET.length];
  }
  return out;
}

function uniqueJoinCode(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateMarketJoinCode();
    const taken = db.prepare("SELECT 1 FROM market_boards WHERE join_code = ?").get(code);
    if (!taken) return code;
  }
  throw new HttpError(500, "Could not allocate a join code, try again");
}

export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// ─── couple-scoped reads ────────────────────────────────────────────────────────

export function listBoardsForCouple(coupleId: number): MarketBoardSummary[] {
  const rows = db
    .prepare("SELECT * FROM market_boards WHERE couple_id = ? ORDER BY created_at ASC")
    .all(coupleId) as MarketBoardRow[];
  return rows.map(toMarketBoardSummary);
}

export function getBoardScoped(id: number, coupleId: number): MarketBoardRow | undefined {
  return db
    .prepare("SELECT * FROM market_boards WHERE id = ? AND couple_id = ?")
    .get(id, coupleId) as MarketBoardRow | undefined;
}

export function getBoardByCode(code: string): MarketBoardRow | undefined {
  return db.prepare("SELECT * FROM market_boards WHERE join_code = ?").get(code) as
    | MarketBoardRow
    | undefined;
}

function countQuestions(boardId: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM market_questions WHERE board_id = ?").get(boardId) as {
      c: number;
    }
  ).c;
}

function countPlayers(boardId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM market_players WHERE board_id = ? AND removed_at IS NULL")
      .get(boardId) as { c: number }
  ).c;
}

export function listQuestions(boardId: number): MarketQuestionRow[] {
  return db
    .prepare("SELECT * FROM market_questions WHERE board_id = ? ORDER BY created_at ASC")
    .all(boardId) as MarketQuestionRow[];
}

export function getQuestionScoped(
  boardId: number,
  questionId: number,
): MarketQuestionRow | undefined {
  return db
    .prepare("SELECT * FROM market_questions WHERE id = ? AND board_id = ?")
    .get(questionId, boardId) as MarketQuestionRow | undefined;
}

function positionsForQuestion(questionId: number): MarketPositionRow[] {
  return db
    .prepare("SELECT * FROM market_positions WHERE question_id = ?")
    .all(questionId) as MarketPositionRow[];
}

// ─── couple-scoped writes ───────────────────────────────────────────────────────

export function createBoard(coupleId: number, title: string): MarketBoardRow {
  const ts = now();
  return db
    .prepare(
      `INSERT INTO market_boards (couple_id, title, join_code, status, starting_balance, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?) RETURNING *`,
    )
    .get(coupleId, title, uniqueJoinCode(), MARKET_STARTING_BALANCE, ts, ts) as MarketBoardRow;
}

/** The couple's board, creating it on first use. The page used to list and
 *  then create from the browser, so any double mount (React StrictMode in
 *  dev, a quick back-and-forward) ran that twice and left the couple with two
 *  boards, the second one invisible. Fully synchronous, so two requests can't
 *  interleave between the read and the insert. */
export function ensureBoard(
  coupleId: number,
  title: string,
): { row: MarketBoardRow; created: boolean } {
  const existing = db
    .prepare(
      "SELECT * FROM market_boards WHERE couple_id = ? ORDER BY created_at ASC, id ASC LIMIT 1",
    )
    .get(coupleId) as MarketBoardRow | null;
  if (existing) return { row: existing, created: false };
  return { row: createBoard(coupleId, title), created: true };
}

export function updateBoardTitle(id: number, coupleId: number, title: string): MarketBoardRow {
  const row = db
    .prepare(
      "UPDATE market_boards SET title = ?, updated_at = ? WHERE id = ? AND couple_id = ? RETURNING *",
    )
    .get(title, now(), id, coupleId) as MarketBoardRow | undefined;
  if (!row) throw new HttpError(404, "Board not found");
  return row;
}

export function updateBoardPrize(
  id: number,
  coupleId: number,
  prize: string | null,
): MarketBoardRow {
  const row = db
    .prepare(
      "UPDATE market_boards SET prize = ?, updated_at = ? WHERE id = ? AND couple_id = ? RETURNING *",
    )
    .get(prize, now(), id, coupleId) as MarketBoardRow | undefined;
  if (!row) throw new HttpError(404, "Board not found");
  return row;
}

export function deleteBoard(id: number, coupleId: number): void {
  const result = db
    .prepare("DELETE FROM market_boards WHERE id = ? AND couple_id = ?")
    .run(id, coupleId);
  if (result.changes === 0) throw new HttpError(404, "Board not found");
}

/** `draft` -> `live`: guests can now find the board via its join code. Needs
 *  at least one question, same guard `startQuiz` applies to slides — sharing
 *  a link to an empty board would just confuse whoever scans it. */
export function startBoard(board: MarketBoardRow): MarketBoardRow {
  if (countQuestions(board.id) === 0) {
    throw new HttpError(400, "Add at least one question before sharing the board");
  }
  return db
    .prepare("UPDATE market_boards SET status = 'live', updated_at = ? WHERE id = ? RETURNING *")
    .get(now(), board.id) as MarketBoardRow;
}

/** Stops new joins and new bets everywhere on the board, regardless of any
 *  individual question's own `closesAt`. Existing open questions still need
 *  resolving or voiding — ending the board is not a shortcut past that. */
export function endBoard(board: MarketBoardRow): MarketBoardRow {
  return db
    .prepare("UPDATE market_boards SET status = 'ended', updated_at = ? WHERE id = ? RETURNING *")
    .get(now(), board.id) as MarketBoardRow;
}

/** The initial tick (the opening line, pool 0/0, stamped at creation) is
 *  what guarantees a question's chart always starts flat at the line the
 *  couple set — without it the chart would begin wherever the first bet
 *  moved it, which isn't what happened; nobody had bet yet. The opening is
 *  fixed for the question's life: moving it after bets exist would reprice
 *  every position guests already took. */
export function createQuestion(
  boardId: number,
  input: { prompt: string; closesAt: number; openingProbability: number },
): MarketQuestionRow {
  const ts = now();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `INSERT INTO market_questions (board_id, prompt, closes_at, opening_probability, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .get(
        boardId,
        input.prompt,
        input.closesAt,
        input.openingProbability,
        ts,
        ts,
      ) as MarketQuestionRow;
    recordPriceTick(row.id, { yes: 0, no: 0 }, row.opening_probability, ts);
    return row;
  });
  return tx();
}

/** A whole pack in one transaction: all of it lands or none of it does, so
 *  a half-added pack never needs explaining. Same per-question rules (and the
 *  same opening tick) as `createQuestion`. */
export function createQuestions(
  boardId: number,
  items: BulkQuestionInput[],
  closesAt: number,
): void {
  const tx = db.transaction(() => {
    for (const item of items) createQuestion(boardId, { ...item, closesAt });
  });
  tx();
}

/** The prompt is locked the instant a single bet exists — rewording a
 *  question guests already staked points on would make their bet mean
 *  something they never agreed to. `closesAt` can move at any time before
 *  resolution: postponing a moment at a real wedding is completely normal
 *  and shouldn't require restarting the question. */
export function updateQuestion(
  boardId: number,
  questionId: number,
  patch: { prompt?: string; closesAt?: number },
): MarketQuestionRow {
  const existing = getQuestionScoped(boardId, questionId);
  if (!existing) throw new HttpError(404, "Question not found");
  if (existing.outcome !== null || existing.voided_at !== null) {
    throw new HttpError(400, "This question is already settled");
  }

  const updates: string[] = [];
  const params: import("bun:sqlite").SQLQueryBindings[] = [];
  if (patch.prompt !== undefined) {
    if (positionsForQuestion(questionId).length > 0) {
      throw new HttpError(400, "Can't reword a question guests have already bet on");
    }
    updates.push("prompt = ?");
    params.push(patch.prompt);
  }
  if (patch.closesAt !== undefined) {
    updates.push("closes_at = ?");
    params.push(patch.closesAt);
  }
  if (updates.length === 0) return existing;

  updates.push("updated_at = ?");
  params.push(now(), questionId);
  return db
    .prepare(`UPDATE market_questions SET ${updates.join(", ")} WHERE id = ? RETURNING *`)
    .get(...params) as MarketQuestionRow;
}

export function deleteQuestion(boardId: number, questionId: number): void {
  const existing = getQuestionScoped(boardId, questionId);
  if (!existing) throw new HttpError(404, "Question not found");
  if (positionsForQuestion(questionId).length > 0) {
    throw new HttpError(
      400,
      "Can't delete a question guests have already bet on — void it instead",
    );
  }
  db.prepare("DELETE FROM market_questions WHERE id = ?").run(questionId);
}

function creditPlayers(payouts: Map<number, number>): void {
  const stmt = db.prepare("UPDATE market_players SET balance = balance + ? WHERE id = ?");
  for (const [playerId, amount] of payouts) {
    if (amount > 0) stmt.run(amount, playerId);
  }
}

function stampPositionPayouts(payouts: Map<number, number>, positions: MarketPositionRow[]): void {
  const ts = now();
  const stmt = db.prepare("UPDATE market_positions SET payout = ?, updated_at = ? WHERE id = ?");
  for (const position of positions) {
    stmt.run(payouts.get(position.player_id) ?? 0, ts, position.id);
  }
}

/** Settle a question: mark the outcome, split the losing pool across the
 *  winners (see `settleMarketQuestion` in shared/markets.ts for the exact
 *  math), and credit every affected player's balance — all inside one
 *  transaction so a crash mid-payout can never leave the outcome stamped
 *  without the points to match, or vice versa. */
export function resolveQuestion(
  boardId: number,
  questionId: number,
  outcome: MarketOutcome,
): MarketQuestionRow {
  const existing = getQuestionScoped(boardId, questionId);
  if (!existing) throw new HttpError(404, "Question not found");
  if (existing.outcome !== null || existing.voided_at !== null) {
    throw new HttpError(400, "This question is already settled");
  }

  const tx = db.transaction(() => {
    const positions = positionsForQuestion(questionId);
    const marketPositions: MarketPosition[] = positions.map((p) => ({
      playerId: p.player_id,
      side: p.side,
      stake: p.stake,
    }));
    const payouts = settleMarketQuestion(marketPositions, outcome);
    creditPlayers(payouts);
    stampPositionPayouts(payouts, positions);
    db.prepare(
      "UPDATE market_questions SET outcome = ?, resolved_at = ?, updated_at = ? WHERE id = ?",
    ).run(outcome, now(), now(), questionId);
  });
  tx();

  return getQuestionScoped(boardId, questionId) as MarketQuestionRow;
}

/** Refund every stake on a question that turned out unanswerable, or whose
 *  moment never happened. Nobody wins or loses. */
export function voidQuestion(boardId: number, questionId: number): MarketQuestionRow {
  const existing = getQuestionScoped(boardId, questionId);
  if (!existing) throw new HttpError(404, "Question not found");
  if (existing.outcome !== null || existing.voided_at !== null) {
    throw new HttpError(400, "This question is already settled");
  }

  const tx = db.transaction(() => {
    const positions = positionsForQuestion(questionId);
    const marketPositions: MarketPosition[] = positions.map((p) => ({
      playerId: p.player_id,
      side: p.side,
      stake: p.stake,
    }));
    const payouts = voidMarketQuestion(marketPositions);
    creditPlayers(payouts);
    stampPositionPayouts(payouts, positions);
    db.prepare("UPDATE market_questions SET voided_at = ?, updated_at = ? WHERE id = ?").run(
      now(),
      now(),
      questionId,
    );
  });
  tx();

  return getQuestionScoped(boardId, questionId) as MarketQuestionRow;
}

// ─── leaderboard ────────────────────────────────────────────────────────────────

export function listActivePlayers(boardId: number): MarketPlayerRow[] {
  return db
    .prepare(
      "SELECT * FROM market_players WHERE board_id = ? AND removed_at IS NULL ORDER BY joined_at ASC",
    )
    .all(boardId) as MarketPlayerRow[];
}

/** Each award goes to the single player with the highest count (earliest
 *  joiner on a tie), and only when that count is above zero — an award for
 *  nothing is noise. */
function awardTop(counts: Map<number, number>, players: MarketPlayer[]): number | null {
  let best: number | null = null;
  let bestCount = 0;
  for (const p of players) {
    const c = counts.get(p.id) ?? 0;
    if (c > bestCount) {
      best = p.id;
      bestCount = c;
    }
  }
  return best;
}

function boardCounts(sql: string, boardId: number): Map<number, number> {
  const rows = db.prepare(sql).all(boardId) as { player_id: number; c: number }[];
  return new Map(rows.map((r) => [r.player_id, r.c]));
}

function leaderboardTitles(
  boardId: number,
  rows: MarketPlayerRow[],
  ranked: MarketPlayer[],
  startingBalance: number,
): Map<number, MarketTitle[]> {
  const titles = new Map<number, MarketTitle[]>();
  // An award is a comparison, and a room of one has nobody to compare with:
  // the lone early joiner was being crowned "Degenerate" for one small bet.
  if (ranked.length < 2) return titles;
  const give = (id: number | null, title: MarketTitle) => {
    if (id === null) return;
    titles.set(id, [...(titles.get(id) ?? []), title]);
  };
  const first = ranked[0];
  if (first && first.balance > startingBalance) give(first.id, "prophet");

  give(
    awardTop(
      boardCounts(
        `SELECT mp.player_id, SUM(mp.stake) AS c FROM market_positions mp
           JOIN market_questions q ON q.id = mp.question_id
          WHERE q.board_id = ? GROUP BY mp.player_id`,
        boardId,
      ),
      ranked,
    ),
    "degenerate",
  );

  // A win counts as an "oracle" call when the winning side held at most a
  // quarter of the final pool: the room disagreed and this player didn't.
  give(
    awardTop(
      boardCounts(
        `SELECT mp.player_id, COUNT(*) AS c FROM market_positions mp
           JOIN market_questions q ON q.id = mp.question_id
          WHERE q.board_id = ? AND q.outcome IS NOT NULL AND mp.side = q.outcome
            AND (SELECT SUM(stake) FROM market_positions w WHERE w.question_id = q.id AND w.side = q.outcome) * 4
                <= (SELECT SUM(stake) FROM market_positions a WHERE a.question_id = q.id)
          GROUP BY mp.player_id`,
        boardId,
      ),
      ranked,
    ),
    "oracle",
  );

  give(awardTop(new Map(rows.map((r) => [r.id, r.bailouts])), ranked), "bailout_king");

  const last = ranked[ranked.length - 1];
  if (ranked.length >= 3 && last && last.balance < startingBalance) give(last.id, "rock_bottom");
  return titles;
}

export function computeLeaderboard(boardId: number): MarketLeaderboardEntry[] {
  const rows = listActivePlayers(boardId);
  const players = rows.map(toMarketPlayer);
  players.sort((a, b) => b.balance - a.balance || a.joinedAt - b.joinedAt);
  const board = db
    .prepare("SELECT starting_balance FROM market_boards WHERE id = ?")
    .get(boardId) as { starting_balance: number } | undefined;
  const titles = leaderboardTitles(boardId, rows, players, board?.starting_balance ?? 0);
  return players.map((player, i) => ({ player, rank: i + 1, titles: titles.get(player.id) ?? [] }));
}
