import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader } from "./PrivacyPage";

/**
 * /about — who built Weddly, why, and how to reach them. Renders only
 * the active locale (HU or EN) — unlike the legal pages, this one is
 * personal copy, not a dual-language legal document.
 */
export default function AboutPage() {
  const { t, locale } = useT();
  useDocumentMeta("about.seo_title", "about.seo_description");

  const madeIn = t("about.paragraph_made_in").replace("{founder}", t("about.founder_placeholder"));

  return (
    <PublicShell>
      <article className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("about.page_title")}
          updatedLabel={t("about.last_updated_label")}
          updatedDate={t("about.last_updated_date")}
        />
        <section
          lang={locale}
          className="mt-14 space-y-10 text-ink-800 dark:text-paper-100 [hyphens:auto] [text-wrap:pretty]"
        >
          <p className="text-lg leading-relaxed sm:text-xl sm:leading-relaxed">{madeIn}</p>
          <p className="text-base leading-loose sm:text-lg sm:leading-loose">
            {t("about.paragraph_why")}
          </p>

          <div className="space-y-6 pt-6">
            <H2>{t("about.paragraph_principles_title")}</H2>
            <ul className="space-y-5 text-base leading-loose sm:text-lg sm:leading-loose">
              {[t("about.principle_calm"), t("about.principle_no_lock_in")].map((principle) => (
                <li
                  key={principle}
                  className="border-l-2 border-paper-300 pl-4 dark:border-umber-700"
                >
                  {principle}
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-5 pt-6">
            <H2>{t("about.paragraph_contact_label")}</H2>
            <a
              href={`mailto:${t("about.paragraph_contact_email")}`}
              className="btn-primary inline-block"
            >
              {t("about.paragraph_contact_cta")}
            </a>
          </div>
        </section>
        <BackLink />
      </article>
    </PublicShell>
  );
}
