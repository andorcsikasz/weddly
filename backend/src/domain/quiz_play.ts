// Live wedding quiz game — guest-facing (public, no-auth) domain logic.
// A guest is identified by a token minted on join and replayed on the
// X-Quiz-Player-Token header (see routes/quiz_play.ts) — a lightweight party-
// game identity, not an auth credential, same posture as photos.ts's device_id.

import { randomBytes } from "node:crypto";
import {
  QUIZ_PLAYER_NAME_MAX,
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
  listRevealedAnswers,
  normalizeJoinCode,
  playerScore,
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

  try {
    db.prepare(
      `INSERT INTO quiz_answers (slide_id, player_id, value_json, response_ms, correct, points_awarded, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      slideId,
      player.id,
      JSON.stringify(value),
      responseMs,
      result.correct === null ? null : result.correct ? 1 : 0,
      result.points,
      now(),
    );
  } catch {
    // UNIQUE(slide_id, player_id) backstop against a concurrent double-submit
    // that raced past the pre-check above.
    throw new HttpError(409, "Already answered", { code: "already_answered" });
  }

  db.prepare("UPDATE quiz_players SET last_seen_at = ? WHERE id = ?").run(now(), player.id);

  return { correct: result.correct, points: result.points, myTotal: playerScore(player.id) };
}

export function touchPlayer(playerId: number): void {
  db.prepare("UPDATE quiz_players SET last_seen_at = ? WHERE id = ?").run(now(), playerId);
}
