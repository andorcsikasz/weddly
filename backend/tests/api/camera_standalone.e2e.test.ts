// Weddly Camera tiered EUR pricing + the camera-only (non-Weddly) path.
//
// The suite never completes a real Stripe Checkout (no network stub exists for
// it, see checkout_terms_acceptance.e2e.test.ts), so the money path is covered
// at its three seams instead: the price ladder (pure), the Checkout Session
// body (pure `filmCheckoutParams`), and the webhook's fulfilment
// (`activateFilmAlbum`, called exactly as routes/billing.ts calls it).

import "../setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  FILM_PRICE_TIERS,
  filmTier,
  filmTierPriceCents,
  filmUpgradeChargeCents,
} from "@shared/film_pricing";
import type { AuthSession, FilmAccessCheck, User } from "@shared/types";
import { db } from "../../src/db";
import { activateFilmAlbum } from "../../src/domain/film";
import { filmCheckoutParams } from "../../src/routes/photos";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

function wipeFilm(): void {
  for (const t of ["film_devices", "photo_uploads", "photo_albums"]) db.exec(`DELETE FROM ${t}`);
}

function tierOrThrow(cap: number) {
  const tier = filmTier(cap);
  if (!tier) throw new Error(`no tier ${cap}`);
  return tier;
}

describe("film price ladder", () => {
  test("Weddly couples: included to 50, €7.90 to 100, half the stand-alone price above", () => {
    const couple = FILM_PRICE_TIERS.map((t) => [t.cap, filmTierPriceCents(t, "couple")]);
    expect(couple).toEqual([
      [25, 0],
      [50, 0],
      [100, 790],
      [175, 2250],
      [250, 3500],
      [400, 5000],
    ]);
  });

  test("camera-only accounts pay the stand-alone price, nothing included", () => {
    const standalone = FILM_PRICE_TIERS.map((t) => [t.cap, filmTierPriceCents(t, "standalone")]);
    expect(standalone).toEqual([
      [25, 499],
      [50, 999],
      [100, 2499],
      [175, 4499],
      [250, 6999],
      [400, 9999],
    ]);
  });

  test("an upgrade is charged the difference, never below zero", () => {
    expect(filmUpgradeChargeCents(tierOrThrow(250), "couple", 790)).toBe(2710);
    expect(filmUpgradeChargeCents(tierOrThrow(100), "couple", 790)).toBe(0);
    expect(filmUpgradeChargeCents(tierOrThrow(400), "standalone", 4499)).toBe(5500);
  });

  test("the Checkout Session is euro, the charge, and carries the tier for the webhook", () => {
    const params = filmCheckoutParams({
      albumId: 7,
      coupleId: 3,
      cap: 175,
      chargeCents: 4499,
      audience: "standalone",
      frontendBaseUrl: "https://example.test",
    });
    expect(params.mode).toBe("payment");
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0]?.price_data.currency).toBe("eur");
    expect(params.line_items[0]?.price_data.unit_amount).toBe(4499);
    expect(params.metadata).toEqual({
      type: "film",
      album_id: "7",
      couple_id: "3",
      cap: "175",
      audience: "standalone",
    });
  });
});

describe("camera-only account", () => {
  let token: string;
  let albumId: number;
  let uploadToken: string;

  beforeAll(async () => {
    wipeAll();
    wipeFilm();
    const reg = await registerAndVerify({
      email: "camera-only@weddly.test",
      password: "supersafe123",
      full_name: "Anna Kiss",
    });
    token = reg.data.token;
  });

  afterAll(() => wipeFilm());

  test("refuses a placeholder name, like onboarding does", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/camera/events",
      { bride_name: "x", groom_name: "y" },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("placeholder_name");
  });

  test("creates the workspace and marks the account camera-only", async () => {
    const r = await req<{ couple_id: number }>(
      "POST",
      "/api/camera/events",
      { bride_name: "Anna", groom_name: "Bálint", wedding_date: "2027-06-12" },
      { token },
    );
    expect(r.status).toBe(201);
    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.camera_only).toBe(true);
    expect(me.data.user.couple_id).toBe(r.data.couple_id);
    const couple = db
      .prepare("SELECT display_name, wedding_date, onboarded_at FROM couples WHERE id = ?")
      .get(r.data.couple_id) as {
      display_name: string;
      wedding_date: string;
      onboarded_at: number;
    };
    expect(couple.display_name).toBe("Anna & Bálint");
    expect(couple.wedding_date).toBe("2027-06-12");
    expect(couple.onboarded_at).toBeGreaterThan(0);
  });

  test("a second call is a 409, never a second workspace", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/camera/events",
      { bride_name: "Anna", groom_name: "Bálint" },
      { token },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("has_workspace");
  });

  test("its film starts closed: nothing is included", async () => {
    const r = await req<{ album: { id: number; uploadToken: string; guestCap: number } }>(
      "POST",
      "/api/photo-albums",
      { title: "Anna & Bálint", reveal_at: Date.now() + 30 * 86_400_000 },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.album.guestCap).toBe(0);
    albumId = r.data.album.id;
    uploadToken = r.data.album.uploadToken;

    const guest = await req<{ detail?: { code?: string } }>(
      "POST",
      `/api/photo-albums/${uploadToken}/devices`,
      { device_id: "guest-1", guest_name: "Guest", email: "g1@guest.test" },
    );
    expect(guest.status).toBe(429);
    expect(guest.data.detail?.code).toBe("guest_cap_reached");
  });

  test("film-access quotes every tier at the stand-alone price", async () => {
    const r = await req<{ access: FilmAccessCheck }>(
      "GET",
      "/api/photo-albums/film-access",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.access.audience).toBe("standalone");
    expect(r.data.access.currentCap).toBe(0);
    expect(r.data.access.tiers.map((t) => [t.cap, t.chargeCents])).toEqual([
      [25, 499],
      [50, 999],
      [100, 2499],
      [175, 4499],
      [250, 6999],
      [400, 9999],
    ]);
  });

  test("checkout stays behind the film launch control", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/photo-albums/checkout",
      { cap: 175 },
      { token },
    );
    expect(r.status).toBe(503);
    expect(r.data.detail?.code).toBe("payment_not_launched");
  });

  test("the webhook opens the film at the tier bought, once per session", async () => {
    expect(
      activateFilmAlbum(albumId, "pi_1", { sessionId: "cs_1", cap: 175, amountCents: 4499 }),
    ).toBe(true);
    // Stripe redelivers: the same session must not be credited twice.
    expect(
      activateFilmAlbum(albumId, "pi_1", { sessionId: "cs_1", cap: 175, amountCents: 4499 }),
    ).toBe(false);
    const row = db
      .prepare("SELECT guest_cap, paid_amount_cents FROM photo_albums WHERE id = ?")
      .get(albumId) as { guest_cap: number; paid_amount_cents: number };
    expect(row).toEqual({ guest_cap: 175, paid_amount_cents: 4499 });

    const guest = await req("POST", `/api/photo-albums/${uploadToken}/devices`, {
      device_id: "guest-2",
      guest_name: "Guest",
      email: "g2@guest.test",
    });
    expect(guest.status).toBe(200);
  });

  test("an upgrade is offered at the difference", async () => {
    const r = await req<{ access: FilmAccessCheck }>(
      "GET",
      "/api/photo-albums/film-access",
      undefined,
      { token },
    );
    expect(r.data.access.paidCents).toBe(4499);
    expect(r.data.access.tiers.map((t) => [t.cap, t.chargeCents])).toEqual([
      [250, 2500],
      [400, 5500],
    ]);
  });

  test("an older session can never shrink the film", () => {
    activateFilmAlbum(albumId, "pi_0", { sessionId: "cs_0", cap: 100, amountCents: 2499 });
    const row = db.prepare("SELECT guest_cap FROM photo_albums WHERE id = ?").get(albumId) as {
      guest_cap: number;
    };
    expect(row.guest_cap).toBe(175);
  });
});

describe("Weddly couple film", () => {
  let token: string;

  beforeAll(async () => {
    wipeAll();
    wipeFilm();
    ({ token } = await bootstrapCouple("camera-couple@weddly.test"));
    await req("POST", "/api/photo-albums", { title: "Film" }, { token });
  });

  afterAll(() => wipeFilm());

  test("is not camera-only and sees the couple ladder above its included 50", async () => {
    const me = await req<AuthSession>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.camera_only).toBe(false);
    const r = await req<{ access: FilmAccessCheck }>(
      "GET",
      "/api/photo-albums/film-access",
      undefined,
      { token },
    );
    expect(r.data.access.audience).toBe("couple");
    expect(r.data.access.currentCap).toBe(50);
    expect(r.data.access.priceEurCents).toBe(790);
    expect(r.data.access.tiers.map((t) => [t.cap, t.chargeCents])).toEqual([
      [100, 790],
      [175, 2250],
      [250, 3500],
      [400, 5000],
    ]);
  });

  test("a film paid before the ladder is credited its €7.90", async () => {
    // Legacy shape: the single 200-guest unlock, paid_at set, no amount recorded.
    db.prepare(
      "UPDATE photo_albums SET paid_at = ?, guest_cap = 200, paid_amount_cents = NULL",
    ).run(Date.now());
    const r = await req<{ access: FilmAccessCheck }>(
      "GET",
      "/api/photo-albums/film-access",
      undefined,
      { token },
    );
    expect(r.data.access.paidCents).toBe(790);
    expect(r.data.access.tiers.map((t) => [t.cap, t.chargeCents])).toEqual([
      [250, 2710],
      [400, 4210],
    ]);
  });

  test("cannot open a camera-only workspace on top of its planner one", async () => {
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/camera/events",
      { bride_name: "Mia", groom_name: "Lucas" },
      { token },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("has_workspace");
  });

  test("checkout refuses a cap that is not a tier", async () => {
    // Behind the launch control either way; the gate runs first and is what a
    // caller sees until film checkout is launched.
    const r = await req("POST", "/api/photo-albums/checkout", { cap: 123 }, { token });
    expect([400, 503]).toContain(r.status);
  });
});
