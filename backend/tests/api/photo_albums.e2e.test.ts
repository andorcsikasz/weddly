import "../setup";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// Wipe film-specific tables — they are not in wipeAll because they're newer.
function wipeFilm(): void {
  for (const t of ["film_devices", "photo_uploads", "photo_albums"]) {
    try {
      db.exec(`DELETE FROM ${t}`);
    } catch {
      // Table may not exist on a very old schema; ignore.
    }
  }
}

// Minimal valid JPEG (magic bytes FF D8 FF + padding).
const FAKE_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, ...Array<number>(100).fill(0),
]);

describe("photo-albums API", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeAll();
    wipeFilm();
    ({ token } = await bootstrapCouple("film@weddly.test"));
  });

  afterAll(() => {
    wipeFilm();
  });

  test("POST /api/photo-albums creates an album", async () => {
    const r = await req<{ album: { uploadToken: string; id: number } }>(
      "POST",
      "/api/photo-albums",
      { title: "Our Film", shots_per_guest: 5, film_aesthetic: "natural" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(typeof r.data.album.uploadToken).toBe("string");
    expect(r.data.album.uploadToken.length).toBeGreaterThan(0);
    albumToken = r.data.album.uploadToken;
  });

  test("POST /api/photo-albums is idempotent — returns existing album", async () => {
    const r = await req<{ album: { uploadToken: string } }>(
      "POST",
      "/api/photo-albums",
      { title: "Different Title" },
      { token },
    );
    // Existing album is returned (200, not 201).
    expect(r.status).toBe(200);
    expect(r.data.album.uploadToken).toBe(albumToken);
  });

  test("GET /api/photo-albums/current returns album with photoCount and participantCount", async () => {
    const r = await req<{
      album: { uploadToken: string; photoCount: number; participantCount: number };
    }>("GET", "/api/photo-albums/current", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.album.uploadToken).toBe(albumToken);
    expect(r.data.album.photoCount).toBe(0);
    expect(r.data.album.participantCount).toBe(0);
  });

  test("POST /:token/devices registers a device", async () => {
    const r = await req<{ album: object; shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "test-device-1", guest_name: "Ana" },
    );
    expect(r.status).toBe(200);
    expect(r.data.shotCount).toBe(0);
  });

  test("participantCount increments after device registration", async () => {
    const r = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.album.participantCount).toBe(1);
  });

  test("POST /:token/photos rejects unregistered device", async () => {
    const fd = new FormData();
    fd.append("file", new File([FAKE_JPEG], "photo.jpg", { type: "image/jpeg" }));
    fd.append("device_id", "unknown-device");
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/photos`, {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(403);
  });

  test("POST /:token/photos accepts registered device upload", async () => {
    const fd = new FormData();
    fd.append("file", new File([FAKE_JPEG], "photo.jpg", { type: "image/jpeg" }));
    fd.append("device_id", "test-device-1");
    fd.append("guest_name", "Ana");
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/photos`, {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { upload: { id: number; fileUrl: string }; shotCount: number };
    expect(body.shotCount).toBe(1);
    expect(typeof body.upload.fileUrl).toBe("string");
  });

  test("photoCount increments after upload", async () => {
    const r = await req<{ album: { photoCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.album.photoCount).toBe(1);
  });

  test("GET /:token/photos is locked before reveal_at", async () => {
    const r = await req<{ locked: boolean; revealsAt: number; photoCount: number }>(
      "GET",
      `/api/photo-albums/${albumToken}/photos`,
    );
    expect(r.status).toBe(200);
    expect(r.data.locked).toBe(true);
    expect(r.data.photoCount).toBe(1);
    expect(typeof r.data.revealsAt).toBe("number");
  });

  test("GET /:token/photos unlocks after reveal_at passes", async () => {
    // Patch reveal_at to a time in the past.
    db.exec(
      `UPDATE photo_albums SET reveal_at = 1 WHERE upload_token = '${albumToken}'`,
    );
    const r = await req<{ locked: boolean; uploads: unknown[]; total: number }>(
      "GET",
      `/api/photo-albums/${albumToken}/photos`,
    );
    expect(r.status).toBe(200);
    expect(r.data.locked).toBe(false);
    expect(r.data.total).toBe(1);
    // Restore reveal_at so later tests stay consistent.
    db.exec(
      `UPDATE photo_albums SET reveal_at = ${Date.now() + 86_400_000} WHERE upload_token = '${albumToken}'`,
    );
  });

  test("GET /:token/qr returns SVG", async () => {
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/qr`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg.trimStart()).toStartWith("<svg");
  });
});
