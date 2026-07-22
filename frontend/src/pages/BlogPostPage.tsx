import { ArrowLeft } from "lucide-react";
import { intlLocale } from "../lib/format";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { NewsletterCapture } from "../components/NewsletterCapture";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { blogApi } from "../lib/endpoints";
import { contentLocale, useT } from "../lib/i18n";
import { useDocumentMetaLiteral } from "../lib/seo";
import type { BlogBlock, BlogPost } from "@shared/blog_posts";
import NotFoundPage from "./NotFoundPage";
import { BlogCover } from "./BlogIndexPage";

/** Hungarian + English Bible book name → biblia.hit.hu URL slug. The site
 *  uses the same slug set as their search engine (e.g. /bible/karoli/1CO/13
 *  for 1 Corinthians 13). Only the books we actually cite in seed content
 *  are listed; an unknown book just falls back to a non-linked label. */
const BIBLE_BOOK_SLUGS: Record<string, string> = {
  // Old Testament HU
  "1Mózes": "GEN",
  "2Mózes": "EXO",
  Ruth: "RUT",
  Zsoltárok: "PSA",
  Példabeszédek: "PRO",
  Prédikátor: "ECC",
  "Énekek éneke": "SNG",
  Malakiás: "MAL",
  // New Testament HU
  Máté: "MAT",
  Márk: "MAK",
  Lukács: "LUK",
  János: "JOH",
  Róma: "ROM",
  "1Korinthus": "1CO",
  "2Korinthus": "2CO",
  Galata: "GAL",
  Efézus: "EPH",
  Filippi: "PHP",
  Kolossé: "COL",
  "1Tessalonika": "1TH",
  "1Timótheus": "1TI",
  "1Péter": "1PE",
  "1János": "1JN",
  Jelenések: "REV",
  // English equivalents
  Genesis: "GEN",
  Exodus: "EXO",
  Psalms: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Solomon": "SNG",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MAK",
  Luke: "LUK",
  John: "JOH",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 John": "1JN",
  Revelation: "REV",
};

/** Parse a cite string like "1Korinthus 13,4-8" or "Matthew 19:4-6" and
 *  derive the biblia.hit.hu chapter URL. Returns null for citations whose
 *  book name isn't in the slug table or whose shape doesn't match. */
function citeToBibliaUrl(cite: string): string | null {
  const trimmed = cite.trim();
  // Match "<book name> <chapter><separator><rest>" where separator can be
  // space, comma or colon. Book name includes the leading number for
  // "1Korinthus", "1 John" style. We greedy-match the book up to the last
  // run of whitespace before the chapter digit.
  const m = trimmed.match(/^(.+?)\s+(\d+)(?:[,:].+)?$/);
  if (!m) return null;
  const book = m[1]?.trim();
  const chapter = m[2];
  if (!book || !chapter) return null;
  const slug = BIBLE_BOOK_SLUGS[book];
  if (!slug) return null;
  return `https://biblia.hit.hu/bible/karoli/${slug}/${chapter}`;
}

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
  // Long-form blog content is authored in HU/EN only; ES reads it in EN.
  const cLocale = contentLocale(locale);

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

  const copy = post?.[cLocale];
  useDocumentMetaLiteral(copy?.seo_title ?? "", copy?.seo_description ?? "");

  if (status === "not_found") return <NotFoundPage />;

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-5 py-12 sm:px-6 sm:py-20">
        {status === "loading" ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("blog.loading")}</p>
        ) : status === "error" || !post || !copy ? (
          <p className="text-sm text-ink-500 dark:text-umber-300">{t("blog.load_failed")}</p>
        ) : (
          <>
            <header className="border-b border-paper-300 dark:border-umber-700 pb-10">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
                {post.category[cLocale]}
              </p>
              <h1 className="mt-3 font-grotesk text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {copy.title}
              </h1>
              <p className="mt-5 text-base leading-relaxed text-ink-600 dark:text-umber-200 sm:text-lg">
                {copy.lead}
              </p>
              <div className="mt-6 flex items-center gap-3 text-xs text-ink-500 dark:text-umber-300">
                <time dateTime={post.published_at}>{formatDate(post.published_at, cLocale)}</time>
                <span aria-hidden>·</span>
                <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
              </div>
            </header>

            <figure className="mt-10 overflow-hidden rounded-2xl">
              <BlogCover
                url={post.cover_image_url ?? null}
                alt={copy.title}
                slug={post.slug}
                category={post.category[cLocale]}
              />
            </figure>

            <BlogBody body={copy.body} locale={cLocale} />

            <div className="mt-16">
              <NewsletterCapture source={`blog:${post.slug}`} />
            </div>

            {related.length > 0 ? (
              <aside className="mt-16 border-t border-paper-300 dark:border-umber-700 pt-10">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                  {t("blog.related_eyebrow")}
                </p>
                <ul className="mt-6 space-y-5">
                  {related.map((r) => {
                    const rc = r[cLocale];
                    return (
                      <li key={r.slug}>
                        <Link
                          to={`/blog/${locale === "en" ? (r.en_slug ?? r.slug) : r.slug}`}
                          className="group block focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:focus-visible:ring-offset-umber-900"
                        >
                          <p className="text-xs uppercase tracking-wider text-ink-500 dark:text-umber-300">
                            {r.category[cLocale]}
                          </p>
                          <h3 className="mt-1 font-grotesk text-xl text-ink-900 transition-colors group-hover:text-blush-700 dark:text-paper-50 dark:group-hover:text-blush-300 sm:text-2xl">
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

/** Recognises a list item that wraps a short Bible quote followed by its
 *  citation, e.g. `„Az Isten szeretet.", 1János 4,8`. The seed stores these
 *  as plain strings (legacy format from before the linked-cite feature);
 *  here we parse them at render time so the citation portion becomes a
 *  link to biblia.hit.hu. Non-verse list items fall through to plain text. */
const SHORT_VERSE_RE = /^„(.+?)["”],\s*(.+)$/;

function UlItem({ text }: { text: string }) {
  const m = SHORT_VERSE_RE.exec(text);
  if (!m || !m[1] || !m[2]) return <>{text}</>;
  const quote = m[1];
  const cite = m[2];
  const url = citeToBibliaUrl(cite);
  const content = (
    <>
      „{quote}” <span className="font-serif italic text-ink-500 dark:text-umber-300">{cite}</span>
    </>
  );
  if (!url) return content;
  // Whole item clickable: clicking the quote OR the citation opens the
  // biblia.hit.hu chapter in a new tab. Hover tints both halves blush so
  // the affordance is unambiguous.
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="group/verse transition-colors hover:text-blush-700 dark:hover:text-blush-300"
    >
      „{quote}”{" "}
      <span className="font-serif italic text-ink-500 transition-colors group-hover/verse:text-blush-700 dark:text-umber-300 dark:group-hover/verse:text-blush-300">
        {cite}
      </span>
    </a>
  );
}

/** Slugify an h3 heading into an anchor id. Lowercase + strip Hungarian
 *  diacritics + collapse anything non-alphanumeric to a hyphen, so e.g.
 *  "Énekek éneke 8,6-7" -> "enekek-eneke-8-6-7". Stable enough that the
 *  same h3 always produces the same id, which is what the prose links
 *  below depend on. */
function anchorId(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Book + chapter pattern shared by the section map and the prose linker.
 *  Matches "1Korinthus", "Énekek éneke", "Prédikátor" etc. The optional
 *  leading "12" handles "1Korinthus" / "2Korinthus" style prefixes. */
const BOOK_NAME = "[12]?[A-ZÉÁÍÓÖŐÚÜŰ][a-zéáíóöőúüű]+(?:\\s+[a-zéáíóöőúüű]+)*";

/** Full reference pattern: book + chapter, with optional verse spec like
 *  ",4-8" or ",16". Captures the book name (group 1) and chapter (group 2). */
const PROSE_REF_RE = new RegExp(`(${BOOK_NAME})\\s+(\\d+)(?:,\\d+(?:-\\d+)?)?`, "g");

interface SectionMap {
  /** Exact h3 text -> anchor id. Lets "Énekek éneke 2,16" in prose land
   *  precisely on the h3 with the same wording. */
  byExact: Map<string, string>;
  /** Book + chapter ("1Korinthus 13") -> anchor of the FIRST h3 starting
   *  with that prefix. Used as fallback when an exact match isn't found. */
  byBookChapter: Map<string, string>;
}

/** Walk the post body and collect h3 anchor ids keyed by both exact text
 *  and book+chapter prefix. Built once per post + locale; passed down to
 *  every Block so the paragraph renderer can resolve prose references. */
function buildSectionMap(blocks: BlogBlock[]): SectionMap {
  const byExact = new Map<string, string>();
  const byBookChapter = new Map<string, string>();
  const headRe = new RegExp(`^(${BOOK_NAME})\\s+(\\d+)`);
  for (const block of blocks) {
    if (block.type !== "h3") continue;
    const id = anchorId(block.text);
    byExact.set(block.text, id);
    const m = block.text.match(headRe);
    const book = m?.[1];
    const chapter = m?.[2];
    if (book && chapter) {
      const key = `${book.trim()} ${chapter}`;
      if (!byBookChapter.has(key)) byBookChapter.set(key, id);
    }
  }
  return { byExact, byBookChapter };
}

function resolveAnchor(ref: string, map: SectionMap): string | null {
  const exact = map.byExact.get(ref);
  if (exact) return exact;
  const m = ref.match(new RegExp(`^(${BOOK_NAME})\\s+(\\d+)`));
  const book = m?.[1];
  const chapter = m?.[2];
  if (!book || !chapter) return null;
  return map.byBookChapter.get(`${book.trim()} ${chapter}`) ?? null;
}

/** Render a paragraph, turning any in-text Bible reference (e.g.
 *  "1Korinthus 13,13", "Prédikátor 4") into an in-page anchor link to
 *  the matching h3 section. References without a matching section pass
 *  through as plain text. Visually distinct from the external biblia.hit.hu
 *  links: subtle underline + blush hover, no new-tab arrow. */
function ProseWithRefs({ text, sectionMap }: { text: string; sectionMap: SectionMap }) {
  if (sectionMap.byExact.size === 0 && sectionMap.byBookChapter.size === 0) {
    return <>{text}</>;
  }
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(PROSE_REF_RE)) {
    if (match.index === undefined) continue;
    const matchedText = match[0];
    const anchor = resolveAnchor(matchedText, sectionMap);
    if (!anchor) continue;
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(
      <a
        key={key++}
        href={`#${anchor}`}
        className="underline decoration-paper-400 decoration-1 underline-offset-2 transition-colors hover:text-blush-700 hover:decoration-blush-700 dark:decoration-umber-600 dark:hover:text-blush-300"
      >
        {matchedText}
      </a>,
    );
    lastIndex = match.index + matchedText.length;
  }
  if (nodes.length === 0) return <>{text}</>;
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return <>{nodes}</>;
}

/** Render the citation as a link to biblia.hit.hu if we can resolve the
 *  book + chapter; otherwise fall back to plain text. External link target
 *  + rel="noreferrer noopener" so the new tab doesn't share an opener with
 *  the blog page. */
function BibleCiteLink({ cite }: { cite: string }) {
  const url = citeToBibliaUrl(cite);
  if (!url) return <>{cite}</>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="hover:text-blush-700 dark:hover:text-blush-300"
    >
      {cite}
    </a>
  );
}

/** Wraps the body section + Block iteration. Builds the SectionMap once
 *  per post + locale so prose-to-anchor resolution doesn't recompute on
 *  every Block render. */
function BlogBody({ body, locale }: { body: BlogBlock[]; locale: "hu" | "en" }) {
  const sectionMap = useMemo(() => buildSectionMap(body), [body]);
  return (
    <section
      lang={locale}
      className="mt-12 space-y-5 text-base leading-loose text-ink-800 dark:text-paper-100 sm:text-lg [hyphens:auto] [text-wrap:pretty]"
    >
      {body.map((block, i) => (
        <Block key={i} block={block} sectionMap={sectionMap} />
      ))}
    </section>
  );
}

function Block({ block, sectionMap }: { block: BlogBlock; sectionMap: SectionMap }) {
  if (block.type === "p") {
    // text-justify on plain prose paragraphs gives the article a calm,
    // editorial block of type. Headings, list items, blockquotes and
    // CTA leads stay left-aligned (set on their own blocks below).
    return (
      <p className="text-justify">
        <ProseWithRefs text={block.text} sectionMap={sectionMap} />
      </p>
    );
  }
  if (block.type === "h2") {
    // Extra top margin so a section heading visually opens a new
    // chapter; the slightly larger mt-16 buys breathing room without
    // pushing the article into "outline" territory.
    return (
      <h2 className="!mt-16 !mb-3 font-grotesk text-2xl text-ink-900 dark:text-paper-50 sm:text-3xl">
        {block.text}
      </h2>
    );
  }
  if (block.type === "h3") {
    // `id` powers in-page anchor links from prose paragraphs. scroll-mt
    // gives the heading enough breathing room from the sticky public
    // header when jumped to via #anchor.
    return (
      <h3
        id={anchorId(block.text)}
        className="!mt-12 !mb-2 scroll-mt-24 font-grotesk text-xl text-ink-900 dark:text-paper-50 sm:text-2xl"
      >
        {block.text}
      </h3>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="!my-4 space-y-2 pl-5">
        {block.items.map((item, i) => (
          <li key={i} className="list-disc leading-relaxed">
            <UlItem text={item} />
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
      <figure className="!my-12 border-l-2 border-blush-400 pl-5 dark:border-blush-300 sm:pl-6">
        <blockquote className="space-y-3 font-serif italic leading-relaxed text-ink-800 dark:text-paper-100">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </blockquote>
        {block.cite ? (
          <figcaption className="mt-3 font-serif italic text-ink-500 dark:text-umber-300">
            <BibleCiteLink cite={block.cite} />
          </figcaption>
        ) : null}
      </figure>
    );
  }
  if (block.type === "img") {
    // Inline figure: full-bleed rounded image with an optional caption +
    // photographer credit. The credit links to the source page (Wikimedia
    // Commons) which both satisfies CC-BY attribution and adds an outbound
    // editorial link. Images are lazy-loaded so a long photo-heavy post
    // doesn't block first paint.
    return (
      <figure className="!my-10 overflow-hidden">
        <img
          src={block.src}
          alt={block.alt}
          loading="lazy"
          className="w-full rounded-2xl object-cover"
        />
        {block.caption || block.credit ? (
          <figcaption className="mt-3 text-sm text-ink-500 dark:text-umber-300">
            {block.caption ? (
              <span className="font-serif italic text-ink-600 dark:text-umber-200">
                {block.caption}
              </span>
            ) : null}
            {block.caption && block.credit ? <span className="px-1.5">·</span> : null}
            {block.credit ? (
              block.creditHref ? (
                <a
                  href={block.creditHref}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:text-blush-700 dark:hover:text-blush-300"
                >
                  {block.credit}
                </a>
              ) : (
                <span>{block.credit}</span>
              )
            ) : null}
          </figcaption>
        ) : null}
      </figure>
    );
  }
  // CTA: external links open in a new tab, internal /paths stay in-app.
  // The whole block reads as a quiet call-out card so it doesn't compete
  // with the rest of the body but is unmissable at end-of-article. The
  // button uses rounded-full + tighter transition so it feels softer and
  // more inviting than the boxy default `.btn` shape.
  const isExternal = /^https?:\/\//.test(block.href);
  return (
    <aside className="!my-14 rounded-2xl border border-paper-300 bg-paper-100/60 p-7 dark:border-umber-700 dark:bg-umber-800/60 sm:p-9">
      <p className="text-base leading-relaxed text-ink-700 dark:text-paper-100 sm:text-lg">
        {block.lead}
      </p>
      <a
        href={block.href}
        target={isExternal ? "_blank" : undefined}
        rel={isExternal ? "noreferrer" : undefined}
        className="btn-primary btn-lifted mt-6 inline-flex !rounded-full px-6 transition-all duration-200"
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
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
