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
    const { coupleId, userId } = await bootstrapCouple("purge-growth@weddly.test");
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
  });

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
  });
});
