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
});
