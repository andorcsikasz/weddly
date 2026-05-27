import { ArrowLeft, Image as ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { blogApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import type { BlogPost } from "@shared/blog_posts";

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
      <article className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <header className="border-b border-paper-300 dark:border-umber-700 pb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("blog.eyebrow")}
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl lg:text-6xl">
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
  locale: "hu" | "en";
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const copy = post[locale];
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:border-umber-700 dark:bg-umber-800 dark:focus-visible:ring-offset-umber-900"
    >
      <BlogCover url={post.cover_image_url ?? null} alt={copy.title} />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
          {post.category[locale]}
        </p>
        <h2 className="mt-3 font-serif text-2xl leading-[1.15] text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300 sm:text-[1.6rem]">
          {copy.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{copy.lead}</p>
        <div className="mt-auto flex items-center gap-3 pt-5 text-xs text-ink-500 dark:text-umber-300">
          <time dateTime={post.published_at}>{formatDate(post.published_at, locale)}</time>
          <span aria-hidden>·</span>
          <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
        </div>
      </div>
    </Link>
  );
}

export function BlogCover({ url, alt }: { url: string | null; alt: string }) {
  if (url) {
    return (
      <div className="aspect-[16/10] w-full overflow-hidden bg-paper-200 dark:bg-umber-700">
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-paper-200 to-paper-300 text-paper-400 dark:from-umber-700 dark:to-umber-800 dark:text-umber-600">
      <ImageIcon size={28} strokeWidth={1.5} aria-hidden />
    </div>
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
