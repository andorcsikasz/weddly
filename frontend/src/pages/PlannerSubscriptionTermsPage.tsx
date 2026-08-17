import { PLANNER_SUBSCRIPTION_TERMS_VERSION } from "@shared/legal";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { PublicShell } from "../components/PublicShell";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";
import { BackLink, H2, LegalHeader, LegalLanguageToggle, LegalSection } from "./PrivacyPage";

/**
 * /terms/planner-subscription: DRAFT billing terms for the planner
 * subscription tiers. Not linked from the site footer/legal nav on purpose —
 * only reachable from the checkout acceptance checkbox and by direct URL —
 * because this content has not been legally reviewed and checkout refuses to
 * bind anyone to it (see PLANNER_TERMS_REVIEWED in backend
 * domain/payment_launch.ts).
 */
export default function PlannerSubscriptionTermsPage() {
  const [showEn, setShowEn] = useState(true);
  const L = showEn ? en : hu;
  useDocumentMeta(
    "planner_subscription_terms.seo_title",
    "planner_subscription_terms.seo_description",
  );

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <DraftNotice text={L.planner_subscription_terms.draft_notice} />
        <LegalHeader
          title={L.planner_subscription_terms.page_title}
          updatedLabel={L.planner_subscription_terms.last_updated_label}
          updatedDate={L.planner_subscription_terms.last_updated_date}
          version={PLANNER_SUBSCRIPTION_TERMS_VERSION}
          versionLabel={L.legal.version_label}
          action={<LegalLanguageToggle showEn={showEn} onToggle={() => setShowEn((v) => !v)} />}
        />
        <PlannerBodyForLocale
          strings={L.planner_subscription_terms}
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

function PlannerBodyForLocale({
  strings,
  sectionLocale,
}: {
  strings: typeof hu.planner_subscription_terms;
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

      {/* NEEDS LEGAL REVIEW: confirm B2B vs B2C consumer-protection treatment
       *  for sole-proprietor / freelance planners — the draft below tries to
       *  cover both (a B2B-style 14-day refund guarantee plus a fallback to
       *  the statutory consumer withdrawal right), mirroring how the vendor
       *  ÁSZF splits the same question, but which one actually applies to a
       *  given planner's registration status needs a real legal read. */}
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
