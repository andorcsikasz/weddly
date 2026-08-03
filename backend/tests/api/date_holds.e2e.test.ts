// Live Date Holds end to end: a vendor takes one date off the market for one
// couple while they decide, and it lets itself go.
//
// What this suite is really guarding is the set of invariants that have no
// column to enforce them:
//   * the state is DERIVED from `hold_until` + `released_at`, which is what
//     makes expiry work with NO sweep and is therefore only observable through
//     the API. Every "it expired" assertion here happens with nothing having
//     run in between.
//   * extending UN-LAPSES the same row, so a vendor who missed their own
//     deadline by an hour has not lost the date.
//   * a live hold is honoured by the SAME availability reads every other block
//     goes through: the couple-facing busy calendar, next-free, and the
//     directory's date filter.
//   * a hand-typed exception still outranks it, in both directions.
//   * placing is PRO; a lapse must not destroy a hold that already exists.
//   * a foreign booking is a 404, never a 403.
//
// The bootstrap ladder is copied from booking_quotes.e2e.test.ts (which copied
// it from booking_messages.e2e.test.ts) on purpose: these suites are
// deliberately self-contained, and the outreach path is the only seam that
// produces a real inquiry with a real thread behind it.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, enableBillingEnforcement, registerAndVerify, req } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import { insertMessage } from "../../src/domain/booking_messages";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { type DateHold, HOLD_DEFAULT_HOURS, HOLD_MAX_HOURS } from "@shared/date_holds";
import type { SupplierAvailability, SupplierBooking } from "@shared/suppliers";
import type { VendorClientView } from "@shared/vendor_clients";

interface ClaimRow {
  token: string;
}

interface ErrBody {
  detail?: { code?: string };
}

const TEST_TIMEOUT_MS = 60_000;
const HOUR = 3_600_000;

// ── Bootstrap ─────────────────────────────────────────────────────────────

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<string> {
  const { token } = await bootstrapCouple(ownerEmail);
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name,
      city: "Budapest",
      address: null,
      website: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${name} blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const publicId = submit.data.supplier.id;
  const numericId = Number(publicId.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as ClaimRow | undefined;
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await registerAdminAndGetToken();
  const approve = await req(
    "POST",
    `/api/admin/suppliers/${numericId}/approve`,
    {},
    { token: adminToken },
  );
  expect(approve.status).toBe(200);
  return publicId;
}

async function bootstrapVendor(
  slug: string,
): Promise<{ vendorToken: string; listingId: string; accountId: number }> {
  const contactEmail = `vendor-${slug}@weddly.test`;
  const listingId = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    contactEmail,
    `${slug} Studio`,
  );
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  expect(start.status).toBe(200);
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
  return { vendorToken: complete.data.token, listingId, accountId: acct.id };
}

function downgradeToFree(accountId: number): void {
  db.prepare(
    `UPDATE vendor_subscriptions
        SET subscription_status = 'canceled', founding_until = NULL,
            trial_ends_at = NULL, current_period_end = NULL
      WHERE vendor_account_id = ?`,
  ).run(accountId);
}

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** An inquiry with a real date on it, created through the admin door (the one
 *  path that means "this couple wants this date"). */
async function createInquiry(
  listingId: string,
  coupleId: number,
  eventDate: string,
): Promise<{ status: number; id: number; code?: string }> {
  const adminToken = await registerAdminAndGetToken();
  const r = await req<SupplierBooking & ErrBody>(
    "POST",
    `/api/suppliers/${encodeURIComponent(listingId)}/bookings`,
    { couple_id: coupleId, event_date: eventDate, notes: "Are you free that day?" },
    { token: adminToken },
  );
  return { status: r.status, id: r.data.id, code: r.data.detail?.code };
}

interface Fixture {
  vendorToken: string;
  listingId: string;
  accountId: number;
  coupleToken: string;
  coupleId: number;
  bookingId: number;
  eventDate: string;
}

/** A claimed PRO vendor, an onboarded couple, and one inquiry on a date far
 *  enough out that no other queue rule joins in. */
async function bootstrapInquiry(slug: string, daysOut = 200): Promise<Fixture> {
  const vendor = await bootstrapVendor(slug);
  const couple = await bootstrapCouple(`couple-${slug}@weddly.test`);
  const eventDate = isoDaysFromToday(daysOut);
  const inquiry = await createInquiry(vendor.listingId, couple.coupleId, eventDate);
  expect(inquiry.status).toBe(201);
  return {
    ...vendor,
    coupleToken: couple.token,
    coupleId: couple.coupleId,
    bookingId: inquiry.id,
    eventDate,
  };
}

async function placeHold(f: Fixture, hours?: number) {
  return req<{ hold: DateHold } & ErrBody>(
    "PUT",
    `/api/vendor/clients/${f.bookingId}/hold`,
    hours === undefined ? {} : { hours },
    { token: f.vendorToken },
  );
}

async function readHold(f: Fixture) {
  return req<{ hold: DateHold | null }>(
    "GET",
    `/api/vendor/clients/${f.bookingId}/hold`,
    undefined,
    { token: f.vendorToken },
  );
}

async function availability(f: Fixture): Promise<SupplierAvailability> {
  const r = await req<SupplierAvailability>(
    "GET",
    `/api/suppliers/${encodeURIComponent(f.listingId)}/availability`,
    undefined,
    { token: f.coupleToken },
  );
  expect(r.status).toBe(200);
  return r.data;
}

async function unavailableListingIds(date: string): Promise<string[]> {
  const r = await req<{ supplier_ids: string[] }>("GET", `/api/suppliers/unavailable?date=${date}`);
  expect(r.status).toBe(200);
  return r.data.supplier_ids;
}

/** Push a hold's deadline into the past WITHOUT running anything. This is the
 *  whole point of the derived state: the only thing that changes is the clock. */
function lapseHold(bookingId: number): void {
  db.prepare("UPDATE booking_date_holds SET hold_until = ? WHERE booking_id = ?").run(
    Date.now() - HOUR,
    bookingId,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("live date holds — taking one date off the market", () => {
  test(
    "a hold is placed with a default window and reads back live",
    async () => {
      const f = await bootstrapInquiry("dh-place");

      const before = await readHold(f);
      expect(before.status).toBe(200);
      expect(before.data.hold).toBeNull();

      const placed = await placeHold(f);
      expect(placed.status).toBe(201);
      expect(placed.data.hold.state).toBe("live");
      expect(placed.data.hold.event_date).toBe(f.eventDate);
      expect(placed.data.hold.released_at).toBeNull();
      // The default window, to the hour.
      expect(Math.round((placed.data.hold.hold_until - Date.now()) / HOUR)).toBe(
        HOLD_DEFAULT_HOURS,
      );
      expect(placed.data.hold.hours_remaining).toBe(HOLD_DEFAULT_HOURS);

      // And it is the vendor's own calendar's business too.
      const mine = await req<{ holds: DateHold[] }>("GET", "/api/vendor/date-holds", undefined, {
        token: f.vendorToken,
      });
      expect(mine.status).toBe(200);
      expect(mine.data.holds).toHaveLength(1);
      expect(mine.data.holds[0]!.booking_id).toBe(f.bookingId);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "it lapses by derivation, with no sweep in between, and extending un-lapses it",
    async () => {
      const f = await bootstrapInquiry("dh-lapse");
      const placed = await placeHold(f, 48);
      expect(placed.data.hold.state).toBe("live");

      lapseHold(f.bookingId);

      // Nothing ran. The deadline simply passed, and the read says so.
      const expired = await readHold(f);
      expect(expired.data.hold?.state).toBe("expired");
      expect(expired.data.hold?.hours_remaining).toBe(0);
      // The date is back on the market on its own.
      expect((await availability(f)).unavailable_dates).not.toContain(f.eventDate);

      // Extending is the same row, and it is live again.
      const extended = await placeHold(f, 24);
      expect(extended.status).toBe(200); // 200, not 201: nothing new was created
      expect(extended.data.hold.id).toBe(placed.data.hold.id);
      expect(extended.data.hold.state).toBe("live");
      // Measured from NOW, not from the deadline that already went by.
      expect(Math.round((extended.data.hold.hold_until - Date.now()) / HOUR)).toBe(24);
      expect((await availability(f)).unavailable_dates).toContain(f.eventDate);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "releasing early is its own fact, not a rewound deadline",
    async () => {
      const f = await bootstrapInquiry("dh-release");
      const placed = await placeHold(f, 72);
      const heldUntil = placed.data.hold.hold_until;

      const released = await req<{ hold: DateHold }>(
        "DELETE",
        `/api/vendor/clients/${f.bookingId}/hold`,
        undefined,
        { token: f.vendorToken },
      );
      expect(released.status).toBe(200);
      expect(released.data.hold.state).toBe("released");
      expect(released.data.hold.released_at).not.toBeNull();
      // The record still says how long the date WAS being held for.
      expect(released.data.hold.hold_until).toBe(heldUntil);
      expect((await availability(f)).unavailable_dates).not.toContain(f.eventDate);

      // Releasing again is a no-op success and keeps the first stamp: the date
      // only went back on the market once.
      const again = await req<{ hold: DateHold }>(
        "DELETE",
        `/api/vendor/clients/${f.bookingId}/hold`,
        undefined,
        { token: f.vendorToken },
      );
      expect(again.status).toBe(200);
      expect(again.data.hold.released_at).toBe(released.data.hold.released_at);

      // And re-placing works on the same row rather than a second promise.
      const again2 = await placeHold(f, 24);
      expect(again2.data.hold.id).toBe(placed.data.hold.id);
      expect(again2.data.hold.state).toBe("live");
      expect(again2.data.hold.released_at).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a live hold takes the date from everyone else, and the holding couple straight through",
    async () => {
      const f = await bootstrapInquiry("dh-busy", 120);

      const free = await availability(f);
      expect(free.unavailable_dates).not.toContain(f.eventDate);
      expect(await unavailableListingIds(f.eventDate)).not.toContain(f.listingId);

      await placeHold(f, 48);

      // The couple-facing busy calendar, and the directory's date filter, both
      // through the same resolver every other block goes through.
      const busy = await availability(f);
      expect(busy.unavailable_dates).toContain(f.eventDate);
      expect(busy.next_available).not.toBe(f.eventDate);
      expect(await unavailableListingIds(f.eventDate)).toContain(f.listingId);

      // A stranger cannot take the date.
      const stranger = await bootstrapCouple("stranger-dh@weddly.test");
      const refused = await createInquiry(f.listingId, stranger.coupleId, f.eventDate);
      expect(refused.status).toBe(409);
      expect(refused.code).toBe("booking_date_held");

      // A different date is untouched: a hold takes the day it names, nothing
      // around it.
      const nextDay = isoDaysFromToday(121);
      const elsewhere = await createInquiry(f.listingId, stranger.coupleId, nextDay);
      expect(elsewhere.status).toBe(201);

      // The couple the hold is FOR is not in their own way. The marker is
      // public; the refusal is not.
      const holder = await createInquiry(f.listingId, f.coupleId, f.eventDate);
      expect(holder.status).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hand-typed exception still outranks a hold, in both directions",
    async () => {
      const f = await bootstrapInquiry("dh-exception", 150);
      await placeHold(f, 48);
      expect((await availability(f)).unavailable_dates).toContain(f.eventDate);

      // The vendor opens the date by hand. An explicit statement about a date
      // wins over anything derived, exactly as it does over the external
      // calendar, so the day comes back.
      const opened = await req(
        "POST",
        "/api/vendor/availability/me",
        { date: f.eventDate, available: true },
        { token: f.vendorToken },
      );
      expect(opened.status).toBe(201);
      expect((await availability(f)).unavailable_dates).not.toContain(f.eventDate);

      // And a hand-typed BLOCK on the same date reads as one block, not two.
      const blocked = await req(
        "POST",
        "/api/vendor/availability/me",
        { date: f.eventDate },
        { token: f.vendorToken },
      );
      expect(blocked.status).toBe(201);
      const after = await availability(f);
      expect(after.unavailable_dates.filter((d) => d === f.eventDate)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hold expiring inside a day is the vendor's next step, and the band says why",
    async () => {
      const f = await bootstrapInquiry("dh-queue");
      // The vendor has opened the lead and answered it, so nothing else is
      // competing for the verdict.
      await req("POST", `/api/vendor/clients/${f.bookingId}/seen`, {}, { token: f.vendorToken });
      db.prepare("UPDATE supplier_bookings SET created_at = ? WHERE id = ?").run(
        Date.now() - 2 * HOUR,
        f.bookingId,
      );
      insertMessage({
        bookingId: f.bookingId,
        senderKind: "vendor",
        senderUserId: null,
        body: "We are free, here is the offer.",
        at: Date.now() - HOUR,
      });

      const clients = async () => {
        const r = await req<{ clients: VendorClientView[] }>(
          "GET",
          "/api/vendor/clients",
          undefined,
          { token: f.vendorToken },
        );
        expect(r.status).toBe(200);
        return r.data.clients.find((c) => c.id === f.bookingId);
      };

      // A week-long hold is not a deadline yet.
      await placeHold(f, HOLD_DEFAULT_HOURS);
      const quiet = await clients();
      expect(quiet?.next_action).toBe("await");
      expect(quiet?.attention).toBeNull();

      // Six hours left is.
      await placeHold(f, 6);
      const loud = await clients();
      expect(loud?.next_action).toBe("release_or_extend");
      expect(loud?.attention?.key).toBe("hold_expiring");
      // Forward-anchored: hours LEFT, never elapsed.
      expect(loud?.attention?.hours).toBe(6);

      // Once it has lapsed, the date is back on the market and there is nothing
      // left to decide, so the queue goes quiet rather than nagging.
      lapseHold(f.bookingId);
      const done = await clients();
      expect(done?.next_action).toBe("await");
      expect(done?.attention).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "placing is PRO, but a lapse never destroys a hold that already exists",
    async () => {
      enableBillingEnforcement();
      const f = await bootstrapInquiry("dh-plan");
      const placed = await placeHold(f, 72);
      expect(placed.status).toBe(201);

      downgradeToFree(f.accountId);

      const blocked = await placeHold(f, 24);
      expect(blocked.status).toBe(403);
      expect(blocked.data.detail?.code).toBe("vendor_pro_required");

      const gone = await req<ErrBody>(
        "DELETE",
        `/api/vendor/clients/${f.bookingId}/hold`,
        undefined,
        { token: f.vendorToken },
      );
      expect(gone.status).toBe(403);

      // Reading is free, and the row is exactly where it was.
      const still = await readHold(f);
      expect(still.status).toBe(200);
      expect(still.data.hold?.id).toBe(placed.data.hold.id);
      expect(still.data.hold?.state).toBe("live");
      expect(still.data.hold?.hold_until).toBe(placed.data.hold.hold_until);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "a hold belongs to one vendor, and a foreign booking is a 404",
    async () => {
      const f = await bootstrapInquiry("dh-tenant");
      await placeHold(f, 48);

      const other = await bootstrapVendor("dh-tenant-other");
      for (const [method, path] of [
        ["GET", `/api/vendor/clients/${f.bookingId}/hold`],
        ["PUT", `/api/vendor/clients/${f.bookingId}/hold`],
        ["DELETE", `/api/vendor/clients/${f.bookingId}/hold`],
      ] as const) {
        const reach = await req<ErrBody>(
          method,
          path,
          method === "PUT" ? { hours: 24 } : undefined,
          { token: other.vendorToken },
        );
        // 404, never 403: a foreign id must not be confirmable by probing.
        expect(reach.status).toBe(404);
        expect(reach.data.detail?.code).toBe("client_not_found");
      }

      // A couple has no door here at all.
      const peek = await req<ErrBody>("GET", `/api/vendor/clients/${f.bookingId}/hold`, undefined, {
        token: f.coupleToken,
      });
      expect(peek.status).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    "an impossible hold is refused rather than stored",
    async () => {
      const f = await bootstrapInquiry("dh-validation");

      const zero = await placeHold(f, 0);
      expect(zero.status).toBe(400);
      expect(zero.data.detail?.code).toBe("bad_hold_hours");

      const forever = await placeHold(f, HOLD_MAX_HOURS + 1);
      expect(forever.status).toBe(400);
      expect(forever.data.detail?.code).toBe("bad_hold_hours");

      // A date that has gone is not a date anyone can hold.
      db.prepare("UPDATE supplier_bookings SET event_date = ? WHERE id = ?").run(
        isoDaysFromToday(-2),
        f.bookingId,
      );
      const past = await placeHold(f, 24);
      expect(past.status).toBe(400);
      expect(past.data.detail?.code).toBe("hold_date_past");

      // Neither is a season. A couple with no scalar date has no day to hold.
      db.prepare("UPDATE supplier_bookings SET event_date = '' WHERE id = ?").run(f.bookingId);
      const noDate = await placeHold(f, 24);
      expect(noDate.status).toBe(400);
      expect(noDate.data.detail?.code).toBe("hold_no_date");

      // A lead the vendor themselves closed would hold a Saturday for nobody.
      db.prepare(
        "UPDATE supplier_bookings SET event_date = ?, status = 'declined' WHERE id = ?",
      ).run(isoDaysFromToday(90), f.bookingId);
      const closed = await placeHold(f, 24);
      expect(closed.status).toBe(409);
      expect(closed.data.detail?.code).toBe("hold_booking_closed");
    },
    TEST_TIMEOUT_MS,
  );
});
