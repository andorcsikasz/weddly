// Live wedding quiz game — guest-facing (public, no-auth) domain logic.
// A guest is identified by a token minted on join and replayed on the
// X-Quiz-Player-Token header (see routes/quiz_play.ts) — a lightweight party-
// game identity, not an auth credential, same posture as photos.ts's device_id.

import { randomBytes } from "node:crypto";
import {
  QUIZ_LOBBY_PLAYERS_MAX,
  QUIZ_PLAYER_NAME_MAX,
  quizStreakBonus,
  type QuizMyAnswer,
  quizAnswersOpen,
  quizSlideIsAnswerable,
  scoreAnswer,
  type QuizAnswerResult,
  type QuizAnswerValue,
  type QuizPublicState,
  type QuizSlideKind,
} from "@shared/quiz";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import {
  computeLeaderboard,
  getQuizByCode,
  getSlideScoped,
  latestScoredSlideId,
  listRevealedAnswers,
  normalizeJoinCode,
  playerScore,
  revealStatsForSlide,
  toPublicSlide,
  toQuizSlide,
  type QuizPlayerRow,
  type QuizRow,
} from "./quiz";

interface CoupleNameRow {
  display_name: string;
}

export interface ResolvedQuiz {
  quiz: QuizRow;
  coupleDisplayName: string;
}

export function resolveQuizByCode(rawCode: string): ResolvedQuiz {
  const code = normalizeJoinCode(rawCode);
  const quiz = getQuizByCode(code);
  if (!quiz) throw new HttpError(404, "Quiz not found");
  const couple = db.prepare("SELECT display_name FROM couples WHERE id = ?").get(quiz.couple_id) as
    | CoupleNameRow
    | undefined;
  return { quiz, coupleDisplayName: couple?.display_name ?? "" };
}

function mintPlayerToken(): string {
  return randomBytes(16).toString("hex");
}

export function getPlayerByToken(quizId: number, token: string): QuizPlayerRow | undefined {
  return db
    .prepare("SELECT * FROM quiz_players WHERE quiz_id = ? AND token = ? AND removed_at IS NULL")
    .get(quizId, token) as QuizPlayerRow | undefined;
}

/** Join, or rejoin with an existing token (e.g. after a phone refresh) — a
 *  rejoin just updates name/avatar rather than minting a second player, so a
 *  guest never loses their running score to a reload. */
export function joinQuiz(
  quiz: QuizRow,
  existingToken: string | null,
  name: string,
  avatar: string,
): { player: QuizPlayerRow; token: string } {
  const cleanedName = name.trim().slice(0, QUIZ_PLAYER_NAME_MAX);
  if (!cleanedName) throw new HttpError(400, "Name is required");
  if (quiz.status === "ended")
    throw new HttpError(400, "This quiz has ended", { code: "quiz_ended" });

  const ts = now();
  const existing = existingToken ? getPlayerByToken(quiz.id, existingToken) : undefined;
  if (existing) {
    const updated = db
      .prepare(
        `UPDATE quiz_players SET name = ?, avatar = ?, last_seen_at = ? WHERE id = ? RETURNING *`,
      )
      .get(cleanedName, avatar, ts, existing.id) as QuizPlayerRow;
    return { player: updated, token: existing.token };
  }

  const token = mintPlayerToken();
  const player = db
    .prepare(
      `INSERT INTO quiz_players (quiz_id, token, name, avatar, joined_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(quiz.id, token, cleanedName, avatar, ts, ts) as QuizPlayerRow;
  return { player, token };
}

// ─── public state DTO ────────────────────────────────────────────────────────────

export function getPublicState(
  resolved: ResolvedQuiz,
  player: QuizPlayerRow | undefined,
): QuizPublicState {
  const { quiz, coupleDisplayName } = resolved;
  const currentSlideRow = quiz.current_slide_id
    ? getSlideScoped(quiz.id, quiz.current_slide_id)
    : undefined;
  const revealed = quiz.phase === "reveal" || quiz.phase === "ended";
  const currentSlide = currentSlideRow
    ? revealed
      ? toQuizSlide(currentSlideRow)
      : toPublicSlide(toQuizSlide(currentSlideRow))
    : null;

  const hasAnswered = Boolean(
    player &&
      currentSlideRow &&
      db
        .prepare("SELECT 1 FROM quiz_answers WHERE slide_id = ? AND player_id = ?")
        .get(currentSlideRow.id, player.id),
  );

  const leaderboard = revealed ? computeLeaderboard(quiz.id, quiz.current_slide_id, true) : null;
  const currentSlideAnswers =
    revealed && currentSlideRow ? listRevealedAnswers(currentSlideRow.id) : null;
  const totalPlayers = (
    db
      .prepare("SELECT COUNT(*) AS c FROM quiz_players WHERE quiz_id = ? AND removed_at IS NULL")
      .get(quiz.id) as {
      c: number;
    }
  ).c;

  const myEntry =
    player && leaderboard ? leaderboard.find((e) => e.player.id === player.id) : undefined;

  const myAnswerRow =
    player && currentSlideRow
      ? (db
          .prepare(
            "SELECT correct, points_awarded, bonus, streak FROM quiz_answers WHERE slide_id = ? AND player_id = ?",
          )
          .get(currentSlideRow.id, player.id) as {
          correct: 0 | 1 | null;
          points_awarded: number;
          bonus: number;
          streak: number;
        } | null)
      : null;
  const myAnswer: QuizMyAnswer | null = myAnswerRow
    ? {
        correct: myAnswerRow.correct === null ? null : myAnswerRow.correct === 1,
        points: myAnswerRow.points_awarded,
        bonus: myAnswerRow.bonus,
        streak: myAnswerRow.streak,
      }
    : null;

  const lobbyPlayers =
    quiz.phase === "lobby"
      ? (db
          .prepare(
            "SELECT name, avatar FROM quiz_players WHERE quiz_id = ? AND removed_at IS NULL ORDER BY joined_at ASC LIMIT ?",
          )
          .all(quiz.id, QUIZ_LOBBY_PLAYERS_MAX) as { name: string; avatar: string }[])
      : [];

  return {
    quizTitle: quiz.title,
    hostDisplayName: coupleDisplayName,
    status: quiz.status,
    phase: quiz.phase,
    phaseStartedAt: quiz.phase_started_at,
    currentSlide,
    hasAnswered,
    totalPlayers,
    myScore: player ? playerScore(player.id) : null,
    myRank: myEntry?.rank ?? null,
    leaderboard,
    currentSlideAnswers,
    revealStats: revealed && currentSlideRow ? revealStatsForSlide(currentSlideRow.id) : null,
    myAnswer,
    lobbyPlayers,
  };
}

// ─── answering ────────────────────────────────────────────────────────────────

function valueMatchesKind(kind: QuizSlideKind, value: QuizAnswerValue): boolean {
  if (kind === "mcq" || kind === "binary")
    return value.kind === kind && Number.isInteger(value.optionIndex);
  if (kind === "number") return value.kind === "number" && Number.isFinite(value.value);
  if (kind === "heatmap")
    return (
      value.kind === "heatmap" &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      value.x >= 0 &&
      value.x <= 1 &&
      value.y >= 0 &&
      value.y <= 1
    );
  return false;
}

/** `responseMs` is always computed from the server's own `phase_started_at` —
 *  a client-reported timestamp is never trusted, which is also what makes the
 *  reply-time part of the score meaningful. */
export function recordAnswer(
  quiz: QuizRow,
  player: QuizPlayerRow,
  slideId: number,
  value: QuizAnswerValue,
): QuizAnswerResult {
  if (quiz.current_slide_id !== slideId) {
    throw new HttpError(400, "That isn't the current slide", { code: "stale_slide" });
  }
  const slideRow = getSlideScoped(quiz.id, slideId);
  if (!slideRow) throw new HttpError(404, "Slide not found");
  if (!quizSlideIsAnswerable(slideRow.kind)) {
    throw new HttpError(400, "This slide doesn't take an answer", { code: "not_answerable" });
  }
  if (
    !quizAnswersOpen(
      {
        phase: quiz.phase,
        phase_started_at: quiz.phase_started_at,
        time_limit_s: slideRow.time_limit_s,
      },
      now(),
    )
  ) {
    throw new HttpError(400, "Answers are closed for this question", { code: "answers_closed" });
  }
  if (!valueMatchesKind(slideRow.kind, value)) {
    throw new HttpError(400, "Answer doesn't match this question's type", {
      code: "invalid_value",
    });
  }

  const already = db
    .prepare("SELECT 1 FROM quiz_answers WHERE slide_id = ? AND player_id = ?")
    .get(slideId, player.id);
  if (already) throw new HttpError(409, "Already answered", { code: "already_answered" });

  const responseMs = Math.max(0, now() - (quiz.phase_started_at ?? now()));
  const slide = toQuizSlide(slideRow);

  // The streak this player arrives with: their stored streak on the latest
  // scored slide played before this one, if they got it right; zero if they
  // got it wrong or skipped it. One row, because each answer stores its own.
  const prevSlideId = latestScoredSlideId(quiz.id, slideRow.position - 1);
  const prev = prevSlideId
    ? (db
        .prepare(
          "SELECT streak FROM quiz_answers WHERE slide_id = ? AND player_id = ? AND correct = 1",
        )
        .get(prevSlideId, player.id) as { streak: number } | null)
    : null;
  const priorStreak = prev?.streak ?? 0;

  const result = scoreAnswer(
    {
      kind: slide.kind,
      config: slide.config,
      pointsBase: slide.pointsBase,
      timeLimitS: slide.timeLimitS,
    },
    value,
    responseMs,
  );

  // An unscored slide (opinion poll, untargeted heatmap) neither builds nor
  // breaks a streak: there was nothing to get right.
  const streak =
    result.correct === true ? priorStreak + 1 : result.correct === false ? 0 : priorStreak;
  const bonus = result.correct === true ? quizStreakBonus(streak) : 0;
  const points = result.points + bonus;

  try {
    db.prepare(
      `INSERT INTO quiz_answers (slide_id, player_id, value_json, response_ms, correct, points_awarded, answered_at, streak, bonus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      slideId,
      player.id,
      JSON.stringify(value),
      responseMs,
      result.correct === null ? null : result.correct ? 1 : 0,
      points,
      now(),
      streak,
      bonus,
    );
  } catch {
    // UNIQUE(slide_id, player_id) backstop against a concurrent double-submit
    // that raced past the pre-check above.
    throw new HttpError(409, "Already answered", { code: "already_answered" });
  }

  db.prepare("UPDATE quiz_players SET last_seen_at = ? WHERE id = ?").run(now(), player.id);

  return { correct: result.correct, points, bonus, streak, myTotal: playerScore(player.id) };
}

export function touchPlayer(playerId: number): void {
  db.prepare("UPDATE quiz_players SET last_seen_at = ? WHERE id = ?").run(now(), playerId);
}
