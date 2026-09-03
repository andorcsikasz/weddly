// Live wedding quiz game — couple-authoring + host-control domain logic.
// Guest-facing (public, no-auth) logic lives in domain/quiz_play.ts, which
// imports the row→DTO mappers and phase helpers from here rather than
// duplicating them, so the host's own screen and a guest's screen can never
// read the same row two different ways.

import { randomBytes } from "node:crypto";
import {
  QUIZ_DEFAULT_POINTS,
  QUIZ_DEFAULT_TIME_LIMIT_S,
  QUIZ_JOIN_CODE_ALPHABET,
  QUIZ_JOIN_CODE_LENGTH,
  QUIZ_MCQ_MAX_OPTIONS,
  QUIZ_MCQ_MIN_OPTIONS,
  QUIZ_OPTION_TEXT_MAX,
  QUIZ_PROMPT_MAX,
  QUIZ_SLIDE_KINDS,
  QUIZ_SUBTITLE_MAX,
  quizAnswersOpen,
  stripSlideSecrets,
  type QuizDetail,
  type QuizHostState,
  type QuizLeaderboardEntry,
  type QuizPhase,
  type QuizPlayer,
  type QuizRevealedAnswer,
  type QuizSlide,
  type QuizSlideConfig,
  type QuizSlideKind,
  type QuizStatus,
  type QuizSummary,
} from "@shared/quiz";
import { db, now } from "../db";
import { HttpError } from "../lib/http";

// ─── row shapes ────────────────────────────────────────────────────────────────

export interface QuizRow {
  id: number;
  couple_id: number;
  title: string;
  join_code: string;
  status: QuizStatus;
  current_slide_id: number | null;
  phase: QuizPhase;
  phase_started_at: number | null;
  created_at: number;
  updated_at: number;
}

interface QuizSlideRow {
  id: number;
  quiz_id: number;
  position: number;
  kind: QuizSlideKind;
  prompt: string;
  subtitle: string | null;
  time_limit_s: number | null;
  points_base: number;
  config_json: string;
  created_at: number;
  updated_at: number;
}

export interface QuizPlayerRow {
  id: number;
  quiz_id: number;
  token: string;
  name: string;
  avatar: string;
  joined_at: number;
  last_seen_at: number;
  removed_at: number | null;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

/** Defensive parse, same idiom as notifications.ts's data_json — a malformed
 *  or stale-shape row degrades to a safe default instead of 500ing every read
 *  that touches this slide. */
export function parseSlideConfig(row: QuizSlideRow): QuizSlideConfig {
  try {
    const parsed = JSON.parse(row.config_json) as QuizSlideConfig;
    if (parsed && typeof parsed === "object" && parsed.kind === row.kind) return parsed;
  } catch {
    // fall through to the default below
  }
  return defaultSlideConfig(row.kind);
}

function defaultSlideConfig(kind: QuizSlideKind): QuizSlideConfig {
  switch (kind) {
    case "mcq":
      return { kind: "mcq", options: ["", "", "", ""], correctIndex: null };
    case "binary":
      return { kind: "binary", options: ["", ""], correctIndex: null };
    case "number":
      return {
        kind: "number",
        min: 0,
        max: 100,
        step: 1,
        correctValue: null,
        unit: null,
        toleranceFraction: 0.05,
      };
    case "heatmap":
      return {
        kind: "heatmap",
        xLabel: ["", ""],
        yLabel: ["", ""],
        target: null,
        toleranceRadius: 0.15,
      };
    case "section":
      return { kind: "section" };
    case "story":
      return { kind: "story" };
  }
}

export function toQuizSlide(row: QuizSlideRow): QuizSlide {
  return {
    id: row.id,
    quizId: row.quiz_id,
    position: row.position,
    kind: row.kind,
    prompt: row.prompt,
    subtitle: row.subtitle,
    timeLimitS: row.time_limit_s,
    pointsBase: row.points_base,
    config: parseSlideConfig(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicSlide(slide: QuizSlide): QuizSlide {
  return { ...slide, config: stripSlideSecrets(slide.config) };
}

export function toQuizSummary(row: QuizRow): QuizSummary {
  return {
    id: row.id,
    title: row.title,
    joinCode: row.join_code,
    status: row.status,
    phase: row.phase,
    slideCount: countSlides(row.id),
    playerCount: countPlayers(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toQuizDetail(row: QuizRow): QuizDetail {
  return { ...toQuizSummary(row), slides: listSlides(row.id).map(toQuizSlide) };
}

export function toQuizPlayer(row: QuizPlayerRow, score: number): QuizPlayer {
  return {
    id: row.id,
    quizId: row.quiz_id,
    name: row.name,
    avatar: row.avatar,
    joinedAt: row.joined_at,
    score,
  };
}

// ─── input validation ──────────────────────────────────────────────────────────
// Hand-validated at the boundary, no runtime schema library — same convention
// as every other feature route (see wishlist.ts's parseUpsertCreate).

function requireString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new HttpError(400, `${field} must be a non-empty string (max ${max} chars)`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > max) {
    throw new HttpError(400, `${field} must be a string (max ${max} chars) or null`);
  }
  return value.trim() || null;
}

function optionalTimeLimitS(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 5 || value > 300) {
    throw new HttpError(400, "time_limit_s must be an integer between 5 and 300 seconds, or null");
  }
  return value;
}

function parseOptions(raw: unknown, min: number, max: number): string[] {
  if (!Array.isArray(raw) || raw.length < min || raw.length > max) {
    throw new HttpError(400, `options must be an array of ${min}-${max} strings`);
  }
  return raw.map((o, i) => requireString(o, `options[${i}]`, QUIZ_OPTION_TEXT_MAX));
}

function optionalIndex(raw: unknown, optionCount: number): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) >= optionCount) {
    throw new HttpError(400, "correctIndex out of range");
  }
  return raw as number;
}

function optionalFiniteNumber(raw: unknown, field: string): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw))
    throw new HttpError(400, `${field} must be a number or null`);
  return raw;
}

/** Validates and normalises a slide's kind-specific config from an untrusted
 *  request body. Throws HttpError(400) on anything unusable. */
export function parseSlideConfigInput(kind: QuizSlideKind, raw: unknown): QuizSlideConfig {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case "mcq": {
      const options = parseOptions(body.options, QUIZ_MCQ_MIN_OPTIONS, QUIZ_MCQ_MAX_OPTIONS);
      return {
        kind: "mcq",
        options,
        correctIndex: optionalIndex(body.correctIndex, options.length),
      };
    }
    case "binary": {
      const options = parseOptions(body.options, 2, 2) as [string, string];
      const correctIndex = optionalIndex(body.correctIndex, 2) as 0 | 1 | null;
      return { kind: "binary", options, correctIndex };
    }
    case "number": {
      const min = typeof body.min === "number" && Number.isFinite(body.min) ? body.min : 0;
      const max = typeof body.max === "number" && Number.isFinite(body.max) ? body.max : 100;
      if (max <= min) throw new HttpError(400, "max must be greater than min");
      const step = typeof body.step === "number" && body.step > 0 ? body.step : 1;
      const toleranceFraction =
        typeof body.toleranceFraction === "number" &&
        body.toleranceFraction > 0 &&
        body.toleranceFraction <= 1
          ? body.toleranceFraction
          : 0.05;
      const correctValue = optionalFiniteNumber(body.correctValue, "correctValue");
      if (correctValue !== null && (correctValue < min || correctValue > max)) {
        throw new HttpError(400, "correctValue must be within min/max");
      }
      return {
        kind: "number",
        min,
        max,
        step,
        correctValue,
        unit: optionalString(body.unit, "unit", 20),
        toleranceFraction,
      };
    }
    case "heatmap": {
      const xLabel = parseOptions(body.xLabel, 2, 2) as [string, string];
      const yLabel = parseOptions(body.yLabel, 2, 2) as [string, string];
      const toleranceRadius =
        typeof body.toleranceRadius === "number" &&
        body.toleranceRadius > 0 &&
        body.toleranceRadius <= 1
          ? body.toleranceRadius
          : 0.15;
      let target: { x: number; y: number } | null = null;
      if (body.target !== null && body.target !== undefined) {
        const t = body.target as Record<string, unknown>;
        if (
          typeof t.x !== "number" ||
          typeof t.y !== "number" ||
          t.x < 0 ||
          t.x > 1 ||
          t.y < 0 ||
          t.y > 1
        ) {
          throw new HttpError(400, "target must be {x,y} within 0..1, or null");
        }
        target = { x: t.x, y: t.y };
      }
      return { kind: "heatmap", xLabel, yLabel, target, toleranceRadius };
    }
    case "section":
      return { kind: "section" };
    case "story":
      return { kind: "story" };
  }
}

export function parseSlideKind(raw: unknown): QuizSlideKind {
  if (typeof raw !== "string" || !QUIZ_SLIDE_KINDS.includes(raw as QuizSlideKind)) {
    throw new HttpError(400, `kind must be one of ${QUIZ_SLIDE_KINDS.join(", ")}`);
  }
  return raw as QuizSlideKind;
}

export function parseSlideCreateInput(body: Record<string, unknown>): {
  kind: QuizSlideKind;
  prompt: string;
  subtitle: string | null;
  timeLimitS: number | null;
  config: QuizSlideConfig;
} {
  const kind = parseSlideKind(body.kind);
  return {
    kind,
    prompt: requireString(body.prompt ?? "", "prompt", QUIZ_PROMPT_MAX),
    subtitle: optionalString(body.subtitle, "subtitle", QUIZ_SUBTITLE_MAX),
    timeLimitS: quizSlideDefaultTimeLimit(kind, body.timeLimitS),
    config: parseSlideConfigInput(kind, body.config),
  };
}

function quizSlideDefaultTimeLimit(kind: QuizSlideKind, raw: unknown): number | null {
  if (kind === "section" || kind === "story") return null;
  if (raw === undefined) return QUIZ_DEFAULT_TIME_LIMIT_S;
  return optionalTimeLimitS(raw);
}

export function parseSlideUpdateInput(
  kind: QuizSlideKind,
  body: Record<string, unknown>,
): Partial<{
  prompt: string;
  subtitle: string | null;
  timeLimitS: number | null;
  pointsBase: number;
  config: QuizSlideConfig;
}> {
  const patch: ReturnType<typeof parseSlideUpdateInput> = {};
  if ("prompt" in body) patch.prompt = requireString(body.prompt, "prompt", QUIZ_PROMPT_MAX);
  if ("subtitle" in body)
    patch.subtitle = optionalString(body.subtitle, "subtitle", QUIZ_SUBTITLE_MAX);
  if ("timeLimitS" in body) patch.timeLimitS = optionalTimeLimitS(body.timeLimitS);
  if ("pointsBase" in body) {
    const v = body.pointsBase;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 100 || v > 5000) {
      throw new HttpError(400, "pointsBase must be an integer between 100 and 5000");
    }
    patch.pointsBase = v;
  }
  if ("config" in body) patch.config = parseSlideConfigInput(kind, body.config);
  return patch;
}

// ─── join codes ────────────────────────────────────────────────────────────────

export function generateQuizJoinCode(): string {
  const bytes = randomBytes(QUIZ_JOIN_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < QUIZ_JOIN_CODE_LENGTH; i++) {
    out += QUIZ_JOIN_CODE_ALPHABET[bytes[i]! % QUIZ_JOIN_CODE_ALPHABET.length];
  }
  return out;
}

function uniqueJoinCode(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateQuizJoinCode();
    const taken = db.prepare("SELECT 1 FROM quizzes WHERE join_code = ?").get(code);
    if (!taken) return code;
  }
  throw new HttpError(500, "Could not allocate a join code, try again");
}

export function normalizeJoinCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// ─── couple-scoped reads ────────────────────────────────────────────────────────

export function listQuizzesForCouple(coupleId: number): QuizSummary[] {
  const rows = db
    .prepare("SELECT * FROM quizzes WHERE couple_id = ? ORDER BY created_at DESC")
    .all(coupleId) as QuizRow[];
  return rows.map(toQuizSummary);
}

export function getQuizScoped(id: number, coupleId: number): QuizRow | undefined {
  return db.prepare("SELECT * FROM quizzes WHERE id = ? AND couple_id = ?").get(id, coupleId) as
    | QuizRow
    | undefined;
}

export function getQuizByCode(code: string): QuizRow | undefined {
  return db.prepare("SELECT * FROM quizzes WHERE join_code = ?").get(code) as QuizRow | undefined;
}

function countSlides(quizId: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM quiz_slides WHERE quiz_id = ?").get(quizId) as {
      c: number;
    }
  ).c;
}

function countPlayers(quizId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM quiz_players WHERE quiz_id = ? AND removed_at IS NULL")
      .get(quizId) as { c: number }
  ).c;
}

export function listSlides(quizId: number): QuizSlideRow[] {
  return db
    .prepare("SELECT * FROM quiz_slides WHERE quiz_id = ? ORDER BY position ASC")
    .all(quizId) as QuizSlideRow[];
}

export function getSlideScoped(quizId: number, slideId: number): QuizSlideRow | undefined {
  return db
    .prepare("SELECT * FROM quiz_slides WHERE id = ? AND quiz_id = ?")
    .get(slideId, quizId) as QuizSlideRow | undefined;
}

// ─── couple-scoped writes ───────────────────────────────────────────────────────

export function createQuiz(coupleId: number, title: string): QuizRow {
  const ts = now();
  return db
    .prepare(
      `INSERT INTO quizzes (couple_id, title, join_code, status, phase, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', 'lobby', ?, ?) RETURNING *`,
    )
    .get(coupleId, title, uniqueJoinCode(), ts, ts) as QuizRow;
}

export function updateQuizTitle(id: number, coupleId: number, title: string): QuizRow {
  const row = db
    .prepare(
      `UPDATE quizzes SET title = ?, updated_at = ? WHERE id = ? AND couple_id = ? RETURNING *`,
    )
    .get(title, now(), id, coupleId) as QuizRow | undefined;
  if (!row) throw new HttpError(404, "Quiz not found");
  return row;
}

export function deleteQuiz(id: number, coupleId: number): void {
  const result = db.prepare("DELETE FROM quizzes WHERE id = ? AND couple_id = ?").run(id, coupleId);
  if (result.changes === 0) throw new HttpError(404, "Quiz not found");
}

function nextPosition(quizId: number): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM quiz_slides WHERE quiz_id = ?")
    .get(quizId) as { pos: number };
  return row.pos;
}

export function createSlide(
  quizId: number,
  input: {
    kind: QuizSlideKind;
    prompt: string;
    subtitle: string | null;
    timeLimitS: number | null;
    config: QuizSlideConfig;
  },
): QuizSlideRow {
  const ts = now();
  return db
    .prepare(
      `INSERT INTO quiz_slides
         (quiz_id, position, kind, prompt, subtitle, time_limit_s, points_base, config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      quizId,
      nextPosition(quizId),
      input.kind,
      input.prompt,
      input.subtitle,
      input.timeLimitS,
      QUIZ_DEFAULT_POINTS,
      JSON.stringify(input.config),
      ts,
      ts,
    ) as QuizSlideRow;
}

export function updateSlide(
  quizId: number,
  slideId: number,
  patch: Partial<{
    prompt: string;
    subtitle: string | null;
    timeLimitS: number | null;
    pointsBase: number;
    config: QuizSlideConfig;
  }>,
): QuizSlideRow {
  const existing = getSlideScoped(quizId, slideId);
  if (!existing) throw new HttpError(404, "Slide not found");

  const updates: string[] = [];
  const params: import("bun:sqlite").SQLQueryBindings[] = [];
  if (patch.prompt !== undefined) {
    updates.push("prompt = ?");
    params.push(patch.prompt);
  }
  if (patch.subtitle !== undefined) {
    updates.push("subtitle = ?");
    params.push(patch.subtitle);
  }
  if (patch.timeLimitS !== undefined) {
    updates.push("time_limit_s = ?");
    params.push(patch.timeLimitS);
  }
  if (patch.pointsBase !== undefined) {
    updates.push("points_base = ?");
    params.push(patch.pointsBase);
  }
  if (patch.config !== undefined) {
    updates.push("config_json = ?");
    params.push(JSON.stringify(patch.config));
  }
  if (updates.length === 0) return existing;

  updates.push("updated_at = ?");
  params.push(now(), slideId);
  return db
    .prepare(`UPDATE quiz_slides SET ${updates.join(", ")} WHERE id = ? RETURNING *`)
    .get(...params) as QuizSlideRow;
}

export function deleteSlide(quizId: number, slideId: number): void {
  const result = db
    .prepare("DELETE FROM quiz_slides WHERE id = ? AND quiz_id = ?")
    .run(slideId, quizId);
  if (result.changes === 0) throw new HttpError(404, "Slide not found");
}

/** Swap this slide's position with its neighbour in the requested direction.
 *  Deliberately no drag-and-drop dependency — two buttons and a swap are
 *  enough for a slide list a couple builds once and rarely reorders. */
export function moveSlide(
  quizId: number,
  slideId: number,
  direction: "up" | "down",
): QuizSlideRow[] {
  const slides = listSlides(quizId);
  const index = slides.findIndex((s) => s.id === slideId);
  if (index === -1) throw new HttpError(404, "Slide not found");
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= slides.length) return slides;

  const a = slides[index]!;
  const b = slides[swapWith]!;
  const ts = now();
  const swap = db.transaction(() => {
    db.prepare("UPDATE quiz_slides SET position = ?, updated_at = ? WHERE id = ?").run(
      b.position,
      ts,
      a.id,
    );
    db.prepare("UPDATE quiz_slides SET position = ?, updated_at = ? WHERE id = ?").run(
      a.position,
      ts,
      b.id,
    );
  });
  swap();
  return listSlides(quizId);
}

// ─── leaderboard ────────────────────────────────────────────────────────────────

export function playerScore(playerId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(points_awarded), 0) AS total FROM quiz_answers WHERE player_id = ?",
    )
    .get(playerId) as { total: number };
  return row.total;
}

export function listActivePlayers(quizId: number): QuizPlayerRow[] {
  return db
    .prepare(
      "SELECT * FROM quiz_players WHERE quiz_id = ? AND removed_at IS NULL ORDER BY joined_at ASC",
    )
    .all(quizId) as QuizPlayerRow[];
}

export function computeLeaderboard(
  quizId: number,
  currentSlideId: number | null,
  revealDeltas: boolean,
): QuizLeaderboardEntry[] {
  const players = listActivePlayers(quizId);
  const withScores = players.map((row) => ({
    row,
    player: toQuizPlayer(row, playerScore(row.id)),
    delta: revealDeltas && currentSlideId !== null ? slideDelta(currentSlideId, row.id) : null,
  }));
  withScores.sort((a, b) => b.player.score - a.player.score || a.row.joined_at - b.row.joined_at);
  return withScores.map(({ player, delta }, i) => ({ player, rank: i + 1, delta }));
}

function slideDelta(slideId: number, playerId: number): number {
  const row = db
    .prepare("SELECT points_awarded AS p FROM quiz_answers WHERE slide_id = ? AND player_id = ?")
    .get(slideId, playerId) as { p: number } | undefined;
  return row?.p ?? 0;
}

export function answeredCountForSlide(slideId: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS c FROM quiz_answers WHERE slide_id = ?").get(slideId) as {
      c: number;
    }
  ).c;
}

/** Every answer to one slide, anonymised — the source for the reveal
 *  breakdown on both the host console and every guest's own screen. */
export function listRevealedAnswers(slideId: number): QuizRevealedAnswer[] {
  const rows = db
    .prepare("SELECT value_json, correct FROM quiz_answers WHERE slide_id = ?")
    .all(slideId) as { value_json: string; correct: 0 | 1 | null }[];
  return rows.map((row) => ({
    value: JSON.parse(row.value_json) as QuizRevealedAnswer["value"],
    correct: row.correct === null ? null : row.correct === 1,
  }));
}

// ─── host control ────────────────────────────────────────────────────────────────

export function startQuiz(quiz: QuizRow): QuizRow {
  if (countSlides(quiz.id) === 0)
    throw new HttpError(400, "Add at least one slide before going live");
  return db
    .prepare(
      `UPDATE quizzes SET status = 'live', phase = 'lobby', current_slide_id = NULL, phase_started_at = NULL, updated_at = ?
       WHERE id = ? RETURNING *`,
    )
    .get(now(), quiz.id) as QuizRow;
}

/** Move to a specific slide (or the next one after the current) and open it
 *  for answers. */
export function beginSlide(quiz: QuizRow, slideId: number | "next"): QuizRow {
  const slides = listSlides(quiz.id);
  let target: QuizSlideRow | undefined;
  if (slideId === "next") {
    const currentIndex = slides.findIndex((s) => s.id === quiz.current_slide_id);
    target = slides[currentIndex + 1];
    if (!target)
      throw new HttpError(400, "No more slides — end the quiz instead", { code: "no_more_slides" });
  } else {
    target = slides.find((s) => s.id === slideId);
    if (!target) throw new HttpError(404, "Slide not found");
  }

  return db
    .prepare(
      `UPDATE quizzes SET phase = 'active', current_slide_id = ?, phase_started_at = ?, updated_at = ?
       WHERE id = ? RETURNING *`,
    )
    .get(target.id, now(), now(), quiz.id) as QuizRow;
}

export function revealQuiz(quiz: QuizRow): QuizRow {
  if (quiz.phase !== "active") throw new HttpError(400, "Nothing to reveal right now");
  return db
    .prepare(`UPDATE quizzes SET phase = 'reveal', updated_at = ? WHERE id = ? RETURNING *`)
    .get(now(), quiz.id) as QuizRow;
}

export function endQuiz(quiz: QuizRow): QuizRow {
  return db
    .prepare(
      `UPDATE quizzes SET status = 'ended', phase = 'ended', updated_at = ? WHERE id = ? RETURNING *`,
    )
    .get(now(), quiz.id) as QuizRow;
}

/** Wipe every player and answer and rotate the join code, so a rehearsal run
 *  and the real reception run never share a leaderboard, and a stale printed
 *  QR can't rejoin a fresh one. Slides (the authored content) are untouched. */
export function resetQuiz(quiz: QuizRow): QuizRow {
  const ts = now();
  const reset = db.transaction(() => {
    db.prepare(
      "DELETE FROM quiz_answers WHERE slide_id IN (SELECT id FROM quiz_slides WHERE quiz_id = ?)",
    ).run(quiz.id);
    db.prepare("DELETE FROM quiz_players WHERE quiz_id = ?").run(quiz.id);
  });
  reset();
  return db
    .prepare(
      `UPDATE quizzes
          SET status = 'draft', phase = 'lobby', current_slide_id = NULL, phase_started_at = NULL,
              join_code = ?, updated_at = ?
        WHERE id = ? RETURNING *`,
    )
    .get(uniqueJoinCode(), ts, quiz.id) as QuizRow;
}

// ─── host state DTO ────────────────────────────────────────────────────────────

export function getHostState(quiz: QuizRow): QuizHostState {
  const currentSlideRow = quiz.current_slide_id
    ? getSlideScoped(quiz.id, quiz.current_slide_id)
    : undefined;
  const players = listActivePlayers(quiz.id).map((row) => toQuizPlayer(row, playerScore(row.id)));
  const revealed = quiz.phase === "reveal" || quiz.phase === "ended";
  return {
    quiz: toQuizSummary(quiz),
    phase: quiz.phase,
    phaseStartedAt: quiz.phase_started_at,
    currentSlide: currentSlideRow ? toQuizSlide(currentSlideRow) : null,
    answeredCount: currentSlideRow ? answeredCountForSlide(currentSlideRow.id) : 0,
    totalPlayers: players.length,
    players,
    leaderboard: computeLeaderboard(quiz.id, quiz.current_slide_id, revealed),
    currentSlideAnswers:
      revealed && currentSlideRow ? listRevealedAnswers(currentSlideRow.id) : null,
  };
}

export { quizAnswersOpen };
