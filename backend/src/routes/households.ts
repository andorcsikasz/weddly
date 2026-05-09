// Household admin routes. Each one is couple-scoped — the couple owns its
// households and member assignments. The 4-digit `code` regenerator is here
// rather than the generic update so the audit trail records intent
// ("rotated for security" vs "renamed label").

import type { Household } from "@shared/types";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import {
  createHousehold,
  getHouseholdById,
  listHouseholdsByCouple,
  listMembers,
  regenerateHouseholdCode,
  toHousehold,
} from "../domain/households";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

function viewOf(row: { id: number }, coupleId: number): Household {
  const hh = getHouseholdById(row.id, coupleId);
  if (!hh) throw new HttpError(404, "Household not found");
  return toHousehold(hh, listMembers(hh.id));
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const rows = listHouseholdsByCouple(couple.id);
  const items: Household[] = rows.map((r) => toHousehold(r, listMembers(r.id)));
  return json({ households: items });
}

interface UpsertBody {
  label?: unknown;
  notes?: unknown;
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

  const row = createHousehold({ couple_id: couple.id, label, notes });
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.create",
    target_kind: "household",
    target_id: row.id,
    after: { label, code: row.code },
  });
  return json({ household: viewOf(row, couple.id) }, { status: 201 });
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

  const ts = now();
  db.prepare(
    "UPDATE households SET label = ?, notes = ?, updated_at = ? WHERE id = ? AND couple_id = ?",
  ).run(label, notes, ts, id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "household.update",
    target_kind: "household",
    target_id: id,
    before: { label: existing.label, notes: existing.notes },
    after: { label, notes },
  });
  return json({ household: viewOf({ id }, couple.id) });
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
  return json({ household: viewOf({ id }, couple.id) });
}

export function registerHouseholdRoutes(router: Router) {
  router.get("/api/households", handleList, true);
  router.post("/api/households", handleCreate, true);
  router.patch("/api/households/:id", handleUpdate, true);
  router.delete("/api/households/:id", handleDelete, true);
  router.post("/api/households/:id/regenerate-code", handleRegenCode, true);
}
