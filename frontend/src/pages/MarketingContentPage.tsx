import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { MarketingImage, MarketingPage } from "@shared/marketing_pages";
import { PublicShell } from "../components/PublicShell";
import { usePublicPageMeta } from "../lib/seo";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
}

// Same turbulence-noise data URI the Media page uses for its ambient film
// grain (frontend/src/pages/MediaPage.tsx), scoped to a single photo card
// instead of the full viewport. `.film-grain`'s keyframe + the
// prefers-reduced-motion override live in index.css, so this only supplies
// the per-instance opacity/blend/size that keeps it subtle over a small card.
const GRAIN_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** Editorial photo card: warm-toned crop + a whisper of analog grain, so a
 *  hand-picked photograph reads as part of the same publication as the
 *  landing hero rather than a stock-photo drop-in. `variant="flush"` drops
 *  the border/radius for photos that already sit inside a bordered parent
 *  (the guide cards), so the two don't double up. */
function EditorialPhoto({
  image,
  aspectClassName,
  objectPosition = "top",
  priority = false,
  variant = "framed",
  className,
}: {
  image: MarketingImage;
  aspectClassName: string;
  objectPosition?: "top" | "center";
  priority?: boolean;
  variant?: "framed" | "flush";
  className?: string;
}) {
  return (
    <div
      className={[
        "relative overflow-hidden",
        variant === "framed"
          ? "rounded-2xl border border-paper-300 shadow-sm dark:border-umber-700"
          : "rounded-t-2xl",
        aspectClassName,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        src={image.url}
        alt={image.alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={`h-full w-full object-cover ${objectPosition === "top" ? "object-top" : "object-center"}`}
        style={{ filter: "saturate(1.08) brightness(0.98)" }}
      />
      <div
        className="film-grain pointer-events-none absolute -inset-1/2 z-10 h-[200%] w-[200%] select-none"
        aria-hidden="true"
        style={{
          backgroundImage: GRAIN_SVG,
          backgroundSize: "160px",
          opacity: 0.05,
          mixBlendMode: "overlay",
          animation: "analog-grain 0.4s steps(2) infinite",
        }}
      />
    </div>
  );
}

export default function MarketingContentPage({ page }: { page: MarketingPage }) {
  usePublicPageMeta(page.title, page.description, page.path);
  const isGuide = page.kind === "guide";

  return (
    <PublicShell>
      <article>
        <div className="border-b border-paper-300 bg-paper-100/60 dark:border-umber-700 dark:bg-umber-900">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
            <nav
              aria-label="Morzsanavigáció"
              className="mb-8 font-grotesk text-sm text-umber-600 dark:text-umber-300"
            >
              <ol className="flex flex-wrap items-center gap-1.5">
                <li>
                  <Link to="/" className="hover:text-umber-900 dark:hover:text-paper-50">
                    Főoldal
                  </Link>
                </li>
                <li aria-hidden="true">
                  <ChevronRight size={14} />
                </li>
                {isGuide && (
                  <>
                    <li>
                      <Link
                        to="/utmutato"
                        className="hover:text-umber-900 dark:hover:text-paper-50"
                      >
                        Útmutatók
                      </Link>
                    </li>
                    <li aria-hidden="true">
                      <ChevronRight size={14} />
                    </li>
                  </>
                )}
                <li aria-current="page" className="text-umber-900 dark:text-paper-100">
                  {page.eyebrow}
                </li>
              </ol>
            </nav>

            <div
              className={
                page.heroImage
                  ? "grid items-center gap-10 md:grid-cols-[1.15fr_0.85fr] md:gap-14"
                  : undefined
              }
            >
              <div>
                <p className="font-grotesk text-xs font-semibold uppercase tracking-[0.2em] text-umber-600 dark:text-umber-300">
                  {page.eyebrow}
                </p>
                <h1 className="mt-4 max-w-4xl font-grotesk text-4xl font-semibold leading-tight tracking-tight text-umber-950 sm:text-6xl dark:text-paper-50">
                  {page.h1}
                </h1>
                <p className="mt-6 max-w-3xl text-lg leading-relaxed text-umber-700 sm:text-xl dark:text-umber-200">
                  {page.intro}
                </p>
                {page.published && page.updated && (
                  <p className="mt-6 font-grotesk text-sm text-umber-600 dark:text-umber-300">
                    Közzétéve: <time dateTime={page.published}>{formatDate(page.published)}</time>
                    <span aria-hidden="true"> · </span>
                    Frissítve: <time dateTime={page.updated}>{formatDate(page.updated)}</time>
                  </p>
                )}
              </div>
              {page.heroImage && (
                <EditorialPhoto
                  image={page.heroImage}
                  aspectClassName="aspect-[4/3]"
                  objectPosition={page.heroImage.position}
                  priority
                />
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
          <div className="space-y-14">
            {page.sections.map((section, index) => (
              <section key={section.heading}>
                {section.image ? (
                  <div className="grid gap-8 md:grid-cols-2 md:items-center md:gap-12">
                    <div className={index % 2 === 1 ? "md:order-2" : ""}>
                      <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-950 sm:text-3xl dark:text-paper-50">
                        {section.heading}
                      </h2>
                      <div className="mt-5 space-y-4 text-base leading-8 text-umber-700 dark:text-umber-200">
                        {section.paragraphs.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </div>
                    </div>
                    <EditorialPhoto
                      image={section.image}
                      aspectClassName="aspect-[4/5]"
                      objectPosition={section.image.position}
                      className={index % 2 === 1 ? "md:order-1" : ""}
                    />
                  </div>
                ) : (
                  <div className="max-w-3xl">
                    <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-950 sm:text-3xl dark:text-paper-50">
                      {section.heading}
                    </h2>
                    <div className="mt-5 space-y-4 text-base leading-8 text-umber-700 dark:text-umber-200">
                      {section.paragraphs.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                    {section.bullets && (
                      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                        {section.bullets.map((bullet) => (
                          <li
                            key={bullet}
                            className="flex items-start gap-3 rounded-lg border border-paper-300 bg-paper-100/70 p-4 text-sm leading-6 text-umber-800 dark:border-umber-700 dark:bg-umber-800/40 dark:text-paper-100"
                          >
                            <Check
                              size={17}
                              aria-hidden="true"
                              className="mt-1 shrink-0 text-umber-500 dark:text-umber-300"
                            />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            ))}

            {page.guideCards && page.guideCards.length > 0 && (
              <section>
                <h2 className="max-w-3xl font-grotesk text-2xl font-semibold tracking-tight text-umber-950 sm:text-3xl dark:text-paper-50">
                  A három útmutató
                </h2>
                <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {page.guideCards.map((card) => (
                    <Link
                      key={card.href}
                      to={card.href}
                      className="group flex flex-col overflow-hidden rounded-2xl border border-paper-300 transition-colors hover:border-umber-400 dark:border-umber-700 dark:hover:border-umber-500"
                    >
                      <EditorialPhoto
                        image={card.image}
                        aspectClassName="aspect-[4/3]"
                        objectPosition={card.image.position ?? "center"}
                        variant="flush"
                      />
                      <div className="flex flex-1 flex-col gap-2 p-5">
                        <h3 className="font-grotesk text-lg font-semibold text-umber-950 dark:text-paper-50">
                          {card.label}
                        </h3>
                        <p className="text-sm leading-6 text-umber-700 dark:text-umber-200">
                          {card.description}
                        </p>
                        <span className="mt-auto inline-flex items-center gap-1.5 pt-2 font-grotesk text-sm font-medium text-umber-900 dark:text-paper-100">
                          Elolvasom
                          <ArrowRight
                            size={15}
                            aria-hidden="true"
                            className="transition-transform group-hover:translate-x-0.5"
                          />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {page.steps && (
              <section className="max-w-3xl">
                <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-950 sm:text-3xl dark:text-paper-50">
                  Így működik lépésről lépésre
                </h2>
                <ol className="mt-6 space-y-4">
                  {page.steps.map((step, index) => (
                    <li
                      key={step.title}
                      className="grid grid-cols-[2.5rem_1fr] gap-4 rounded-xl border border-paper-300 p-5 dark:border-umber-700"
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-umber-900 font-grotesk text-sm font-semibold text-paper-50 dark:bg-paper-100 dark:text-umber-950">
                        {index + 1}
                      </span>
                      <div>
                        <h3 className="font-grotesk text-lg font-semibold text-umber-950 dark:text-paper-50">
                          {step.title}
                        </h3>
                        <p className="mt-1 leading-7 text-umber-700 dark:text-umber-200">
                          {step.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {page.faqs && page.faqs.length > 0 && (
              <section className="max-w-3xl">
                <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-umber-950 sm:text-3xl dark:text-paper-50">
                  Gyakori kérdések
                </h2>
                <div className="mt-6 divide-y divide-paper-300 border-y border-paper-300 dark:divide-umber-700 dark:border-umber-700">
                  {page.faqs.map((faq) => (
                    <details key={faq.question} className="group py-4">
                      <summary className="cursor-pointer list-none pr-8 font-grotesk text-lg font-semibold text-umber-900 marker:hidden dark:text-paper-50">
                        {faq.question}
                      </summary>
                      <p className="mt-3 max-w-2xl leading-7 text-umber-700 dark:text-umber-200">
                        {faq.answer}
                      </p>
                    </details>
                  ))}
                </div>
              </section>
            )}
          </div>

          {page.cta && (
            <aside className="mt-16 rounded-2xl bg-umber-950 px-6 py-8 text-paper-50 sm:px-10 sm:py-10">
              <h2 className="font-grotesk text-2xl font-semibold tracking-tight text-paper-50 sm:text-3xl">
                {page.cta.title}
              </h2>
              <p className="mt-3 max-w-2xl leading-7 text-paper-200">{page.cta.body}</p>
              <Link
                to={page.cta.href}
                className="mt-6 inline-flex min-h-tap items-center gap-2 rounded-md bg-paper-50 px-5 py-3 font-grotesk text-sm font-semibold text-umber-950 transition-colors hover:bg-paper-200"
              >
                {page.cta.label}
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </aside>
          )}

          <nav
            aria-label="Kapcsolódó Weddly-oldalak"
            className="mt-14 border-t border-paper-300 pt-8 dark:border-umber-700"
          >
            <h2 className="font-grotesk text-xl font-semibold text-umber-950 dark:text-paper-50">
              Kapcsolódó oldalak
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {page.related.map((link) => (
                <li key={link.href}>
                  <Link
                    to={link.href}
                    className="group flex h-full items-center justify-between gap-3 rounded-lg border border-paper-300 p-4 font-grotesk text-sm font-medium text-umber-900 transition-colors hover:bg-paper-100 dark:border-umber-700 dark:text-paper-100 dark:hover:bg-umber-800"
                  >
                    {link.label}
                    <ArrowRight
                      size={16}
                      aria-hidden="true"
                      className="shrink-0 transition-transform group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </article>
    </PublicShell>
  );
}
