// Guest list CRUD + CSV import. All endpoints couple-scoped.

import type {
  DietarySummary,
  Guest,
  GuestGroupTag,
  GuestKind,
  MealChoice,
  RsvpStatus,
} from "@shared/types";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { recordExport } from "../domain/exports";
import { indexHeaders, parseCsv } from "../lib/csv";
import {
  type GuestRow,
  getGuestByIdScoped,
  isGuestGroupTag,
  isGuestKind,
  isMealChoice,
  isRsvpStatus,
  listGuestsByCouple,
  toGuest,
  uniqueInviteCode,
} from "../domain/guests";
import { createHousehold, getHouseholdById } from "../domain/households";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, readJson, requireVerifiedAuth, type Router } from "../lib/http";

interface UpsertBody {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  group_tag?: unknown;
  kind?: unknown;
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  plus_one_name?: unknown;
  plus_one_meal?: unknown;
  accommodation_needed?: unknown;
  song_request?: unknown;
  notes?: unknown;
  /** Boolean — `true` marks the guest as invited at the current timestamp;
   *  `false` clears it. Omitted = leave invited_at as-is. */
  invited?: unknown;
  /** Boolean — `true` stamps invitation_delivered_at to now (and ensures
   *  invited_at is also set, since delivered implies invited); `false` clears
   *  only the delivered timestamp. Omitted = leave as-is. */
  delivered?: unknown;
  /** Household this guest belongs to. If omitted on create, the server
   *  spawns a household-of-one with the guest's name as its label. */
  household_id?: unknown;
  /** Used together with `household_id === null` to create a brand-new
   *  household and put this guest in it (e.g. "Kovács family"). */
  new_household_label?: unknown;
}

interface ParsedGuest {
  full_name: string;
  email: string | null;
  phone: string | null;
  group_tag: GuestGroupTag;
  kind: GuestKind;
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

function parseKind(raw: unknown): GuestKind {
  if (typeof raw === "string" && isGuestKind(raw)) return raw;
  return "adult";
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
    kind: parseKind(body.kind),
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
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Optional search + pagination. Frontend can opt in incrementally — when
  // none of these are provided, the response is identical to v1 (full list).
  const q = (ctx.url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limitRaw = ctx.url.searchParams.get("limit");
  const offsetRaw = ctx.url.searchParams.get("offset");
  const limit =
    limitRaw === null || limitRaw === "" ? null : Math.max(1, Math.min(1000, Number(limitRaw)));
  const offset = offsetRaw === null || offsetRaw === "" ? 0 : Math.max(0, Number(offsetRaw));
  if (limit !== null && !Number.isFinite(limit)) throw new HttpError(400, "limit invalid");
  if (!Number.isFinite(offset)) throw new HttpError(400, "offset invalid");

  let all = listGuestsByCouple(couple.id);
  if (q) {
    all = all.filter((g) => {
      const name = g.full_name.toLowerCase();
      const email = (g.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }
  const total = all.length;
  let guests = all;
  if (limit !== null || offset > 0) {
    guests = all.slice(offset, limit === null ? undefined : offset + limit);
  }
  if (q || limit !== null || offset > 0) {
    return json({ guests, total });
  }
  return json({ guests });
}

function resolveHouseholdForCreate(body: UpsertBody, coupleId: number, guestName: string): number {
  if (typeof body.household_id === "number" && Number.isFinite(body.household_id)) {
    const hh = getHouseholdById(body.household_id, coupleId);
    if (!hh) throw new HttpError(400, "household_id not found in this couple");
    return hh.id;
  }
  // Either an explicit "new household with label X" intent, or implicit
  // household-of-one named after the guest.
  const labelRaw =
    typeof body.new_household_label === "string" ? body.new_household_label.trim() : "";
  const label = labelRaw || guestName;
  const created = createHousehold({ couple_id: coupleId, label });
  return created.id;
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<UpsertBody>(ctx.req);
  const parsed = parseUpsert(body);
  const ts = now();
  const code = uniqueInviteCode();
  const householdId = resolveHouseholdForCreate(body, couple.id, parsed.full_name);

  // `invited` / `delivered` are optional — when truthy, the create call stamps
  // both timestamps at `ts`. `delivered=true` implies `invited=true` (you
  // can't physically hand over an invitation that was never marked invited).
  const deliveredAt = body.delivered === true ? ts : null;
  const invitedAt = body.invited === true || deliveredAt !== null ? ts : null;
  const result = db
    .prepare(
      `INSERT INTO guests
        (couple_id, full_name, email, phone, group_tag, invite_code, kind, rsvp_status,
         meal_choice, dietary, plus_one_name, plus_one_meal, accommodation_needed,
         song_request, notes, rsvp_responded_at, invited_at, invitation_delivered_at,
         created_at, updated_at, household_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(
      couple.id,
      parsed.full_name,
      parsed.email,
      parsed.phone,
      parsed.group_tag,
      code,
      parsed.kind,
      parsed.rsvp_status,
      parsed.meal_choice,
      parsed.dietary,
      parsed.plus_one_name,
      parsed.plus_one_meal,
      parsed.accommodation_needed,
      parsed.song_request,
      parsed.notes,
      invitedAt,
      deliveredAt,
      ts,
      ts,
      householdId,
    );

  const guestId = Number(result.lastInsertRowid);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.create",
    target_kind: "guest",
    target_id: guestId,
    after: { full_name: parsed.full_name, group_tag: parsed.group_tag, household_id: householdId },
  });

  const row = getGuestByIdScoped(guestId, couple.id) as GuestRow;
  return json({ guest: toGuest(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getGuestByIdScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Guest not found");

  const body = await readJson<UpsertBody>(ctx.req);
  const parsed = parseUpsert(body);
  const ts = now();

  // Optional household reassignment. `household_id` may be: omitted (no change),
  // a number (move to that household), or paired with `new_household_label` to
  // spawn a new household for this guest.
  let nextHouseholdId = existing.household_id;
  if (typeof body.household_id === "number" && Number.isFinite(body.household_id)) {
    const target = getHouseholdById(body.household_id, couple.id);
    if (!target) throw new HttpError(400, "household_id not found in this couple");
    nextHouseholdId = target.id;
  } else if (
    body.household_id === null &&
    typeof body.new_household_label === "string" &&
    body.new_household_label.trim()
  ) {
    const created = createHousehold({
      couple_id: couple.id,
      label: body.new_household_label.trim(),
    });
    nextHouseholdId = created.id;
  }

  // Tri-state `invited` + `delivered`: omitted = leave as-is; true = stamp;
  // false = clear. The 3-state chip on /app/guests sends explicit pairs that
  // encode the target state: not-invited (invited:false, delivered:false),
  // invited (invited:true, delivered:false), delivered (delivered:true, which
  // also forces invited=true since delivered implies invited).
  let nextInvitedAt = existing.invited_at;
  if (body.invited === true) nextInvitedAt = ts;
  else if (body.invited === false) nextInvitedAt = null;

  let nextDeliveredAt = existing.invitation_delivered_at;
  if (body.delivered === true) {
    nextDeliveredAt = ts;
    // delivered implies invited — backfill if the client somehow omitted it.
    if (nextInvitedAt === null) nextInvitedAt = ts;
  } else if (body.delivered === false) {
    nextDeliveredAt = null;
  }
  // Clearing `invited` always clears `delivered` (you can't deliver to
  // someone you haven't invited).
  if (nextInvitedAt === null) nextDeliveredAt = null;

  db.prepare(
    `UPDATE guests SET
        full_name = ?, email = ?, phone = ?, group_tag = ?, kind = ?, rsvp_status = ?,
        meal_choice = ?, dietary = ?, plus_one_name = ?, plus_one_meal = ?,
        accommodation_needed = ?, song_request = ?, notes = ?, household_id = ?,
        invited_at = ?, invitation_delivered_at = ?, updated_at = ?
       WHERE id = ? AND couple_id = ?`,
  ).run(
    parsed.full_name,
    parsed.email,
    parsed.phone,
    parsed.group_tag,
    parsed.kind,
    parsed.rsvp_status,
    parsed.meal_choice,
    parsed.dietary,
    parsed.plus_one_name,
    parsed.plus_one_meal,
    parsed.accommodation_needed,
    parsed.song_request,
    parsed.notes,
    nextHouseholdId,
    nextInvitedAt,
    nextDeliveredAt,
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
    before: { full_name: existing.full_name, household_id: existing.household_id },
    after: { full_name: parsed.full_name, household_id: nextHouseholdId },
  });

  const row = getGuestByIdScoped(id, couple.id) as GuestRow;
  return json({ guest: toGuest(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
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
  "household",
  "plus_one_name",
  "dietary",
  "notes",
];

async function handleImportCsv(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
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
       song_request, notes, rsvp_responded_at, created_at, updated_at, household_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL, 0, NULL, ?, NULL, ?, ?, ?)`,
  );

  const created: Guest[] = [];
  const errors: { row: number; reason: string }[] = [];
  // Wrap in a transaction so a single bad row doesn't leave a partial import.
  // Same-named `household` values get folded into the same household so an
  // import can express "Anna + Mark + Lilla all RSVP together" with one column.
  const tx = db.transaction(() => {
    const householdByLabel = new Map<string, number>();
    const ensureHousehold = (label: string): number => {
      const cached = householdByLabel.get(label);
      if (cached) return cached;
      const created = createHousehold({ couple_id: couple.id, label });
      householdByLabel.set(label, created.id);
      return created.id;
    };

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
      const householdLabel = idx.household !== undefined ? (r[idx.household]?.trim() ?? "") : "";
      const householdId = ensureHousehold(householdLabel || name);
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
        householdId,
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

function csvField(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface CsvGuestRow extends GuestRow {
  household_label: string | null;
}

function handleExportCsv(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Pull rows unsorted and re-order in JS with a Hungarian locale comparator.
  // SQLite's NOCASE collation handles ASCII case only — it shuffles "Ákos"
  // ahead of "Bence" and folds "Csikász" / "Csikasz" inconsistently. The HU
  // collator gets the digraphs (Cs / Sz / Zs) and accented letters right.
  const rowsRaw = db
    .prepare(
      `SELECT g.*, h.label AS household_label
         FROM guests g
         LEFT JOIN households h ON h.id = g.household_id
         WHERE g.couple_id = ?`,
    )
    .all(couple.id) as CsvGuestRow[];
  const rows = [...rowsRaw].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, "hu", { sensitivity: "base" }),
  );

  const headers = [
    "full_name",
    "email",
    "phone",
    "group_tag",
    "kind",
    "household",
    "rsvp_status",
    "meal_choice",
    "dietary",
    "plus_one_name",
    "plus_one_meal",
    "accommodation_needed",
    "song_request",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.full_name),
        csvField(r.email),
        csvField(r.phone),
        csvField(r.group_tag),
        csvField(r.kind),
        csvField(r.household_label),
        csvField(r.rsvp_status),
        csvField(r.meal_choice),
        csvField(r.dietary),
        csvField(r.plus_one_name),
        csvField(r.plus_one_meal),
        r.accommodation_needed ? "1" : "0",
        csvField(r.song_request),
        csvField(r.notes),
      ].join(","),
    );
  }
  // Prepend a UTF-8 BOM so Excel on Windows opens the file as UTF-8 by
  // default — without it, Hungarian accented characters render as mojibake.
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const body = new TextEncoder().encode(csv);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `weddly-guests-${stamp}.csv`;

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "guest.csv_export",
    target_kind: "couple",
    target_id: couple.id,
    after: { count: rows.length },
  });
  recordExport({
    coupleId: couple.id,
    userId,
    kind: "guest_csv",
    format: null,
    filename,
    contentType: "text/csv; charset=utf-8",
    body,
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Day-of catering aggregate. Counts only guests whose `rsvp_status` is
 *  `yes` or `maybe` — `no` / `pending` are intentionally excluded so the
 *  caterer's headcount matches who's actually expected at the table.
 *
 *  Allergies are a heuristic scan of the free-text `dietary` field. We
 *  intentionally undercount in favour of false-negatives (e.g. "Gluten-free"
 *  is the keyword catch, not "GF") because the caterer reads the raw notes
 *  too; the buckets are a quick-look summary, not the source of truth. */
function handleDietarySummary(ctx: Ctx): Response {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  // Scope to attending guests. Pull only the two columns we need.
  const rows = db
    .prepare(
      `SELECT meal_choice, dietary FROM guests
         WHERE couple_id = ? AND rsvp_status IN ('yes','maybe')`,
    )
    .all(couple.id) as { meal_choice: string | null; dietary: string | null }[];

  const summary: DietarySummary = {
    meal: { meat: 0, fish: 0, vegetarian: 0, vegan: 0, child: 0, none: 0, unspecified: 0 },
    allergies: { gluten: 0, lactose: 0, nut: 0, other_text_count: 0 },
    counted_guests: rows.length,
  };

  // Case-insensitive substring tests. Hungarian keywords first (most common
  // in this market), English fallbacks listed in the same regex. We test
  // `g`, `t`, `n` separately so a single note that says "gluten & nut free"
  // bumps both gluten and nut without double-counting other_text_count.
  const RE_GLUTEN = /glut[eé]n|gluten/i;
  const RE_LACTOSE = /tej|laktóz|laktoz|lactose|dairy/i;
  const RE_NUT = /mogyoró|mogyoro|mandula|nut|peanut|földimogyoró|földimogyoro/i;

  for (const row of rows) {
    // Meal bucket — defaults to "unspecified" when null or unrecognised.
    const meal = row.meal_choice;
    if (meal === "meat") summary.meal.meat += 1;
    else if (meal === "fish") summary.meal.fish += 1;
    else if (meal === "vegetarian") summary.meal.vegetarian += 1;
    else if (meal === "vegan") summary.meal.vegan += 1;
    else if (meal === "child") summary.meal.child += 1;
    else if (meal === "none") summary.meal.none += 1;
    else summary.meal.unspecified += 1;

    // Allergy bucket — keyword scan over `dietary` text.
    const text = (row.dietary ?? "").trim();
    if (!text) continue;
    let matchedKeyword = false;
    if (RE_GLUTEN.test(text)) {
      summary.allergies.gluten += 1;
      matchedKeyword = true;
    }
    if (RE_LACTOSE.test(text)) {
      summary.allergies.lactose += 1;
      matchedKeyword = true;
    }
    if (RE_NUT.test(text)) {
      summary.allergies.nut += 1;
      matchedKeyword = true;
    }
    if (!matchedKeyword) summary.allergies.other_text_count += 1;
  }

  return json(summary);
}

export function registerGuestRoutes(router: Router) {
  router.get("/api/guests", handleList, true);
  // Aggregate route comes BEFORE the :id-parameterised routes so the
  // literal path "dietary-summary" doesn't get captured by /api/guests/:id.
  router.get("/api/guests/dietary-summary", handleDietarySummary, true);
  router.post("/api/guests", handleCreate, true);
  router.patch("/api/guests/:id", handleUpdate, true);
  router.delete("/api/guests/:id", handleDelete, true);
  router.post("/api/guests/import", handleImportCsv, true);
  router.get("/api/guests/csv", handleExportCsv, true);
}
