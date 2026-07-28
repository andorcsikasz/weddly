import { TERMS_VERSION } from "@shared/legal";
import { useState } from "react";
import { PublicShell } from "../components/PublicShell";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalLanguageToggle, LegalSection } from "./PrivacyPage";

export default function TermsPage() {
  // English is shown first; the toggle swaps the whole document to the other language in place.
  const [showEn, setShowEn] = useState(true);
  const L = showEn ? en : hu;
  useDocumentMeta("terms.seo_title", "terms.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={L.terms.page_title}
          updatedLabel={L.terms.last_updated_label}
          updatedDate={L.terms.last_updated_date}
          version={TERMS_VERSION}
          versionLabel={L.legal.version_label}
          action={<LegalLanguageToggle showEn={showEn} onToggle={() => setShowEn((v) => !v)} />}
        />
        <TermsBodyForLocale strings={L.terms} sectionLocale={showEn ? "en" : "hu"} />
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

      <H2>{strings.directory_listing_policy_title}</H2>
      <p>{strings.directory_listing_policy_body}</p>

      <H2>{strings.reviews_title}</H2>
      <p>{strings.reviews_body}</p>

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
