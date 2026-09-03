// Live wedding quiz game — public, no-login guest join/play. Scoped by the
// quiz's join_code (what /play/:code, the QR, and the couple's shared link
// all carry). A guest's identity is a token minted on join and replayed on
// the X-Quiz-Player-Token header — see domain/quiz_play.ts for why that's
// deliberately lighter-weight than a real auth credential.
//
// Public (no auth):
//   GET  /api/play/:code          — lookup + current public state
//   POST /api/play/:code/join     — {name, avatar} -> {player, token}
//   GET  /api/play/:code/state    — polled every ~1.3s by the guest's screen
//   POST /api/play/:code/answer   — {slideId, value}

import type { QuizAnswerValue } from "@shared/quiz";
import { QUIZ_AVATARS } from "@shared/quiz";
import {
  getPlayerByToken,
  getPublicState,
  joinQuiz,
  recordAnswer,
  resolveQuizByCode,
  touchPlayer,
} from "../domain/quiz_play";
import { HttpError, json, readJson, type Ctx, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const PLAYER_TOKEN_HEADER = "x-quiz-player-token";

// Guests behind one venue's WiFi NAT all share an IP and all poll on their
// own ~1.3s interval — this has to be generous enough that a room full of
// phones doesn't rate-limit itself during the one moment this feature exists
// for. Answer/join are one-shot actions per guest and stay tight.
const QUIZ_STATE_BUCKET = { capacity: 400, refillRate: 6 };
const QUIZ_JOIN_BUCKET = { capacity: 20, refillRate: 1 / 6 };
const QUIZ_ANSWER_BUCKET = { capacity: 30, refillRate: 1 };

function optionalPlayer(ctx: Ctx, quizId: number) {
  const token = ctx.req.headers.get(PLAYER_TOKEN_HEADER);
  if (!token) return undefined;
  return getPlayerByToken(quizId, token);
}

function handleLookup(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "quiz:lookup", QUIZ_STATE_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveQuizByCode(code);
  const player = optionalPlayer(ctx, resolved.quiz.id);
  return json(getPublicState(resolved, player));
}

async function handleJoin(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "quiz:join", QUIZ_JOIN_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveQuizByCode(code);

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const name = typeof body.name === "string" ? body.name : "";
  const avatar =
    typeof body.avatar === "string" && QUIZ_AVATARS.includes(body.avatar)
      ? body.avatar
      : QUIZ_AVATARS[0]!;
  const existingToken = ctx.req.headers.get(PLAYER_TOKEN_HEADER);

  const { player, token } = joinQuiz(resolved.quiz, existingToken, name, avatar);
  return json({
    player: { id: player.id, name: player.name, avatar: player.avatar },
    token,
    state: getPublicState(resolved, player),
  });
}

function handleState(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "quiz:state", QUIZ_STATE_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveQuizByCode(code);
  const player = optionalPlayer(ctx, resolved.quiz.id);
  if (player) touchPlayer(player.id);
  return json(getPublicState(resolved, player));
}

async function handleAnswer(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "quiz:answer", QUIZ_ANSWER_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveQuizByCode(code);
  const player = optionalPlayer(ctx, resolved.quiz.id);
  if (!player) throw new HttpError(401, "Join the quiz first", { code: "not_joined" });

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const slideId = Number(body.slideId);
  if (!Number.isFinite(slideId)) throw new HttpError(400, "slideId required");
  const value = parseAnswerValue(body.value);

  const result = recordAnswer(resolved.quiz, player, slideId, value);
  return json(result);
}

function parseAnswerValue(raw: unknown): QuizAnswerValue {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (body.kind === "mcq" || body.kind === "binary") {
    if (!Number.isInteger(body.optionIndex)) throw new HttpError(400, "optionIndex required");
    return { kind: body.kind, optionIndex: body.optionIndex as number };
  }
  if (body.kind === "number") {
    if (typeof body.value !== "number" || !Number.isFinite(body.value))
      throw new HttpError(400, "value required");
    return { kind: "number", value: body.value };
  }
  if (body.kind === "heatmap") {
    if (typeof body.x !== "number" || typeof body.y !== "number")
      throw new HttpError(400, "x/y required");
    return { kind: "heatmap", x: body.x, y: body.y };
  }
  throw new HttpError(400, "Unrecognised answer kind");
}

export function registerQuizPlayRoutes(router: Router): void {
  router.get("/api/play/:code", handleLookup);
  router.post("/api/play/:code/join", handleJoin);
  router.get("/api/play/:code/state", handleState);
  router.post("/api/play/:code/answer", handleAnswer);
}
