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

  return (
    <PublicShell>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
        {/* Eyebrow */}
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
          {t("about.page_title")}
        </p>

        {/* Mission statement — leads the page */}
        <blockquote
          lang={locale}
          className="mt-8 font-cormorant text-2xl italic leading-snug text-ink-900 dark:text-paper-50 sm:text-3xl sm:leading-snug"
        >
          {t("about.paragraph_why")}
        </blockquote>

        {/* Founder card */}
        <div className="mt-12 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-10">
          {/* Sketch portrait */}
          <div className="flex-shrink-0">
            {!photoMissing ? (
              <img
                src="/about-andor.png"
                alt={t("about.photo_alt")}
                onError={() => setPhotoMissing(true)}
                className="h-40 w-40 rounded-2xl object-cover object-top sm:h-48 sm:w-48"
              />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded-2xl bg-paper-200 dark:bg-umber-700 sm:h-48 sm:w-48">
                <span className="select-none font-grotesk text-5xl font-semibold text-paper-400 dark:text-umber-500">
                  AC
                </span>
              </div>
            )}
          </div>

          <div className="flex-1">
            <p className="font-grotesk text-xl font-semibold text-ink-900 dark:text-paper-50">
              {t("about.founder_first_name")}
            </p>
            <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
              {t("about.founder_placeholder")} · {t("about.founder_role")}
            </p>
            <p
              lang={locale}
              className="mt-5 text-base leading-loose text-ink-800 dark:text-paper-100 sm:text-lg sm:leading-loose [hyphens:auto] [text-wrap:pretty]"
            >
              {t("about.paragraph_made_in")}
            </p>
          </div>
        </div>

        {/* Principles */}
        <section className="mt-14 space-y-6">
          <h2 className="font-grotesk text-xl font-semibold text-ink-900 dark:text-paper-50 sm:text-2xl">
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
          <h2 className="font-grotesk text-xl font-semibold text-ink-900 dark:text-paper-50 sm:text-2xl">
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

        {/* Back */}
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
