// Wishlist link unfurl — the og:image/title parser (pure) + the
// /api/wishlist/link-preview endpoint's auth and SSRF-soft-fail behaviour.
// The endpoint NEVER errors on a dead/blocked URL: it returns
// { image_url: null, title: null } so a bad link can't block saving an item,
// and it refuses non-public hosts (localhost / private / link-local / cloud
// metadata) so it can't be used as an SSRF probe.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import type { WishlistLinkPreview } from "@shared/wishlist";
import { extractLinkPreview } from "../../src/lib/link_preview";

describe("extractLinkPreview — og:image / title parser", () => {
  test("pulls og:image + og:title (attribute order independent)", () => {
    const html = `<html><head>
      <meta content="https://cdn.example/p.jpg" property="og:image">
      <meta property="og:title" content="Lovely Espresso Machine">
      <title>Shop</title></head><body>…`;
    const r = extractLinkPreview(html, "https://shop.test/item/1");
    expect(r.image_url).toBe("https://cdn.example/p.jpg");
    expect(r.title).toBe("Lovely Espresso Machine");
  });

  test("falls back to twitter:image and <title>", () => {
    const html = `<head><meta name="twitter:image" content="https://cdn.test/t.png"><title>Fallback Name</title></head>`;
    const r = extractLinkPreview(html, "https://shop.test/");
    expect(r.image_url).toBe("https://cdn.test/t.png");
    expect(r.title).toBe("Fallback Name");
  });

  test("resolves a relative og:image against the page URL", () => {
    const html = `<head><meta property="og:image" content="/img/p.jpg"></head>`;
    const r = extractLinkPreview(html, "https://shop.test/item/1");
    expect(r.image_url).toBe("https://shop.test/img/p.jpg");
  });

  test("rejects a non-http(s) image (e.g. data:) and decodes entities", () => {
    const html = `<head><meta property="og:image" content="data:image/png;base64,AAAA"><meta property="og:title" content="Tom &amp; Jerry"></head>`;
    const r = extractLinkPreview(html, "https://shop.test/");
    expect(r.image_url).toBeNull();
    expect(r.title).toBe("Tom & Jerry");
  });

  test("returns nulls when there's no usable metadata", () => {
    const r = extractLinkPreview("<head></head><body>nothing</body>", "https://shop.test/");
    expect(r.image_url).toBeNull();
    expect(r.title).toBeNull();
  });
});

describe("GET /api/wishlist/link-preview", () => {
  test("requires auth", async () => {
    const r = await req("GET", "/api/wishlist/link-preview?url=https://shop.test/");
    expect(r.status).toBe(401);
  });

  test("soft-returns nulls for an invalid or empty URL", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-preview-bad@weddly.test");

    const empty = await req<WishlistLinkPreview>("GET", "/api/wishlist/link-preview", undefined, {
      token,
    });
    expect(empty.status).toBe(200);
    expect(empty.data.image_url).toBeNull();

    const bad = await req<WishlistLinkPreview>(
      "GET",
      "/api/wishlist/link-preview?url=not-a-url",
      undefined,
      { token },
    );
    expect(bad.status).toBe(200);
    expect(bad.data.image_url).toBeNull();
    expect(bad.data.title).toBeNull();
  });

  test("refuses SSRF targets (localhost / private / link-local) with soft nulls", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-preview-ssrf@weddly.test");

    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "file:///etc/passwd",
    ]) {
      const r = await req<WishlistLinkPreview>(
        "GET",
        `/api/wishlist/link-preview?url=${encodeURIComponent(url)}`,
        undefined,
        { token },
      );
      expect(r.status).toBe(200);
      expect(r.data.image_url).toBeNull();
    }
  });
});
