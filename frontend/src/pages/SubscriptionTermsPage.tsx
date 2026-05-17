import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import {
  BackLink,
  H2,
  LegalDraftBanner,
  LegalHeader,
  LegalSection,
  SecondaryLanguageDivider,
} from "./PrivacyPage";

/**
 * /terms/vendor-subscription — DRAFT vendor ÁSZF for the future paid
 * tier. Published before the beta ends so applicants can see exactly
 * what the paid model will look like; rendered with the same
 * `draft_banner` as Privacy / Terms until a Hungarian lawyer signs off.
 */
export default function SubscriptionTermsPage() {
  const { t } = useT();
  useDocumentMeta("subscription_terms.seo_title", "subscription_terms.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("subscription_terms.page_title")}
          updatedLabel={t("subscription_terms.last_updated_label")}
          updatedDate={t("subscription_terms.last_updated_date")}
        />
        <LegalDraftBanner />
        <SubscriptionBodyForLocale strings={hu.subscription_terms} sectionLocale="hu" />
        <SecondaryLanguageDivider label="English" />
        <SubscriptionBodyForLocale strings={en.subscription_terms} sectionLocale="en" secondary />
        <BackLink />
      </article>
    </PublicShell>
  );
}

function SubscriptionBodyForLocale({
  strings,
  sectionLocale,
  secondary,
}: {
  strings: typeof hu.subscription_terms;
  sectionLocale: "hu" | "en";
  secondary?: boolean;
}) {
  return (
    <LegalSection sectionLocale={sectionLocale} secondary={secondary}>
      <p>{strings.intro}</p>

      <H2>{strings.scope_title}</H2>
      <p>{strings.scope_body}</p>

      <H2>{strings.fees_title}</H2>
      <p>{strings.fees_body}</p>

      <H2>{strings.billing_title}</H2>
      <p>{strings.billing_body}</p>

      <H2>{strings.vat_title}</H2>
      <p>{strings.vat_body}</p>

      <H2>{strings.term_title}</H2>
      <p>{strings.term_body}</p>

      <H2>{strings.withdrawal_title}</H2>
      <p>{strings.withdrawal_body}</p>

      <H2>{strings.liability_title}</H2>
      <p>{strings.liability_body}</p>

      <H2>{strings.data_title}</H2>
      <p>{strings.data_body}</p>

      <H2>{strings.changes_title}</H2>
      <p>{strings.changes_body}</p>

      <H2>{strings.termination_title}</H2>
      <p>{strings.termination_body}</p>

      <H2>{strings.governing_law_title}</H2>
      <p>{strings.governing_law_body}</p>

      <H2>{strings.odr_title}</H2>
      <p>{strings.odr_body}</p>

      <H2>{strings.contact_title}</H2>
      <p>{strings.contact_body}</p>
    </LegalSection>
  );
}
