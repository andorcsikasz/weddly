// Weddly Camera tryout codes: an admin mints a code for a guest tier, a
// camera-only customer redeems it, and their film opens to guests with no
// payment. The rules pinned here are the ones in domain/film_codes.ts that
// would be expensive to get wrong quietly: money columns untouched, a code
// spent once per film and only up to its limit, a dead code refused, and a
// code that would not raise the cap refused rather than wasted.

import "../setup";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { FilmPromoCode } from "@shared/types";
import { db } from "../../src/db";
import { normalizeFilmCode } from "../../src/domain/film_codes";
import { registerAndVerify, req, wipeAll } from "../helpers";

function wipeFilm(): void {
  for (const t of [
    "film_promo_redemptions",
    "film_promo_codes",
    "film_devices",
    "photo_uploads",
    "photo_albums",
  ]) {
    db.exec(`DELETE FROM ${t}`);
  }
}

/** A signed-in camera-only customer with a closed (cap 0) film. */
async function cameraCustomer(email: string, names: [string, string]) {
  const reg = await registerAndVerify({ email, password: "supersafe123", full_name: names[0] });
  const token = reg.data.token;
  await req(
    "POST",
    "/api/camera/events",
    { bride_name: names[0], groom_name: names[1] },
    { token },
  );
  const film = await req<{ album: { id: number; uploadToken: string; guestCap: number } }>(
    "POST",
    "/api/photo-albums",
    { title: names.join(" & ") },
    { token },
  );
  return { token, album: film.data.album };
}

function filmRow(albumId: number) {
  return db
    .prepare("SELECT guest_cap, paid_at, paid_amount_cents FROM photo_albums WHERE id = ?")
    .get(albumId) as {
    guest_cap: number;
    paid_at: number | null;
    paid_amount_cents: number | null;
  };
}

let adminToken: string;

async function mint(body: Record<string, unknown>) {
  return req<{ code: FilmPromoCode; detail?: { code?: string } }>(
    "POST",
    "/api/admin/film-codes",
    body,
    { token: adminToken },
  );
}

beforeAll(async () => {
  wipeAll();
  wipeFilm();
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  adminToken = reg.data.token;
});

afterAll(() => wipeFilm());

describe("admin console", () => {
  test("only an admin can mint or list codes", async () => {
    const { token } = await cameraCustomer("not-admin@weddly.test", ["Réka", "Tamás"]);
    const list = await req("GET", "/api/admin/film-codes", undefined, { token });
    expect(list.status).toBe(403);
    const create = await req("POST", "/api/admin/film-codes", { cap: 50 }, { token });
    expect(create.status).toBe(403);
  });

  test("a blank code is generated, readable aloud, and lands active", async () => {
    const r = await mint({ cap: 50 });
    expect(r.status).toBe(201);
    expect(r.data.code.code).toMatch(/^CAM-[2-9A-HJKMNP-Z]{8}$/);
    expect(r.data.code.status).toBe("active");
    expect(r.data.code.max_redemptions).toBe(1);
    expect(r.data.code.redemptions).toBe(0);
  });

  test("a typed code is normalised, and a duplicate is a 409", async () => {
    const first = await mint({ code: " fair 2027 ", cap: 100, max_redemptions: 3 });
    expect(first.status).toBe(201);
    expect(first.data.code.code).toBe("FAIR2027");
    const again = await mint({ code: "fair2027", cap: 100 });
    expect(again.status).toBe(409);
    expect(again.data.detail?.code).toBe("code_taken");
  });

  test("refuses a cap that is not a tier, and a junk code", async () => {
    expect((await mint({ cap: 60 })).data.detail?.code).toBe("invalid_cap");
    expect((await mint({ code: "a!", cap: 50 })).data.detail?.code).toBe("invalid_code");
    expect((await mint({ cap: 50, max_redemptions: 0 })).data.detail?.code).toBe(
      "invalid_max_redemptions",
    );
  });

  test("normalising ignores case and spaces but keeps dashes", () => {
    expect(normalizeFilmCode("cam-ab cd 23")).toBe("CAM-ABCD23");
    expect(normalizeFilmCode("ab")).toBeNull();
    expect(normalizeFilmCode(42)).toBeNull();
  });
});

describe("redeeming", () => {
  test("opens a closed film to the code's tier and touches no money column", async () => {
    const code = (await mint({ code: "TRYOUT-50", cap: 50 })).data.code;
    const { token, album } = await cameraCustomer("bride@weddly.test", ["Anna", "Bálint"]);
    expect(album.guestCap).toBe(0);

    const check = await req<{ cap: number }>(
      "POST",
      "/api/film-codes/check",
      { code: "tryout-50" },
      {
        token,
      },
    );
    expect(check.status).toBe(200);
    expect(check.data.cap).toBe(50);
    // Checking spends nothing.
    expect(filmRow(album.id).guest_cap).toBe(0);

    const r = await req<{ cap: number }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "tryout-50" },
      {
        token,
      },
    );
    expect(r.status).toBe(200);
    expect(r.data.cap).toBe(50);
    expect(filmRow(album.id)).toEqual({ guest_cap: 50, paid_at: null, paid_amount_cents: null });

    // The film really is open: a guest can join now.
    const guest = await req("POST", `/api/photo-albums/${album.uploadToken}/devices`, {
      device_id: "g-1",
      guest_name: "Guest",
      email: "g1@guest.test",
    });
    expect(guest.status).toBe(200);

    const listed = await req<{ codes: FilmPromoCode[] }>(
      "GET",
      "/api/admin/film-codes",
      undefined,
      {
        token: adminToken,
      },
    );
    const row = listed.data.codes.find((c) => c.id === code.id);
    expect(row?.status).toBe("used_up");
    expect(row?.redeemed_by.map((x) => x.email)).toEqual(["bride@weddly.test"]);
  });

  test("a single-use code is spent for everyone after its first film", async () => {
    const { token } = await cameraCustomer("second@weddly.test", ["Kata", "Péter"]);
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "TRYOUT-50" },
      { token },
    );
    expect(r.status).toBe(410);
    expect(r.data.detail?.code).toBe("code_used_up");
  });

  test("a multi-use code counts its films, and one film cannot spend it twice", async () => {
    await mint({ code: "WEDFAIR", cap: 100, max_redemptions: 2 });
    const a = await cameraCustomer("fair-a@weddly.test", ["Lili", "Gergő"]);
    const b = await cameraCustomer("fair-b@weddly.test", ["Nóra", "Dávid"]);
    const c = await cameraCustomer("fair-c@weddly.test", ["Eszter", "Máté"]);

    expect((await req("POST", "/api/film-codes/redeem", { code: "WEDFAIR" }, a)).status).toBe(200);
    const twice = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "WEDFAIR" },
      a,
    );
    expect(twice.status).toBe(409);
    expect(twice.data.detail?.code).toBe("code_already_redeemed");

    expect((await req("POST", "/api/film-codes/redeem", { code: "WEDFAIR" }, b)).status).toBe(200);
    const third = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "WEDFAIR" },
      c,
    );
    expect(third.data.detail?.code).toBe("code_used_up");
    expect(filmRow(c.album.id).guest_cap).toBe(0);
  });

  test("a code that would not raise the cap is refused, not wasted", async () => {
    await mint({ code: "SMALL-25", cap: 25 });
    const { token, album } = await cameraCustomer("big@weddly.test", ["Zsófi", "Ádám"]);
    db.prepare("UPDATE photo_albums SET guest_cap = 100 WHERE id = ?").run(album.id);
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "SMALL-25" },
      { token },
    );
    expect(r.status).toBe(409);
    expect(r.data.detail?.code).toBe("cap_already_covered");
    expect(filmRow(album.id).guest_cap).toBe(100);
    const left = db
      .prepare(
        "SELECT COUNT(*) AS n FROM film_promo_redemptions r JOIN film_promo_codes c ON c.id = r.code_id WHERE c.code = 'SMALL-25'",
      )
      .get() as { n: number };
    expect(left.n).toBe(0);
  });

  test("an expired or revoked code is refused; an unknown one is a 404", async () => {
    await mint({ code: "OLDCODE", cap: 50, expires_at: Date.now() - 1000 });
    const revoked = (await mint({ code: "PULLED", cap: 50 })).data.code;
    const rev = await req<{ code: FilmPromoCode }>(
      "POST",
      `/api/admin/film-codes/${revoked.id}/revoke`,
      undefined,
      { token: adminToken },
    );
    expect(rev.data.code.status).toBe("revoked");

    const { token } = await cameraCustomer("late@weddly.test", ["Bea", "Olivér"]);
    const expired = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/check",
      { code: "OLDCODE" },
      { token },
    );
    expect(expired.status).toBe(410);
    expect(expired.data.detail?.code).toBe("code_expired");
    const pulled = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "PULLED" },
      { token },
    );
    expect(pulled.data.detail?.code).toBe("code_revoked");
    const unknown = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/check",
      { code: "NOPE-NOPE" },
      { token },
    );
    expect(unknown.status).toBe(404);
    expect(unknown.data.detail?.code).toBe("code_not_found");
  });

  test("checking works before a film exists, redeeming needs one", async () => {
    await mint({ code: "EARLYBIRD", cap: 50 });
    const reg = await registerAndVerify({
      email: "early@weddly.test",
      password: "supersafe123",
      full_name: "Hanna Tóth",
    });
    const token = reg.data.token;
    const check = await req<{ cap: number }>(
      "POST",
      "/api/film-codes/check",
      { code: "EARLYBIRD" },
      {
        token,
      },
    );
    expect(check.status).toBe(200);
    expect(check.data.cap).toBe(50);
    const redeem = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/film-codes/redeem",
      { code: "EARLYBIRD" },
      { token },
    );
    expect(redeem.status).toBe(404);
    expect(redeem.data.detail?.code).toBe("no_film");
  });

  test("a later upgrade still pays the full price: a code is not a credit", async () => {
    await mint({ code: "NOCREDIT", cap: 50 });
    const { token } = await cameraCustomer("upgrade@weddly.test", ["Dóra", "Bence"]);
    await req("POST", "/api/film-codes/redeem", { code: "NOCREDIT" }, { token });
    const access = await req<{
      access: { paidCents: number; tiers: { cap: number; chargeCents: number }[] };
    }>("GET", "/api/photo-albums/film-access", undefined, { token });
    expect(access.data.access.paidCents).toBe(0);
    expect(access.data.access.tiers[0]).toEqual({
      cap: 100,
      priceCents: 2499,
      chargeCents: 2499,
    } as never);
  });
});
