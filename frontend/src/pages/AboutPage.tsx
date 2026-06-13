import { useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function AboutPage() {
  const { t, locale } = useT();
  useDocumentMeta("about.seo_title", "about.seo_description");

  const [photoMissing, setPhotoMissing] = useState(false);

  const madeIn = t("about.paragraph_made_in").replace("{founder}", t("about.founder_placeholder"));

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">

        {/* Eyebrow */}
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
          {t("about.page_title")}
        </p>

        {/* Hero: name + photo side by side */}
        <div className="mt-6 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-12">
          <div className="flex-1">
            <h1 className="font-grotesk text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl">
              {t("about.founder_placeholder")}
            </h1>
            <p className="mt-2 text-xs font-medium uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
              {t("about.founder_role")}
            </p>
          </div>

          {/* Founder photo — drop /about-andor.jpg in frontend/public/ */}
          <div className="flex-shrink-0">
            {!photoMissing ? (
              <img
                src="/about-andor.jpg"
                alt={t("about.photo_alt")}
                onError={() => setPhotoMissing(true)}
                className="h-36 w-36 rounded-2xl object-cover object-top sm:h-48 sm:w-48"
              />
            ) : (
              <div className="flex h-36 w-36 items-center justify-center rounded-2xl bg-paper-200 dark:bg-umber-700 sm:h-48 sm:w-48">
                <span className="select-none font-grotesk text-4xl font-semibold text-paper-400 dark:text-umber-500 sm:text-5xl">
                  AC
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Story */}
        <section
          lang={locale}
          className="mt-12 space-y-6 text-ink-800 dark:text-paper-100 [hyphens:auto] [text-wrap:pretty]"
        >
          <p className="text-lg leading-relaxed sm:text-xl sm:leading-relaxed">{madeIn}</p>
          <p className="text-base leading-loose sm:text-lg sm:leading-loose">
            {t("about.paragraph_why")}
          </p>
        </section>

        {/* Principles */}
        <section className="mt-14 space-y-6">
          <h2 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50 sm:text-3xl">
            {t("about.paragraph_principles_title")}
          </h2>
          <ul className="space-y-5" lang={locale}>
            {[t("about.principle_calm"), t("about.principle_no_lock_in")].map((principle) => (
              <li
                key={principle}
                className="border-l-2 border-paper-300 pl-5 text-base leading-loose text-ink-800 dark:border-umber-700 dark:text-paper-100 sm:text-lg sm:leading-loose"
              >
                {principle}
              </li>
            ))}
          </ul>
        </section>

        {/* Contact */}
        <section className="mt-14 space-y-5">
          <h2 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50 sm:text-3xl">
            {t("about.paragraph_contact_label")}
          </h2>
          <a
            href={`mailto:${t("about.paragraph_contact_email")}`}
            className="btn-primary inline-flex"
          >
            <Mail size={16} aria-hidden />
            {t("about.paragraph_contact_cta")}
          </a>
        </section>

        {/* Back link */}
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
