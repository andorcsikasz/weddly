// Blog-post domain: DB row shape, BlogPost mapper, and the first-boot seeder.
//
// Posts live in the `blog_posts` table; the static `SEED_BLOG_POSTS` array in
// shared/blog_posts.ts is consumed exactly once (when the table is empty) so a
// fresh deploy lands with the three placeholder posts already populated. The
// admin can then edit, publish or delete them.

import type { BlogBlock, BlogPost } from "../../../shared/blog_posts";
import { SEED_BLOG_POSTS } from "../../../shared/blog_posts";
import { db, now } from "../db";
import { log } from "../lib/logger";

export interface BlogPostRow {
  id: number;
  slug: string;
  published_at: string;
  read_minutes: number;
  cover_image_url: string | null;
  is_published: number;
  hu_category: string;
  hu_title: string;
  hu_lead: string;
  hu_seo_title: string;
  hu_seo_description: string;
  hu_body_json: string;
  en_category: string;
  en_title: string;
  en_lead: string;
  en_seo_title: string;
  en_seo_description: string;
  en_body_json: string;
  created_at: number;
  updated_at: number;
}

/** Parse a JSON-stringified BlogBlock[]; returns `[]` on any malformed input
 *  rather than throwing, since a corrupt row shouldn't take down the page. */
function parseBody(json: string): BlogBlock[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed as BlogBlock[];
  } catch {
    return [];
  }
}

export function toBlogPost(row: BlogPostRow): BlogPost {
  return {
    id: row.id,
    slug: row.slug,
    published_at: row.published_at,
    read_minutes: row.read_minutes,
    cover_image_url: row.cover_image_url,
    is_published: row.is_published === 1,
    category: { hu: row.hu_category, en: row.en_category },
    hu: {
      title: row.hu_title,
      lead: row.hu_lead,
      seo_title: row.hu_seo_title,
      seo_description: row.hu_seo_description,
      body: parseBody(row.hu_body_json),
    },
    en: {
      title: row.en_title,
      lead: row.en_lead,
      seo_title: row.en_seo_title,
      seo_description: row.en_seo_description,
      body: parseBody(row.en_body_json),
    },
  };
}

export function getBlogPostBySlug(slug: string): BlogPostRow | null {
  const row = db.prepare("SELECT * FROM blog_posts WHERE slug = ?").get(slug) as
    | BlogPostRow
    | undefined;
  return row ?? null;
}

export function getBlogPostById(id: number): BlogPostRow | null {
  const row = db.prepare("SELECT * FROM blog_posts WHERE id = ?").get(id) as
    | BlogPostRow
    | undefined;
  return row ?? null;
}

/** Published posts sorted newest-first. Public list + sitemap call this. */
export function listPublishedPosts(): BlogPostRow[] {
  return db
    .prepare(
      "SELECT * FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC, id DESC",
    )
    .all() as BlogPostRow[];
}

/** Every row including drafts; admin index calls this. */
export function listAllPostsForAdmin(): BlogPostRow[] {
  return db
    .prepare("SELECT * FROM blog_posts ORDER BY published_at DESC, id DESC")
    .all() as BlogPostRow[];
}

/** Idempotent first-boot seeder. Inserts every SEED_BLOG_POSTS row that
 *  doesn't already exist by slug. Runs once per boot from server.ts; safe
 *  to call multiple times because the UNIQUE(slug) index dedupes. */
export function seedBlogPostsIfEmpty(): void {
  const count = db.prepare("SELECT COUNT(*) AS n FROM blog_posts").get() as { n: number };
  if (count.n > 0) return;

  const ts = now();
  const insert = db.prepare(`
    INSERT INTO blog_posts (
      slug, published_at, read_minutes, cover_image_url, is_published,
      hu_category, hu_title, hu_lead, hu_seo_title, hu_seo_description, hu_body_json,
      en_category, en_title, en_lead, en_seo_title, en_seo_description, en_body_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, NULL, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const post of SEED_BLOG_POSTS) {
    insert.run(
      post.slug,
      post.published_at,
      post.read_minutes,
      post.category.hu,
      post.hu.title,
      post.hu.lead,
      post.hu.seo_title,
      post.hu.seo_description,
      JSON.stringify(post.hu.body),
      post.category.en,
      post.en.title,
      post.en.lead,
      post.en.seo_title,
      post.en.seo_description,
      JSON.stringify(post.en.body),
      ts,
      ts,
    );
    inserted += 1;
  }
  log.info("blog.seeded", { inserted });
}

export interface BlogPostWritePayload {
  slug: string;
  published_at: string;
  read_minutes: number;
  cover_image_url: string | null;
  is_published: boolean;
  hu: {
    category: string;
    title: string;
    lead: string;
    seo_title: string;
    seo_description: string;
    body: BlogBlock[];
  };
  en: {
    category: string;
    title: string;
    lead: string;
    seo_title: string;
    seo_description: string;
    body: BlogBlock[];
  };
}

export function insertBlogPost(payload: BlogPostWritePayload): number {
  const ts = now();
  const stmt = db.prepare(`
    INSERT INTO blog_posts (
      slug, published_at, read_minutes, cover_image_url, is_published,
      hu_category, hu_title, hu_lead, hu_seo_title, hu_seo_description, hu_body_json,
      en_category, en_title, en_lead, en_seo_title, en_seo_description, en_body_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    payload.slug,
    payload.published_at,
    payload.read_minutes,
    payload.cover_image_url,
    payload.is_published ? 1 : 0,
    payload.hu.category,
    payload.hu.title,
    payload.hu.lead,
    payload.hu.seo_title,
    payload.hu.seo_description,
    JSON.stringify(payload.hu.body),
    payload.en.category,
    payload.en.title,
    payload.en.lead,
    payload.en.seo_title,
    payload.en.seo_description,
    JSON.stringify(payload.en.body),
    ts,
    ts,
  );
  return Number(info.lastInsertRowid);
}

export function updateBlogPost(id: number, payload: BlogPostWritePayload): void {
  const ts = now();
  db.prepare(`
    UPDATE blog_posts SET
      slug = ?, published_at = ?, read_minutes = ?, cover_image_url = ?, is_published = ?,
      hu_category = ?, hu_title = ?, hu_lead = ?, hu_seo_title = ?, hu_seo_description = ?, hu_body_json = ?,
      en_category = ?, en_title = ?, en_lead = ?, en_seo_title = ?, en_seo_description = ?, en_body_json = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    payload.slug,
    payload.published_at,
    payload.read_minutes,
    payload.cover_image_url,
    payload.is_published ? 1 : 0,
    payload.hu.category,
    payload.hu.title,
    payload.hu.lead,
    payload.hu.seo_title,
    payload.hu.seo_description,
    JSON.stringify(payload.hu.body),
    payload.en.category,
    payload.en.title,
    payload.en.lead,
    payload.en.seo_title,
    payload.en.seo_description,
    JSON.stringify(payload.en.body),
    ts,
    id,
  );
}

export function deleteBlogPost(id: number): void {
  db.prepare("DELETE FROM blog_posts WHERE id = ?").run(id);
}

export function setBlogPostCoverImage(id: number, url: string | null): void {
  const ts = now();
  db.prepare("UPDATE blog_posts SET cover_image_url = ?, updated_at = ? WHERE id = ?").run(
    url,
    ts,
    id,
  );
}
