// Public RSVP endpoints. Two credentials are accepted:
//   1. Couple slug + 4-digit household code (the airport-style check-in flow).
//   2. The legacy 6-char per-guest invite_code (kept so old `/rsvp/<code>`
//      links shipped in older invites continue to work; resolves to the
//      guest's household and renders the same household RSVP view).
//
// Heavy rate-limit per IP to slow code enumeration.

import type { MealMenu, MealSlotKey } from "@shared/types";
import type {
  CheckinAddedMember,
  CheckinMemberSubmit,
  CheckinSubmitBody,
  GuestKind,
  PublicCheckinView,
  RsvpStatus,
} from "@shared/types";
import { isMealChoice, parseMealMenu } from "@shared/meals";
import { isCurrency } from "@shared/currency";
import { GUEST_MESSAGE_MAX } from "@shared/rsvp";
import { GUEST_HEALTH_NOTICE_VERSION } from "@shared/legal";
import { isRsvpOfferedAccommodation, listRsvpAccommodationOptions } from "../domain/accommodations";
import { CONFIG } from "../config";
import { db } from "../db";
import { type CoupleRow, getCoupleById } from "../domain/couples";
import { sendKind } from "../domain/emails";
import { insertCoupleNotification } from "../domain/notifications";
import {
  applyMemberCheckin,
  getHouseholdById,
  getHouseholdByCoupleAndCode,
  type HouseholdRow,
  listMembers,
  setHouseholdGuestMessage,
  toHouseholdMember,
} from "../domain/households";
import {
  type GuestRow,
  getCoupleRsvpProgress,
  getGuestByInviteCode,
  isGuestKind,
  isMealSlotKey,
  isRsvpStatus,
  uniqueInviteCode,
} from "../domain/guests";
import { normalizeSlugInput } from "../domain/slug";
import { getUserById } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { recordGrowthEventFromRequest } from "../domain/growth_events";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { recordConsent } from "../domain/consents";

// More forgiving than auth, but still slows enumeration of slug+code combos.
const RSVP_BUCKET = { capacity: 30, refillRate: 1 / 5 };

// In-process idempotency cache for /api/rsvp/checkin. Keyed by
// `${household_id}:${idempotency_key}` and held in memory for 5 minutes —
// short enough that a stale browser tab doesn't replay an unrelated submit,
// long enough to catch genuine retransmits (mobile network, refresh-button
// double-click). Crash-safe because the worst case is the second call goes
// through as a regular submit.
interface IdempotentEntry {
  status: number;
  body: string;
  expiresAt: number;
}
const RSVP_IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
// Hard ceiling on the in-memory cache. The cache key embeds attacker-influenced
// input (household code + idempotency key), so without a cap an attacker hitting
// many household codes with unique keys could grow this Map until the single Bun
// process OOMs — a full-service DoS. With the 5-minute TTL the legitimate
// working set is tiny; this cap is the crash backstop.
const RSVP_IDEMPOTENCY_MAX = 10_000;
const rsvpIdempotencyCache = new Map<string, IdempotentEntry>();

function gcIdempotency(): void {
  const now = Date.now();
  for (const [key, entry] of rsvpIdempotencyCache) {
    if (entry.expiresAt < now) rsvpIdempotencyCache.delete(key);
  }
}

/** Insert/refresh an idempotency entry while keeping the Map bounded. We GC
 *  expired entries first; if still at the cap, evict oldest-first (Map iterates
 *  in insertion order) until under it. Evicting a still-valid key only means its
 *  next replay runs as a normal submit, which the RSVP upsert handles
 *  idempotently at the DB level — benign. */
function setIdempotent(key: string, entry: IdempotentEntry): void {
  // Re-inserting an existing key shouldn't grow the Map, so only enforce the cap
  // when adding a genuinely new key. Evict oldest-first (Map iterates in
  // insertion order) until back under the cap — O(overflow), normally one
  // delete. We deliberately do NOT run the full-scan gcIdempotency() here: it's
  // already called once per request (handleCheckinSubmit), and an O(n) scan on
  // every insert would be O(n^2) under a flood — the exact DoS we're guarding
  // against. Evicting a still-valid key only downgrades its next replay to a
  // normal (DB-idempotent) submit.
  if (!rsvpIdempotencyCache.has(key)) {
    while (rsvpIdempotencyCache.size >= RSVP_IDEMPOTENCY_MAX) {
      const oldest = rsvpIdempotencyCache.keys().next().value;
      if (oldest === undefined) break;
      rsvpIdempotencyCache.delete(oldest);
    }
  }
  rsvpIdempotencyCache.set(key, entry);
}

/** Test-only hook so the e2e suite can assert the idempotency cache stays
 *  bounded without firing RSVP_IDEMPOTENCY_MAX+ HTTP requests. Not referenced by
 *  any production code path. */
export const __rsvpIdempotencyTestHook = {
  set: setIdempotent,
  size: () => rsvpIdempotencyCache.size,
  clear: () => rsvpIdempotencyCache.clear(),
  has: (key: string) => rsvpIdempotencyCache.has(key),
  MAX: RSVP_IDEMPOTENCY_MAX,
};

async function hashBodyKey(raw: string): Promise<string> {
  // Cheap-ish content hash; we only need to detect bit-exact retransmits.
  const buf = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const arr = Array.from(new Uint8Array(digest));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Resolvers ──────────────────────────────────────────────────────────────

function resolveCoupleBySlug(slug: string): CoupleRow {
  if (!slug || slug.length > 64) throw new HttpError(400, "Invalid couple identifier");
  const cleaned = normalizeSlugInput(slug);
  if (!cleaned) throw new HttpError(404, "Couple not found");
  const row = db.prepare("SELECT * FROM couples WHERE slug = ?").get(cleaned) as
    | CoupleRow
    | undefined;
  if (!row) throw new HttpError(404, "Couple not found");
  return row;
}

function resolveHousehold(coupleId: number, codeRaw: string): HouseholdRow {
  if (!codeRaw || codeRaw.length > 16) throw new HttpError(400, "Invalid code");
  // The check-in code is digits-only, but accept the raw form gracefully.
  const code = codeRaw.trim();
  const hh = getHouseholdByCoupleAndCode(coupleId, code);
  if (!hh) throw new HttpError(404, "Code not found");
  return hh;
}

function buildView(couple: CoupleRow, household: HouseholdRow): PublicCheckinView {
  const members = listMembers(household.id).map(toHouseholdMember);
  return {
    couple_slug: couple.slug ?? "",
    couple_display_name: couple.display_name,
    wedding_date: couple.wedding_date,
    household_code: household.code,
    household_label: household.label,
    members,
    // The RSVP toggles moved from the couple to the household in May 2026 so
    // each party can carry its own decision. Existing couple-level columns
    // are retained server-side for back-compat (schema additive) but no
    // longer flow into the public view.
    rsvp_offers_accommodation: household.rsvp_offers_accommodation === 1,
    // Couple-level, but only rendered when this household was asked the
    // accommodation question at all. Empty list = the couple published no
    // options and the form keeps its plain yes/no checkbox.
    accommodation_options:
      household.rsvp_offers_accommodation === 1 ? listRsvpAccommodationOptions(couple.id) : [],
    currency: isCurrency(couple.currency) ? couple.currency : "HUF",
    rsvp_collects_meal: household.rsvp_collects_meal === 1,
    // Couple-level custom menu (labels + offered flags) so the public form
    // shows the couple's real dishes and only the slots they actually offer.
    meal_menu: parseMealMenu(couple.meal_menu),
    // Echoed back so reopening the form shows what this party already wrote.
    // Without it the box would render empty and the resubmit would clear a
    // message the couple had already read.
    guest_message: household.guest_message ?? null,
    wedding_site_published: couple.is_public === 1,
  };
}

// ─── Handlers ───────────────────────────────────────────────────────────────

function handleLookup(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "rsvp:lookup", RSVP_BUCKET);
  const slug = ctx.url.searchParams.get("couple") ?? "";
  const code = ctx.url.searchParams.get("code") ?? "";
  const couple = resolveCoupleBySlug(slug);
  const hh = resolveHousehold(couple.id, code);
  recordGrowthEventFromRequest("rsvp.page.view", ctx.req, {
    couple_id: couple.id,
    household_id: hh.id,
  });
  return json({ rsvp: buildView(couple, hh) });
}

interface SubmitMemberRaw {
  guest_id?: unknown;
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  accommodation_needed?: unknown;
  accommodation_id?: unknown;
  song_request?: unknown;
}

function strOrNull(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

/** Resolve a submitted meal value against THIS couple's menu. The six
 *  canonical slots always pass; a custom key has to actually exist on their
 *  menu, so a hand-rolled request can't invent `x9` and a key whose option the
 *  couple has since deleted resolves to "no preference" rather than to a
 *  phantom dish. Unknown values degrade to null, which is the contract this
 *  field always had. */
function resolveMeal(raw: unknown, menu: MealMenu): MealSlotKey | null {
  if (typeof raw !== "string" || !isMealSlotKey(raw)) return null;
  if (isMealChoice(raw)) return raw;
  return menu.some((m) => m.choice === raw) ? raw : null;
}

function parseMember(raw: SubmitMemberRaw, coupleId: number, menu: MealMenu): CheckinMemberSubmit {
  if (typeof raw.guest_id !== "number" || !Number.isFinite(raw.guest_id)) {
    throw new HttpError(400, "members[].guest_id required");
  }
  const status = typeof raw.rsvp_status === "string" ? raw.rsvp_status : "";
  if (!isRsvpStatus(status)) throw new HttpError(400, "members[].rsvp_status invalid");

  const meal = resolveMeal(raw.meal_choice, menu);

  // This handler is unauthenticated, so the lodging id is verified rather than
  // trusted: it has to be this couple's row AND one they actually published.
  // A 400 rather than a silent drop, because a guest who picked a place and
  // was quietly recorded as "no preference" is worse off than one who is told.
  let accommodationId: number | null = null;
  if (raw.accommodation_id !== null && raw.accommodation_id !== undefined) {
    if (typeof raw.accommodation_id !== "number" || !Number.isInteger(raw.accommodation_id)) {
      throw new HttpError(400, "members[].accommodation_id invalid");
    }
    if (!isRsvpOfferedAccommodation(raw.accommodation_id, coupleId)) {
      throw new HttpError(400, "members[].accommodation_id is not an offered option");
    }
    accommodationId = raw.accommodation_id;
  }

  return {
    guest_id: raw.guest_id,
    rsvp_status: status,
    meal_choice: meal,
    // Picking a place IS needing one. Without this the couple could see a
    // chosen lodging on a guest the summary still counted as needing nothing.
    accommodation_needed: accommodationId !== null || Boolean(raw.accommodation_needed),
    accommodation_id: accommodationId,
    dietary: strOrNull(raw.dietary, 500),
    song_request: strOrNull(raw.song_request, 500),
  };
}

function persistCheckin(
  couple: CoupleRow,
  household: HouseholdRow,
  members: CheckinMemberSubmit[],
): { previous: GuestRow[]; updated: GuestRow[] } {
  const existing = listMembers(household.id);
  const byId = new Map(existing.map((g) => [g.id, g]));

  // Reject any guest_id that doesn't belong to this household.
  for (const m of members) {
    if (!byId.has(m.guest_id)) {
      throw new HttpError(400, `Guest ${m.guest_id} not in this household`);
    }
  }

  const tx = db.transaction(() => {
    for (const m of members) {
      applyMemberCheckin(m.guest_id, household.id, {
        rsvp_status: m.rsvp_status,
        meal_choice: m.meal_choice,
        dietary: m.dietary,
        accommodation_needed: m.accommodation_needed,
        accommodation_id: m.accommodation_id ?? null,
        song_request: m.song_request,
      });
    }
  });
  tx();

  const refreshed = listMembers(household.id);
  for (const m of members) {
    const before = byId.get(m.guest_id);
    const after = refreshed.find((r) => r.id === m.guest_id);
    addAuditLog({
      actor_user_id: null,
      couple_id: couple.id,
      action: "rsvp.submit",
      target_kind: "guest",
      target_id: m.guest_id,
      after: {
        status: m.rsvp_status,
        meal: m.meal_choice,
        household_id: household.id,
      },
      note: before && after && before.rsvp_status !== after.rsvp_status ? "status changed" : null,
    });
  }

  return { previous: existing, updated: refreshed };
}

/**
 * Notify the couple about an RSVP submission. When a single guest changed,
 * we send the focused `rsvp_received_for_couple` template; when 2+ guests
 * in the same household changed in one submit, we collapse them into a
 * single `rsvp_received_household_for_couple` summary email per partner —
 * a family that fills the form together shouldn't generate N inbox pings.
 *
 * A NEW guest message counts as something worth telling them about on its own.
 * The common case is a message written alongside a status, which rides the
 * mail that was going out anyway; the other case is a household coming back
 * later to say "we're arriving late", where nobody's answer moves and without
 * this nothing would reach the couple at all.
 */
function notifyCouple(
  couple: CoupleRow,
  household: HouseholdRow,
  members: GuestRow[],
  previous: GuestRow[],
  /** The message as it stands after this submit, and whether this submit is
   *  what changed it. Only a NEW message is mailed: re-sending a stored one on
   *  every later RSVP from the same household would read as a duplicate. */
  message: { text: string | null; changed: boolean } = { text: null, changed: false },
) {
  const guestPageUrl = `${CONFIG.frontendBaseUrl}/app/guests`;
  const prevById = new Map(previous.map((p) => [p.id, p]));

  // Collect every member whose status meaningfully changed (skip pending → pending
  // no-ops and any unchanged rows). These are the rows that warrant a notification.
  const changed: { name: string; rsvpStatus: "yes" | "no" | "maybe" }[] = [];
  for (const m of members) {
    if (m.rsvp_status === "pending") continue;
    const before = prevById.get(m.id);
    if (before && before.rsvp_status === m.rsvp_status) continue;
    const status = m.rsvp_status;
    if (!isRsvpStatus(status) || status === "pending") continue;
    changed.push({ name: m.full_name, rsvpStatus: status as "yes" | "no" | "maybe" });
  }
  const newMessage = message.changed && message.text ? message.text : null;
  if (changed.length === 0 && !newMessage) return;

  // In-app bell notification — fires regardless of the EMAIL digest mode below
  // (digest only governs the inbox cadence, not the in-app feed). One couple-
  // scoped row per submission; a single guest names the guest, a family RSVP
  // collapses into a count.
  if (changed.length === 0) {
    insertCoupleNotification({
      couple_id: couple.id,
      kind: "rsvp_guest_message",
      data: { householdLabel: household.label },
      link: "/app/guests",
    });
  } else if (changed.length === 1) {
    const only = changed[0]!;
    insertCoupleNotification({
      couple_id: couple.id,
      kind: "rsvp_received",
      data: { guestName: only.name, rsvpStatus: only.rsvpStatus },
      link: "/app/guests",
    });
  } else {
    insertCoupleNotification({
      couple_id: couple.id,
      kind: "rsvp_received_household",
      data: { householdLabel: household.label, count: changed.length },
      link: "/app/guests",
    });
  }

  // Couples on digest mode opted out of per-event mail in Profile — the
  // weekly cron sweep rolls these up into a single Monday digest. Skip the
  // per-event send entirely; the email_log row would otherwise misrepresent
  // intent ("we sent X mails" vs "we suppressed X mails for digest").
  if ((couple as { rsvp_digest_mode?: string }).rsvp_digest_mode === "weekly") return;

  // Whole-list progress so the partner sees how far the RSVP push has come,
  // not just this one household. Counted once per submission, shared by both
  // partners' mails.
  const progress = getCoupleRsvpProgress(couple.id);

  for (const partnerId of [couple.partner_a_id, couple.partner_b_id]) {
    if (!partnerId) continue;
    const partner = getUserById(partnerId);
    if (!partner) continue;
    if (changed.length === 1) {
      const only = changed[0]!;
      void sendKind(
        "rsvp_received_for_couple",
        {
          guestName: only.name,
          rsvpStatus: only.rsvpStatus,
          guestPageUrl,
          progress,
          guestMessage: newMessage,
        },
        {
          user: { id: partner.id, email: partner.email, full_name: partner.full_name },
          couple_id: couple.id,
        },
      );
    } else {
      void sendKind(
        "rsvp_received_household_for_couple",
        {
          householdLabel: household.label,
          guests: changed,
          guestPageUrl,
          progress,
          guestMessage: newMessage,
        },
        {
          user: { id: partner.id, email: partner.email, full_name: partner.full_name },
          couple_id: couple.id,
        },
      );
    }
  }
}

function notifyGuests(couple: CoupleRow, members: GuestRow[]) {
  const rsvpPageUrl = `${CONFIG.frontendBaseUrl}/rsvp`;
  // Dedup by email — one thank-you per unique inbox so a family sharing a
  // single Gmail doesn't get N copies.
  const emailed = new Set<string>();
  for (const m of members) {
    if (!m.email) continue;
    if (emailed.has(m.email)) continue;
    emailed.add(m.email);
    const status = isRsvpStatus(m.rsvp_status) ? m.rsvp_status : "pending";
    if (status === "pending") continue;
    void sendKind(
      "rsvp_thanks_for_guest",
      {
        coupleDisplayName: couple.display_name,
        weddingDate: couple.wedding_date,
        rsvpStatus: status as "yes" | "no" | "maybe",
        rsvpPageUrl,
      },
      {
        user: null,
        guest: { email: m.email, full_name: m.full_name },
        couple_id: couple.id,
      },
    );
  }
}

interface AddedMemberRaw {
  full_name?: unknown;
  kind?: unknown;
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  is_plus_one?: unknown;
  parent_member_id?: unknown;
}

function parseAddedMember(raw: AddedMemberRaw, menu: MealMenu): CheckinAddedMember {
  const fullNameRaw = typeof raw.full_name === "string" ? raw.full_name.trim() : "";
  if (!fullNameRaw) throw new HttpError(400, "added_members[].full_name required");
  if (fullNameRaw.length > 200) throw new HttpError(400, "added_members[].full_name too long");

  const kind: GuestKind =
    typeof raw.kind === "string" && isGuestKind(raw.kind) ? raw.kind : "adult";

  const status = typeof raw.rsvp_status === "string" ? raw.rsvp_status : "yes";
  const rsvpStatus = isRsvpStatus(status) ? status : "yes";

  const mealRaw = typeof raw.meal_choice === "string" ? raw.meal_choice : null;
  const meal = mealRaw && isMealSlotKey(mealRaw) ? mealRaw : null;

  const isPlusOne = raw.is_plus_one === true;
  const parentId =
    typeof raw.parent_member_id === "number" && Number.isFinite(raw.parent_member_id)
      ? raw.parent_member_id
      : null;

  return {
    full_name: fullNameRaw,
    kind,
    rsvp_status: rsvpStatus,
    meal_choice: meal,
    dietary: strOrNull(raw.dietary, 500),
    is_plus_one: isPlusOne,
    parent_member_id: isPlusOne ? parentId : null,
  };
}

/** Materialize new members the guest is bringing (a +1 / child / baby) as
 *  fresh guest rows in the same household. Returns the inserted rows so the
 *  caller can fold them into notifications + audit. */
function persistAddedMembers(
  couple: CoupleRow,
  household: HouseholdRow,
  added: CheckinAddedMember[],
): GuestRow[] {
  if (added.length === 0) return [];
  const ts = Date.now();
  // Existing household members a "+1" is allowed to hang off — must already be
  // in this household and must NOT themselves be a +1 (a +1 can't carry its own
  // +1). Mirrors the UI guard so a hand-crafted payload can't sneak one in.
  const hostable = new Set(
    (
      db
        .prepare("SELECT id FROM guests WHERE household_id = ? AND is_plus_one = 0")
        .all(household.id) as { id: number }[]
    ).map((r) => r.id),
  );
  const insert = db.prepare(
    `INSERT INTO guests
       (couple_id, full_name, email, phone, group_tag, invite_code, kind, is_plus_one, plus_one_of, rsvp_status,
        meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
        song_request, notes, rsvp_responded_at, created_at, updated_at, household_id)
     VALUES (?, ?, NULL, NULL, 'other', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, NULL, ?, ?, ?, ?)`,
  );
  const inserted: GuestRow[] = [];
  const tx = db.transaction(() => {
    for (const m of added) {
      const code = uniqueInviteCode();
      const plusOneOf =
        m.is_plus_one && m.parent_member_id != null && hostable.has(m.parent_member_id)
          ? m.parent_member_id
          : null;
      const isPlusOne = plusOneOf != null ? 1 : 0;
      const result = insert.run(
        couple.id,
        m.full_name,
        code,
        m.kind,
        isPlusOne,
        plusOneOf,
        m.rsvp_status,
        m.meal_choice,
        m.dietary,
        m.rsvp_status === "pending" ? null : ts,
        ts,
        ts,
        household.id,
      );
      const newId = Number(result.lastInsertRowid);
      const row = db.prepare("SELECT * FROM guests WHERE id = ?").get(newId) as
        | GuestRow
        | undefined;
      if (row) inserted.push(row);
      addAuditLog({
        actor_user_id: null,
        couple_id: couple.id,
        action: "rsvp.add_member",
        target_kind: "guest",
        target_id: newId,
        after: { full_name: m.full_name, kind: m.kind, rsvp_status: m.rsvp_status },
        note: `added during check-in to household ${household.id}`,
      });
    }
  });
  tx();
  return inserted;
}

async function handleCheckinSubmit(ctx: Ctx): Promise<Response> {
  // Read the raw body once so we can hash it for idempotency before parsing.
  const rawBody = await ctx.req.text();
  let parsedBody: Partial<CheckinSubmitBody>;
  try {
    parsedBody = JSON.parse(rawBody) as Partial<CheckinSubmitBody>;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  const body = parsedBody;
  if (typeof body.couple_slug !== "string") throw new HttpError(400, "couple_slug required");
  if (typeof body.household_code !== "string") throw new HttpError(400, "household_code required");
  if (!Array.isArray(body.members)) {
    throw new HttpError(400, "members array required");
  }
  if (body.members.length > 50) throw new HttpError(400, "Too many members");
  const addedRaw = Array.isArray(body.added_members) ? body.added_members : [];
  if (addedRaw.length > 10) throw new HttpError(400, "Too many added members");
  if (body.members.length === 0 && addedRaw.length === 0) {
    throw new HttpError(400, "Nothing to submit");
  }

  // Coarse per-IP throttle BEFORE the slug/code lookup below. Slugs are public
  // (they are the /w/:slug address), so the household code is the only secret
  // guarding the RSVP roster; a wrong code throws in resolveHousehold, so
  // without this an attacker could enumerate codes (legacy 4-digit codes are a
  // 10k space) unthrottled. Keyed on IP, it costs a token per attempt whether
  // the code resolves or not — mirrors the lookup path.
  rateLimit(ctx.clientIp, "rsvp:submit-ip", RSVP_BUCKET);

  const couple = resolveCoupleBySlug(body.couple_slug);
  const hh = resolveHousehold(couple.id, body.household_code);

  // Per-household bucket — a wedding venue WiFi (everyone NAT'd through one
  // address) shouldn't get throttled once a valid code resolves, so the
  // venue-friendly limit is keyed per household on top of the per-IP guard above.
  rateLimit(`couple:${couple.id}:hh:${hh.id}`, "rsvp:submit", RSVP_BUCKET);

  // Idempotency. Header is preferred (frontend sends a fresh UUID per submit
  // attempt); a content-hash key is the fallback so a retransmit without a
  // header still doesn't duplicate `added_members` rows.
  // Cap the attacker-controlled header before using it as a live cache key —
  // every other untrusted field in this public handler is length-checked, and
  // an uncapped value would pin an arbitrarily large string in the in-memory
  // idempotency map for the full TTL.
  const idemHeader = ctx.req.headers.get("idempotency-key")?.trim().slice(0, 200);
  const idemKey = idemHeader || (await hashBodyKey(rawBody));
  const cacheKey = `${hh.id}:${idemKey}`;
  gcIdempotency();
  const cached = rsvpIdempotencyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return new Response(cached.body, {
      status: cached.status,
      headers: { "Content-Type": "application/json", "Idempotent-Replay": "1" },
    });
  }

  const coupleMenu = parseMealMenu(couple.meal_menu);
  const parsed = body.members.map((m) => parseMember(m as SubmitMemberRaw, couple.id, coupleMenu));
  const parsedAdded = addedRaw.map((m) => parseAddedMember(m as AddedMemberRaw, coupleMenu));
  const hasHealthData = [...parsed, ...parsedAdded].some((member) => Boolean(member.dietary));
  if (hasHealthData && body.health_data_consent !== true) {
    throw new HttpError(
      400,
      "Explicit consent is required to store allergy or dietary health data",
      {
        code: "health_data_consent_required",
      },
    );
  }

  const { previous, updated } = persistCheckin(couple, hh, parsed);
  const addedRows = persistAddedMembers(couple, hh, parsedAdded);
  const previouslyHadHealthData = previous.some((member) => Boolean(member.dietary));
  if (hasHealthData || previouslyHadHealthData) {
    recordConsent({
      subjectUserId: null,
      subjectKind: "guest",
      subjectRef: `household:${hh.id}`,
      document: hasHealthData ? "guest_health" : "guest_health_withdrawn",
      version: GUEST_HEALTH_NOTICE_VERSION,
      ip: ctx.clientIp,
      userAgent: ctx.req.headers.get("user-agent"),
    });
  }

  // Household-level, so it is written once per submit rather than per member.
  // An ABSENT key leaves the stored message alone (an older client, or a
  // partial resubmit, must not silently erase what the couple already read);
  // an empty string is the guest clearing it and stores NULL.
  const messageSent = body.guest_message !== undefined;
  const guestMessage = messageSent ? strOrNull(body.guest_message, GUEST_MESSAGE_MAX) : null;
  // `hh` was loaded before any of the writes above, so it still holds what the
  // household had written BEFORE this submit. That comparison is the whole
  // reason the couple isn't mailed the same message again every time this
  // family reopens the form to change a meal.
  const messageChanged = messageSent && guestMessage !== (hh.guest_message ?? null);
  if (messageSent) setHouseholdGuestMessage(hh.id, couple.id, guestMessage);

  notifyCouple(couple, hh, [...updated, ...addedRows], previous, {
    text: guestMessage,
    changed: messageChanged,
  });
  notifyGuests(couple, [...updated, ...addedRows]);

  // Funnel: which household just RSVP'd, and with what breakdown.
  const counts = { yes: 0, no: 0, maybe: 0, pending: 0 };
  for (const m of updated) {
    if (m.rsvp_status in counts) counts[m.rsvp_status as keyof typeof counts]++;
  }
  recordGrowthEventFromRequest("rsvp.submitted", ctx.req, {
    couple_id: couple.id,
    household_id: hh.id,
    payload: { counts, added_count: addedRows.length },
  });

  // Re-read before rendering the answer: `hh` was loaded before the writes
  // above, so building the view off it echoes the message the guest just
  // REPLACED rather than the one they just sent. Members are re-read inside
  // buildView already; the household row was the one stale piece.
  const fresh = getHouseholdById(hh.id, couple.id) ?? hh;
  const payload = { rsvp: buildView(couple, fresh) };
  const serialized = JSON.stringify(payload);
  setIdempotent(cacheKey, {
    status: 200,
    body: serialized,
    expiresAt: Date.now() + RSVP_IDEMPOTENCY_TTL_MS,
  });
  return new Response(serialized, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Legacy single-guest endpoints ──────────────────────────────────────────

function legacyHouseholdFor(code: string): { couple: CoupleRow; household: HouseholdRow } {
  if (!code || code.length > 32) throw new HttpError(400, "Invalid code");
  const guest = getGuestByInviteCode(code.toUpperCase());
  if (!guest) throw new HttpError(404, "Invite not found");
  const couple = getCoupleById(guest.couple_id);
  if (!couple) throw new HttpError(404, "Couple gone");
  if (!guest.household_id) throw new HttpError(404, "Guest has no household");
  const hh = getHouseholdById(guest.household_id, couple.id);
  if (!hh) throw new HttpError(404, "Household gone");
  return { couple, household: hh };
}

function handleLegacyGet(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "rsvp:get", RSVP_BUCKET);
  const { couple, household } = legacyHouseholdFor(ctx.params.code ?? "");
  recordGrowthEventFromRequest("rsvp.page.view", ctx.req, {
    couple_id: couple.id,
    household_id: household.id,
    payload: { legacy_code: true },
  });
  return json({ rsvp: buildView(couple, household) });
}

interface LegacySingleSubmit {
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  health_data_consent?: unknown;
  plus_one_name?: unknown;
  plus_one_meal?: unknown;
  accommodation_needed?: unknown;
  song_request?: unknown;
}

/** The legacy POST shape addresses a single guest and may include a plus-one
 *  string. We map it onto the same household's first member (the row that
 *  owns the invite_code) — if a plus_one_name is present, we forward it to
 *  the second household member if one exists, else create a sibling guest.
 *  This keeps old e2e tests + email links functional.
 */
async function handleLegacySubmit(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "rsvp:submit", RSVP_BUCKET);
  const code = ctx.params.code ?? "";
  if (!code || code.length > 32) throw new HttpError(400, "Invalid code");
  const guest = getGuestByInviteCode(code.toUpperCase());
  if (!guest) throw new HttpError(404, "Invite not found");
  const couple = getCoupleById(guest.couple_id);
  if (!couple) throw new HttpError(404, "Couple gone");
  if (!guest.household_id) throw new HttpError(404, "Guest has no household");
  const hh = getHouseholdById(guest.household_id, couple.id);
  if (!hh) throw new HttpError(404, "Household gone");

  const body = await readJson<LegacySingleSubmit>(ctx.req);
  const status = typeof body.rsvp_status === "string" ? body.rsvp_status : "";
  if (!isRsvpStatus(status)) throw new HttpError(400, "Invalid rsvp_status");

  const legacyMenu = parseMealMenu(couple.meal_menu);
  const meal = resolveMeal(body.meal_choice, legacyMenu);

  const member: CheckinMemberSubmit = {
    guest_id: guest.id,
    rsvp_status: status,
    meal_choice: meal,
    dietary: strOrNull(body.dietary, 500),
    accommodation_needed: Boolean(body.accommodation_needed),
    song_request: strOrNull(body.song_request, 500),
  };
  if (member.dietary && body.health_data_consent !== true) {
    throw new HttpError(
      400,
      "Explicit consent is required to store allergy or dietary health data",
      {
        code: "health_data_consent_required",
      },
    );
  }
  const members: CheckinMemberSubmit[] = [member];

  // Map plus-one onto a sibling household member if one exists; else
  // materialize one so the legacy invite still records the +1.
  const plusName = strOrNull(body.plus_one_name, 200);
  if (plusName) {
    const all = listMembers(hh.id);
    let sibling = all.find((m) => m.id !== guest.id);
    const ts = Date.now();
    if (!sibling) {
      const code = uniqueInviteCode();
      const result = db
        .prepare(
          `INSERT INTO guests
             (couple_id, full_name, email, phone, group_tag, invite_code, rsvp_status,
              meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
              song_request, notes, rsvp_responded_at, created_at, updated_at, household_id)
           VALUES (?, ?, NULL, NULL, 'other', ?, 'pending', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, ?, ?, ?)`,
        )
        .run(couple.id, plusName, code, ts, ts, hh.id);
      const newId = Number(result.lastInsertRowid);
      sibling =
        (db.prepare("SELECT * FROM guests WHERE id = ?").get(newId) as GuestRow) ?? undefined;
    } else {
      // Update the sibling's name in case the legacy caller renamed the +1.
      db.prepare("UPDATE guests SET full_name = ?, updated_at = ? WHERE id = ?").run(
        plusName,
        ts,
        sibling.id,
      );
    }
    if (sibling) {
      const plusMealRaw = typeof body.plus_one_meal === "string" ? body.plus_one_meal : null;
      const plusMeal = resolveMeal(plusMealRaw, legacyMenu);
      members.push({
        guest_id: sibling.id,
        rsvp_status: status,
        meal_choice: plusMeal,
        dietary: null,
        accommodation_needed: false,
        song_request: null,
      });
    }
  }

  const { previous, updated } = persistCheckin(couple, hh, members);
  const previouslyHadHealthData = previous.some((row) => Boolean(row.dietary));
  if (member.dietary || previouslyHadHealthData) {
    recordConsent({
      subjectUserId: null,
      subjectKind: "guest",
      subjectRef: `household:${hh.id}`,
      document: member.dietary ? "guest_health" : "guest_health_withdrawn",
      version: GUEST_HEALTH_NOTICE_VERSION,
      ip: ctx.clientIp,
      userAgent: ctx.req.headers.get("user-agent"),
    });
  }
  notifyCouple(couple, hh, updated, previous);
  notifyGuests(couple, updated);

  const counts = { yes: 0, no: 0, maybe: 0, pending: 0 };
  for (const m of updated) {
    if (m.rsvp_status in counts) counts[m.rsvp_status as keyof typeof counts]++;
  }
  recordGrowthEventFromRequest("rsvp.submitted", ctx.req, {
    couple_id: couple.id,
    household_id: hh.id,
    payload: { counts, legacy_code: true },
  });

  // Both the legacy GET and the new check-in flow now return PublicCheckinView
  // — the household is the unit of truth. Old frontends that still POST here
  // get a richer payload (extra fields are ignored by their parsers).
  return json({ rsvp: buildView(couple, hh) });
}

export function registerRsvpRoutes(router: Router) {
  router.get("/api/rsvp/lookup", handleLookup);
  router.post("/api/rsvp/checkin", handleCheckinSubmit);
  // Legacy per-guest invite_code paths — keep last so they don't shadow
  // `/api/rsvp/lookup` or `/api/rsvp/checkin`.
  router.get("/api/rsvp/:code", handleLegacyGet);
  router.post("/api/rsvp/:code", handleLegacySubmit);
}
