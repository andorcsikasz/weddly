import { ArrowLeft } from "lucide-react";
import { intlLocale } from "../lib/format";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BlogCover } from "../components/BlogCover";
import { PublicShell } from "../components/PublicShell";
import { blogApi } from "../lib/endpoints";
import { type Locale, useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { type BlogLocale, type BlogPost, blogCopy } from "@shared/blog_posts";

/**
 * /blog: tile-style index of every published post. Each card has the cover
 * image up top (or a quiet placeholder if the admin hasn't uploaded one
 * yet), followed by the category, title, lead and a date / read-time
 * footer line. Posts come from GET /api/blog/posts; admin edits land live
 * on the next page reload without a frontend rebuild.
 */
export default function BlogIndexPage() {
  const { t, locale } = useT();
  useDocumentMeta("blog.index_seo_title", "blog.index_seo_description");
  const [posts, setPosts] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    blogApi
      .list()
      .then((res) => {
        if (!cancelled) setPosts(res.posts);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PublicShell>
      <article className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-20">
        <header className="border-b border-paper-300 dark:border-umber-700 pb-10">
          <h1 className="font-grotesk text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
            {t("blog.index_title")}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-600 dark:text-umber-200 sm:text-lg">
            {t("blog.index_lead")}
          </p>
        </header>

        {error ? (
          <p className="mt-10 text-sm text-ink-500 dark:text-umber-300">{t("blog.load_failed")}</p>
        ) : posts === null ? (
          <p className="mt-10 text-sm text-ink-500 dark:text-umber-300">{t("blog.loading")}</p>
        ) : posts.length === 0 ? (
          <p className="mt-10 text-sm text-ink-500 dark:text-umber-300">{t("blog.empty")}</p>
        ) : (
          // `items-stretch` + `h-full` per tile equalises card heights
          // across each row, so titles or leads of different lengths
          // don't produce jagged columns.
          <ul className="mt-12 grid items-stretch gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-10 lg:gap-y-16">
            {posts.map((post) => (
              <li key={post.slug} className="h-full">
                <BlogTile post={post} locale={locale} t={t} />
              </li>
            ))}
          </ul>
        )}

        <p className="mt-16 text-sm">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
          >
            <ArrowLeft size={14} aria-hidden />
            {t("vendors.back_to_landing")}
          </Link>
        </p>
      </article>
    </PublicShell>
  );
}

function BlogTile({
  post,
  locale,
  t,
}: {
  post: BlogPost;
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  // One resolver decides both the copy and the eyebrow, so a card can't show
  // a Spanish headline under an English category label.
  const { copy, category, locale: shown } = blogCopy(post, locale);
  return (
    <Link
      to={locale === "hu" ? `/blog/${post.slug}` : `/blog/${post.en_slug ?? post.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-800 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:border-ink-700 dark:bg-umber-800 dark:focus-visible:ring-offset-umber-900"
    >
      <BlogCover
        url={post.cover_image_url ?? null}
        alt={copy.title}
        slug={post.slug}
        category={category}
      />
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
          {category}
        </p>
        <h2
          lang={shown}
          className="mt-2 font-grotesk text-xl leading-[1.15] text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300 sm:text-[1.4rem]"
        >
          {copy.title}
        </h2>
        <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-ink-500 dark:text-umber-300">
          <time dateTime={post.published_at}>{formatDate(post.published_at, locale)}</time>
          <span aria-hidden>·</span>
          <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
        </div>
      </div>
    </Link>
  );
}

function formatDate(iso: string, locale: BlogLocale): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
