// Household admin routes. Each one is couple-scoped — the couple owns its
// households and member assignments. The 4-digit `code` regenerator is here
// rather than the generic update so the audit trail records intent
// ("rotated for security" vs "renamed label").

import type { GuestGroupTag, Household } from "@shared/types";
import { db, now } from "../db";
import { type CoupleRow, getCoupleForUser } from "../domain/couples";
import { isGuestGroupTag } from "../domain/guests";
import {
  createHousehold,
  getHouseholdById,
  listHouseholdsByCouple,
  listMembers,
  regenerateHouseholdCode,
  setHouseholdGroupTag,
  toHousehold,
} from "../domain/households";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

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

export function registerHouseholdRoutes(router: Router) {
  router.get("/api/households", handleList, true);
  router.post("/api/households", handleCreate, true);
  router.patch("/api/households/:id", handleUpdate, true);
  router.delete("/api/households/:id", handleDelete, true);
  router.post("/api/households/:id/regenerate-code", handleRegenCode, true);
}
