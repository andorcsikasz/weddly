// /api/public/wedding/:slug — happy path + 404 guards. The endpoint is the
// public-facing landing for a couple's wedding ("microsite"), so the privacy
// contract matters: archived/paused/purged workspaces must not leak, and a
// missing/malformed slug must not 500.
//
// Minimal coverage in this milestone — privacy-radius distortion + leakage
// shape will get harder coverage when the microsite gets dedicated UI.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import type { PublicWeddingResponse, PublicWeddingWebsiteView } from "@shared/wedding_website";

/** Helpers shared by the tier-aware tests below. The public-wedding
 *  endpoint now serves three tiers off the same URL — these helpers
 *  build the household + RSVP state we need to exercise the
 *  invited/confirmed paths. */
async function getSlug(coupleId: number): Promise<string> {
  const row = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
    | { slug: string }
    | undefined;
  if (!row) throw new Error(`no slug for couple ${coupleId}`);
  return row.slug;
}

async function createHouseholdWithGuest(
  token: string,
  label: string,
): Promise<{ household_id: number; household_code: string; guest_id: number }> {
  const hh = await req<{ household: { id: number; code: string } }>(
    "POST",
    "/api/households",
    { label },
    { token },
  );
  if (hh.status !== 201) throw new Error(`household create failed: ${hh.status}`);
  const g = await req<{ guest: { id: number } }>(
    "POST",
    "/api/guests",
    { full_name: `Guest of ${label}`, household_id: hh.data.household.id },
    { token },
  );
  if (g.status !== 201) throw new Error(`guest create failed: ${g.status}`);
  return {
    household_id: hh.data.household.id,
    household_code: hh.data.household.code,
    guest_id: g.data.guest.id,
  };
}

describe("GET /api/public/wedding/:slug — minimal coverage", () => {
  test("active + opted-in workspace returns the public view shape", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("public-wedding-active@weddly.test");
    // Next-7 introduced couples.is_public, default 0. Every existing slug
    // 404s until the couple opts in via the Profile toggle. Flip it here
    // so the happy-path assertion runs against a published workspace.
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    expect(slugRow?.slug).toBeTruthy();

    const r = await req<{ wedding: PublicWeddingWebsiteView }>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.wedding.couple_slug).toBe(slugRow!.slug);
    expect(r.data.wedding.couple_display_name).toBeTruthy();
    expect(r.data.wedding.wedding_date).toBe("2026-09-12");
    expect(Array.isArray(r.data.wedding.schedule)).toBe(true);
    // PII boundary: the response shape MUST NOT include guests, budget, or
    // workspace-internal fields. Spot-check the keys.
    const keys = new Set(Object.keys(r.data.wedding));
    expect(keys.has("couple_slug")).toBe(true);
    expect(keys.has("guests")).toBe(false);
    expect(keys.has("budget")).toBe(false);
    expect(keys.has("partner_a_id")).toBe(false);
  });

  test("active but private (is_public = 0) workspace 404s", async () => {
    // GDPR Art. 25 — every couple is private by default. The 404 mirrors
    // the unknown-slug response so a scanner can't tell "this slug exists
    // but isn't published" from "this slug doesn't exist."
    wipeAll();
    const { coupleId } = await bootstrapCouple("public-wedding-private@weddly.test");
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    expect(slugRow?.slug).toBeTruthy();
    // No UPDATE — is_public defaults to 0.
    const r = await req("GET", `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`);
    expect(r.status).toBe(404);
  });

  test("archived workspace 404s (status !== 'active' guard)", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("public-wedding-archived@weddly.test");
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    db.prepare("UPDATE couples SET status = 'archived' WHERE id = ?").run(coupleId);

    const r = await req("GET", `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`);
    expect(r.status).toBe(404);
  });

  test("unknown slug 404s", async () => {
    wipeAll();
    const r = await req("GET", "/api/public/wedding/NONEXISTENT");
    expect(r.status).toBe(404);
  });

  test("malformed slug (too long) 400s", async () => {
    wipeAll();
    const longSlug = "A".repeat(80);
    const r = await req("GET", `/api/public/wedding/${longSlug}`);
    expect(r.status).toBe(400);
  });
});

describe("/w/:slug SSR meta — couple-personalised <title> + OG tags", () => {
  test("opted-in couple → title carries name + date, og:image uses cover URL", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("ssr-meta@weddly.test");
    db.prepare(
      "UPDATE couples SET is_public = 1, venue_name = ?, cover_image_url = ? WHERE id = ?",
    ).run("Festetics Palace", "https://images.example/cover.jpg", coupleId);
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;

    // The frontend index.html is only served when the SPA bundle exists in
    // dist/ — in tests we hit the raw seo_ssr module instead, which lets us
    // assert the SSR contract without a build step.
    const { renderIndexHtml } = await import("../../src/lib/seo_ssr");
    const template = [
      '<!doctype html><html lang="hu"><head>',
      "<!-- SEO_HEAD_START -->",
      "<title>placeholder</title>",
      "<!-- SEO_HEAD_END -->",
      '</head><body><div id="root"></div></body></html>',
    ].join("\n");
    const html = renderIndexHtml(template, {
      host: "weddly.hu",
      pathname: `/w/${slugRow!.slug}`,
      isRsvp: false,
    });

    // Title carries the couple display_name + wedding date + venue.
    expect(html).toContain("<title>");
    expect(html).toContain("2026-09-12");
    expect(html).toContain("Festetics Palace");
    // og:image points at the couple-pasted cover URL, not the brand fallback.
    expect(html).toContain('property="og:image" content="https://images.example/cover.jpg"');
    expect(html).not.toContain('content="https://weddly.hu/og.png"');
  });

  test("private couple → SSR falls back to brand meta (no personalisation leak)", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("ssr-meta-private@weddly.test");
    // is_public stays 0 by default — the lookup must return null.
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;

    const { renderIndexHtml } = await import("../../src/lib/seo_ssr");
    const template = [
      '<!doctype html><html lang="hu"><head>',
      "<!-- SEO_HEAD_START -->",
      "<title>placeholder</title>",
      "<!-- SEO_HEAD_END -->",
      "</head><body></body></html>",
    ].join("\n");
    const html = renderIndexHtml(template, {
      host: "weddly.hu",
      pathname: `/w/${slugRow!.slug}`,
      isRsvp: false,
    });

    // No couple data in the head — brand default title + og:image. The
    // slug itself is allowed in `canonical` / `og:url` because that's
    // just the URL the page was served on; the leak we guard against is
    // names / dates / venue showing up in title or description. EN is
    // the default render locale now (no Accept-Language forwarded by
    // production server.ts), so the brand line we assert is the EN one.
    expect(html).toContain('content="https://weddly.hu/og.png"');
    expect(html).toContain("Weddly · Your shared wedding-planning workspace");
    // Spot-check that the bride/groom test names (set by bootstrapCouple)
    // do NOT leak into the head when is_public = 0.
    expect(html).not.toContain("Anna");
    expect(html).not.toContain("Bence");
  });
});

// Couple-facing editor at /app/wedding-site flips couples.is_public via
// PATCH /api/couples/current. Without this PATCH allowlist, the public
// endpoint stayed 404'd for every couple — there's no other UI to enable
// it. These tests pin the contract end-to-end: PATCH → public 200, plus
// the boundary parsers (URL scheme, length cap, strict boolean).
describe("PATCH /api/couples/current — wedding-site fields (is_public, venue_name, cover_image_url)", () => {
  test("flipping is_public to true makes the public endpoint return 200", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ws-editor-publish@weddly.test");
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;
    expect(slugRow?.slug).toBeTruthy();

    // Before PATCH: 404 (default is_public = 0).
    const before = await req("GET", `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`);
    expect(before.status).toBe(404);

    const patch = await req<{ couple: { is_public: boolean } }>(
      "PATCH",
      "/api/couples/current",
      { is_public: true },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.is_public).toBe(true);

    const after = await req("GET", `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`);
    expect(after.status).toBe(200);
  });

  test("flipping is_public back to false re-hides the page (404)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ws-editor-unpublish@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const slugRow = db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as
      | { slug: string }
      | undefined;

    const before = await req("GET", `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`);
    expect(before.status).toBe(200);

    const patch = await req<{ couple: { is_public: boolean } }>(
      "PATCH",
      "/api/couples/current",
      { is_public: false },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.is_public).toBe(false);

    const after = await req("GET", `/api/public/wedding/${encodeURIComponent(slugRow!.slug)}`);
    expect(after.status).toBe(404);
  });

  test("venue_name + cover_image_url persist and round-trip on GET /api/couples/current", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-editor-fields@weddly.test");
    const cover = "https://images.example/cover.jpg";
    const patch = await req<{ couple: { venue_name: string; cover_image_url: string } }>(
      "PATCH",
      "/api/couples/current",
      { venue_name: "Sári Udvar", cover_image_url: cover },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.venue_name).toBe("Sári Udvar");
    expect(patch.data.couple.cover_image_url).toBe(cover);

    const fresh = await req<{ couple: { venue_name: string; cover_image_url: string } }>(
      "GET",
      "/api/couples/current",
      undefined,
      { token },
    );
    expect(fresh.data.couple.venue_name).toBe("Sári Udvar");
    expect(fresh.data.couple.cover_image_url).toBe(cover);
  });

  test("empty string clears venue_name + cover_image_url (back to null)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("ws-editor-clear@weddly.test");
    db.prepare("UPDATE couples SET venue_name = ?, cover_image_url = ? WHERE id = ?").run(
      "Old",
      "https://example.com/x.jpg",
      coupleId,
    );

    const patch = await req<{
      couple: { venue_name: string | null; cover_image_url: string | null };
    }>("PATCH", "/api/couples/current", { venue_name: "", cover_image_url: "" }, { token });
    expect(patch.status).toBe(200);
    expect(patch.data.couple.venue_name).toBeNull();
    expect(patch.data.couple.cover_image_url).toBeNull();
  });

  test("cover_image_url must be http(s) — data: / javascript: rejected with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-editor-bad-url@weddly.test");

    const dataUrl = await req(
      "PATCH",
      "/api/couples/current",
      { cover_image_url: "data:image/png;base64,iVBORw0KGgo=" },
      { token },
    );
    expect(dataUrl.status).toBe(400);

    const jsUrl = await req(
      "PATCH",
      "/api/couples/current",
      { cover_image_url: "javascript:alert(1)" },
      { token },
    );
    expect(jsUrl.status).toBe(400);

    const malformed = await req(
      "PATCH",
      "/api/couples/current",
      { cover_image_url: "not a url" },
      { token },
    );
    expect(malformed.status).toBe(400);
  });

  test("is_public requires a strict boolean — truthy strings rejected with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-editor-strict-bool@weddly.test");
    const r = await req("PATCH", "/api/couples/current", { is_public: "true" }, { token });
    expect(r.status).toBe(400);
  });

  test("venue_name longer than 200 chars rejected with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("ws-editor-long-venue@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { venue_name: "x".repeat(201) },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Vendégoldal Phase 2 — tier-aware public-wedding endpoint
// ─────────────────────────────────────────────────────────────────────────
//
// The unified endpoint serves three tiers off the same path:
//   - /api/public/wedding/:slug          → public tier
//   - /api/public/wedding/:slug/:code    → invited (no yes) or confirmed (≥1 yes)
// The frontend reads `tier` and renders the corresponding sections; the
// server-side contract is that gated fields (exact lat/lng, post-RSVP
// content, household.members) are OMITTED from the payload below the
// matching tier. These tests pin that contract end-to-end.

describe("/api/public/wedding tier ladder", () => {
  test("PATCH allowlist persists guest_page_intro + post_rsvp_content and the values round-trip", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("phase2-fields@weddly.test");
    const patch = await req<{
      couple: { guest_page_intro: string | null; post_rsvp_content: string | null };
    }>(
      "PATCH",
      "/api/couples/current",
      {
        guest_page_intro: "Welcome — pls RSVP",
        post_rsvp_content: "Parking is at the gate.\nDress code: garden formal.",
      },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.guest_page_intro).toBe("Welcome — pls RSVP");
    expect(patch.data.couple.post_rsvp_content).toBe(
      "Parking is at the gate.\nDress code: garden formal.",
    );

    const fresh = await req<{
      couple: { guest_page_intro: string | null; post_rsvp_content: string | null };
    }>("GET", "/api/couples/current", undefined, { token });
    expect(fresh.data.couple.guest_page_intro).toBe("Welcome — pls RSVP");
    expect(fresh.data.couple.post_rsvp_content).toBe(
      "Parking is at the gate.\nDress code: garden formal.",
    );
  });

  test("empty string clears guest_page_intro / post_rsvp_content (back to null)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("phase2-clear@weddly.test");
    db.prepare("UPDATE couples SET guest_page_intro = ?, post_rsvp_content = ? WHERE id = ?").run(
      "old intro",
      "old details",
      coupleId,
    );
    const patch = await req<{
      couple: { guest_page_intro: string | null; post_rsvp_content: string | null };
    }>("PATCH", "/api/couples/current", { guest_page_intro: "", post_rsvp_content: "" }, { token });
    expect(patch.status).toBe(200);
    expect(patch.data.couple.guest_page_intro).toBeNull();
    expect(patch.data.couple.post_rsvp_content).toBeNull();
  });

  test("oversize guest_page_intro / post_rsvp_content → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("phase2-oversize@weddly.test");
    const longIntro = await req(
      "PATCH",
      "/api/couples/current",
      { guest_page_intro: "x".repeat(4001) },
      { token },
    );
    expect(longIntro.status).toBe(400);
    const longPost = await req(
      "PATCH",
      "/api/couples/current",
      { post_rsvp_content: "y".repeat(8001) },
      { token },
    );
    expect(longPost.status).toBe(400);
  });

  test("public tier: no code → public payload + intro present, gated fields null", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("phase2-public@weddly.test");
    db.prepare(
      "UPDATE couples SET is_public = 1, guest_page_intro = ?, post_rsvp_content = ?, " +
        "location_lat = ?, location_lng = ?, location_radius_km = 5 WHERE id = ?",
    ).run("Hello everyone", "Secret details", 47.5, 19.04, coupleId);
    // PATCH currency too so we exercise the same code path as the editor.
    const slug = await getSlug(coupleId);
    expect(token).toBeTruthy();

    const r = await req<PublicWeddingResponse>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.tier).toBe("public");
    expect(r.data.household).toBeNull();
    expect(r.data.wedding.guest_page_intro).toBe("Hello everyone");
    // Gated fields MUST be server-side null at the public tier.
    expect(r.data.wedding.post_rsvp_content).toBeNull();
    expect(r.data.wedding.location_lat).toBeNull();
    expect(r.data.wedding.location_lng).toBeNull();
    // The privacy buffer is always exposed so the frontend can render the
    // "approximate venue" indicator at public/invited tiers.
    expect(r.data.wedding.location_radius_km).toBe(5);
  });

  test("invited tier: valid code, no yes → household populated, gated fields still null", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("phase2-invited@weddly.test");
    db.prepare(
      "UPDATE couples SET is_public = 1, guest_page_intro = ?, post_rsvp_content = ?, " +
        "location_lat = ?, location_lng = ?, location_radius_km = 5 WHERE id = ?",
    ).run("Welcome", "Hidden until RSVP", 47.5, 19.04, coupleId);
    const slug = await getSlug(coupleId);
    const { household_code } = await createHouseholdWithGuest(token, "Kovács");

    const r = await req<PublicWeddingResponse>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}/${encodeURIComponent(household_code)}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.tier).toBe("invited");
    expect(r.data.household).not.toBeNull();
    expect(r.data.household!.household_label).toBe("Kovács");
    expect(r.data.household!.members.length).toBeGreaterThanOrEqual(1);
    // Confirmed-tier fields stay omitted until at least one yes.
    expect(r.data.wedding.post_rsvp_content).toBeNull();
    expect(r.data.wedding.location_lat).toBeNull();
    expect(r.data.wedding.location_lng).toBeNull();
    // Pre-RSVP intro is part of the shared base — visible at every tier.
    expect(r.data.wedding.guest_page_intro).toBe("Welcome");
  });

  test("confirmed tier: ≥1 yes → exact pin + post_rsvp_content unlock", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("phase2-confirmed@weddly.test");
    db.prepare(
      "UPDATE couples SET is_public = 1, post_rsvp_content = ?, " +
        "location_lat = ?, location_lng = ?, location_radius_km = 5 WHERE id = ?",
    ).run("Parking is at the gate.", 47.5, 19.04, coupleId);
    const slug = await getSlug(coupleId);
    const { household_code, guest_id } = await createHouseholdWithGuest(token, "Yes-fam");
    // Flip the guest's rsvp_status to yes via the public check-in endpoint.
    const checkin = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code,
      members: [{ guest_id, rsvp_status: "yes" }],
    });
    expect(checkin.status).toBe(200);

    const r = await req<PublicWeddingResponse>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}/${encodeURIComponent(household_code)}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.tier).toBe("confirmed");
    expect(r.data.wedding.location_lat).toBe(47.5);
    expect(r.data.wedding.location_lng).toBe(19.04);
    expect(r.data.wedding.post_rsvp_content).toBe("Parking is at the gate.");
    // The household block also unlocks at confirmed tier.
    expect(r.data.household).not.toBeNull();
    expect(r.data.household!.members.some((m) => m.rsvp_status === "yes")).toBe(true);
  });

  test("private couple (is_public=0): public tier 404s, but code-bearing tiers still serve", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("phase2-private@weddly.test");
    // is_public stays 0 by default. We populate just enough for the
    // tier-aware response to be meaningful.
    db.prepare("UPDATE couples SET location_lat = ?, location_lng = ? WHERE id = ?").run(
      47.5,
      19.04,
      coupleId,
    );
    const slug = await getSlug(coupleId);
    const { household_code, guest_id } = await createHouseholdWithGuest(token, "Direct");

    // 1. No code, private couple → 404 (same as before).
    const publicAttempt = await req("GET", `/api/public/wedding/${encodeURIComponent(slug)}`);
    expect(publicAttempt.status).toBe(404);

    // 2. Valid code, no yes, private couple → invited tier 200. The code
    // IS the credential — personal links work independent of the public
    // publish toggle.
    const invitedR = await req<PublicWeddingResponse>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}/${encodeURIComponent(household_code)}`,
    );
    expect(invitedR.status).toBe(200);
    expect(invitedR.data.tier).toBe("invited");
    expect(invitedR.data.wedding.location_lat).toBeNull();

    // 3. Flip the guest yes → confirmed tier 200, exact pin unlocks.
    const checkin = await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code,
      members: [{ guest_id, rsvp_status: "yes" }],
    });
    expect(checkin.status).toBe(200);
    const confirmedR = await req<PublicWeddingResponse>(
      "GET",
      `/api/public/wedding/${encodeURIComponent(slug)}/${encodeURIComponent(household_code)}`,
    );
    expect(confirmedR.status).toBe(200);
    expect(confirmedR.data.tier).toBe("confirmed");
    expect(confirmedR.data.wedding.location_lat).toBe(47.5);
  });

  test("unknown code → 404 (same response shape, doesn't leak slug existence)", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("phase2-unknown-code@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const slug = await getSlug(coupleId);
    const r = await req("GET", `/api/public/wedding/${encodeURIComponent(slug)}/9999`);
    expect(r.status).toBe(404);
  });

  test("rate-limit guards the code-lookup path against enumeration", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("phase2-ratelimit@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const slug = await getSlug(coupleId);
    const attackerIp = "10.99.99.99";

    // The code bucket is 30 capacity → after ~30 unique-code attempts the
    // limiter should start serving 429. Drive 60 attempts from the same
    // IP and assert that at least one 429 comes back.
    let saw429 = false;
    for (let i = 0; i < 60; i++) {
      const codeAttempt = String(1000 + i).padStart(4, "0");
      const r = await req(
        "GET",
        `/api/public/wedding/${encodeURIComponent(slug)}/${codeAttempt}`,
        undefined,
        { clientIp: attackerIp },
      );
      if (r.status === 429) {
        saw429 = true;
        break;
      }
    }
    expect(saw429).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Legacy /api/guest/portal shim — kept for one release while old SPA
// bundles in user caches finish rolling over. New requests should hit
// /api/public/wedding/:slug/:code instead.
// ─────────────────────────────────────────────────────────────────────────

describe("GET /api/guest/portal — legacy redirect-shim", () => {
  test("forwards through the unified resolver, still 200s on confirmed", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("legacy-shim-yes@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const slug = await getSlug(coupleId);
    const { household_code, guest_id } = await createHouseholdWithGuest(token, "Shim");
    await req("POST", "/api/rsvp/checkin", {
      couple_slug: slug,
      household_code,
      members: [{ guest_id, rsvp_status: "yes" }],
    });

    const r = await req<{ portal: { schedule: unknown[]; members: unknown[] } }>(
      "GET",
      `/api/guest/portal?couple=${encodeURIComponent(slug)}&code=${encodeURIComponent(household_code)}`,
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.data.portal.schedule)).toBe(true);
    expect(r.data.portal.members.length).toBeGreaterThanOrEqual(1);
  });

  test("legacy shim still 403s with not_rsvpd when nobody on the household RSVP'd yes", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("legacy-shim-noyes@weddly.test");
    db.prepare("UPDATE couples SET is_public = 1 WHERE id = ?").run(coupleId);
    const slug = await getSlug(coupleId);
    const { household_code } = await createHouseholdWithGuest(token, "NoYes");

    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      `/api/guest/portal?couple=${encodeURIComponent(slug)}&code=${encodeURIComponent(household_code)}`,
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_rsvpd");
  });
});

// Force-mention the imported view type so the explicit cast above is not
// flagged as unused on a fresh checkout where the file may compile before
// the new helpers are referenced.
const _typeWitness: PublicWeddingWebsiteView | null = null;
void _typeWitness;
