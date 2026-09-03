// Source-dispute quarantine (domain/listing_quarantine.ts) — built 2026-09-03
// after bodalia.es disputed the 2026-08-19 WeddlyResearchBot crawl behind
// suppliers_data_es_scale_*.ts. Covers the invariants that actually matter
// for an incident response, not just the happy path:
//   - a quarantined listing disappears from every public read (catalogue,
//     detail-by-id/"direct URL", and the /uploads/ image route)
//   - the self-serve claim flow (start/verify/complete) is UNAFFECTED — the
//     quarantine must never block a real vendor from proving who they are
//   - the ordinary visibility toggle CANNOT be used to bypass the gate —
//     this is the one that isn't automatic, see handleSetVisibility
//   - publishing requires genuinely new imagery, not just a re-save
//   - an already-claimed listing is never touched by a quarantine batch

import "../setup";

import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import { isVendorSelfServeBlocked } from "@shared/suppliers";
import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { isCuratedPubliclyVisible } from "../../src/domain/curated_overrides";
import {
  findQuarantineCandidates,
  isUnderQuarantineReview,
  QUARANTINE_REASON_BODALIA,
  quarantineListings,
} from "../../src/domain/listing_quarantine";
import { getListingById } from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

const PORT = process.env.PORT ?? "8791";
const BASE = `http://localhost:${PORT}`;
const DISPUTE_HOST = "quarantine-test-source.example";

async function adminToken(): Promise<string> {
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

/** A real curated slug with a contact email and a self-serve-claimable
 *  category, resolved live from DIRECTORY (not hardcoded — see the same
 *  pattern in vendor_removal_request.e2e.test.ts). Its `website` is stomped
 *  to a fake disputed host so `findQuarantineCandidates` can find it without
 *  touching any other test's fixture data.
 *
 *  `wipeAll()` deliberately leaves curated `listings` rows alone (they're
 *  re-materialised by `backfillListings()` at boot, not per test), so a claim
 *  or quarantine this suite wrote in an earlier test survives into the next
 *  one that resolves the same deterministic DIRECTORY entry. Reset every
 *  column this suite mutates back to pristine before handing the id back —
 *  otherwise the second test in the file finds its own "candidate" already
 *  excluded by the very filters (`vendor_account_id IS NULL`,
 *  `quarantined_at IS NULL`) it's trying to exercise. */
function pickClaimableCuratedListing(): { id: string; contactEmail: string; name: string } {
  const entry = DIRECTORY.find(
    (s) =>
      typeof s.contact_email === "string" &&
      s.contact_email !== "" &&
      !isVendorSelfServeBlocked(s.category),
  );
  if (!entry) throw new Error("no claimable curated entry with a contact email");
  db.prepare(
    `UPDATE listings
        SET vendor_account_id = NULL, status = 'active',
            quarantined_at = NULL, quarantine_reason = NULL,
            image_rights_confirmed_at = NULL, vendor_published_at = NULL,
            pre_quarantine_hero_url = NULL, pre_quarantine_photo_urls = NULL
      WHERE id = ?`,
  ).run(entry.id);
  return { id: entry.id, contactEmail: entry.contact_email as string, name: entry.name };
}

function stompWebsiteToDisputedHost(id: string): void {
  db.prepare("UPDATE listings SET website = ? WHERE id = ?").run(
    `https://${DISPUTE_HOST}/proveedor/${id}`,
    id,
  );
}

async function quarantineOne(id: string): Promise<void> {
  const admin = await adminToken();
  const meRes = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, {
    token: admin,
  });
  const adminUserId = meRes.data.user.id;
  const candidates = findQuarantineCandidates(DISPUTE_HOST);
  expect(candidates).toContain(id);
  await quarantineListings(candidates, adminUserId, QUARANTINE_REASON_BODALIA);
}

interface ClaimRow {
  token: string;
}

async function claimListing(listingId: string, contactEmail: string): Promise<string> {
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
  expect(claim).toBeTruthy();
  const verify = await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  expect(verify.status).toBe(200);
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: "Vendor Owner",
    privacy_version: PRIVACY_VERSION,
    vendor_terms_version: VENDOR_TERMS_VERSION,
    highlighted_terms_accepted: true,
  });
  expect(complete.status).toBe(201);
  return complete.data.token;
}

function tinyPngBlob(): Blob {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);
  return new Blob([bytes], { type: "image/png" });
}

async function uploadHero(vendorToken: string): Promise<Response> {
  const form = new FormData();
  form.append("file", tinyPngBlob(), "hero.png");
  return await fetch(`${BASE}/api/vendor/listing/me/hero`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${vendorToken}`,
      "x-test-client-ip": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    },
    body: form,
  });
}

describe("quarantine — batch application", () => {
  test("finds and quarantines the disputed listing; leaves everything else alone", async () => {
    wipeAll();
    const { id } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);

    expect(isCuratedPubliclyVisible(id)).toBe(true);
    await quarantineOne(id);

    expect(isCuratedPubliclyVisible(id)).toBe(false);
    const row = getListingById(id);
    expect(row?.status).toBe("hidden");
    expect(row?.quarantined_at).not.toBeNull();
    expect(row?.quarantine_reason).toBe(QUARANTINE_REASON_BODALIA);
    expect(isUnderQuarantineReview(row!)).toBe(true);
  });

  test("never touches an already-claimed listing", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    await claimListing(id, contactEmail);

    const candidates = findQuarantineCandidates(DISPUTE_HOST);
    expect(candidates).not.toContain(id);

    const admin = await adminToken();
    const meRes = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, {
      token: admin,
    });
    const result = await quarantineListings([id], meRes.data.user.id, QUARANTINE_REASON_BODALIA);
    expect(result.quarantined).not.toContain(id);
    expect(result.skippedAlreadyClaimed).toContain(id);

    const row = getListingById(id);
    expect(row?.status).toBe("active");
    expect(row?.quarantined_at).toBeNull();
  });

  test("is idempotent — a second run is a no-op on the same id", async () => {
    wipeAll();
    const { id } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    await quarantineOne(id);

    const admin = await adminToken();
    const meRes = await req<{ user: { id: number } }>("GET", "/api/auth/me", undefined, {
      token: admin,
    });
    const second = await quarantineListings([id], meRes.data.user.id, QUARANTINE_REASON_BODALIA);
    expect(second.quarantined).not.toContain(id);
    expect(second.skippedAlreadyQuarantined).toContain(id);
  });
});

describe("quarantine — public exposure is closed on every surface", () => {
  test("catalogue list no longer includes it", async () => {
    wipeAll();
    const { id } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    // The public catalogue is photos-only (handlePublicDirectory filters on
    // `hero_image_url`), and a curated row gets one only via the boot-time
    // image backfill sweep, which never runs in tests — give it one directly
    // so this is a test of the quarantine filter, not of that sweep.
    db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
      "/uploads/listings/x/hero.webp",
      id,
    );
    const before = await req<{ vendors: Array<{ id: string }> }>(
      "GET",
      "/api/public/vendors?limit=500",
    );
    expect(before.data.vendors.some((v) => v.id === id)).toBe(true);

    await quarantineOne(id);

    const after = await req<{ vendors: Array<{ id: string }> }>(
      "GET",
      "/api/public/vendors?limit=500",
    );
    expect(after.data.vendors.some((v) => v.id === id)).toBe(false);
  });

  test("the direct detail URL 404s, not just the list", async () => {
    wipeAll();
    const { id } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    await quarantineOne(id);

    const detail = await req("GET", `/api/public/vendors/${id}`);
    expect(detail.status).toBeGreaterThanOrEqual(400);
  });

  test("its hero image is no longer servable by direct URL", async () => {
    wipeAll();
    const { id } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    const heroKey = `listings/${id}/hero.webp`;
    db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
      `/uploads/${heroKey}`,
      id,
    );
    // Write real bytes so a pre-quarantine fetch would otherwise succeed —
    // proving the denial comes from the row's status, not a missing file.
    const { storage } = await import("../../src/lib/storage");
    await storage.write(heroKey, tinyPngBlob());

    const before = await fetch(`${BASE}/uploads/${heroKey}`);
    expect(before.status).toBe(200);

    await quarantineOne(id);

    const after = await fetch(`${BASE}/uploads/${heroKey}`);
    expect(after.status).toBe(404);
  });
});

describe("quarantine — the claim flow is unaffected", () => {
  test("start → verify → complete still works on a hidden, quarantined listing", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    await quarantineOne(id);

    const vendorToken = await claimListing(id, contactEmail);
    expect(vendorToken).toBeTruthy();

    const row = getListingById(id);
    expect(row?.vendor_account_id).not.toBeNull();
    // Claiming does not itself lift the quarantine — the row stays hidden
    // until the vendor completes the gated review/publish below.
    expect(row?.status).toBe("hidden");
    expect(isUnderQuarantineReview(row!)).toBe(true);
  });
});

describe("quarantine — the ordinary visibility toggle cannot bypass it", () => {
  test("POST .../visibility {published:true} is refused while under review", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    await quarantineOne(id);
    const vendorToken = await claimListing(id, contactEmail);

    const toggle = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: true },
      { token: vendorToken },
    );
    expect(toggle.status).toBe(409);
    expect(toggle.data.detail?.code).toBe("quarantine_review_required");

    // And the override really is still in place — the toggle made no change.
    expect(isCuratedPubliclyVisible(id)).toBe(false);
  });

  test("turning it OFF still works normally (nothing to bypass in that direction)", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    await quarantineOne(id);
    const vendorToken = await claimListing(id, contactEmail);

    const toggle = await req(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: false },
      { token: vendorToken },
    );
    expect(toggle.status).toBe(200);
  });
});

describe("quarantine — the vendor's private review + gated publish", () => {
  test("GET .../quarantine reports under review, blocked on no new image", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
      "/uploads/listings/x/hero.webp",
      id,
    );
    await quarantineOne(id);
    const vendorToken = await claimListing(id, contactEmail);

    const status = await req<{
      under_review: boolean;
      can_publish: boolean;
      blocked_reason: string | null;
      hero_preview_url: string | null;
    }>("GET", "/api/vendor/listing/me/quarantine", undefined, { token: vendorToken });
    expect(status.status).toBe(200);
    expect(status.data.under_review).toBe(true);
    expect(status.data.can_publish).toBe(false);
    expect(status.data.blocked_reason).toBe("no_new_image");
    expect(status.data.hero_preview_url).toBeTruthy();
  });

  test("publish is refused until a fresh image is uploaded, then succeeds", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
      "/uploads/listings/x/hero.webp",
      id,
    );
    await quarantineOne(id);
    const vendorToken = await claimListing(id, contactEmail);

    const blocked = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/vendor/listing/me/quarantine/publish",
      {},
      { token: vendorToken },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.data.detail?.code).toBe("no_new_image");

    const upload = await uploadHero(vendorToken);
    expect(upload.status).toBe(200);

    const statusAfterUpload = await req<{ can_publish: boolean }>(
      "GET",
      "/api/vendor/listing/me/quarantine",
      undefined,
      { token: vendorToken },
    );
    expect(statusAfterUpload.data.can_publish).toBe(true);

    const published = await req(
      "POST",
      "/api/vendor/listing/me/quarantine/publish",
      {},
      { token: vendorToken },
    );
    expect(published.status).toBe(200);

    const row = getListingById(id);
    expect(row?.status).toBe("active");
    expect(row?.image_rights_confirmed_at).not.toBeNull();
    expect(row?.vendor_published_at).not.toBeNull();
    // The historical fact survives publication — it's a record, not a flag.
    expect(row?.quarantined_at).not.toBeNull();
    expect(isCuratedPubliclyVisible(id)).toBe(true);

    // And now the ordinary toggle governs it like any other claimed listing.
    const toggleOff = await req(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: false },
      { token: vendorToken },
    );
    expect(toggleOff.status).toBe(200);
    const toggleOn = await req(
      "POST",
      "/api/vendor/listing/me/visibility",
      { published: true },
      { token: vendorToken },
    );
    expect(toggleOn.status).toBe(200);
  });

  test("the preview image is only reachable by the owning vendor, not anonymously or by another vendor", async () => {
    wipeAll();
    const { id, contactEmail } = pickClaimableCuratedListing();
    stompWebsiteToDisputedHost(id);
    const heroKey = `listings/${id}/hero.webp`;
    db.prepare("UPDATE listings SET hero_image_url = ? WHERE id = ?").run(
      `/uploads/${heroKey}`,
      id,
    );
    const { storage } = await import("../../src/lib/storage");
    await storage.write(heroKey, tinyPngBlob());
    await quarantineOne(id);
    const vendorToken = await claimListing(id, contactEmail);

    const anon = await req("GET", "/api/vendor/listing/me/quarantine-preview/hero");
    expect(anon.status).toBeGreaterThanOrEqual(401);

    const other = await bootstrapCouple("someone-else@weddly.test");
    const otherAsVendor = await req(
      "GET",
      "/api/vendor/listing/me/quarantine-preview/hero",
      undefined,
      { token: other.token },
    );
    expect(otherAsVendor.status).toBeGreaterThanOrEqual(400);

    // Plain fetch, not the `req()` helper — a successful response here is raw
    // image bytes (storage.serve's Response), not JSON.
    const owner = await fetch(`${BASE}/api/vendor/listing/me/quarantine-preview/hero`, {
      headers: { Authorization: `Bearer ${vendorToken}` },
    });
    expect(owner.status).toBe(200);

    // And it's genuinely not reachable through the public static route either
    // — private means authenticated-only, not merely unlinked.
    const publicAttempt = await fetch(`${BASE}/uploads/quarantine-evidence/${id}/hero.webp`);
    expect(publicAttempt.status).toBe(404);
  });
});
