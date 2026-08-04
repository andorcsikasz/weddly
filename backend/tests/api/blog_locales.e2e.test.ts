// A blog post carries copy in every UI locale, not just the authored HU/EN
// pair, and one resolver decides which language a reader gets.
//
// The invariants under test:
//  - The boot seeder BACKFILLS the translated locales onto rows that already
//    exist. It has to: the slug-level seeder skips a slug it already has, so
//    a translation shipped in a later release would otherwise never reach a
//    single production row.
//  - The backfill never clobbers an admin edit, and re-running it is a no-op.
//  - `blogCopy` falls back to EN, never to HU, and the eyebrow follows the
//    copy so a translated headline can't sit under an English label.
//  - A half-filled locale (title, no body) reads as "not translated yet".
//  - An admin PUT that says nothing about a locale leaves it alone. An older
//    admin bundle that knows nothing about German must not wipe the German
//    copy just by saving a typo fix in the Hungarian.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import {
  BLOG_LOCALES,
  type BlogPost,
  blogCopy,
  hasBlogLocale,
  SEED_TRANSLATIONS,
} from "@shared/blog_posts";
import { db, now } from "../../src/db";
import { seedBlogPostsIfEmpty, toBlogPost } from "../../src/domain/blog";
import type { BlogPostRow } from "../../src/domain/blog";
import { registerAndVerify, req } from "../helpers";

const ADMIN_EMAIL = "admin@test.test";
const ADMIN_PASSWORD = "supersafe123";

async function adminToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) return reg.data.token;
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  return login.data.token;
}

function rowOf(slug: string): BlogPostRow {
  const row = db.prepare("SELECT * FROM blog_posts WHERE slug = ?").get(slug) as
    | BlogPostRow
    | undefined;
  if (!row) throw new Error(`test fixture drift: no blog row for ${slug}`);
  return row;
}

/** A slug every translation table is expected to carry. Picked from the
 *  seed rather than hardcoded copy so the test follows the content. */
function translatedSlug(): string {
  const [slug] = Object.keys(SEED_TRANSLATIONS.es);
  if (!slug) throw new Error("no Spanish translations seeded");
  return slug;
}

describe("blog: the seeder backfills translations onto existing rows", () => {
  beforeEach(() => {
    seedBlogPostsIfEmpty();
  });

  test("every slug in a translation table has that locale stored", () => {
    for (const [locale, table] of Object.entries(SEED_TRANSLATIONS)) {
      for (const [slug, tr] of Object.entries(table)) {
        const post = toBlogPost(rowOf(slug));
        expect(`${locale}:${post[locale as "es"]?.title}`).toBe(`${locale}:${tr.title}`);
        expect(post.category[locale as "es"]).toBe(tr.category);
        expect(post[locale as "es"]?.body.length).toBe(tr.body.length);
      }
    }
  });

  test("a translation that an admin edited survives the next boot", () => {
    const slug = translatedSlug();
    const id = rowOf(slug).id;
    db.prepare("UPDATE blog_posts SET es_title = ?, updated_at = ? WHERE id = ?").run(
      "Título editado a mano",
      now(),
      id,
    );

    seedBlogPostsIfEmpty();

    expect(rowOf(slug).es_title).toBe("Título editado a mano");
  });

  test("an emptied translation is refilled, which is what makes it a backfill", () => {
    const slug = translatedSlug();
    db.prepare("UPDATE blog_posts SET es_title = '', es_body_json = '[]' WHERE slug = ?").run(slug);

    seedBlogPostsIfEmpty();

    const refilled = rowOf(slug);
    expect(refilled.es_title).toBe(SEED_TRANSLATIONS.es[slug]?.title ?? "");
    expect((JSON.parse(refilled.es_body_json) as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("blog: the public payload carries every translated locale", () => {
  test("GET /api/blog/posts serves the translated blocks", async () => {
    seedBlogPostsIfEmpty();
    const res = await fetch(`http://localhost:${process.env.PORT ?? "8791"}/api/blog/posts`);
    expect(res.status).toBe(200);
    const { posts } = (await res.json()) as { posts: BlogPost[] };
    const slug = translatedSlug();
    const post = posts.find((p) => p.slug === slug);
    expect(post).toBeDefined();
    if (!post) return;
    expect(post.es?.title).toBe(SEED_TRANSLATIONS.es[slug]?.title);
    expect(post.category.es).toBe(SEED_TRANSLATIONS.es[slug]?.category);
  });
});

describe("blog: blogCopy resolves one language for copy AND eyebrow", () => {
  const base: BlogPost = {
    slug: "x",
    published_at: "2026-01-01",
    read_minutes: 4,
    category: { hu: "Költségvetés", en: "Budget", de: "Budget-DE" },
    hu: { title: "HU", lead: "", seo_title: "", seo_description: "", body: [{ type: "p", text: "hu" }] },
    en: { title: "EN", lead: "", seo_title: "", seo_description: "", body: [{ type: "p", text: "en" }] },
    de: { title: "DE", lead: "", seo_title: "", seo_description: "", body: [{ type: "p", text: "de" }] },
  };

  test("a translated locale gets its own copy and its own label", () => {
    const r = blogCopy(base, "de");
    expect(r.locale).toBe("de");
    expect(r.copy.title).toBe("DE");
    expect(r.category).toBe("Budget-DE");
  });

  test("an untranslated locale falls back to EN, never to HU", () => {
    const r = blogCopy(base, "hr");
    expect(r.locale).toBe("en");
    expect(r.copy.title).toBe("EN");
    expect(r.category).toBe("Budget");
  });

  test("a locale with a title but no body is not translated yet", () => {
    const half: BlogPost = {
      ...base,
      es: { title: "ES", lead: "", seo_title: "", seo_description: "", body: [] },
    };
    expect(hasBlogLocale(half, "es")).toBe(false);
    expect(blogCopy(half, "es").locale).toBe("en");
  });

  test("HU and EN are always present, so every UI locale resolves to something", () => {
    for (const locale of BLOG_LOCALES) {
      expect(blogCopy(base, locale).copy.title.length).toBeGreaterThan(0);
    }
  });
});

describe("blog: admin write keeps an untouched locale", () => {
  test("a PUT with no `de` key leaves the German copy alone", async () => {
    seedBlogPostsIfEmpty();
    const token = await adminToken();
    const slug = translatedSlug();
    const row = rowOf(slug);
    const before = row.de_title;
    expect(before.length).toBeGreaterThan(0);

    const post = toBlogPost(row);
    const put = await req<{ post: BlogPost }>(
      "PUT",
      `/api/admin/blog/posts/${row.id}`,
      {
        slug: post.slug,
        en_slug: post.en_slug ?? null,
        published_at: post.published_at,
        read_minutes: post.read_minutes,
        cover_image_url: post.cover_image_url,
        is_published: post.is_published,
        hu: { category: post.category.hu, ...post.hu },
        en: { category: post.category.en, ...post.en },
      },
      { token },
    );
    expect(put.status).toBe(200);
    expect(put.data.post.de?.title).toBe(before);
  });

  test("an explicitly empty locale withdraws the translation", async () => {
    seedBlogPostsIfEmpty();
    const token = await adminToken();
    const slug = translatedSlug();
    const row = rowOf(slug);
    const post = toBlogPost(row);

    const put = await req<{ post: BlogPost }>(
      "PUT",
      `/api/admin/blog/posts/${row.id}`,
      {
        slug: post.slug,
        en_slug: post.en_slug ?? null,
        published_at: post.published_at,
        read_minutes: post.read_minutes,
        cover_image_url: post.cover_image_url,
        is_published: post.is_published,
        hu: { category: post.category.hu, ...post.hu },
        en: { category: post.category.en, ...post.en },
        hr: { category: "", title: "", lead: "", seo_title: "", seo_description: "", body: [] },
      },
      { token },
    );
    expect(put.status).toBe(200);
    expect(hasBlogLocale(put.data.post, "hr")).toBe(false);
    expect(blogCopy(put.data.post, "hr").locale).toBe("en");

    // And the next boot puts it back, since an empty locale is exactly the
    // "not translated yet" state the backfill exists to fill.
    seedBlogPostsIfEmpty();
    expect(rowOf(slug).hr_title).toBe(SEED_TRANSLATIONS.hr[slug]?.title ?? "");
  });
});
