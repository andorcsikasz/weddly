// Wishlist thumbnails are re-hosted, never hotlinked. Our CSP img-src is an
// allow-list of a few fixed origins, so a shop's own CDN URL in
// `wishlist_items.image_url` renders as the broken-image glyph on every card —
// which is what "the picture upload is broken" looked like. Every write path
// now goes through localizeWishlistImage, and the boot rehost drains the rows
// written before it. The download itself is stubbed here: the real one hits the
// network behind the SSRF guard, which no test should depend on.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import type { WishlistItem } from "@shared/wishlist";
import { listWishlistRowsWithRemoteImage } from "../../src/domain/wishlist";
import {
  localizeWishlistImage,
  resolveWishlistPicture,
  wishlistImageKey,
} from "../../src/domain/wishlist_image";
import { runWishlistImageRehost } from "../../src/domain/wishlist_image_backfill";
import type { FetchedImage } from "../../src/lib/remote_image";
import { keyFromUploadUrl, storage } from "../../src/lib/storage";

/** A downloader that always succeeds, and counts its calls so a test can prove
 *  a path did NOT re-download. */
function stubFetcher(ext: FetchedImage["ext"] = "jpg") {
  const calls: string[] = [];
  return {
    calls,
    fetchImage: async (url: string): Promise<FetchedImage | null> => {
      calls.push(url);
      return { bytes: new Uint8Array([1, 2, 3, 4]), ext, width: 1200, height: 630 };
    },
  };
}

const missFetcher = async (): Promise<FetchedImage | null> => null;

function rowOf(id: number): { image_url: string | null; image_checked_at: number | null } {
  return db
    .prepare("SELECT image_url, image_checked_at FROM wishlist_items WHERE id = ?")
    .get(id) as {
    image_url: string | null;
    image_checked_at: number | null;
  };
}

describe("wishlist image mirroring", () => {
  test("a remote image is downloaded and re-hosted under the couple's own prefix", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-mirror-store@weddly.test");
    const stub = stubFetcher();

    const source = "https://www.ikea.com/hu/hu/images/products/jostein.jpg";
    const local = await localizeWishlistImage(coupleId, source, { fetchImage: stub.fetchImage });

    expect(stub.calls).toEqual([source]);
    const key = wishlistImageKey(coupleId, source, "jpg");
    // Couple-scoped, so `storage.deletePrefix('couples/<id>/')` on purge takes
    // the thumbnails with it.
    expect(key.startsWith(`couples/${coupleId}/wishlist/`)).toBe(true);
    expect(local).toBe(`/uploads/${key}?v=${local?.split("?v=")[1]}`);
    expect(keyFromUploadUrl(local ?? "")).toBe(key);
    expect(await storage.exists(key)).toBe(true);
  });

  test("the key is stable per source URL, so re-saving overwrites rather than piling up", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-mirror-key@weddly.test");
    const source = "https://shop.example/p/1.png";

    const a = wishlistImageKey(coupleId, source, "png");
    const b = wishlistImageKey(coupleId, source, "png");
    expect(a).toBe(b);
    expect(wishlistImageKey(coupleId, "https://shop.example/p/2.png", "png")).not.toBe(a);
    // Different couples never share an object (one purge must not blank the
    // other couple's card).
    expect(wishlistImageKey(coupleId + 1, source, "png")).not.toBe(a);
  });

  test("a value that is already ours passes through without a download", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-mirror-passthru@weddly.test");
    const stub = stubFetcher();

    const already = `/uploads/couples/${coupleId}/wishlist/abc123.jpg?v=42`;
    expect(await localizeWishlistImage(coupleId, already, { fetchImage: stub.fetchImage })).toBe(
      already,
    );
    expect(stub.calls).toEqual([]);
  });

  test("a failed download resolves to null, never to the remote URL", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-mirror-miss@weddly.test");

    expect(
      await localizeWishlistImage(coupleId, "https://shop.example/x.jpg", {
        fetchImage: missFetcher,
      }),
    ).toBeNull();
    expect(await localizeWishlistImage(coupleId, null)).toBeNull();
    expect(await localizeWishlistImage(coupleId, "   ")).toBeNull();
    // Traversal dressed as one of ours.
    expect(await localizeWishlistImage(coupleId, "/uploads/../../etc/passwd")).toBeNull();
  });
});

describe("wishlist write paths never store a remote image", () => {
  test("a client-supplied remote image_url we cannot download is stored as null", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-mirror-create@weddly.test");

    // Blocked host -> the mirror comes back empty. The remote URL must NOT be
    // the fallback: it would render as a broken tile on every card.
    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Ruhaszárító", image_url: "http://127.0.0.1/product.jpg" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.item.image_url).toBeNull();
    expect(rowOf(created.data.item.id).image_url).toBeNull();
  });

  test("an /uploads path is accepted verbatim; a traversal path is a 400", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("wishlist-mirror-local@weddly.test");

    const local = `/uploads/couples/${coupleId}/wishlist/deadbeef.jpg?v=7`;
    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Kávégép", image_url: local },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.item.image_url).toBe(local);

    const bad = await req(
      "POST",
      "/api/wishlist",
      { title: "Rossz", image_url: "/uploads/../../secret.jpg" },
      { token },
    );
    expect(bad.status).toBe(400);
  });

  test("a PATCH that leaves the link alone keeps the mirrored image (no refetch, no loss)", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("wishlist-mirror-patch@weddly.test");

    const local = `/uploads/couples/${coupleId}/wishlist/cafe1234.jpg?v=9`;
    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Tányérkészlet", url: "https://shop.example/plates", image_url: local },
      { token },
    );
    expect(created.status).toBe(201);

    const patched = await req<{ item: WishlistItem }>(
      "PATCH",
      `/api/wishlist/${created.data.item.id}`,
      { title: "Tányérkészlet (12)" },
      { token, headers: { "If-Match": String(created.data.item.updated_at) } },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.item.image_url).toBe(local);
  });
});

describe("wishlist remote-image rehost sweep", () => {
  /** A row as written before mirroring shipped: a thumbnail on the shop's own
   *  CDN, which the browser refuses to load. */
  function insertRemoteImageRow(coupleId: number, imageUrl: string): number {
    const r = db
      .prepare(
        `INSERT INTO wishlist_items
           (couple_id, title, kind, url, image_url, image_checked_at, sort_order, created_at, updated_at)
         VALUES (?, 'legacy', 'gift', 'https://shop.example/p', ?, 123, 0, 0, 0)`,
      )
      .run(coupleId, imageUrl);
    return Number(r.lastInsertRowid);
  }

  test("remote rows are listed, cleared when undownloadable, and never re-swept", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-rehost@weddly.test");

    const remote = insertRemoteImageRow(coupleId, "http://127.0.0.1/blocked.jpg");
    const alreadyLocal = insertRemoteImageRow(
      coupleId,
      `/uploads/couples/${coupleId}/wishlist/aa.jpg`,
    );

    const pending = listWishlistRowsWithRemoteImage(100).map((r) => r.id);
    expect(pending).toContain(remote);
    expect(pending).not.toContain(alreadyLocal);

    await runWishlistImageRehost();

    // Blocked host: the column is cleared so the card draws its motif instead
    // of a broken tile, and the row drops out of the set for good.
    expect(rowOf(remote).image_url).toBeNull();
    expect(rowOf(remote).image_checked_at).not.toBeNull();
    expect(listWishlistRowsWithRemoteImage(100).map((r) => r.id)).not.toContain(remote);
    // A local row was never touched.
    expect(rowOf(alreadyLocal).image_url).toBe(`/uploads/couples/${coupleId}/wishlist/aa.jpg`);
  });
});

// A wish shows a real picture or a mark somebody chose — never a drawing we
// guessed from the title. The ladder is photo → the shop's own logo → the
// couple's icon, and the middle rung is the one that matters most: the majority
// of pasted product links publish no og:image at all.
describe("wishlist picture ladder", () => {
  test("a page with no og:image falls back to the shop's logo, marked as one", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-logo@weddly.test");
    const stub = stubFetcher("png");

    const picture = await resolveWishlistPicture(
      coupleId,
      {
        image_url: null,
        image_kind: null,
        title: "JOSTEIN",
        logo_urls: ["https://www.ikea.com/touch-180.png"],
      },
      { fetchImage: stub.fetchImage },
    );

    expect(stub.calls).toEqual(["https://www.ikea.com/touch-180.png"]);
    // Mirrored under our own key like every other thumbnail — a remote logo is
    // blocked by the CSP exactly like a remote photo.
    expect(picture.image_url?.startsWith(`/uploads/couples/${coupleId}/wishlist/`)).toBe(true);
    // The kind is what stops the card cropping a brand mark to fill: an IKEA
    // logo under object-cover is a blue wall with half a letter in it.
    expect(picture.image_kind).toBe("logo");
  });

  test("a declared og:image that will not download demotes to the logo", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-logo-demote@weddly.test");
    const calls: string[] = [];
    const fetchImage = async (url: string): Promise<FetchedImage | null> => {
      calls.push(url);
      if (url.includes("og")) return null; // the shop 403s its own og:image
      return { bytes: new Uint8Array([9]), ext: "png", width: 180, height: 180 };
    };

    const picture = await resolveWishlistPicture(
      coupleId,
      {
        image_url: "https://cdn.shop.test/og.jpg",
        image_kind: "photo",
        title: null,
        logo_urls: ["https://shop.test/apple-touch-icon.png"],
      },
      { fetchImage },
    );

    expect(calls).toEqual([
      "https://cdn.shop.test/og.jpg",
      "https://shop.test/apple-touch-icon.png",
    ]);
    expect(picture.image_kind).toBe("logo");
  });

  test("nothing downloadable anywhere leaves no picture, and no phantom kind", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("wishlist-no-picture@weddly.test");
    const picture = await resolveWishlistPicture(
      coupleId,
      {
        image_url: "https://cdn.test/p.jpg",
        image_kind: "photo",
        title: null,
        logo_urls: ["https://x.test/i.png"],
      },
      { fetchImage: missFetcher },
    );
    // Null on both, so the card draws the couple's icon rather than a broken
    // tile or a photo frame with nothing in it.
    expect(picture).toEqual({ image_url: null, image_kind: null });
  });

  test("the couple's chosen icon round-trips, and a slug we can't draw is refused", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wishlist-icon@weddly.test");

    const created = await req<{ item: WishlistItem }>(
      "POST",
      "/api/wishlist",
      { title: "Hosszú hétvége", kind: "gift", icon: "Plane" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.item.icon).toBe("Plane");

    // Null clears it back to the per-kind default rather than storing a blank.
    const cleared = await req<{ item: WishlistItem }>(
      "PATCH",
      `/api/wishlist/${created.data.item.id}`,
      { icon: null },
      { token, headers: { "If-Match": String(created.data.item.updated_at) } },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.item.icon).toBeNull();

    // A slug the frontend has no component for would render as nothing at all,
    // so it never reaches the DB.
    const bad = await req("POST", "/api/wishlist", { title: "x", icon: "Rocket" }, { token });
    expect(bad.status).toBe(400);
  });
});
