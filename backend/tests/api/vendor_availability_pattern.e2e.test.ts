// Vendor recurring weekly availability pattern + two-directional per-date
// exceptions.
//
// Before this, availability was a single flat list of blocked days and
// "available" was merely the absence of a block — so a vendor who only works
// weekends had to block ~200 weekdays a year by hand. There are now two layers:
// the weekly pattern (which weekdays they work at all) and per-date exceptions
// ON TOP, in both directions.
//
// Resolution order lives in shared/vendor_availability.ts and is asserted here
// through the real endpoints, including the couple-facing payload — the whole
// point is that the vendor calendar and the public busy calendar can't disagree.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { SupplierAvailability } from "@shared/suppliers";
import type { VendorAvailabilitySettings } from "@shared/vendor_availability";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

async function bootstrapVendor(slug: string): Promise<{
  vendorToken: string;
  listingId: string;
  accountId: number;
  /** A couple session, for reading the couple-facing availability payload. */
  coupleToken: string;
}> {
  const { token } = await bootstrapCouple(`owner-${slug}@weddly.test`);
  const contactEmail = `vendor-${slug}@weddly.test`;
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name: `${slug} Studio`,
      city: "Budapest",
      address: null,
      website: `https://${slug}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${slug} blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const numericId = Number(submit.data.supplier.id.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as ClaimRow | undefined;
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await registerAdminAndGetToken();
  await req("POST", `/api/admin/suppliers/${numericId}/approve`, {}, { token: adminToken });
  const listingId = `c${numericId}`;

  await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as ClaimRow | undefined;
  await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: `Vendor ${slug}`,
  });
  expect(complete.status).toBe(201);

  const acct = db
    .prepare("SELECT vendor_account_id AS id FROM listings WHERE id = ?")
    .get(listingId) as { id: number };
  initVendorBilling(acct.id, "EUR");
  return { vendorToken: complete.data.token, listingId, accountId: acct.id, coupleToken: token };
}

function getPattern(token: string): Promise<{ status: number; data: VendorAvailabilitySettings }> {
  return req<VendorAvailabilitySettings>("GET", "/api/vendor/availability/me/pattern", undefined, {
    token,
  });
}

function putPattern(
  token: string,
  weekdays: number[] | null,
): Promise<{ status: number; data: VendorAvailabilitySettings }> {
  return req<VendorAvailabilitySettings>(
    "PUT",
    "/api/vendor/availability/me/pattern",
    { weekdays },
    { token },
  );
}

/** The couple-facing availability payload. Auth-required (couples browse it
 *  signed in), so it takes a session token. */
function publicAvailability(
  listingId: string,
  token: string,
): Promise<{ status: number; data: SupplierAvailability }> {
  return req<SupplierAvailability>(
    "GET",
    `/api/suppliers/${encodeURIComponent(listingId)}/availability`,
    undefined,
    { token },
  );
}

describe("vendor availability — weekly pattern", () => {
  test("defaults to null (every day), preserving the pre-pattern behaviour", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-default");

    const r = await getPattern(vendorToken);
    expect(r.status).toBe(200);
    expect(r.data.weekdays).toBe(null);

    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.status).toBe(200);
    expect(pub.data.available_weekdays).toBe(null);
    // With no pattern and no blocks, the next free date is today.
    expect(pub.data.next_available).toBeTruthy();
  });

  test("round-trips a partial week and surfaces it on the public payload", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-weekend");

    // Fri/Sat/Sun only.
    const put = await putPattern(vendorToken, [5, 6, 7]);
    expect(put.status).toBe(200);
    expect(put.data.weekdays).toEqual([5, 6, 7]);

    expect((await getPattern(vendorToken)).data.weekdays).toEqual([5, 6, 7]);

    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.available_weekdays).toEqual([5, 6, 7]);
  });

  test("a full week, an empty set and junk all collapse to null", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("pat-collapse");

    // All seven days IS "every day" — stored as null so there's one
    // representation of the unrestricted case.
    expect((await putPattern(vendorToken, [1, 2, 3, 4, 5, 6, 7])).data.weekdays).toBe(null);
    // An empty set would mean "never available", which would silently hide the
    // listing from every search. Treated as unset instead.
    expect((await putPattern(vendorToken, [])).data.weekdays).toBe(null);
    // Out-of-range / non-integer values are filtered, not 400'd.
    const junk = await req<VendorAvailabilitySettings>(
      "PUT",
      "/api/vendor/availability/me/pattern",
      { weekdays: [0, 9, "x", 3.5, 6] },
      { token: vendorToken },
    );
    expect(junk.status).toBe(200);
    expect(junk.data.weekdays).toEqual([6]);
  });

  test("next_available skips weekdays outside the pattern", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-next");

    // Sundays only — whatever today is, the next free date must be a Sunday.
    await putPattern(vendorToken, [7]);
    const pub = await publicAvailability(listingId, coupleToken);
    const next = pub.data.next_available;
    expect(next).toBeTruthy();
    const weekday = new Date(`${next as string}T00:00:00Z`).getUTCDay();
    expect(weekday).toBe(0); // 0 = Sunday
  });

  test("an exceptional 'available' day overrides the pattern", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-exception");

    // Sundays only, then open one specific Monday.
    await putPattern(vendorToken, [7]);
    // 2030-06-03 is a Monday.
    const monday = "2030-06-03";
    expect(new Date(`${monday}T00:00:00Z`).getUTCDay()).toBe(1);

    const open = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday, available: true },
      { token: vendorToken },
    );
    expect(open.status).toBe(201);

    // It must NOT read as a block anywhere couples look.
    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.unavailable_dates).not.toContain(monday);
    expect(pub.data.partial_dates).not.toContain(monday);

    // And the row really is stored as the available direction.
    const row = db
      .prepare("SELECT is_available FROM vendor_unavailable_dates WHERE blocked_date = ? LIMIT 1")
      .get(monday) as { is_available: number } | undefined;
    expect(row?.is_available).toBe(1);
  });

  test("blocking still works on a pattern day, and the two directions replace each other", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("pat-both");
    await putPattern(vendorToken, [7]);
    const monday = "2030-06-03";

    // Open it exceptionally...
    await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday, available: true },
      { token: vendorToken },
    );
    // ...then block it again. The upsert must flip the direction, not stack.
    const block = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday },
      { token: vendorToken },
    );
    expect(block.status).toBe(201);

    const rows = db
      .prepare("SELECT is_available FROM vendor_unavailable_dates WHERE blocked_date = ?")
      .all(monday) as Array<{ is_available: number }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.is_available).toBe(0);

    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.unavailable_dates).toContain(monday);
  });

  test("pattern changes require a vendor session", async () => {
    wipeAll();
    const anon = await req("PUT", "/api/vendor/availability/me/pattern", { weekdays: [1] });
    expect(anon.status).toBe(401);

    const { token } = await bootstrapCouple("not-a-vendor-pattern@weddly.test");
    const couple = await req(
      "PUT",
      "/api/vendor/availability/me/pattern",
      { weekdays: [1] },
      { token },
    );
    expect(couple.status).toBe(403);
  });
});

// The hour-granular half of the same resource. `weekdays` is a DERIVED mirror of
// the intervals, and everything couples read still goes through it, so these
// tests assert the mirror as hard as they assert the hours.
describe("vendor availability — weekly working hours", () => {
  function putHours(
    token: string,
    working_hours: Record<number, Array<{ start_min: number; end_min: number }>>,
    schedule_name?: string,
  ): Promise<{ status: number; data: VendorAvailabilitySettings }> {
    return req<VendorAvailabilitySettings>(
      "PUT",
      "/api/vendor/availability/me/pattern",
      schedule_name === undefined ? { working_hours } : { working_hours, schedule_name },
      { token },
    );
  }

  test("a vendor with no hours on file reads back whole days from the legacy pattern", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("wh-legacy");

    // Nothing set at all: every day, covered whole.
    const fresh = await getPattern(vendorToken);
    expect(fresh.status).toBe(200);
    expect(fresh.data.weekdays).toBe(null);
    expect(fresh.data.schedule_name).toBe("");
    expect(fresh.data.working_hours[1]).toEqual([{ start_min: 0, end_min: 1440 }]);
    expect(fresh.data.working_hours[7]).toEqual([{ start_min: 0, end_min: 1440 }]);

    // The pre-hours API shape still writes a consistent schedule: the days it
    // names become whole working days, the rest empty.
    await putPattern(vendorToken, [5, 6, 7]);
    const legacy = await getPattern(vendorToken);
    expect(legacy.data.weekdays).toEqual([5, 6, 7]);
    expect(legacy.data.working_hours[1]).toEqual([]);
    expect(legacy.data.working_hours[5]).toEqual([{ start_min: 0, end_min: 1440 }]);
  });

  test("hours round-trip, and the derived weekday mirror follows them", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("wh-roundtrip");

    const put = await putHours(
      vendorToken,
      {
        1: [],
        2: [],
        3: [],
        4: [],
        5: [{ start_min: 14 * 60, end_min: 22 * 60 }],
        6: [
          { start_min: 9 * 60, end_min: 12 * 60 },
          { start_min: 13 * 60, end_min: 23 * 60 },
        ],
        7: [{ start_min: 10 * 60, end_min: 18 * 60 }],
      },
      "Nyári munkarend",
    );
    expect(put.status).toBe(200);
    expect(put.data.schedule_name).toBe("Nyári munkarend");
    // The whole point: couples never see intervals, they see the weekday set,
    // and it is computed from the hours rather than sent alongside them.
    expect(put.data.weekdays).toEqual([5, 6, 7]);
    expect(put.data.working_hours[6]).toEqual([
      { start_min: 540, end_min: 720 },
      { start_min: 780, end_min: 1380 },
    ]);

    const again = await getPattern(vendorToken);
    expect(again.data.working_hours).toEqual(put.data.working_hours);

    // ...and the couple-facing payload agrees, without knowing hours exist.
    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.available_weekdays).toEqual([5, 6, 7]);
    const next = pub.data.next_available;
    expect(next).toBeTruthy();
    const wd = new Date(`${next as string}T00:00:00Z`).getUTCDay();
    expect([5, 6, 0]).toContain(wd); // Fri / Sat / Sun
  });

  test("overlapping and touching intervals merge, so one week has one representation", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("wh-merge");

    const put = await putHours(vendorToken, {
      1: [
        { start_min: 660, end_min: 1020 }, // 11:00-17:00, deliberately out of order
        { start_min: 540, end_min: 720 }, // 09:00-12:00, overlaps the above
        { start_min: 1020, end_min: 1200 }, // 17:00-20:00, merely touches
        { start_min: 300, end_min: 300 }, // empty, dropped
        { start_min: 600, end_min: 400 }, // inverted, dropped
      ],
    });
    expect(put.status).toBe(200);
    expect(put.data.working_hours[1]).toEqual([{ start_min: 540, end_min: 1200 }]);
    expect(put.data.weekdays).toEqual([1]);

    // Storage matches what was returned: no shadow rows left behind by the
    // replace-the-week write.
    const rows = db
      .prepare("SELECT weekday, start_min, end_min FROM vendor_working_hours ORDER BY id")
      .all() as Array<{ weekday: number; start_min: number; end_min: number }>;
    expect(rows).toEqual([{ weekday: 1, start_min: 540, end_min: 1200 }]);
  });

  test("a full week collapses the mirror to null, exactly like the day-level pattern", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("wh-full");

    const put = await putHours(vendorToken, {
      1: [{ start_min: 480, end_min: 1080 }],
      2: [{ start_min: 480, end_min: 1080 }],
      3: [{ start_min: 480, end_min: 1080 }],
      4: [{ start_min: 480, end_min: 1080 }],
      5: [{ start_min: 480, end_min: 1080 }],
      6: [{ start_min: 480, end_min: 1080 }],
      7: [{ start_min: 480, end_min: 1080 }],
    });
    // Works every day: the mirror is null (one representation of unrestricted),
    // while the hours themselves are kept.
    expect(put.data.weekdays).toBe(null);
    expect(put.data.working_hours[3]).toEqual([{ start_min: 480, end_min: 1080 }]);
    const pub = await publicAvailability(listingId, coupleToken);
    expect(pub.data.available_weekdays).toBe(null);
  });

  test("an empty week is refused rather than read as 'every day'", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("wh-empty");
    await putHours(vendorToken, { 6: [{ start_min: 600, end_min: 1200 }] });

    const empty = await putHours(vendorToken, { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] });
    expect(empty.status).toBe(400);

    // The refusal left the stored week alone.
    expect((await getPattern(vendorToken)).data.working_hours[6]).toEqual([
      { start_min: 600, end_min: 1200 },
    ]);
  });

  test("a malformed working_hours payload is a 400, not a silently emptied week", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("wh-junk");
    await putHours(vendorToken, { 6: [{ start_min: 600, end_min: 1200 }] });

    for (const junk of [
      { working_hours: [] },
      { working_hours: { 1: "09:00-17:00" } },
      { working_hours: { 1: [{ start_min: "9", end_min: 17 }] } },
      { working_hours: { 1: [null] } },
    ]) {
      const r = await req("PUT", "/api/vendor/availability/me/pattern", junk, {
        token: vendorToken,
      });
      expect(r.status).toBe(400);
    }
    expect((await getPattern(vendorToken)).data.weekdays).toEqual([6]);
  });

  test("out-of-range minutes are clamped to the day instead of stored", async () => {
    wipeAll();
    const { vendorToken } = await bootstrapVendor("wh-clamp");
    const put = await putHours(vendorToken, {
      2: [{ start_min: -120, end_min: 3000 }],
    });
    expect(put.data.working_hours[2]).toEqual([{ start_min: 0, end_min: 1440 }]);
  });
});

// The directory's date filter reads the same two layers from the other end: one
// call, one date, the listings a couple should not be shown for that day.
describe("directory date filter — GET /api/suppliers/unavailable", () => {
  const monday = "2030-06-03"; // ISO weekday 1
  const sunday = "2030-06-02"; // ISO weekday 7

  async function unavailableOn(
    date: string,
    token: string,
  ): Promise<{ status: number; data: { date: string; supplier_ids: string[] } }> {
    return req<{ date: string; supplier_ids: string[] }>(
      "GET",
      `/api/suppliers/unavailable?date=${encodeURIComponent(date)}`,
      undefined,
      { token },
    );
  }

  test("a whole-day block puts the listing on the list, and only for that day", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("df-block");
    await req("POST", "/api/vendor/availability/me", { date: monday }, { token: vendorToken });

    const taken = await unavailableOn(monday, coupleToken);
    expect(taken.status).toBe(200);
    expect(taken.data.supplier_ids).toContain(listingId);

    // The day before is untouched: the filter answers about one date.
    const free = await unavailableOn(sunday, coupleToken);
    expect(free.data.supplier_ids).not.toContain(listingId);
  });

  test("a weekday outside the pattern counts as taken, without a block row", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("df-pattern");
    await putPattern(vendorToken, [7]); // Sundays only

    expect((await unavailableOn(monday, coupleToken)).data.supplier_ids).toContain(listingId);
    expect((await unavailableOn(sunday, coupleToken)).data.supplier_ids).not.toContain(listingId);
  });

  test("an exceptional open day beats the pattern here too", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("df-exception");
    await putPattern(vendorToken, [7]);
    await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday, available: true },
      { token: vendorToken },
    );
    // The vendor said yes to this specific Monday, so the filter must not hide
    // them on it — the two surfaces cannot be allowed to disagree.
    expect((await unavailableOn(monday, coupleToken)).data.supplier_ids).not.toContain(listingId);
  });

  test("a partial-hour block leaves the day bookable, so the listing stays", async () => {
    wipeAll();
    const { vendorToken, listingId, coupleToken } = await bootstrapVendor("df-partial");
    await req(
      "POST",
      "/api/vendor/availability/me",
      { date: monday, hours: [9, 10] },
      { token: vendorToken },
    );
    expect((await unavailableOn(monday, coupleToken)).data.supplier_ids).not.toContain(listingId);
  });

  test("a malformed date hides nothing rather than erroring", async () => {
    wipeAll();
    const { coupleToken } = await bootstrapVendor("df-junk");
    for (const bad of ["", "nope", "2030-02-30", "2030-6-3"]) {
      const r = await unavailableOn(bad, coupleToken);
      // The caller is a filter. A 400 would break the page; an empty set is the
      // honest answer to "we don't know".
      expect(r.status).toBe(200);
      expect(r.data.supplier_ids).toEqual([]);
    }
  });

  test("an unclaimed listing is never on the list: no calendar, no conclusion", async () => {
    wipeAll();
    const { coupleToken } = await bootstrapVendor("df-unclaimed-peer");
    // Curated entries carry no vendor account at all, so nothing about them can
    // land here whatever the date.
    const r = await unavailableOn(monday, coupleToken);
    for (const id of r.data.supplier_ids)
      expect(id.startsWith("c") || id.startsWith("v")).toBe(true);
    const curated = await req<{
      suppliers: Array<{ id: string; vendor_account_id: number | null }>;
    }>("GET", "/api/suppliers?country=all", undefined, { token: coupleToken });
    const unclaimed = curated.data.suppliers.filter((s) => s.vendor_account_id === null);
    for (const s of unclaimed) expect(r.data.supplier_ids).not.toContain(s.id);
  });
});
