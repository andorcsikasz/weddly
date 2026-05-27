import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { blogApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMetaLiteral } from "../lib/seo";
import type { BlogBlock, BlogPost } from "@shared/blog_posts";
import NotFoundPage from "./NotFoundPage";
import { BlogCover } from "./BlogIndexPage";

/**
 * /blog/:slug: single post layout. Fetches the published post by slug,
 * renders the locale-specific copy with a cover-image hero. Unknown slugs
 * (or drafts) fall through to <NotFoundPage />. A "related posts" rail at
 * the bottom uses the same GET /api/blog/posts call so admin edits are
 * reflected without a frontend rebuild.
 */
export default function BlogPostPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { t, locale } = useT();

  const [post, setPost] = useState<BlogPost | null>(null);
  const [related, setRelated] = useState<BlogPost[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "not_found" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    Promise.all([blogApi.get(slug), blogApi.list()])
      .then(([detail, list]) => {
        if (cancelled) return;
        setPost(detail.post);
        setRelated(list.posts.filter((p) => p.slug !== detail.post.slug).slice(0, 3));
        setStatus("ok");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setStatus("not_found");
        } else {
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const copy = post?.[locale];
  useDocumentMetaLiteral(copy?.seo_title ?? "", copy?.seo_description ?? "");

  if (status === "not_found") return <NotFoundPage />;

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        {status === "loading" ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("blog.loading")}</p>
        ) : status === "error" || !post || !copy ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("blog.load_failed")}</p>
        ) : (
          <>
            <header className="border-b border-paper-300 dark:border-umber-700 pb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
                {post.category[locale]}
              </p>
              <h1 className="mt-3 font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {copy.title}
              </h1>
              <p className="mt-5 text-base leading-relaxed text-ink-600 dark:text-umber-200 sm:text-lg">
                {copy.lead}
              </p>
              <div className="mt-6 flex items-center gap-3 text-xs text-ink-500 dark:text-umber-300">
                <time dateTime={post.published_at}>{formatDate(post.published_at, locale)}</time>
                <span aria-hidden>·</span>
                <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
              </div>
            </header>

            {post.cover_image_url ? (
              <figure className="mt-10 overflow-hidden rounded-2xl">
                <BlogCover url={post.cover_image_url} alt={copy.title} />
              </figure>
            ) : null}

            <section
              lang={locale}
              className="mt-10 space-y-6 text-base leading-loose text-ink-800 dark:text-paper-100 sm:text-lg [hyphens:auto] [text-wrap:pretty]"
            >
              {copy.body.map((block, i) => (
                <Block key={i} block={block} />
              ))}
            </section>

            {related.length > 0 ? (
              <aside className="mt-16 border-t border-paper-300 dark:border-umber-700 pt-10">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                  {t("blog.related_eyebrow")}
                </p>
                <ul className="mt-6 space-y-5">
                  {related.map((r) => {
                    const rc = r[locale];
                    return (
                      <li key={r.slug}>
                        <Link
                          to={`/blog/${r.slug}`}
                          className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:focus-visible:ring-offset-umber-900"
                        >
                          <p className="text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                            {r.category[locale]}
                          </p>
                          <h3 className="mt-1 font-serif text-xl text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300 sm:text-2xl">
                            {rc.title}
                          </h3>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            ) : null}
          </>
        )}

        <p className="mt-16 text-sm">
          <Link
            to="/blog"
            className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
          >
            <ArrowLeft size={14} aria-hidden />
            {t("blog.back_to_index")}
          </Link>
        </p>
      </article>
    </PublicShell>
  );
}

function Block({ block }: { block: BlogBlock }) {
  if (block.type === "p") {
    return <p>{block.text}</p>;
  }
  if (block.type === "h2") {
    return (
      <h2 className="!mt-12 !mb-2 font-serif text-2xl text-ink-900 dark:text-paper-50 sm:text-3xl">
        {block.text}
      </h2>
    );
  }
  if (block.type === "h3") {
    return (
      <h3 className="!mt-8 !mb-1 font-serif text-xl text-ink-900 dark:text-paper-50 sm:text-2xl">
        {block.text}
      </h3>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="!my-4 space-y-2 pl-5">
        {block.items.map((item, i) => (
          <li key={i} className="list-disc leading-relaxed">
            {item}
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "blockquote") {
    // Multi-paragraph quotes (e.g. a longer scripture passage) are stored
    // with `\n\n` separators. Split here so each paragraph reads cleanly
    // instead of collapsing into one wall of italics.
    const paragraphs = block.text
      .split(/\n\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return (
      <figure className="!my-8 border-l-2 border-blush-400 pl-5 dark:border-blush-300 sm:pl-6">
        <blockquote className="space-y-3 font-serif text-lg italic leading-relaxed text-ink-800 dark:text-paper-100 sm:text-xl">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </blockquote>
        {block.cite ? (
          <figcaption className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink-500 dark:text-umber-300">
            {block.cite}
          </figcaption>
        ) : null}
      </figure>
    );
  }
  // CTA: external links open in a new tab, internal /paths stay in-app.
  // The whole block reads as a quiet call-out card so it doesn't compete
  // with the rest of the body but is unmissable at end-of-article.
  const isExternal = /^https?:\/\//.test(block.href);
  return (
    <aside className="!my-10 rounded-2xl border border-paper-300 bg-paper-100/60 p-6 dark:border-umber-700 dark:bg-umber-800/60 sm:p-8">
      <p className="text-base leading-relaxed text-ink-700 dark:text-paper-100 sm:text-lg">
        {block.lead}
      </p>
      <a
        href={block.href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        className="btn-primary btn-lifted mt-5 inline-flex"
      >
        {block.label}
      </a>
    </aside>
  );
}

function formatDate(iso: string, locale: "hu" | "en"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
