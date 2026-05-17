import { SUPPLIER_GROUPS, type SupplierCategory } from "@shared/suppliers";
import { ArrowLeft, Check, Info } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Link } from "react-router-dom";
import { PhaseAftermathArt, PhaseGuestsArt, PhaseSuppliersArt } from "../components/illustrations";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { vendorWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function VendorsPage() {
  const { t } = useT();
  useDocumentMeta("vendors.seo_title", "vendors.seo_description");

  return (
    <PublicShell>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-16 sm:px-6 sm:pt-20 sm:pb-20 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-blush-200 bg-blush-50 px-3 py-1 text-xs font-medium uppercase tracking-wider text-blush-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blush-500" />
            {t("vendors.pill")}
          </span>
          <h1 className="mt-5 font-serif text-4xl leading-[1.05] tracking-tight text-ink-900 sm:text-6xl">
            {t("vendors.hero_title")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-600 sm:text-lg lg:mx-0">
            {t("vendors.hero_sub")}
          </p>
          <div className="mt-9 flex justify-center lg:justify-start">
            <a href="#waitlist" className="btn-primary btn-lg shadow-sm">
              {t("vendors.contact_cta")}
            </a>
          </div>
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <VendorListingMockup className="h-auto w-full" />
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-paper-100/60">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-6 lg:grid-cols-3">
            <Benefit
              art={<PhaseSuppliersArt className="h-12 w-12" />}
              title={t("vendors.benefit_1_title")}
              body={t("vendors.benefit_1_body")}
            />
            <Benefit
              art={<PhaseGuestsArt className="h-12 w-12" />}
              title={t("vendors.benefit_2_title")}
              body={t("vendors.benefit_2_body")}
            />
            <Benefit
              art={<PhaseAftermathArt className="h-12 w-12" />}
              title={t("vendors.benefit_3_title")}
              body={t("vendors.benefit_3_body")}
            />
          </div>
        </div>
      </section>

      {/* Waitlist contact — mailto rather than a fake form so we don't promise
       *  storage we don't have. Wire to a real endpoint when one exists. */}
      <section id="waitlist" className="bg-paper-50">
        <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6 sm:py-24">
          <WaitlistContact />
        </div>
      </section>

      {/* Back to landing */}
      <section className="mx-auto max-w-2xl px-4 py-12 text-center sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          {t("vendors.back_to_landing")}
        </Link>
      </section>
    </PublicShell>
  );
}

function Benefit({
  art,
  title,
  body,
}: {
  art: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="card">
      <div className="mb-4">{art}</div>
      <h3 className="font-serif text-xl text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
    </article>
  );
}

function isLikelyEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function WaitlistContact() {
  const { t } = useT();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const consentId = useId();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    const name = businessName.trim();
    const emailTrim = email.trim();
    const loc = location.trim();
    const site = website.trim();
    const msg = message.trim();
    if (!name) return setErrorMsg(t("vendors.form_err_required"));
    if (!emailTrim || !isLikelyEmail(emailTrim)) {
      return setErrorMsg(t("vendors.form_err_email"));
    }
    if (!category) return setErrorMsg(t("vendors.form_err_category"));
    if (!privacyConsent) return setErrorMsg(t("vendors.form_err_privacy_consent"));

    setSubmitting(true);
    try {
      await vendorWaitlistApi.submit({
        business_name: name,
        email: emailTrim,
        category,
        location: loc ? loc : null,
        website: site ? site : null,
        message: msg ? msg : null,
      });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setErrorMsg(t("vendors.form_err_rate_limited"));
      } else if (err instanceof ApiError) {
        setErrorMsg(err.message);
      } else {
        setErrorMsg(t("common.error_generic"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="card text-center">
        <Check size={32} className="mx-auto text-blush-600" aria-hidden />
        <h2 className="mt-3 font-serif text-3xl text-ink-900 sm:text-4xl">
          {t("vendors.form_success_title")}
        </h2>
        <p className="mt-2 text-sm text-ink-600">{t("vendors.form_success_body")}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="font-serif text-3xl text-ink-900 sm:text-4xl">{t("vendors.contact_title")}</h2>
      {/* Beta + future-monetization disclosure — sets honest expectations
          before vendors submit. Pricing is not finalised, so we promise
          notice rather than a number. */}
      <div className="mt-5 flex items-start gap-3 rounded-lg border border-blush-200 bg-blush-50 p-4 text-sm text-ink-700 dark:border-blush-400/30 dark:bg-blush-400/10 dark:text-paper-100">
        <Info size={18} className="mt-0.5 shrink-0 text-blush-600" aria-hidden />
        <div className="flex-1">
          <p className="font-medium text-ink-900 dark:text-paper-50">
            {t("vendors.beta_notice_title")}
          </p>
          <p className="mt-1 leading-relaxed">{t("vendors.beta_notice_body")}</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="vendor-business" className="field-label">
            {t("vendors.form_business_label")}
          </label>
          <input
            id="vendor-business"
            className="input"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            maxLength={120}
            required
          />
        </div>
        <div>
          <label htmlFor="vendor-email" className="field-label">
            {t("vendors.form_email_label")}
          </label>
          <input
            id="vendor-email"
            type="email"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div>
          <label htmlFor="vendor-category" className="field-label">
            {t("vendors.form_category_label")}
          </label>
          <select
            id="vendor-category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as SupplierCategory | "")}
            required
          >
            <option value="" disabled>
              {t("vendors.form_category_placeholder")}
            </option>
            {SUPPLIER_GROUPS.map((g) => (
              <optgroup key={g.id} label={t(`suppliers.group.${g.id}`)}>
                {g.categories.map((c) => (
                  <option key={c} value={c}>
                    {t(`suppliers.cat.${c}`)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vendor-location" className="field-label">
            {t("vendors.form_location_label")}
          </label>
          <input
            id="vendor-location"
            className="input"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={500}
            placeholder={t("vendors.form_location_placeholder")}
          />
          <p className="field-help">{t("vendors.form_location_help")}</p>
        </div>
        <div>
          <label htmlFor="vendor-website" className="field-label">
            {t("vendors.form_website_label")}
          </label>
          <input
            id="vendor-website"
            className="input"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            maxLength={300}
            placeholder={t("vendors.form_website_placeholder")}
            inputMode="url"
            autoComplete="url"
          />
          <p className="field-help">{t("vendors.form_website_help")}</p>
        </div>
        <div>
          <label htmlFor="vendor-message" className="field-label">
            {t("vendors.form_message_label")}
          </label>
          <textarea
            id="vendor-message"
            className="input"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            placeholder={t("vendors.form_message_placeholder")}
          />
        </div>
        {/* GDPR consent — required. */}
        <label
          htmlFor={consentId}
          className="flex cursor-pointer items-start gap-2 rounded-md border border-paper-200 bg-paper-50 p-3 text-sm text-ink-700 transition-colors hover:border-blush-300 hover:bg-blush-50 dark:border-umber-700 dark:bg-umber-800/40 dark:text-paper-100 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/10"
        >
          <input
            id={consentId}
            type="checkbox"
            checked={privacyConsent}
            onChange={(e) => setPrivacyConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 cursor-pointer rounded border-paper-300 text-blush-600 focus:ring-blush-500 dark:border-umber-600"
            aria-required="true"
          />
          <span className="flex-1 leading-snug">
            {t("vendors.privacy_consent_prefix")}
            <Link to="/privacy" className="underline hover:text-ink-900" target="_blank" rel="noopener">
              {t("vendors.privacy_consent_link")}
            </Link>
            {t("vendors.privacy_consent_suffix")}
          </span>
        </label>
        {errorMsg && (
          <p className="text-sm text-blush-700" role="alert">
            {errorMsg}
          </p>
        )}
        <button
          type="submit"
          className="btn-primary btn-lg inline-flex w-full justify-center sm:w-auto"
          disabled={submitting || !privacyConsent}
        >
          {submitting ? t("vendors.form_submitting") : t("vendors.form_submit")}
        </button>
      </form>
    </div>
  );
}
