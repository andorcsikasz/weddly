// The "share your profile" nudge — a lifecycle email fired ~2h after a vendor
// creates their profile, highlighting the public share link (`/vendors/v{id}`)
// and naming any still-empty sections (photos / bio / calendar / packages).
//
// Covers (major-change rule — new email kind + schema column + worker sweep):
//   - nothing fires before the 2h mark
//   - the sweep sends exactly once past 2h, stamps share_nudge_sent_at, and a
//     second sweep respects the one-shot (idempotent)
//   - demo + purged owners are excluded
//   - the rendered mail carries the vendor's own clean (UTM-free) share URL and
//     names only the empty sections

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AuthSession } from "@shared/types";
import { db } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { req, wipeAll } from "../helpers";

async function registerVendor(email: string, businessName: string, locale = "en") {
  const r = await req<AuthSession>("POST", "/api/vendor/register", {
    email,
    password: "supersafe123",
    full_name: "Owner Person",
    business_name: businessName,
    category: "photography",
    locale,
  });
  expect(r.status).toBe(201);
  const account = db
    .prepare(
      "SELECT id FROM vendor_accounts WHERE owner_user_id = (SELECT id FROM users WHERE email = ?)",
    )
    .get(email) as { id: number };
  return account.id;
}

function backdateCreation(accountId: number, ms: number): void {
  const at = Date.now() - ms;
  db.prepare("UPDATE vendor_accounts SET created_at = ? WHERE id = ?").run(at, accountId);
}

function nudgeCount(accountId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM email_log
         WHERE kind = 'vendor_profile_share'
           AND user_id = (SELECT owner_user_id FROM vendor_accounts WHERE id = ?)`,
    )
    .get(accountId) as { n: number };
  return row.n;
}

function stamp(accountId: number): number | null {
  const row = db
    .prepare("SELECT share_nudge_sent_at FROM vendor_accounts WHERE id = ?")
    .get(accountId) as { share_nudge_sent_at: number | null };
  return row.share_nudge_sent_at;
}

describe("vendor profile-share nudge", () => {
  test("does not fire before the 2h mark", async () => {
    wipeAll();
    const id = await registerVendor("fresh-vendor@test.test", "Bloom Studio");
    // Just created — the 2h delay hasn't elapsed.
    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
    expect(stamp(id)).toBeNull();
  });

  test("fires exactly once past 2h and is idempotent", async () => {
    wipeAll();
    const id = await registerVendor("mature-vendor@test.test", "Bloom Studio");
    backdateCreation(id, 1000 * 60 * 60 * 3); // 3h ago

    runEmailSweep();
    expect(nudgeCount(id)).toBe(1);
    expect(stamp(id)).not.toBeNull();

    // A second sweep must NOT re-send.
    runEmailSweep();
    expect(nudgeCount(id)).toBe(1);
  });

  test("skips demo and purged owners", async () => {
    wipeAll();
    const demoId = await registerVendor("demo-x@demo.weddly.local", "Demo Cakes");
    const purgedId = await registerVendor("gone@purged.local", "Ghost Studio");
    backdateCreation(demoId, 1000 * 60 * 60 * 5);
    backdateCreation(purgedId, 1000 * 60 * 60 * 5);

    runEmailSweep();
    expect(nudgeCount(demoId)).toBe(0);
    expect(nudgeCount(purgedId)).toBe(0);
    // But their share_nudge_sent_at is never stamped either (they're filtered
    // out of the query entirely), so they can't accidentally block a later
    // legitimate send if the owner email ever changes.
    expect(stamp(demoId)).toBeNull();
  });

  test("EN render carries a clean share URL and names only the empty sections", () => {
    const built = buildEmail(
      "vendor_profile_share",
      {
        businessName: "Bloom Studio",
        shareUrl: "https://tryweddly.com/vendors/v11",
        editUrl: "https://tryweddly.com/vendor/listing",
        reviewsUrl: "https://tryweddly.com/vendor/reviews",
        missing: { photos: true, bio: false, calendar: true, packages: false },
      },
      { recipientName: "Bloom Studio", recipientLocale: "en" },
    );
    const html = built.rendered.html;
    // The share URL is the CTA and is UTM-free (noUtm) so the vendor can paste
    // it into their own channels without an email-attribution tag.
    expect(html).toContain("https://tryweddly.com/vendors/v11");
    expect(html).not.toContain("utm_source");
    // Only the two empty sections are named; the filled ones are not.
    expect(html).toContain("photos");
    expect(html).toContain("an availability calendar");
    expect(html).not.toContain("a short bio");
    expect(html).not.toContain("pricing packages");
    // The 5-star reviews trust nudge is present.
    expect(html.toLowerCase()).toContain("5-star");
    expect(html).toContain("/vendor/reviews");
  });

  test("HU render drops the 'missing sections' line when the profile is complete", () => {
    const built = buildEmail(
      "vendor_profile_share",
      {
        businessName: "Bloom Studio",
        shareUrl: "https://tryweddly.com/vendors/v11",
        editUrl: "https://tryweddly.com/vendor/listing",
        reviewsUrl: "https://tryweddly.com/vendor/reviews",
        missing: { photos: false, bio: false, calendar: false, packages: false },
      },
      { recipientName: "Bloom Studio", recipientLocale: "hu" },
    );
    const html = built.rendered.html;
    expect(html).toContain("Szia Bloom Studio!");
    // No "üresen áll" (empty sections) sentence when nothing is missing.
    expect(html).not.toContain("üresen áll");
  });
});
