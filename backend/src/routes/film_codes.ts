// Weddly Camera tryout codes. The admin console mints and revokes them; a
// signed-in customer checks one (the /camera/start form, before it creates a
// workspace) and redeems it on their film. Rules live in domain/film_codes.ts.
//
// Deliberately NOT behind the `film_checkout` launch control: a code involves
// no payment, and handing out free films is exactly what an admin wants to
// do while card payments are still switched off.

import { FILM_PRICE_TIERS, filmTier } from "@shared/film_pricing";
import type { FilmPromoCode } from "@shared/types";
import { db } from "../db";
import { getCoupleForUser } from "../domain/couples";
import {
  checkFilmCode,
  createFilmCode,
  FilmCodeError,
  filmCodeHttpStatus,
  generateFilmCode,
  listFilmCodes,
  normalizeFilmCode,
  redeemFilmCode,
  revokeFilmCode,
} from "../domain/film_codes";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { HttpError, json, readJson, requireAuth, type Ctx, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const MAX_REDEMPTIONS_CEILING = 10_000;
// A wrong guess costs a slot, so ten tries then one every 30s: enough for
// typos, useless for walking the code space.
const CODE_ATTEMPT_BUCKET = { capacity: 10, refillRate: 1 / 30 };

function refuse(err: unknown): never {
  if (err instanceof FilmCodeError) {
    throw new HttpError(filmCodeHttpStatus(err.code), err.code, { code: err.code });
  }
  throw err;
}

function readCode(raw: unknown): string {
  const code = normalizeFilmCode(raw);
  if (!code) throw new HttpError(400, "That is not a code", { code: "invalid_code" });
  return code;
}

function albumForUser(userId: number): { id: number; guest_cap: number; couple_id: number } | null {
  const couple = getCoupleForUser(userId);
  if (!couple) return null;
  return (
    (db
      .prepare("SELECT id, guest_cap, couple_id FROM photo_albums WHERE couple_id = ?")
      .get(couple.id) as { id: number; guest_cap: number; couple_id: number } | undefined) ?? null
  );
}

// ─── admin ──────────────────────────────────────────────────────────────────

async function handleList(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  return json({ codes: listFilmCodes() });
}

interface CreateBody {
  code?: unknown;
  cap?: unknown;
  max_redemptions?: unknown;
  expires_at?: unknown;
  note?: unknown;
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<CreateBody>(ctx.req);

  // Blank means "make one up"; anything typed must be a valid code.
  const typed = typeof body.code === "string" && body.code.trim() !== "";
  const code = typed ? readCode(body.code) : generateFilmCode();

  if (typeof body.cap !== "number" || !filmTier(body.cap)) {
    throw new HttpError(
      400,
      `cap must be one of ${FILM_PRICE_TIERS.map((t) => t.cap).join(", ")}`,
      { code: "invalid_cap" },
    );
  }
  const max = body.max_redemptions ?? 1;
  if (
    typeof max !== "number" ||
    !Number.isInteger(max) ||
    max < 1 ||
    max > MAX_REDEMPTIONS_CEILING
  ) {
    throw new HttpError(400, `max_redemptions must be 1-${MAX_REDEMPTIONS_CEILING}`, {
      code: "invalid_max_redemptions",
    });
  }
  const expiresAt = body.expires_at ?? null;
  if (expiresAt !== null && (typeof expiresAt !== "number" || !Number.isFinite(expiresAt))) {
    throw new HttpError(400, "expires_at must be a unix ms timestamp", { code: "invalid_expiry" });
  }
  const noteRaw = body.note ?? null;
  if (noteRaw !== null && (typeof noteRaw !== "string" || noteRaw.length > 200)) {
    throw new HttpError(400, "note must be a string of at most 200 chars", {
      code: "invalid_note",
    });
  }
  const note = typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw.trim() : null;

  let created: FilmPromoCode | null = createFilmCode({
    code,
    cap: body.cap,
    maxRedemptions: max,
    expiresAt,
    note,
    createdBy: admin.id,
  });
  // A generated code colliding is a one-in-a-trillion event; one retry ends it.
  if (!created && !typed) {
    created = createFilmCode({
      code: generateFilmCode(),
      cap: body.cap,
      maxRedemptions: max,
      expiresAt,
      note,
      createdBy: admin.id,
    });
  }
  if (!created) throw new HttpError(409, "That code already exists", { code: "code_taken" });

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "film_code.created",
    target_kind: "film_promo_code",
    target_id: created.id,
    after: { code: created.code, cap: created.cap, max_redemptions: max, expires_at: expiresAt },
  });
  return json({ code: created }, { status: 201 });
}

async function handleRevoke(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number.parseInt(ctx.params.id ?? "", 10);
  if (!Number.isInteger(id)) throw new HttpError(400, "id required");
  const revoked = revokeFilmCode(id);
  if (!revoked) throw new HttpError(404, "Code not found");
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "film_code.revoked",
    target_kind: "film_promo_code",
    target_id: id,
    note: revoked.code,
  });
  return json({ code: revoked });
}

// ─── customer ───────────────────────────────────────────────────────────────

/** POST /api/film-codes/check {code} → {cap}. Spends nothing. */
async function handleCheck(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  rateLimit(`user:${userId}`, "film_code", CODE_ATTEMPT_BUCKET);
  const body = await readJson<{ code?: unknown }>(ctx.req);
  const code = readCode(body.code);
  const album = albumForUser(userId);
  try {
    const { cap } = checkFilmCode(code, album?.id ?? null, album?.guest_cap ?? null);
    return json({ cap });
  } catch (err) {
    refuse(err);
  }
}

/** POST /api/film-codes/redeem {code} → {cap}. Opens the user's film. */
async function handleRedeem(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  rateLimit(`user:${userId}`, "film_code", CODE_ATTEMPT_BUCKET);
  const body = await readJson<{ code?: unknown }>(ctx.req);
  const code = readCode(body.code);
  const album = albumForUser(userId);
  if (!album) throw new HttpError(404, "Create the film first", { code: "no_film" });
  try {
    const result = redeemFilmCode(code, album.id, userId);
    addAuditLog({
      actor_user_id: userId,
      couple_id: album.couple_id,
      action: "film_code.redeemed",
      target_kind: "film_promo_code",
      target_id: result.codeId,
      before: { guest_cap: result.capBefore },
      after: { guest_cap: Math.max(result.capBefore, result.cap) },
      note: code,
    });
    return json({ cap: result.cap });
  } catch (err) {
    refuse(err);
  }
}

export function registerFilmCodeRoutes(router: Router): void {
  router.get("/api/admin/film-codes", handleList, true);
  router.post("/api/admin/film-codes", handleCreate, true);
  router.post("/api/admin/film-codes/:id/revoke", handleRevoke, true);
  router.post("/api/film-codes/check", handleCheck, true);
  router.post("/api/film-codes/redeem", handleRedeem, true);
}
