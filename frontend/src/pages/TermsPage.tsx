import { TERMS_VERSION } from "@shared/legal";
import { useState } from "react";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalSection, SecondaryLanguageDivider } from "./PrivacyPage";

export default function TermsPage() {
  const { t } = useT();
  const [showEn, setShowEn] = useState(false);
  useDocumentMeta("terms.seo_title", "terms.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("terms.page_title")}
          updatedLabel={t("terms.last_updated_label")}
          updatedDate={t("terms.last_updated_date")}
          version={TERMS_VERSION}
          versionLabel={t("legal.version_label")}
          action={
            <button
              type="button"
              onClick={() => setShowEn((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full border border-paper-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-700 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-400 dark:hover:text-paper-100"
            >
              {showEn ? "Hide HU" : "HU"}
            </button>
          }
        />
        <TermsBodyForLocale strings={en.terms} sectionLocale="en" />
        {showEn && (
          <>
            <SecondaryLanguageDivider label="Magyar" />
            <TermsBodyForLocale strings={hu.terms} sectionLocale="hu" secondary />
          </>
        )}
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

      <H2>{strings.acceptable_use_title}</H2>
      <p>{strings.acceptable_use_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.acceptable_use_prohibited_illegal}</li>
        <li>{strings.acceptable_use_prohibited_infringing}</li>
        <li>{strings.acceptable_use_prohibited_hateful}</li>
        <li>{strings.acceptable_use_prohibited_security}</li>
        <li>{strings.acceptable_use_prohibited_spam}</li>
      </ul>

      <H2>{strings.ugc_title}</H2>
      <p>{strings.ugc_license_body}</p>
      <p>{strings.ugc_warranty_body}</p>

      <H2>{strings.dsa_title}</H2>
      <p>{strings.dsa_body}</p>
      <p>{strings.dsa_contact}</p>

      <H2>{strings.directory_title}</H2>
      <p>{strings.directory_body}</p>

      <H2>{strings.liability_title}</H2>
      <p>{strings.liability_body}</p>

      <H2>{strings.termination_title}</H2>
      <p>{strings.termination_body}</p>

      <H2>{strings.changes_title}</H2>
      <p>{strings.changes_body}</p>

      <H2>{strings.law_title}</H2>
      <p>{strings.law_body}</p>

      <H2>{strings.contact_title}</H2>
      <p>{strings.contact_body}</p>
    </LegalSection>
  );
}
