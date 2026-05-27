// Public blog feed + admin-side CRUD + cover image upload.
//
// Public endpoints serve the `is_published = 1` slice of the `blog_posts`
// table; admin endpoints (gated by requireAdmin) see drafts too and can
// create / update / delete. Cover images go onto the persistent uploads
// volume under /uploads/blog/<id>.<ext>, served by the static handler in
// server.ts.

import { existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { BlogBlock, BlogPost } from "../../../shared/blog_posts";
import { CONFIG } from "../config";
import { db, now } from "../db";
import {
  type BlogPostRow,
  type BlogPostWritePayload,
  deleteBlogPost,
  getBlogPostById,
  getBlogPostBySlug,
  insertBlogPost,
  listAllPostsForAdmin,
  listPublishedPosts,
  setBlogPostCoverImage,
  toBlogPost,
  updateBlogPost,
} from "../domain/blog";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

// ─── Validation helpers ─────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseSlug(raw: unknown): string {
  if (typeof raw !== "string") throw new HttpError(400, "slug must be a string");
  const trimmed = raw.trim().toLowerCase();
  if (!SLUG_RE.test(trimmed)) {
    throw new HttpError(400, "slug must be 1-64 chars, lowercase a-z, 0-9, hyphen");
  }
  return trimmed;
}

function parseIsoDate(raw: unknown): string {
  if (typeof raw !== "string" || !ISO_DATE_RE.test(raw)) {
    throw new HttpError(400, "published_at must be YYYY-MM-DD");
  }
  return raw;
}

function parseInt0(raw: unknown, field: string, min = 0, max = 999): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${field} must be an integer ${min}..${max}`);
  }
  return n;
}

function parseStr(raw: unknown, field: string, maxLen = 1024): string {
  if (typeof raw !== "string") throw new HttpError(400, `${field} must be a string`);
  if (raw.length > maxLen) throw new HttpError(400, `${field} too long`);
  return raw;
}

function parseCoverImageUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") throw new HttpError(400, "cover_image_url must be a string");
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 2048) throw new HttpError(400, "cover_image_url too long");
  // Accept either a local `/uploads/...` path (from the upload endpoint) or
  // an external http(s) URL the admin pasted in.
  if (trimmed.startsWith("/uploads/")) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      throw new HttpError(400, "cover_image_url must be http(s)");
    }
    return trimmed;
  } catch {
    throw new HttpError(400, "cover_image_url must be a valid URL or /uploads/... path");
  }
}

function parseBlocks(raw: unknown, field: string): BlogBlock[] {
  if (!Array.isArray(raw)) throw new HttpError(400, `${field} must be an array`);
  if (raw.length > 200) throw new HttpError(400, `${field} too long (max 200 blocks)`);
  const out: BlogBlock[] = [];
  for (const block of raw) {
    if (!block || typeof block !== "object") {
      throw new HttpError(400, `${field}: block must be an object`);
    }
    const b = block as Record<string, unknown>;
    if (b.type === "p" || b.type === "h2" || b.type === "h3") {
      if (typeof b.text !== "string") {
        throw new HttpError(400, `${field}: ${b.type} block needs text`);
      }
      if (b.text.length > 4000) throw new HttpError(400, `${field}: block text too long`);
      out.push({ type: b.type, text: b.text });
    } else if (b.type === "ul") {
      if (!Array.isArray(b.items)) {
        throw new HttpError(400, `${field}: ul block needs items array`);
      }
      if (b.items.length > 50) throw new HttpError(400, `${field}: ul items too long`);
      const items: string[] = [];
      for (const item of b.items) {
        if (typeof item !== "string") {
          throw new HttpError(400, `${field}: ul items must be strings`);
        }
        if (item.length > 1000) throw new HttpError(400, `${field}: ul item too long`);
        items.push(item);
      }
      out.push({ type: "ul", items });
    } else if (b.type === "blockquote") {
      if (typeof b.text !== "string" || typeof b.cite !== "string") {
        throw new HttpError(400, `${field}: blockquote needs text and cite`);
      }
      if (b.text.length > 4000) throw new HttpError(400, `${field}: blockquote text too long`);
      if (b.cite.length > 200) throw new HttpError(400, `${field}: blockquote cite too long`);
      out.push({ type: "blockquote", text: b.text, cite: b.cite });
    } else if (b.type === "cta") {
      if (typeof b.lead !== "string" || typeof b.href !== "string" || typeof b.label !== "string") {
        throw new HttpError(400, `${field}: cta block needs lead, href, label`);
      }
      if (b.lead.length > 2000) throw new HttpError(400, `${field}: cta lead too long`);
      if (b.label.length > 200) throw new HttpError(400, `${field}: cta label too long`);
      if (b.href.length > 2048) throw new HttpError(400, `${field}: cta href too long`);
      // Restrict href to internal paths (/foo) or http(s) URLs so the admin
      // can't drop in javascript: or data: URIs.
      const hrefOk =
        b.href.startsWith("/") || b.href.startsWith("http://") || b.href.startsWith("https://");
      if (!hrefOk) throw new HttpError(400, `${field}: cta href must be / or http(s)`);
      out.push({ type: "cta", lead: b.lead, href: b.href, label: b.label });
    } else {
      throw new HttpError(400, `${field}: unknown block type ${String(b.type)}`);
    }
  }
  return out;
}

function parseLocalePayload(raw: unknown, locale: "hu" | "en"): BlogPostWritePayload["hu"] {
  if (!raw || typeof raw !== "object") {
    throw new HttpError(400, `${locale} payload missing`);
  }
  const r = raw as Record<string, unknown>;
  return {
    category: parseStr(r.category, `${locale}.category`, 80),
    title: parseStr(r.title, `${locale}.title`, 400),
    lead: parseStr(r.lead, `${locale}.lead`, 800),
    seo_title: parseStr(r.seo_title, `${locale}.seo_title`, 200),
    seo_description: parseStr(r.seo_description, `${locale}.seo_description`, 400),
    body: parseBlocks(r.body, `${locale}.body`),
  };
}

function parseWritePayload(raw: unknown): BlogPostWritePayload {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Payload required");
  const r = raw as Record<string, unknown>;
  return {
    slug: parseSlug(r.slug),
    published_at: parseIsoDate(r.published_at),
    read_minutes: parseInt0(r.read_minutes, "read_minutes", 1, 60),
    cover_image_url: parseCoverImageUrl(r.cover_image_url),
    is_published: Boolean(r.is_published),
    hu: parseLocalePayload(r.hu, "hu"),
    en: parseLocalePayload(r.en, "en"),
  };
}

// ─── Public handlers ────────────────────────────────────────────────────

function handlePublicList(_ctx: Ctx): Response {
  const rows = listPublishedPosts();
  const posts: BlogPost[] = rows.map(toBlogPost);
  return json({ posts });
}

function handlePublicGet(ctx: Ctx): Response {
  const slug = ctx.params.slug ?? "";
  const row = getBlogPostBySlug(slug);
  if (!row || row.is_published !== 1) throw new HttpError(404, "Post not found");
  return json({ post: toBlogPost(row) });
}

// ─── Admin handlers ─────────────────────────────────────────────────────

function handleAdminList(ctx: Ctx): Response {
  requireAdmin(ctx);
  const rows = listAllPostsForAdmin();
  return json({ posts: rows.map(toBlogPost) });
}

function handleAdminGet(ctx: Ctx): Response {
  requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  const row = getBlogPostById(id);
  if (!row) throw new HttpError(404, "Post not found");
  return json({ post: toBlogPost(row) });
}

async function handleAdminCreate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const raw = await readJson(ctx.req);
  const payload = parseWritePayload(raw);
  if (getBlogPostBySlug(payload.slug)) {
    throw new HttpError(409, "Slug already in use");
  }
  const id = insertBlogPost(payload);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "blog.post_create",
    target_kind: "blog_post",
    target_id: id,
    after: { slug: payload.slug, is_published: payload.is_published },
  });
  const created = getBlogPostById(id);
  if (!created) throw new HttpError(500, "Created post vanished");
  return json({ post: toBlogPost(created) }, { status: 201 });
}

async function handleAdminUpdate(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  const existing = getBlogPostById(id);
  if (!existing) throw new HttpError(404, "Post not found");
  const raw = await readJson(ctx.req);
  const payload = parseWritePayload(raw);
  // Slug change is allowed but must remain unique.
  if (payload.slug !== existing.slug) {
    const clash = getBlogPostBySlug(payload.slug);
    if (clash && clash.id !== id) throw new HttpError(409, "Slug already in use");
  }
  updateBlogPost(id, payload);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "blog.post_update",
    target_kind: "blog_post",
    target_id: id,
    before: { slug: existing.slug, is_published: existing.is_published === 1 },
    after: { slug: payload.slug, is_published: payload.is_published },
  });
  const refreshed = getBlogPostById(id);
  if (!refreshed) throw new HttpError(500, "Updated post vanished");
  return json({ post: toBlogPost(refreshed) });
}

function handleAdminDelete(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  const existing = getBlogPostById(id);
  if (!existing) throw new HttpError(404, "Post not found");

  // Best-effort unlink the cover image so deleted posts don't leak files.
  const localPath = coverUrlToDisk(existing.cover_image_url);
  if (localPath && existsSync(localPath)) {
    void unlink(localPath).catch(() => {
      // Leaking a stale file under uploads is not user-visible.
    });
  }

  deleteBlogPost(id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "blog.post_delete",
    target_kind: "blog_post",
    target_id: id,
    before: { slug: existing.slug },
  });
  return json({ ok: true });
}

// ─── Cover image upload ─────────────────────────────────────────────────

const MAX_COVER_BYTES = 4 * 1024 * 1024;
const SUPPORTED_COVER_MIMES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function coverUrlToDisk(publicUrl: string | null): string | null {
  if (!publicUrl) return null;
  const noQuery = publicUrl.split("?")[0] ?? publicUrl;
  if (!noQuery.startsWith("/uploads/")) return null;
  const rel = noQuery.slice("/uploads/".length);
  if (rel.includes("..") || rel.startsWith("/")) return null;
  return join(CONFIG.uploadsDir, rel);
}

async function handleAdminUploadCover(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  const existing = getBlogPostById(id);
  if (!existing) throw new HttpError(404, "Post not found");

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required", { code: "bad_multipart" });
  });
  const raw = form.get("file");
  if (!(raw instanceof File)) {
    throw new HttpError(400, "`file` field required", { code: "missing_file" });
  }
  if (raw.size <= 0) throw new HttpError(400, "Empty file", { code: "empty_file" });
  if (raw.size > MAX_COVER_BYTES) {
    throw new HttpError(413, `File too large (max ${MAX_COVER_BYTES / 1024 / 1024} MB)`, {
      code: "file_too_large",
    });
  }
  const ext = SUPPORTED_COVER_MIMES[raw.type];
  if (!ext) {
    throw new HttpError(415, `Unsupported image type: ${raw.type || "unknown"}`, {
      code: "unsupported_type",
    });
  }

  const dir = join(CONFIG.uploadsDir, "blog");
  await mkdir(dir, { recursive: true });

  const previousDiskPath = coverUrlToDisk(existing.cover_image_url);
  const newDiskPath = join(dir, `${id}.${ext}`);
  if (previousDiskPath && previousDiskPath !== newDiskPath && existsSync(previousDiskPath)) {
    await unlink(previousDiskPath).catch(() => {
      // Best-effort cleanup; an orphaned old-ext file is harmless.
    });
  }

  await Bun.write(newDiskPath, raw);

  const ts = now();
  const publicUrl = `/uploads/blog/${id}.${ext}?v=${ts}`;
  setBlogPostCoverImage(id, publicUrl);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "blog.post_cover_upload",
    target_kind: "blog_post",
    target_id: id,
    before: { cover_image_url: existing.cover_image_url },
    after: { cover_image_url: publicUrl, bytes: raw.size, mime: raw.type },
  });
  const refreshed = getBlogPostById(id);
  if (!refreshed) throw new HttpError(500, "Post vanished mid-upload");
  return json({ post: toBlogPost(refreshed) });
}

function handleAdminClearCover(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Invalid id");
  const existing = getBlogPostById(id);
  if (!existing) throw new HttpError(404, "Post not found");

  const localPath = coverUrlToDisk(existing.cover_image_url);
  if (localPath && existsSync(localPath)) {
    void unlink(localPath).catch(() => {});
  }
  setBlogPostCoverImage(id, null);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "blog.post_cover_clear",
    target_kind: "blog_post",
    target_id: id,
    before: { cover_image_url: existing.cover_image_url },
  });
  const refreshed = getBlogPostById(id);
  if (!refreshed) throw new HttpError(500, "Post vanished");
  return json({ post: toBlogPost(refreshed) });
}

// ─── Registration ───────────────────────────────────────────────────────

export function registerBlogRoutes(router: Router) {
  // Public — no auth.
  router.get("/api/blog/posts", handlePublicList);
  router.get("/api/blog/posts/:slug", handlePublicGet);

  // Admin — auth + requireAdmin inside the handlers.
  router.get("/api/admin/blog/posts", handleAdminList, true);
  router.get("/api/admin/blog/posts/:id", handleAdminGet, true);
  router.post("/api/admin/blog/posts", handleAdminCreate, true);
  router.put("/api/admin/blog/posts/:id", handleAdminUpdate, true);
  router.delete("/api/admin/blog/posts/:id", handleAdminDelete, true);
  router.post("/api/admin/blog/posts/:id/cover", handleAdminUploadCover, true);
  router.delete("/api/admin/blog/posts/:id/cover", handleAdminClearCover, true);
}

// Re-export so the seeder can be called from server.ts boot.
export { seedBlogPostsIfEmpty } from "../domain/blog";

// Re-export row shape so seo_ssr.ts can map directly.
export type { BlogPostRow };
