// Admin-side blog CRUD. Two modes:
//   1. List view (default): every post in the catalogue, draft + published,
//      with a "+ New post" button and an inline status pill.
//   2. Editor view: per-locale form fields, block list (p / h2 / ul), cover
//      image upload, publish toggle. Save = PUT /api/admin/blog/posts/:id.
//      Delete prompts a confirm + DELETE.

import { ArrowLeft, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { AdminEmptyState, AdminPageHeader, Pill } from "../components/admin";
import { Button, useConfirm, useToast } from "../components/ui";
import type { AdminBlogLocalePayload, AdminBlogPostPayload } from "../lib/endpoints";
import { adminBlogApi } from "../lib/endpoints";
import { LOCALE_NAMES, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import {
  BLOG_LOCALES,
  type BlogBlock,
  type BlogLocale,
  type BlogPost,
  blogCopy,
  hasBlogLocale,
} from "@shared/blog_posts";

type View = { kind: "list" } | { kind: "edit"; postId: number } | { kind: "new" };

export default function AdminBlogPage() {
  useDocumentMeta("admin_blog.seo_title", "admin_blog.seo_description");
  const [view, setView] = useState<View>({ kind: "list" });

  if (view.kind === "list") {
    return (
      <BlogList
        onEdit={(id) => setView({ kind: "edit", postId: id })}
        onNew={() => setView({ kind: "new" })}
      />
    );
  }
  return (
    <BlogEditor
      postId={view.kind === "edit" ? view.postId : null}
      onClose={() => setView({ kind: "list" })}
      onSaved={(id) => setView({ kind: "edit", postId: id })}
    />
  );
}

// ─── List view ──────────────────────────────────────────────────────────

function BlogList({ onEdit, onNew }: { onEdit: (id: number) => void; onNew: () => void }) {
  const { t, locale } = useT();
  const toast = useToast();
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    adminBlogApi
      .list()
      .then((r) => {
        if (!cancelled) setPosts(r.posts);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, toast]);

  return (
    <section>
      <AdminPageHeader
        title={t("admin_blog.page_title")}
        subtitle={t("admin_blog.page_subtitle")}
        actions={
          <Button type="button" variant="primary" onClick={onNew}>
            <Plus size={14} aria-hidden />
            <span>{t("admin_blog.new_post")}</span>
          </Button>
        }
      />

      {posts === null ? (
        <p className="text-sm text-neutral-500 dark:text-umber-300">{t("blog.loading")}</p>
      ) : posts.length === 0 ? (
        <AdminEmptyState
          title={t("admin_blog.empty_title")}
          description={t("admin_blog.empty_body")}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-paper-300 dark:border-umber-700">
          <table className="w-full text-sm">
            <thead className="bg-paper-100 text-left text-xs uppercase tracking-wider text-neutral-500 dark:bg-umber-800 dark:text-umber-300">
              <tr>
                <th className="px-4 py-3 font-semibold">{t("admin_blog.col_title")}</th>
                <th className="px-4 py-3 font-semibold">{t("admin_blog.col_slug")}</th>
                <th className="px-4 py-3 font-semibold">{t("admin_blog.col_status")}</th>
                <th className="px-4 py-3 font-semibold">{t("admin_blog.col_date")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-300 dark:divide-umber-700">
              {posts.map((post) => (
                <tr key={post.id} className="hover:bg-paper-50 dark:hover:bg-umber-800">
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => post.id && onEdit(post.id)}
                      className="text-left font-medium text-neutral-900 hover:underline dark:text-paper-50"
                    >
                      {blogCopy(post, locale).copy.title || post.slug}
                    </button>
                    <p className="mt-0.5 text-xs text-neutral-500 dark:text-umber-300">
                      {blogCopy(post, locale).category}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {BLOG_LOCALES.map((l) => (
                        <span
                          key={l}
                          title={LOCALE_NAMES[l]}
                          className={`rounded px-1 py-px font-mono text-[10px] uppercase ${
                            hasBlogLocale(post, l)
                              ? "bg-sage-100 text-sage-800 dark:bg-sage-900 dark:text-sage-100"
                              : "bg-paper-200 text-neutral-400 dark:bg-umber-700 dark:text-umber-400"
                          }`}
                        >
                          {l}
                        </span>
                      ))}
                    </p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-600 dark:text-umber-200">
                    {post.slug}
                  </td>
                  <td className="px-4 py-3">
                    {post.is_published ? (
                      <Pill tone="sage">{t("admin_blog.status_published")}</Pill>
                    ) : (
                      <Pill tone="muted">{t("admin_blog.status_draft")}</Pill>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-umber-300">
                    {post.published_at}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => post.id && onEdit(post.id)}
                    >
                      {t("admin_blog.edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Reload hint so toggle changes elsewhere re-fetch without a full nav. */}
      <button type="button" hidden onClick={() => setReloadNonce((n) => n + 1)} />
    </section>
  );
}

// ─── Editor view ────────────────────────────────────────────────────────

function blankLocale(): AdminBlogLocalePayload {
  return { category: "", title: "", lead: "", seo_title: "", seo_description: "", body: [] };
}

function blankPayload(): AdminBlogPostPayload {
  const draft: AdminBlogPostPayload = {
    slug: "",
    published_at: new Date().toISOString().slice(0, 10),
    read_minutes: 5,
    cover_image_url: null,
    is_published: false,
    hu: blankLocale(),
    en: blankLocale(),
  };
  for (const locale of BLOG_LOCALES) draft[locale] = blankLocale();
  return draft;
}

function postToPayload(post: BlogPost): AdminBlogPostPayload {
  const draft: AdminBlogPostPayload = {
    slug: post.slug,
    published_at: post.published_at,
    read_minutes: post.read_minutes,
    cover_image_url: post.cover_image_url ?? null,
    is_published: Boolean(post.is_published),
    hu: blankLocale(),
    en: blankLocale(),
  };
  // Every locale is loaded into the draft, translated or not, so the editor
  // always sends a complete body back. A locale the post has nothing for
  // starts empty and stays empty unless someone types in it.
  for (const locale of BLOG_LOCALES) {
    const copy = post[locale];
    draft[locale] = {
      category: post.category[locale] ?? "",
      title: copy?.title ?? "",
      lead: copy?.lead ?? "",
      seo_title: copy?.seo_title ?? "",
      seo_description: copy?.seo_description ?? "",
      body: copy?.body ?? [],
    };
  }
  return draft;
}

function BlogEditor({
  postId,
  onClose,
  onSaved,
}: {
  postId: number | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<AdminBlogPostPayload>(blankPayload);
  const [activeLocale, setActiveLocale] = useState<BlogLocale>("hu");
  const [currentId, setCurrentId] = useState<number | null>(postId);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready">(postId === null ? "ready" : "loading");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (postId === null) return;
    let cancelled = false;
    setStatus("loading");
    adminBlogApi
      .get(postId)
      .then((r) => {
        if (cancelled) return;
        setDraft(postToPayload(r.post));
        setCoverUrl(r.post.cover_image_url ?? null);
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "error");
        onClose();
      });
    return () => {
      cancelled = true;
    };
  }, [postId, toast, onClose]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (currentId === null) {
        const r = await adminBlogApi.create(draft);
        toast.success(t("admin_blog.saved"));
        if (r.post.id) {
          setCurrentId(r.post.id);
          onSaved(r.post.id);
        }
      } else {
        const r = await adminBlogApi.update(currentId, draft);
        toast.success(t("admin_blog.saved"));
        setCoverUrl(r.post.cover_image_url ?? null);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("admin_blog.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (currentId === null) return;
    const ok = await confirm({
      title: t("admin_blog.delete_confirm_title"),
      body: t("admin_blog.delete_confirm_body"),
      confirmLabel: t("admin_blog.delete"),
      cancelLabel: t("admin_blog.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminBlogApi.remove(currentId);
      toast.success(t("admin_blog.deleted"));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    }
  }

  async function handleUploadCover(file: File) {
    if (currentId === null) {
      // Create first so the upload endpoint has an id to anchor the file to.
      toast.info(t("admin_blog.save_before_upload"));
      return;
    }
    setUploading(true);
    try {
      const r = await adminBlogApi.uploadCover(currentId, file);
      setCoverUrl(r.post.cover_image_url ?? null);
      setDraft((d) => ({ ...d, cover_image_url: r.post.cover_image_url ?? null }));
      toast.success(t("admin_blog.cover_uploaded"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleClearCover() {
    if (currentId === null) return;
    try {
      const r = await adminBlogApi.clearCover(currentId);
      setCoverUrl(r.post.cover_image_url ?? null);
      setDraft((d) => ({ ...d, cover_image_url: null }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "error");
    }
  }

  if (status === "loading") {
    return (
      <p className="text-sm text-neutral-500 dark:text-umber-300">
        <Loader2 size={14} className="mr-1 inline animate-spin" />
        {t("blog.loading")}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <AdminPageHeader
        title={currentId === null ? t("admin_blog.new_post") : t("admin_blog.edit_post")}
        subtitle={currentId === null ? t("admin_blog.new_post_subtitle") : draft.slug}
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              <ArrowLeft size={14} aria-hidden />
              <span>{t("admin_blog.back_to_list")}</span>
            </Button>
            {currentId !== null && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void handleDelete();
                }}
              >
                <Trash2 size={14} aria-hidden />
                <span>{t("admin_blog.delete")}</span>
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? t("admin_blog.saving") : t("admin_blog.save")}
            </Button>
          </div>
        }
      />

      {/* Top-level fields */}
      <section className="grid gap-4 rounded-xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-800 sm:grid-cols-2">
        <Field label={t("admin_blog.field_slug")}>
          <input
            type="text"
            required
            value={draft.slug}
            onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            className="input"
            placeholder="my-post-slug"
          />
        </Field>
        <Field label={t("admin_blog.field_published_at")}>
          <input
            type="date"
            required
            value={draft.published_at}
            onChange={(e) => setDraft({ ...draft, published_at: e.target.value })}
            className="input"
          />
        </Field>
        <Field label={t("admin_blog.field_read_minutes")}>
          <input
            type="number"
            min={1}
            max={60}
            value={draft.read_minutes}
            onChange={(e) => setDraft({ ...draft, read_minutes: Number(e.target.value) })}
            className="input"
          />
        </Field>
        <Field label={t("admin_blog.field_publish_state")}>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.is_published}
              onChange={(e) => setDraft({ ...draft, is_published: e.target.checked })}
            />
            <span>{t("admin_blog.publish_toggle")}</span>
          </label>
        </Field>
      </section>

      {/* Cover image */}
      <section className="rounded-xl border border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-800">
        <h2 className="font-semibold">{t("admin_blog.section_cover")}</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-umber-300">
          {t("admin_blog.section_cover_help")}
        </p>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="aspect-[16/10] w-full max-w-xs overflow-hidden rounded-lg bg-paper-200 dark:bg-umber-700">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-paper-400 dark:text-umber-600">
                <ImagePlus size={28} strokeWidth={1.5} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleUploadCover(file);
              }}
              className="text-sm"
              disabled={uploading || currentId === null}
            />
            <p className="text-xs text-neutral-500 dark:text-umber-300">
              {t("admin_blog.cover_constraints")}
            </p>
            {coverUrl && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleClearCover()}
              >
                {t("admin_blog.cover_remove")}
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* One locale at a time. Five panels side by side would be unreadable,
          and the tab strip is also the translation status board: a filled dot
          means that language has a title and a body, which is exactly the
          test the reader-facing resolver applies. */}
      <div>
        <div
          role="tablist"
          aria-label={t("admin_blog.locales_tablist")}
          className="flex flex-wrap gap-1 border-b border-paper-300 dark:border-umber-700"
        >
          {BLOG_LOCALES.map((l) => {
            const filled = Boolean(draft[l]?.title.trim() && (draft[l]?.body.length ?? 0) > 0);
            const active = l === activeLocale;
            return (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveLocale(l)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm transition-colors ${
                  active
                    ? "border-blush-500 font-semibold text-neutral-900 dark:text-paper-50"
                    : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-umber-300 dark:hover:text-paper-100"
                }`}
              >
                {LOCALE_NAMES[l]}
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    filled ? "bg-sage-500" : "bg-paper-400 dark:bg-umber-600"
                  }`}
                />
              </button>
            );
          })}
        </div>
        <LocalePanel
          key={activeLocale}
          locale={activeLocale}
          value={draft[activeLocale] ?? blankLocale()}
          onChange={(next) => setDraft({ ...draft, [activeLocale]: next })}
        />
      </div>
    </form>
  );
}

function LocalePanel({
  locale,
  value,
  onChange,
}: {
  locale: BlogLocale;
  value: AdminBlogLocalePayload;
  onChange: (next: AdminBlogLocalePayload) => void;
}) {
  const { t } = useT();
  return (
    <section
      lang={locale}
      className="rounded-b-xl border border-t-0 border-paper-300 bg-paper-50 p-5 dark:border-umber-700 dark:bg-umber-800"
    >
      <div className="mt-4 space-y-3">
        <Field label={t("admin_blog.field_category")}>
          <input
            type="text"
            value={value.category}
            onChange={(e) => onChange({ ...value, category: e.target.value })}
            className="input"
          />
        </Field>
        <Field label={t("admin_blog.field_title")}>
          <input
            type="text"
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            className="input"
          />
        </Field>
        <Field label={t("admin_blog.field_lead")}>
          <textarea
            rows={3}
            value={value.lead}
            onChange={(e) => onChange({ ...value, lead: e.target.value })}
            className="input"
          />
        </Field>
        <Field label={t("admin_blog.field_seo_title")}>
          <input
            type="text"
            value={value.seo_title}
            onChange={(e) => onChange({ ...value, seo_title: e.target.value })}
            className="input"
          />
        </Field>
        <Field label={t("admin_blog.field_seo_description")}>
          <textarea
            rows={2}
            value={value.seo_description}
            onChange={(e) => onChange({ ...value, seo_description: e.target.value })}
            className="input"
          />
        </Field>
      </div>

      <h3 className="mt-6 text-sm font-semibold">{t("admin_blog.section_body")}</h3>
      <BlockEditor blocks={value.body} onChange={(next) => onChange({ ...value, body: next })} />
    </section>
  );
}

function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: BlogBlock[];
  onChange: (next: BlogBlock[]) => void;
}) {
  const { t } = useT();

  function update(idx: number, next: BlogBlock) {
    onChange(blocks.map((b, i) => (i === idx ? next : b)));
  }
  function remove(idx: number) {
    onChange(blocks.filter((_, i) => i !== idx));
  }
  function move(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (target < 0 || target >= blocks.length) return;
    const copy = blocks.slice();
    const a = copy[idx];
    const b = copy[target];
    if (!a || !b) return;
    copy[idx] = b;
    copy[target] = a;
    onChange(copy);
  }
  function add(type: BlogBlock["type"]) {
    if (type === "p" || type === "h2" || type === "h3") {
      onChange([...blocks, { type, text: "" }]);
    } else if (type === "ul") {
      onChange([...blocks, { type: "ul", items: [""] }]);
    } else if (type === "blockquote") {
      onChange([...blocks, { type: "blockquote", text: "", cite: "" }]);
    } else if (type === "img") {
      onChange([...blocks, { type: "img", src: "", alt: "" }]);
    } else {
      onChange([...blocks, { type: "cta", lead: "", href: "/signup", label: "" }]);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      {blocks.length === 0 ? (
        <p className="text-xs text-neutral-500 dark:text-umber-300">{t("admin_blog.body_empty")}</p>
      ) : (
        blocks.map((block, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-paper-300 bg-white p-3 dark:border-umber-600 dark:bg-umber-900"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-umber-300">
                {t(`admin_blog.block_${block.type}`)}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded p-1 text-xs text-neutral-500 hover:bg-paper-200 dark:text-umber-300 dark:hover:bg-umber-700"
                  onClick={() => move(idx, -1)}
                  aria-label={t("admin_blog.move_up")}
                  disabled={idx === 0}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-xs text-neutral-500 hover:bg-paper-200 dark:text-umber-300 dark:hover:bg-umber-700"
                  onClick={() => move(idx, 1)}
                  aria-label={t("admin_blog.move_down")}
                  disabled={idx === blocks.length - 1}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-xs text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                  onClick={() => remove(idx)}
                  aria-label={t("admin_blog.remove_block")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="mt-2">
              {block.type === "p" || block.type === "h2" || block.type === "h3" ? (
                <textarea
                  rows={block.type === "p" ? 4 : 1}
                  value={block.text}
                  onChange={(e) => update(idx, { type: block.type, text: e.target.value })}
                  className="input"
                />
              ) : block.type === "ul" ? (
                <UlEditor
                  items={block.items}
                  onChange={(next) => update(idx, { type: "ul", items: next })}
                />
              ) : block.type === "blockquote" ? (
                <BlockquoteEditor value={block} onChange={(next) => update(idx, next)} />
              ) : block.type === "img" ? (
                <ImgEditor value={block} onChange={(next) => update(idx, next)} />
              ) : (
                <CtaEditor value={block} onChange={(next) => update(idx, next)} />
              )}
            </div>
          </div>
        ))
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => add("p")}>
          + {t("admin_blog.add_p")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => add("h2")}>
          + {t("admin_blog.add_h2")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => add("h3")}>
          + {t("admin_blog.add_h3")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => add("ul")}>
          + {t("admin_blog.add_ul")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => add("blockquote")}>
          + {t("admin_blog.add_blockquote")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => add("img")}>
          + {t("admin_blog.add_img")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => add("cta")}>
          + {t("admin_blog.add_cta")}
        </Button>
      </div>
    </div>
  );
}

function BlockquoteEditor({
  value,
  onChange,
}: {
  value: Extract<BlogBlock, { type: "blockquote" }>;
  onChange: (next: Extract<BlogBlock, { type: "blockquote" }>) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
          {t("admin_blog.blockquote_text")}
        </span>
        <textarea
          rows={5}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          className="input"
          placeholder={t("admin_blog.blockquote_text_placeholder")}
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
          {t("admin_blog.blockquote_cite")}
        </span>
        <input
          type="text"
          value={value.cite}
          onChange={(e) => onChange({ ...value, cite: e.target.value })}
          className="input"
          placeholder="1Korinthus 13,4-8"
        />
      </label>
    </div>
  );
}

function CtaEditor({
  value,
  onChange,
}: {
  value: Extract<BlogBlock, { type: "cta" }>;
  onChange: (next: Extract<BlogBlock, { type: "cta" }>) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
          {t("admin_blog.cta_lead")}
        </span>
        <textarea
          rows={2}
          value={value.lead}
          onChange={(e) => onChange({ ...value, lead: e.target.value })}
          className="input"
        />
      </label>
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
            {t("admin_blog.cta_label")}
          </span>
          <input
            type="text"
            value={value.label}
            onChange={(e) => onChange({ ...value, label: e.target.value })}
            className="input"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
            {t("admin_blog.cta_href")}
          </span>
          <input
            type="text"
            value={value.href}
            onChange={(e) => onChange({ ...value, href: e.target.value })}
            className="input font-mono"
            placeholder="/signup"
          />
        </label>
      </div>
    </div>
  );
}

function ImgEditor({
  value,
  onChange,
}: {
  value: Extract<BlogBlock, { type: "img" }>;
  onChange: (next: Extract<BlogBlock, { type: "img" }>) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      {value.src ? (
        <img src={value.src} alt={value.alt} className="max-h-40 w-full rounded-lg object-cover" />
      ) : null}
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
          {t("admin_blog.img_src")}
        </span>
        <input
          type="text"
          value={value.src}
          onChange={(e) => onChange({ ...value, src: e.target.value })}
          className="input font-mono"
          placeholder="https://commons.wikimedia.org/wiki/Special:FilePath/..."
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
          {t("admin_blog.img_alt")}
        </span>
        <input
          type="text"
          value={value.alt}
          onChange={(e) => onChange({ ...value, alt: e.target.value })}
          className="input"
        />
      </label>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
          {t("admin_blog.img_caption")}
        </span>
        <input
          type="text"
          value={value.caption ?? ""}
          onChange={(e) => onChange({ ...value, caption: e.target.value || undefined })}
          className="input"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
            {t("admin_blog.img_credit")}
          </span>
          <input
            type="text"
            value={value.credit ?? ""}
            onChange={(e) => onChange({ ...value, credit: e.target.value || undefined })}
            className="input"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500 dark:text-umber-300">
            {t("admin_blog.img_credit_href")}
          </span>
          <input
            type="text"
            value={value.creditHref ?? ""}
            onChange={(e) => onChange({ ...value, creditHref: e.target.value || undefined })}
            className="input font-mono"
          />
        </label>
      </div>
    </div>
  );
}

function UlEditor({
  items,
  onChange,
}: {
  items: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useT();
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          <textarea
            rows={1}
            value={item}
            onChange={(e) => {
              const copy = items.slice();
              copy[i] = e.target.value;
              onChange(copy);
            }}
            className="input flex-1"
          />
          <button
            type="button"
            className="rounded p-1 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            aria-label={t("admin_blog.remove_item")}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...items, ""])}>
        + {t("admin_blog.add_ul_item")}
      </Button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-umber-300">
        {label}
      </span>
      {children}
    </label>
  );
}
