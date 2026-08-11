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
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array<number>(100).fill(0)]);
// ISO BMFF `ftyp` + HEIC major brand. It is intentionally not a decodable
// photo: the upload pipeline only needs the real format signature to route the
// guest to conversion guidance before storage.
const FAKE_HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
  0x68, 0x65, 0x69, 0x63,
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

  test("POST /api/photo-albums/checkout is blocked by the film launch control", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/photo-albums/checkout",
      {},
      { token },
    );
    expect(r.status).toBe(503);
    expect(r.data.detail?.code).toBe("payment_not_launched");
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

  test("host preview is authenticated, owner-scoped, and does not register a participant", async () => {
    const unauthenticated = await req("GET", `/api/photo-albums/${albumToken}/preview`);
    expect(unauthenticated.status).toBe(401);

    const { token: otherWorkspaceToken } = await bootstrapCouple("film-preview-other@weddly.test");
    const wrongOwner = await req("GET", `/api/photo-albums/${albumToken}/preview`, undefined, {
      token: otherWorkspaceToken,
    });
    expect(wrongOwner.status).toBe(404);

    // Preview remains useful while the real guest film is closed. The response
    // reports the real setting, while the frontend renders an inert simulation.
    db.prepare("UPDATE photo_albums SET is_upload_enabled = 0 WHERE upload_token = ?").run(
      albumToken,
    );
    const preview = await req<{
      album: { isUploadEnabled: boolean };
      shotCount: number;
      readOnly: boolean;
    }>("GET", `/api/photo-albums/${albumToken}/preview`, undefined, { token });
    expect(preview.status).toBe(200);
    expect(preview.data.album.isUploadEnabled).toBe(false);
    expect(preview.data.shotCount).toBe(0);
    expect(preview.data.readOnly).toBe(true);

    const current = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(current.data.album.participantCount).toBe(0);
    db.prepare("UPDATE photo_albums SET is_upload_enabled = 1 WHERE upload_token = ?").run(
      albumToken,
    );
  });

  test("owner can rotate the guest link, revoking both the old token and custom slug", async () => {
    const slugPatch = await req<{ album: { slug: string } }>(
      "PATCH",
      "/api/photo-albums/current",
      { slug: "rotate-me" },
      { token },
    );
    expect(slugPatch.status).toBe(200);
    const oldToken = albumToken;

    const missingConfirmation = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/photo-albums/current/rotate-link",
      {},
      { token },
    );
    expect(missingConfirmation.status).toBe(400);
    expect(missingConfirmation.data.detail?.code).toBe("rotation_confirmation_required");

    const rotated = await req<{
      album: { uploadToken: string; slug: null };
      previousLinkInvalidated: boolean;
    }>(
      "POST",
      "/api/photo-albums/current/rotate-link",
      { confirmation: "ROTATE_GUEST_LINK" },
      { token },
    );
    expect(rotated.status).toBe(200);
    expect(rotated.data.previousLinkInvalidated).toBe(true);
    expect(rotated.data.album.slug).toBeNull();
    expect(rotated.data.album.uploadToken).not.toBe(oldToken);
    albumToken = rotated.data.album.uploadToken;

    expect((await req("GET", `/api/photo-albums/${oldToken}`)).status).toBe(404);
    expect((await req("GET", "/api/photo-albums/rotate-me")).status).toBe(404);
    expect((await req("GET", `/api/photo-albums/${oldToken}/qr`)).status).toBe(404);
    expect((await req("GET", `/api/photo-albums/${albumToken}`)).status).toBe(200);
  });

  test("preview-marked device registration is rejected without mutating the film", async () => {
    const blocked = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices?preview=1`,
      { device_id: "preview-device", guest_name: "Host" },
      { token },
    );
    expect(blocked.status).toBe(403);
    expect(blocked.data.detail?.code).toBe("preview_read_only");

    const row = db
      .prepare("SELECT COUNT(*) AS c FROM film_devices WHERE device_id = 'preview-device'")
      .get() as { c: number };
    expect(row.c).toBe(0);
  });

  test("guest registration cannot claim a couple-owned legacy device session", async () => {
    const albumId = (
      db.prepare("SELECT id FROM photo_albums WHERE upload_token = ?").get(albumToken) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO film_devices (album_id, device_id, guest_name, joined_at, source)
       VALUES (?, 'couple-reserved', 'The couple', ?, 'couple')`,
    ).run(albumId, Date.now());

    const blocked = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "couple-reserved", guest_name: "Guest" },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.data.detail?.code).toBe("device_id_unavailable");
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

  test("preview-marked photo upload is rejected before any file is persisted", async () => {
    const fd = new FormData();
    fd.append("file", new File([FAKE_JPEG], "preview.jpg", { type: "image/jpeg" }));
    fd.append("device_id", "test-device-1");
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/photos?preview=1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("preview_read_only");

    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = (SELECT id FROM photo_albums WHERE upload_token = ?)",
      )
      .get(albumToken) as { c: number };
    expect(row.c).toBe(0);
  });

  test("HEIC uploads return specific conversion guidance and are not persisted", async () => {
    const fd = new FormData();
    fd.append("file", new File([FAKE_HEIC], "iphone.heic", { type: "image/heic" }));
    fd.append("device_id", "test-device-1");
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/photos`, {
      method: "POST",
      body: fd,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("heic_not_supported");

    const row = db
      .prepare(
        "SELECT COUNT(*) AS c FROM photo_uploads WHERE album_id = (SELECT id FROM photo_albums WHERE upload_token = ?)",
      )
      .get(albumToken) as { c: number };
    expect(row.c).toBe(0);
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
    const body = (await res.json()) as {
      upload: { id: number; fileUrl: string };
      shotCount: number;
    };
    expect(body.shotCount).toBe(1);
    expect(typeof body.upload.fileUrl).toBe("string");

    // The stored path must NOT be walkable. It used to be
    // `couples/<coupleId>/photos/<albumId>/<uploadId>.jpg`, three sequential
    // integers, so a stranger could enumerate any couple's album straight off
    // the public /uploads/ handler and skip both the unguessable upload_token
    // and the reveal lock. The random segment is what makes the URL itself the
    // credential.
    const url = body.upload.fileUrl;
    expect(url.startsWith("/uploads/couples/")).toBe(true);
    const file = url.split("/").pop() ?? "";
    expect(file).not.toBe(`${body.upload.id}.jpg`);
    // <uploadId>-<32 hex chars>.jpg
    expect(/^\d+-[0-9a-f]{32}\.jpg$/.test(file)).toBe(true);

    // And it really is served from that path (the key and the stored URL agree).
    const fetched = await fetch(`${BASE}${url}`);
    expect(fetched.status).toBe(200);
    await fetched.arrayBuffer();
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
    db.exec(`UPDATE photo_albums SET reveal_at = 1 WHERE upload_token = '${albumToken}'`);
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

  // The download link saves this as guest-qr.png, so the bytes have to BE a PNG —
  // serving SVG under that name is what made macOS Preview refuse to open it.
  test("GET /:token/qr returns a real PNG", async () => {
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/qr`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("GET /:token/qr?format=svg still returns SVG", async () => {
    const res = await fetch(`${BASE}/api/photo-albums/${albumToken}/qr?format=svg`);
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") ?? "";
    expect(ct).toContain("image/svg+xml");
    const svg = await res.text();
    expect(svg.trimStart()).toStartWith("<svg");
  });
});

// ── helpers shared by the feature blocks ───────────────────────────────────────

async function createAlbum(token: string): Promise<string> {
  const r = await req<{ album: { uploadToken: string } }>(
    "POST",
    "/api/photo-albums",
    { title: "Film", film_aesthetic: "natural" },
    { token },
  );
  return r.data.album.uploadToken;
}

async function guestUpload(albumPath: string, deviceId: string): Promise<Response> {
  const fd = new FormData();
  fd.append("file", new File([FAKE_JPEG], "p.jpg", { type: "image/jpeg" }));
  fd.append("device_id", deviceId);
  return fetch(`${BASE}/api/photo-albums/${albumPath}/photos`, { method: "POST", body: fd });
}

// ── Feature A: custom guest-link slug (#17) ────────────────────────────────────

describe("film slug (#17)", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    ({ token } = await bootstrapCouple("slug@weddly.test"));
    albumToken = await createAlbum(token);
  });

  afterAll(() => wipeFilm());

  test("a valid slug resolves the same album as the token", async () => {
    const patch = await req<{ album: { slug: string } }>(
      "PATCH",
      "/api/photo-albums/current",
      { slug: "Our-Wedding!!" },
      { token },
    );
    expect(patch.status).toBe(200);
    // Normalized: lowercased, illegal chars collapsed to a single trailing hyphen, trimmed.
    expect(patch.data.album.slug).toBe("our-wedding");

    const bySlug = await req<{ album: { slug: string; displayName: string } }>(
      "GET",
      "/api/photo-albums/our-wedding",
    );
    const byToken = await req<{ album: { slug: string; displayName: string } }>(
      "GET",
      `/api/photo-albums/${albumToken}`,
    );
    expect(bySlug.status).toBe(200);
    expect(byToken.status).toBe(200);
    expect(bySlug.data.album.displayName).toBe(byToken.data.album.displayName);
    expect(bySlug.data.album.slug).toBe("our-wedding");
    // The canonical token must keep resolving after a slug is set.
    expect(byToken.data.album.slug).toBe("our-wedding");
  });

  test("an invalid slug is rejected with 400", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "PATCH",
      "/api/photo-albums/current",
      { slug: "ab" },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("slug_invalid");
  });

  test("a second album taking the same slug is rejected with 409", async () => {
    const { token: token2 } = await bootstrapCouple("slug2@weddly.test");
    await createAlbum(token2);
    const r = await req<{ detail?: { code?: string } }>(
      "PATCH",
      "/api/photo-albums/current",
      { slug: "our-wedding" },
      { token: token2 },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("slug_taken");
  });
});

// ── Feature B: participant soft-remove (#6) ────────────────────────────────────

describe("participant soft-remove (#6)", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    ({ token } = await bootstrapCouple("remove@weddly.test"));
    albumToken = await createAlbum(token);
    for (const d of ["dev-a", "dev-b"]) {
      await req("POST", `/api/photo-albums/${albumToken}/devices`, { device_id: d, guest_name: d });
    }
  });

  afterAll(() => wipeFilm());

  test("soft-remove drops the device from the list and the participant count", async () => {
    let list = await req<{ devices: { deviceId: string }[]; total: number }>(
      "GET",
      "/api/photo-albums/current/devices",
      undefined,
      { token },
    );
    expect(list.data.total).toBe(2);

    const del = await req<{ removed: boolean }>(
      "DELETE",
      "/api/photo-albums/current/devices/dev-a",
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.removed).toBe(true);

    list = await req<{ devices: { deviceId: string }[]; total: number }>(
      "GET",
      "/api/photo-albums/current/devices",
      undefined,
      { token },
    );
    expect(list.data.total).toBe(1);
    expect(list.data.devices.map((d) => d.deviceId)).not.toContain("dev-a");

    const album = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(album.data.album.participantCount).toBe(1);
  });

  test("a removed device cannot re-register or upload", async () => {
    const reReg = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "dev-a" },
    );
    expect(reReg.status).toBe(403);
    expect(reReg.data.detail?.code).toBe("device_removed");

    const up = await guestUpload(albumToken, "dev-a");
    expect(up.status).toBe(403);
    const body = (await up.json()) as { detail?: { code?: string } };
    expect(body.detail?.code).toBe("device_removed");
  });

  test("purgePhotos hides the removed device's photos from the public reveal", async () => {
    // dev-b uploads, then gets removed with purge; its photo must vanish.
    const upB = await guestUpload(albumToken, "dev-b");
    expect(upB.status).toBe(201);

    const del = await req<{ purgedCount: number }>(
      "DELETE",
      "/api/photo-albums/current/devices/dev-b?purgePhotos=true",
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.purgedCount).toBe(1);

    // Unlock the reveal so the public photo list returns rows.
    db.exec(`UPDATE photo_albums SET reveal_at = 1 WHERE upload_token = '${albumToken}'`);
    const photos = await req<{ locked: boolean; total: number }>(
      "GET",
      `/api/photo-albums/${albumToken}/photos`,
    );
    expect(photos.data.locked).toBe(false);
    expect(photos.data.total).toBe(0);
  });
});

// ── Feature B2: guest participant identity (F-03/F-19) ────────────────────────

describe("guest participant aggregation", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    ({ token } = await bootstrapCouple("guest-count@weddly.test"));
    albumToken = await createAlbum(token);
  });

  afterAll(() => wipeFilm());

  test("named sessions merge into one guest and couple sessions stay excluded", async () => {
    await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "ana-phone",
      guest_name: "Ana",
    });
    await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "ana-tablet",
      guest_name: " ana ",
    });
    expect((await guestUpload(albumToken, "ana-phone")).status).toBe(201);
    expect((await guestUpload(albumToken, "ana-tablet")).status).toBe(201);

    const albumId = (
      db.prepare("SELECT id FROM photo_albums WHERE upload_token = ?").get(albumToken) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO film_devices (album_id, device_id, guest_name, joined_at, source)
       VALUES (?, 'couple-legacy-session', 'The couple', ?, 'couple')`,
    ).run(albumId, Date.now());

    const list = await req<{
      devices: Array<{
        deviceId: string;
        guestName: string;
        shotCount: number;
        sessionCount: number;
      }>;
      total: number;
    }>("GET", "/api/photo-albums/current/devices", undefined, { token });
    expect(list.status).toBe(200);
    expect(list.data.total).toBe(1);
    expect(list.data.devices).toHaveLength(1);
    expect(list.data.devices[0]?.guestName.toLowerCase()).toBe("ana");
    expect(list.data.devices[0]?.shotCount).toBe(2);
    expect(list.data.devices[0]?.sessionCount).toBe(2);

    const album = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(album.data.album.participantCount).toBe(1);
  });

  test("the cap counts guests and removing a merged guest removes every session", async () => {
    db.prepare("UPDATE photo_albums SET guest_cap = 1 WHERE upload_token = ?").run(albumToken);

    // Ana is already counted, so another named session is allowed at the cap.
    const anotherSession = await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "ana-laptop",
      guest_name: "ANA",
    });
    expect(anotherSession.status).toBe(200);

    const otherGuest = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "bea-phone", guest_name: "Bea" },
    );
    expect(otherGuest.status).toBe(429);
    expect(otherGuest.data.detail?.code).toBe("guest_cap_reached");

    const splitExistingGuest = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "ana-laptop", guest_name: "Bea" },
    );
    expect(splitExistingGuest.status).toBe(429);
    expect(splitExistingGuest.data.detail?.code).toBe("guest_cap_reached");

    const list = await req<{ devices: Array<{ deviceId: string }>; total: number }>(
      "GET",
      "/api/photo-albums/current/devices",
      undefined,
      { token },
    );
    const representativeId = list.data.devices[0]?.deviceId;
    expect(representativeId).toBeTruthy();
    const removed = await req<{ removed: boolean }>(
      "DELETE",
      `/api/photo-albums/current/devices/${encodeURIComponent(representativeId ?? "")}`,
      undefined,
      { token },
    );
    expect(removed.status).toBe(200);

    const activeAnaSessions = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM film_devices
            WHERE album_id = (SELECT id FROM photo_albums WHERE upload_token = ?)
              AND source = 'guest' AND removed_at IS NULL`,
        )
        .get(albumToken) as { c: number }
    ).c;
    expect(activeAnaSessions).toBe(0);

    const album = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(album.data.album.participantCount).toBe(0);
  });
});

// ── Feature C: couple-upload source tag (#11) ──────────────────────────────────

describe("couple-upload source tag (#11)", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    ({ token } = await bootstrapCouple("source@weddly.test"));
    albumToken = await createAlbum(token);
  });

  afterAll(() => wipeFilm());

  test("couple uploads tag 'couple' and guest uploads tag 'guest'", async () => {
    // Couple upload (authenticated multipart).
    const fdCouple = new FormData();
    fdCouple.append("file", new File([FAKE_JPEG], "c.jpg", { type: "image/jpeg" }));
    const coupleRes = await fetch(`${BASE}/api/photo-albums/current/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fdCouple,
    });
    expect(coupleRes.status).toBe(201);

    // Guest upload.
    await req("POST", `/api/photo-albums/${albumToken}/devices`, { device_id: "g1" });
    const guestRes = await guestUpload(albumToken, "g1");
    expect(guestRes.status).toBe(201);

    const list = await req<{ uploads: { source: string }[] }>(
      "GET",
      "/api/photo-albums/current/photos",
      undefined,
      { token },
    );
    const sources = list.data.uploads.map((u) => u.source).sort();
    expect(sources).toEqual(["couple", "guest"]);
  });
});
