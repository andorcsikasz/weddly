import { VENDOR_TERMS_VERSION } from "@shared/legal";
import { useState } from "react";
import { PublicShell } from "../components/PublicShell";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalLanguageToggle, LegalSection } from "./PrivacyPage";

/**
 * /terms/vendor-subscription: versioned vendor ÁSZF.
 * Click-acceptance binding terms covering free Beta tier and future paid
 * plans (P2B Regulation 2019/1150, DSA, Hungarian consumer law).
 * English is shown by default; the Hungarian text is available via a toggle.
 */
export default function SubscriptionTermsPage() {
  // English is shown first; the toggle swaps the whole document to the other language in place.
  const [showEn, setShowEn] = useState(true);
  const L = showEn ? en : hu;
  useDocumentMeta("subscription_terms.seo_title", "subscription_terms.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={L.subscription_terms.page_title}
          updatedLabel={L.subscription_terms.last_updated_label}
          updatedDate={L.subscription_terms.last_updated_date}
          version={VENDOR_TERMS_VERSION}
          versionLabel={L.legal.version_label}
          action={<LegalLanguageToggle showEn={showEn} onToggle={() => setShowEn((v) => !v)} />}
        />
        <SubscriptionBodyForLocale
          strings={L.subscription_terms}
          sectionLocale={showEn ? "en" : "hu"}
        />
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

      <H2>{strings.operator_title}</H2>
      <p>{strings.operator_body}</p>

      <H2>{strings.scope_title}</H2>
      <p>{strings.scope_body}</p>

      <H2>{strings.acceptance_title}</H2>
      <p>{strings.acceptance_body}</p>

      <H2>{strings.unclaimed_title}</H2>
      <p>{strings.unclaimed_body}</p>

      <H2>{strings.ratings_title}</H2>
      <p>{strings.ratings_body}</p>

      <H2>{strings.fees_title}</H2>
      <p>{strings.fees_body}</p>

      <H2>{strings.billing_title}</H2>
      <p>{strings.billing_body}</p>

      <H2>{strings.vat_title}</H2>
      <p>{strings.vat_body}</p>

      <H2>{strings.term_title}</H2>
      <p>{strings.term_body}</p>

      <H2>{strings.refund_title}</H2>
      <p>{strings.refund_body}</p>

      <H2>{strings.withdrawal_title}</H2>
      <p>{strings.withdrawal_body}</p>

      <H2>{strings.sla_title}</H2>
      <p>{strings.sla_body}</p>

      <H2>{strings.ranking_title}</H2>
      <p>{strings.ranking_body}</p>

      <H2>{strings.differential_title}</H2>
      <p>{strings.differential_body}</p>

      <H2>{strings.data_access_title}</H2>
      <p>{strings.data_access_body}</p>

      <H2>{strings.ip_title}</H2>
      <p>{strings.ip_body}</p>

      <H2>{strings.indemnification_title}</H2>
      <p>{strings.indemnification_body}</p>

      <H2>{strings.moderation_title}</H2>
      <p>{strings.moderation_body}</p>

      <H2>{strings.liability_title}</H2>
      <p>{strings.liability_body}</p>

      <H2>{strings.data_title}</H2>
      <p>{strings.data_body}</p>

      <H2>{strings.complaints_title}</H2>
      <p>{strings.complaints_body}</p>

      <H2>{strings.mediation_title}</H2>
      <p>{strings.mediation_body}</p>

      <H2>{strings.force_majeure_title}</H2>
      <p>{strings.force_majeure_body}</p>

      <H2>{strings.assignment_title}</H2>
      <p>{strings.assignment_body}</p>

      <H2>{strings.changes_title}</H2>
      <p>{strings.changes_body}</p>

      <H2>{strings.termination_title}</H2>
      <p>{strings.termination_body}</p>

      <H2>{strings.offboarding_title}</H2>
      <p>{strings.offboarding_body}</p>

      <H2>{strings.transitional_title}</H2>
      <p>{strings.transitional_body}</p>

      <H2>{strings.governing_law_title}</H2>
      <p>{strings.governing_law_body}</p>

      <H2>{strings.odr_title}</H2>
      <p>{strings.odr_body}</p>

      <H2>{strings.contact_title}</H2>
      <p>{strings.contact_body}</p>
    </LegalSection>
  );
}
