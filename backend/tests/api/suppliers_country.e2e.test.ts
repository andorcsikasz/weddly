// Country scoping on `/api/suppliers`. A couple only sees curated venues in
// the country their wedding is in (set at onboarding, defaults "HU"). So a
// Hungarian couple never gets offered a Croatian/Austrian/etc. venue. Logged-
// out callers (and users without a workspace) still see the full catalogue.
//
// The curated DIRECTORY carries the June 2026 international batches (HR/RO/SI
// via a ", XX" city suffix; SK/AT anchored by id in suppliers_data.ts). We
// pin a couple of known ids per country to assert the filter both drops and
// keeps the right rows.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, verifyUserEmail, wipeAll } from "../helpers";

interface DirectoryItem {
  id: string;
  category: string;
  country: string;
}

interface CountryCount {
  code: string;
  count: number;
}

// Stable curated ids per country (see backend/src/domain/suppliers_data.ts).
const HU_VENUE = "aria-hotel-budapest";
const HR_VENUE = "villa-lav-bale";
const RO_VENUE = "ambasador-events-otopeni";
const SI_VENUE = "bled-castle";

/** Register + verify + onboard a couple pinned to `country`, returning the
 *  session token. Mirrors bootstrapCouple but lets the caller pick the
 *  wedding country. */
async function onboardCoupleInCountry(email: string, country: string): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Owner",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const ob = await req(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Mia & Lucas",
      wedding_date: "2026-09-12",
      target_guest_count: 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: [],
      country,
    },
    { token: reg.data.token },
  );
  expect(ob.status).toBe(201);
  return reg.data.token;
}

describe("GET /api/suppliers — country scoping", () => {
  test("anonymous caller sees the full catalogue including foreign venues", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers");
    expect(r.status).toBe(200);
    const ids = new Set(r.data.suppliers.map((s) => s.id));
    expect(ids.has(HU_VENUE)).toBe(true);
    expect(ids.has(HR_VENUE)).toBe(true);
    expect(ids.has(SI_VENUE)).toBe(true);
    // More than one country represented.
    const countries = new Set(r.data.suppliers.map((s) => s.country));
    expect(countries.size).toBeGreaterThan(1);
  });

  test("HU couple only sees Hungarian venues", async () => {
    wipeAll();
    const token = await onboardCoupleInCountry("hu-couple@weddly.test", "HU");
    const r = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.suppliers.length).toBeGreaterThan(0);
    // Every curated row is HU (wipeAll leaves no community entries).
    for (const s of r.data.suppliers) {
      expect(s.country).toBe("HU");
    }
    const ids = new Set(r.data.suppliers.map((s) => s.id));
    expect(ids.has(HU_VENUE)).toBe(true);
    expect(ids.has(HR_VENUE)).toBe(false);
    expect(ids.has(RO_VENUE)).toBe(false);
    expect(ids.has(SI_VENUE)).toBe(false);
  });

  test("Croatian couple sees Croatian venues, not Hungarian ones", async () => {
    wipeAll();
    const token = await onboardCoupleInCountry("hr-couple@weddly.test", "HR");
    const r = await req<{ suppliers: DirectoryItem[] }>("GET", "/api/suppliers", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    for (const s of r.data.suppliers) {
      expect(s.country).toBe("HR");
    }
    const ids = new Set(r.data.suppliers.map((s) => s.id));
    expect(ids.has(HR_VENUE)).toBe(true);
    expect(ids.has(HU_VENUE)).toBe(false);
  });

  test("country scoping composes with the category filter", async () => {
    wipeAll();
    const token = await onboardCoupleInCountry("hu-cat@weddly.test", "HU");
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?category=venue",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    for (const s of r.data.suppliers) {
      expect(s.category).toBe("venue");
      expect(s.country).toBe("HU");
    }
  });

  test("response lists every country in the catalogue with counts", async () => {
    wipeAll();
    const r = await req<{ suppliers: DirectoryItem[]; countries: CountryCount[] }>(
      "GET",
      "/api/suppliers",
    );
    expect(r.status).toBe(200);
    const codes = r.data.countries.map((c) => c.code);
    // The June 2026 international batches are all represented.
    for (const code of ["HU", "SK", "AT", "HR", "RO", "SI"]) {
      expect(codes).toContain(code);
    }
    // Counts are positive and sorted biggest-first (HU is by far the largest).
    expect(r.data.countries[0]?.code).toBe("HU");
    for (const c of r.data.countries) expect(c.count).toBeGreaterThan(0);
    // The list is stable regardless of who's scoped: a HU couple still sees
    // the full country roster so their picker can offer every option.
    const token = await onboardCoupleInCountry("hu-roster@weddly.test", "HU");
    const scoped = await req<{ countries: CountryCount[] }>("GET", "/api/suppliers", undefined, {
      token,
    });
    expect(new Set(scoped.data.countries.map((c) => c.code))).toEqual(new Set(codes));
  });

  test("?country=XX overrides the couple's onboarding country", async () => {
    wipeAll();
    // HU couple explicitly asks for Croatian venues.
    const token = await onboardCoupleInCountry("hu-override@weddly.test", "HU");
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?country=HR",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.suppliers.length).toBeGreaterThan(0);
    for (const s of r.data.suppliers) expect(s.country).toBe("HR");
    const ids = new Set(r.data.suppliers.map((s) => s.id));
    expect(ids.has(HR_VENUE)).toBe(true);
    expect(ids.has(HU_VENUE)).toBe(false);
  });

  test("?country=all drops the couple's country scope", async () => {
    wipeAll();
    const token = await onboardCoupleInCountry("hu-all@weddly.test", "HU");
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?country=all",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    const ids = new Set(r.data.suppliers.map((s) => s.id));
    expect(ids.has(HU_VENUE)).toBe(true);
    expect(ids.has(HR_VENUE)).toBe(true);
    expect(ids.has(SI_VENUE)).toBe(true);
    expect(new Set(r.data.suppliers.map((s) => s.country)).size).toBeGreaterThan(1);
  });

  test("an invalid ?country value falls back to the couple's country", async () => {
    wipeAll();
    const token = await onboardCoupleInCountry("hu-bad@weddly.test", "HU");
    const r = await req<{ suppliers: DirectoryItem[] }>(
      "GET",
      "/api/suppliers?country=zzz",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    for (const s of r.data.suppliers) expect(s.country).toBe("HU");
  });
});
