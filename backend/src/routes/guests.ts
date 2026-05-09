// Guest list CRUD + CSV import. All endpoints couple-scoped.

import type { Guest, GuestGroupTag, MealChoice, RsvpStatus } from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../lib/couples";
import { indexHeaders, parseCsv } from "../lib/csv";
import {
  type GuestRow,
  getGuestByIdScoped,
  isGuestGroupTag,
  isMealChoice,
  isRsvpStatus,
  listGuestsByCouple,
  toGuest,
  uniqueInviteCode,
} from "../lib/guests";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface UpsertBody {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  group_tag?: unknown;
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  plus_one_name?: unknown;
  plus_one_meal?: unknown;
  accommodation_needed?: unknown;
  song_request?: unknown;
  notes?: unknown;
}

interface ParsedGuest {
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: GuestGroupTag;
  rsvp_status: RsvpStatus;
  meal_choice: MealChoice | null;
  dietary: string | null;
  plus_one_name: string | null;
  plus_one_meal: MealChoice | null;
  accommodation_needed: number;
  song_request: string | null;
  notes: string | null;
}

function parseStr(raw: unknown, max = 500): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new HttpError(400, `Field longer than ${max} chars`);
  return trimmed;
}

function parseGroupTag(raw: unknown): GuestGroupTag {
  if (typeof raw === "string" && isGuestGroupTag(raw)) return raw;
  return "other";
}

function parseRsvp(raw: unknown): RsvpStatus {
  if (typeof raw === "string" && isRsvpStatus(raw)) return raw;
  return "pending";
}

function parseMeal(raw: unknown): MealChoice | null {
  if (typeof raw !== "string") return null;
  return isMealChoice(raw) ? raw : null;
}

function parseUpsert(body: UpsertBody, requireName = true): ParsedGuest {
  const fullName = parseStr(body.full_name, 200);
  if (requireName && !fullName) throw new HttpError(400, "full_name required");

  return {
    full_name: fullName ?? "",
    email: parseStr(body.email, 320),
    phone: parseStr(body.phone, 64),
    group_tag: parseGroupTag(body.group_tag),
    rsvp_status: parseRsvp(body.rsvp_status),
    meal_choice: parseMeal(body.meal_choice),
    dietary: parseStr(body.dietary, 500),
    plus_one_name: parseStr(body.plus_one_name, 200),
    plus_one_meal: parseMeal(body.plus_one_meal),
    accommodation_needed: body.accommodation_needed ? 1 : 0,
    song_request: parseStr(body.song_request, 500),
    notes: parseStr(body.notes, 2000),
  };
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ guests: listGuestsByCouple(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<UpsertBody>(ctx.req);
  const parsed = parseUpsert(body);
  const ts = now();
  const code = uniqueInviteCode();

  const result = db
    .prepare(
      `INSERT INTO guests
        (couple_id, full_name, email, phone, group_tag, invite_code, rsvp_status,
         meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
         song_request, notes, rsvp_responded_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(
      couple.id,
      parsed.full_name,
      parsed.email,
      parsed.phone,
      parsed.group_tag,
      code,
      parsed.rsvp_status,
      parsed.meal_choice,
      parsed.dietary,
      parsed.plus_one_name,
      parsed.plus_one_meal,
      parsed.accommodation_needed,
      parsed.song_request,
      parsed.notes,
      ts,
      ts,
    );

  const guestId = Number(result.lastInsertRowid);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.create",
    target_kind: "guest",
    target_id: guestId,
    after: { full_name: parsed.full_name, group_tag: parsed.group_tag },
  });

  const row = getGuestByIdScoped(guestId, couple.id) as GuestRow;
  return json({ guest: toGuest(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getGuestByIdScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Guest not found");

  const body = await readJson<UpsertBody>(ctx.req);
  const parsed = parseUpsert(body);
  const ts = now();

  db.prepare(
    `UPDATE guests SET
        full_name = ?, email = ?, phone = ?, group_tag = ?, rsvp_status = ?,
        meal_choice = ?, dietary = ?, plus_one_name = ?, plus_one_meal = ?,
        accommodation_needed = ?, song_request = ?, notes = ?, updated_at = ?
       WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.full_name,
    parsed.email,
    parsed.phone,
    parsed.group_tag,
    parsed.rsvp_status,
    parsed.meal_choice,
    parsed.dietary,
    parsed.plus_one_name,
    parsed.plus_one_meal,
    parsed.accommodation_needed,
    parsed.song_request,
    parsed.notes,
    ts,
    id,
    couple.id,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.update",
    target_kind: "guest",
    target_id: id,
    before: { full_name: existing.full_name },
    after: { full_name: parsed.full_name },
  });

  const row = getGuestByIdScoped(id, couple.id) as GuestRow;
  return json({ guest: toGuest(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
  const existing = getGuestByIdScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Guest not found");

  db.prepare("DELETE FROM guests WHERE id = ? AND couple_id = ?").run(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.delete",
    target_kind: "guest",
    target_id: id,
    before: { full_name: existing.full_name },
  });
  return json({ ok: true });
}

interface ImportBody {
  csv?: unknown;
}

const CSV_FIELDS = [
  "full_name",
  "email",
  "phone",
  "group_tag",
  "plus_one_name",
  "dietary",
  "notes",
];

async function handleImportCsv(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<ImportBody>(ctx.req);
  if (typeof body.csv !== "string") throw new HttpError(400, "csv string required");
  if (body.csv.length > 1_000_000) throw new HttpError(400, "CSV too large (max 1MB)");

  const rows = parseCsv(body.csv);
  if (rows.length < 2) throw new HttpError(400, "CSV needs a header row + at least one data row");
  const headerRow = rows[0]!;
  const idx = indexHeaders(headerRow, CSV_FIELDS);
  if (!("full_name" in idx)) {
    throw new HttpError(400, "CSV must have a 'full_name' column");
  }

  const ts = now();
  const insert = db.prepare(
    `INSERT INTO guests
      (couple_id, full_name, email, phone, group_tag, invite_code, rsvp_status,
       meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
       song_request, notes, rsvp_responded_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, 0, NULL, ?, NULL, ?, ?)`,
  );

  const created: Guest[] = [];
  const errors: { row: number; reason: string }[] = [];
  // Wrap in a transaction so a single bad row doesn't leave a partial import.
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]!;
      const name = r[idx.full_name!]?.trim() ?? "";
      if (!name) {
        errors.push({ row: i + 1, reason: "missing full_name" });
        continue;
      }
      const groupRaw = idx.group_tag !== undefined ? (r[idx.group_tag]?.trim() ?? "") : "";
      const group: GuestGroupTag = isGuestGroupTag(groupRaw) ? groupRaw : "other";
      const code = uniqueInviteCode();
      const result = insert.run(
        couple.id,
        name,
        idx.email !== undefined ? r[idx.email]?.trim() || null : null,
        idx.phone !== undefined ? r[idx.phone]?.trim() || null : null,
        group,
        code,
        idx.dietary !== undefined ? r[idx.dietary]?.trim() || null : null,
        idx.plus_one_name !== undefined ? r[idx.plus_one_name]?.trim() || null : null,
        idx.notes !== undefined ? r[idx.notes]?.trim() || null : null,
        ts,
        ts,
      );
      const guestId = Number(result.lastInsertRowid);
      const row = getGuestByIdScoped(guestId, couple.id);
      if (row) created.push(toGuest(row));
    }
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.csv_import",
    target_kind: "couple",
    target_id: couple.id,
    after: { count: created.length, errors: errors.length },
  });

  return json({ created_count: created.length, errors }, { status: 201 });
}

export function registerGuestRoutes(router: Router) {
  router.get("/api/guests", handleList, true);
  router.post("/api/guests", handleCreate, true);
  router.patch("/api/guests/:id", handleUpdate, true);
  router.delete("/api/guests/:id", handleDelete, true);
  router.post("/api/guests/import", handleImportCsv, true);
}
