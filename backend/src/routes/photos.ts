// Wedding Film routes.
//
// Public (no auth):
//   POST /api/photo-albums/:token/devices        — guest registers device (before any upload)
//   GET  /api/photo-albums/:token               — album info for the guest camera page
//   GET  /api/photo-albums/:token/photos        — reveal-locked photo list
//   POST /api/photo-albums/:token/photos        — guest uploads a photo (multipart)
//   GET  /api/photo-albums/:token/qr            — printable QR code (PNG, ?format=svg for vector)
//
// Authenticated (couple only):
//   GET  /api/photo-albums/film-access          — pricing eligibility check
//   POST /api/photo-albums                      — create album (idempotent)
//   GET  /api/photo-albums/current              — get current couple's album + stats
//   PATCH /api/photo-albums/current             — update settings
//   GET  /api/photo-albums/current/photos       — all uploads (host bypasses reveal lock)
//   GET  /api/photo-albums/current/devices      — participant list

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import QRCode from "qrcode";
import type {
  FilmAccessCheck,
  FilmAesthetic,
  FilmDevice,
  FilmStripeTier,
  PhotoAlbum,
  PhotoAlbumPublic,
} from "@shared/types";
import { FILM_AESTHETICS, FILM_TIER_CAPS, FILM_TIER_PRICE_EUR_CENTS } from "@shared/types";
import { CONFIG } from "../config";
import { storage } from "../lib/storage";
import { addAuditLog } from "../lib/audit";
import { db, now } from "../db";
import { stripe } from "../domain/billing";
import { paymentProductAvailable, requirePaymentLaunch } from "../domain/payment_launch";
import { activateFilmAlbum } from "../domain/film";
import { validateFilmSlug } from "../domain/film_slug";
import { getCoupleForUser } from "../domain/couples";
import { HttpError, json, requireAuth, type Ctx, type Router } from "../lib/http";
import { type SniffedImageMime, sniffUploadedImage } from "../lib/image_sniff";
import { rateLimit } from "../lib/rate_limit";

// ─── constants ───────────────────────────────────────────────────────────────

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const FIVE_MONTHS_MS = 5 * 30 * 24 * 60 * 60 * 1000;

/** Keyed by `SniffedImageMime` rather than by `string`, so the lookup is TOTAL:
 *  under `noUncheckedIndexedAccess` a `Record<string, …>` reads back as
 *  possibly-undefined, and the old key was built by template literal, which
 *  accepts that silently and would have written a file named `<id>.undefined`.
 *  The sniffer already returns exactly these three, so nothing changes at
 *  runtime; it just stops the type from allowing a case that cannot happen. */
const PHOTO_MIME_EXT: Record<SniffedImageMime, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const UPLOAD_BUCKET = { capacity: 20, refillRate: 1 / 15 };

// ─── DB row types ────────────────────────────────────────────────────────────

interface AlbumRow {
  id: number;
  couple_id: number;
  upload_token: string;
  slug: string | null;
  title: string | null;
  shots_per_guest: number | null;
  is_upload_enabled: number;
  allow_guest_viewing: number;
  reveal_at: number | null;
  event_ends_at: number | null;
  film_aesthetic: string;
  cover_image_url: string | null;
  guest_cap: number;
  stripe_payment_id: string | null;
  stripe_tier: string | null;
  paid_at: number | null;
  created_at: number;
  updated_at: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function safeAesthetic(raw: string | null): FilmAesthetic {
  return FILM_AESTHETICS.includes(raw as FilmAesthetic) ? (raw as FilmAesthetic) : "natural";
}

function countPhotos(albumId: number): number {
  // Hidden (purged) uploads (#6) are excluded from every visible count.
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = ? AND hidden_at IS NULL")
      .get(albumId) as {
      c: number;
    }
  ).c;
}

function countParticipants(albumId: number): number {
  // Soft-removed devices (#6) no longer count toward the participant total/cap.
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM film_devices WHERE album_id = ? AND removed_at IS NULL")
      .get(albumId) as {
      c: number;
    }
  ).c;
}

function generateToken(): string {
  return randomBytes(12).toString("hex");
}

/** The object key for one uploaded photo. The trailing random segment is the
 *  point: without it the key was `couples/<coupleId>/photos/<albumId>/<uploadId>`
 *  from three sequential integers, so anyone could walk `/uploads/couples/3/
 *  photos/5/1.jpg`, `2.jpg`, … and read a stranger's wedding album straight off
 *  the static handler.
 *
 *  That mattered more here than the guessable key usually does, because the
 *  album API around it is careful: the guest routes are gated on an unguessable
 *  `upload_token` and the photo list is REVEAL-LOCKED, so a couple can keep the
 *  guests' shots hidden until they choose. Walking the ids skipped both.
 *
 *  These stay public-by-URL rather than moving behind a gated route (the way
 *  the budget documents and the waitlist price list did), because a wedding
 *  album is meant to be opened by guests with no account, on a link, and 128
 *  bits in the path is what makes that link a credential instead of a guess.
 *  Existing rows keep their stored `file_path` and go on resolving; this only
 *  changes what NEW uploads are addressed by. */
function photoObjectKey(coupleId: number, albumId: number, uploadId: number, ext: string): string {
  return `couples/${coupleId}/photos/${albumId}/${uploadId}-${randomBytes(16).toString("hex")}.${ext}`;
}

// ─── mappers ─────────────────────────────────────────────────────────────────

function toAlbum(row: AlbumRow): PhotoAlbum {
  return {
    id: row.id,
    uploadToken: row.upload_token,
    slug: row.slug,
    title: row.title,
    shotsPerGuest: row.shots_per_guest,
    revealAt: row.reveal_at,
    eventEndsAt: row.event_ends_at,
    isUploadEnabled: row.is_upload_enabled === 1,
    allowGuestViewing: row.allow_guest_viewing === 1,
    filmAesthetic: safeAesthetic(row.film_aesthetic),
    coverImageUrl: row.cover_image_url,
    guestCap: row.guest_cap ?? 15,
    stripeTier: (row.stripe_tier as FilmStripeTier | null) ?? null,
    paidAt: row.paid_at,
    photoCount: countPhotos(row.id),
    participantCount: countParticipants(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── pricing helpers ──────────────────────────────────────────────────────────

function checkFilmAccess(coupleId: number, coupleCreatedAt: number): FilmAccessCheck {
  const memberCount = (
    db.prepare("SELECT COUNT(*) AS c FROM couple_members WHERE couple_id = ?").get(coupleId) as {
      c: number;
    }
  ).c;
  const ageMs = now() - coupleCreatedAt;
  const isLoyalCouple = ageMs >= FIVE_MONTHS_MS && memberCount >= 2;

  if (isLoyalCouple) {
    return {
      free: true,
      reason: "loyal_couple",
      priceEurCents: 0,
      checkoutEnabled: false,
    };
  }
  return {
    free: false,
    reason: null,
    priceEurCents: FILM_TIER_PRICE_EUR_CENTS.ten,
    checkoutEnabled: paymentProductAvailable("film_checkout"),
  };
}

// ─── authenticated handlers ───────────────────────────────────────────────────

/** POST /api/photo-albums/checkout — Stripe Checkout for the €9.90 film unlock. */
async function handleFilmCheckout(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  requirePaymentLaunch("film_checkout");
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const access = checkFilmAccess(couple.id, couple.created_at);
  if (access.free) throw new HttpError(400, "Film is already free for this couple");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (!row) throw new HttpError(404, "Create the film first");
  if (row.paid_at !== null) throw new HttpError(400, "Film already activated");

  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            unit_amount: FILM_TIER_PRICE_EUR_CENTS.ten,
            product_data: { name: "Wedding Film — Guest Camera" },
          },
          quantity: 1,
        },
      ],
      metadata: {
        type: "film",
        album_id: String(row.id),
        couple_id: String(couple.id),
      },
      success_url: `${CONFIG.frontendBaseUrl}/app/media?film=activated`,
      cancel_url: `${CONFIG.frontendBaseUrl}/app/media`,
    },
    { idempotencyKey: `film-checkout-${row.id}-unpaid` },
  );

  return json({ url: session.url });
}

/** GET /api/photo-albums/film-access — pricing eligibility for the current couple. */
async function handleFilmAccess(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");
  return json({ access: checkFilmAccess(couple.id, couple.created_at) });
}

/** POST /api/photo-albums — create album (idempotent). */
async function handleCreateAlbum(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const existing = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (existing) {
    return json({ album: toAlbum(existing) });
  }

  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;

  // Validate aesthetic.
  const aesthetic = body.film_aesthetic ?? "natural";
  if (typeof aesthetic !== "string" || !FILM_AESTHETICS.includes(aesthetic as FilmAesthetic))
    throw new HttpError(400, "Invalid film_aesthetic");

  // Validate event_ends_at.
  const eventEndsAt = body.event_ends_at ?? null;
  if (eventEndsAt !== null && (typeof eventEndsAt !== "number" || !Number.isFinite(eventEndsAt)))
    throw new HttpError(400, "event_ends_at must be a unix ms timestamp");

  // Validate reveal_at.
  const revealAt = body.reveal_at ?? null;
  if (revealAt !== null && (typeof revealAt !== "number" || !Number.isFinite(revealAt)))
    throw new HttpError(400, "reveal_at must be a unix ms timestamp");

  // Validate title.
  const title = body.title ?? null;
  if (title !== null && (typeof title !== "string" || title.length > 200))
    throw new HttpError(400, "title must be a string ≤ 200 chars");

  // Validate shots_per_guest.
  const spg = body.shots_per_guest ?? null;
  if (spg !== null && (!Number.isInteger(spg) || (spg as number) <= 0 || (spg as number) > 500))
    throw new HttpError(400, "shots_per_guest must be 1–500");

  // Validate cover_image_url.
  const coverUrl = body.cover_image_url ?? null;
  if (coverUrl !== null) {
    if (typeof coverUrl !== "string" || coverUrl.length > 2048)
      throw new HttpError(400, "cover_image_url invalid");
    try {
      const u = new URL(coverUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:")
        throw new HttpError(400, "cover_image_url must be http(s)");
    } catch {
      throw new HttpError(400, "cover_image_url must be a valid URL");
    }
  }

  // Determine guest_cap (free loyal couples get unlocked cap for their tier,
  // everyone else gets the free cap of 5).
  const access = checkFilmAccess(couple.id, couple.created_at);
  const guestCap = access.free ? FILM_TIER_CAPS.twohundred : FILM_TIER_CAPS.free;

  // Derive reveal_at from wedding date if not supplied.
  let finalRevealAt = typeof revealAt === "number" ? revealAt : null;
  if (finalRevealAt === null && couple.wedding_date) {
    finalRevealAt = new Date(couple.wedding_date).getTime() + 24 * 60 * 60 * 1000;
  }

  const ts = now();
  const token = generateToken();
  const row = db
    .prepare(
      `INSERT INTO photo_albums
         (couple_id, upload_token, title, shots_per_guest, is_upload_enabled,
          allow_guest_viewing, reveal_at, event_ends_at, film_aesthetic,
          cover_image_url, guest_cap, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      couple.id,
      token,
      title ?? null,
      (spg as number | null) ?? null,
      finalRevealAt,
      (eventEndsAt as number | null) ?? null,
      aesthetic,
      coverUrl ?? null,
      guestCap,
      ts,
      ts,
    ) as AlbumRow;

  return json({ album: toAlbum(row) }, { status: 201 });
}

/** GET /api/photo-albums/current */
async function handleGetCurrentAlbum(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;

  return json({ album: row ? toAlbum(row) : null });
}

/** PATCH /api/photo-albums/current */
async function handleUpdateAlbum(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (!row) throw new HttpError(404, "No album found");

  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const updates: string[] = [];
  const params: import("bun:sqlite").SQLQueryBindings[] = [];

  if ("is_upload_enabled" in body) {
    if (typeof body.is_upload_enabled !== "boolean")
      throw new HttpError(400, "is_upload_enabled must be boolean");
    updates.push("is_upload_enabled = ?");
    params.push(body.is_upload_enabled ? 1 : 0);
  }
  if ("shots_per_guest" in body) {
    const v = body.shots_per_guest;
    if (v !== null) {
      if (typeof v !== "number" || !Number.isInteger(v) || v <= 0 || v > 500)
        throw new HttpError(400, "shots_per_guest must be 1–500 or null");
    }
    updates.push("shots_per_guest = ?");
    params.push((v as number | null) ?? null);
  }
  if ("title" in body) {
    if (body.title !== null && (typeof body.title !== "string" || body.title.length > 200))
      throw new HttpError(400, "title must be ≤ 200 chars or null");
    updates.push("title = ?");
    params.push(typeof body.title === "string" ? body.title || null : null);
  }
  if ("film_aesthetic" in body) {
    if (!FILM_AESTHETICS.includes(body.film_aesthetic as FilmAesthetic))
      throw new HttpError(400, "Invalid film_aesthetic");
    updates.push("film_aesthetic = ?");
    params.push(body.film_aesthetic as string);
  }
  if ("reveal_at" in body) {
    const v = body.reveal_at;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v)))
      throw new HttpError(400, "reveal_at must be unix ms or null");
    updates.push("reveal_at = ?");
    params.push((v as number | null) ?? null);
  }
  if ("event_ends_at" in body) {
    const v = body.event_ends_at;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v)))
      throw new HttpError(400, "event_ends_at must be unix ms or null");
    updates.push("event_ends_at = ?");
    params.push((v as number | null) ?? null);
  }
  if ("cover_image_url" in body) {
    const v = body.cover_image_url;
    if (v !== null && (typeof v !== "string" || v.length > 2048))
      throw new HttpError(400, "cover_image_url invalid");
    updates.push("cover_image_url = ?");
    params.push((v as string | null) ?? null);
  }
  if ("slug" in body) {
    // Custom guest-link slug (#17). null clears it; never touches upload_token.
    const v = body.slug;
    if (v === null) {
      updates.push("slug = ?");
      params.push(null);
    } else {
      if (typeof v !== "string") throw new HttpError(400, "slug must be a string or null");
      const slug = validateFilmSlug(v);
      const taken = db
        .prepare("SELECT id FROM photo_albums WHERE slug = ? AND id <> ?")
        .get(slug, row.id) as { id: number } | undefined;
      if (taken) throw new HttpError(409, "That link is already taken", { code: "slug_taken" });
      updates.push("slug = ?");
      params.push(slug);
    }
  }

  if (updates.length === 0) throw new HttpError(400, "No fields to update");

  const ts = now();
  updates.push("updated_at = ?");
  params.push(ts, row.id);

  const updated = db
    .prepare(`UPDATE photo_albums SET ${updates.join(", ")} WHERE id = ? RETURNING *`)
    .get(...params) as AlbumRow;

  return json({ album: toAlbum(updated) });
}

/** GET /api/photo-albums/current/photos — host view, bypasses reveal lock. */
async function handleListPhotos(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (!row) throw new HttpError(404, "No album found");

  const uploads = db
    .prepare(
      `SELECT id, guest_name AS guestName, file_path AS fileUrl,
              mime_type AS mimeType, file_size AS fileSize,
              filter_applied AS filterApplied, uploaded_at AS uploadedAt,
              source
         FROM photo_uploads
        WHERE album_id = ? AND hidden_at IS NULL ORDER BY id DESC`,
    )
    .all(row.id);

  return json({ uploads, total: uploads.length });
}

/** GET /api/photo-albums/current/devices — participant list for host dashboard. */
async function handleListDevices(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (!row) throw new HttpError(404, "No album found");

  const devices = db
    .prepare(
      `SELECT fd.device_id AS deviceId, fd.guest_name AS guestName, fd.joined_at AS joinedAt,
              fd.removed_at AS removedAt,
              COUNT(pu.id) AS shotCount
         FROM film_devices fd
         LEFT JOIN photo_uploads pu
           ON pu.album_id = fd.album_id AND pu.device_id = fd.device_id
          AND pu.hidden_at IS NULL
        WHERE fd.album_id = ? AND fd.removed_at IS NULL
        GROUP BY fd.device_id
        ORDER BY fd.joined_at ASC`,
    )
    .all(row.id) as FilmDevice[];

  return json({ devices, total: devices.length });
}

/** DELETE /api/photo-albums/current/devices/:deviceId — soft-remove a participant.
 *  Never hard-deletes (data-loss ban). `?purgePhotos=true` also hides their shots. */
async function handleRemoveDevice(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (!row) throw new HttpError(404, "No album found");

  const deviceId = ctx.params.deviceId ?? "";
  if (!deviceId) throw new HttpError(400, "device_id required");

  const device = db
    .prepare("SELECT 1 AS ok FROM film_devices WHERE album_id = ? AND device_id = ?")
    .get(row.id, deviceId) as { ok: 1 } | undefined;
  if (!device) throw new HttpError(404, "Participant not found");

  // purgePhotos accepted via query (?purgePhotos=true) or JSON body.
  let purgePhotos = ctx.url.searchParams.get("purgePhotos") === "true";
  if (!purgePhotos) {
    const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
    purgePhotos = body.purgePhotos === true;
  }

  const ts = now();
  db.prepare("UPDATE film_devices SET removed_at = ? WHERE album_id = ? AND device_id = ?").run(
    ts,
    row.id,
    deviceId,
  );
  let purgedCount = 0;
  if (purgePhotos) {
    purgedCount = db
      .prepare(
        "UPDATE photo_uploads SET hidden_at = ? WHERE album_id = ? AND device_id = ? AND hidden_at IS NULL",
      )
      .run(ts, row.id, deviceId).changes;
  }

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "film.device.remove",
    target_kind: "film_device",
    target_id: row.id,
    after: { deviceId, purgePhotos, purgedCount },
  });

  return json({ removed: true, purgedCount });
}

// ─── public handlers ──────────────────────────────────────────────────────────

interface AlbumWithCouple extends AlbumRow {
  display_name: string;
  wedding_date: string | null;
}

// Resolve a public path param as the upload token first, then fall back to the
// custom slug (#17). Token (hex) and slug namespaces never overlap, so OR is
// unambiguous; the canonical upload_token always keeps working.
function albumWithCoupleQuery(tokenOrSlug: string): AlbumWithCouple | undefined {
  return db
    .prepare(
      `SELECT pa.*, c.display_name, c.wedding_date
         FROM photo_albums pa
         JOIN couples c ON c.id = pa.couple_id
        WHERE pa.upload_token = ? OR pa.slug = ?`,
    )
    .get(tokenOrSlug, tokenOrSlug) as AlbumWithCouple | undefined;
}

/** POST /api/photo-albums/:token/devices — guest registers device before any upload. */
async function handleRegisterDevice(ctx: Ctx): Promise<Response> {
  const token = ctx.params.token ?? "";
  rateLimit(ctx.clientIp ?? "unknown", "photo:register", { capacity: 10, refillRate: 0.1 });

  const row = albumWithCoupleQuery(token);
  if (!row) throw new HttpError(404, "Album not found");
  if (!row.is_upload_enabled) throw new HttpError(403, "Film is closed");

  const body = (await ctx.req.json().catch(() => ({}))) as Record<string, unknown>;
  const deviceId = body.device_id;
  if (typeof deviceId !== "string" || !deviceId.trim() || deviceId.length > 128)
    throw new HttpError(400, "device_id required (max 128 chars)");

  const guestName =
    typeof body.guest_name === "string" && body.guest_name.trim()
      ? body.guest_name.trim().slice(0, 200)
      : null;

  // Enforce guest cap — only count new devices, not re-registrations.
  const existingDevice = db
    .prepare("SELECT removed_at FROM film_devices WHERE album_id = ? AND device_id = ?")
    .get(row.id, deviceId) as { removed_at: number | null } | undefined;

  // A soft-removed device (#6) cannot rejoin the film.
  if (existingDevice && existingDevice.removed_at !== null)
    throw new HttpError(403, "This device was removed from the film", { code: "device_removed" });

  if (!existingDevice) {
    const participantCount = countParticipants(row.id);
    if (participantCount >= row.guest_cap) {
      throw new HttpError(429, "Guest cap reached for this film", { code: "guest_cap_reached" });
    }
  }

  // Upsert device row (update name if guest changes it).
  db.prepare(
    `INSERT INTO film_devices (album_id, device_id, guest_name, joined_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(album_id, device_id) DO UPDATE SET guest_name = excluded.guest_name`,
  ).run(row.id, deviceId, guestName, now());

  const publicAlbum: PhotoAlbumPublic = {
    displayName: row.display_name,
    weddingDate: row.wedding_date,
    slug: row.slug,
    title: row.title,
    shotsPerGuest: row.shots_per_guest,
    isUploadEnabled: row.is_upload_enabled === 1,
    eventEndsAt: row.event_ends_at,
    revealAt: row.reveal_at,
    filmAesthetic: safeAesthetic(row.film_aesthetic),
    coverImageUrl: row.cover_image_url,
  };

  const shotCount = (
    db
      .prepare("SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = ? AND device_id = ?")
      .get(row.id, deviceId) as { c: number }
  ).c;

  return json({ album: publicAlbum, shotCount }, { status: 200 });
}

/** GET /api/photo-albums/:token — album info (no reveal-locked photo list here). */
async function handleGetPublicAlbum(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp ?? "unknown", "photo:lookup", { capacity: 30, refillRate: 1 });

  const token = ctx.params.token ?? "";
  const row = albumWithCoupleQuery(token);
  if (!row) throw new HttpError(404, "Album not found");

  const album: PhotoAlbumPublic = {
    displayName: row.display_name,
    weddingDate: row.wedding_date,
    slug: row.slug,
    title: row.title,
    shotsPerGuest: row.shots_per_guest,
    isUploadEnabled: row.is_upload_enabled === 1,
    eventEndsAt: row.event_ends_at,
    revealAt: row.reveal_at,
    filmAesthetic: safeAesthetic(row.film_aesthetic),
    coverImageUrl: row.cover_image_url,
  };

  return json({ album });
}

/** GET /api/photo-albums/:token/photos — reveal-locked for guests. */
async function handleGetPublicPhotos(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp ?? "unknown", "photo:list", { capacity: 30, refillRate: 0.5 });

  const token = ctx.params.token ?? "";
  const row = db
    .prepare("SELECT id, reveal_at FROM photo_albums WHERE upload_token = ? OR slug = ?")
    .get(token, token) as { id: number; reveal_at: number | null } | undefined;

  if (!row) throw new HttpError(404, "Album not found");

  const ts = now();
  if (row.reveal_at !== null && ts < row.reveal_at) {
    const photoCount = countPhotos(row.id);
    return json({ locked: true, revealsAt: row.reveal_at, photoCount });
  }

  // Hidden (purged) uploads (#6) never surface at reveal.
  const uploads = db
    .prepare(
      `SELECT id, guest_name AS guestName, file_path AS fileUrl,
              mime_type AS mimeType, filter_applied AS filterApplied,
              uploaded_at AS uploadedAt, source
         FROM photo_uploads
        WHERE album_id = ? AND hidden_at IS NULL ORDER BY id ASC`,
    )
    .all(row.id);

  return json({ locked: false, uploads, total: uploads.length });
}

/**
 * GET /api/photo-albums/:token/qr — printable QR code.
 *
 * PNG by default: the couple saves this to their phone, drops it in Canva, or
 * hands it to a print shop, and every one of those chokes on an SVG (macOS
 * Preview cannot open one at all). `?format=svg` keeps the vector around for
 * anyone laying out a table card at press resolution.
 */
async function handleGetQr(ctx: Ctx): Promise<Response> {
  const token = ctx.params.token ?? "";
  const row = db
    .prepare("SELECT 1 AS ok FROM photo_albums WHERE upload_token = ? OR slug = ?")
    .get(token, token) as { ok: 1 } | undefined;
  if (!row) throw new HttpError(404, "Album not found");

  const url = `${CONFIG.frontendBaseUrl}/photos/${token}`;
  const wantsSvg = ctx.url.searchParams.get("format") === "svg";

  if (wantsSvg) {
    return new Response(await generateQrSvg(url), {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": 'inline; filename="guest-qr.svg"',
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  const png = await generateQrPng(url);
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": 'inline; filename="guest-qr.png"',
      "Cache-Control": "public, max-age=86400",
    },
  });
}

/** POST /api/photo-albums/:token/photos — guest uploads a photo (multipart). */
async function handleGuestUpload(ctx: Ctx): Promise<Response> {
  const token = ctx.params.token ?? "";

  const row = db
    .prepare(
      `SELECT pa.*, c.id AS couple_id_val
         FROM photo_albums pa
         JOIN couples c ON c.id = pa.couple_id
        WHERE pa.upload_token = ? OR pa.slug = ?`,
    )
    .get(token, token) as (AlbumRow & { couple_id_val: number }) | undefined;

  if (!row) throw new HttpError(404, "Album not found");
  if (!row.is_upload_enabled) throw new HttpError(403, "Film is closed");

  // Auto-close if event_ends_at has passed.
  if (row.event_ends_at !== null && now() > row.event_ends_at) {
    db.prepare("UPDATE photo_albums SET is_upload_enabled = 0 WHERE id = ?").run(row.id);
    throw new HttpError(403, "Shooting window has closed");
  }

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required");
  });

  const deviceId = form.get("device_id");
  if (typeof deviceId !== "string" || !deviceId.trim() || deviceId.length > 128)
    throw new HttpError(400, "device_id required");

  rateLimit(`photo:upload:${deviceId}`, "photo:upload", UPLOAD_BUCKET);

  // Guest must have registered (cap is enforced at register time).
  const registered = db
    .prepare("SELECT removed_at FROM film_devices WHERE album_id = ? AND device_id = ?")
    .get(row.id, deviceId) as { removed_at: number | null } | undefined;
  if (!registered) throw new HttpError(403, "Device not registered — call /devices first");
  // A soft-removed device (#6) can no longer upload.
  if (registered.removed_at !== null)
    throw new HttpError(403, "This device was removed from the film", { code: "device_removed" });

  // Shot limit check.
  if (row.shots_per_guest !== null) {
    const used = (
      db
        .prepare("SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = ? AND device_id = ?")
        .get(row.id, deviceId) as { c: number }
    ).c;
    if (used >= row.shots_per_guest)
      throw new HttpError(429, "Shot limit reached", { code: "shot_limit" });
  }

  const raw = form.get("file");
  if (!(raw instanceof File)) throw new HttpError(400, "`file` field required");
  if (raw.size > MAX_PHOTO_BYTES) throw new HttpError(413, "Image too large (max 8 MB)");

  const sniffed = await sniffUploadedImage(raw);
  if (!sniffed) throw new HttpError(400, "Only JPEG, PNG and WebP images accepted");
  const ext = PHOTO_MIME_EXT[sniffed];

  const filterApplied = form.get("filter_applied");
  const filter =
    typeof filterApplied === "string" && FILM_AESTHETICS.includes(filterApplied as FilmAesthetic)
      ? filterApplied
      : row.film_aesthetic;

  const guestNameRaw = form.get("guest_name");
  const guestName =
    typeof guestNameRaw === "string" && guestNameRaw.trim()
      ? guestNameRaw.trim().slice(0, 200)
      : null;

  const ts = now();
  // Insert first so the row id names the object (stable, collision-free), then
  // write the bytes once under the final key. The image bytes are already in
  // memory (`raw`), so no temp file is needed — the storage backend (disk or
  // R2) writes the final object directly.
  const uploadRow = db
    .prepare(
      `INSERT INTO photo_uploads
         (album_id, device_id, guest_name, file_path, mime_type, file_size,
          filter_applied, uploaded_at, source)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, 'guest')
       RETURNING id`,
    )
    .get(row.id, deviceId, guestName, sniffed, raw.size, filter, ts) as { id: number };

  const key = photoObjectKey(row.couple_id, row.id, uploadRow.id, ext);
  const publicUrl = `/uploads/${key}`;
  await storage.write(key, raw);
  db.prepare("UPDATE photo_uploads SET file_path = ? WHERE id = ?").run(publicUrl, uploadRow.id);

  const shotCount = (
    db
      .prepare("SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = ? AND device_id = ?")
      .get(row.id, deviceId) as { c: number }
  ).c;

  return json({ upload: { id: uploadRow.id, fileUrl: publicUrl }, shotCount }, { status: 201 });
}

/** POST /api/photo-albums/current/photos — couple uploads their own photo (multipart). */
async function handleCoupleUpload(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple found");

  const row = db.prepare("SELECT * FROM photo_albums WHERE couple_id = ?").get(couple.id) as
    | AlbumRow
    | undefined;
  if (!row) throw new HttpError(404, "Create the film first");

  rateLimit(ctx.clientIp ?? "unknown", "photo:couple-upload", UPLOAD_BUCKET);

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required");
  });

  const raw = form.get("file");
  if (!(raw instanceof File)) throw new HttpError(400, "`file` field required");
  if (raw.size > MAX_PHOTO_BYTES) throw new HttpError(413, "Image too large (max 8 MB)");

  const sniffed = await sniffUploadedImage(raw);
  if (!sniffed) throw new HttpError(400, "Only JPEG, PNG and WebP images accepted");
  const ext = PHOTO_MIME_EXT[sniffed];

  const filterApplied = form.get("filter_applied");
  const filter =
    typeof filterApplied === "string" && FILM_AESTHETICS.includes(filterApplied as FilmAesthetic)
      ? filterApplied
      : row.film_aesthetic;

  const ts = now();
  // Insert first to name the object by row id, then write the in-memory bytes
  // once under the final key (no temp file needed — see handleGuestUpload).
  const uploadRow = db
    .prepare(
      `INSERT INTO photo_uploads
         (album_id, device_id, guest_name, file_path, mime_type, file_size,
          filter_applied, uploaded_at, source)
       VALUES (?, ?, ?, '', ?, ?, ?, ?, 'couple')
       RETURNING id`,
    )
    .get(row.id, "couple", null, sniffed, raw.size, filter, ts) as { id: number };

  const key = photoObjectKey(row.couple_id, row.id, uploadRow.id, ext);
  const publicUrl = `/uploads/${key}`;
  await storage.write(key, raw);
  db.prepare("UPDATE photo_uploads SET file_path = ? WHERE id = ?").run(publicUrl, uploadRow.id);

  return json({ upload: { id: uploadRow.id, fileUrl: publicUrl } }, { status: 201 });
}

async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });
}

/** 1024px wide — big enough to print on a table card without a soft edge. */
async function generateQrPng(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 1024,
    color: { dark: "#1a1a1a", light: "#ffffff" },
  });
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerPhotoRoutes(router: Router): void {
  // Authenticated couple endpoints — order matters: static paths before :param.
  router.get("/api/photo-albums/film-access", handleFilmAccess, true);
  router.post("/api/photo-albums/checkout", handleFilmCheckout, true);
  router.post("/api/photo-albums", handleCreateAlbum, true);
  router.get("/api/photo-albums/current", handleGetCurrentAlbum, true);
  router.patch("/api/photo-albums/current", handleUpdateAlbum, true);
  router.post("/api/photo-albums/current/photos", handleCoupleUpload, true);
  router.get("/api/photo-albums/current/photos", handleListPhotos, true);
  router.get("/api/photo-albums/current/devices", handleListDevices, true);
  router.delete("/api/photo-albums/current/devices/:deviceId", handleRemoveDevice, true);

  // Public endpoints.
  router.post("/api/photo-albums/:token/devices", handleRegisterDevice);
  router.get("/api/photo-albums/:token", handleGetPublicAlbum);
  router.get("/api/photo-albums/:token/photos", handleGetPublicPhotos);
  router.get("/api/photo-albums/:token/qr", handleGetQr);
  router.post("/api/photo-albums/:token/photos", handleGuestUpload);
}
