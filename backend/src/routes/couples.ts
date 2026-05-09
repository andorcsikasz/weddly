// Onboarding + workspace mgmt: complete the onboarding wizard, fetch the
// current couple, generate a partner-B invite, accept an invite.

import {
  type Couple,
  type CoupleInvite,
  DEFAULT_BUDGET_SPLIT,
  INVITE_TTL_MS,
  type WeddingStyleTag,
} from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type CoupleRow, getCoupleById, getCoupleForUser, toCouple } from "../lib/couples";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { generateInviteToken } from "../lib/invite_codes";

interface InviteRow {
  id: number;
  couple_id: number;
  token: string;
  invited_email: string | null;
  invited_by_user_id: number;
  consumed_at: number | null;
  expires_at: number;
  created_at: number;
}

function toInvite(row: InviteRow): CoupleInvite {
  return {
    id: row.id,
    couple_id: row.couple_id,
    token: row.token,
    invited_email: row.invited_email,
    invited_by_user_id: row.invited_by_user_id,
    consumed_at: row.consumed_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

interface OnboardBody {
  display_name?: unknown;
  wedding_date?: unknown;
  target_guest_count?: unknown;
  budget_ceiling_huf?: unknown;
  location_lat?: unknown;
  location_lng?: unknown;
  location_radius_km?: unknown;
  style_tags?: unknown;
}

const ALLOWED_STYLE_TAGS: ReadonlySet<WeddingStyleTag> = new Set([
  "classic",
  "modern",
  "rustic",
  "garden",
  "bohemian",
  "minimalist",
  "vintage",
  "destination",
]);

function parseStyleTags(raw: unknown): WeddingStyleTag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is WeddingStyleTag =>
      typeof t === "string" && ALLOWED_STYLE_TAGS.has(t as WeddingStyleTag),
  );
}

function parseDisplayName(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "display_name required");
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new HttpError(400, "display_name must be 1–200 chars");
  }
  return trimmed;
}

function parseWeddingDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "wedding_date must be YYYY-MM-DD");
  }
  return raw;
}

function parseOptionalInt(
  raw: unknown,
  field: string,
  min = 0,
  max = 1_000_000_000,
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} out of range`);
  return Math.round(n);
}

function parseOptionalFloat(raw: unknown, field: string, min: number, max: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} out of range`);
  return n;
}

function seedBudgetLines(coupleId: number, ceilingHuf: number) {
  const ts = now();
  const insert = db.prepare(
    `INSERT INTO budget_lines (couple_id, category, label, planned_huf, actual_huf, supplier_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
  );
  for (const [category, share] of Object.entries(DEFAULT_BUDGET_SPLIT)) {
    if (share <= 0) continue;
    const planned = Math.round(ceilingHuf * share);
    insert.run(coupleId, category, prettyCategoryLabel(category), planned, ts, ts);
  }
}

function prettyCategoryLabel(category: string): string {
  // Backend gives a stable English fallback; the frontend translates via i18n.
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function handleOnboard(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const body = await readJson<OnboardBody>(ctx.req);

  const displayName = parseDisplayName(body.display_name);
  const weddingDate = parseWeddingDate(body.wedding_date);
  const targetGuestCount = parseOptionalInt(
    body.target_guest_count,
    "target_guest_count",
    1,
    10000,
  );
  const budgetCeiling = parseOptionalInt(body.budget_ceiling_huf, "budget_ceiling_huf", 0);
  const locLat = parseOptionalFloat(body.location_lat, "location_lat", -90, 90);
  const locLng = parseOptionalFloat(body.location_lng, "location_lng", -180, 180);
  const locRadius = parseOptionalInt(body.location_radius_km, "location_radius_km", 0, 5000);
  const styleTags = parseStyleTags(body.style_tags);

  const existing = getCoupleForUser(userId);
  if (existing) throw new HttpError(409, "Couple already onboarded for this user");

  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO couples
        (partner_a_id, partner_b_id, display_name, wedding_date, target_guest_count,
         budget_ceiling_huf, location_lat, location_lng, location_radius_km,
         style_tags_json, status, created_at, updated_at, onboarded_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    )
    .run(
      userId,
      displayName,
      weddingDate,
      targetGuestCount,
      budgetCeiling,
      locLat,
      locLng,
      locRadius,
      JSON.stringify(styleTags),
      ts,
      ts,
      ts,
    );
  const coupleId = Number(result.lastInsertRowid);

  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );

  if (budgetCeiling && budgetCeiling > 0) {
    seedBudgetLines(coupleId, budgetCeiling);
  }

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "couple.onboard",
    target_kind: "couple",
    target_id: coupleId,
    after: { display_name: displayName, wedding_date: weddingDate },
  });

  const row = getCoupleById(coupleId);
  if (!row) throw new HttpError(500, "Couple vanished after insert");
  const couple: Couple = toCouple(row);
  return json({ couple }, { status: 201 });
}

function handleGetCurrentCouple(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const row = getCoupleForUser(userId);
  if (!row) return json({ couple: null });
  return json({ couple: toCouple(row) });
}

interface InviteCreateBody {
  invited_email?: unknown;
}

async function handleCreateInvite(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "Onboard a couple before inviting a partner");
  if (couple.partner_b_id) throw new HttpError(409, "Partner B already linked");

  const body = await readJson<InviteCreateBody>(ctx.req);
  let invitedEmail: string | null = null;
  if (typeof body.invited_email === "string" && body.invited_email.trim()) {
    invitedEmail = body.invited_email.trim().toLowerCase();
  }

  const token = generateInviteToken();
  const ts = now();
  const expiresAt = ts + INVITE_TTL_MS;
  const result = db
    .prepare(
      `INSERT INTO couple_invites
        (couple_id, token, invited_email, invited_by_user_id, consumed_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(couple.id, token, invitedEmail, userId, expiresAt, ts);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "invite.create",
    target_kind: "couple_invite",
    target_id: Number(result.lastInsertRowid),
    after: { invited_email: invitedEmail },
  });

  const row = db.prepare("SELECT * FROM couple_invites WHERE id = ?").get(result.lastInsertRowid) as
    | InviteRow
    | undefined;
  if (!row) throw new HttpError(500, "Invite vanished after insert");
  return json({ invite: toInvite(row) }, { status: 201 });
}

function handleGetInvite(ctx: Ctx): Response {
  const token = ctx.params.token;
  if (!token) throw new HttpError(400, "Missing token");
  const row = db.prepare("SELECT * FROM couple_invites WHERE token = ?").get(token) as
    | InviteRow
    | undefined;
  if (!row) throw new HttpError(404, "Invite not found");
  if (row.consumed_at) throw new HttpError(410, "Invite already used");
  if (row.expires_at < now()) throw new HttpError(410, "Invite expired");

  const couple = getCoupleById(row.couple_id);
  return json({
    invite: toInvite(row),
    couple_display_name: couple?.display_name ?? null,
  });
}

async function handleAcceptInvite(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const token = ctx.params.token;
  if (!token) throw new HttpError(400, "Missing token");

  const row = db.prepare("SELECT * FROM couple_invites WHERE token = ?").get(token) as
    | InviteRow
    | undefined;
  if (!row) throw new HttpError(404, "Invite not found");
  if (row.consumed_at) throw new HttpError(410, "Invite already used");
  if (row.expires_at < now()) throw new HttpError(410, "Invite expired");

  const userCouple = getCoupleForUser(userId);
  if (userCouple) throw new HttpError(409, "User already belongs to a couple");

  const couple = getCoupleById(row.couple_id);
  if (!couple) throw new HttpError(404, "Couple no longer exists");
  if (couple.partner_b_id) throw new HttpError(409, "Partner B already linked");

  const ts = now();
  db.prepare("UPDATE couples SET partner_b_id = ?, updated_at = ? WHERE id = ?").run(
    userId,
    ts,
    couple.id,
  );
  db.prepare("UPDATE users SET couple_id = ?, role = 'partner', updated_at = ? WHERE id = ?").run(
    couple.id,
    ts,
    userId,
  );
  db.prepare("UPDATE couple_invites SET consumed_at = ? WHERE id = ?").run(ts, row.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "invite.accept",
    target_kind: "couple",
    target_id: couple.id,
    note: `partner_b linked via invite ${row.id}`,
  });

  const refreshed = getCoupleById(couple.id) as CoupleRow;
  return json({ couple: toCouple(refreshed) });
}

export function registerCoupleRoutes(router: Router) {
  router.post("/api/couples/onboard", handleOnboard, true);
  router.get("/api/couples/current", handleGetCurrentCouple, true);
  router.post("/api/couples/invites", handleCreateInvite, true);
  router.get("/api/invites/:token", handleGetInvite); // public — pre-signup
  router.post("/api/invites/:token/accept", handleAcceptInvite, true);
}
