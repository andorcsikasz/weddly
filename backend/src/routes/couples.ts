// Onboarding + workspace mgmt: complete the onboarding wizard, fetch the
// current couple, generate a partner-B invite, accept an invite.

import {
  type BudgetGoal,
  type BudgetKind,
  type CeremonyKind,
  type Couple,
  type CoupleInvite,
  type CouplePartnerView,
  DEFAULT_BUDGET_SPLIT,
  type GuestCountGoal,
  type GuestCountKind,
  INVITE_TTL_MS,
  type WeddingDateGoal,
  type WeddingDateKind,
  type WeddingSeason,
  type WeddingStyleTag,
} from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type CoupleRow, getCoupleById, getCoupleForUser, toCouple } from "../domain/couples";
import { sendKind } from "../domain/emails";
import { recordExport } from "../domain/exports";
import { generateInviteToken } from "../domain/invite_codes";
import { listGuestsByCouple } from "../domain/guests";
import { renderSeatingChartPdf } from "../domain/pdf";
import { deriveSlugBase, uniqueCoupleSlug, validateSlug } from "../domain/slug";
import { getUserById, toUser, type UserRow } from "../domain/users";
import {
  type Ctx,
  HttpError,
  json,
  readJson,
  requireAuth,
  requireVerifiedAuth,
  type Router,
} from "../lib/http";
import type { SeatingTable, SeatAssignment, TableShape } from "@shared/types";

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
  /** Preferred: split partner names. The backend derives `display_name` from these. */
  bride_name?: unknown;
  groom_name?: unknown;
  /** Legacy shape: a single display name. Honoured if bride/groom are absent. */
  display_name?: unknown;
  /** Preferred: structured goal. Falls back to legacy `wedding_date` scalar. */
  wedding_date_goal?: unknown;
  wedding_date?: unknown;
  /** Preferred: structured goal. Falls back to legacy scalar. */
  guest_count_goal?: unknown;
  target_guest_count?: unknown;
  /** Preferred: structured goal. Falls back to legacy scalar. */
  budget_goal?: unknown;
  budget_ceiling_huf?: unknown;
  location_lat?: unknown;
  location_lng?: unknown;
  location_radius_km?: unknown;
  style_tags?: unknown;
  /** civil | religious | both | null. */
  ceremony_kind?: unknown;
}

const VALID_CEREMONY_KINDS: ReadonlySet<CeremonyKind> = new Set(["civil", "religious", "both"]);
function parseCeremonyKind(raw: unknown): CeremonyKind | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !VALID_CEREMONY_KINDS.has(raw as CeremonyKind)) {
    throw new HttpError(400, "ceremony_kind invalid");
  }
  return raw as CeremonyKind;
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

function parsePartnerName(raw: unknown, field: "bride_name" | "groom_name"): string {
  if (typeof raw !== "string") throw new HttpError(400, `${field} required`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new HttpError(400, `${field} must be 1–100 chars`);
  }
  return trimmed;
}

/**
 * Names + derived display_name. Prefer split bride/groom (the wizard sends
 * these); fall back to legacy `display_name` so older clients/tests keep
 * working.
 */
function parseNames(body: OnboardBody): {
  brideName: string;
  groomName: string;
  displayName: string;
} {
  const hasSplit = body.bride_name !== undefined || body.groom_name !== undefined;
  if (hasSplit) {
    const brideName = parsePartnerName(body.bride_name, "bride_name");
    const groomName = parsePartnerName(body.groom_name, "groom_name");
    return { brideName, groomName, displayName: `${brideName} & ${groomName}` };
  }
  const displayName = parseDisplayName(body.display_name);
  return { brideName: "", groomName: "", displayName };
}

function parseWeddingDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "wedding_date must be YYYY-MM-DD");
  }
  return raw;
}

const VALID_DATE_KINDS: ReadonlySet<WeddingDateKind> = new Set([
  "exact",
  "month",
  "season",
  "year",
  "tbd",
]);
const VALID_SEASONS: ReadonlySet<WeddingSeason> = new Set(["spring", "summer", "fall", "winter"]);
const VALID_COUNT_KINDS: ReadonlySet<GuestCountKind> = new Set(["exact", "range", "tbd"]);
const VALID_BUDGET_KINDS: ReadonlySet<BudgetKind> = new Set(["exact", "range", "tbd"]);
const MIN_YEAR = 2024;
const MAX_YEAR = 2100;

function asObject(raw: unknown, field: string): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, `${field} must be an object`);
  }
  return raw as Record<string, unknown>;
}

function parseWeddingDateGoal(body: OnboardBody): WeddingDateGoal {
  const obj = asObject(body.wedding_date_goal, "wedding_date_goal");
  if (!obj) {
    const exact = parseWeddingDate(body.wedding_date);
    return {
      kind: exact ? "exact" : "tbd",
      exact_date: exact,
      target_year: exact ? Number(exact.slice(0, 4)) : null,
      target_month: exact ? Number(exact.slice(5, 7)) : null,
      target_season: null,
    };
  }
  const kindRaw = obj.kind;
  if (typeof kindRaw !== "string" || !VALID_DATE_KINDS.has(kindRaw as WeddingDateKind)) {
    throw new HttpError(400, "wedding_date_goal.kind invalid");
  }
  const kind = kindRaw as WeddingDateKind;
  if (kind === "tbd") {
    return { kind, exact_date: null, target_year: null, target_month: null, target_season: null };
  }
  if (kind === "exact") {
    const exact = parseWeddingDate(obj.exact_date);
    if (!exact) throw new HttpError(400, "wedding_date_goal.exact_date required when kind='exact'");
    return {
      kind,
      exact_date: exact,
      target_year: Number(exact.slice(0, 4)),
      target_month: Number(exact.slice(5, 7)),
      target_season: null,
    };
  }
  const year = parseOptionalInt(
    obj.target_year,
    "wedding_date_goal.target_year",
    MIN_YEAR,
    MAX_YEAR,
  );
  if (year === null) {
    throw new HttpError(400, "wedding_date_goal.target_year required for this kind");
  }
  if (kind === "month") {
    const month = parseOptionalInt(obj.target_month, "wedding_date_goal.target_month", 1, 12);
    if (month === null) throw new HttpError(400, "wedding_date_goal.target_month required");
    return { kind, exact_date: null, target_year: year, target_month: month, target_season: null };
  }
  if (kind === "season") {
    const seasonRaw = obj.target_season;
    if (typeof seasonRaw !== "string" || !VALID_SEASONS.has(seasonRaw as WeddingSeason)) {
      throw new HttpError(400, "wedding_date_goal.target_season invalid");
    }
    return {
      kind,
      exact_date: null,
      target_year: year,
      target_month: null,
      target_season: seasonRaw as WeddingSeason,
    };
  }
  // kind === 'year'
  return { kind, exact_date: null, target_year: year, target_month: null, target_season: null };
}

function parseGuestCountGoal(body: OnboardBody): GuestCountGoal {
  const obj = asObject(body.guest_count_goal, "guest_count_goal");
  if (!obj) {
    const exact = parseOptionalInt(body.target_guest_count, "target_guest_count", 1, 10000);
    return { kind: exact === null ? "tbd" : "exact", exact, min: null, max: null };
  }
  const kindRaw = obj.kind;
  if (typeof kindRaw !== "string" || !VALID_COUNT_KINDS.has(kindRaw as GuestCountKind)) {
    throw new HttpError(400, "guest_count_goal.kind invalid");
  }
  const kind = kindRaw as GuestCountKind;
  if (kind === "tbd") return { kind, exact: null, min: null, max: null };
  if (kind === "exact") {
    const exact = parseOptionalInt(obj.exact, "guest_count_goal.exact", 1, 10000);
    if (exact === null)
      throw new HttpError(400, "guest_count_goal.exact required when kind='exact'");
    return { kind, exact, min: null, max: null };
  }
  const min = parseOptionalInt(obj.min, "guest_count_goal.min", 1, 10000);
  const max = parseOptionalInt(obj.max, "guest_count_goal.max", 1, 10000);
  if (min === null || max === null) {
    throw new HttpError(400, "guest_count_goal range needs min and max");
  }
  if (min > max) throw new HttpError(400, "guest_count_goal.min must be <= max");
  return { kind, exact: null, min, max };
}

function parseBudgetGoal(body: OnboardBody): BudgetGoal {
  const obj = asObject(body.budget_goal, "budget_goal");
  if (!obj) {
    const exact = parseOptionalInt(body.budget_ceiling_huf, "budget_ceiling_huf", 0);
    return {
      kind: exact === null ? "tbd" : "exact",
      exact_huf: exact,
      min_huf: null,
      max_huf: null,
    };
  }
  const kindRaw = obj.kind;
  if (typeof kindRaw !== "string" || !VALID_BUDGET_KINDS.has(kindRaw as BudgetKind)) {
    throw new HttpError(400, "budget_goal.kind invalid");
  }
  const kind = kindRaw as BudgetKind;
  if (kind === "tbd") return { kind, exact_huf: null, min_huf: null, max_huf: null };
  if (kind === "exact") {
    const exact = parseOptionalInt(obj.exact_huf, "budget_goal.exact_huf", 0);
    if (exact === null)
      throw new HttpError(400, "budget_goal.exact_huf required when kind='exact'");
    return { kind, exact_huf: exact, min_huf: null, max_huf: null };
  }
  const min = parseOptionalInt(obj.min_huf, "budget_goal.min_huf", 0);
  const max = parseOptionalInt(obj.max_huf, "budget_goal.max_huf", 0);
  if (min === null || max === null) {
    throw new HttpError(400, "budget_goal range needs min_huf and max_huf");
  }
  if (min > max) throw new HttpError(400, "budget_goal.min_huf must be <= max_huf");
  return { kind, exact_huf: null, min_huf: min, max_huf: max };
}

/** Pick a representative HUF amount from a goal — used to seed budget lines. */
function representativeBudgetHuf(goal: BudgetGoal): number {
  if (goal.kind === "exact") return goal.exact_huf ?? 0;
  if (goal.kind === "range" && goal.min_huf !== null && goal.max_huf !== null) {
    return Math.round((goal.min_huf + goal.max_huf) / 2);
  }
  return 0;
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
  // Onboarding is the gate: a user can sign up and look around, but they
  // can't create their workspace until they've confirmed their email. Keeps
  // throwaway / typo-email accounts from polluting the couples table and
  // makes sure the password-reset path works the moment something goes wrong.
  const userId = requireVerifiedAuth(ctx, getUserById);
  const body = await readJson<OnboardBody>(ctx.req);

  const { brideName, groomName, displayName } = parseNames(body);
  const dateGoal = parseWeddingDateGoal(body);
  const guestGoal = parseGuestCountGoal(body);
  const budgetGoal = parseBudgetGoal(body);
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
        (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
         wedding_date, wedding_date_kind, wedding_target_year, wedding_target_month, wedding_target_season,
         target_guest_count, guest_count_kind, target_guest_count_min, target_guest_count_max,
         budget_ceiling_huf, budget_kind, budget_ceiling_min_huf, budget_ceiling_max_huf,
         location_lat, location_lng, location_radius_km,
         style_tags_json, status, created_at, updated_at, onboarded_at)
       VALUES (?, NULL, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?,
               ?, 'active', ?, ?, ?)`,
    )
    .run(
      userId,
      displayName,
      brideName,
      groomName,
      dateGoal.exact_date,
      dateGoal.kind,
      dateGoal.target_year,
      dateGoal.target_month,
      dateGoal.target_season,
      guestGoal.exact,
      guestGoal.kind,
      guestGoal.min,
      guestGoal.max,
      budgetGoal.exact_huf,
      budgetGoal.kind,
      budgetGoal.min_huf,
      budgetGoal.max_huf,
      locLat,
      locLng,
      locRadius,
      JSON.stringify(styleTags),
      ts,
      ts,
      ts,
    );
  const coupleId = Number(result.lastInsertRowid);

  // Derive the public couple slug ("ANDORSARI") right at onboarding so the
  // RSVP check-in URL is shareable from minute zero.
  const slug = uniqueCoupleSlug(deriveSlugBase(brideName, groomName, displayName), coupleId);
  db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(slug, ts, coupleId);

  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );

  // Range budgets seed lines off the midpoint; TBD seeds nothing.
  const seedHuf = representativeBudgetHuf(budgetGoal);
  if (seedHuf > 0) seedBudgetLines(coupleId, seedHuf);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "couple.onboard",
    target_kind: "couple",
    target_id: coupleId,
    after: {
      display_name: displayName,
      bride_name: brideName,
      groom_name: groomName,
      wedding_date_goal: dateGoal,
      guest_count_goal: guestGoal,
      budget_goal: budgetGoal,
    },
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
  // Same gate: only verified users can email an invite to their partner.
  // (Reading / accepting an invite stays public — partner B comes through
  // their own verify flow when they register.)
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "Onboard a couple before inviting a partner");
  if (couple.partner_b_id) throw new HttpError(409, "Partner B already linked");

  const body = await readJson<InviteCreateBody>(ctx.req);
  let invitedEmail: string | null = null;
  if (typeof body.invited_email === "string" && body.invited_email.trim()) {
    invitedEmail = body.invited_email.trim().toLowerCase();
  }

  // A couple is exactly two people: the owner + one partner. Block inviting
  // your own address — accepting it would be a self-link, and even just
  // sending the welcome mail to yourself is confusing UX.
  if (invitedEmail) {
    const inviter = getUserById(userId);
    if (inviter && inviter.email.toLowerCase() === invitedEmail) {
      throw new HttpError(400, "You can't invite your own email address", {
        code: "invite_own_email",
      });
    }
  }

  // Max one outstanding invite per couple — the workspace caps at two
  // people, so chaining "Send to another address" without revoking the
  // previous one would leak parallel tokens. The UI surfaces a "Cancel
  // invite" action for typo recovery (see handleCancelInvite below).
  const ts0 = now();
  const pending = db
    .prepare(
      `SELECT id FROM couple_invites
        WHERE couple_id = ? AND consumed_at IS NULL AND expires_at > ?
        LIMIT 1`,
    )
    .get(couple.id, ts0) as { id: number } | undefined;
  if (pending) {
    throw new HttpError(409, "An invite is already pending — cancel it before sending another", {
      code: "invite_already_pending",
    });
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

  // Fire-and-forget invite email. If invited_email is missing, the inviter
  // shares the link manually (the dashboard already shows a copy-link button).
  if (invitedEmail) {
    const inviter = getUserById(userId);
    const inviteUrl = `${CONFIG.frontendBaseUrl}/invite/${token}`;
    const inviterName = inviter?.full_name ?? "Your partner";
    // Pass the couple's display name only when it's a real one — empty / the
    // post-purge "Purged workspace" sentinel would just look weird in the body.
    const coupleDisplayName =
      couple.display_name && couple.display_name !== "Purged workspace"
        ? couple.display_name
        : undefined;
    void sendKind(
      "partner_invite",
      { inviterName, inviteUrl, coupleDisplayName },
      {
        // Partner B has no Weddly account yet — treat as a guest recipient.
        user: null,
        guest: { email: invitedEmail, full_name: "" },
        couple_id: couple.id,
      },
    );
  }

  return json({ invite: toInvite(row) }, { status: 201 });
}

/** Revoke any pending invite this couple has open. We don't DELETE — schema
 *  is additive-only and we want the audit trail to keep the original row.
 *  Instead we stamp `consumed_at` so the token can't be accepted, then the
 *  caller can create a fresh invite for a different address. */
/** Read the couple's currently-pending invite, if any. Used by surfaces
 *  that need to hide their "send invite" widget once one is already out
 *  in flight (Dashboard) or surface the email a typo went to (Profile).
 *  Returns `{ invite: null }` rather than 404 so the caller can always
 *  treat the response the same way. */
function handleGetCurrentInvite(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const ts = now();
  const row = db
    .prepare(
      `SELECT id, couple_id, token, invited_email, invited_by_user_id, consumed_at, expires_at, created_at
         FROM couple_invites
         WHERE couple_id = ? AND consumed_at IS NULL AND expires_at > ?
         ORDER BY id DESC LIMIT 1`,
    )
    .get(couple.id, ts) as InviteRow | undefined;

  return json({ invite: row ? toInvite(row) : null });
}

function handleCancelInvite(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const ts = now();
  const pending = db
    .prepare(
      `SELECT id, token FROM couple_invites
        WHERE couple_id = ? AND consumed_at IS NULL AND expires_at > ?
        LIMIT 1`,
    )
    .get(couple.id, ts) as { id: number; token: string } | undefined;

  if (!pending) {
    // Nothing to cancel — idempotent success keeps the UI flow simple.
    return json({ ok: true, cancelled: false });
  }

  db.prepare("UPDATE couple_invites SET consumed_at = ? WHERE id = ?").run(ts, pending.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "invite.cancel",
    target_kind: "couple_invite",
    target_id: pending.id,
    note: "voided by inviter before acceptance",
  });
  return json({ ok: true, cancelled: true });
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

async function handleUpdateSlug(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<{ slug?: unknown }>(ctx.req);
  if (typeof body.slug !== "string") throw new HttpError(400, "slug required");
  let cleaned: string;
  try {
    cleaned = validateSlug(body.slug);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Invalid slug");
  }
  // Reject if another couple already owns this exact slug.
  const taken = db
    .prepare("SELECT id FROM couples WHERE slug = ? AND id <> ?")
    .get(cleaned, couple.id) as { id: number } | undefined;
  if (taken) throw new HttpError(409, "Slug already taken");

  const ts = now();
  db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(
    cleaned,
    ts,
    couple.id,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.slug_update",
    target_kind: "couple",
    target_id: couple.id,
    before: { slug: couple.slug },
    after: { slug: cleaned },
  });

  const refreshed = getCoupleById(couple.id) as CoupleRow;
  return json({ couple: toCouple(refreshed) });
}

/** Partial-update endpoint for inline edits from the workspace (e.g. clicking
 *  the wedding date on the dashboard to change it). Reuses onboarding parsers
 *  so validation stays consistent. Currently supports `wedding_date_goal`;
 *  other goal fields can be wired in here as inline-edit affordances ship. */
async function handleUpdateCurrentCouple(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple to update");

  const body = await readJson<Partial<OnboardBody>>(ctx.req);
  const updates: { col: string; val: string | number | null }[] = [];
  const auditAfter: Record<string, unknown> = {};

  if (body.wedding_date_goal !== undefined || body.wedding_date !== undefined) {
    const goal = parseWeddingDateGoal(body as OnboardBody);
    // Stash the prior `wedding_date` if (and only if) the exact date is
    // actually changing — gives the wedding-date-changed email a clean
    // before/after pair to render. Cleared dates (going back to TBD) still
    // record the previous value so the notification can say "was X, now TBD".
    if (couple.wedding_date && couple.wedding_date !== goal.exact_date) {
      updates.push({ col: "previous_wedding_date", val: couple.wedding_date });
    }
    updates.push(
      { col: "wedding_date", val: goal.exact_date },
      { col: "wedding_date_kind", val: goal.kind },
      { col: "wedding_target_year", val: goal.target_year },
      { col: "wedding_target_month", val: goal.target_month },
      { col: "wedding_target_season", val: goal.target_season },
    );
    auditAfter.wedding_date_goal = goal;
  }

  if (body.ceremony_kind !== undefined) {
    const kind = parseCeremonyKind(body.ceremony_kind);
    updates.push({ col: "ceremony_kind", val: kind });
    auditAfter.ceremony_kind = kind;
  }

  if (body.budget_goal !== undefined || body.budget_ceiling_huf !== undefined) {
    const goal = parseBudgetGoal(body as OnboardBody);
    updates.push(
      { col: "budget_ceiling_huf", val: goal.exact_huf },
      { col: "budget_kind", val: goal.kind },
      { col: "budget_ceiling_min_huf", val: goal.min_huf },
      { col: "budget_ceiling_max_huf", val: goal.max_huf },
    );
    auditAfter.budget_goal = goal;
  }

  if (updates.length === 0) throw new HttpError(400, "No fields to update");

  const ts = now();
  const setClause = `${updates.map((u) => `${u.col} = ?`).join(", ")}, updated_at = ?`;
  const values = [...updates.map((u) => u.val), ts, couple.id];
  db.prepare(`UPDATE couples SET ${setClause} WHERE id = ?`).run(...values);

  const refreshed = getCoupleById(couple.id);
  if (!refreshed) throw new HttpError(500, "Couple vanished after update");

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.update",
    target_kind: "couple",
    target_id: couple.id,
    after: auditAfter,
  });

  return json({ couple: toCouple(refreshed) });
}

// ─── Archive ───────────────────────────────────────────────────────────────
//
// `POST /api/couples/current/archive` flips `couples.status` to `archived`
// and stamps `archived_at`. We also generate one final-bundle export per
// archive — seating PDF (A4) + guests CSV + a full GDPR-style JSON snapshot
// — so the couple has a one-click "send me my data" moment when they say
// goodbye. The workspace stays readable; pause-to-delete is still the path
// for actual deletion.

interface ArchiveTableRow {
  id: number;
  couple_id: number;
  label: string;
  shape: string;
  seats: number;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  length_mm: number;
  rotation_deg: number | null;
  disabled_seats_json: string | null;
  baby_seats_json: string | null;
  is_kids_table: number | null;
  created_at: number;
  updated_at: number;
}

interface ArchiveAssignRow {
  id: number;
  table_id: number;
  seat_index: number;
  guest_id: number;
}

function loadTablesForArchive(coupleId: number): SeatingTable[] {
  const rows = db
    .prepare("SELECT * FROM seating_tables WHERE couple_id = ? ORDER BY id ASC")
    .all(coupleId) as ArchiveTableRow[];
  return rows.map((r) => {
    const parseList = (raw: string | null | undefined): number[] => {
      try {
        const v = JSON.parse(raw ?? "[]");
        return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
      } catch {
        return [];
      }
    };
    const disabled = parseList(r.disabled_seats_json);
    const babyRaw = parseList(r.baby_seats_json);
    const disabledSet = new Set(disabled);
    const baby = babyRaw.filter((n) => !disabledSet.has(n));
    return {
      id: r.id,
      couple_id: r.couple_id,
      label: r.label,
      shape: (r.shape === "long" || r.shape === "square" || r.shape === "head"
        ? r.shape
        : "round") as TableShape,
      seats: r.seats,
      x_mm: r.x_mm,
      y_mm: r.y_mm,
      width_mm: r.width_mm,
      length_mm: r.length_mm,
      rotation_deg: ((((r.rotation_deg ?? 0) % 360) + 360) % 360) | 0,
      is_kids_table: Boolean(r.is_kids_table),
      disabled_seats: disabled,
      baby_seats: baby,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });
}

function loadAssignmentsForArchive(coupleId: number): SeatAssignment[] {
  const rows = db
    .prepare(
      `SELECT sa.* FROM seat_assignments sa
       JOIN seating_tables st ON st.id = sa.table_id
       WHERE st.couple_id = ?`,
    )
    .all(coupleId) as ArchiveAssignRow[];
  return rows.map((r) => ({
    id: r.id,
    table_id: r.table_id,
    seat_index: r.seat_index,
    guest_id: r.guest_id,
  }));
}

async function handleArchive(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple to archive");
  if (couple.status === "archived") {
    return json({ couple: toCouple(couple) });
  }
  if (couple.status === "deleting") {
    throw new HttpError(409, "Couple already scheduled for deletion");
  }

  // Final bundle: seating PDF + guests CSV stub + full JSON snapshot. Each
  // is persisted via `recordExport()` so it shows up in the user's saved
  // download archive. Errors here don't block the status flip — archiving
  // must succeed even if the PDF pipeline hiccups.
  try {
    const tables = loadTablesForArchive(couple.id);
    const assignments = loadAssignmentsForArchive(couple.id);
    const guests = listGuestsByCouple(couple.id);
    const pdf = await renderSeatingChartPdf({
      format: "a4",
      couple_display_name: couple.display_name,
      wedding_date: couple.wedding_date,
      tables,
      assignments,
      guests,
    });
    recordExport({
      coupleId: couple.id,
      userId,
      kind: "seating_pdf",
      format: "a4",
      filename: `archive-seating-a4.pdf`,
      contentType: "application/pdf",
      body: pdf,
    });
  } catch {
    // best-effort
  }

  // JSON snapshot — small re-implementation of /api/couples/export so the
  // archive bundle stays self-contained. Schema_version follows the
  // canonical export.
  try {
    const guestsRows = db
      .prepare("SELECT * FROM guests WHERE couple_id = ? ORDER BY id ASC")
      .all(couple.id) as Record<string, unknown>[];
    const lines = db
      .prepare("SELECT * FROM budget_lines WHERE couple_id = ? ORDER BY id ASC")
      .all(couple.id) as Record<string, unknown>[];
    const partnerA = db.prepare("SELECT * FROM users WHERE id = ?").get(couple.partner_a_id) as
      | UserRow
      | undefined;
    const partnerB = couple.partner_b_id
      ? (db.prepare("SELECT * FROM users WHERE id = ?").get(couple.partner_b_id) as
          | UserRow
          | undefined)
      : undefined;
    const snapshot = {
      schema_version: 2,
      exported_at: new Date().toISOString(),
      reason: "archive",
      couple: toCouple(couple),
      partners: {
        partner_a: partnerA ? toUser(partnerA) : null,
        partner_b: partnerB ? toUser(partnerB) : null,
      },
      guests: guestsRows,
      budget: { lines },
    };
    const body = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
    recordExport({
      coupleId: couple.id,
      userId,
      kind: "json",
      format: null,
      filename: `archive-${new Date().toISOString().slice(0, 10)}.json`,
      contentType: "application/json",
      body,
    });
  } catch {
    /* best-effort */
  }

  // Guests CSV: the existing live CSV endpoint also does this, but archive
  // needs its own snapshot so the timestamp lines up with the seating PDF.
  try {
    const rowsRaw = db
      .prepare(
        `SELECT g.*, h.label AS household_label
           FROM guests g
           LEFT JOIN households h ON h.id = g.household_id
           WHERE g.couple_id = ?`,
      )
      .all(couple.id) as Array<{ full_name: string; email: string | null }>;
    const sorted = [...rowsRaw].sort((a, b) =>
      a.full_name.localeCompare(b.full_name, "hu", { sensitivity: "base" }),
    );
    const lines = ["full_name,email"];
    for (const g of sorted) {
      const name = /[",\n\r]/.test(g.full_name)
        ? `"${g.full_name.replace(/"/g, '""')}"`
        : g.full_name;
      const email = g.email ?? "";
      const safeEmail = /[",\n\r]/.test(email) ? `"${email.replace(/"/g, '""')}"` : email;
      lines.push(`${name},${safeEmail}`);
    }
    const csv = `﻿${lines.join("\r\n")}\r\n`;
    const body = new TextEncoder().encode(csv);
    recordExport({
      coupleId: couple.id,
      userId,
      kind: "guest_csv",
      format: null,
      filename: `archive-guests-${new Date().toISOString().slice(0, 10)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body,
    });
  } catch {
    /* best-effort */
  }

  const ts = now();
  db.prepare(
    "UPDATE couples SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?",
  ).run(ts, ts, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.archive",
    target_kind: "couple",
    target_id: couple.id,
    after: { archived_at: ts },
  });

  const refreshed = getCoupleById(couple.id);
  if (!refreshed) throw new HttpError(500, "Couple vanished after archive");
  return json({ couple: toCouple(refreshed) });
}

// ─── Notify-date-change ─────────────────────────────────────────────────────
//
// Fan-out email to every guest with an address explaining that the wedding
// date moved. We rely on `previous_wedding_date` being kept up to date by
// `handleUpdateCurrentCouple` — the email shows "from X → Y" when present.

async function handleNotifyDateChange(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple to notify");

  const rsvpPageUrl = `${CONFIG.frontendBaseUrl}/rsvp`;
  const guests = db
    .prepare("SELECT id, email, full_name FROM guests WHERE couple_id = ?")
    .all(couple.id) as Array<{ id: number; email: string | null; full_name: string }>;

  let notified = 0;
  let skipped = 0;
  const seen = new Set<string>();
  for (const g of guests) {
    if (!g.email) {
      skipped += 1;
      continue;
    }
    const lower = g.email.toLowerCase();
    if (seen.has(lower)) {
      skipped += 1;
      continue;
    }
    seen.add(lower);
    void sendKind(
      "wedding_date_changed",
      {
        coupleDisplayName: couple.display_name,
        previousWeddingDate: couple.previous_wedding_date,
        newWeddingDate: couple.wedding_date,
        rsvpPageUrl,
      },
      {
        user: null,
        guest: { email: g.email, full_name: g.full_name },
        couple_id: couple.id,
      },
    );
    notified += 1;
  }

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.notify_date_change",
    target_kind: "couple",
    target_id: couple.id,
    after: { notified_count: notified, skipped_count: skipped },
  });

  return json({ notified_count: notified, skipped_count: skipped });
}

/** Returns the OTHER partner's identity + lifecycle state from the calling
 *  user's perspective. Drives the colour-coded pill on the Profile page so
 *  each partner can see whether their other half has joined / is online.
 *
 *  Status mapping:
 *    - "invited"  → no partner_b account; an unconsumed unexpired invite
 *                   exists. We expose its `invited_email` (if any) so the
 *                   inviter can spot a typo.
 *    - "joined"   → partner_b account exists, no unexpired session
 *                   anywhere. Means they've accepted but signed out since.
 *    - "active"   → partner_b account exists + at least one unexpired
 *                   session row. Means they have an active token (web /
 *                   mobile). We don't track presence beyond this. */
function handleGetPartner(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Who is "the other partner"? Either partner_b (when caller is partner_a)
  // or partner_a (when caller is partner_b).
  const otherId = userId === couple.partner_a_id ? couple.partner_b_id : couple.partner_a_id;

  if (!otherId) {
    // No partner_b account yet — surface the pending invite if there is one.
    const ts = now();
    const pending = db
      .prepare(
        `SELECT invited_email FROM couple_invites
          WHERE couple_id = ? AND consumed_at IS NULL AND expires_at > ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(couple.id, ts) as { invited_email: string | null } | undefined;
    if (!pending) return json({ partner: null });
    const partner: CouplePartnerView = {
      full_name: null,
      email: pending.invited_email,
      status: "invited",
    };
    return json({ partner });
  }

  const other = getUserById(otherId);
  if (!other) return json({ partner: null });

  const ts = now();
  const live = db
    .prepare("SELECT 1 FROM sessions WHERE user_id = ? AND expires_at > ? LIMIT 1")
    .get(otherId, ts) as { 1: number } | undefined;

  const partner: CouplePartnerView = {
    full_name: other.full_name,
    email: other.email,
    status: live ? "active" : "joined",
  };
  return json({ partner });
}

export function registerCoupleRoutes(router: Router) {
  router.post("/api/couples/onboard", handleOnboard, true);
  router.get("/api/couples/current", handleGetCurrentCouple, true);
  router.get("/api/couples/partner", handleGetPartner, true);
  router.patch("/api/couples/current", handleUpdateCurrentCouple, true);
  router.patch("/api/couples/slug", handleUpdateSlug, true);
  router.post("/api/couples/invites", handleCreateInvite, true);
  router.get("/api/couples/invites/current", handleGetCurrentInvite, true);
  router.post("/api/couples/invites/cancel", handleCancelInvite, true);
  router.get("/api/invites/:token", handleGetInvite); // public — pre-signup
  router.post("/api/invites/:token/accept", handleAcceptInvite, true);
  router.post("/api/couples/current/archive", handleArchive, true);
  router.post("/api/couples/current/notify-date-change", handleNotifyDateChange, true);
}
