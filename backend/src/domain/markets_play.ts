// Live wedding prediction markets — guest-facing (public, no-auth) domain
// logic. A guest is identified by a token minted on join and replayed on the
// X-Market-Player-Token header (see routes/markets.ts) — a lightweight
// party-game identity, not an auth credential, same posture as
// quiz_play.ts's player token and photos.ts's device_id.

import { randomBytes } from "node:crypto";
import {
  estimatedPayout,
  MARKET_MAX_STAKE,
  MARKET_MIN_STAKE,
  MARKET_PLAYER_NAME_MAX,
  marketQuestionStatus,
  type MarketPublicState,
  type MarketQuestion,
  type MarketSide,
  type MyMarketPosition,
} from "@shared/markets";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import {
  computeLeaderboard,
  getBoardByCode,
  getQuestionScoped,
  normalizeJoinCode,
  questionPool,
  toMarketQuestion,
  type MarketBoardRow,
  type MarketPlayerRow,
  type MarketQuestionRow,
} from "./markets";

interface CoupleNameRow {
  display_name: string;
}

export interface ResolvedBoard {
  board: MarketBoardRow;
  coupleDisplayName: string;
}

export function resolveBoardByCode(rawCode: string): ResolvedBoard {
  const code = normalizeJoinCode(rawCode);
  const board = getBoardByCode(code);
  if (!board) throw new HttpError(404, "Board not found");
  const couple = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(board.couple_id) as
    | CoupleNameRow
    | undefined;
  return { board, coupleDisplayName: couple?.display_name ?? "" };
}

function mintPlayerToken(): string {
  return randomBytes(16).toString("hex");
}

export function getPlayerByToken(boardId: number, token: string): MarketPlayerRow | undefined {
  return db
    .prepare("SELECT * FROM market_players WHERE board_id = ? AND token = ? AND removed_at IS NULL")
    .get(boardId, token) as MarketPlayerRow | undefined;
}

/** Join, or rejoin with an existing token (e.g. after a phone refresh) — a
 *  rejoin just updates name/avatar rather than minting a second player, so a
 *  guest never loses their running balance to a reload. A fresh join starts
 *  at the board's `starting_balance`. */
export function joinBoard(
  board: MarketBoardRow,
  existingToken: string | null,
  name: string,
  avatar: string,
): { player: MarketPlayerRow; token: string } {
  const cleanedName = name.trim().slice(0, MARKET_PLAYER_NAME_MAX);
  if (!cleanedName) throw new HttpError(400, "Name is required");
  if (board.status !== "live") {
    throw new HttpError(400, "This board isn't open to guests right now", {
      code: "board_not_live",
    });
  }

  const ts = now();
  const existing = existingToken ? getPlayerByToken(board.id, existingToken) : undefined;
  if (existing) {
    const updated = db
      .prepare(
        "UPDATE market_players SET name = ?, avatar = ?, last_seen_at = ? WHERE id = ? RETURNING *",
      )
      .get(cleanedName, avatar, ts, existing.id) as MarketPlayerRow;
    return { player: updated, token: existing.token };
  }

  const token = mintPlayerToken();
  const player = db
    .prepare(
      `INSERT INTO market_players (board_id, token, name, avatar, balance, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(board.id, token, cleanedName, avatar, board.starting_balance, ts, ts) as MarketPlayerRow;
  return { player, token };
}

// ─── public state DTO ────────────────────────────────────────────────────────────

export function getPublicState(
  resolved: ResolvedBoard,
  player: MarketPlayerRow | undefined,
): MarketPublicState {
  const { board, coupleDisplayName } = resolved;
  const questionRows = db
    .prepare("SELECT * FROM market_questions WHERE board_id = ? ORDER BY created_at ASC")
    .all(board.id) as MarketQuestionRow[];

  // Always re-read the balance rather than trust `player.balance` — a caller
  // that just placed a bet (placeBet mutates the row in its own query) is
  // holding the player snapshot from BEFORE that write, and reporting it here
  // would show the guest their pre-bet balance on the very response confirming
  // the bet.
  const freshBalance = player
    ? (
        db.prepare("SELECT balance FROM market_players WHERE id = ?").get(player.id) as {
          balance: number;
        }
      ).balance
    : null;

  const myPositions: MyMarketPosition[] = player
    ? (
        db
          .prepare(
            `SELECT mp.question_id AS question_id, mp.side AS side, mp.stake AS stake, mp.payout AS payout
               FROM market_positions mp
               JOIN market_questions q ON q.id = mp.question_id
              WHERE q.board_id = ? AND mp.player_id = ?`,
          )
          .all(board.id, player.id) as {
          question_id: number;
          side: MarketSide;
          stake: number;
          payout: number | null;
        }[]
      ).map((row) => ({
        questionId: row.question_id,
        side: row.side,
        stake: row.stake,
        payout: row.payout,
      }))
    : [];

  const totalPlayers = (
    db
      .prepare("SELECT COUNT(*) AS c FROM market_players WHERE board_id = ? AND removed_at IS NULL")
      .get(board.id) as {
      c: number;
    }
  ).c;

  return {
    boardTitle: board.title,
    hostDisplayName: coupleDisplayName,
    status: board.status,
    questions: questionRows.map(toMarketQuestion),
    myBalance: freshBalance,
    myPositions,
    totalPlayers,
    leaderboard: computeLeaderboard(board.id),
  };
}

/** Preview payout for a hypothetical stake before placing it — same math the
 *  bet slip shows live as the guest drags the stake slider, computed
 *  server-side so the frontend never has to re-derive `estimatedPayout`
 *  against a pool it might have a stale copy of. */
export function previewPayout(questionId: number, side: MarketSide, stake: number): number {
  return estimatedPayout(questionPool(questionId), side, stake);
}

// ─── betting ────────────────────────────────────────────────────────────────────

export interface PlaceBetResult {
  side: MarketSide;
  stake: number;
  totalStakeOnSide: number;
  balance: number;
  question: MarketQuestion;
}

/** Places (or tops up) a bet. A position's side is fixed the first time a
 *  player bets on a question — see the UNIQUE(question_id, player_id)
 *  constraint and shared/markets.ts's settlement math, which assumes one
 *  side per player per question. Topping up just adds to the same side;
 *  switching sides is refused rather than silently netted, so a player can
 *  never "flip" a bet after seeing the room move against them. */
export function placeBet(
  board: MarketBoardRow,
  player: MarketPlayerRow,
  questionId: number,
  side: MarketSide,
  stake: number,
): PlaceBetResult {
  if (board.status !== "live") {
    throw new HttpError(400, "This board isn't open to guests right now", {
      code: "board_not_live",
    });
  }
  if (!Number.isInteger(stake) || stake < MARKET_MIN_STAKE || stake > MARKET_MAX_STAKE) {
    throw new HttpError(
      400,
      `Stake must be an integer between ${MARKET_MIN_STAKE} and ${MARKET_MAX_STAKE}`,
    );
  }
  const questionRow = getQuestionScoped(board.id, questionId);
  if (!questionRow) throw new HttpError(404, "Question not found");
  const status = marketQuestionStatus(
    {
      closesAt: questionRow.closes_at,
      outcome: questionRow.outcome,
      voidedAt: questionRow.voided_at,
    },
    now(),
  );
  if (status !== "open") {
    throw new HttpError(400, "Betting is closed on this question", { code: "question_closed" });
  }

  const fresh = db.prepare("SELECT balance FROM market_players WHERE id = ?").get(player.id) as {
    balance: number;
  };
  if (stake > fresh.balance)
    throw new HttpError(400, "Not enough points", { code: "insufficient_balance" });

  const existing = db
    .prepare("SELECT * FROM market_positions WHERE question_id = ? AND player_id = ?")
    .get(questionId, player.id) as { id: number; side: MarketSide; stake: number } | undefined;
  if (existing && existing.side !== side) {
    throw new HttpError(400, "You already bet the other side on this question", {
      code: "side_locked",
    });
  }

  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      "UPDATE market_players SET balance = balance - ?, last_seen_at = ? WHERE id = ?",
    ).run(stake, ts, player.id);
    if (existing) {
      db.prepare("UPDATE market_positions SET stake = stake + ?, updated_at = ? WHERE id = ?").run(
        stake,
        ts,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO market_positions (question_id, player_id, side, stake, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(questionId, player.id, side, stake, ts, ts);
    }
  });
  tx();

  const totalStakeOnSide = (existing?.stake ?? 0) + stake;
  const refreshedQuestion = getQuestionScoped(board.id, questionId) as MarketQuestionRow;
  const refreshedPlayer = db
    .prepare("SELECT balance FROM market_players WHERE id = ?")
    .get(player.id) as {
    balance: number;
  };

  return {
    side,
    stake,
    totalStakeOnSide,
    balance: refreshedPlayer.balance,
    question: toMarketQuestion(refreshedQuestion),
  };
}

export function touchPlayer(playerId: number): void {
  db.prepare("UPDATE market_players SET last_seen_at = ? WHERE id = ?").run(now(), playerId);
}
