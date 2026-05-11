import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import en from "../locales/en";
import hu from "../locales/hu";
import { useDocumentMeta } from "../lib/seo";

/**
 * /privacy — MVP-quality privacy policy. Renders both the HU and EN
 * versions on one page (HU first to match the rest of the product),
 * regardless of the active locale, so anyone landing here can read the
 * policy in whichever language they prefer without flipping a toggle.
 *
 * Real legal review is deferred to v2; the copy here is honest and
 * accurate based on what the codebase actually does today.
 */
export default function PrivacyPage() {
  const { t } = useT();
  useDocumentMeta("privacy.seo_title", "privacy.seo_description");

  return (
    <PublicShell>
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
        <LegalHeader
          title={t("privacy.page_title")}
          updatedLabel={t("privacy.last_updated_label")}
          updatedDate={t("privacy.last_updated_date")}
        />
        <PrivacyBodyForLocale strings={hu.privacy} sectionLocale="hu" />
        <SecondaryLanguageDivider label="English" />
        <PrivacyBodyForLocale strings={en.privacy} sectionLocale="en" secondary />
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
}: {
  title: string;
  updatedLabel: string;
  updatedDate: string;
}) {
  return (
    <header className="border-b border-paper-300 pb-8">
      <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700">
        {updatedLabel}: {updatedDate}
      </p>
      <h1 className="mt-3 font-serif text-4xl leading-[1.05] text-ink-900 sm:text-5xl">{title}</h1>
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
      className="my-12 flex items-center gap-4 text-xs font-semibold uppercase tracking-[0.32em] text-ink-500"
    >
      <span aria-hidden className="h-px flex-1 bg-paper-300" />
      <span>{label}</span>
      <span aria-hidden className="h-px flex-1 bg-paper-300" />
    </div>
  );
}

export function BackLink() {
  const { t } = useT();
  return (
    <p className="mt-16 text-sm">
      <Link to="/" className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink-900">
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
      className={`mt-8 space-y-6 text-base leading-relaxed ${
        secondary ? "text-ink-700" : "text-ink-800"
      }`}
    >
      {children}
    </section>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-10 font-serif text-2xl text-ink-900 sm:text-3xl">{children}</h2>;
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

      <H2>{strings.data_categories_title}</H2>
      <p>{strings.data_categories_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.data_categories_auth}</li>
        <li>{strings.data_categories_profile}</li>
        <li>{strings.data_categories_workspace}</li>
        <li>{strings.data_categories_analytics}</li>
      </ul>

      <H2>{strings.retention_title}</H2>
      <p>{strings.retention_body}</p>

      <H2>{strings.rights_title}</H2>
      <p>{strings.rights_intro}</p>
      <ul className="ml-5 list-disc space-y-2">
        <li>{strings.rights_access}</li>
        <li>{strings.rights_deletion}</li>
        <li>{strings.rights_portability}</li>
        <li>{strings.rights_contact}</li>
      </ul>

      <H2>{strings.cookies_title}</H2>
      <p>{strings.cookies_intro}</p>
      <ul className="ml-5 list-disc space-y-2 font-mono text-sm">
        <li>{strings.cookies_locale}</li>
        <li>{strings.cookies_verify_dismiss}</li>
        <li>{strings.cookies_session}</li>
        <li>{strings.cookies_saved_suppliers}</li>
        <li>{strings.cookies_onboarding_draft}</li>
      </ul>

      <H2>{strings.third_parties_title}</H2>
      <p>{strings.third_parties_body}</p>

      <H2>{strings.changes_title}</H2>
      <p>{strings.changes_body}</p>

      <H2>{strings.contact_title}</H2>
      <p>{strings.contact_body}</p>
    </LegalSection>
  );
}
