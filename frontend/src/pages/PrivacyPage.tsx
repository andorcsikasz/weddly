import { PRIVACY_VERSION } from "@shared/legal";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";

export default function PrivacyPage() {
  const { t } = useT();
  const [showHu, setShowHu] = useState(false);
  useDocumentMeta("privacy.seo_title", "privacy.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("privacy.page_title")}
          updatedLabel={t("privacy.last_updated_label")}
          updatedDate={t("privacy.last_updated_date")}
          version={PRIVACY_VERSION}
          versionLabel={t("legal.version_label")}
        />
        <PrivacyBodyForLocale strings={en.privacy} sectionLocale="en" />
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={() => setShowHu((v) => !v)}
            className="inline-flex items-center gap-2 rounded-full border border-paper-300 px-5 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-700 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-400 dark:hover:text-paper-100"
          >
            {showHu ? "Hide Hungarian" : "Magyar változat"}
          </button>
        </div>
        {showHu && (
          <>
            <SecondaryLanguageDivider label="Magyar" />
            <PrivacyBodyForLocale strings={hu.privacy} sectionLocale="hu" secondary />
          </>
        )}
        <BackLink />
      </article>
    </PublicShell>
  );
}

/**
 * Reused by /terms and /about — small header with a centred title in
 * display serif and a quiet "Last updated: <date>" eyebrow.
 */
export function LegalHeader({
  title,
  updatedLabel,
  updatedDate,
  version,
  versionLabel,
}: {
  title: string;
  updatedLabel: string;
  updatedDate: string;
  /** Document version stamp (e.g. "2026-05-18") — rendered so a user can
   *  point at the exact policy text they accepted on signup. */
  version?: string;
  versionLabel?: string;
}) {
  return (
    <header className="border-b border-paper-300 pb-8 dark:border-umber-700">
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
        {updatedLabel}: {updatedDate}
        {version && versionLabel ? ` · ${versionLabel}: ${version}` : ""}
      </p>
      <h1 className="mt-3 font-grotesk text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl">
        {title}
      </h1>
    </header>
  );
}

/**
 * Divider between the HU section and the EN mirror. Matches the
 * editorial spine of the landing page.
 */
export function SecondaryLanguageDivider({ label }: { label: string }) {
  return (
    <div
      role="separator"
      className="my-12 flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.32em] text-ink-500 dark:text-umber-300"
    >
      <span aria-hidden className="h-px flex-1 bg-paper-300 dark:bg-umber-700" />
      <span>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-paper-300 dark:bg-umber-700" />
    </div>
  );
}

export function BackLink() {
  const { t } = useT();
  return (
    <p className="mt-16 text-sm">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
      >
        <ArrowLeft size={14} aria-hidden />
        {t("vendors.back_to_landing")}
      </Link>
    </p>
  );
}

export function LegalSection({
  children,
  sectionLocale,
  secondary,
}: {
  children: ReactNode;
  sectionLocale: "hu" | "en";
  secondary?: boolean;
}) {
  return (
    <section
      lang={sectionLocale}
      className={`mt-8 space-y-6 text-base leading-relaxed text-justify hyphens-auto ${
        secondary ? "text-ink-700 dark:text-paper-200" : "text-ink-800 dark:text-paper-100"
      }`}
    >
      {children}
    </section>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-10 font-grotesk text-2xl text-ink-900 dark:text-paper-50 sm:text-3xl">
      {children}
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 font-grotesk text-lg font-semibold text-ink-800 dark:text-paper-100 sm:text-xl">
      {children}
    </h3>
  );
}

function ProcBlock({ children }: { children: ReactNode }) {
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-paper-200 bg-paper-50 px-4 py-3 text-sm leading-relaxed dark:border-umber-700 dark:bg-umber-900/30">
      {children}
    </div>
  );
}

function PrivacyBodyForLocale({
  strings,
  sectionLocale,
  secondary,
}: {
  strings: typeof hu.privacy;
  sectionLocale: "hu" | "en";
  secondary?: boolean;
}) {
  return (
    <LegalSection sectionLocale={sectionLocale} secondary={secondary}>
      <p>{strings.intro}</p>

      <H2>{strings.controller_title}</H2>
      <p>{strings.controller_body}</p>

      <H2>{strings.definitions_title}</H2>
      <p>{strings.def_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.def_personal_data}</li>
        <li>{strings.def_data_subject}</li>
        <li>{strings.def_processing}</li>
        <li>{strings.def_processor}</li>
        <li>{strings.def_consent}</li>
      </ul>

      <H2>{strings.principles_title}</H2>
      <p>{strings.principles_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.principles_lawfulness}</li>
        <li>{strings.principles_purpose}</li>
        <li>{strings.principles_minimisation}</li>
        <li>{strings.principles_accuracy}</li>
        <li>{strings.principles_storage}</li>
        <li>{strings.principles_integrity}</li>
        <li>{strings.principles_accountability}</li>
      </ul>

      <H2>{strings.data_categories_title}</H2>
      <p>{strings.data_categories_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.data_categories_auth}</li>
        <li>{strings.data_categories_profile}</li>
        <li>{strings.data_categories_workspace}</li>
        <li>{strings.data_categories_analytics}</li>
      </ul>

      <H2>{strings.proc_activities_title}</H2>

      <H3>{strings.proc_tech_title}</H3>
      <ProcBlock>
        <p>{strings.proc_tech_data}</p>
        <p>{strings.proc_tech_purpose}</p>
        <p>{strings.proc_tech_basis}</p>
        <p>{strings.proc_tech_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_contact_title}</H3>
      <ProcBlock>
        <p>{strings.proc_contact_data}</p>
        <p>{strings.proc_contact_purpose}</p>
        <p>{strings.proc_contact_basis}</p>
        <p>{strings.proc_contact_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_account_title}</H3>
      <ProcBlock>
        <p>{strings.proc_account_data}</p>
        <p>{strings.proc_account_purpose}</p>
        <p>{strings.proc_account_basis}</p>
        <p>{strings.proc_account_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_workspace_title}</H3>
      <ProcBlock>
        <p>{strings.proc_workspace_data}</p>
        <p>{strings.proc_workspace_purpose}</p>
        <p>{strings.proc_workspace_basis}</p>
        <p>{strings.proc_workspace_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_newsletter_title}</H3>
      <ProcBlock>
        <p>{strings.proc_newsletter_data}</p>
        <p>{strings.proc_newsletter_purpose}</p>
        <p>{strings.proc_newsletter_basis}</p>
        <p>{strings.proc_newsletter_retention}</p>
        <p>{strings.proc_newsletter_unsubscribe}</p>
      </ProcBlock>

      <H3>{strings.proc_billing_title}</H3>
      <ProcBlock>
        <p>{strings.proc_billing_data}</p>
        <p>{strings.proc_billing_purpose}</p>
        <p>{strings.proc_billing_basis}</p>
        <p>{strings.proc_billing_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_supplier_title}</H3>
      <ProcBlock>
        <p>{strings.proc_supplier_data}</p>
        <p>{strings.proc_supplier_purpose}</p>
        <p>{strings.proc_supplier_basis}</p>
        <p>{strings.proc_supplier_retention}</p>
      </ProcBlock>

      <H2>{strings.legal_bases_title}</H2>
      <p>{strings.legal_bases_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.legal_bases_contract}</li>
        <li>{strings.legal_bases_consent}</li>
        <li>{strings.legal_bases_legitimate_interest}</li>
        <li>{strings.legal_bases_legal_obligation}</li>
      </ul>

      <H2>{strings.guest_data_title}</H2>
      <p>{strings.guest_data_body}</p>

      <H2>{strings.retention_title}</H2>
      <p>{strings.retention_body}</p>

      <H2>{strings.rights_title}</H2>
      <p>{strings.rights_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.rights_access}</li>
        <li>{strings.rights_rectification}</li>
        <li>{strings.rights_deletion}</li>
        <li>{strings.rights_portability}</li>
        <li>{strings.rights_objection}</li>
        <li>{strings.rights_restriction}</li>
        <li>{strings.rights_withdrawal}</li>
        <li>{strings.rights_contact}</li>
      </ul>

      <H2>{strings.security_title}</H2>
      <p>{strings.security_body}</p>

      <H2>{strings.children_title}</H2>
      <p>{strings.children_body}</p>

      <H2>{strings.transfers_title}</H2>
      <p>{strings.transfers_body}</p>

      <H2>{strings.subprocessors_title}</H2>
      <p>{strings.subprocessors_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.subprocessors_railway}</li>
        <li>{strings.subprocessors_resend}</li>
        <li>{strings.subprocessors_serpapi}</li>
        <li>{strings.subprocessors_osm}</li>
        <li>{strings.subprocessors_pinterest}</li>
        <li>{strings.subprocessors_sentry}</li>
      </ul>

      <H2>{strings.vendor_transfer_title}</H2>
      <p>{strings.vendor_transfer_body}</p>

      <H2>{strings.cookies_title}</H2>
      <p>{strings.cookies_intro}</p>
      <p className="mt-3 text-sm font-semibold text-ink-700 dark:text-paper-200">
        {strings.cookies_necessary_label}
      </p>
      <ul className="ml-5 list-disc space-y-2 font-mono text-sm">
        <li>{strings.cookies_session}</li>
      </ul>
      <p className="mt-3 text-sm font-semibold text-ink-700 dark:text-paper-200">
        {strings.cookies_functional_label}
      </p>
      <ul className="ml-5 list-disc space-y-2 font-mono text-sm">
        <li>{strings.cookies_locale}</li>
        <li>{strings.cookies_verify_dismiss}</li>
        <li>{strings.cookies_saved_suppliers}</li>
        <li>{strings.cookies_onboarding_draft}</li>
      </ul>

      <H2>{strings.third_parties_title}</H2>
      <p>{strings.third_parties_body}</p>

      <H2>{strings.email_compliance_title}</H2>
      <p>{strings.email_compliance_body}</p>

      <H2>{strings.automated_decisions_title}</H2>
      <p>{strings.automated_decisions_body}</p>

      <H2>{strings.complaint_authority_title}</H2>
      <p>{strings.complaint_authority_body}</p>

      <H2>{strings.changes_title}</H2>
      <p>{strings.changes_body}</p>

      <H2>{strings.contact_title}</H2>
      <p>{strings.contact_body}</p>
    </LegalSection>
  );
}
