// Live wedding prediction markets — guest-facing (public, no-auth) domain
// logic. A guest is identified by a token minted on join and replayed on the
// X-Market-Player-Token header (see routes/markets.ts) — a lightweight
// party-game identity, not an auth credential, same posture as
// quiz_play.ts's player token and photos.ts's device_id.

import { randomBytes } from "node:crypto";
import {
  bailoutRefund,
  currentPositionValue,
  MARKET_PITY_LOAN,
  MARKET_REACTION_WINDOW_MS,
  MARKET_REACTIONS,
  MARKET_TEAMS,
  type MarketBetEvent,
  type MarketReaction,
  type MarketTeam,
  type MarketTeamScore,
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
  recordPriceTick,
  toMarketQuestion,
  type MarketBoardRow,
  type MarketPlayerRow,
  type MarketQuestionRow,
} from "./markets";

const RECENT_BETS_LIMIT = 15;
// One emoji per player per this window; anything faster is dropped quietly,
// since a reaction is decoration and a refusal toast would be louder than it.
const REACTION_COOLDOWN_MS = 1200;
const REACTION_RETENTION_MS = 60 * 60 * 1000;

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
export function parseTeam(raw: unknown): MarketTeam | null {
  return typeof raw === "string" && (MARKET_TEAMS as readonly string[]).includes(raw)
    ? (raw as MarketTeam)
    : null;
}

export function joinBoard(
  board: MarketBoardRow,
  existingToken: string | null,
  name: string,
  avatar: string,
  team: MarketTeam | null = null,
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
        "UPDATE market_players SET name = ?, avatar = ?, team = COALESCE(?, team), last_seen_at = ? WHERE id = ? RETURNING *",
      )
      .get(cleanedName, avatar, team, ts, existing.id) as MarketPlayerRow;
    return { player: updated, token: existing.token };
  }

  const token = mintPlayerToken();
  const player = db
    .prepare(
      `INSERT INTO market_players (board_id, token, name, avatar, team, balance, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      board.id,
      token,
      cleanedName,
      avatar,
      team,
      board.starting_balance,
      ts,
      ts,
    ) as MarketPlayerRow;
  return { player, token };
}

// ─── public state DTO ────────────────────────────────────────────────────────────

function recentBets(boardId: number): MarketBetEvent[] {
  const rows = db
    .prepare(
      `SELECT t.id AS id, t.question_id AS question_id, pl.name AS name, pl.avatar AS avatar,
              t.side AS side, t.stake AS stake, t.at AS at
         FROM market_price_ticks t
         JOIN market_questions q ON q.id = t.question_id
         JOIN market_players pl ON pl.id = t.player_id
        WHERE q.board_id = ? AND t.player_id IS NOT NULL AND t.stake > 0
        ORDER BY t.at DESC, t.id DESC LIMIT ?`,
    )
    .all(boardId, RECENT_BETS_LIMIT) as {
    id: number;
    question_id: number;
    name: string;
    avatar: string;
    side: MarketSide;
    stake: number;
    at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    questionId: r.question_id,
    name: r.name,
    avatar: r.avatar,
    side: r.side,
    stake: r.stake,
    at: r.at,
  }));
}

function recentReactions(boardId: number): MarketReaction[] {
  return db
    .prepare(
      `SELECT r.id AS id, r.emoji AS emoji, pl.name AS name, r.at AS at
         FROM market_reactions r JOIN market_players pl ON pl.id = r.player_id
        WHERE r.board_id = ? AND r.at > ? ORDER BY r.at ASC, r.id ASC LIMIT 60`,
    )
    .all(boardId, now() - MARKET_REACTION_WINDOW_MS) as MarketReaction[];
}

function teamScores(boardId: number): MarketTeamScore[] {
  const rows = db
    .prepare(
      `SELECT team, COUNT(*) AS players, COALESCE(SUM(balance), 0) AS balance
         FROM market_players WHERE board_id = ? AND removed_at IS NULL AND team IS NOT NULL
        GROUP BY team`,
    )
    .all(boardId) as { team: MarketTeam; players: number; balance: number }[];
  return MARKET_TEAMS.map((team) => {
    const row = rows.find((r) => r.team === team);
    return { team, players: row?.players ?? 0, balance: row?.balance ?? 0 };
  });
}

function hasOpenExposure(boardId: number, playerId: number): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM market_positions mp JOIN market_questions q ON q.id = mp.question_id
          WHERE q.board_id = ? AND mp.player_id = ? AND q.outcome IS NULL AND q.voided_at IS NULL
          LIMIT 1`,
      )
      .get(boardId, playerId),
  );
}

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
        // Real, final number once settled; a live mark-to-market estimate
        // against the CURRENT pool otherwise — see `currentValue` on
        // `MyMarketPosition` in shared/markets.ts.
        currentValue:
          row.payout ?? currentPositionValue(questionPool(row.question_id), row.side, row.stake),
      }))
    : [];

  const totalPlayers = (
    db
      .prepare("SELECT COUNT(*) AS c FROM market_players WHERE board_id = ? AND removed_at IS NULL")
      .get(board.id) as {
      c: number;
    }
  ).c;

  const me = player
    ? (() => {
        const row = db
          .prepare("SELECT team, pity_loans FROM market_players WHERE id = ?")
          .get(player.id) as { team: MarketTeam | null; pity_loans: number };
        return {
          id: player.id,
          team: row.team,
          pityAvailable:
            row.pity_loans === 0 && freshBalance === 0 && !hasOpenExposure(board.id, player.id),
        };
      })()
    : null;

  return {
    boardTitle: board.title,
    hostDisplayName: coupleDisplayName,
    status: board.status,
    prize: board.prize,
    questions: questionRows.map(toMarketQuestion),
    myBalance: freshBalance,
    myPositions,
    me,
    totalPlayers,
    leaderboard: computeLeaderboard(board.id),
    recentBets: recentBets(board.id),
    reactions: recentReactions(board.id),
    teams: teamScores(board.id),
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
 *  switching sides is refused rather than silently netted. The only way
 *  across is `bailOut`, which costs a fifth of the stake, so a flip after
 *  seeing the room move is allowed but never free. */
export function placeBet(
  board: MarketBoardRow,
  player: MarketPlayerRow,
  questionId: number,
  side: MarketSide,
  stake: number,
): PlaceBetResult {
  if (!Number.isInteger(stake) || stake < MARKET_MIN_STAKE || stake > MARKET_MAX_STAKE) {
    throw new HttpError(
      400,
      `Stake must be an integer between ${MARKET_MIN_STAKE} and ${MARKET_MAX_STAKE}`,
    );
  }
  const questionRow = requireOpenQuestion(board, questionId);

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
    // Same transaction as the pool write above — see recordPriceTick's own
    // comment for why a tick can never exist without its bet or vice versa.
    recordPriceTick(questionId, questionPool(questionId), questionRow.opening_probability, ts, {
      playerId: player.id,
      side,
      stake,
    });
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

function requireOpenQuestion(board: MarketBoardRow, questionId: number): MarketQuestionRow {
  if (board.status !== "live") {
    throw new HttpError(400, "This board isn't open to guests right now", {
      code: "board_not_live",
    });
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
  return questionRow;
}

/** Walk away from a position while the question is still open: the stake
 *  leaves the pool, `MARKET_BAILOUT_REFUND_PCT` of it comes back, and the
 *  rest is burned (see the constant for why it can't be the live value).
 *  Deleting the position is what frees the player to bet again, on either
 *  side, so this is also the one sanctioned way to switch sides. */
export function bailOut(
  board: MarketBoardRow,
  player: MarketPlayerRow,
  questionId: number,
): { refund: number } {
  const questionRow = requireOpenQuestion(board, questionId);
  const position = db
    .prepare("SELECT id, stake FROM market_positions WHERE question_id = ? AND player_id = ?")
    .get(questionId, player.id) as { id: number; stake: number } | null;
  if (!position) throw new HttpError(400, "No bet to bail out of", { code: "no_position" });

  const refund = bailoutRefund(position.stake);
  const ts = now();
  db.transaction(() => {
    db.prepare("DELETE FROM market_positions WHERE id = ?").run(position.id);
    db.prepare(
      "UPDATE market_players SET balance = balance + ?, bailouts = bailouts + 1, last_seen_at = ? WHERE id = ?",
    ).run(refund, ts, player.id);
    recordPriceTick(questionId, questionPool(questionId), questionRow.opening_probability, ts);
  })();
  return { refund };
}

/** One small loan for a broke guest, so they keep playing instead of
 *  watching. Only when they truly have nothing: 0 points AND nothing riding
 *  on an unsettled question (an open bet might still pay out). */
export function takePityLoan(board: MarketBoardRow, player: MarketPlayerRow): { balance: number } {
  if (board.status !== "live") {
    throw new HttpError(400, "This board isn't open to guests right now", {
      code: "board_not_live",
    });
  }
  const row = db
    .prepare("SELECT balance, pity_loans FROM market_players WHERE id = ?")
    .get(player.id) as { balance: number; pity_loans: number };
  if (row.pity_loans > 0) throw new HttpError(400, "Loan already used", { code: "pity_used" });
  if (row.balance > 0 || hasOpenExposure(board.id, player.id)) {
    throw new HttpError(400, "You're not broke yet", { code: "not_broke" });
  }
  const updated = db
    .prepare(
      "UPDATE market_players SET balance = balance + ?, pity_loans = pity_loans + 1 WHERE id = ? RETURNING balance",
    )
    .get(MARKET_PITY_LOAN, player.id) as { balance: number };
  return { balance: updated.balance };
}

/** Returns whether the reaction was stored; a too-fast repeat is dropped. */
export function addReaction(
  board: MarketBoardRow,
  player: MarketPlayerRow,
  emoji: unknown,
): boolean {
  if (typeof emoji !== "string" || !MARKET_REACTIONS.includes(emoji)) {
    throw new HttpError(400, "Unknown reaction");
  }
  const ts = now();
  const last = db
    .prepare("SELECT MAX(at) AS at FROM market_reactions WHERE player_id = ?")
    .get(player.id) as { at: number | null };
  if (last.at !== null && ts - last.at < REACTION_COOLDOWN_MS) return false;
  db.prepare("DELETE FROM market_reactions WHERE board_id = ? AND at < ?").run(
    board.id,
    ts - REACTION_RETENTION_MS,
  );
  db.prepare(
    "INSERT INTO market_reactions (board_id, player_id, emoji, at) VALUES (?, ?, ?, ?)",
  ).run(board.id, player.id, emoji, ts);
  return true;
}

export function touchPlayer(playerId: number): void {
  db.prepare("UPDATE market_players SET last_seen_at = ? WHERE id = ?").run(now(), playerId);
}
