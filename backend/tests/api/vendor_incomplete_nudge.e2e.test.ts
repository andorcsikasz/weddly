// The recurring "your listing is still incomplete" reminder — a lifecycle email
// fired twice (day 3, then one week later) to VERIFIED vendors whose public listing
// has an unfinished section, capped at 5 sends, with rotating copy so no two
// reminders read the same.
//
// What counts as unfinished is NOT decided here: it is the same checklist the
// vendor's own setup ring draws (`listingChecklist`), which is the point of
// several of the tests below. The mail used to keep a second, hand-written
// definition, and the two disagreed in both directions at once.
//
// Covers (major-change rule — new email kind + 2 schema columns + worker sweep):
//   - nothing fires inside the post-signup grace window
//   - fires past the grace, stamps count + last_at, honours the cadence cooldown,
//     then fires again after the gap (recurring, unlike the one-shot share nudge)
//   - stops at the cap of 2
//   - a COMPLETE listing is skipped without advancing the count
//   - unverified vendors are excluded; demo + purged owners are excluded
//   - the copy rotates by variant and names only the empty sections
//   - a CLAIMED listing is counted by its own id, not `v<accountId>`
//   - an empty availability calendar is not an unfinished profile
//   - the mail and the vendor's ring name the same sections
//   - no listing at all, or one the vendor hid, earns no reminder

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AuthSession } from "@shared/types";
import { db } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { getListingByVendorAccountId, listingChecklist } from "../../src/domain/listings";
import { vendorListingMissing } from "../../src/domain/vendor_profile";
import { req, wipeAll } from "../helpers";

const DAY = 1000 * 60 * 60 * 24;

async function registerVendor(email: string, businessName: string) {
  const r = await req<AuthSession>("POST", "/api/vendor/register", {
    email,
    password: "supersafe123",
    full_name: "Owner Person",
    business_name: businessName,
    category: "photography",
    locale: "en",
  });
  expect(r.status).toBe(201);
  const account = db
    .prepare(
      "SELECT id FROM vendor_accounts WHERE owner_user_id = (SELECT id FROM users WHERE email = ?)",
    )
    .get(email) as { id: number };
  return account.id;
}

/** Fresh signups are verified_email=0; the sweep only nudges verified vendors. */
function verify(accountId: number): void {
  db.prepare(
    "UPDATE users SET verified_email = 1 WHERE id = (SELECT owner_user_id FROM vendor_accounts WHERE id = ?)",
  ).run(accountId);
}

function backdateCreation(accountId: number, ms: number): void {
  db.prepare("UPDATE vendor_accounts SET created_at = ? WHERE id = ?").run(
    Date.now() - ms,
    accountId,
  );
}

function setNudgeState(accountId: number, count: number, lastAgoMs: number | null): void {
  const lastAt = lastAgoMs === null ? null : Date.now() - lastAgoMs;
  db.prepare(
    "UPDATE vendor_accounts SET profile_nudge_count = ?, profile_nudge_last_at = ? WHERE id = ?",
  ).run(count, lastAt, accountId);
}

function readNudge(accountId: number): { count: number; lastAt: number | null } {
  const row = db
    .prepare(
      "SELECT profile_nudge_count AS count, profile_nudge_last_at AS lastAt FROM vendor_accounts WHERE id = ?",
    )
    .get(accountId) as { count: number; lastAt: number | null };
  return row;
}

/** email_log rows for the recurring incomplete-nudge, for this vendor's owner. */
function nudgeCount(accountId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM email_log
         WHERE kind = 'vendor_profile_incomplete'
           AND user_id = (SELECT owner_user_id FROM vendor_accounts WHERE id = ?)`,
    )
    .get(accountId) as { n: number };
  return row.n;
}

function listingIdOf(accountId: number): string {
  const listing = db
    .prepare("SELECT id FROM listings WHERE vendor_account_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(accountId) as { id: string };
  return listing.id;
}

/** Fill in every step of the setup checklist, so the listing reads as complete
 *  to the vendor's own ring AND to the sweep — one definition now, which is the
 *  point. Photography has no guest capacity, so that step doesn't apply.
 *
 *  Note there is nothing about the availability calendar here: an empty calendar
 *  means the vendor has no bookings, not an unfinished profile. */
function completeListing(accountId: number): void {
  const listingId = listingIdOf(accountId);
  const ts = Date.now();
  // City included: `POST /api/vendor/register` takes no town, so a fresh listing
  // is genuinely short the one field the editor marks required.
  db.prepare(
    "UPDATE listings SET hero_image_url = ?, blurb_hu = ?, price_band = 3, city = ? WHERE id = ?",
  ).run("https://cdn.example/hero.jpg", "Bemutatkozó szöveg a stúdióról.", "Budapest", listingId);
  db.prepare("INSERT INTO listing_photos (listing_id, url, created_at) VALUES (?, ?, ?)").run(
    listingId,
    "https://cdn.example/gallery-1.jpg",
    ts,
  );
  db.prepare(
    "INSERT INTO listing_packages (listing_id, name, price_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(listingId, "Alapcsomag", "150000 Ft", ts, ts);
}

describe("vendor incomplete-profile recurring nudge", () => {
  test("does not fire inside the post-signup grace window", async () => {
    wipeAll();
    const id = await registerVendor("grace@test.test", "Bloom Studio");
    verify(id);
    // Just created — the 3-day grace hasn't elapsed.
    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
    expect(readNudge(id).count).toBe(0);
  });

  test("fires past the grace, then recurs after the cadence gap (not one-shot)", async () => {
    wipeAll();
    const id = await registerVendor("recurs@test.test", "Bloom Studio");
    verify(id);
    backdateCreation(id, 3 * DAY);

    runEmailSweep();
    expect(nudgeCount(id)).toBe(1);
    const after1 = readNudge(id);
    expect(after1.count).toBe(1);
    expect(after1.lastAt).not.toBeNull();

    // An immediate second sweep must NOT re-send — the cadence cooldown holds.
    runEmailSweep();
    expect(nudgeCount(id)).toBe(1);

    // Push last_at past the one-week gap and the second, final touch goes out.
    setNudgeState(id, 1, 8 * DAY);
    runEmailSweep();
    expect(nudgeCount(id)).toBe(2);
    expect(readNudge(id).count).toBe(2);
  });

  test("stops at the cap of 2 reminders", async () => {
    wipeAll();
    const id = await registerVendor("capped@test.test", "Bloom Studio");
    verify(id);
    backdateCreation(id, 30 * DAY);
    // Already sent the full series, cooldown long elapsed.
    setNudgeState(id, 2, 10 * DAY);

    runEmailSweep();
    expect(nudgeCount(id)).toBe(0); // capped out — nothing new
    expect(readNudge(id).count).toBe(2);
  });

  test("skips a complete listing without advancing the count", async () => {
    wipeAll();
    const id = await registerVendor("complete@test.test", "Bloom Studio");
    verify(id);
    backdateCreation(id, 3 * DAY);
    completeListing(id);

    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
    // Count is untouched, so re-emptying a section later resumes the series.
    expect(readNudge(id).count).toBe(0);
  });

  test("skips unverified vendors", async () => {
    wipeAll();
    const id = await registerVendor("unverified@test.test", "Bloom Studio");
    // NOT verified.
    backdateCreation(id, 3 * DAY);
    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
  });

  test("skips demo and purged owners", async () => {
    wipeAll();
    const demoId = await registerVendor("demo-x@demo.weddly.local", "Demo Cakes");
    const purgedId = await registerVendor("gone@purged.local", "Ghost Studio");
    verify(demoId);
    verify(purgedId);
    backdateCreation(demoId, 5 * DAY);
    backdateCreation(purgedId, 5 * DAY);

    runEmailSweep();
    expect(nudgeCount(demoId)).toBe(0);
    expect(nudgeCount(purgedId)).toBe(0);
  });

  test("copy rotates by variant and names only the empty sections", () => {
    const payload = {
      businessName: "Bloom Studio",
      editUrl: "https://tryweddly.com/vendor/listing",
      missing: {
        cover: true,
        gallery: false,
        description: false,
        contact: false,
        pricing: true,
        capacity: false,
        packages: false,
      },
    };
    const v0 = buildEmail(
      "vendor_profile_incomplete",
      { ...payload, variant: 0 },
      { recipientName: "Bloom Studio", recipientLocale: "en" },
    );
    const v1 = buildEmail(
      "vendor_profile_incomplete",
      { ...payload, variant: 1 },
      { recipientName: "Bloom Studio", recipientLocale: "en" },
    );
    // Consecutive reminders read differently.
    expect(v0.subject).not.toBe(v1.subject);
    // Variant index wraps (5 variants), so variant 5 reads like variant 0.
    const v5 = buildEmail(
      "vendor_profile_incomplete",
      { ...payload, variant: 5 },
      { recipientName: "Bloom Studio", recipientLocale: "en" },
    );
    expect(v5.subject).toBe(v0.subject);
    // Only the empty sections are named; the filled ones are not.
    const html = v0.rendered.html;
    expect(html).toContain("a cover photo");
    expect(html).toContain("a price range");
    expect(html).not.toContain("gallery photos");
    expect(html).not.toContain("a short bio");
    expect(html).not.toContain("pricing packages");
    expect(html).not.toContain("guest capacity");
    expect(html).not.toContain("an availability calendar");
    expect(html).toContain("/vendor/listing");
  });

  // Both regressions here come from one line: the sweep counted photos and
  // packages under `v<accountId>`, an id only a listing born at vendor register
  // carries. A CLAIMED listing keeps the id it was imported under, so two thirds
  // of live vendors were told their photos and packages were missing while both
  // were on their page, and no amount of uploading could ever satisfy it.
  test("a claimed listing is read by its OWN id, not v<accountId>", async () => {
    wipeAll();
    const id = await registerVendor("claimed@test.test", "Csengőkoncert");
    verify(id);
    backdateCreation(id, 3 * DAY);
    // Re-key the listing the way a claim does: same vendor, imported id.
    const born = listingIdOf(id);
    db.prepare("UPDATE listings SET id = ? WHERE id = ?").run("harangszo-koncert-studio", born);
    completeListing(id);
    expect(listingIdOf(id)).toBe("harangszo-koncert-studio");

    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
    expect(readNudge(id).count).toBe(0);
  });

  test("an empty availability calendar is not an unfinished profile", async () => {
    wipeAll();
    const id = await registerVendor("nobookings@test.test", "Bloom Studio");
    verify(id);
    backdateCreation(id, 3 * DAY);
    completeListing(id);
    // Not one blocked date anywhere: this vendor is simply free, which is the
    // state 50 of 62 live accounts were in when the sweep called them incomplete.
    const blocked = db
      .prepare("SELECT COUNT(*) AS n FROM vendor_unavailable_dates WHERE vendor_account_id = ?")
      .get(id) as { n: number };
    expect(blocked.n).toBe(0);

    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
  });

  // The mail and the portal used to answer "what is missing" separately, which
  // is how a vendor could be told to add packages while their own dashboard ring
  // read 100%. One definition now: `vendorListingMissing` derives from the same
  // checklist the ring draws.
  test("the mail never names a section the vendor's own ring calls done", async () => {
    wipeAll();
    const id = await registerVendor("agrees@test.test", "Bloom Studio");
    verify(id);
    backdateCreation(id, 3 * DAY);
    const listingId = listingIdOf(id);
    // Everything except the gallery.
    db.prepare(
      "UPDATE listings SET hero_image_url = ?, blurb_hu = ?, price_band = 3 WHERE id = ?",
    ).run("https://cdn.example/hero.jpg", "Bemutatkozó.", listingId);
    db.prepare(
      "INSERT INTO listing_packages (listing_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run(listingId, "Alapcsomag", Date.now(), Date.now());

    const missing = vendorListingMissing(id);
    const undoneSteps = new Set(
      listingChecklist(getListingByVendorAccountId(id))
        .filter((s) => !s.done)
        .map((s) => s.key),
    );
    // Same set, both directions: nothing named that the ring ticked, nothing
    // ticked that the mail still asks for.
    for (const [key, isMissing] of Object.entries(missing)) {
      expect(isMissing).toBe(undoneSteps.has(key as never));
    }
    expect(missing.gallery).toBe(true);
    expect(missing.packages).toBe(false);
  });

  test("no listing yet, or one the vendor hid, earns no reminder", async () => {
    wipeAll();
    // Mid-onboarding: the mail's CTA would land on an editor that 404s.
    const orphan = await registerVendor("nolisting@test.test", "Bloom Studio");
    verify(orphan);
    backdateCreation(orphan, 3 * DAY);
    db.prepare("DELETE FROM listings WHERE vendor_account_id = ?").run(orphan);

    // Taken down on purpose: "finish the profile nobody can see" answers a
    // question this vendor did not ask.
    const hidden = await registerVendor("hidden@test.test", "Quiet Studio");
    verify(hidden);
    backdateCreation(hidden, 3 * DAY);
    db.prepare("UPDATE listings SET status = 'hidden' WHERE vendor_account_id = ?").run(hidden);

    runEmailSweep();
    expect(nudgeCount(orphan)).toBe(0);
    expect(nudgeCount(hidden)).toBe(0);
    // Neither burned a slot in the series: it resumes if the listing arrives or
    // goes live again.
    expect(readNudge(orphan).count).toBe(0);
    expect(readNudge(hidden).count).toBe(0);
  });
});
