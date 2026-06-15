// Guest photo album routes.
//
// Public (no auth):
//   GET  /api/photo-albums/:token           — album info for the guest upload page
//   POST /api/photo-albums/:token/photos    — guest uploads a photo (multipart)
//
// Authenticated (couple only):
//   POST /api/photo-albums                  — create album (idempotent)
//   GET  /api/photo-albums/current          — get current couple's album + stats
//   PATCH /api/photo-albums/current         — update settings
//   GET  /api/photo-albums/current/photos   — list all uploads

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PhotoAlbum, PhotoAlbumPublic } from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { requireAuth } from "../lib/http";
import { HttpError, json, type Ctx, type Router } from "../lib/http";
import { sniffUploadedImage } from "../lib/image_sniff";
import { rateLimit } from "../lib/rate_limit";

// ─── constants ───────────────────────────────────────────────────────────────

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB

const PHOTO_MIME_EXT: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Public upload bucket: 20-shot burst for table-sitting guests, then ~1 per
// 15 s sustained. Per device_id so one phone can't flood the album.
const UPLOAD_BUCKET = { capacity: 20, refillRate: 1 / 15 };

// ─── DB row types ────────────────────────────────────────────────────────────

interface AlbumRow {
  id: number;
  couple_id: number;
  upload_token: string;
  title: string | null;
  shots_per_guest: number | null;
  is_upload_enabled: number;
  allow_guest_viewing: number;
  reveal_at: number | null;
  created_at: number;
  updated_at: number;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

function toAlbum(row: AlbumRow, photoCount: number): PhotoAlbum {
  return {
    id: row.id,
    uploadToken: row.upload_token,
    title: row.title,
    shotsPerGuest: row.shots_per_guest,
    revealAt: row.reveal_at,
    isUploadEnabled: row.is_upload_enabled === 1,
    allowGuestViewing: row.allow_guest_viewing === 1,
    photoCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function countPhotos(albumId: number): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = ?").get(albumId) as {
    c: number;
  }).c;
}

function generateToken(): string {
  return randomBytes(12).toString("hex"); // 24 hex chars
}

// ─── handlers ────────────────────────────────────────────────────────────────

/** POST /api/photo-albums — create album for current couple (idempotent). */
async function handleCreateAlbum(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  // Idempotent: return existing album if one exists.
  const existing = db
    .prepare("SELECT * FROM photo_albums WHERE couple_id = ?")
    .get(couple.id) as AlbumRow | undefined;
  if (existing) {
    return json({ album: toAlbum(existing, countPhotos(existing.id)) });
  }

  // Derive reveal_at from wedding date (midnight UTC after the wedding day).
  let revealAt: number | null = null;
  if (couple.wedding_date) {
    const weddingMs = new Date(couple.wedding_date).getTime();
    revealAt = weddingMs + 24 * 60 * 60 * 1000; // midnight following day
  }

  const ts = now();
  const token = generateToken();
  const row = db
    .prepare(
      `INSERT INTO photo_albums
         (couple_id, upload_token, title, shots_per_guest, is_upload_enabled,
          allow_guest_viewing, reveal_at, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, 1, 0, ?, ?, ?)
       RETURNING *`,
    )
    .get(couple.id, token, revealAt, ts, ts) as AlbumRow;

  return json({ album: toAlbum(row, 0) }, { status: 201 });
}

/** GET /api/photo-albums/current — current couple's album + stats. */
async function handleGetCurrentAlbum(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db
    .prepare("SELECT * FROM photo_albums WHERE couple_id = ?")
    .get(couple.id) as AlbumRow | undefined;

  return json({ album: row ? toAlbum(row, countPhotos(row.id)) : null });
}

/** PATCH /api/photo-albums/current — update album settings. */
async function handleUpdateAlbum(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db
    .prepare("SELECT * FROM photo_albums WHERE couple_id = ?")
    .get(couple.id) as AlbumRow | undefined;
  if (!row) throw new HttpError(404, "No album found");

  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: string[] = [];
  const params: import("bun:sqlite").SQLQueryBindings[] = [];

  if ("is_upload_enabled" in body) {
    if (typeof body.is_upload_enabled !== "boolean")
      throw new HttpError(400, "is_upload_enabled must be a boolean");
    updates.push("is_upload_enabled = ?");
    params.push(body.is_upload_enabled ? 1 : 0);
  }
  if ("shots_per_guest" in body) {
    const v = body.shots_per_guest;
    if (v !== null) {
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > 500)
        throw new HttpError(400, "shots_per_guest must be a positive integer ≤ 500 or null");
    }
    updates.push("shots_per_guest = ?");
    params.push((v as number | null) ?? null);
  }
  if ("title" in body) {
    if (body.title !== null && (typeof body.title !== "string" || body.title.length > 200))
      throw new HttpError(400, "title must be a string ≤ 200 chars or null");
    updates.push("title = ?");
    params.push(typeof body.title === "string" ? body.title || null : null);
  }

  if (updates.length === 0) throw new HttpError(400, "No fields to update");

  const ts = now();
  updates.push("updated_at = ?");
  params.push(ts, row.id);

  const updated = db
    .prepare(`UPDATE photo_albums SET ${updates.join(", ")} WHERE id = ? RETURNING *`)
    .get(...params) as AlbumRow;

  return json({ album: toAlbum(updated, countPhotos(updated.id)) });
}

/** GET /api/photo-albums/current/photos — list all uploads (couple only). */
async function handleListPhotos(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db
    .prepare("SELECT * FROM photo_albums WHERE couple_id = ?")
    .get(couple.id) as AlbumRow | undefined;
  if (!row) throw new HttpError(404, "No album found");

  const uploads = db
    .prepare(
      `SELECT id, guest_name, file_path AS fileUrl, mime_type AS mimeType,
              file_size AS fileSize, uploaded_at AS uploadedAt
         FROM photo_uploads WHERE album_id = ? ORDER BY id DESC`,
    )
    .all(row.id);

  return json({ uploads, total: uploads.length });
}

// ─── Public handlers (no auth) ────────────────────────────────────────────────

interface AlbumWithCouple extends AlbumRow {
  display_name: string;
  wedding_date: string | null;
}

/** GET /api/photo-albums/:token — album info for the guest upload page. */
async function handleGetPublicAlbum(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp ?? "unknown", "photo:lookup", { capacity: 30, refillRate: 1 });

  const token = ctx.params.token ?? "";
  const row = db
    .prepare(
      `SELECT pa.*, c.display_name, c.wedding_date
         FROM photo_albums pa
         JOIN couples c ON c.id = pa.couple_id
        WHERE pa.upload_token = ?`,
    )
    .get(token) as AlbumWithCouple | undefined;

  if (!row) throw new HttpError(404, "Album not found");

  const album: PhotoAlbumPublic = {
    displayName: row.display_name,
    weddingDate: row.wedding_date,
    title: row.title,
    shotsPerGuest: row.shots_per_guest,
    isUploadEnabled: row.is_upload_enabled === 1,
  };

  return json({ album });
}

/** POST /api/photo-albums/:token/photos — guest uploads a photo. */
async function handleGuestUpload(ctx: Ctx): Promise<Response> {
  const token = ctx.params.token ?? "";

  const row = db
    .prepare(
      `SELECT pa.*, c.id AS couple_id_val
         FROM photo_albums pa
         JOIN couples c ON c.id = pa.couple_id
        WHERE pa.upload_token = ?`,
    )
    .get(token) as (AlbumRow & { couple_id_val: number }) | undefined;

  if (!row) throw new HttpError(404, "Album not found");
  if (!row.is_upload_enabled) throw new HttpError(403, "Uploads are not enabled for this album");

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required");
  });

  const deviceId = form.get("device_id");
  if (typeof deviceId !== "string" || !deviceId.trim())
    throw new HttpError(400, "device_id is required");
  if (deviceId.length > 128) throw new HttpError(400, "device_id too long");

  // Per-device rate limiting — prevents one phone from flooding the album.
  rateLimit(`photo:upload:${deviceId}`, "photo:upload", UPLOAD_BUCKET);

  // Shot limit check.
  if (row.shots_per_guest !== null) {
    const used = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = ? AND device_id = ?",
        )
        .get(row.id, deviceId) as { c: number }
    ).c;
    if (used >= row.shots_per_guest)
      throw new HttpError(429, "Shot limit reached", { code: "shot_limit" });
  }

  const raw = form.get("file");
  if (!(raw instanceof File)) throw new HttpError(400, "`file` field required");
  if (raw.size > MAX_PHOTO_BYTES)
    throw new HttpError(413, `Image too large (max ${MAX_PHOTO_BYTES / 1024 / 1024} MB)`);

  // Magic-byte sniff — reject non-images even if client claims image/jpeg.
  const sniffed = await sniffUploadedImage(raw);
  if (!sniffed) throw new HttpError(400, "Only JPEG, PNG and WebP images are accepted");
  const ext = PHOTO_MIME_EXT[sniffed];

  const guestNameRaw = form.get("guest_name");
  const guestName =
    typeof guestNameRaw === "string" && guestNameRaw.trim()
      ? guestNameRaw.trim().slice(0, 200)
      : null;

  // Write file to disk.
  const ts = now();
  const dir = join(CONFIG.uploadsDir, "couples", String(row.couple_id), "photos", String(row.id));
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  // Use a temporary placeholder id before the DB insert; re-derive after.
  const tmpId = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpPath = join(dir, `${tmpId}.${ext}`);
  await Bun.write(tmpPath, raw);

  // Insert DB row and rename file to use the real id.
  const uploadRow = db
    .prepare(
      `INSERT INTO photo_uploads
         (album_id, device_id, guest_name, file_path, mime_type, file_size, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .get(row.id, deviceId, guestName, "", sniffed, raw.size, ts) as { id: number };

  const finalPath = join(dir, `${uploadRow.id}.${ext}`);
  const publicUrl = `/uploads/couples/${row.couple_id}/photos/${row.id}/${uploadRow.id}.${ext}`;
  await Bun.write(finalPath, Bun.file(tmpPath));

  // Update row with real path, clean up temp file.
  db.prepare("UPDATE photo_uploads SET file_path = ? WHERE id = ?").run(
    publicUrl,
    uploadRow.id,
  );
  try {
    await Bun.file(tmpPath).exists() && Bun.write(tmpPath, "").catch(() => {});
  } catch {
    // Non-fatal if cleanup fails.
  }

  return json({ upload: { id: uploadRow.id, fileUrl: publicUrl } }, { status: 201 });
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerPhotoRoutes(router: Router): void {
  // Authenticated couple endpoints.
  router.post("/api/photo-albums", handleCreateAlbum, true);
  router.get("/api/photo-albums/current", handleGetCurrentAlbum, true);
  router.patch("/api/photo-albums/current", handleUpdateAlbum, true);
  router.get("/api/photo-albums/current/photos", handleListPhotos, true);

  // Public endpoints — no auth required.
  router.get("/api/photo-albums/:token", handleGetPublicAlbum);
  router.post("/api/photo-albums/:token/photos", handleGuestUpload);
}
