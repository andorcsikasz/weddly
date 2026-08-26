import "../setup";
import { FILM_TIER_CAPS, FILM_TIER_PRICE_EUR_CENTS } from "@shared/types";
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
    const r = await req<{ album: { uploadToken: string; id: number; guestCap: number } }>(
      "POST",
      "/api/photo-albums",
      { title: "Our Film", shots_per_guest: 5, film_aesthetic: "natural" },
      { token },
    );
    expect(r.status).toBe(201);
    expect(typeof r.data.album.uploadToken).toBe("string");
    expect(r.data.album.uploadToken.length).toBeGreaterThan(0);
    expect(r.data.album.guestCap).toBe(FILM_TIER_CAPS.free);
    albumToken = r.data.album.uploadToken;
  });

  test("included capacity and the one-time unlock stay generous and low-cost", async () => {
    const r = await req<{
      access: { free: boolean; priceEurCents: number; checkoutEnabled: boolean };
    }>("GET", "/api/photo-albums/film-access", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.access.free).toBe(false);
    expect(r.data.access.priceEurCents).toBe(FILM_TIER_PRICE_EUR_CENTS.paid);
    expect(r.data.access.priceEurCents).toBe(790);
    expect(FILM_TIER_CAPS.free).toBe(25);
    expect(FILM_TIER_CAPS.paid).toBe(200);
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
      { device_id: "test-device-1", guest_name: "Ana", email: "ana@guest.test" },
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

  test("naming a device for the first time without an email is rejected", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "no-email-device", guest_name: "Someone" },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("email_required");
  });

  test("a malformed email is rejected", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "bad-email-device", guest_name: "Someone", email: "not-an-email" },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("invalid_email");
  });

  test("the anonymous pre-check registration (no name yet) never requires an email", async () => {
    const r = await req<{ album: object; shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "not-yet-named-device" },
    );
    expect(r.status).toBe(200);
  });

  test("a returning guest named before email was required stays grandfathered in", async () => {
    const albumId = (
      db.prepare("SELECT id FROM photo_albums WHERE upload_token = ?").get(albumToken) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO film_devices (album_id, device_id, guest_name, guest_name_key, joined_at, source)
       VALUES (?, 'legacy-named-device', 'Old Guest', 'old guest', ?, 'guest')`,
    ).run(albumId, Date.now());

    // Reopening the link resends the same stored name and no email — exactly
    // what the frontend's passive reload call does.
    const r = await req<{ shotCount: number }>("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "legacy-named-device",
      guest_name: "Old Guest",
    });
    expect(r.status).toBe(200);
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

async function guestUpload(
  albumPath: string,
  deviceId: string,
  claimedGuestName?: string,
): Promise<Response> {
  const fd = new FormData();
  fd.append("file", new File([FAKE_JPEG], "p.jpg", { type: "image/jpeg" }));
  fd.append("device_id", deviceId);
  if (claimedGuestName !== undefined) fd.append("guest_name", claimedGuestName);
  return fetch(`${BASE}/api/photo-albums/${albumPath}/photos`, { method: "POST", body: fd });
}

// Simulates a device that named itself before email became mandatory — a
// direct row insert rather than a call through POST /devices, exactly like
// the pre-existing 'couple-legacy-session' seed elsewhere in this file. Real
// production rows in this shape predate the email column entirely.
function insertLegacyGuestDevice(albumToken: string, deviceId: string, guestName: string): void {
  const albumId = (
    db.prepare("SELECT id FROM photo_albums WHERE upload_token = ?").get(albumToken) as {
      id: number;
    }
  ).id;
  const nameKey = guestName.trim().normalize("NFKC").toLocaleLowerCase("hu");
  db.prepare(
    `INSERT INTO film_devices (album_id, device_id, guest_name, guest_name_key, joined_at, source)
     VALUES (?, ?, ?, ?, ?, 'guest')`,
  ).run(albumId, deviceId, guestName, nameKey, Date.now());
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
      await req("POST", `/api/photo-albums/${albumToken}/devices`, {
        device_id: d,
        guest_name: d,
        email: `${d}@guest.test`,
      });
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
    // Both sessions are legacy (no email on file) — grouping falls back to the
    // same Hungarian-locale-folded name key it always used.
    insertLegacyGuestDevice(albumToken, "ana-phone", "Ana");
    insertLegacyGuestDevice(albumToken, "ana-tablet", " ana ");
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

  test("the cap counts guests, an impostor can't free-ride a legacy name, and removal frees the slot", async () => {
    db.prepare("UPDATE photo_albums SET guest_cap = 1 WHERE upload_token = ?").run(albumToken);

    // A brand-new device naming itself "ANA" has no way to prove it is the
    // SAME Ana as the legacy, email-less group above (that group gave no
    // email to match against) — so it is correctly treated as a second,
    // distinct guest and refused at the cap. This is the exact mix-up email
    // identity exists to prevent.
    const impostor = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "ana-laptop", guest_name: "ANA", email: "ana-laptop@guest.test" },
    );
    expect(impostor.status).toBe(429);
    expect(impostor.data.detail?.code).toBe("guest_cap_reached");

    const otherGuest = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "bea-phone", guest_name: "Bea", email: "bea@guest.test" },
    );
    expect(otherGuest.status).toBe(429);
    expect(otherGuest.data.detail?.code).toBe("guest_cap_reached");

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

    // With the slot free, a genuinely new guest can now join.
    const nowFits = await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "bea-phone",
      guest_name: "Bea",
      email: "bea@guest.test",
    });
    expect(nowFits.status).toBe(200);
  });
});

// ── Feature B3: guest identity is keyed by email, not name ────────────────────
// This is the core of the "avoid multiple logins with the same name" ask:
// two different people sharing a first name must never be merged into one
// guest, and the same guest reopening the link on a second device must be
// recognized as themselves even if they retype their name differently.

describe("guest identity by email", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    ({ token } = await bootstrapCouple("guest-email-identity@weddly.test"));
    albumToken = await createAlbum(token);
  });

  afterAll(() => wipeFilm());

  test("two guests who share a first name but give different emails are not merged", async () => {
    const first = await req<{ shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "anna-1", guest_name: "Anna", email: "anna.kovacs@guest.test" },
    );
    expect(first.status).toBe(200);
    const second = await req<{ shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "anna-2", guest_name: "Anna", email: "anna.szabo@guest.test" },
    );
    expect(second.status).toBe(200);

    const album = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(album.data.album.participantCount).toBe(2);
  });

  test("the same guest reopening on a second device (retyped name, same email) is recognized as one guest", async () => {
    const secondDevice = await req<{ shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "anna-1-tablet", guest_name: "anna", email: " Anna.Kovacs@Guest.test " },
    );
    expect(secondDevice.status).toBe(200);

    const album = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    // Still 2 — the retyped session joined Anna Kovács, not a third guest.
    expect(album.data.album.participantCount).toBe(2);

    const list = await req<{ devices: Array<{ email: string | null; sessionCount: number }> }>(
      "GET",
      "/api/photo-albums/current/devices",
      undefined,
      { token },
    );
    const kovacs = list.data.devices.find((d) => d.email === "anna.kovacs@guest.test");
    expect(kovacs?.sessionCount).toBe(2);
  });
});

describe("per-guest quota and canonical attribution", () => {
  let token: string;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    ({ token } = await bootstrapCouple("guest-quota@weddly.test"));
    albumToken = await createAlbum(token);
    db.prepare("UPDATE photo_albums SET shots_per_guest = 2 WHERE upload_token = ?").run(
      albumToken,
    );
  });

  afterAll(() => wipeFilm());

  test("same-email sessions share one limit and uploads use the registered name", async () => {
    const firstRegistration = await req<{ shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "nora-phone", guest_name: "Nóra", email: "nora@guest.test" },
    );
    expect(firstRegistration.status).toBe(200);
    expect(firstRegistration.data.shotCount).toBe(0);

    const firstUpload = await guestUpload(albumToken, "nora-phone", "Másik vendég");
    expect(firstUpload.status).toBe(201);
    expect(((await firstUpload.json()) as { shotCount: number }).shotCount).toBe(1);

    // Reopens on a second device: retypes the name with different casing and
    // whitespace, but the email — now the primary identity — is the same one,
    // just cased differently, exactly as autocapitalize on a phone would do.
    const secondRegistration = await req<{ shotCount: number }>(
      "POST",
      `/api/photo-albums/${albumToken}/devices`,
      { device_id: "nora-tablet", guest_name: " nÓRA ", email: "Nora@Guest.test" },
    );
    expect(secondRegistration.status).toBe(200);
    expect(secondRegistration.data.shotCount).toBe(1);

    const secondUpload = await guestUpload(albumToken, "nora-tablet", "Hamis név");
    expect(secondUpload.status).toBe(201);
    expect(((await secondUpload.json()) as { shotCount: number }).shotCount).toBe(2);

    const overLimit = await guestUpload(albumToken, "nora-phone");
    expect(overLimit.status).toBe(429);
    expect(((await overLimit.json()) as { detail?: { code?: string } }).detail?.code).toBe(
      "shot_limit",
    );

    const storedNames = db
      .prepare(
        `SELECT DISTINCT guest_name AS guestName
           FROM photo_uploads
          WHERE album_id = (SELECT id FROM photo_albums WHERE upload_token = ?)
          ORDER BY guest_name`,
      )
      .all(albumToken) as Array<{ guestName: string | null }>;
    expect(storedNames.map((row) => row.guestName)).toEqual(["Nóra", "nÓRA"]);

    const current = await req<{ album: { participantCount: number } }>(
      "GET",
      "/api/photo-albums/current",
      undefined,
      { token },
    );
    expect(current.data.album.participantCount).toBe(1);
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

// ── Feature D: email guests their own photos ───────────────────────────────────

function emailLogCount(coupleId: number, kind: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM email_log WHERE couple_id = ? AND kind = ?")
    .get(coupleId, kind) as { n: number };
  return row.n;
}

describe("email guests their photos", () => {
  let token: string;
  let coupleId: number;
  let albumToken: string;

  beforeAll(async () => {
    wipeFilm();
    const bootstrapped = await bootstrapCouple("email-guests@weddly.test");
    token = bootstrapped.token;
    coupleId = bootstrapped.coupleId;
    albumToken = await createAlbum(token);

    // Contributed and gave an email — the target audience.
    await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "sent-1",
      guest_name: "Anna",
      email: "anna@guest.test",
    });
    expect((await guestUpload(albumToken, "sent-1")).status).toBe(201);

    // Registered, gave an email, but never actually shot anything — must not
    // be told "your shot is in there" when it isn't.
    await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "no-photo-1",
      guest_name: "Bea",
      email: "bea@guest.test",
    });

    // A legacy, email-less device that DID contribute — can't be reached at all.
    const albumId = (
      db.prepare("SELECT id FROM photo_albums WHERE upload_token = ?").get(albumToken) as {
        id: number;
      }
    ).id;
    db.prepare(
      `INSERT INTO film_devices (album_id, device_id, guest_name, guest_name_key, joined_at, source)
       VALUES (?, 'legacy-1', 'Csilla', 'csilla', ?, 'guest')`,
    ).run(albumId, Date.now());
    expect((await guestUpload(albumToken, "legacy-1")).status).toBe(201);
  });

  afterAll(() => wipeFilm());

  test("refuses to send before the reveal", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/photo-albums/current/email-guests",
      {},
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("not_revealed");
    expect(emailLogCount(coupleId, "guest_photos_ready")).toBe(0);
  });

  test("mails only the contributing, emailed guest — once", async () => {
    db.exec(`UPDATE photo_albums SET reveal_at = 1 WHERE upload_token = '${albumToken}'`);

    const first = await req<{ sent: number; alreadyEmailed: number }>(
      "POST",
      "/api/photo-albums/current/email-guests",
      {},
      { token },
    );
    expect(first.status).toBe(200);
    expect(first.data.sent).toBe(1);
    expect(first.data.alreadyEmailed).toBe(0);
    expect(emailLogCount(coupleId, "guest_photos_ready")).toBe(1);

    // A second round reaches nobody new — Anna is already marked, Bea has no
    // photo, Csilla has no email.
    const second = await req<{ sent: number; alreadyEmailed: number }>(
      "POST",
      "/api/photo-albums/current/email-guests",
      {},
      { token },
    );
    expect(second.status).toBe(200);
    expect(second.data.sent).toBe(0);
    expect(second.data.alreadyEmailed).toBe(1);
    expect(emailLogCount(coupleId, "guest_photos_ready")).toBe(1);
  });

  test("a guest who joins and contributes afterward is caught by the next round", async () => {
    await req("POST", `/api/photo-albums/${albumToken}/devices`, {
      device_id: "sent-2",
      guest_name: "Dóra",
      email: "dora@guest.test",
    });
    expect((await guestUpload(albumToken, "sent-2")).status).toBe(201);

    const r = await req<{ sent: number; alreadyEmailed: number }>(
      "POST",
      "/api/photo-albums/current/email-guests",
      {},
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.sent).toBe(1);
    expect(r.data.alreadyEmailed).toBe(1);
    expect(emailLogCount(coupleId, "guest_photos_ready")).toBe(2);
  });
});
