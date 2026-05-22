// Onboarding + workspace mgmt: complete the onboarding wizard, fetch the
// current couple, generate a partner-B invite, accept an invite.

import {
  type BudgetCategory,
  type BudgetGoal,
  type BudgetKind,
  type CeremonyKind,
  type Couple,
  type CoupleActivityEntry,
  COUPLE_ACTIVITY_RETENTION_DAYS,
  type CoupleInvite,
  type CouplePartnerView,
  type Currency,
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
import {
  addCoupleMember,
  type CoupleRow,
  getCoupleById,
  getCoupleForUser,
  isCoupleMember,
  listCouplesForUser,
  removeCoupleMember,
  seedCoupleFromCouple,
  toCouple,
} from "../domain/couples";
import { sendKind } from "../domain/emails";
import { recordExport } from "../domain/exports";
import { recordGrowthEvent } from "../domain/growth_events";
import { generateInviteToken } from "../domain/invite_codes";
import { ensurePartnerGuests, listGuestsByCouple, renamePartnerGuest } from "../domain/guests";
import { renderSeatingChartPdf } from "../domain/pdf";
import { purgeOneCouple } from "../domain/purge";
import { deriveSlugBase, uniqueCoupleSlug, validateSlug } from "../domain/slug";
import { getUserById, normaliseLocale, toUser, type UserRow } from "../domain/users";
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
  /** Free-text destination. Trimmed; empty string clears the column. */
  honeymoon_destination?: unknown;
  /** ISO YYYY-MM-DD. Empty string clears. */
  honeymoon_start_date?: unknown;
  honeymoon_end_date?: unknown;
  /** Cost-planning scenario count. Integer 1..2000 or null. */
  planning_count?: unknown;
  /** Categories the couple has frozen on the cost-planning panel. */
  frozen_categories?: unknown;
  /** Display currency for every money field on this couple. */
  currency?: unknown;
  /** Boolean — when true, the RSVP flow surfaces a "needs accommodation?"
   *  checkbox on each member; when false (the default) the question is
   *  hidden on both the public form and the in-app guest drawer. */
  rsvp_offers_accommodation?: unknown;
  /** Boolean — when true (the default), the public RSVP form renders the
   *  meal-icon row (meat/fish/veg/vegan/child/none). When false the row is
   *  hidden — buffet weddings or couples who collect menu choices offline. */
  rsvp_collects_meal?: unknown;
  /** Publish toggle for the public wedding website at `/w/:slug`.
   *  Default off — couples opt in explicitly from the wedding-site editor. */
  is_public?: unknown;
  /** Free-text venue name shown on the public wedding site. Empty string
   *  clears the column (couple goes back to "no venue set"). */
  venue_name?: unknown;
  /** http(s) URL the couple pastes for the wedding-site hero image. Empty
   *  string clears. We validate scheme + length only — no fetch/probe at
   *  the API boundary, that's a v2 concern once upload pipeline lands. */
  cover_image_url?: unknown;
  /** Vendégoldal Phase 2 — pre-RSVP welcome block (markdown). Empty
   *  string clears. Cap ≤4000 chars. */
  guest_page_intro?: unknown;
  /** Vendégoldal Phase 2 — post-RSVP unlocked content (markdown). Empty
   *  string clears. Cap ≤8000 chars. */
  post_rsvp_content?: unknown;
}

const VALID_CURRENCIES: ReadonlySet<Currency> = new Set(["HUF", "EUR", "USD"]);
function parseCurrency(raw: unknown): Currency | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !VALID_CURRENCIES.has(raw as Currency)) {
    throw new HttpError(400, "currency must be HUF, EUR, or USD");
  }
  return raw as Currency;
}

/** Pick a sensible default currency for a new couple based on the owner's
 *  signup locale. HU users get HUF (the dominant local market); EN / other
 *  users get EUR (broadest international fit — covers most of the EU). The
 *  picker is just a default — the user can override during onboarding via
 *  the optional `currency` field, and they can flip via PATCH afterwards. */
function defaultCurrencyForLocale(locale: "hu" | "en" | null): Currency {
  return locale === "en" ? "EUR" : "HUF";
}

const VALID_CEREMONY_KINDS: ReadonlySet<CeremonyKind> = new Set(["civil", "religious", "both"]);
function parseCeremonyKind(raw: unknown): CeremonyKind | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !VALID_CEREMONY_KINDS.has(raw as CeremonyKind)) {
    throw new HttpError(400, "ceremony_kind invalid");
  }
  return raw as CeremonyKind;
}

function parseHoneymoonDestination(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "honeymoon_destination must be a string");
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 200) throw new HttpError(400, "honeymoon_destination too long");
  return trimmed;
}

function parseIsoDateOrNull(raw: unknown, field: string): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  }
  return raw;
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
  // Currency is optional in onboarding. When the wizard ships an explicit
  // pick we use it; otherwise we derive from the user's signup locale
  // (HU→HUF, EN→EUR) so an international visitor isn't dropped into a
  // Forint budget by accident. Both paths are validated through the same
  // allowlist as PATCH.
  const ownerRow = getUserById(userId);
  const ownerLocale = normaliseLocale(ownerRow?.locale);
  const currency: Currency = parseCurrency(body.currency) ?? defaultCurrencyForLocale(ownerLocale);

  const existing = getCoupleForUser(userId);
  if (existing) throw new HttpError(409, "Couple already onboarded for this user");

  const ts = now();
  // Wrap the whole onboarding write set in one transaction so we get a single
  // fsync instead of ~7 — couple INSERT + slug UPDATE + partner-guest seeding
  // + users UPDATE + couple_members INSERT + budget-line seeding + audit log.
  // Bun's better-sqlite3-shaped helper rolls back on any throw, so a half-
  // baked couple row can no longer survive a mid-onboard failure either.
  const coupleId = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO couples
        (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
         wedding_date, wedding_date_kind, wedding_target_year, wedding_target_month, wedding_target_season,
         target_guest_count, guest_count_kind, target_guest_count_min, target_guest_count_max,
         budget_ceiling_huf, budget_kind, budget_ceiling_min_huf, budget_ceiling_max_huf,
         location_lat, location_lng, location_radius_km,
         style_tags_json, currency, status, created_at, updated_at, onboarded_at)
       VALUES (?, NULL, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?,
               ?, ?, 'active', ?, ?, ?)`,
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
        currency,
        ts,
        ts,
        ts,
      );
    const newCoupleId = Number(result.lastInsertRowid);

    // Derive the public couple slug ("ANDORSARI") right at onboarding so the
    // RSVP check-in URL is shareable from minute zero.
    const slug = uniqueCoupleSlug(deriveSlugBase(brideName, groomName, displayName), newCoupleId);
    db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(
      slug,
      ts,
      newCoupleId,
    );

    // The bride and groom are guests at their own wedding — and they need to
    // count in headcount, catering, and seating. The helper materializes them
    // as real guest rows inside ONE shared dedicated 2-person household labelled
    // "{bride} & {groom}", which sorts to the top of /app/guests. The helper is
    // idempotent + shared with the boot-time backfill in init_households.ts; it
    // also force-relocates any partner_role guest currently mixed into another
    // household into the dedicated host home.
    ensurePartnerGuests({ coupleId: newCoupleId, brideName, groomName });

    db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
      newCoupleId,
      ts,
      userId,
    );
    // Record the membership in the multi-workspace junction. `users.couple_id`
    // remains "the active workspace"; couple_members tracks the full set so
    // the user can spin up a second event later (Alpha → Bravo / Charlie).
    addCoupleMember(newCoupleId, userId, "owner");

    // Range budgets seed lines off the midpoint; TBD seeds nothing.
    const seedHuf = representativeBudgetHuf(budgetGoal);
    if (seedHuf > 0) seedBudgetLines(newCoupleId, seedHuf);

    addAuditLog({
      actor_user_id: userId,
      couple_id: newCoupleId,
      action: "couple.onboard",
      target_kind: "couple",
      target_id: newCoupleId,
      after: {
        display_name: displayName,
        bride_name: brideName,
        groom_name: groomName,
        wedding_date_goal: dateGoal,
        guest_count_goal: guestGoal,
        budget_goal: budgetGoal,
      },
    });

    return newCoupleId;
  })();

  const row = getCoupleById(coupleId);
  if (!row) throw new HttpError(500, "Couple vanished after insert");
  const couple: Couple = toCouple(row);
  // Funnel event: workspace is the first concrete activation surface
  // after signup. Pairs with signup.completed to compute signup →
  // activation conversion. user_id is set; couple_id is set to the
  // brand-new id so the dashboard can group activation by cohort.
  recordGrowthEvent("couple.created", {
    user_id: userId,
    couple_id: coupleId,
    user_agent: ctx.req.headers.get("user-agent"),
  });
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
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  if (userCouple) {
    // Two distinct sub-cases for the same 409 status:
    //  - The logged-in user is already in *this* couple (the inviter clicking
    //    their own link, or partner B re-clicking after acceptance). UI shows
    //    a "share with X" panel rather than a generic error.
    //  - The user belongs to a different couple workspace entirely — can't
    //    join two at once.
    const code =
      userCouple.id === row.couple_id ? "already_in_this_couple" : "already_in_other_couple";
    throw new HttpError(409, "User already belongs to a couple", { code });
  }

  const couple = getCoupleById(row.couple_id);
  if (!couple) throw new HttpError(404, "Couple no longer exists");
  if (couple.partner_b_id) {
    throw new HttpError(409, "Partner B already linked", { code: "couple_full" });
  }

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
  addCoupleMember(couple.id, userId, "partner");
  db.prepare("UPDATE couple_invites SET consumed_at = ? WHERE id = ?").run(ts, row.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "invite.accept",
    target_kind: "couple",
    target_id: couple.id,
    note: `partner_b linked via invite ${row.id}`,
  });

  // Heads-up to the inviter — they're the one who clicked Invite Partner and
  // have been waiting to see whether/when partner B joined. Fire-and-forget;
  // an email-send hiccup must not roll back the partner-join.
  const inviter = getUserById(row.invited_by_user_id);
  const accepter = getUserById(userId);
  if (inviter && accepter) {
    void sendKind(
      "partner_invite_accepted",
      {
        partnerName: accepter.full_name || accepter.email,
        coupleDisplayName: couple.display_name ?? undefined,
        dashboardUrl: `${CONFIG.frontendBaseUrl}/app`,
      },
      {
        user: { id: inviter.id, email: inviter.email, full_name: inviter.full_name ?? "" },
        couple_id: couple.id,
      },
    );
  }

  const refreshed = getCoupleById(couple.id) as CoupleRow;
  return json({ couple: toCouple(refreshed) });
}

async function handleDeclineInvite(ctx: Ctx): Promise<Response> {
  // Auth optional: a recipient who isn't a Weddly user can also decline the
  // invite (the link came to their email, the token is the bearer). The
  // route consumes the token + notifies the inviter — no partner_b state
  // changes since the decline IS the absence of a join.
  const token = ctx.params.token;
  if (!token) throw new HttpError(400, "Missing token");

  const row = db.prepare("SELECT * FROM couple_invites WHERE token = ?").get(token) as
    | InviteRow
    | undefined;
  if (!row) throw new HttpError(404, "Invite not found");
  if (row.consumed_at) throw new HttpError(410, "Invite already used");
  if (row.expires_at < now()) throw new HttpError(410, "Invite expired");

  const ts = now();
  db.prepare("UPDATE couple_invites SET consumed_at = ? WHERE id = ?").run(ts, row.id);

  addAuditLog({
    actor_user_id: null,
    couple_id: row.couple_id,
    action: "invite.decline",
    target_kind: "couple_invite",
    target_id: row.id,
    note: `declined for ${row.invited_email}`,
  });

  // Heads-up to the inviter. Fire-and-forget; consuming the token must
  // succeed even if the mailer hiccups.
  const inviter = getUserById(row.invited_by_user_id);
  if (inviter) {
    void sendKind(
      "partner_invite_declined",
      {
        invitedEmail: row.invited_email ?? "",
        reinviteUrl: `${CONFIG.frontendBaseUrl}/app/profile`,
      },
      {
        user: { id: inviter.id, email: inviter.email, full_name: inviter.full_name ?? "" },
        couple_id: row.couple_id,
      },
    );
  }

  return json({ ok: true });
}

/** Lists every pending partner-invite addressed to the current user's
 *  email (`couple_invites.invited_email`, case-insensitive). Powers the
 *  dashboard banner that surfaces "your partner has already started a
 *  workspace and invited you" when both partners signed up separately.
 *  Returns the invite metadata plus the inviting couple's display name
 *  so the UI can render "Join {partner}'s wedding". */
function handleListIncomingInvites(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const user = getUserById(userId);
  if (!user) throw new HttpError(404, "User not found");
  const email = (user.email ?? "").trim().toLowerCase();
  if (!email) return json({ invites: [] });

  const ts = now();
  const rows = db
    .prepare(
      `SELECT ci.id, ci.token, ci.couple_id, ci.invited_email,
              ci.invited_by_user_id, ci.consumed_at, ci.expires_at, ci.created_at,
              c.display_name AS couple_display_name,
              c.partner_b_id AS couple_partner_b_id,
              u.full_name    AS inviter_name,
              u.email        AS inviter_email
         FROM couple_invites ci
         JOIN couples c ON c.id = ci.couple_id
         JOIN users   u ON u.id = ci.invited_by_user_id
        WHERE ci.consumed_at IS NULL
          AND ci.expires_at > ?
          AND ci.invited_email IS NOT NULL
          AND LOWER(ci.invited_email) = ?
        ORDER BY ci.created_at DESC`,
    )
    .all(ts, email) as Array<{
    id: number;
    token: string;
    couple_id: number;
    invited_email: string | null;
    invited_by_user_id: number;
    consumed_at: number | null;
    expires_at: number;
    created_at: number;
    couple_display_name: string;
    couple_partner_b_id: number | null;
    inviter_name: string;
    inviter_email: string;
  }>;

  // Hide invites for couples that already have partner B linked — accepting
  // such an invite would 409 server-side, no point surfacing it.
  const invites = rows
    .filter((r) => r.couple_partner_b_id == null)
    .map((r) => ({
      token: r.token,
      couple_display_name: r.couple_display_name,
      inviter_name: r.inviter_name,
      inviter_email: r.inviter_email,
      expires_at: r.expires_at,
    }));
  return json({ invites });
}

/** Accepts an invite while atomically purging the current user's solo
 *  workspace. Use when both partners signed up separately and only one of
 *  them will keep their workspace going forward. Gated by a typed-phrase
 *  confirm on the client side and a server-side re-check: if the user's
 *  current couple has a partner B, refuse (we'd be deleting data the
 *  other partner depends on). */
async function handleAcceptInviteMerge(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const token = ctx.params.token;
  if (!token) throw new HttpError(400, "Missing token");

  const body = await readJson<{ confirm?: unknown }>(ctx.req);
  // Belt-and-braces — the UI already gates submission on the typed phrase,
  // but a stray request without it gets a 400 here rather than silently
  // purging the user's workspace.
  if (body.confirm !== "MERGE") {
    throw new HttpError(400, "Missing or invalid `confirm` token (expected 'MERGE')");
  }

  const row = db.prepare("SELECT * FROM couple_invites WHERE token = ?").get(token) as
    | InviteRow
    | undefined;
  if (!row) throw new HttpError(404, "Invite not found");
  if (row.consumed_at) throw new HttpError(410, "Invite already used");
  if (row.expires_at < now()) throw new HttpError(410, "Invite expired");

  const userCouple = getCoupleForUser(userId);
  if (!userCouple) {
    // No solo workspace to merge — caller should use the plain /accept path.
    throw new HttpError(409, "No workspace to merge", { code: "no_source_couple" });
  }
  if (userCouple.id === row.couple_id) {
    throw new HttpError(409, "Already in this couple", { code: "already_in_this_couple" });
  }
  // Refuse if the user's current workspace has a second partner — wiping it
  // would destroy data the other partner relies on. They'd need to pause-
  // delete via the regular flow first.
  if (userCouple.partner_b_id != null) {
    throw new HttpError(409, "Source workspace has a second partner", {
      code: "source_has_partner_b",
    });
  }

  const target = getCoupleById(row.couple_id);
  if (!target) throw new HttpError(404, "Target couple no longer exists");
  if (target.partner_b_id) {
    throw new HttpError(409, "Partner B already linked", { code: "couple_full" });
  }
  if (target.status === "deleting") {
    throw new HttpError(409, "Target workspace is being deleted", { code: "target_deleting" });
  }

  const sourceCoupleId = userCouple.id;

  // Sequence matters:
  //   1. Detach the user from the source couple BEFORE the purge — `purgeOneCouple`
  //      flips status='deleting' and scrubs every member's PII; if we leave the
  //      user attached they'd lose their email + name even though they're still
  //      using the product on a different workspace.
  //   2. Purge the source workspace (silent — no "data gone" email; the user
  //      consciously initiated the merge and will see the new workspace
  //      immediately).
  //   3. Link the user as partner B on the target and consume the invite.
  const ts = now();
  db.prepare("UPDATE users SET couple_id = NULL, updated_at = ? WHERE id = ?").run(ts, userId);
  purgeOneCouple(sourceCoupleId, { silent: true });

  db.prepare("UPDATE couples SET partner_b_id = ?, updated_at = ? WHERE id = ?").run(
    userId,
    ts,
    target.id,
  );
  db.prepare("UPDATE users SET couple_id = ?, role = 'partner', updated_at = ? WHERE id = ?").run(
    target.id,
    ts,
    userId,
  );
  addCoupleMember(target.id, userId, "partner");
  db.prepare("UPDATE couple_invites SET consumed_at = ? WHERE id = ?").run(ts, row.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: target.id,
    action: "invite.accept_merge",
    target_kind: "couple",
    target_id: target.id,
    note: `merged partner_b from source couple ${sourceCoupleId} via invite ${row.id}`,
    before: { source_couple_id: sourceCoupleId },
    after: { target_couple_id: target.id },
  });

  const refreshed = getCoupleById(target.id) as CoupleRow;
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
  // No-op short-circuit — let the caller flip the slug to its current value
  // without tripping the lock below. Useful for idempotent client retries.
  if (cleaned === couple.slug) {
    return json({ couple: toCouple(couple) });
  }
  // Slug lock: once any guest has been invited (printed link or email sent),
  // changing the slug breaks every invitation already in the wild. The
  // GuestsPage UI presents the slug as locked once a couple exists; this
  // endpoint enforces that promise instead of trusting the client. Recovery
  // is a deliberate support touch — no in-product unlock today.
  const anyInvited = db
    .prepare("SELECT 1 FROM guests WHERE couple_id = ? AND invited_at IS NOT NULL LIMIT 1")
    .get(couple.id) as { 1: number } | undefined;
  if (anyInvited) {
    throw new HttpError(
      423,
      "Slug is locked — invitations have been sent. Contact support to change it.",
      { code: "slug_locked" },
    );
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

const ALLOWED_BUDGET_CATEGORIES: ReadonlySet<BudgetCategory> = new Set([
  "venue",
  "catering",
  "drinks",
  "attire",
  "decor_floral",
  "photo_video",
  "music_dj",
  "cake_dessert",
  "hair_makeup",
  "transport",
  "honeymoon",
  "stationery",
  "favours",
  "rings",
  "other",
]);

/** `frozen_categories`: array of valid `BudgetCategory` slugs. Unknown entries
 *  are silently dropped; duplicates collapse. Returns the JSON-encoded form so
 *  the caller can stuff it straight into the UPDATE. */
function parseFrozenCategories(raw: unknown): string {
  if (!Array.isArray(raw)) throw new HttpError(400, "frozen_categories must be an array");
  const seen = new Set<BudgetCategory>();
  const out: BudgetCategory[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const cat = v as BudgetCategory;
    if (!ALLOWED_BUDGET_CATEGORIES.has(cat) || seen.has(cat)) continue;
    seen.add(cat);
    out.push(cat);
  }
  return JSON.stringify(out);
}

/** Opt-in toggle for the RSVP "needs accommodation?" question. Accepts a
 *  plain boolean — we coerce explicitly rather than `Boolean(raw)` because
 *  the latter would silently turn the string "false" into true. */
function parseRsvpOffersAccommodation(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new HttpError(400, "rsvp_offers_accommodation must be a boolean");
  }
  return raw;
}

/** Opt-out toggle for the RSVP meal-choice icon row. Same strict-boolean
 *  contract as the accommodation parser above — only `true`/`false` accepted. */
function parseRsvpCollectsMeal(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new HttpError(400, "rsvp_collects_meal must be a boolean");
  }
  return raw;
}

/** Publish toggle for the public wedding-website at `/w/:slug`. */
function parseIsPublic(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new HttpError(400, "is_public must be a boolean");
  }
  return raw;
}

/** Free-text venue name. Empty string → null (clears the column).
 *  Trimmed, capped at 200 chars to match the schema's TEXT column expectation
 *  and the display_name cap. */
function parseVenueName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "venue_name must be a string");
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 200) throw new HttpError(400, "venue_name must be ≤200 chars");
  return trimmed;
}

/** http(s) URL the couple pastes for the wedding-site hero image. Empty
 *  string → null. We require an explicit http or https scheme (no
 *  protocol-relative URLs, no data:, no javascript:), and cap the length at
 *  2048 chars per the db.ts comment. URL constructor handles malformed input. */
function parseCoverImageUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, "cover_image_url must be a string");
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 2048) throw new HttpError(400, "cover_image_url too long");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(400, "cover_image_url must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "cover_image_url must be http(s)");
  }
  return trimmed;
}

/** Free-text markdown block author authors for the merged Vendégoldal.
 *  Empty string → null (clears the column). Cap chosen large enough to
 *  hold a 2-3 paragraph welcome message without enabling someone to
 *  paste a novel into the public payload — same approach as venue_name. */
function parseMarkdownBlock(raw: unknown, field: string, maxLength: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string`);
  // Don't trim — markdown leading/trailing whitespace can be meaningful for
  // code fences, lists, etc. Strip only the empty-string case so the
  // "clear" gesture from the editor maps to NULL in storage.
  if (raw.length === 0) return null;
  if (raw.length > maxLength) throw new HttpError(400, `${field} must be ≤${maxLength} chars`);
  return raw;
}

/** Cost-planning scenario count: integer 1..2000, or null to clear. */
function parsePlanningCount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0 || n > 2000) {
    throw new HttpError(400, "planning_count must be an integer between 1 and 2000");
  }
  return n;
}

/** Partial-update endpoint for inline edits from the workspace (e.g. clicking
 *  the wedding date on the dashboard to change it). Reuses onboarding parsers
 *  so validation stays consistent. Currently supports `wedding_date_goal`,
 *  `ceremony_kind`, names (bride/groom), `budget_goal`, the honeymoon trip
 *  fields, and the cost-planning `planning_count` slider.
 *
 *  Audit-log strategy: each field cluster fires its OWN per-field action so
 *  partner B can see "Anna changed the wedding date" vs "Bence updated the
 *  budget cap" in the activity feed. A multi-field PATCH writes multiple
 *  rows. We keep generic `couple.update` only as a fallback when none of the
 *  recognised clusters match — historical entries still render. */
async function handleUpdateCurrentCouple(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple to update");

  // Optimistic concurrency: when both partners hit the budget cap (or wedding
  // date, ceremony kind, etc.) in the same minute, the headline field can't
  // afford last-write-wins. Mirror the budget_lines pattern — caller sends
  // `If-Match: <couple.updated_at>`, server returns 409 + `code: "stale"` on
  // mismatch. Header is optional for back-compat with older clients.
  const ifMatchRaw = ctx.req.headers.get("if-match");
  if (ifMatchRaw) {
    const cleaned = ifMatchRaw.trim().replace(/^"(.*)"$/, "$1");
    if (cleaned && cleaned !== String(couple.updated_at)) {
      throw new HttpError(409, "Stale couple — reload before saving", {
        code: "stale",
        current_updated_at: couple.updated_at,
      });
    }
  }

  const body = await readJson<Partial<OnboardBody>>(ctx.req);
  const updates: { col: string; val: string | number | null }[] = [];

  // Each entry records WHICH per-field audit action to fire for the cluster,
  // and a (before, after) pair that the UI can render as a diff. We collect
  // them, then emit one audit row per entry after the UPDATE succeeds.
  const auditEntries: {
    action: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[] = [];

  // Names — bride / groom. Either field's presence triggers a names_update
  // audit row with both fields in before/after so the UI can render a diff.
  // We also track which of the two actually CHANGED so we can mirror the
  // rename onto the matching `partner_role` guest row after the UPDATE.
  let renameBride = false;
  let renameGroom = false;
  let nextBride = couple.bride_name;
  let nextGroom = couple.groom_name;
  if (body.bride_name !== undefined || body.groom_name !== undefined) {
    const newBride =
      body.bride_name !== undefined
        ? parsePartnerName(body.bride_name, "bride_name")
        : couple.bride_name;
    const newGroom =
      body.groom_name !== undefined
        ? parsePartnerName(body.groom_name, "groom_name")
        : couple.groom_name;
    const newDisplay = `${newBride} & ${newGroom}`;
    updates.push(
      { col: "bride_name", val: newBride },
      { col: "groom_name", val: newGroom },
      { col: "display_name", val: newDisplay },
    );
    auditEntries.push({
      action: "couple.names_update",
      before: {
        bride_name: couple.bride_name,
        groom_name: couple.groom_name,
        display_name: couple.display_name,
      },
      after: {
        bride_name: newBride,
        groom_name: newGroom,
        display_name: newDisplay,
      },
    });
    renameBride = newBride !== couple.bride_name && newBride.length > 0;
    renameGroom = newGroom !== couple.groom_name && newGroom.length > 0;
    nextBride = newBride;
    nextGroom = newGroom;
  }

  // Standalone display_name rename — used by event workspaces (civil /
  // religious / dinner / afterparty) to relabel themselves without
  // touching bride/groom. The bride/groom path above already derives
  // display_name as `${bride} & ${groom}`, so when both clusters arrive
  // in the same PATCH we deliberately IGNORE the display_name override
  // (the bride/groom rename always wins to keep the derivation honest).
  if (
    body.display_name !== undefined &&
    body.bride_name === undefined &&
    body.groom_name === undefined
  ) {
    if (typeof body.display_name !== "string") {
      throw new HttpError(400, "display_name must be 1–100 chars");
    }
    const newDisplayName = body.display_name.trim();
    if (newDisplayName.length < 1 || newDisplayName.length > 100) {
      throw new HttpError(400, "display_name must be 1–100 chars");
    }
    updates.push({ col: "display_name", val: newDisplayName });
    auditEntries.push({
      action: "couple.display_name_update",
      before: { display_name: couple.display_name },
      after: { display_name: newDisplayName },
    });
  }

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
    auditEntries.push({
      action: "couple.wedding_date_update",
      before: {
        wedding_date: couple.wedding_date,
        wedding_date_kind: couple.wedding_date_kind,
        wedding_target_year: couple.wedding_target_year,
        wedding_target_month: couple.wedding_target_month,
        wedding_target_season: couple.wedding_target_season,
      },
      after: {
        wedding_date: goal.exact_date,
        wedding_date_kind: goal.kind,
        wedding_target_year: goal.target_year,
        wedding_target_month: goal.target_month,
        wedding_target_season: goal.target_season,
      },
    });
  }

  if (body.ceremony_kind !== undefined) {
    const kind = parseCeremonyKind(body.ceremony_kind);
    updates.push({ col: "ceremony_kind", val: kind });
    auditEntries.push({
      action: "couple.ceremony_kind_update",
      before: { ceremony_kind: couple.ceremony_kind },
      after: { ceremony_kind: kind },
    });
  }

  if (body.honeymoon_destination !== undefined) {
    const val = parseHoneymoonDestination(body.honeymoon_destination);
    updates.push({ col: "honeymoon_destination", val });
  }
  if (body.honeymoon_start_date !== undefined) {
    const val = parseIsoDateOrNull(body.honeymoon_start_date, "honeymoon_start_date");
    updates.push({ col: "honeymoon_start_date", val });
  }
  if (body.honeymoon_end_date !== undefined) {
    const val = parseIsoDateOrNull(body.honeymoon_end_date, "honeymoon_end_date");
    updates.push({ col: "honeymoon_end_date", val });
  }
  // Honeymoon edits don't get a per-field audit cluster (yet) — they were
  // never split out before either. Fold any honeymoon change into a single
  // generic-fallback row below if NOTHING else matched.
  const honeymoonTouched =
    body.honeymoon_destination !== undefined ||
    body.honeymoon_start_date !== undefined ||
    body.honeymoon_end_date !== undefined;

  if (body.budget_goal !== undefined || body.budget_ceiling_huf !== undefined) {
    const goal = parseBudgetGoal(body as OnboardBody);
    updates.push(
      { col: "budget_ceiling_huf", val: goal.exact_huf },
      { col: "budget_kind", val: goal.kind },
      { col: "budget_ceiling_min_huf", val: goal.min_huf },
      { col: "budget_ceiling_max_huf", val: goal.max_huf },
    );
    auditEntries.push({
      action: "couple.budget_cap_update",
      before: {
        budget_ceiling_huf: couple.budget_ceiling_huf,
        budget_kind: couple.budget_kind,
        budget_ceiling_min_huf: couple.budget_ceiling_min_huf,
        budget_ceiling_max_huf: couple.budget_ceiling_max_huf,
      },
      after: {
        budget_ceiling_huf: goal.exact_huf,
        budget_kind: goal.kind,
        budget_ceiling_min_huf: goal.min_huf,
        budget_ceiling_max_huf: goal.max_huf,
      },
    });
  }

  if (body.guest_count_goal !== undefined || body.target_guest_count !== undefined) {
    const goal = parseGuestCountGoal(body as OnboardBody);
    updates.push(
      { col: "target_guest_count", val: goal.exact },
      { col: "guest_count_kind", val: goal.kind },
      { col: "target_guest_count_min", val: goal.min },
      { col: "target_guest_count_max", val: goal.max },
    );
    auditEntries.push({
      action: "couple.guest_count_update",
      before: {
        target_guest_count: couple.target_guest_count,
        guest_count_kind: couple.guest_count_kind,
        target_guest_count_min: couple.target_guest_count_min,
        target_guest_count_max: couple.target_guest_count_max,
      },
      after: {
        target_guest_count: goal.exact,
        guest_count_kind: goal.kind,
        target_guest_count_min: goal.min,
        target_guest_count_max: goal.max,
      },
    });
  }

  if (body.planning_count !== undefined) {
    const val = parsePlanningCount(body.planning_count);
    updates.push({ col: "planning_count", val });
    auditEntries.push({
      action: "couple.planning_count_update",
      before: { planning_count: couple.planning_count },
      after: { planning_count: val },
    });
  }

  if (body.frozen_categories !== undefined) {
    const json = parseFrozenCategories(body.frozen_categories);
    updates.push({ col: "frozen_categories_json", val: json });
    auditEntries.push({
      action: "couple.frozen_categories_update",
      before: { frozen_categories_json: couple.frozen_categories_json },
      after: { frozen_categories_json: json },
    });
  }

  if (body.currency !== undefined) {
    const next = parseCurrency(body.currency) ?? "HUF";
    const prev = couple.currency ?? "HUF";
    if (next !== prev) {
      updates.push({ col: "currency", val: next });
      auditEntries.push({
        action: "couple.currency_update",
        before: { currency: prev },
        after: { currency: next },
      });
    }
  }

  if (body.rsvp_offers_accommodation !== undefined) {
    const next = parseRsvpOffersAccommodation(body.rsvp_offers_accommodation);
    const prev = Boolean(couple.rsvp_offers_accommodation);
    if (next !== prev) {
      updates.push({ col: "rsvp_offers_accommodation", val: next ? 1 : 0 });
      auditEntries.push({
        action: "couple.rsvp_offers_accommodation_update",
        before: { rsvp_offers_accommodation: prev },
        after: { rsvp_offers_accommodation: next },
      });
    }
  }

  if (body.rsvp_collects_meal !== undefined) {
    const next = parseRsvpCollectsMeal(body.rsvp_collects_meal);
    const prev = Boolean(couple.rsvp_collects_meal);
    if (next !== prev) {
      updates.push({ col: "rsvp_collects_meal", val: next ? 1 : 0 });
      auditEntries.push({
        action: "couple.rsvp_collects_meal_update",
        before: { rsvp_collects_meal: prev },
        after: { rsvp_collects_meal: next },
      });
    }
  }

  if (body.is_public !== undefined) {
    const next = parseIsPublic(body.is_public);
    const prev = Boolean(couple.is_public);
    if (next !== prev) {
      updates.push({ col: "is_public", val: next ? 1 : 0 });
      auditEntries.push({
        action: "couple.is_public_update",
        before: { is_public: prev },
        after: { is_public: next },
      });
    }
  }

  if (body.venue_name !== undefined) {
    const next = parseVenueName(body.venue_name);
    const prev = couple.venue_name;
    if (next !== prev) {
      updates.push({ col: "venue_name", val: next });
      auditEntries.push({
        action: "couple.venue_name_update",
        before: { venue_name: prev },
        after: { venue_name: next },
      });
    }
  }

  if (body.cover_image_url !== undefined) {
    const next = parseCoverImageUrl(body.cover_image_url);
    const prev = couple.cover_image_url;
    if (next !== prev) {
      updates.push({ col: "cover_image_url", val: next });
      auditEntries.push({
        action: "couple.cover_image_url_update",
        before: { cover_image_url: prev },
        after: { cover_image_url: next },
      });
    }
  }

  if (body.guest_page_intro !== undefined) {
    const next = parseMarkdownBlock(body.guest_page_intro, "guest_page_intro", 4000);
    const prev = couple.guest_page_intro;
    if (next !== prev) {
      updates.push({ col: "guest_page_intro", val: next });
      auditEntries.push({
        action: "couple.guest_page_intro_update",
        before: { guest_page_intro: prev },
        after: { guest_page_intro: next },
      });
    }
  }

  if (body.post_rsvp_content !== undefined) {
    const next = parseMarkdownBlock(body.post_rsvp_content, "post_rsvp_content", 8000);
    const prev = couple.post_rsvp_content;
    if (next !== prev) {
      updates.push({ col: "post_rsvp_content", val: next });
      auditEntries.push({
        action: "couple.post_rsvp_content_update",
        before: { post_rsvp_content: prev },
        after: { post_rsvp_content: next },
      });
    }
  }

  if (updates.length === 0) throw new HttpError(400, "No fields to update");

  const ts = now();
  const setClause = `${updates.map((u) => `${u.col} = ?`).join(", ")}, updated_at = ?`;
  const values = [...updates.map((u) => u.val), ts, couple.id];
  db.prepare(`UPDATE couples SET ${setClause} WHERE id = ?`).run(...values);

  // Keep the partner-role guest rows in sync with the canonical bride/groom
  // names on the couple row. Renames flow one way (couple → guest); the
  // guests-page edit drawer would normally write the guest first, but the
  // host rows are read-mostly from that side. If the matching guest row
  // doesn't exist yet (e.g. legacy couple that's never booted with this
  // backfill), seed it on the fly via ensurePartnerGuests below.
  if (renameBride) renamePartnerGuest(couple.id, "bride", nextBride);
  if (renameGroom) renamePartnerGuest(couple.id, "groom", nextGroom);

  const refreshed = getCoupleById(couple.id);
  if (!refreshed) throw new HttpError(500, "Couple vanished after update");

  // Fan out per-field audit rows. Each cluster gets its own action so
  // partner B sees "Anna changed the wedding date" + "Anna updated the
  // budget cap" as two distinct rows when both moved in one PATCH.
  for (const entry of auditEntries) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: entry.action,
      target_kind: "couple",
      target_id: couple.id,
      before: entry.before,
      after: entry.after,
    });
  }
  // Fallback: nothing matched a per-field cluster (e.g. only honeymoon
  // fields moved). Preserve the legacy `couple.update` action so existing
  // history keeps rendering and so we never silently swallow a change.
  if (auditEntries.length === 0 && honeymoonTouched) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "couple.update",
      target_kind: "couple",
      target_id: couple.id,
      after: {
        honeymoon_destination: refreshed.honeymoon_destination,
        honeymoon_start_date: refreshed.honeymoon_start_date,
        honeymoon_end_date: refreshed.honeymoon_end_date,
      },
    });
  }

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
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  const userId = requireVerifiedAuth(ctx, getUserById);
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

  // Clear the snapshot so the dashboard banner disappears on the next refresh.
  // We do this after the fan-out loop (which only schedules emails) so a hard
  // crash mid-loop wouldn't strand the flag set — `sendKind` is fire-and-forget
  // anyway, so once we've enqueued the work the snapshot has served its purpose.
  db.prepare("UPDATE couples SET previous_wedding_date = NULL, updated_at = ? WHERE id = ?").run(
    now(),
    couple.id,
  );

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

/** Dismiss the date-changed banner without sending notifications. Clears
 *  `previous_wedding_date` so the dashboard banner disappears, and audit-logs
 *  the choice so partners can see "X dismissed the date-change notice" in the
 *  recent-activity feed. No emails go out. */
function handleDismissDateChange(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple to dismiss");

  db.prepare("UPDATE couples SET previous_wedding_date = NULL, updated_at = ? WHERE id = ?").run(
    now(),
    couple.id,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.dismiss_date_change",
    target_kind: "couple",
    target_id: couple.id,
    after: { dismissed: true },
  });

  return json({ ok: true });
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

/** Recent-activity feed for the Profile page. We surface only the events
 *  worth showing partners — saves / uploads / deletes / exports / RSVPs —
 *  and drop low-signal admin/auth chatter. The 14-day window is enforced
 *  here at query time; the underlying `audit_log` rows stay append-only
 *  per CLAUDE.md's retention rule, so the storage-level effect is "still
 *  there for forensics, hidden from the user-facing UI". */
const ACTIVITY_VISIBLE_ACTIONS: ReadonlySet<string> = new Set([
  // Couple workspace
  "couple.update", // fallback — legacy entries + honeymoon-only edits
  "couple.slug_update",
  "couple.archive",
  "couple.pause",
  "couple.unpause",
  "couple.notify_date_change",
  "couple.dismiss_date_change",
  "couple.onboard",
  // Multi-workspace surface: showing up in the activity feed when a
  // second/third event is created or when partner B switches between
  // them gives both partners a paper trail of "yes Anna spun up Bravo".
  "couple.create_additional",
  "user.switch_workspace",
  "couple.export",
  // Loop C₁: per-field splits so partner B sees "Anna changed the budget cap"
  // rather than a generic "frissítette a beállításokat".
  "couple.wedding_date_update",
  "couple.budget_cap_update",
  "couple.names_update",
  "couple.ceremony_kind_update",
  "couple.planning_count_update",
  "couple.currency_update",
  "couple.frozen_categories_update",
  "couple.guest_count_update",
  "couple.rsvp_offers_accommodation_update",
  "couple.rsvp_collects_meal_update",
  "couple.is_public_update",
  "couple.venue_name_update",
  "couple.cover_image_url_update",
  "couple.guest_page_intro_update",
  "couple.post_rsvp_content_update",
  // Guests
  "guest.create",
  "guest.update",
  "guest.delete",
  "guest.csv_import",
  "guest.csv_export",
  // Households
  "household.create",
  "household.update",
  "household.delete",
  "household.regen_code",
  // Per-household RSVP toggles migrated off the couple-level pair in May
  // 2026 (couple.rsvp_*_update still listed above for legacy entries).
  "household.rsvp_offers_accommodation_update",
  "household.rsvp_collects_meal_update",
  // Budget
  "budget.line_create",
  "budget.line_update",
  "budget.line_delete",
  "budget.snapshot_create",
  "budget.snapshot_delete",
  "budget.snapshot_restore",
  // Seating
  "table.create",
  "table.update",
  "table.delete",
  "seat.assign",
  "seat.unassign",
  "seat.swap",
  "conflict.create",
  "conflict.delete",
  // Print + archive
  "print.seating_chart",
  "print.place_cards",
  "export.delete",
  // RSVP + invite
  "rsvp.submit",
  "rsvp.add_member",
  "invite.create",
  "invite.cancel",
  "invite.accept",
  "invite.accept_merge",
  // Cost rows + suppliers attached to the couple
  "supplier_cost.upsert",
  "supplier.community.create",
  // Day-of run-of-show
  "schedule.create",
  "schedule.update",
  "schedule.delete",
  // DIY ("Csinálom magam") supplier entries
  "couple_supplier.create",
  "couple_supplier.update",
  "couple_supplier.delete",
  // Loop C₁: per-category supplier picks (shared across partners)
  "pick.upsert",
  "pick.remove",
]);

interface ActivityRow {
  id: number;
  actor_user_id: number | null;
  action: string;
  target_kind: string;
  target_id: number | null;
  note: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: number;
  actor_full_name: string | null;
}

function handleGetActivity(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const cutoff = now() - COUPLE_ACTIVITY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const placeholders = Array.from(ACTIVITY_VISIBLE_ACTIONS, () => "?").join(",");
  const rows = db
    .prepare(
      `SELECT a.id, a.actor_user_id, a.action, a.target_kind, a.target_id, a.note,
              a.before_json, a.after_json,
              a.created_at, u.full_name AS actor_full_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.couple_id = ?
          AND a.created_at >= ?
          AND a.action IN (${placeholders})
        ORDER BY a.id DESC
        LIMIT 60`,
    )
    .all(couple.id, cutoff, ...ACTIVITY_VISIBLE_ACTIONS) as ActivityRow[];

  const entries: CoupleActivityEntry[] = rows.map((r) => ({
    id: r.id,
    actor_id: r.actor_user_id,
    actor_full_name: r.actor_full_name,
    action: r.action,
    target_kind: r.target_kind,
    target_id: r.target_id,
    note: r.note,
    before_json: r.before_json,
    after_json: r.after_json,
    created_at: r.created_at,
  }));
  return json({ entries });
}

/* ─── Multi-workspace: Alpha / Bravo / Charlie ───────────────────────────
 *
 * `users.couple_id` keeps meaning "the workspace I'm currently viewing".
 * The full set lives in `couple_members`; these three endpoints let the
 * frontend list it, switch the active pointer, and spin up a second
 * event seeded from the first.
 */

interface ListMyCouplesResponse {
  current_couple_id: number | null;
  couples: ReturnType<typeof listCouplesForUser>;
}

function handleListMyCouples(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couples = listCouplesForUser(userId);
  const current = getCoupleForUser(userId);
  const payload: ListMyCouplesResponse = {
    current_couple_id: current?.id ?? null,
    couples,
  };
  return json(payload);
}

interface SwitchActiveCoupleBody {
  couple_id?: unknown;
}

/** POST /api/users/me/active-couple — flip the user's `users.couple_id`
 *  pointer to a different workspace they're a member of. Same UPDATE
 *  pattern as `handleAcceptInviteMerge`, but here it's idempotent and
 *  cheap (no purges, no FK rewiring) so it can fire on every click of
 *  the header switcher. Audit row makes the switch visible on the
 *  target workspace's activity feed. */
async function handleSwitchActiveCouple(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const body = await readJson<SwitchActiveCoupleBody>(ctx.req);
  const targetId = Number(body.couple_id);
  if (!Number.isFinite(targetId) || targetId <= 0) {
    throw new HttpError(400, "couple_id required");
  }
  if (!isCoupleMember(targetId, userId)) {
    throw new HttpError(403, "Not a member of this workspace", { code: "not_a_member" });
  }
  const target = getCoupleById(targetId);
  if (!target) throw new HttpError(404, "Workspace not found");
  if (target.status === "deleting") {
    throw new HttpError(409, "Workspace is being deleted", { code: "target_deleting" });
  }

  const ts = now();
  db.prepare("UPDATE users SET couple_id = ?, updated_at = ? WHERE id = ?").run(
    targetId,
    ts,
    userId,
  );
  addAuditLog({
    actor_user_id: userId,
    couple_id: targetId,
    action: "user.switch_workspace",
    target_kind: "couple",
    target_id: targetId,
    note: `active workspace → ${targetId}`,
  });
  return json({ couple: toCouple(target) });
}

interface CreateAdditionalCoupleBody {
  event_name?: unknown;
  wedding_date_goal?: unknown;
  /** Source workspace to seed guests + households from. Optional. The
   *  caller must already be a member of this couple — verified server-
   *  side so a malicious client can't bulk-clone someone else's list. */
  seed_from_couple_id?: unknown;
  /** Guest ids inside the source workspace that should be copied across.
   *  Empty / omitted = no seed. Households of these guests come along
   *  automatically. */
  seed_guest_ids?: unknown;
}

/** POST /api/couples — create a SECOND (or third) workspace for an
 *  already-onboarded user. Distinct from /api/couples/onboard which is
 *  the first-time gate. The user becomes owner of the new workspace and
 *  their `users.couple_id` auto-switches to it (the caller obviously
 *  wants to look at what they just created; the header switcher will
 *  show the old workspace alongside the new one). */
async function handleCreateAdditionalCouple(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const body = await readJson<CreateAdditionalCoupleBody>(ctx.req);

  // The existing workspace count caps at 3 (Alpha / Bravo / Charlie). Most
  // weddings need at most 2-3 events; the UI is built around three pills.
  // Extending later means lifting this cap + revisiting the switcher
  // layout, both deferred.
  const existing = listCouplesForUser(userId).filter((c) => c.status !== "deleting").length;
  if (existing >= 3) {
    throw new HttpError(409, "You already have the maximum of 3 workspaces", {
      code: "max_workspaces",
    });
  }

  // All events for ONE wedding share the same bride/groom — the additional
  // workspace exists to model multiple events (civil + religious + dinner +
  // afterparty etc.), not multiple couples. We inherit names from the
  // caller's current couple and only ask for the event label.
  if (typeof body.event_name !== "string") {
    throw new HttpError(400, "event_name required");
  }
  const eventName = body.event_name.trim();
  if (eventName.length < 1 || eventName.length > 100) {
    throw new HttpError(400, "event_name must be 1–100 chars");
  }
  const currentCouple = getCoupleForUser(userId);
  if (!currentCouple) {
    throw new HttpError(400, "No active workspace to inherit names from", {
      code: "no_active_workspace",
    });
  }
  const brideName = currentCouple.bride_name;
  const groomName = currentCouple.groom_name;
  const displayName = eventName;
  const dateGoal = parseWeddingDateGoal(body as OnboardBody);
  const guestGoal: GuestCountGoal = { kind: "tbd", exact: null, min: null, max: null };
  const budgetGoal: BudgetGoal = {
    kind: "tbd",
    exact_huf: null,
    min_huf: null,
    max_huf: null,
  };
  const styleTags: WeddingStyleTag[] = [];
  const currency: Currency = "HUF";
  const ceremonyKind: CeremonyKind | null = null;

  // Optional seed validation. Membership check protects against a malicious
  // client pointing at someone else's couple_id; the seed helper itself
  // does another defensive guard on src ≠ dst.
  let seedFrom: number | null = null;
  let seedGuestIds: number[] = [];
  if (body.seed_from_couple_id !== undefined && body.seed_from_couple_id !== null) {
    const srcId = Number(body.seed_from_couple_id);
    if (!Number.isFinite(srcId) || srcId <= 0) {
      throw new HttpError(400, "seed_from_couple_id must be a positive integer");
    }
    if (!isCoupleMember(srcId, userId)) {
      throw new HttpError(403, "Not a member of the source workspace", { code: "not_a_member" });
    }
    seedFrom = srcId;
    if (Array.isArray(body.seed_guest_ids)) {
      seedGuestIds = body.seed_guest_ids
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
  }

  const ts = now();
  const result = db
    .prepare(
      `INSERT INTO couples
        (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
         wedding_date, wedding_date_kind, wedding_target_year, wedding_target_month, wedding_target_season,
         target_guest_count, guest_count_kind, target_guest_count_min, target_guest_count_max,
         budget_ceiling_huf, budget_kind, budget_ceiling_min_huf, budget_ceiling_max_huf,
         location_lat, location_lng, location_radius_km,
         style_tags_json, currency, status, created_at, updated_at, onboarded_at)
       VALUES (?, NULL, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, ?, ?,
               ?, ?, ?, ?,
               NULL, NULL, NULL,
               ?, ?, 'active', ?, ?, ?)`,
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
      JSON.stringify(styleTags),
      currency,
      ts,
      ts,
      ts,
    );
  const coupleId = Number(result.lastInsertRowid);
  const slug = uniqueCoupleSlug(deriveSlugBase(brideName, groomName, displayName), coupleId);
  db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(slug, ts, coupleId);

  if (ceremonyKind) {
    db.prepare("UPDATE couples SET ceremony_kind = ?, updated_at = ? WHERE id = ?").run(
      ceremonyKind,
      ts,
      coupleId,
    );
  }

  // Spawn the bride/groom host-guest rows for the new workspace before
  // seeding others, so the dedicated host household has the lowest ids
  // (matches Alpha's ordering convention).
  ensurePartnerGuests({ coupleId, brideName, groomName });

  // Seed budget lines off the new workspace's own goal — Bravo / Charlie
  // start with a fresh budget that the user can scale independently.
  const seedHuf = representativeBudgetHuf(budgetGoal);
  if (seedHuf > 0) seedBudgetLines(coupleId, seedHuf);

  // Apply the optional guest+household import. Skipped silently when the
  // caller didn't ask for it or selected nothing.
  let seedSummary = { households_copied: 0, guests_copied: 0 };
  if (seedFrom !== null && seedGuestIds.length > 0) {
    seedSummary = seedCoupleFromCouple(seedFrom, coupleId, seedGuestIds);
  }

  // Membership + auto-switch. The new workspace becomes the user's active
  // pointer so the next /api/couples/current resolves there immediately.
  addCoupleMember(coupleId, userId, "owner");
  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "couple.create_additional",
    target_kind: "couple",
    target_id: coupleId,
    after: {
      display_name: displayName,
      bride_name: brideName,
      groom_name: groomName,
      wedding_date_goal: dateGoal,
      guest_count_goal: guestGoal,
      budget_goal: budgetGoal,
      seed_from_couple_id: seedFrom,
      seed_households_copied: seedSummary.households_copied,
      seed_guests_copied: seedSummary.guests_copied,
    },
  });

  const row = getCoupleById(coupleId);
  if (!row) throw new HttpError(500, "Couple vanished after insert");
  return json(
    {
      couple: toCouple(row),
      seeded: seedSummary,
    },
    { status: 201 },
  );
}

/** DELETE /api/couples/:id — destroy a SECONDARY workspace (Bravo / Charlie).
 *  Cannot be used to nuke the primary workspace (Alpha — that's the
 *  account-deletion flow on /app/profile) or the workspace the user is
 *  currently viewing (force a switch first so we never trash what they're
 *  looking at). Only `owner` role can delete; partners get 403.
 *
 *  Frontend pairs this with a 3-click arm pattern (Törlés → Biztos? →
 *  Tényleg?) so the destructive call only fires after explicit intent. */
async function handleDeleteCouple(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const coupleId = Number(ctx.params.id);
  if (!Number.isFinite(coupleId) || coupleId <= 0) {
    throw new HttpError(400, "Invalid couple id");
  }
  if (!isCoupleMember(coupleId, userId)) {
    throw new HttpError(403, "Not a member of this workspace", { code: "not_a_member" });
  }
  // Only the workspace owner can purge it; partner-B-on-Bravo can leave
  // via /api/users/me/leave-couple but cannot destroy the whole workspace.
  const member = db
    .prepare("SELECT role FROM couple_members WHERE couple_id = ? AND user_id = ?")
    .get(coupleId, userId) as { role: string } | undefined;
  if (!member || member.role !== "owner") {
    throw new HttpError(403, "Only the workspace owner can delete it", { code: "not_owner" });
  }
  // Refuse to delete the active workspace — the frontend switcher can flip
  // first, but we never silently swap the user's couple_id from under them.
  const userRow = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(userId) as
    | { couple_id: number | null }
    | undefined;
  if (userRow?.couple_id === coupleId) {
    throw new HttpError(409, "Switch to a different workspace before deleting this one", {
      code: "is_active",
    });
  }
  // Refuse to delete the user's PRIMARY (Alpha) workspace — that's the
  // account-deletion gesture and belongs on the Profile pause-to-delete
  // flow with its full typed-phrase guard. `listCouplesForUser` returns
  // memberships ordered by joined_at ASC, so index 0 is whichever
  // workspace the user joined first (their onboarded couple).
  const memberships = listCouplesForUser(userId);
  if (memberships[0]?.couple_id === coupleId) {
    throw new HttpError(409, "The primary workspace can't be deleted from here", {
      code: "is_primary",
    });
  }

  // purgeOneCouple is the same destructive sweep used by the pause-to-delete
  // and partner-merge flows: cascade-deletes every couple-scoped row, scrubs
  // any PII on partner-B-on-Bravo if there is one. `silent: true` skips the
  // "your data is gone" email — the user just consciously deleted a
  // secondary workspace they own, not their account, so the global notice
  // would just confuse.
  purgeOneCouple(coupleId, { silent: true });
  // purgeOneCouple tombstones the couples row but leaves couple_members in
  // place for audit retention. Drop every membership pointing at this
  // workspace so it stops showing up in any user's switcher — including
  // partner-B-on-Bravo, who shouldn't see a ghosted "Purged workspace" row
  // after the owner deletes it. The status='deleting' filter on
  // listCouplesForUser is the belt; this is the suspenders.
  db.prepare("DELETE FROM couple_members WHERE couple_id = ?").run(coupleId);
  return json({ ok: true });
}

export function registerCoupleRoutes(router: Router) {
  router.post("/api/couples/onboard", handleOnboard, true);
  router.post("/api/couples", handleCreateAdditionalCouple, true);
  router.delete("/api/couples/:id", handleDeleteCouple, true);
  router.get("/api/couples/current", handleGetCurrentCouple, true);
  router.get("/api/couples/partner", handleGetPartner, true);
  router.get("/api/couples/activity", handleGetActivity, true);
  router.patch("/api/couples/current", handleUpdateCurrentCouple, true);
  router.patch("/api/couples/slug", handleUpdateSlug, true);
  router.get("/api/users/me/couples", handleListMyCouples, true);
  router.post("/api/users/me/active-couple", handleSwitchActiveCouple, true);
  router.post("/api/couples/invites", handleCreateInvite, true);
  router.get("/api/couples/invites/current", handleGetCurrentInvite, true);
  router.post("/api/couples/invites/cancel", handleCancelInvite, true);
  // Register the static `/incoming` path BEFORE the `/:token` pattern so
  // the router matches it as a literal instead of treating "incoming" as a
  // token value (which would 404 on lookup).
  router.get("/api/invites/incoming", handleListIncomingInvites, true);
  router.get("/api/invites/:token", handleGetInvite); // public — pre-signup
  router.post("/api/invites/:token/accept", handleAcceptInvite, true);
  router.post("/api/invites/:token/accept-merge", handleAcceptInviteMerge, true);
  // Public — token in the path acts as bearer; the recipient might not be
  // a Weddly user (they can decline without signing up).
  router.post("/api/invites/:token/decline", handleDeclineInvite, false);
  router.post("/api/couples/current/archive", handleArchive, true);
  router.post("/api/couples/current/notify-date-change", handleNotifyDateChange, true);
  router.post("/api/couples/current/dismiss-date-change", handleDismissDateChange, true);
}
