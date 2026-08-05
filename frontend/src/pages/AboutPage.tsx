import { ArrowLeft, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** /about: what Weddly is for, what it will not do, and how to reach a human.
 *  Deliberately NOT a founder page. It used to open on a portrait, a name and
 *  a "made in" paragraph, and that block is gone: the page answers a visitor's
 *  question about the product, and who built it is not that question. (The
 *  portrait was also a 2.2 MB PNG, which is how it came up.) */
export default function AboutPage() {
  const { t, locale } = useT();
  useDocumentMeta("about.seo_title", "about.seo_description");

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
