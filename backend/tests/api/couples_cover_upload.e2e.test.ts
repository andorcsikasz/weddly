// Couple-facing cover image upload — POST /api/couples/current/cover.
// Mirrors the vendor hero-upload route's contract: multipart `file` field,
// JPEG/PNG/WebP only, 4 MB max, writes to ${UPLOADS_DIR}/couples/<id>/cover.<ext>
// with a cache-busted URL, and persists the URL onto the couple row in one
// transaction so the client doesn't need a follow-up PATCH.

import "../setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bootstrapCouple, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** 67-byte 1x1 transparent PNG. Same fixture as the vendor hero tests — the
 *  server only checks Content-Type + size, never decodes pixels, so this
 *  payload covers every validation the route runs. */
function tinyPngBlob(): Blob {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  return new Blob([bytes], { type: "image/png" });
}

async function uploadCover(
  token: string | null,
  blob: Blob,
  filename = "cover.png",
  fieldName = "file",
): Promise<Response> {
  const form = new FormData();
  form.append(fieldName, blob, filename);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`${BASE}/api/couples/current/cover`, {
    method: "POST",
    headers,
    body: form,
  });
}

interface CoupleEnvelope {
  couple: { id: number; cover_image_url: string | null };
}

describe("POST /api/couples/current/cover", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("uploads a PNG and exposes a cache-busted /uploads URL", async () => {
    const { token, coupleId } = await bootstrapCouple("upload@weddly.test");
    const res = await uploadCover(token, tinyPngBlob());
    expect(res.status).toBe(200);
    const body = (await res.json()) as CoupleEnvelope;
    expect(body.couple.id).toBe(coupleId);
    expect(body.couple.cover_image_url).toMatch(
      new RegExp(`^/uploads/couples/${coupleId}/cover\\.png\\?v=\\d+$`),
    );
  });

  test("a second upload bumps the cache-bust timestamp", async () => {
    const { token } = await bootstrapCouple("replace@weddly.test");
    const first = await uploadCover(token, tinyPngBlob());
    const firstBody = (await first.json()) as CoupleEnvelope;
    // 5 ms gap so the `now()` marker differs across the pair.
    await new Promise((r) => setTimeout(r, 5));
    const second = await uploadCover(token, tinyPngBlob());
    const secondBody = (await second.json()) as CoupleEnvelope;
    expect(secondBody.couple.cover_image_url).not.toBe(firstBody.couple.cover_image_url);
    expect(secondBody.couple.cover_image_url).toMatch(
      /^\/uploads\/couples\/\d+\/cover\.png\?v=\d+$/,
    );
  });

  test("anon → 401", async () => {
    const res = await uploadCover(null, tinyPngBlob());
    expect(res.status).toBe(401);
  });

  test("missing file field → 400", async () => {
    const { token } = await bootstrapCouple("nofile@weddly.test");
    const res = await uploadCover(token, tinyPngBlob(), "cover.png", "other");
    expect(res.status).toBe(400);
  });

  test("unsupported MIME (text/plain) → 415", async () => {
    const { token } = await bootstrapCouple("badmime@weddly.test");
    const blob = new Blob(["not really an image"], { type: "text/plain" });
    const res = await uploadCover(token, blob, "evil.txt");
    expect(res.status).toBe(415);
  });

  test("file over the 4 MB limit → 413", async () => {
    const { token } = await bootstrapCouple("toolarge@weddly.test");
    // Use 4 MB + 1 byte of PNG-typed garbage. The route checks `size` BEFORE
    // sniffing the MIME-listed allowlist, so an "image/png" content-type
    // header is enough to confirm size-gate-first behavior.
    const big = new Uint8Array(4 * 1024 * 1024 + 1);
    const blob = new Blob([big], { type: "image/png" });
    const res = await uploadCover(token, blob, "huge.png");
    expect(res.status).toBe(413);
  });

  test("cross-couple isolation — couple B's upload doesn't leak into couple A", async () => {
    const a = await bootstrapCouple("alice@weddly.test");
    const b = await bootstrapCouple("bob@weddly.test");
    const upA = await uploadCover(a.token, tinyPngBlob());
    const upB = await uploadCover(b.token, tinyPngBlob());
    const bodyA = (await upA.json()) as CoupleEnvelope;
    const bodyB = (await upB.json()) as CoupleEnvelope;
    expect(bodyA.couple.cover_image_url).toMatch(
      new RegExp(`^/uploads/couples/${a.coupleId}/cover\\.png\\?v=\\d+$`),
    );
    expect(bodyB.couple.cover_image_url).toMatch(
      new RegExp(`^/uploads/couples/${b.coupleId}/cover\\.png\\?v=\\d+$`),
    );
    expect(bodyA.couple.cover_image_url).not.toBe(bodyB.couple.cover_image_url);
  });
});
