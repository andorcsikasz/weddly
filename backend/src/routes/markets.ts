// Live wedding prediction markets — couple-authenticated authoring/control
// plus public guest join/play. Sibling of routes/quiz.ts + routes/quiz_play.ts
// under the same "Wēddly Games" umbrella; same shapes, same conventions,
// different game. Kept in one file (unlike the quiz/quiz_play split) since
// there's no slide-by-slide host console here to justify a second file.
//
// Authenticated (couple only):
//   GET    /api/markets                              — list the couple's boards
//   POST   /api/markets                               — create one (draft)
//   GET    /api/markets/:id                            — full detail incl. questions + pools
//   PATCH  /api/markets/:id                            — rename
//   DELETE /api/markets/:id
//   POST   /api/markets/:id/start                      — draft -> live (share the join code)
//   POST   /api/markets/:id/end                        — stop new joins/bets board-wide
//   GET    /api/markets/:id/leaderboard
//   GET    /api/markets/:id/qr                         — printable QR (PNG, ?format=svg)
//   POST   /api/markets/:id/questions
//   PATCH  /api/markets/:id/questions/:qid
//   DELETE /api/markets/:id/questions/:qid
//   POST   /api/markets/:id/questions/:qid/resolve      — {outcome: 'yes'|'no'}
//   POST   /api/markets/:id/questions/:qid/void
//
// Public (no auth), guest identity is a token minted on join and replayed on
// X-Market-Player-Token — same lightweight party-game posture as the quiz's
// X-Quiz-Player-Token, not an auth credential:
//   GET  /api/play/markets/:code                       — lookup + current public state
//   POST /api/play/markets/:code/join                   — {name, avatar} -> {player, token, state}
//   GET  /api/play/markets/:code/state                  — polled by the guest's screen
//   POST /api/play/markets/:code/questions/:qid/bet     — {side, stake}
//   GET  /api/play/markets/:code/questions/:qid/preview — ?side=&stake= -> {estimatedPayout}

import { MARKET_AVATARS, type MarketOutcome, type MarketSide } from "@shared/markets";
import { CONFIG } from "../config";
import { getCoupleForUser } from "../domain/couples";
import {
  computeLeaderboard,
  createBoard,
  createQuestion,
  deleteBoard,
  deleteQuestion,
  endBoard,
  getBoardScoped,
  getQuestionScoped,
  listBoardsForCouple,
  parseBoardTitle,
  parseClosesAt,
  parseQuestionPrompt,
  resolveQuestion,
  startBoard,
  toMarketBoardDetail,
  toMarketBoardSummary,
  toMarketQuestion,
  updateBoardTitle,
  updateQuestion,
  voidQuestion,
} from "../domain/markets";
import {
  getPlayerByToken,
  getPublicState,
  joinBoard,
  placeBet,
  previewPayout,
  resolveBoardByCode,
  touchPlayer,
} from "../domain/markets_play";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { generateQrPng, generateQrSvg } from "../lib/qrcode";
import { rateLimit } from "../lib/rate_limit";

const PLAYER_TOKEN_HEADER = "x-market-player-token";

// Same reasoning as quiz_play.ts's buckets: a venue's WiFi NAT puts a whole
// room behind one IP, all polling their own screen — state has to be
// generous enough that this isn't the thing that rate-limits itself during
// the reception. Join/bet are one-shot(ish) actions per guest and stay tight.
const MARKET_STATE_BUCKET = { capacity: 400, refillRate: 6 };
const MARKET_JOIN_BUCKET = { capacity: 20, refillRate: 1 / 6 };
const MARKET_BET_BUCKET = { capacity: 30, refillRate: 1 };

// ─── couple-side helpers ────────────────────────────────────────────────────────

function requireCouple(ctx: Ctx) {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return { userId, couple };
}

function requireBoard(ctx: Ctx, coupleId: number) {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const board = getBoardScoped(id, coupleId);
  if (!board) throw new HttpError(404, "Board not found");
  return board;
}

function requireQuestionId(ctx: Ctx): number {
  const qid = Number(ctx.params.qid);
  if (!Number.isFinite(qid)) throw new HttpError(400, "Invalid question id");
  return qid;
}

function requireOutcome(raw: unknown): MarketOutcome {
  if (raw !== "yes" && raw !== "no") throw new HttpError(400, "outcome must be 'yes' or 'no'");
  return raw;
}

// ─── board CRUD ─────────────────────────────────────────────────────────────────

function handleList(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  return json({ boards: listBoardsForCouple(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const title = parseBoardTitle(body.title ?? "");
  const board = createBoard(couple.id, title);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.board.create",
    target_kind: "market_board",
    target_id: board.id,
    after: { title },
  });
  return json({ board: toMarketBoardDetail(board) }, { status: 201 });
}

function handleGet(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  return json({ board: toMarketBoardDetail(board) });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  if (body.title === undefined) throw new HttpError(400, "Nothing to update");
  const updated = updateBoardTitle(board.id, couple.id, parseBoardTitle(body.title));
  return json({ board: toMarketBoardSummary(updated) });
}

function handleDelete(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  deleteBoard(board.id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.board.delete",
    target_kind: "market_board",
    target_id: board.id,
  });
  return json({ ok: true });
}

function handleStart(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const started = startBoard(board);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.board.start",
    target_kind: "market_board",
    target_id: board.id,
  });
  return json({ board: toMarketBoardDetail(started) });
}

function handleEnd(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const ended = endBoard(board);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.board.end",
    target_kind: "market_board",
    target_id: board.id,
  });
  return json({ board: toMarketBoardDetail(ended) });
}

function handleLeaderboard(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  return json({ leaderboard: computeLeaderboard(board.id) });
}

async function handleGetQr(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const url = `${CONFIG.frontendBaseUrl}/play/markets/${board.join_code}`;
  const wantsSvg = ctx.url.searchParams.get("format") === "svg";

  if (wantsSvg) {
    return new Response(await generateQrSvg(url), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": 'inline; filename="markets-qr.svg"',
      },
    });
  }
  const png = await generateQrPng(url);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": 'inline; filename="markets-qr.png"',
    },
  });
}

// ─── question CRUD ──────────────────────────────────────────────────────────────

async function handleCreateQuestion(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const prompt = parseQuestionPrompt(body.prompt);
  const closesAt = parseClosesAt(body.closesAt);
  const question = createQuestion(board.id, { prompt, closesAt });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.question.create",
    target_kind: "market_question",
    target_id: question.id,
    after: { prompt, closesAt },
  });
  return json({ board: toMarketBoardDetail(board) }, { status: 201 });
}

async function handleUpdateQuestion(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const qid = requireQuestionId(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const patch: { prompt?: string; closesAt?: number } = {};
  if (body.prompt !== undefined) patch.prompt = parseQuestionPrompt(body.prompt);
  if (body.closesAt !== undefined) patch.closesAt = parseClosesAt(body.closesAt);
  updateQuestion(board.id, qid, patch);
  return json({ board: toMarketBoardDetail(board) });
}

function handleDeleteQuestion(ctx: Ctx): Response {
  const { couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const qid = requireQuestionId(ctx);
  deleteQuestion(board.id, qid);
  return json({ board: toMarketBoardDetail(board) });
}

async function handleResolveQuestion(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const qid = requireQuestionId(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const outcome = requireOutcome(body.outcome);
  const question = resolveQuestion(board.id, qid, outcome);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.question.resolve",
    target_kind: "market_question",
    target_id: qid,
    after: { outcome },
  });
  return json({ question: toMarketQuestion(question) });
}

function handleVoidQuestion(ctx: Ctx): Response {
  const { userId, couple } = requireCouple(ctx);
  const board = requireBoard(ctx, couple.id);
  const qid = requireQuestionId(ctx);
  const question = voidQuestion(board.id, qid);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "markets.question.void",
    target_kind: "market_question",
    target_id: qid,
  });
  return json({ question: toMarketQuestion(question) });
}

// ─── guest-side ─────────────────────────────────────────────────────────────────

function optionalPlayer(ctx: Ctx, boardId: number) {
  const token = ctx.req.headers.get(PLAYER_TOKEN_HEADER);
  if (!token) return undefined;
  return getPlayerByToken(boardId, token);
}

function handleLookup(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "markets:lookup", MARKET_STATE_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveBoardByCode(code);
  const player = optionalPlayer(ctx, resolved.board.id);
  return json(getPublicState(resolved, player));
}

async function handlePlayJoin(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "markets:join", MARKET_JOIN_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveBoardByCode(code);

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const name = typeof body.name === "string" ? body.name : "";
  const avatar =
    typeof body.avatar === "string" && MARKET_AVATARS.includes(body.avatar)
      ? body.avatar
      : (MARKET_AVATARS[0] as string);
  const existingToken = ctx.req.headers.get(PLAYER_TOKEN_HEADER);

  const { player, token } = joinBoard(resolved.board, existingToken, name, avatar);
  return json({
    player: { id: player.id, name: player.name, avatar: player.avatar, balance: player.balance },
    token,
    state: getPublicState(resolved, player),
  });
}

function handlePlayState(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "markets:state", MARKET_STATE_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveBoardByCode(code);
  const player = optionalPlayer(ctx, resolved.board.id);
  if (player) touchPlayer(player.id);
  return json(getPublicState(resolved, player));
}

async function handleBet(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "markets:bet", MARKET_BET_BUCKET);
  const code = ctx.params.code ?? "";
  const resolved = resolveBoardByCode(code);
  const player = optionalPlayer(ctx, resolved.board.id);
  if (!player) throw new HttpError(401, "Join the board first", { code: "not_joined" });

  const qid = requireQuestionId(ctx);
  const body = await readJson<Record<string, unknown>>(ctx.req);
  const side: MarketSide | null = body.side === "yes" || body.side === "no" ? body.side : null;
  if (!side) throw new HttpError(400, "side must be 'yes' or 'no'");
  const stake = typeof body.stake === "number" ? Math.trunc(body.stake) : Number.NaN;

  const result = placeBet(resolved.board, player, qid, side, stake);
  return json({ result, state: getPublicState(resolved, player) });
}

function handlePreview(ctx: Ctx): Response {
  const code = ctx.params.code ?? "";
  const resolved = resolveBoardByCode(code);
  const qid = requireQuestionId(ctx);
  const question = getQuestionScoped(resolved.board.id, qid);
  if (!question) throw new HttpError(404, "Question not found");
  const side = ctx.url.searchParams.get("side");
  const stake = Number(ctx.url.searchParams.get("stake") ?? "0");
  if (side !== "yes" && side !== "no") throw new HttpError(400, "side must be 'yes' or 'no'");
  if (!Number.isFinite(stake) || stake < 0) throw new HttpError(400, "Invalid stake");
  return json({ estimatedPayout: previewPayout(qid, side, Math.trunc(stake)) });
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerMarketsRoutes(router: Router): void {
  router.get("/api/markets", handleList, true);
  router.post("/api/markets", handleCreate, true);
  router.get("/api/markets/:id", handleGet, true);
  router.patch("/api/markets/:id", handleUpdate, true);
  router.delete("/api/markets/:id", handleDelete, true);
  router.post("/api/markets/:id/start", handleStart, true);
  router.post("/api/markets/:id/end", handleEnd, true);
  router.get("/api/markets/:id/leaderboard", handleLeaderboard, true);
  router.get("/api/markets/:id/qr", handleGetQr, true);
  router.post("/api/markets/:id/questions", handleCreateQuestion, true);
  router.patch("/api/markets/:id/questions/:qid", handleUpdateQuestion, true);
  router.delete("/api/markets/:id/questions/:qid", handleDeleteQuestion, true);
  router.post("/api/markets/:id/questions/:qid/resolve", handleResolveQuestion, true);
  router.post("/api/markets/:id/questions/:qid/void", handleVoidQuestion, true);

  router.get("/api/play/markets/:code", handleLookup);
  router.post("/api/play/markets/:code/join", handlePlayJoin);
  router.get("/api/play/markets/:code/state", handlePlayState);
  router.post("/api/play/markets/:code/questions/:qid/bet", handleBet);
  router.get("/api/play/markets/:code/questions/:qid/preview", handlePreview);
}
