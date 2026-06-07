// Moodboard — the couple's board state (preset / linked Pinterest board / own
// uploads) lives on the couple row so both partners see the same thing across
// devices. Covers the state read, source switching, multipart image upload
// (validation + cap), per-image delete with the auto-fallback to preset, cross-
// couple isolation, and the read-only (402) gate for lapsed couples.

import "../setup";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MoodboardState } from "@shared/types";
import { db } from "../../src/db";
import { setBillingEnforcement } from "../../src/domain/billing";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** 67-byte 1x1 transparent PNG — same fixture as the cover-upload tests. The
 *  route sniffs magic bytes, never decodes pixels, so this covers validation. */
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

/** Seed N founding-cohort couples so the founding cap is full — used by the
 *  entitlement test so a freshly bootstrapped couple stays on the (expirable)
 *  trial rather than being auto-granted founding. Mirrors billing.e2e. */
function seedFoundingCohort(n: number): void {
  const until = Date.now() + 1000 * 60 * 60 * 24 * 365;
  const insert = db.prepare(
    `INSERT INTO couples (id, partner_a_id, display_name, bride_name, groom_name,
       style_tags_json, frozen_categories_json, status, subscription_status,
       is_founding_member, founding_until, created_at, updated_at, is_demo)
     VALUES (?, 1, 'x', '', '', '[]', '[]', 'active', 'founding', 1, ?, 1, 1, 0)`,
  );
  db.transaction(() => {
    for (let i = 1; i <= n; i++) insert.run(-i, until);
  })();
}

async function uploadImages(token: string | null, blobs: Blob[]): Promise<Response> {
  const form = new FormData();
  blobs.forEach((b, i) => form.append("file", b, `pin-${i}.png`));
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return await fetch(`${BASE}/api/moodboard/images`, { method: "POST", headers, body: form });
}

describe("moodboard state + source switching", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("a fresh couple defaults to the curated preset, no images", async () => {
    const { token } = await bootstrapCouple("mb-default@weddly.test");
    const r = await req<MoodboardState>("GET", "/api/moodboard", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.source).toBe("preset");
    expect(r.data.preset_url).toMatch(/^https:\/\/.*pinterest\./);
    expect(r.data.url).toBeNull();
    expect(r.data.images).toEqual([]);
  });

  test("PATCH links a valid Pinterest board → source 'pinterest'", async () => {
    const { token } = await bootstrapCouple("mb-link@weddly.test");
    const url = "https://www.pinterest.com/someone/wedding-ideas/";
    const r = await req<MoodboardState>(
      "PATCH",
      "/api/moodboard",
      { source: "pinterest", url },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.source).toBe("pinterest");
    expect(r.data.url).toBe(url);
  });

  test("PATCH with a non-Pinterest url → 400 invalid_url", async () => {
    const { token } = await bootstrapCouple("mb-badurl@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "PATCH",
      "/api/moodboard",
      { source: "pinterest", url: "https://example.com/nope" },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invalid_url");
  });

  test("PATCH back to preset clears the linked url", async () => {
    const { token } = await bootstrapCouple("mb-reset@weddly.test");
    await req(
      "PATCH",
      "/api/moodboard",
      { source: "pinterest", url: "https://www.pinterest.com/x/y/" },
      { token },
    );
    const r = await req<MoodboardState>("PATCH", "/api/moodboard", { source: "preset" }, { token });
    expect(r.status).toBe(200);
    expect(r.data.source).toBe("preset");
    expect(r.data.url).toBeNull();
  });

  test("PATCH with an unknown source → 400", async () => {
    const { token } = await bootstrapCouple("mb-badsource@weddly.test");
    const r = await req("PATCH", "/api/moodboard", { source: "nonsense" }, { token });
    expect(r.status).toBe(400);
  });

  test("anon → 401 on GET", async () => {
    const r = await req("GET", "/api/moodboard");
    expect(r.status).toBe(401);
  });
});

describe("moodboard image upload + delete", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("uploads images → source 'upload', cache-busted /uploads URLs", async () => {
    const { token, coupleId } = await bootstrapCouple("mb-upload@weddly.test");
    const res = await uploadImages(token, [tinyPngBlob(), tinyPngBlob()]);
    expect(res.status).toBe(200);
    const state = (await res.json()) as MoodboardState;
    expect(state.source).toBe("upload");
    expect(state.images).toHaveLength(2);
    for (const img of state.images) {
      expect(img.image_url).toMatch(
        new RegExp(`^/uploads/couples/${coupleId}/moodboard/\\d+\\.png\\?v=\\d+$`),
      );
    }
  });

  test("missing file field → 400", async () => {
    const { token } = await bootstrapCouple("mb-nofile@weddly.test");
    const form = new FormData();
    form.append("other", tinyPngBlob(), "x.png");
    const res = await fetch(`${BASE}/api/moodboard/images`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  test("non-image bytes → 415", async () => {
    const { token } = await bootstrapCouple("mb-badtype@weddly.test");
    const res = await uploadImages(token, [new Blob(["not an image"], { type: "image/png" })]);
    expect(res.status).toBe(415);
  });

  test("over the 12-image cap → 400 upload_limit", async () => {
    const { token } = await bootstrapCouple("mb-cap@weddly.test");
    const blobs = Array.from({ length: 13 }, () => tinyPngBlob());
    const res = await uploadImages(token, blobs);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("upload_limit");
  });

  test("deleting the last image falls back to preset", async () => {
    const { token } = await bootstrapCouple("mb-del@weddly.test");
    const up = await uploadImages(token, [tinyPngBlob()]);
    const state = (await up.json()) as MoodboardState;
    const id = state.images[0]?.id;
    expect(id).toBeGreaterThan(0);

    const del = await req<MoodboardState>("DELETE", `/api/moodboard/images/${id}`, undefined, {
      token,
    });
    expect(del.status).toBe(200);
    expect(del.data.images).toEqual([]);
    expect(del.data.source).toBe("preset");
  });

  test("cross-couple isolation — B can't see or delete A's images", async () => {
    const a = await bootstrapCouple("mb-a@weddly.test");
    const b = await bootstrapCouple("mb-b@weddly.test");
    const upA = await uploadImages(a.token, [tinyPngBlob()]);
    const stateA = (await upA.json()) as MoodboardState;
    const imgId = stateA.images[0]?.id as number;

    // B's state is its own (preset, empty).
    const bState = await req<MoodboardState>("GET", "/api/moodboard", undefined, {
      token: b.token,
    });
    expect(bState.data.source).toBe("preset");
    expect(bState.data.images).toEqual([]);

    // B can't delete A's image.
    const del = await req("DELETE", `/api/moodboard/images/${imgId}`, undefined, {
      token: b.token,
    });
    expect(del.status).toBe(404);

    // A still has it.
    const aState = await req<MoodboardState>("GET", "/api/moodboard", undefined, {
      token: a.token,
    });
    expect(aState.data.images).toHaveLength(1);
  });
});

describe("moodboard read-only gate (lapsed couple)", () => {
  beforeEach(() => {
    wipeAll();
  });
  afterEach(() => {
    wipeAll();
  });

  test("a lapsed couple gets 402 on mutations but can still read", async () => {
    seedFoundingCohort(200);
    const { token, coupleId } = await bootstrapCouple("mb-lapsed@weddly.test");
    db.prepare("UPDATE couples SET trial_ends_at = 1 WHERE id = ?").run(coupleId);
    setBillingEnforcement(true, 1); // paywall live, otherwise the freeze is deferred

    // Reads stay open.
    const get = await req<MoodboardState>("GET", "/api/moodboard", undefined, { token });
    expect(get.status).toBe(200);

    // Mutations are blocked.
    const patch = await req(
      "PATCH",
      "/api/moodboard",
      { source: "pinterest", url: "https://www.pinterest.com/x/y/" },
      { token },
    );
    expect(patch.status).toBe(402);

    const upload = await uploadImages(token, [tinyPngBlob()]);
    expect(upload.status).toBe(402);
  });
});
