import { ArrowRight, Check, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { MarketingPage } from "@shared/marketing_pages";
import { PublicShell } from "../components/PublicShell";
import { usePublicPageMeta } from "../lib/seo";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00Z`));
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
        </div>

        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
          <div className="max-w-3xl space-y-14">
            {page.sections.map((section) => (
              <section key={section.heading}>
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
              </section>
            ))}

            {page.steps && (
              <section>
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
              <section>
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
              <h2 className="font-grotesk text-2xl font-semibold tracking-tight sm:text-3xl">
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
