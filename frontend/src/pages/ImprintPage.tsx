import { useState } from "react";
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
  const { t, locale } = useT();
  const isHu = locale === "hu";
  const [showSecondary, setShowSecondary] = useState(false);
  useDocumentMeta("imprint.seo_title", "imprint.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("imprint.page_title")}
          updatedLabel={t("imprint.last_updated_label")}
          updatedDate={t("imprint.last_updated_date")}
          action={
            <button
              type="button"
              onClick={() => setShowSecondary((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full border border-paper-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-700 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-400 dark:hover:text-paper-100"
            >
              {showSecondary ? (isHu ? "Hide EN" : "Hide HU") : isHu ? "EN" : "HU"}
            </button>
          }
        />
        <ImprintBodyForLocale
          strings={isHu ? hu.imprint : en.imprint}
          sectionLocale={isHu ? "hu" : "en"}
        />
        {showSecondary && (
          <>
            <SecondaryLanguageDivider label={isHu ? "English" : "Magyar"} />
            <ImprintBodyForLocale
              strings={isHu ? en.imprint : hu.imprint}
              sectionLocale={isHu ? "en" : "hu"}
              secondary
            />
          </>
        )}
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
