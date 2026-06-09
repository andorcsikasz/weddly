// Next-11 — GDPR purge gap. Three new tables (growth_events, listing_claims,
// vendor_accounts) landed without coverage in the existing purge sweep. This
// suite exercises the 3-agent-consensus contract:
//   - couple purge: DELETE growth_events WHERE couple_id = ?
//   - user purge: DELETE listing_claims by email_sent_to,
//                 DELETE vendor_accounts by owner_user_id,
//                 UPDATE growth_events SET user_id = NULL.
//
// Direct DB writes set up the rows the existing register/onboard helpers
// don't produce (vendor_accounts is created via the claim flow which has
// its own e2e; we don't need to re-run that here).

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db, now } from "../../src/db";
import { purgeOneCouple, purgeOneUser } from "../../src/domain/purge";

describe("Next-11 GDPR purge — growth_events / listing_claims / vendor_accounts", () => {
  test("purgeOneCouple wipes growth_events for the couple", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("purge-growth@weddly.test");
    // bootstrapCouple doesn't return userId — pull it from the DB by email
    // so the second growth_event row can carry the partner_a id directly.
    const userRow = db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get("purge-growth@weddly.test") as { id: number } | undefined;
    expect(userRow).toBeDefined();
    const userId = userRow!.id;
    // Seed two events: one tagged with couple_id, one tagged with only
    // user_id (anonymous funnel). Both should disappear after couple purge —
    // the user_id event vanishes via the explicit user-purge step that
    // purgeOneCouple chains through, and the couple_id event via the new
    // explicit DELETE.
    db.prepare(
      "INSERT INTO growth_events (kind, couple_id, user_id, household_id, referrer, user_agent_hash, payload_json, created_at) VALUES (?, ?, NULL, NULL, ?, NULL, NULL, ?)",
    ).run("rsvp.page.view", coupleId, "https://weddly.hu/w/test", now());
    db.prepare(
      "INSERT INTO growth_events (kind, couple_id, user_id, household_id, referrer, user_agent_hash, payload_json, created_at) VALUES (?, NULL, ?, NULL, NULL, NULL, NULL, ?)",
    ).run("signup.completed", userId, now());

    purgeOneCouple(coupleId);

    const remainingCouple = db
      .prepare("SELECT COUNT(*) as n FROM growth_events WHERE couple_id = ?")
      .get(coupleId) as { n: number };
    expect(remainingCouple.n).toBe(0);
  }, 30_000);

  test("purgeOneUser (orphan) DELETEs listing_claims + vendor_accounts and nulls growth_events.user_id", async () => {
    wipeAll();
    // Create an orphan vendor user (signed up, never onboarded a couple).
    const reg = await req<{ user: { id: number }; token: string }>("POST", "/api/auth/register", {
      email: "purge-vendor@weddly.test",
      password: "supersafe123",
      full_name: "Vendor",
    });
    expect(reg.status).toBe(201);
    const userId = reg.data.user.id;

    // Seed a vendor_accounts row owned by this user.
    db.prepare(
      "INSERT INTO vendor_accounts (owner_user_id, display_name, contact_email, contact_phone, vat_number, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
    ).run(userId, "Test Studio", "purge-vendor@weddly.test", now(), now());

    // Seed a listing_claims row keyed by email_sent_to (not FK-linked to users).
    db.prepare(
      "INSERT INTO listing_claims (token, listing_id, email_sent_to, vendor_account_id, status, expires_at, created_at) VALUES (?, ?, ?, NULL, 'pending', ?, ?)",
    ).run(
      `tok-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      "test-listing",
      "purge-vendor@weddly.test",
      now() + 86_400_000,
      now(),
    );

    // Seed a growth_events row linked to the user.
    db.prepare(
      "INSERT INTO growth_events (kind, couple_id, user_id, household_id, referrer, user_agent_hash, payload_json, created_at) VALUES (?, NULL, ?, NULL, NULL, NULL, NULL, ?)",
    ).run("signup.completed", userId, now());

    purgeOneUser(userId);

    const vendorRows = db
      .prepare("SELECT COUNT(*) as n FROM vendor_accounts WHERE owner_user_id = ?")
      .get(userId) as { n: number };
    expect(vendorRows.n).toBe(0);

    const claimRows = db
      .prepare("SELECT COUNT(*) as n FROM listing_claims WHERE email_sent_to = ?")
      .get("purge-vendor@weddly.test") as { n: number };
    expect(claimRows.n).toBe(0);

    // growth_events row survives (aggregate metric), but its user_id link
    // is now NULL so the behavioural trail is de-identified.
    const eventRow = db
      .prepare(
        "SELECT user_id FROM growth_events WHERE kind = 'signup.completed' ORDER BY id DESC LIMIT 1",
      )
      .get() as { user_id: number | null } | undefined;
    expect(eventRow).toBeDefined();
    expect(eventRow?.user_id).toBeNull();
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit 2026-06 — erasure completeness. Seven couple-scoped PII tables were
// never swept (purge UPDATEs couples.status='deleting' so couple_id cascades
// never fire). Seed each, purge, assert zero residual. Plus a generic drift
// tripwire that scans EVERY couple_id-bearing table so the next table shipped
// without a purge statement fails CI here, not in a regulator's inbox.
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit 2026-06 GDPR purge — newly-covered PII tables", () => {
  test("purgeOneCouple wipes the 7 previously-orphaned tables and scrubs pause-request reason", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("purge-pii@weddly.test");
    const userId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("purge-pii@weddly.test") as {
        id: number;
      }
    ).id;
    const ts = now();

    // Prerequisites for wishlist_interests (FK to households + wishlist_items).
    db.prepare(
      "INSERT INTO households (couple_id, code, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(coupleId, "9999", "Test HH", ts, ts);
    const householdId = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO wishlist_items (couple_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(coupleId, "A gift the couple wants", ts, ts);
    const itemId = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

    db.prepare(
      "INSERT INTO wishlist_interests (couple_id, item_id, household_id, household_code, household_label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(coupleId, itemId, householdId, "9999", "Test HH", ts);
    db.prepare(
      "INSERT INTO received_gifts (couple_id, title, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(coupleId, "A vase", "thank-you not yet sent", ts, ts);
    db.prepare(
      "INSERT INTO accommodations (couple_id, name, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(coupleId, "Hotel Budapest", "Some private address", ts, ts);
    db.prepare(
      "INSERT INTO transfers (couple_id, label, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(coupleId, "Airport shuttle", ts, ts);
    db.prepare(
      "INSERT INTO couple_notifications (couple_id, kind, data_json, created_at) VALUES (?, ?, ?, ?)",
    ).run(coupleId, "rsvp.received", '{"guest":"Anna"}', ts);
    db.prepare("INSERT INTO notification_seen (user_id, couple_id, seen_at) VALUES (?, ?, ?)").run(
      userId,
      coupleId,
      ts,
    );
    db.prepare(
      "INSERT INTO couple_pause_requests (couple_id, requested_by_user_id, scheduled_delete_at, status, reason, created_at) VALUES (?, ?, ?, 'pending', ?, ?)",
    ).run(
      coupleId,
      userId,
      ts + 86_400_000,
      "We need a break, contact us at anna@private.test",
      ts,
    );

    const tables = [
      "wishlist_interests",
      "wishlist_items",
      "received_gifts",
      "accommodations",
      "transfers",
      "couple_notifications",
      "notification_seen",
    ];
    // Sanity: every seed actually landed before we purge.
    for (const t of tables) {
      const n = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE couple_id = ?`).get(coupleId) as {
          n: number;
        }
      ).n;
      expect(n).toBeGreaterThan(0);
    }

    purgeOneCouple(coupleId);

    for (const t of tables) {
      const n = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE couple_id = ?`).get(coupleId) as {
          n: number;
        }
      ).n;
      expect([t, n]).toEqual([t, 0]);
    }

    // Pause request row is retained (FK target shape) but its free-text reason
    // is scrubbed; the requested_by_user_id stays (the user row is anonymized
    // in-place by the same sweep).
    const pause = db
      .prepare(
        "SELECT reason, status, requested_by_user_id FROM couple_pause_requests WHERE couple_id = ?",
      )
      .get(coupleId) as
      | { reason: string | null; status: string; requested_by_user_id: number }
      | undefined;
    expect(pause).toBeDefined();
    expect(pause?.reason).toBeNull();
    expect(pause?.status).toBe("completed");
    expect(pause?.requested_by_user_id).toBe(userId);
  }, 30_000);

  test("drift tripwire: no couple_id-bearing table retains rows after purge", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("purge-drift@weddly.test");
    // Exercise the app a little so real tables get populated through the API.
    const token = (
      await req<{ token: string }>("POST", "/api/auth/login", {
        email: "purge-drift@weddly.test",
        password: "supersafe123",
      })
    ).data.token;
    await req("POST", "/api/guests", { full_name: "Drift Guest" }, { token });
    await req(
      "POST",
      "/api/budget/lines",
      { category: "other", label: "Drift line", planned_huf: 1000 },
      { token },
    );

    purgeOneCouple(coupleId);

    // Tables that legitimately RETAIN a couple_id after purge: couples (scrubbed
    // in place, FK target for audit_log) and users (anonymized in place).
    // audit_log is append-only retention. Everything else must be empty.
    const RETAIN = new Set(["couples", "users", "audit_log"]);
    const allTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const offenders: string[] = [];
    for (const { name } of allTables) {
      if (RETAIN.has(name)) continue;
      const cols = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
      if (!cols.some((c) => c.name === "couple_id")) continue;
      const n = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${name} WHERE couple_id = ?`).get(coupleId) as {
          n: number;
        }
      ).n;
      if (n > 0) offenders.push(`${name}=${n}`);
    }
    expect(offenders).toEqual([]);
  }, 30_000);
});
