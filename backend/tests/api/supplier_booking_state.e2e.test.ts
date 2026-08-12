import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { expireStaleBookings, updateBookingStatus } from "../../src/domain/supplier_bookings";
import { HttpError } from "../../src/lib/http";
import { wipeAll } from "../helpers";

function insertUser(email: string, role = "owner"): number {
  const ts = now();
  return Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, full_name, role, created_at, updated_at)
         VALUES (?, 'test-hash', ?, ?, ?, ?)`,
      )
      .run(email, email, role, ts, ts).lastInsertRowid,
  );
}

function insertCouple(seed: string): number {
  const userId = insertUser(`${seed}@couple.test`);
  const ts = now();
  const coupleId = Number(
    db
      .prepare(
        `INSERT INTO couples (partner_a_id, display_name, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(userId, seed, ts, ts).lastInsertRowid,
  );
  db.prepare("UPDATE users SET couple_id = ? WHERE id = ?").run(coupleId, userId);
  return coupleId;
}

function seedVendor(): { accountId: number; listingId: string } {
  const userId = insertUser("owner@vendor.test", "vendor");
  const ts = now();
  const accountId = Number(
    db
      .prepare(
        `INSERT INTO vendor_accounts (owner_user_id, display_name, contact_email, created_at, updated_at)
         VALUES (?, 'State Machine Studio', 'owner@vendor.test', ?, ?)`,
      )
      .run(userId, ts, ts).lastInsertRowid,
  );
  const listingId = "state-machine-studio";
  db.prepare(
    `INSERT INTO listings
       (id, source, vendor_account_id, category, name, city, status, created_at, updated_at)
     VALUES (?, 'claimed', ?, 'photography', 'State Machine Studio', 'Budapest', 'active', ?, ?)`,
  ).run(listingId, accountId, ts, ts);
  db.prepare(
    `INSERT INTO vendor_google_calendar_connections
       (vendor_account_id, connected_user_id, google_email, sync_state, created_at, updated_at)
     VALUES (?, ?, 'owner@vendor.test', 'idle', ?, ?)`,
  ).run(accountId, userId, ts, ts);
  return { accountId, listingId };
}

function insertBooking(
  vendor: { accountId: number; listingId: string },
  coupleId: number,
  eventDate: string,
  createdAt = now(),
  status = "requested",
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO supplier_bookings
           (supplier_id, couple_id, vendor_account_id, event_date, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(vendor.listingId, coupleId, vendor.accountId, eventDate, status, createdAt, createdAt)
      .lastInsertRowid,
  );
}

beforeEach(() => wipeAll());

describe("supplier booking state machine", () => {
  test("confirming one inquiry atomically declines every competing open inquiry", () => {
    const vendor = seedVendor();
    const date = "2027-06-19";
    const winner = insertBooking(vendor, insertCouple("winner"), date);
    const requested = insertBooking(vendor, insertCouple("requested"), date);
    const seen = insertBooking(vendor, insertCouple("seen"), date, now(), "vendor_seen");
    const otherDate = insertBooking(vendor, insertCouple("other"), "2027-06-20");

    expect(updateBookingStatus(winner, "confirmed")?.status).toBe("confirmed");

    const rows = db.prepare("SELECT id, status FROM supplier_bookings ORDER BY id").all() as Array<{
      id: number;
      status: string;
    }>;
    expect(rows).toEqual([
      { id: winner, status: "confirmed" },
      { id: requested, status: "declined" },
      { id: seen, status: "declined" },
      { id: otherDate, status: "requested" },
    ]);
    expect(
      (
        db
          .prepare(
            "SELECT sync_state FROM vendor_google_calendar_connections WHERE vendor_account_id = ?",
          )
          .get(vendor.accountId) as { sync_state: string }
      ).sync_state,
    ).toBe("dirty");
  });

  test("a second confirmed booking for the same vendor and date is rejected", () => {
    const vendor = seedVendor();
    const date = "2027-06-19";
    const first = insertBooking(vendor, insertCouple("first"), date);
    const second = insertBooking(vendor, insertCouple("second"), date, now(), "declined");
    updateBookingStatus(first, "confirmed");

    let caught: unknown;
    try {
      updateBookingStatus(second, "confirmed");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(409);
    expect(
      (
        db.prepare("SELECT status FROM supplier_bookings WHERE id = ?").get(second) as {
          status: string;
        }
      ).status,
    ).toBe("declined");
  });

  test("the fourteen-day expiry sweep is idempotent and leaves terminal bookings alone", () => {
    const vendor = seedVendor();
    const at = Date.UTC(2027, 5, 30);
    const old = at - 14 * 24 * 60 * 60 * 1000;
    const staleRequested = insertBooking(vendor, insertCouple("stale-request"), "2027-08-01", old);
    const staleSeen = insertBooking(
      vendor,
      insertCouple("stale-seen"),
      "2027-08-02",
      old - 1,
      "vendor_seen",
    );
    const fresh = insertBooking(vendor, insertCouple("fresh"), "2027-08-03", old + 1);
    const confirmed = insertBooking(
      vendor,
      insertCouple("confirmed"),
      "2027-08-04",
      old - 1000,
      "confirmed",
    );

    expect(expireStaleBookings(at)).toBe(2);
    expect(expireStaleBookings(at)).toBe(0);
    const status = (id: number) =>
      (
        db.prepare("SELECT status FROM supplier_bookings WHERE id = ?").get(id) as {
          status: string;
        }
      ).status;
    expect(status(staleRequested)).toBe("expired");
    expect(status(staleSeen)).toBe("expired");
    expect(status(fresh)).toBe("requested");
    expect(status(confirmed)).toBe("confirmed");
  });
});
