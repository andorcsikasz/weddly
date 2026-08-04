// Blog-post domain: DB row shape, BlogPost mapper, and the first-boot seeder.
//
// Posts live in the `blog_posts` table; the static `SEED_BLOG_POSTS` array in
// shared/blog_posts.ts is consumed exactly once (when the table is empty) so a
// fresh deploy lands with the three placeholder posts already populated. The
// admin can then edit, publish or delete them.

import type { BlogBlock, BlogLocale, BlogPost, BlogPostLocale } from "../../../shared/blog_posts";
import {
  BLOG_LOCALES,
  SEED_BLOG_POSTS,
  SEED_COVER_BY_SLUG,
  SEED_EN_SLUG_BY_SLUG,
  SEED_TRANSLATIONS,
} from "../../../shared/blog_posts";
import { db, now } from "../db";
import { log } from "../lib/logger";

/** The six columns every locale carries, as a type. Written as a mapped
 *  template type rather than 30 hand-listed fields so adding a UI locale is
 *  one entry in `UI_LOCALES` and nothing here — and so the mapper below can
 *  address a column as `row[`${locale}_title`]` and still be type-checked. */
type LocaleColumns<L extends string> = {
  [K in
    | `${L}_category`
    | `${L}_title`
    | `${L}_lead`
    | `${L}_seo_title`
    | `${L}_seo_description`
    | `${L}_body_json`]: string;
};

export type BlogPostRow = {
  id: number;
  slug: string;
  en_slug: string | null;
  published_at: string;
  read_minutes: number;
  cover_image_url: string | null;
  is_published: number;
  created_at: number;
  updated_at: number;
} & LocaleColumns<BlogLocale>;

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

function localeCopy(row: BlogPostRow, locale: BlogLocale): BlogPostLocale {
  return {
    title: row[`${locale}_title`],
    lead: row[`${locale}_lead`],
    seo_title: row[`${locale}_seo_title`],
    seo_description: row[`${locale}_seo_description`],
    body: parseBody(row[`${locale}_body_json`]),
  };
}

/** True when the row has anything at all stored for `locale`. Deliberately
 *  looser than `hasBlogLocale`, which decides whether a READER gets served
 *  that language: this one decides whether the block is on the DTO, and an
 *  admin who typed a Spanish title and saved has to find it again when they
 *  come back. Rendering stays the resolver's call. */
function localeHasAnything(row: BlogPostRow, locale: BlogLocale): boolean {
  const body = row[`${locale}_body_json`];
  return Boolean(
    row[`${locale}_title`] ||
      row[`${locale}_lead`] ||
      row[`${locale}_seo_title`] ||
      row[`${locale}_seo_description`] ||
      row[`${locale}_category`] ||
      (body && body !== "[]"),
  );
}

export function toBlogPost(row: BlogPostRow): BlogPost {
  const post: BlogPost = {
    id: row.id,
    slug: row.slug,
    en_slug: row.en_slug ?? undefined,
    published_at: row.published_at,
    read_minutes: row.read_minutes,
    cover_image_url: row.cover_image_url,
    is_published: row.is_published === 1,
    category: { hu: row.hu_category, en: row.en_category },
    hu: localeCopy(row, "hu"),
    en: localeCopy(row, "en"),
  };
  for (const locale of BLOG_LOCALES) {
    if (locale === "hu" || locale === "en") continue;
    if (!localeHasAnything(row, locale)) continue;
    post[locale] = localeCopy(row, locale);
    post.category[locale] = row[`${locale}_category`];
  }
  return post;
}

export function getBlogPostBySlug(slug: string): BlogPostRow | null {
  const row = db
    .prepare("SELECT * FROM blog_posts WHERE slug = ? OR (en_slug IS NOT NULL AND en_slug = ?)")
    .get(slug, slug) as BlogPostRow | undefined;
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
    .prepare("SELECT * FROM blog_posts WHERE is_published = 1 ORDER BY published_at DESC, id DESC")
    .all() as BlogPostRow[];
}

/** Every row including drafts; admin index calls this. */
export function listAllPostsForAdmin(): BlogPostRow[] {
  return db
    .prepare("SELECT * FROM blog_posts ORDER BY published_at DESC, id DESC")
    .all() as BlogPostRow[];
}

/** Idempotent slug-level seeder. Runs on every boot from server.ts. For
 *  each entry in SEED_BLOG_POSTS, inserts the row if its slug isn't in the
 *  table yet; existing rows (admin-edited or otherwise) are left untouched.
 *
 *  The earlier "skip when table has any rows" version only ran on a fully
 *  empty DB, which meant new seed posts added in later deploys never
 *  reached production. The slug-level check makes the seeder additive
 *  across releases without ever overwriting admin edits. */
export function seedBlogPostsIfEmpty(): void {
  const existing = db.prepare("SELECT slug FROM blog_posts").all() as { slug: string }[];
  const have = new Set(existing.map((r) => r.slug));

  const ts = now();
  const insert = db.prepare(`
    INSERT INTO blog_posts (
      slug, en_slug, published_at, read_minutes, cover_image_url, is_published,
      hu_category, hu_title, hu_lead, hu_seo_title, hu_seo_description, hu_body_json,
      en_category, en_title, en_lead, en_seo_title, en_seo_description, en_body_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const post of SEED_BLOG_POSTS) {
    if (have.has(post.slug)) continue;
    insert.run(
      post.slug,
      SEED_EN_SLUG_BY_SLUG[post.slug] ?? null,
      post.published_at,
      post.read_minutes,
      SEED_COVER_BY_SLUG[post.slug] ?? post.cover_image_url ?? null,
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
  if (inserted > 0) log.info("blog.seeded", { inserted });

  backfillBlogTranslations(ts);

  // Backfill covers onto rows that predate SEED_COVER_BY_SLUG. Posts seeded by
  // earlier releases landed with cover_image_url = NULL (the old INSERT
  // hardcoded NULL), so editing the seed alone would never reach them. We only
  // touch rows that are still NULL, so an admin-uploaded cover (non-null) is
  // never clobbered. Runs every boot but is a no-op once every slug has a cover.
  const backfill = db.prepare(
    "UPDATE blog_posts SET cover_image_url = ?, updated_at = ? WHERE slug = ? AND cover_image_url IS NULL",
  );
  let covered = 0;
  for (const [slug, url] of Object.entries(SEED_COVER_BY_SLUG)) {
    const info = backfill.run(url, ts, slug);
    covered += info.changes;
  }
  if (covered > 0) log.info("blog.covers_backfilled", { covered });

  // Backfill en_slug onto rows that predate this column. Only touches rows
  // where en_slug IS NULL so an admin-set en_slug is never overwritten.
  const enSlugBackfill = db.prepare(
    "UPDATE blog_posts SET en_slug = ?, updated_at = ? WHERE slug = ? AND en_slug IS NULL",
  );
  let enSlugged = 0;
  for (const [huSlug, enSlug] of Object.entries(SEED_EN_SLUG_BY_SLUG)) {
    const info = enSlugBackfill.run(enSlug, ts, huSlug);
    enSlugged += info.changes;
  }
  if (enSlugged > 0) log.info("blog.en_slugs_backfilled", { enSlugged });
}

/** Write the ES / HR / DE seed copy onto rows that don't have it yet.
 *
 *  It has to be a backfill rather than part of the INSERT above, because
 *  every seeded post already EXISTS by the time the translations land: the
 *  slug-level seeder skips a slug it has, so a translation added in a later
 *  release would otherwise never reach a single production row.
 *
 *  The guard is "this locale is still empty on this row" — same shape as the
 *  cover and en_slug backfills beside it, and same reason. An admin who
 *  edited the Spanish copy in the editor keeps their version; a locale
 *  nobody has touched gets the seed. Runs every boot and is a no-op once
 *  every slug carries every language. */
function backfillBlogTranslations(ts: number): void {
  const filled: Record<string, number> = {};
  for (const [locale, table] of Object.entries(SEED_TRANSLATIONS)) {
    const stmt = db.prepare(`
      UPDATE blog_posts SET
        ${locale}_category = ?, ${locale}_title = ?, ${locale}_lead = ?,
        ${locale}_seo_title = ?, ${locale}_seo_description = ?, ${locale}_body_json = ?,
        updated_at = ?
      WHERE slug = ?
        AND ${locale}_title = ''
        AND (${locale}_body_json = '[]' OR ${locale}_body_json = '')
    `);
    let count = 0;
    for (const [slug, tr] of Object.entries(table)) {
      const info = stmt.run(
        tr.category,
        tr.title,
        tr.lead,
        tr.seo_title,
        tr.seo_description,
        JSON.stringify(tr.body),
        ts,
        slug,
      );
      count += info.changes;
    }
    if (count > 0) filled[locale] = count;
  }
  if (Object.keys(filled).length > 0) log.info("blog.translations_backfilled", filled);
}

export interface BlogPostWriteLocale {
  category: string;
  title: string;
  lead: string;
  seo_title: string;
  seo_description: string;
  body: BlogBlock[];
}

export interface BlogPostWritePayload {
  slug: string;
  en_slug: string | null;
  published_at: string;
  read_minutes: number;
  cover_image_url: string | null;
  is_published: boolean;
  /** HU and EN are required — a post is AUTHORED in them. The translated
   *  locales are optional, and an absent one means "leave what is stored
   *  alone", never "clear it": an older admin bundle that knows nothing
   *  about German must not wipe the German copy just by saving a typo fix
   *  in the Hungarian. Clearing a translation is done by sending it empty. */
  locales: { hu: BlogPostWriteLocale; en: BlogPostWriteLocale } & Partial<
    Record<BlogLocale, BlogPostWriteLocale>
  >;
}

const EMPTY_LOCALE: BlogPostWriteLocale = {
  category: "",
  title: "",
  lead: "",
  seo_title: "",
  seo_description: "",
  body: [],
};

function localeValues(copy: BlogPostWriteLocale): (string | number)[] {
  return [
    copy.category,
    copy.title,
    copy.lead,
    copy.seo_title,
    copy.seo_description,
    JSON.stringify(copy.body),
  ];
}

const LOCALE_COLUMNS = ["category", "title", "lead", "seo_title", "seo_description", "body_json"];

export function insertBlogPost(payload: BlogPostWritePayload): number {
  const ts = now();
  const cols: string[] = [];
  const values: (string | number | null)[] = [];
  for (const locale of BLOG_LOCALES) {
    for (const field of LOCALE_COLUMNS) cols.push(`${locale}_${field}`);
    values.push(...localeValues(payload.locales[locale] ?? EMPTY_LOCALE));
  }
  const placeholders = cols.map(() => "?").join(", ");
  const stmt = db.prepare(`
    INSERT INTO blog_posts (
      slug, en_slug, published_at, read_minutes, cover_image_url, is_published,
      ${cols.join(", ")},
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ${placeholders}, ?, ?)
  `);
  const info = stmt.run(
    payload.slug,
    payload.en_slug,
    payload.published_at,
    payload.read_minutes,
    payload.cover_image_url,
    payload.is_published ? 1 : 0,
    ...values,
    ts,
    ts,
  );
  return Number(info.lastInsertRowid);
}

export function updateBlogPost(id: number, payload: BlogPostWritePayload): void {
  const ts = now();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  for (const locale of BLOG_LOCALES) {
    const copy = payload.locales[locale];
    if (!copy) continue; // absent = unchanged, see BlogPostWritePayload
    for (const field of LOCALE_COLUMNS) sets.push(`${locale}_${field} = ?`);
    values.push(...localeValues(copy));
  }
  db.prepare(`
    UPDATE blog_posts SET
      slug = ?, en_slug = ?, published_at = ?, read_minutes = ?, cover_image_url = ?, is_published = ?,
      ${sets.join(", ")},
      updated_at = ?
    WHERE id = ?
  `).run(
    payload.slug,
    payload.en_slug,
    payload.published_at,
    payload.read_minutes,
    payload.cover_image_url,
    payload.is_published ? 1 : 0,
    ...values,
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
