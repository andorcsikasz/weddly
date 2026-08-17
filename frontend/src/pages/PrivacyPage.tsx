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
  // English is shown first; the toggle swaps the whole document to the other language in place.
  const [showEn, setShowEn] = useState(true);
  const L = showEn ? en : hu;
  useDocumentMeta("privacy.seo_title", "privacy.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={L.privacy.page_title}
          updatedLabel={L.privacy.last_updated_label}
          updatedDate={L.privacy.last_updated_date}
          version={PRIVACY_VERSION}
          versionLabel={L.legal.version_label}
          action={<LegalLanguageToggle showEn={showEn} onToggle={() => setShowEn((v) => !v)} />}
        />
        <PrivacyBodyForLocale strings={L.privacy} sectionLocale={showEn ? "en" : "hu"} />
        <BackLink />
      </article>
    </PublicShell>
  );
}

/**
 * Language switch on the legal pages. The label is the language you switch TO
 * (showing English → "HU"), so it advertises the other language rather than
 * the current one, and the swap happens in place.
 */
export function LegalLanguageToggle({
  showEn,
  onToggle,
}: {
  showEn: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-full border border-paper-300 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.28em] text-ink-500 transition-colors hover:border-ink-400 hover:text-ink-700 dark:border-umber-600 dark:text-umber-300 dark:hover:border-umber-400 dark:hover:text-paper-100"
    >
      {showEn ? "HU" : "EN"}
    </button>
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
  action,
}: {
  title: string;
  updatedLabel: string;
  updatedDate: string;
  version?: string;
  versionLabel?: string;
  action?: ReactNode;
}) {
  return (
    <header className="border-b border-paper-300 pb-8 dark:border-umber-700">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
          {updatedLabel}: {updatedDate}
          {version && versionLabel ? ` · ${versionLabel}: ${version}` : ""}
        </p>
        {action}
      </div>
      <h1 className="mt-3 font-grotesk text-4xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-5xl">
        {title}
      </h1>
    </header>
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

export function H2({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="mt-10 scroll-mt-24 font-grotesk text-2xl text-ink-900 dark:text-paper-50 sm:text-3xl"
    >
      {children}
    </h2>
  );
}

export function H3({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="mt-6 scroll-mt-24 font-grotesk text-lg font-semibold text-ink-800 dark:text-paper-100 sm:text-xl"
    >
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
        <li>{strings.data_categories_directory}</li>
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

      <H3 id="guest-camera">{strings.proc_guest_camera_title}</H3>
      <ProcBlock>
        <p>{strings.proc_guest_camera_data}</p>
        <p>{strings.proc_guest_camera_purpose}</p>
        <p>{strings.proc_guest_camera_basis}</p>
        <p>{strings.proc_guest_camera_retention}</p>
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

      <H3>{strings.proc_directory_title}</H3>
      <ProcBlock>
        <p>{strings.proc_directory_data}</p>
        <p>{strings.proc_directory_source}</p>
        <p>{strings.proc_directory_purpose}</p>
        <p>{strings.proc_directory_basis}</p>
        <p>{strings.proc_directory_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_outreach_title}</H3>
      <ProcBlock>
        <p>{strings.proc_outreach_data}</p>
        <p>{strings.proc_outreach_purpose}</p>
        <p>{strings.proc_outreach_basis}</p>
        <p>{strings.proc_outreach_retention}</p>
      </ProcBlock>

      <H3>{strings.proc_reviews_title}</H3>
      <ProcBlock>
        <p>{strings.proc_reviews_data}</p>
        <p>{strings.proc_reviews_purpose}</p>
        <p>{strings.proc_reviews_basis}</p>
        <p>{strings.proc_reviews_retention}</p>
      </ProcBlock>

      <H2>{strings.legal_bases_title}</H2>
      <p>{strings.legal_bases_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.legal_bases_contract}</li>
        <li>{strings.legal_bases_consent}</li>
        <li>{strings.legal_bases_legitimate_interest}</li>
        <li>{strings.legal_bases_legal_obligation}</li>
      </ul>

      <H2 id="guest-data">{strings.guest_data_title}</H2>
      <p>{strings.guest_data_body}</p>

      {/* The second Art. 14 case: businesses we listed from public sources.
          Anchored so the notice on an unclaimed listing page can link
          straight at it. Art. 14(5)(b) only works if the information is
          actually reachable from where the data is published. */}
      <H2 id="directory-listings">{strings.directory_listings_title}</H2>
      <p>{strings.directory_listings_intro}</p>
      <p>{strings.directory_listings_source}</p>
      <p>{strings.directory_listings_scope}</p>
      <p>{strings.directory_listings_basis}</p>
      <p>{strings.directory_listings_ip}</p>
      <p>{strings.directory_listings_art14}</p>
      <p>{strings.directory_listings_rights_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.directory_listings_rights_correction}</li>
        <li>{strings.directory_listings_rights_claim}</li>
        <li>{strings.directory_listings_rights_contact}</li>
        <li>{strings.directory_listings_rights_objection}</li>
      </ul>
      <p>{strings.directory_listings_decision}</p>

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
        <li>{strings.subprocessors_google}</li>
        <li>{strings.subprocessors_other}</li>
      </ul>

      {/* Google account data gets its own section rather than one more bullet
          above. Two reasons: it is the only subprocessor we hand a user's OWN
          account to (the others receive a query or an error trace), and the
          Limited Use paragraph is what Google's OAuth verification reads before
          it will let the calendar sync out of Testing mode. The policy link is
          left as a real anchor for the same reason. */}
      <H2>{strings.google_data_title}</H2>
      <p>{strings.google_data_body}</p>
      <ul className="ml-5 mt-3 list-disc space-y-2">
        <li>{strings.google_data_signin}</li>
        <li>{strings.google_data_calendar_write}</li>
        <li>{strings.google_data_calendar_read}</li>
        <li>{strings.google_data_control}</li>
      </ul>
      <p className="mt-3">
        {strings.google_data_limited_use}{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {strings.google_data_policy_link}
        </a>
      </p>

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
      <button
        type="button"
        className="mt-4 underline underline-offset-2"
        onClick={() =>
          (
            window as Window & {
              Cookiebot?: { renew: () => void };
            }
          ).Cookiebot?.renew()
        }
      >
        {strings.cookies_settings}
      </button>

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
