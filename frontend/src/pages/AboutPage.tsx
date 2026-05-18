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
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("about.page_title")}
          updatedLabel={t("about.last_updated_label")}
          updatedDate={t("about.last_updated_date")}
        />
        <section
          lang={locale}
          className="mt-12 space-y-10 text-base leading-loose text-ink-800 sm:text-lg sm:leading-loose"
        >
          <p>{madeIn}</p>
          <p>{t("about.paragraph_why")}</p>

          <div className="space-y-6 pt-4">
            <H2>{t("about.paragraph_principles_title")}</H2>
            <ul className="ml-5 list-disc space-y-4">
              <li>{t("about.principle_calm")}</li>
              <li>{t("about.principle_no_lock_in")}</li>
              <li>{t("about.principle_hungarian")}</li>
            </ul>
          </div>

          <div className="space-y-6 pt-4">
            <H2>{t("about.paragraph_contact_label")}</H2>
            <p>
              <a
                href={`mailto:${t("about.paragraph_contact_email")}`}
                className="btn-primary inline-block"
              >
                {t("about.paragraph_contact_cta")}
              </a>
            </p>
          </div>
        </section>
        <BackLink />
      </article>
    </PublicShell>
  );
}
