// Live wedding prediction markets — couple-authoring domain logic. Guest-
// facing (public, no-auth) logic lives in domain/markets_play.ts, which
// imports the row→DTO mappers and pool math from here rather than
// duplicating them, so the couple's own management screen and a guest's
// screen can never read the same rows two different ways. Mirrors the split
// in domain/quiz.ts / domain/quiz_play.ts.

import { randomBytes } from "node:crypto";
import {
  MARKET_JOIN_CODE_ALPHABET,
  MARKET_JOIN_CODE_LENGTH,
  MARKET_PROMPT_MAX,
  MARKET_STARTING_BALANCE,
  MARKET_TITLE_MAX,
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
  type MarketQuestion,
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
  created_at: number;
  updated_at: number;
}

export interface MarketQuestionRow {
  id: number;
  board_id: number;
  prompt: string;
  closes_at: number;
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

export function toMarketQuestion(row: MarketQuestionRow): MarketQuestion {
  const pool = questionPool(row.id);
  return {
    id: row.id,
    boardId: row.board_id,
    prompt: row.prompt,
    closesAt: row.closes_at,
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
    probability: marketProbability(pool),
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

export function updateBoardTitle(id: number, coupleId: number, title: string): MarketBoardRow {
  const row = db
    .prepare(
      "UPDATE market_boards SET title = ?, updated_at = ? WHERE id = ? AND couple_id = ? RETURNING *",
    )
    .get(title, now(), id, coupleId) as MarketBoardRow | undefined;
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

export function createQuestion(
  boardId: number,
  input: { prompt: string; closesAt: number },
): MarketQuestionRow {
  const ts = now();
  return db
    .prepare(
      `INSERT INTO market_questions (board_id, prompt, closes_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(boardId, input.prompt, input.closesAt, ts, ts) as MarketQuestionRow;
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

export function computeLeaderboard(boardId: number): MarketLeaderboardEntry[] {
  const players = listActivePlayers(boardId).map(toMarketPlayer);
  players.sort((a, b) => b.balance - a.balance || a.joinedAt - b.joinedAt);
  return players.map((player, i) => ({ player, rank: i + 1 }));
}
