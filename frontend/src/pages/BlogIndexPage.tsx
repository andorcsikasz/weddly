import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { listBlogPosts } from "@shared/blog_posts";

/**
 * /blog: magazine-style index of every published post. Posts come from
 * the static `BLOG_POSTS` array in shared/; when the editorial pipeline
 * lands this will swap for an MD or DB-backed feed without changing the
 * layout. Each card carries an eyebrow category, date, read-time and the
 * post lead so the visitor can scan the index without opening anything.
 */
export default function BlogIndexPage() {
  const { t, locale } = useT();
  useDocumentMeta("blog.index_seo_title", "blog.index_seo_description");
  const posts = listBlogPosts();

  return (
    <PublicShell>
      <article className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
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

        <ul className="mt-12 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:gap-x-10 lg:gap-y-16">
          {posts.map((post) => {
            const copy = post[locale];
            return (
              <li key={post.slug}>
                <Link
                  to={`/blog/${post.slug}`}
                  className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:focus-visible:ring-offset-umber-900"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                    {post.category[locale]}
                  </p>
                  <h2 className="mt-3 font-serif text-2xl leading-[1.15] text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300 sm:text-3xl">
                    {copy.title}
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200 sm:text-base">
                    {copy.lead}
                  </p>
                  <div className="mt-5 flex items-center gap-3 text-xs text-ink-500 dark:text-umber-300">
                    <time dateTime={post.published_at}>
                      {formatDate(post.published_at, locale)}
                    </time>
                    <span aria-hidden>·</span>
                    <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

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

function formatDate(iso: string, locale: "hu" | "en"): string {
  // ISO strings render without UTC drift through `Intl.DateTimeFormat` if
  // we hand it a Date built from the YYYY-MM-DD parts at midnight UTC.
  // Otherwise `new Date("2026-05-15")` is fine in modern Bun, but parts-
  // building is the safe-on-every-host pattern.
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
