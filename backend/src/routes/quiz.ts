// Live wedding quiz game — couple-authenticated authoring + host control.
//
// Authenticated (couple only):
//   GET    /api/quizzes                       — list the couple's quizzes
//   POST   /api/quizzes                       — create one (draft)
//   GET    /api/quizzes/:id                   — full detail incl. slides + correct answers (host/builder view)
//   PATCH  /api/quizzes/:id                   — rename
//   DELETE /api/quizzes/:id
//   POST   /api/quizzes/:id/slides            — add a slide
//   PATCH  /api/quizzes/:id/slides/:slideId
//   DELETE /api/quizzes/:id/slides/:slideId
//   POST   /api/quizzes/:id/slides/:slideId/move   — {direction: 'up'|'down'}
//   GET    /api/quizzes/:id/host-state        — polled by the host console
//   POST   /api/quizzes/:id/host/start
//   POST   /api/quizzes/:id/host/begin-slide  — {slideId: number | 'next'}
//   POST   /api/quizzes/:id/host/reveal
//   POST   /api/quizzes/:id/host/end
//   POST   /api/quizzes/:id/host/reset        — wipes players+answers, rotates join_code
//   GET    /api/quizzes/:id/qr                — printable QR (PNG, ?format=svg)
//
// Guest-facing join/state/answer endpoints live in routes/quiz_play.ts.

import { CONFIG } from "../config";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  beginSlide,
  createQuiz,
  createSlide,
  deleteQuiz,
  deleteSlide,
  endQuiz,
  getHostState,
  getQuizScoped,
  listQuizzesForCouple,
  moveSlide,
  parseSlideCreateInput,
  parseSlideUpdateInput,
  resetQuiz,
  revealQuiz,
  startQuiz,
  toQuizDetail,
  updateQuizTitle,
  updateSlide,
} from "../domain/quiz";
import { HttpError, json, readJson, requireAuth, type Ctx, type Router } from "../lib/http";
import { generateQrPng, generateQrSvg } from "../lib/qrcode";

const TITLE_MAX = 120;

function requireCouple(ctx: Ctx) {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, couple };
}

function requireQuiz(ctx: Ctx, coupleId: number) {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const quiz = getQuizScoped(id, coupleId);
  if (!quiz) throw new HttpError(404, "Quiz not found");
  return quiz;
}

// ─── quiz CRUD ────────────────────────────────────────────────────────────────

function handleList(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  return json({ quizzes: listQuizzesForCouple(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > TITLE_MAX)
    throw new HttpError(400, `title must be 1-${TITLE_MAX} chars`);

  const row = createQuiz(couple.id, title);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "quiz.create",
    target_kind: "quiz",
    target_id: row.id,
    after: { title },
  });
  return json({ quiz: toQuizDetail(row) }, { status: 201 });
}

function handleGet(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  return json({ quiz: toQuizDetail(quiz) });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  if (typeof body.title !== "string" || !body.title.trim() || body.title.length > TITLE_MAX) {
    throw new HttpError(400, `title must be 1-${TITLE_MAX} chars`);
  }
  const row = updateQuizTitle(quiz.id, couple.id, body.title.trim());
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "quiz.update",
    target_kind: "quiz",
    target_id: quiz.id,
    after: { title: row.title },
  });
  return json({ quiz: toQuizDetail(row) });
}

function handleDelete(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  deleteQuiz(quiz.id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "quiz.delete",
    target_kind: "quiz",
    target_id: quiz.id,
    before: { title: quiz.title },
  });
  return json({ ok: true });
}

// ─── slides ────────────────────────────────────────────────────────────────────

/** Slides can only be authored while the quiz isn't live — a live session's
 *  content is locked until the host ends or resets it, so the slide the host
 *  console is showing right now can never change out from under a guest
 *  mid-answer. */
function requireEditable(quiz: { status: string }) {
  if (quiz.status === "live") {
    throw new HttpError(400, "End or reset the live session before editing slides", {
      code: "quiz_live",
    });
  }
}

async function handleCreateSlide(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  requireEditable(quiz);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const input = parseSlideCreateInput(body);
  createSlide(quiz.id, input);
  return json({ quiz: toQuizDetail(quiz) }, { status: 201 });
}

async function handleUpdateSlide(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  requireEditable(quiz);
  const slideId = Number(ctx.params.slideId);
  if (!Number.isFinite(slideId)) throw new HttpError(400, "Invalid slide id");

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const detail = toQuizDetail(quiz);
  const slide = detail.slides.find((s) => s.id === slideId);
  if (!slide) throw new HttpError(404, "Slide not found");

  const patch = parseSlideUpdateInput(slide.kind, body);
  updateSlide(quiz.id, slideId, patch);
  return json({ quiz: toQuizDetail(quiz) });
}

function handleDeleteSlide(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  requireEditable(quiz);
  const slideId = Number(ctx.params.slideId);
  if (!Number.isFinite(slideId)) throw new HttpError(400, "Invalid slide id");
  deleteSlide(quiz.id, slideId);
  return json({ quiz: toQuizDetail(quiz) });
}

async function handleMoveSlide(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  requireEditable(quiz);
  const slideId = Number(ctx.params.slideId);
  if (!Number.isFinite(slideId)) throw new HttpError(400, "Invalid slide id");
  const body = await readJson<Record<string, unknown>>(ctx.req);
  if (body.direction !== "up" && body.direction !== "down") {
    throw new HttpError(400, "direction must be 'up' or 'down'");
  }
  moveSlide(quiz.id, slideId, body.direction);
  return json({ quiz: toQuizDetail(quiz) });
}

// ─── host control ────────────────────────────────────────────────────────────────

function handleHostState(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  return json(getHostState(quiz));
}

function handleHostStart(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  const row = startQuiz(quiz);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "quiz.host.start",
    target_kind: "quiz",
    target_id: quiz.id,
  });
  return json(getHostState(row));
}

async function handleHostBeginSlide(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  if (quiz.status !== "live")
    throw new HttpError(400, "Quiz isn't live", { code: "quiz_not_live" });
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const slideId = body.slideId === "next" ? ("next" as const) : Number(body.slideId);
  if (slideId !== "next" && !Number.isFinite(slideId)) throw new HttpError(400, "slideId required");
  const row = beginSlide(quiz, slideId);
  return json(getHostState(row));
}

function handleHostReveal(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  const row = revealQuiz(quiz);
  return json(getHostState(row));
}

function handleHostEnd(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  const row = endQuiz(quiz);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "quiz.host.end",
    target_kind: "quiz",
    target_id: quiz.id,
  });
  return json(getHostState(row));
}

function handleHostReset(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  const row = resetQuiz(quiz);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "quiz.host.reset",
    target_kind: "quiz",
    target_id: quiz.id,
  });
  return json({ quiz: toQuizDetail(row) });
}

/** GET /api/quizzes/:id/qr — printable QR pointing guests at /play/:code.
 *  Same shape as photo-albums' QR (lib/qrcode.ts). Couple-only: the code
 *  itself is already public once printed, but generating it is an authoring
 *  action, not something to expose anonymously. */
async function handleGetQr(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const quiz = requireQuiz(ctx, couple.id);
  const url = `${CONFIG.frontendBaseUrl}/play/${quiz.join_code}`;
  const wantsSvg = ctx.url.searchParams.get("format") === "svg";

  if (wantsSvg) {
    return new Response(await generateQrSvg(url), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": 'inline; filename="quiz-qr.svg"',
      },
    });
  }
  const png = await generateQrPng(url);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": 'inline; filename="quiz-qr.png"',
    },
  });
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerQuizRoutes(router: Router): void {
  router.get("/api/quizzes", handleList, true);
  router.post("/api/quizzes", handleCreate, true);
  router.get("/api/quizzes/:id", handleGet, true);
  router.patch("/api/quizzes/:id", handleUpdate, true);
  router.delete("/api/quizzes/:id", handleDelete, true);

  router.post("/api/quizzes/:id/slides", handleCreateSlide, true);
  router.patch("/api/quizzes/:id/slides/:slideId", handleUpdateSlide, true);
  router.delete("/api/quizzes/:id/slides/:slideId", handleDeleteSlide, true);
  router.post("/api/quizzes/:id/slides/:slideId/move", handleMoveSlide, true);

  router.get("/api/quizzes/:id/host-state", handleHostState, true);
  router.post("/api/quizzes/:id/host/start", handleHostStart, true);
  router.post("/api/quizzes/:id/host/begin-slide", handleHostBeginSlide, true);
  router.post("/api/quizzes/:id/host/reveal", handleHostReveal, true);
  router.post("/api/quizzes/:id/host/end", handleHostEnd, true);
  router.post("/api/quizzes/:id/host/reset", handleHostReset, true);

  router.get("/api/quizzes/:id/qr", handleGetQr, true);
}
