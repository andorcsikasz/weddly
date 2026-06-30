// Household admin routes. Each one is couple-scoped — the couple owns its
// households and member assignments. The 4-digit `code` regenerator is here
// rather than the generic update so the audit trail records intent
// ("rotated for security" vs "renamed label").

import type { GuestGroupTag, Household } from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { type CoupleRow, getCoupleForUser } from "../domain/couples";
import { sendKind } from "../domain/emails";
import { isGuestGroupTag } from "../domain/guests";
import {
  createHousehold,
  getHouseholdById,
  householdContactMember,
  listHouseholdsByCouple,
  listMembers,
  markHouseholdInvited,
  regenerateHouseholdCode,
  reorderHouseholds,
  setHouseholdGroupTag,
  toHousehold,
} from "../domain/households";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// Mass invite send is a bursty, expensive operation (one outbound email per
// household). Cap it well below the per-guest single send: 6 batch calls up
// front, then one refill every 30s. Keyed per couple so one workspace can't
// starve another.
const INVITE_BATCH_BUCKET = { capacity: 6, refillRate: 1 / 30 };

function viewOf(
  row: { id: number },
  couple: Pick<CoupleRow, "id" | "bride_name" | "groom_name">,
): Household {
  const hh = getHouseholdById(row.id, couple.id);
  if (!hh) throw new HttpError(404, "Household not found");
  return toHousehold(hh, listMembers(hh.id), {
    brideName: couple.bride_name,
    groomName: couple.groom_name,
  });
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  // Opt-in filter so the household tab can hide stub singletons spawned by
  // name-only guest entries. Defaults to false to keep the legacy contract.
  const excludeAutoSingletons = ctx.url.searchParams.get("exclude_auto_singletons") === "1";
  const rows = listHouseholdsByCouple(couple.id, { excludeAutoSingletons });
  const items: Household[] = rows.map((r) =>
    toHousehold(r, listMembers(r.id), {
      brideName: couple.bride_name,
      groomName: couple.groom_name,
    }),
  );
  return json({ households: items });
}

interface UpsertBody {
  label?: unknown;
  notes?: unknown;
  group_tag?: unknown;
  rsvp_offers_accommodation?: unknown;
  rsvp_collects_meal?: unknown;
}

/** Per-household opt-in for the public RSVP "needs accommodation?" question.
 *  Strict-boolean: rejects strings / numbers / null so a typoed payload
 *  surfaces as a 400 instead of silently coercing to `false`. Mirrors the
 *  couple-level parser in `routes/couples.ts`. */
function parseRsvpOffersAccommodation(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new HttpError(400, "rsvp_offers_accommodation must be a boolean");
  }
  return raw;
}

/** Per-household opt-out for the meal-choice icon row. Same strict-boolean
 *  contract as the accommodation parser above. */
function parseRsvpCollectsMeal(raw: unknown): boolean {
  if (typeof raw !== "boolean") {
    throw new HttpError(400, "rsvp_collects_meal must be a boolean");
  }
  return raw;
}

function parseGroupTag(raw: unknown): GuestGroupTag {
  if (typeof raw !== "string" || !isGuestGroupTag(raw)) {
    throw new HttpError(400, "invalid group_tag");
  }
  return raw;
}

function parseLabel(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "label required");
  const trimmed = raw.trim();
  if (!trimmed) throw new HttpError(400, "label required");
  if (trimmed.length > 200) throw new HttpError(400, "label too long");
  return trimmed;
}

function parseNotes(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2000) throw new HttpError(400, "notes too long");
  return trimmed;
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<UpsertBody>(ctx.req);
  const label = parseLabel(body.label);
  const notes = parseNotes(body.notes);
  const groupTag = body.group_tag !== undefined ? parseGroupTag(body.group_tag) : undefined;

  const row = createHousehold({ couple_id: couple.id, label, notes, group_tag: groupTag });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.create",
    target_kind: "household",
    target_id: row.id,
    after: { label, code: row.code, group_tag: row.group_tag },
  });
  return json({ household: viewOf(row, couple) }, { status: 201 });
}

interface ReorderBody {
  /** Desired top-to-bottom order of household ids (the host household can be
   *  omitted — it's pinned on top server-side regardless). */
  ordered_ids?: unknown;
}

/** PATCH /api/households/reorder — persist the couple's manual drag order for
 *  the /app/guests household list. Unknown ids are dropped silently (a stale
 *  client list shouldn't 404 the whole reorder); the response returns the
 *  freshly ordered list so the client can reconcile against the canonical
 *  order. Registered BEFORE the `:id` PATCH so "reorder" isn't swallowed as
 *  an id param. */
async function handleReorder(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<ReorderBody>(ctx.req);
  if (!Array.isArray(body.ordered_ids)) {
    throw new HttpError(400, "ordered_ids must be an array");
  }
  if (body.ordered_ids.length > 2000) throw new HttpError(400, "Too many households");
  if (!body.ordered_ids.every((v) => typeof v === "number" && Number.isFinite(v))) {
    throw new HttpError(400, "ordered_ids must be numbers");
  }
  // Keep only ids the couple actually owns — guards against cross-tenant ids
  // and stale entries that have since been deleted.
  const owned = (body.ordered_ids as number[]).filter(
    (id) => getHouseholdById(id, couple.id) !== null,
  );
  reorderHouseholds(couple.id, owned);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.reorder",
    target_kind: "household",
    target_id: owned[0] ?? 0,
    after: { ordered_ids: owned },
  });

  const rows = listHouseholdsByCouple(couple.id);
  const items: Household[] = rows.map((r) =>
    toHousehold(r, listMembers(r.id), {
      brideName: couple.bride_name,
      groomName: couple.groom_name,
    }),
  );
  return json({ households: items });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getHouseholdById(id, couple.id);
  if (!existing) throw new HttpError(404, "Household not found");

  const body = await readJson<UpsertBody>(ctx.req);
  const label = body.label !== undefined ? parseLabel(body.label) : existing.label;
  const notes = body.notes !== undefined ? parseNotes(body.notes) : existing.notes;
  const nextGroupTag =
    body.group_tag !== undefined
      ? parseGroupTag(body.group_tag)
      : (existing.group_tag as GuestGroupTag);
  // Per-household RSVP toggles. Each one is parsed in isolation so that a
  // single PATCH body can touch any subset of them, and each fires its own
  // audit entry below so the activity feed reads cleanly. A no-op write
  // (value unchanged) still flows through `UPDATE households SET … updated_at`
  // — that's consistent with how label/notes already behave on this route.
  const prevAccom = existing.rsvp_offers_accommodation === 1;
  const nextAccom =
    body.rsvp_offers_accommodation !== undefined
      ? parseRsvpOffersAccommodation(body.rsvp_offers_accommodation)
      : prevAccom;
  const prevMeal = existing.rsvp_collects_meal === 1;
  const nextMeal =
    body.rsvp_collects_meal !== undefined
      ? parseRsvpCollectsMeal(body.rsvp_collects_meal)
      : prevMeal;

  const ts = now();
  db.prepare(
    `UPDATE households SET
        label = ?,
        notes = ?,
        rsvp_offers_accommodation = ?,
        rsvp_collects_meal = ?,
        updated_at = ?
       WHERE id = ? AND couple_id = ?`,
  ).run(label, notes, nextAccom ? 1 : 0, nextMeal ? 1 : 0, ts, id, couple.id);

  // setHouseholdGroupTag also propagates to member guests, so we only call it
  // when the group_tag actually changes — keeps audit + updated_at noise down.
  if (nextGroupTag !== existing.group_tag) {
    setHouseholdGroupTag(id, couple.id, nextGroupTag);
  }

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.update",
    target_kind: "household",
    target_id: id,
    before: { label: existing.label, notes: existing.notes, group_tag: existing.group_tag },
    after: { label, notes, group_tag: nextGroupTag },
  });
  // Per-field audit entries for the RSVP toggles — only when the value
  // actually changed. Keeps the activity feed quiet for unrelated PATCHes
  // (e.g. a label rename) and mirrors how the couple-level versions log.
  if (nextAccom !== prevAccom) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "household.rsvp_offers_accommodation_update",
      target_kind: "household",
      target_id: id,
      before: { rsvp_offers_accommodation: prevAccom },
      after: { rsvp_offers_accommodation: nextAccom },
    });
  }
  if (nextMeal !== prevMeal) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "household.rsvp_collects_meal_update",
      target_kind: "household",
      target_id: id,
      before: { rsvp_collects_meal: prevMeal },
      after: { rsvp_collects_meal: nextMeal },
    });
  }
  return json({ household: viewOf({ id }, couple) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getHouseholdById(id, couple.id);
  if (!existing) throw new HttpError(404, "Household not found");

  const members = listMembers(id);
  if (members.length > 0) {
    throw new HttpError(409, "Move the members to another household before deleting");
  }

  db.prepare("DELETE FROM households WHERE id = ? AND couple_id = ?").run(id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.delete",
    target_kind: "household",
    target_id: id,
    before: { label: existing.label, code: existing.code },
  });
  return json({ ok: true });
}

function handleRegenCode(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getHouseholdById(id, couple.id);
  if (!existing) throw new HttpError(404, "Household not found");

  const newCode = regenerateHouseholdCode(id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.regen_code",
    target_kind: "household",
    target_id: id,
    before: { code: existing.code },
    after: { code: newCode },
  });
  return json({ household: viewOf({ id }, couple) });
}

/** PATCH /api/households/:id/rotate-code — same effect as the legacy POST
 *  /regenerate-code route, but per-couple rate-limited and routed through the
 *  Phase 3 share-with-guests surface in /app/guest-page. We rate-limit by
 *  couple (not IP) so a couple sharing an office WiFi can't accidentally lock
 *  themselves out of rotating their own codes. Capacity 10 with a 1/min
 *  refill is generous for the real workflow (rotate per household ~ once)
 *  while still catching an automated abuser. */
const ROTATE_BUCKET = { capacity: 10, refillRate: 1 / 60 } as const;

function handleRotateCode(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  // Couple-scoped bucket — every rotate-code attempt by anyone tied to this
  // couple workspace pulls from the same pool. Keeps a misbehaving script
  // from hammering the endpoint while still letting two co-planners on the
  // same IP rotate their respective households without contention.
  rateLimit(`couple:${couple.id}`, "household:rotate_code", ROTATE_BUCKET);

  const existing = getHouseholdById(id, couple.id);
  if (!existing) throw new HttpError(404, "Household not found");

  const newCode = regenerateHouseholdCode(id, couple.id);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.code_rotate",
    target_kind: "household",
    target_id: id,
    before: { code: existing.code },
    after: { code: newCode },
  });
  // Slim payload (id + code only) — the frontend share UI just needs the
  // fresh code to refresh its row. Avoid round-tripping the full household
  // view so we don't drag the (potentially heavy) member list along.
  return json({ household: { id, code: newCode } });
}

interface InviteBatchBody {
  /** Households to target. Omitted / empty = every eligible household in the
   *  workspace (the "send to everyone who hasn't been invited" path). */
  household_ids?: unknown;
  /** Re-send to households already stamped `invited_at`. Default false — the
   *  whole point of the feature is to never invite a household twice, so a
   *  re-send is an explicit opt-in (e.g. address corrected). */
  resend?: unknown;
}

type InviteOutcome = "sent" | "failed" | "skipped_already_invited" | "skipped_no_email";

/** Mass invite send — one email per household to its contact address, carrying
 *  the shared check-in link. The dedup guard lives here: a household whose
 *  `invited_at` is already set is skipped unless `resend` is true, and a
 *  household with no member email is reported (never silently dropped). A
 *  failed send leaves `invited_at` null so the next run retries it. */
async function handleInviteBatch(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  rateLimit(`couple:${couple.id}`, "household:invite_batch", INVITE_BATCH_BUCKET);

  if (!couple.slug) {
    throw new HttpError(400, "Set up your wedding slug before sending invites");
  }

  const body = await readJson<InviteBatchBody>(ctx.req);
  const resend = body.resend === true;
  let candidates: ReturnType<typeof getHouseholdById>[];
  if (Array.isArray(body.household_ids)) {
    if (body.household_ids.length > 1000) throw new HttpError(400, "Too many households");
    const ids = body.household_ids.filter((v): v is number => typeof v === "number");
    candidates = ids.map((id) => getHouseholdById(id, couple.id));
  } else {
    candidates = listHouseholdsByCouple(couple.id);
  }

  const ts = now();
  const results: Array<{
    household_id: number;
    label: string;
    status: InviteOutcome;
    email: string | null;
  }> = [];
  let sent = 0;
  let failed = 0;
  let skippedAlready = 0;
  let skippedNoEmail = 0;

  for (const hh of candidates) {
    if (!hh) continue;
    // Suppliers (booked vendors) and the hosts' own household are never RSVP
    // invitees — skip them silently rather than reporting them as "no email".
    if (hh.is_supplier_household === 1) continue;
    const members = listMembers(hh.id);
    if (members.some((m) => m.partner_role !== null && m.partner_role !== undefined)) continue;

    const contact = householdContactMember(members);
    if (!contact || !contact.email) {
      skippedNoEmail++;
      results.push({
        household_id: hh.id,
        label: hh.label,
        status: "skipped_no_email",
        email: null,
      });
      continue;
    }
    if (hh.invited_at !== null && !resend) {
      skippedAlready++;
      results.push({
        household_id: hh.id,
        label: hh.label,
        status: "skipped_already_invited",
        email: contact.email,
      });
      continue;
    }

    const rsvpUrl = `${CONFIG.frontendBaseUrl}/rsvp?couple=${couple.slug}&code=${hh.code}`;
    const res = await sendKind(
      "guest_invite",
      {
        coupleDisplayName: couple.display_name,
        guestName: contact.full_name,
        weddingDate: couple.wedding_date,
        rsvpUrl,
      },
      {
        user: null,
        guest: { email: contact.email, full_name: contact.full_name },
        couple_id: couple.id,
        submitterUserId: userId,
      },
    );

    if (res.status === "failed") {
      // A real send failure stays uninvited so the next batch retries it (the
      // "never 0x" half of the guarantee). Every other outcome — "sent", or
      // "skipped_no_provider" in a billing-less dev/test env — counts as
      // dispatched and gets stamped so we never double-send.
      failed++;
      results.push({
        household_id: hh.id,
        label: hh.label,
        status: "failed",
        email: contact.email,
      });
    } else {
      markHouseholdInvited(hh.id, couple.id, ts);
      sent++;
      results.push({ household_id: hh.id, label: hh.label, status: "sent", email: contact.email });
    }
  }

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.invite_batch",
    target_kind: "household",
    target_id: results[0]?.household_id ?? 0,
    after: {
      sent,
      failed,
      skipped_already_invited: skippedAlready,
      skipped_no_email: skippedNoEmail,
    },
  });

  return json({
    sent,
    failed,
    skipped_already_invited: skippedAlready,
    skipped_no_email: skippedNoEmail,
    results,
  });
}

export function registerHouseholdRoutes(router: Router) {
  router.get("/api/households", handleList, true);
  router.post("/api/households", handleCreate, true);
  router.post("/api/households/invite-batch", handleInviteBatch, true);
  // Literal route registered before the `:id` PATCH so it isn't matched as id="reorder".
  router.patch("/api/households/reorder", handleReorder, true);
  router.patch("/api/households/:id", handleUpdate, true);
  router.delete("/api/households/:id", handleDelete, true);
  router.post("/api/households/:id/regenerate-code", handleRegenCode, true);
  router.patch("/api/households/:id/rotate-code", handleRotateCode, true);
}
