import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMetaLiteral } from "../lib/seo";
import { getBlogPost, listBlogPosts, type BlogBlock } from "@shared/blog_posts";
import NotFoundPage from "./NotFoundPage";

/**
 * /blog/:slug — single post layout. Renders the locale-specific copy of the
 * post resolved from the URL slug; unknown slugs fall through to the
 * existing 404 page so we don't have to duplicate that shell. The body is
 * a small block list (p / h2 / ul) rather than a markdown renderer — see
 * shared/blog_posts.ts for the schema.
 */
export default function BlogPostPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const { t, locale } = useT();
  const post = getBlogPost(slug);

  // Hooks must run unconditionally — call the meta hook with safe fallbacks
  // when the post is missing, then short-circuit to <NotFoundPage /> below.
  const copy = post?.[locale];
  useDocumentMetaLiteral(copy?.seo_title ?? "", copy?.seo_description ?? "");

  if (!post || !copy) {
    return <NotFoundPage />;
  }

  // "More from the magazine" rail: every other published post, sorted
  // newest-first. Capped at 3 so the rail doesn't grow indefinitely as
  // the catalogue does.
  const related = listBlogPosts()
    .filter((p) => p.slug !== post.slug)
    .slice(0, 3);

  return (
    <PublicShell>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
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
