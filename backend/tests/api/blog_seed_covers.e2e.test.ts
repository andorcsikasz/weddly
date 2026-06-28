// Seed covers for the public blog. The boot seeder applies SEED_COVER_BY_SLUG
// on insert and backfills it onto any existing row whose cover_image_url is
// still NULL (legacy rows seeded before covers existed), without ever clobbering
// an admin-uploaded cover. The bytes live at frontend/public/blog-covers/<slug>.jpg.

import "../setup";

import { describe, expect, test } from "bun:test";
import { SEED_COVER_BY_SLUG } from "../../../shared/blog_posts";
import { db } from "../../src/db";
import { seedBlogPostsIfEmpty } from "../../src/domain/blog";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

function coverOf(slug: string): string | null {
  const row = db.prepare("SELECT cover_image_url AS c FROM blog_posts WHERE slug = ?").get(slug) as
    | { c: string | null }
    | undefined;
  return row?.c ?? null;
}

describe("blog: seed covers reach the public API", () => {
  test("every slug in SEED_COVER_BY_SLUG serves its cover via /api/blog/posts", async () => {
    // Hermetic against the shared test DB: another suite may have NULLed a
    // cover and not restored it. The seeder backfills NULL covers without
    // clobbering admin-set (non-null) ones, so this realigns the seed state.
    seedBlogPostsIfEmpty();
    const res = await fetch(`${BASE}/api/blog/posts`);
    expect(res.status).toBe(200);
    const { posts } = (await res.json()) as {
      posts: { slug: string; cover_image_url: string | null }[];
    };
    const bySlug = new Map(posts.map((p) => [p.slug, p.cover_image_url]));
    for (const [slug, url] of Object.entries(SEED_COVER_BY_SLUG)) {
      expect(bySlug.get(slug)).toBe(url);
    }
  });

  test("every cover URL points at a committed /blog-covers asset", () => {
    for (const url of Object.values(SEED_COVER_BY_SLUG)) {
      expect(url.startsWith("/blog-covers/")).toBe(true);
      expect(url.endsWith(".jpg")).toBe(true);
    }
  });
});

describe("blog: seeder cover backfill", () => {
  const slug = "eskuvoi-vendeglista-keszitese";
  const seedUrl = SEED_COVER_BY_SLUG[slug];
  if (!seedUrl) throw new Error(`test fixture drift: no seed cover for ${slug}`);

  test("re-seeding backfills a NULLed cover", () => {
    db.prepare("UPDATE blog_posts SET cover_image_url = NULL WHERE slug = ?").run(slug);
    expect(coverOf(slug)).toBeNull();

    seedBlogPostsIfEmpty();
    expect(coverOf(slug)).toBe(seedUrl);
  });

  test("re-seeding never clobbers an admin-set (non-null) cover", () => {
    const custom = "/uploads/blog/99.jpg?v=42";
    db.prepare("UPDATE blog_posts SET cover_image_url = ? WHERE slug = ?").run(custom, slug);

    seedBlogPostsIfEmpty();
    expect(coverOf(slug)).toBe(custom);

    // Restore the seed cover so this file leaves the shared test DB as it found it.
    db.prepare("UPDATE blog_posts SET cover_image_url = ? WHERE slug = ?").run(seedUrl, slug);
  });
});
