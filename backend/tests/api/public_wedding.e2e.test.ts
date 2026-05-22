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
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";

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
    // names / dates / venue showing up in title or description.
    expect(html).toContain('content="https://weddly.hu/og.png"');
    expect(html).toContain("Wēddly · Közös esküvőtervezés egy helyen");
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
