import { COUPLE_SUBSCRIPTION_TERMS_VERSION } from "@shared/legal";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { PublicShell } from "../components/PublicShell";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalLanguageToggle, LegalSection } from "./PrivacyPage";

/**
 * /terms/couple-subscription: DRAFT billing terms for the couple
 * subscription. Not linked from the site footer/legal nav on purpose — only
 * reachable from the checkout acceptance checkbox and by direct URL — because
 * this content has not been legally reviewed and checkout refuses to bind
 * anyone to it (see COUPLE_TERMS_REVIEWED in backend domain/payment_launch.ts).
 */
export default function CoupleSubscriptionTermsPage() {
  const [showEn, setShowEn] = useState(true);
  const L = showEn ? en : hu;
  useDocumentMeta(
    "couple_subscription_terms.seo_title",
    "couple_subscription_terms.seo_description",
  );

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <DraftNotice text={L.couple_subscription_terms.draft_notice} />
        <LegalHeader
          title={L.couple_subscription_terms.page_title}
          updatedLabel={L.couple_subscription_terms.last_updated_label}
          updatedDate={L.couple_subscription_terms.last_updated_date}
          version={COUPLE_SUBSCRIPTION_TERMS_VERSION}
          versionLabel={L.legal.version_label}
          action={<LegalLanguageToggle showEn={showEn} onToggle={() => setShowEn((v) => !v)} />}
        />
        <CoupleBodyForLocale
          strings={L.couple_subscription_terms}
          sectionLocale={showEn ? "en" : "hu"}
        />
        <BackLink />
      </article>
    </PublicShell>
  );
}

function DraftNotice({ text }: { text: string }) {
  return (
    <div className="mb-8 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <p className="font-medium">{text}</p>
    </div>
  );
}

function CoupleBodyForLocale({
  strings,
  sectionLocale,
}: {
  strings: typeof hu.couple_subscription_terms;
  sectionLocale: "hu" | "en";
}) {
  return (
    <LegalSection sectionLocale={sectionLocale}>
      <p>{strings.intro}</p>

      <H2>{strings.operator_title}</H2>
      <p>{strings.operator_body}</p>

      <H2>{strings.scope_title}</H2>
      <p>{strings.scope_body}</p>

      <H2>{strings.acceptance_title}</H2>
      <p>{strings.acceptance_body}</p>

      <H2>{strings.billing_title}</H2>
      <p>{strings.billing_body}</p>

      <H2>{strings.vat_title}</H2>
      <p>{strings.vat_body}</p>

      <H2>{strings.term_title}</H2>
      <p>{strings.term_body}</p>

      <H2>{strings.refund_title}</H2>
      <p>{strings.refund_body}</p>

      {/* NEEDS LEGAL REVIEW: confirm whether the withdrawal right is waived by
       *  a couple requesting immediate service start, how that request/consent
       *  is captured in the checkout flow, and whether the reimbursement
       *  formula below (proportionate cost of the period already used) is the
       *  correct mechanic for a monthly SaaS subscription under Decree
       *  45/2014 §26/§29(1)(a). */}
      <H2>{strings.withdrawal_title}</H2>
      <p>{strings.withdrawal_body}</p>

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
