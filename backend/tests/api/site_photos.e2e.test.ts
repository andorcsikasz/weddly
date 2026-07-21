// Optional fixed-slot site photos — POST/DELETE /api/couples/current/site-photo/:slot.
// Mirrors the cover-upload contract (multipart `file`, JPEG/PNG/WebP, 4 MB max,
// magic-byte sniff) with a slot param (1|2); the photos surface on the public
// wedding view at every tier (they're presentation content like the cover).

import "../setup";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CURATED_SITE_PHOTOS } from "@shared/design";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? "./data/test-uploads";
// The shipped curated art lives in the frontend public tree; the preset picker
// only ever stores paths into it, so the files must actually exist there.
const DESIGN_PHOTOS_DIR = join(import.meta.dir, "../../../frontend/public/design-photos");

/** 67-byte 1x1 transparent PNG — same fixture as the cover-upload suite. */
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

async function uploadSitePhoto(
  token: string | null,
  slot: number | string,
  blob: Blob,
  filename = "photo.png",
): Promise<Response> {
  const form = new FormData();
  form.append("file", blob, filename);
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`${BASE}/api/couples/current/site-photo/${slot}`, {
    method: "POST",
    headers,
    body: form,
  });
}

interface CoupleEnvelope {
  couple: {
    id: number;
    site_image_1_url: string | null;
    site_image_2_url: string | null;
  };
}

function coupleSlug(coupleId: number): string {
  const row = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
    | { slug: string }
    | undefined;
  if (!row) throw new Error(`no slug for couple ${coupleId}`);
  return row.slug;
}

describe("site photo slots — upload / clear / public exposure", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("uploads land in their own slot with cache-busted /uploads URLs", async () => {
    const { token, coupleId } = await bootstrapCouple("site-photos@weddly.test");
    const r1 = await uploadSitePhoto(token, 1, tinyPngBlob());
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as CoupleEnvelope;
    expect(b1.couple.site_image_1_url).toMatch(
      new RegExp(`^/uploads/couples/${coupleId}/site-photo-1\\.png\\?v=\\d+$`),
    );
    expect(b1.couple.site_image_2_url).toBeNull();

    const r2 = await uploadSitePhoto(token, 2, tinyPngBlob());
    const b2 = (await r2.json()) as CoupleEnvelope;
    expect(b2.couple.site_image_1_url).toMatch(/site-photo-1\.png/);
    expect(b2.couple.site_image_2_url).toMatch(
      new RegExp(`^/uploads/couples/${coupleId}/site-photo-2\\.png\\?v=\\d+$`),
    );
  });

  test("DELETE clears exactly the addressed slot", async () => {
    const { token } = await bootstrapCouple("site-photos-del@weddly.test");
    await uploadSitePhoto(token, 1, tinyPngBlob());
    await uploadSitePhoto(token, 2, tinyPngBlob());
    const del = await req<CoupleEnvelope>(
      "DELETE",
      "/api/couples/current/site-photo/1",
      undefined,
      {
        token,
      },
    );
    expect(del.status).toBe(200);
    expect(del.data.couple.site_image_1_url).toBeNull();
    expect(del.data.couple.site_image_2_url).toMatch(/site-photo-2\.png/);
  });

  test("slot outside 1|2 → 400", async () => {
    const { token } = await bootstrapCouple("site-photos-slot@weddly.test");
    const res = await uploadSitePhoto(token, 3, tinyPngBlob());
    expect(res.status).toBe(400);
  });

  test("anon → 401", async () => {
    const res = await uploadSitePhoto(null, 1, tinyPngBlob());
    expect(res.status).toBe(401);
  });

  test("unsupported MIME → 415", async () => {
    const { token } = await bootstrapCouple("site-photos-mime@weddly.test");
    const res = await uploadSitePhoto(token, 1, new Blob(["nope"], { type: "text/plain" }));
    expect(res.status).toBe(415);
  });

  test("public wedding view carries both slots at the public tier", async () => {
    const { token, coupleId } = await bootstrapCouple("site-photos-public@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    await uploadSitePhoto(token, 1, tinyPngBlob());
    await uploadSitePhoto(token, 2, tinyPngBlob());
    const r = await req<{
      wedding: { site_image_1_url: string | null; site_image_2_url: string | null };
    }>("GET", `/api/public/wedding/${encodeURIComponent(coupleSlug(coupleId))}`);
    expect(r.status).toBe(200);
    expect(r.data.wedding.site_image_1_url).toMatch(/site-photo-1\.png/);
    expect(r.data.wedding.site_image_2_url).toMatch(/site-photo-2\.png/);
  });
});

describe("site photo slots — curated preset picker", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  function choosePreset(token: string | null, slot: number | string, slug: unknown) {
    return req<CoupleEnvelope>(
      "POST",
      `/api/couples/current/site-photo/${slot}/preset`,
      { slug },
      token ? { token } : {},
    );
  }

  test("a valid slug stores the matching /design-photos asset path", async () => {
    const { token } = await bootstrapCouple("preset-ok@weddly.test");
    const first = CURATED_SITE_PHOTOS[0];
    if (!first) throw new Error("no curated photos defined");

    const r = await choosePreset(token, 1, first.slug);
    expect(r.status).toBe(200);
    expect(r.data.couple.site_image_1_url).toBe(`/design-photos/${first.file}`);
    expect(r.data.couple.site_image_2_url).toBeNull();
    // Every advertised slug must resolve to a real, shipped file — otherwise a
    // couple picks a background that 404s on their live page.
    for (const p of CURATED_SITE_PHOTOS) {
      expect(existsSync(join(DESIGN_PHOTOS_DIR, p.file))).toBe(true);
    }
  });

  test("an unknown slug is refused, column untouched", async () => {
    const { token } = await bootstrapCouple("preset-bad-slug@weddly.test");
    const r = await choosePreset(token, 1, "not-a-real-slug");
    expect(r.status).toBe(400);
    const check = await req<CoupleEnvelope>("GET", "/api/couples/current", undefined, { token });
    expect(check.data.couple.site_image_1_url).toBeNull();
  });

  test("a non-string slug is refused", async () => {
    const { token } = await bootstrapCouple("preset-nonstring@weddly.test");
    const r = await choosePreset(token, 1, 42);
    expect(r.status).toBe(400);
  });

  test("slot outside 1|2 → 400", async () => {
    const { token } = await bootstrapCouple("preset-slot@weddly.test");
    const first = CURATED_SITE_PHOTOS[0];
    const r = await choosePreset(token, 3, first?.slug);
    expect(r.status).toBe(400);
  });

  test("anon → 401", async () => {
    const first = CURATED_SITE_PHOTOS[0];
    const r = await choosePreset(null, 1, first?.slug);
    expect(r.status).toBe(401);
  });

  test("a preset can replace an uploaded photo and vice versa", async () => {
    const { token, coupleId } = await bootstrapCouple("preset-swap@weddly.test");
    const art = CURATED_SITE_PHOTOS[1];
    if (!art) throw new Error("need two curated photos for this test");

    // upload → preset: the /uploads file is cleaned up, column now the asset path.
    const up = await uploadSitePhoto(token, 1, tinyPngBlob());
    const uploadedUrl = ((await up.json()) as CoupleEnvelope).couple.site_image_1_url;
    expect(uploadedUrl).toMatch(/^\/uploads\//);
    const uploadedKey = (uploadedUrl ?? "").split("?")[0]?.replace("/uploads/", "") ?? "";
    expect(existsSync(join(UPLOADS_DIR, uploadedKey))).toBe(true);

    const toPreset = await choosePreset(token, 1, art.slug);
    expect(toPreset.data.couple.site_image_1_url).toBe(`/design-photos/${art.file}`);
    expect(existsSync(join(UPLOADS_DIR, uploadedKey))).toBe(false); // old file gone

    // preset → upload: the column flips back to an /uploads path.
    const up2 = await uploadSitePhoto(token, 1, tinyPngBlob());
    expect(((await up2.json()) as CoupleEnvelope).couple.site_image_1_url).toMatch(
      new RegExp(`^/uploads/couples/${coupleId}/site-photo-1\\.png`),
    );
  });

  test("a chosen preset shows on the public wedding view", async () => {
    const { token, coupleId } = await bootstrapCouple("preset-public@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const art = CURATED_SITE_PHOTOS[2];
    if (!art) throw new Error("need a curated photo");
    await choosePreset(token, 2, art.slug);

    const r = await req<{ wedding: { site_image_2_url: string | null } }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(coupleSlug(coupleId))}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.wedding.site_image_2_url).toBe(`/design-photos/${art.file}`);
  });
});
