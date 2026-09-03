// Live wedding quiz game — a couple authors a Kahoot-style trivia round about
// themselves, hosts it live from /app/games/:id/host (QR + control), and
// guests join from their own phones with no login at /play/:code.
//
// STATE IS DERIVED, NEVER STORED for anything time-based — the same rule
// `holdState` follows in date_holds.ts and `quoteStatus` follows in
// booking_quotes.ts. What the DB keeps is `phase_started_at` plus the current
// slide's `time_limit_s`; whether answers are still open is computed against
// `now` on every read, so a question closing needs no cron. `phase` itself
// (lobby/active/reveal/ended) IS stored, because moving from 'active' to
// 'reveal' is a deliberate host action (presenter pacing at the reception),
// not a timer expiring — a host may sit on a closed question for a minute of
// banter before revealing it.
//
// One `scoreAnswer` function covers all four answerable slide kinds, so the
// backend (authoritative) and the frontend (optimistic preview) can never
// disagree about how a correct answer becomes points.

import type { UnixMs } from "./types";

export type QuizSlideKind = "mcq" | "binary" | "number" | "heatmap" | "section" | "story";
export type QuizPhase = "lobby" | "active" | "reveal" | "ended";
export type QuizStatus = "draft" | "live" | "ended";

// ─── slide config, per kind ──────────────────────────────────────────────────

export interface QuizMcqConfig {
  kind: "mcq";
  /** 2-4 options. The builder defaults to 4 (the "A/B/C/D" the couple asked for). */
  options: string[];
  /** null = opinion-only slide, never scored, still shows the room's spread at reveal. */
  correctIndex: number | null;
}

export interface QuizBinaryConfig {
  kind: "binary";
  options: [string, string];
  correctIndex: 0 | 1 | null;
}

export interface QuizNumberConfig {
  kind: "number";
  min: number;
  max: number;
  step: number;
  correctValue: number | null;
  unit: string | null;
  /** Fraction of (max - min) within which a guess counts as correct. */
  toleranceFraction: number;
}

export interface QuizHeatmapConfig {
  kind: "heatmap";
  /** [low end, high end] labels for each axis, e.g. ["Calm", "Sobbing"]. */
  xLabel: [string, string];
  yLabel: [string, string];
  /** Normalized 0..1 coordinates. null = pure "where did everyone tap", unscored. */
  target: { x: number; y: number } | null;
  /** Normalized-unit radius around `target` that counts as correct. */
  toleranceRadius: number;
}

export interface QuizSectionConfig {
  kind: "section";
}

export interface QuizStoryConfig {
  kind: "story";
}

export type QuizSlideConfig =
  | QuizMcqConfig
  | QuizBinaryConfig
  | QuizNumberConfig
  | QuizHeatmapConfig
  | QuizSectionConfig
  | QuizStoryConfig;

// ─── answer values ────────────────────────────────────────────────────────────

export type QuizAnswerValue =
  | { kind: "mcq" | "binary"; optionIndex: number }
  | { kind: "number"; value: number }
  | { kind: "heatmap"; x: number; y: number };

// ─── domain objects ───────────────────────────────────────────────────────────

export interface QuizSlide {
  id: number;
  quizId: number;
  position: number;
  kind: QuizSlideKind;
  /** Question text / section title / story body. */
  prompt: string;
  /** Section subtitle / story continuation line. */
  subtitle: string | null;
  timeLimitS: number | null;
  pointsBase: number;
  config: QuizSlideConfig;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

export interface QuizPlayer {
  id: number;
  quizId: number;
  name: string;
  avatar: string;
  joinedAt: UnixMs;
  score: number;
}

export interface QuizLeaderboardEntry {
  player: QuizPlayer;
  rank: number;
  /** Points earned on the slide just revealed, or null outside a reveal. */
  delta: number | null;
}

// ─── response DTOs — the contract both sides import, per shared/types.ts's rule ──

export interface QuizSummary {
  id: number;
  title: string;
  joinCode: string;
  status: QuizStatus;
  phase: QuizPhase;
  slideCount: number;
  playerCount: number;
  createdAt: UnixMs;
  updatedAt: UnixMs;
}

/** GET /api/quizzes/:id — full builder/host view, slides included with their
 *  correct answers (this is the couple-authenticated shape; guests never see it). */
export interface QuizDetail extends QuizSummary {
  slides: QuizSlide[];
}

/** One player's answer to the current slide, surfaced only once it's
 *  revealed — the bar/dot-plot/scatter breakdown on both the host's and every
 *  guest's own reveal screen is built from this same list, so the two can
 *  never disagree about what the room answered. Anonymous by design: a
 *  party-game reveal, not an attributed record. */
export interface QuizRevealedAnswer {
  value: QuizAnswerValue;
  correct: boolean | null;
}

/** GET /api/quizzes/:id/host-state — polled by the host console. */
export interface QuizHostState {
  quiz: QuizSummary;
  phase: QuizPhase;
  phaseStartedAt: UnixMs | null;
  currentSlide: QuizSlide | null;
  answeredCount: number;
  totalPlayers: number;
  players: QuizPlayer[];
  leaderboard: QuizLeaderboardEntry[];
  /** Populated only once `phase` is 'reveal'/'ended'. */
  currentSlideAnswers: QuizRevealedAnswer[] | null;
}

/** GET /api/play/:code and /api/play/:code/state — polled by the guest's own
 *  screen. `currentSlide` has its correct answer/target stripped unless
 *  `phase` is 'reveal'/'ended' (see `stripSlideSecrets`). */
export interface QuizPublicState {
  quizTitle: string;
  hostDisplayName: string;
  status: QuizStatus;
  phase: QuizPhase;
  phaseStartedAt: UnixMs | null;
  currentSlide: QuizSlide | null;
  hasAnswered: boolean;
  totalPlayers: number;
  myScore: number | null;
  myRank: number | null;
  leaderboard: QuizLeaderboardEntry[] | null;
  currentSlideAnswers: QuizRevealedAnswer[] | null;
}

/** POST /api/play/:code/answer response. */
export interface QuizAnswerResult {
  correct: boolean | null;
  points: number;
  myTotal: number;
}

// ─── constants ────────────────────────────────────────────────────────────────

export const QUIZ_SLIDE_KINDS: readonly QuizSlideKind[] = [
  "mcq",
  "binary",
  "number",
  "heatmap",
  "section",
  "story",
];

/** True for the four kinds a guest actually answers; false for the two pure
 *  presentation kinds (section dividers, story beats). */
export function quizSlideIsAnswerable(kind: QuizSlideKind): boolean {
  return kind === "mcq" || kind === "binary" || kind === "number" || kind === "heatmap";
}

export const QUIZ_DEFAULT_POINTS = 1000;
export const QUIZ_DEFAULT_TIME_LIMIT_S = 20;
export const QUIZ_NUMBER_DEFAULT_TOLERANCE_FRACTION = 0.05;
export const QUIZ_HEATMAP_DEFAULT_TOLERANCE_RADIUS = 0.15;

/** Wedding-party-flavoured character grid for the guest join screen. Stored
 *  directly as the emoji — same idiom the marketing preview page already uses
 *  for `MARKETS.icon` in GamesPage.tsx, no id indirection needed. */
export const QUIZ_AVATARS: readonly string[] = [
  "🦄",
  "🥂",
  "🎉",
  "🦋",
  "🌹",
  "💃",
  "🕺",
  "🎩",
  "👰",
  "🤵",
  "🎭",
  "🐝",
  "🌻",
  "🍰",
  "🐶",
  "🎺",
];

/** Avoid 0/O/1/I/L, same alphabet family as invite_codes.ts's ALPHABET —
 *  guests read this off a screen across a room and type it by hand. */
export const QUIZ_JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const QUIZ_JOIN_CODE_LENGTH = 6;

export const QUIZ_PLAYER_NAME_MAX = 40;
export const QUIZ_MCQ_MIN_OPTIONS = 2;
export const QUIZ_MCQ_MAX_OPTIONS = 4;
export const QUIZ_OPTION_TEXT_MAX = 80;
export const QUIZ_PROMPT_MAX = 300;
export const QUIZ_SUBTITLE_MAX = 600;

// ─── phase machine (derived) ──────────────────────────────────────────────────

export interface QuizPhaseFacts {
  phase: QuizPhase;
  phase_started_at: UnixMs | null;
  time_limit_s: number | null;
}

/** Whether the current slide is still accepting answers, right now. Derived
 *  purely from `phase` + `phase_started_at` + the slide's own `time_limit_s` —
 *  no sweep needed for a question to close itself. */
export function quizAnswersOpen(q: QuizPhaseFacts, nowMs: UnixMs): boolean {
  if (q.phase !== "active") return false;
  if (q.time_limit_s === null || q.phase_started_at === null) return true; // untimed, host-paced slide
  return nowMs < q.phase_started_at + q.time_limit_s * 1000;
}

/** Milliseconds left on a timed, active slide. Zero in every other case. */
export function quizTimeRemainingMs(q: QuizPhaseFacts, nowMs: UnixMs): number {
  if (q.phase !== "active" || q.time_limit_s === null || q.phase_started_at === null) return 0;
  return Math.max(0, q.phase_started_at + q.time_limit_s * 1000 - nowMs);
}

// ─── scoring ──────────────────────────────────────────────────────────────────

export interface QuizScoreResult {
  /** null = this slide has no correct answer set (opinion-only / untargeted),
   *  so nobody is right or wrong and nothing is awarded. */
  correct: boolean | null;
  points: number;
}

/** Correct answers pay out between 50% and 100% of `pointsBase` depending on
 *  how much of the time window was used — instant is full marks, answering
 *  right at the buffer is half. Untimed (host-paced) slides pay flat, since
 *  there is no window to race against. */
function speedScaledPoints(
  pointsBase: number,
  timeLimitS: number | null,
  responseMs: number,
): number {
  if (timeLimitS === null || timeLimitS <= 0) return pointsBase;
  const windowMs = timeLimitS * 1000;
  const usedFraction = Math.min(1, Math.max(0, responseMs / windowMs));
  const factor = 1 - 0.5 * usedFraction;
  return Math.max(0, Math.round(pointsBase * factor));
}

/** The one scoring function for all four answerable kinds. `responseMs` must
 *  come from the server's own clock (now - phase_started_at) — never trust a
 *  client-reported timestamp. Returns `{correct: null, points: 0}` for a
 *  mismatched value kind, an unanswerable slide, or a slide with no correct
 *  answer configured. */
export function scoreAnswer(
  slide: {
    kind: QuizSlideKind;
    config: QuizSlideConfig;
    pointsBase: number;
    timeLimitS: number | null;
  },
  value: QuizAnswerValue,
  responseMs: number,
): QuizScoreResult {
  let correct: boolean | null = null;

  if (slide.kind === "mcq" || slide.kind === "binary") {
    const cfg = slide.config as QuizMcqConfig | QuizBinaryConfig;
    if (cfg.kind === slide.kind && cfg.correctIndex !== null && value.kind === slide.kind) {
      correct = value.optionIndex === cfg.correctIndex;
    }
  } else if (slide.kind === "number") {
    const cfg = slide.config as QuizNumberConfig;
    if (cfg.kind === "number" && cfg.correctValue !== null && value.kind === "number") {
      const range = Math.max(1e-9, cfg.max - cfg.min);
      const tolerance = range * cfg.toleranceFraction;
      correct = Math.abs(value.value - cfg.correctValue) <= tolerance;
    }
  } else if (slide.kind === "heatmap") {
    const cfg = slide.config as QuizHeatmapConfig;
    if (cfg.kind === "heatmap" && cfg.target !== null && value.kind === "heatmap") {
      const dx = value.x - cfg.target.x;
      const dy = value.y - cfg.target.y;
      correct = Math.sqrt(dx * dx + dy * dy) <= cfg.toleranceRadius;
    }
  }

  if (correct !== true) return { correct, points: 0 };
  return {
    correct: true,
    points: speedScaledPoints(slide.pointsBase, slide.timeLimitS, responseMs),
  };
}

/** Strip whatever would give the answer away, for the guest-facing projection
 *  while a slide is 'active'. Reusing the same "null = nothing to show" the
 *  config already carries for an opinion-only/untargeted slide means a guest
 *  can never tell, pre-answer, whether a correct answer exists at all — which
 *  is exactly the property this needs. */
export function stripSlideSecrets(config: QuizSlideConfig): QuizSlideConfig {
  switch (config.kind) {
    case "mcq":
      return { ...config, correctIndex: null };
    case "binary":
      return { ...config, correctIndex: null };
    case "number":
      return { ...config, correctValue: null };
    case "heatmap":
      return { ...config, target: null };
    case "section":
    case "story":
      return config;
  }
}
