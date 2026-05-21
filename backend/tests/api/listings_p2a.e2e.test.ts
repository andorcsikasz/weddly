// P2.A — Unified `listings` table coverage. Verifies:
//   - Boot-time backfill materialises every curated entry from suppliers_data.ts
//   - Community submissions dual-write into `listings` at id `c{N}`
//   - Status transitions (verify-email → admin-approve → hide → unhide) propagate
//   - Delete of the community row cleans the mirrored listings row
//   - Re-running backfill is idempotent (content_hash short-circuit)
//
// See [[feedback_multi_agent_debate]] and the conversation 2026-05-21 for the
// design rationale behind the listing/vendor_account split.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, verifyUserEmail, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { backfillListings } from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";

interface ListingSlim {
  id: string;
  source: string;
  status: string;
  category: string;
  name: string;
  vendor_account_id: number | null;
  updated_at: number;
}

function readListing(id: string): ListingSlim | null {
  return (
    (db
      .prepare(
        "SELECT id, source, status, category, name, vendor_account_id, updated_at FROM listings WHERE id = ?",
      )
      .get(id) as ListingSlim | undefined) ?? null
  );
}

/** wipeAll() in helpers.ts doesn't include `listings` (correct — curated rows
 *  are recreated by boot, not by tests). But community rows would orphan when
 *  community_suppliers is wiped underneath them, so clean those explicitly. */
function cleanState(): void {
  wipeAll();
  db.exec("DELETE FROM listings WHERE source != 'curated'");
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  if (reg.status === 201) {
    await verifyUserEmail("admin@test.test");
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

describe("P2.A boot backfill", () => {
  test("every curated entry from suppliers_data.ts lands as an active listing", () => {
    const count = (
      db.prepare("SELECT COUNT(*) AS c FROM listings WHERE source = 'curated'").get() as {
        c: number;
      }
    ).c;
    expect(count).toBe(DIRECTORY.length);

    // Spot-check the first few entries match by name + category + status.
    for (const entry of DIRECTORY.slice(0, 5)) {
      const row = readListing(entry.id);
      expect(row).not.toBeNull();
      expect(row?.source).toBe("curated");
      expect(row?.status).toBe("active");
      expect(row?.name).toBe(entry.name);
      expect(row?.category).toBe(entry.category);
      // Curated rows are unclaimed by default — vendor_account_id stays null
      // until a vendor claims via the (Phase 2.5) flow.
      expect(row?.vendor_account_id).toBeNull();
    }
  });

  test("re-running backfill is a no-op when content_hash matches (idempotent)", async () => {
    // Snapshot the curated rows' updated_at before re-running. If the short-
    // circuit works, none of them should bump on a second invocation.
    const before = db
      .prepare("SELECT id, updated_at FROM listings WHERE source = 'curated' ORDER BY id")
      .all() as { id: string; updated_at: number }[];
    expect(before.length).toBeGreaterThan(0);

    // Sleep past the millisecond boundary so any actual UPDATE would change
    // the recorded timestamp (Date.now() resolution).
    await Bun.sleep(5);
    backfillListings();

    const after = db
      .prepare("SELECT id, updated_at FROM listings WHERE source = 'curated' ORDER BY id")
      .all() as { id: string; updated_at: number }[];
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]?.updated_at).toBe(before[i]?.updated_at);
    }
  });
});

describe("P2.A community supplier dual-write", () => {
  test("submitting a community supplier creates a 'pending' listings row at c{N}", async () => {
    cleanState();
    const { token } = await bootstrapCouple("p2a-submit@weddly.test");
    const r = await req<{ supplier: { id: string; name: string } }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "photo_video",
        submitter_type: "user",
        name: "Test Photo Studio",
        city: "Budapest",
        address: null,
        website: "https://test-photo-studio.example",
        contact_email: "studio@test.example",
        contact_phone: null,
        blurb: "Test photo studio for listings dual-write coverage.",
        price_band: 3,
      },
      { token },
    );
    expect(r.status).toBe(201);

    const publicId = r.data.supplier.id;
    expect(publicId.startsWith("c")).toBe(true);

    const listing = readListing(publicId);
    expect(listing).not.toBeNull();
    expect(listing?.source).toBe("community");
    expect(listing?.status).toBe("pending");
    expect(listing?.category).toBe("photo_video");
    expect(listing?.name).toBe("Test Photo Studio");
    expect(listing?.vendor_account_id).toBeNull();
  });

  test("status transitions propagate: verify → approve → hide → unhide → delete", async () => {
    cleanState();
    const { token } = await bootstrapCouple("p2a-lifecycle@weddly.test");
    const r = await req<{ supplier: { id: string } }>(
      "POST",
      "/api/suppliers/community",
      {
        category: "music_dj",
        submitter_type: "self",
        name: "Lifecycle DJ",
        city: "Pécs",
        address: null,
        website: "https://lifecycle-dj.example",
        contact_email: "dj@lifecycle.example",
        contact_phone: null,
        blurb: "DJ submission exercising the full moderation lifecycle.",
        price_band: 2,
      },
      { token },
    );
    expect(r.status).toBe(201);
    const publicId = r.data.supplier.id;
    const numericId = Number(publicId.slice(1));
    expect(readListing(publicId)?.status).toBe("pending");

    // Consume the email verification token → awaiting_review on listings.
    const tok = db
      .prepare(
        "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(numericId) as { token: string } | undefined;
    expect(tok).toBeTruthy();
    const v = await req("POST", `/api/suppliers/community/verify/${tok?.token}`, {});
    expect(v.status).toBe(200);
    expect(readListing(publicId)?.status).toBe("awaiting_review");

    // Admin approve → active
    const adminToken = await registerAdminAndGetToken();
    const approve = await req(
      "POST",
      `/api/admin/suppliers/${numericId}/approve`,
      {},
      { token: adminToken },
    );
    expect(approve.status).toBe(200);
    expect(readListing(publicId)?.status).toBe("active");

    // Hide
    const hide = await req(
      "POST",
      `/api/admin/suppliers/${numericId}/hide`,
      { reason: "moderation test" },
      { token: adminToken },
    );
    expect(hide.status).toBe(200);
    expect(readListing(publicId)?.status).toBe("hidden");

    // Unhide → back to active
    const unhide = await req(
      "POST",
      `/api/admin/suppliers/${numericId}/unhide`,
      {},
      { token: adminToken },
    );
    expect(unhide.status).toBe(200);
    expect(readListing(publicId)?.status).toBe("active");

    // Delete → listings row gone
    const del = await req("DELETE", `/api/admin/suppliers/${numericId}`, undefined, {
      token: adminToken,
    });
    expect(del.status).toBe(200);
    expect(readListing(publicId)).toBeNull();
  });
});
