// Moodboard routes. The board has three sources, persisted on the couple so
// both partners see the same thing across devices:
//   - GET  /api/moodboard          → the couple's MoodboardState
//   - GET  /api/moodboard/preview  → proxy a Pinterest board's RSS feed (used
//                                    to render both the preset and a linked board)
//   - PATCH /api/moodboard         → switch to 'preset' or link a 'pinterest' board
//   - POST /api/moodboard/images   → upload own images (multipart) → source 'upload'
//   - DELETE /api/moodboard/images/:id → remove one uploaded image
//
// Pinterest scraping is unreliable (private boards, 403s), so own-image upload
// is the robust path; the preset keeps the page populated out of the box.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MoodboardState } from "@shared/types";
import { CONFIG } from "../config";
import { storage, keyFromUploadUrl } from "../lib/storage";
import { db, now } from "../db";
import { getCoupleForUser } from "../domain/couples";
import { fetchPinterestBoardPins, getMoodboardState, resolveBoardUrl } from "../domain/moodboard";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { sniffUploadedImage } from "../lib/image_sniff";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGES_PER_COUPLE = 12;
const IMAGE_URL_TTL_MS = 24 * 60 * 60 * 1000;
const SUPPORTED_MIMES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function requireCouple(ctx: Ctx) {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple");
  return { userId, couple };
}

function imageSignature(id: number, expires: number): string {
  return createHmac("sha256", CONFIG.jwtSecret).update(`moodboard.${id}.${expires}`).digest("hex");
}

function moodboardState(coupleId: number): MoodboardState {
  const state = getMoodboardState(coupleId);
  const expires = Date.now() + IMAGE_URL_TTL_MS;
  return {
    ...state,
    images: state.images.map((image) => ({
      ...image,
      image_url: `/api/moodboard/images/${image.id}/content?expires=${expires}&sig=${imageSignature(image.id, expires)}`,
    })),
  };
}

async function handlePreview(ctx: Ctx): Promise<Response> {
  const url = new URL(ctx.req.url).searchParams.get("url");
  if (!url) {
    throw new HttpError(400, "url query param required", { code: "invalid_url" });
  }
  const pins = await fetchPinterestBoardPins(url);
  return json({ pins });
}

async function handleGetState(ctx: Ctx): Promise<Response> {
  const { couple } = requireCouple(ctx);
  return json(moodboardState(couple.id));
}

async function handlePatch(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const body = await readJson<{ source?: string; url?: string }>(ctx.req);
  const ts = now();

  if (body.source === "pinterest") {
    // resolveBoardUrl follows pin.it / shortener share links and canonicalises
    // the result, so a couple can paste whatever Pinterest's Share button gave
    // them (short link, bare host, locale subdomain) and we store a clean URL.
    const canonical = await resolveBoardUrl(body.url ?? "");
    if (!canonical) {
      throw new HttpError(400, "Invalid Pinterest board URL", { code: "invalid_url" });
    }
    db.prepare(
      "UPDATE couples SET moodboard_source = 'pinterest', moodboard_url = ?, updated_at = ? WHERE id = ?",
    ).run(canonical, ts, couple.id);
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "moodboard.link_board",
      target_kind: "couple",
      target_id: couple.id,
      after: { moodboard_url: canonical },
    });
  } else if (body.source === "preset") {
    db.prepare(
      "UPDATE couples SET moodboard_source = 'preset', moodboard_url = NULL, updated_at = ? WHERE id = ?",
    ).run(ts, couple.id);
    addAuditLog({
      actor_user_id: userId,
      couple_id: couple.id,
      action: "moodboard.reset_preset",
      target_kind: "couple",
      target_id: couple.id,
    });
  } else {
    throw new HttpError(400, "source must be 'preset' or 'pinterest'", { code: "invalid_source" });
  }

  return json(moodboardState(couple.id));
}

async function handleUploadImages(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  // instanceof-narrow each entry (the cover handler does the same) — a type
  // predicate trips Bun's dual File types under tsc.
  const files: File[] = [];
  for (const entry of form.getAll("file")) {
    if (entry instanceof File) files.push(entry);
  }
  if (files.length === 0) {
    throw new HttpError(400, "`file` field required", { code: "missing_file" });
  }

  const existing = (
    db.prepare("SELECT COUNT(*) AS n FROM moodboard_images WHERE couple_id = ?").get(couple.id) as {
      n: number;
    }
  ).n;
  if (existing + files.length > MAX_IMAGES_PER_COUPLE) {
    throw new HttpError(400, `At most ${MAX_IMAGES_PER_COUPLE} images`, { code: "upload_limit" });
  }

  // Validate everything before writing a single byte, so a bad file in the
  // batch can't leave a half-uploaded set on disk.
  const validated: { file: File; ext: "jpg" | "png" | "webp" }[] = [];
  for (const file of files) {
    if (file.size <= 0) {
      throw new HttpError(400, "Empty file", { code: "empty_file" });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new HttpError(413, `File too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)`, {
        code: "file_too_large",
      });
    }
    const sniffed = await sniffUploadedImage(file);
    const ext = sniffed ? SUPPORTED_MIMES[sniffed] : undefined;
    if (!ext) {
      throw new HttpError(415, "File contents are not a valid image", { code: "unsupported_type" });
    }
    validated.push({ file, ext });
  }

  const ts = now();
  const maxOrder = (
    db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) AS m FROM moodboard_images WHERE couple_id = ?",
      )
      .get(couple.id) as { m: number }
  ).m;

  const insert = db.prepare(
    "INSERT INTO moodboard_images (couple_id, image_path, sort_order, created_at) VALUES (?, ?, ?, ?)",
  );
  const setPath = db.prepare("UPDATE moodboard_images SET image_path = ? WHERE id = ?");

  for (let i = 0; i < validated.length; i++) {
    const { file, ext } = validated[i] as { file: File; ext: "jpg" | "png" | "webp" };
    // Insert first so the row id names the file (stable, collision-free).
    const res = insert.run(couple.id, "", maxOrder + 1 + i, ts);
    const id = Number(res.lastInsertRowid);
    await storage.write(`couples/${couple.id}/moodboard/${id}.${ext}`, file);
    setPath.run(`/uploads/couples/${couple.id}/moodboard/${id}.${ext}?v=${ts}`, id);
  }

  db.prepare("UPDATE couples SET moodboard_source = 'upload', updated_at = ? WHERE id = ?").run(
    ts,
    couple.id,
  );
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "moodboard.image_upload",
    target_kind: "couple",
    target_id: couple.id,
    after: { count: validated.length },
  });

  return json(moodboardState(couple.id));
}

/** Serve a couple's private moodboard image through a short-lived capability.
 * `<img>` cannot attach the bearer token kept by the API client, so the
 * authenticated state response mints an HMAC URL instead. The raw sequential
 * `/uploads/couples/:id/moodboard/*` namespace is denied by server.ts. */
async function handleImageContent(ctx: Ctx): Promise<Response> {
  const id = Number(ctx.params.id);
  const expires = Number(ctx.url.searchParams.get("expires"));
  const supplied = ctx.url.searchParams.get("sig") ?? "";
  if (!Number.isInteger(id) || !Number.isSafeInteger(expires)) {
    throw new HttpError(404, "Image not found");
  }
  const ts = Date.now();
  if (expires < ts || expires > ts + IMAGE_URL_TTL_MS + 60_000) {
    throw new HttpError(404, "Image not found");
  }
  const expected = imageSignature(id, expires);
  const a = Buffer.from(supplied, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(404, "Image not found");
  }
  const row = db.prepare("SELECT image_path FROM moodboard_images WHERE id = ?").get(id) as
    | { image_path: string }
    | undefined;
  const key = row ? keyFromUploadUrl(row.image_path) : null;
  if (!key) throw new HttpError(404, "Image not found");
  const served = await storage.serve(key);
  if (!served) throw new HttpError(404, "Image not found");
  const headers = new Headers(served.headers);
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(served.body, { status: served.status, headers });
}

async function handleDeleteImage(ctx: Ctx): Promise<Response> {
  const { userId, couple } = requireCouple(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) {
    throw new HttpError(400, "Invalid image id");
  }
  const row = db
    .prepare("SELECT id, image_path FROM moodboard_images WHERE id = ? AND couple_id = ?")
    .get(id, couple.id) as { id: number; image_path: string } | undefined;
  if (!row) {
    throw new HttpError(404, "Image not found");
  }

  const key = keyFromUploadUrl(row.image_path);
  // A leaked object under uploads doesn't surface to users (storage.delete
  // swallows its own errors).
  if (key) await storage.delete(key);
  db.prepare("DELETE FROM moodboard_images WHERE id = ? AND couple_id = ?").run(id, couple.id);

  const ts = now();
  const remaining = (
    db.prepare("SELECT COUNT(*) AS n FROM moodboard_images WHERE couple_id = ?").get(couple.id) as {
      n: number;
    }
  ).n;
  // Last uploaded image gone → fall back to the curated preset rather than an
  // empty upload grid.
  if (remaining === 0) {
    db.prepare("UPDATE couples SET moodboard_source = 'preset', updated_at = ? WHERE id = ?").run(
      ts,
      couple.id,
    );
  }
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "moodboard.image_delete",
    target_kind: "couple",
    target_id: couple.id,
    before: { image_id: id },
  });

  return json(getMoodboardState(couple.id));
}

export function registerMoodboardRoutes(router: Router) {
  router.get("/api/moodboard", handleGetState, true);
  router.get("/api/moodboard/images/:id/content", handleImageContent);
  router.get("/api/moodboard/preview", handlePreview, true);
  router.patch("/api/moodboard", handlePatch, true);
  router.post("/api/moodboard/images", handleUploadImages, true);
  router.delete("/api/moodboard/images/:id", handleDeleteImage, true);
}
