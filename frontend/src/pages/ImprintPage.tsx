import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalSection, SecondaryLanguageDivider } from "./PrivacyPage";

/**
 * /impresszum — Hungarian Ektv. (2001. évi CVIII. tv.) §4 imprint page.
 * Lists the operator's identity + contact + the hosting provider so
 * anyone using the service has the legal-entity details they're entitled
 * to. During the open beta the operator is a natural person; once we
 * register commercially (EV / Kft.) the entity row below is the only
 * line that needs to change.
 */
export default function ImprintPage() {
  const { t } = useT();
  useDocumentMeta("imprint.seo_title", "imprint.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("imprint.page_title")}
          updatedLabel={t("imprint.last_updated_label")}
          updatedDate={t("imprint.last_updated_date")}
        />
        <ImprintBodyForLocale strings={hu.imprint} sectionLocale="hu" />
        <SecondaryLanguageDivider label="English" />
        <ImprintBodyForLocale strings={en.imprint} sectionLocale="en" secondary />
        <BackLink />
      </article>
    </PublicShell>
  );
}

function ImprintBodyForLocale({
  strings,
  sectionLocale,
  secondary,
}: {
  strings: typeof hu.imprint;
  sectionLocale: "hu" | "en";
  secondary?: boolean;
}) {
  return (
    <LegalSection sectionLocale={sectionLocale} secondary={secondary}>
      <p>{strings.intro}</p>

      <H2>{strings.operator_title}</H2>
      <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="font-medium text-ink-900">{strings.operator_name_label}</dt>
        <dd>{strings.operator_name_value}</dd>
        <dt className="font-medium text-ink-900">{strings.operator_status_label}</dt>
        <dd>{strings.operator_status_value}</dd>
        <dt className="font-medium text-ink-900">{strings.operator_country_label}</dt>
        <dd>{strings.operator_country_value}</dd>
        <dt className="font-medium text-ink-900">{strings.operator_email_label}</dt>
        <dd>
          <a
            href={`mailto:${strings.operator_email_value}`}
            className="underline hover:text-ink-900"
          >
            {strings.operator_email_value}
          </a>
        </dd>
      </dl>

      <H2>{strings.controller_title}</H2>
      <p>{strings.controller_body}</p>

      <H2>{strings.hosting_title}</H2>
      <p>{strings.hosting_body}</p>

      <H2>{strings.complaints_title}</H2>
      <p>{strings.complaints_body}</p>
    </LegalSection>
  );
}
