import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalSection, SecondaryLanguageDivider } from "./PrivacyPage";

/**
 * /terms — short Terms of Service for the open beta. Intentionally
 * brief; full legal review lands with v2 alongside paid tiers.
 */
export default function TermsPage() {
  const { t } = useT();
  useDocumentMeta("terms.seo_title", "terms.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("terms.page_title")}
          updatedLabel={t("terms.last_updated_label")}
          updatedDate={t("terms.last_updated_date")}
        />
        <TermsBodyForLocale strings={hu.terms} sectionLocale="hu" />
        <SecondaryLanguageDivider label="English" />
        <TermsBodyForLocale strings={en.terms} sectionLocale="en" secondary />
        <BackLink />
      </article>
    </PublicShell>
  );
}

function TermsBodyForLocale({
  strings,
  sectionLocale,
  secondary,
}: {
  strings: typeof hu.terms;
  sectionLocale: "hu" | "en";
  secondary?: boolean;
}) {
  return (
    <LegalSection sectionLocale={sectionLocale} secondary={secondary}>
      <p>{strings.intro}</p>

      <H2>{strings.beta_title}</H2>
      <p>{strings.beta_body}</p>

      <H2>{strings.accuracy_title}</H2>
      <p>{strings.accuracy_body}</p>

      <H2>{strings.directory_title}</H2>
      <p>{strings.directory_body}</p>

      <H2>{strings.law_title}</H2>
      <p>{strings.law_body}</p>

      <H2>{strings.contact_title}</H2>
      <p>{strings.contact_body}</p>
    </LegalSection>
  );
}
