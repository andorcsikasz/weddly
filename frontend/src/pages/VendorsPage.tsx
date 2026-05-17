import { PRIVACY_VERSION, VENDOR_BETA_NOTICE_VERSION } from "@shared/legal";
import { SUPPLIER_GROUPS, type SupplierCategory, type SupplierGroup } from "@shared/suppliers";
import {
  ArrowLeft,
  AtSign,
  Briefcase,
  Check,
  Image as ImageIcon,
  Info,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  Sparkles,
  Tag,
  Trash2,
} from "lucide-react";
import { type FormEvent, type ReactNode, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PhaseAftermathArt, PhaseGuestsArt, PhaseSuppliersArt } from "../components/illustrations";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { ApiError } from "../lib/api";
import { vendorWaitlistApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

const MAX_PORTFOLIO_LINKS = 6;
const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Maps each supplier category to its parent group so the portfolio block
 *  can swap hint copy as the category dropdown changes. Built once from
 *  SUPPLIER_GROUPS — the source of truth for which categories belong where. */
const CATEGORY_TO_GROUP: Record<SupplierCategory, SupplierGroup> = (() => {
  const out = {} as Record<SupplierCategory, SupplierGroup>;
  for (const g of SUPPLIER_GROUPS) {
    for (const c of g.categories) out[c] = g.id;
  }
  return out;
})();

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

      {/* Waitlist contact — real backend submission with category-aware
       *  portfolio block. The wider container vs. before is intentional:
       *  the redesigned form uses a 2-col layout on lg+ for short fields. */}
      <section id="waitlist" className="bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
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

/** One portfolio URL row in the dynamic list. The parent owns the array
 *  and passes both the value and the slot index — re-keying on the URL
 *  string would lose input focus on every keystroke. */
function PortfolioLinkRow({
  index,
  value,
  onChange,
  onRemove,
  removable,
  placeholder,
  removeLabel,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  onRemove: () => void;
  removable: boolean;
  placeholder: string;
  removeLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Link2
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
          aria-hidden
        />
        <input
          id={`vendor-portfolio-${index}`}
          type="url"
          className="input pl-9"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          inputMode="url"
          autoComplete="off"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        aria-label={removeLabel}
        title={removeLabel}
        className="inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-lg border border-paper-300 bg-paper-50 text-ink-500 transition-colors hover:border-blush-300 hover:bg-blush-50 hover:text-blush-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/10 dark:hover:text-blush-200"
      >
        <Trash2 size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Numbered section header — round step badge + serif title + subtitle.
 *  Renders inline so the form scans like a three-step flow without forcing
 *  the user to click "Next". */
function SectionHeader({
  step,
  icon,
  title,
  sub,
}: {
  step: number;
  icon: ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <header className="flex items-start gap-3">
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-900 text-paper-100 text-sm font-medium dark:bg-paper-100 dark:text-umber-900"
        aria-hidden
      >
        {step}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 font-serif text-xl text-ink-900 dark:text-paper-50">
          <span className="text-blush-600 dark:text-blush-300" aria-hidden>
            {icon}
          </span>
          {title}
        </h3>
        <p className="mt-1 text-sm text-ink-600 dark:text-umber-200">{sub}</p>
      </div>
    </header>
  );
}

function OptionalPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-paper-300 bg-paper-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-500 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300">
      {label}
    </span>
  );
}

function WaitlistContact() {
  const { t } = useT();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<SupplierCategory | "">("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [message, setMessage] = useState("");
  const [instagram, setInstagram] = useState("");
  // Start with one empty row so the field is visually present rather than
  // hidden behind the "+ Add link" CTA — vendors should see we want it.
  const [portfolioLinks, setPortfolioLinks] = useState<string[]>([""]);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const consentId = useId();

  // Category drives the portfolio-section hint copy. SUPPLIER_GROUPS is the
  // source of truth for the mapping (see CATEGORY_TO_GROUP at top of file).
  const portfolioHintKey = useMemo<string>(() => {
    if (!category) return "vendors.portfolio_hint_default";
    return `vendors.portfolio_hint_${CATEGORY_TO_GROUP[category]}`;
  }, [category]);

  function updatePortfolioLink(idx: number, next: string) {
    setPortfolioLinks((cur) => cur.map((v, i) => (i === idx ? next : v)));
  }

  function removePortfolioLink(idx: number) {
    setPortfolioLinks((cur) => {
      if (cur.length <= 1) return [""];
      return cur.filter((_, i) => i !== idx);
    });
  }

  function addPortfolioLink() {
    setPortfolioLinks((cur) => (cur.length >= MAX_PORTFOLIO_LINKS ? cur : [...cur, ""]));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setErrorMsg(null);

    const name = businessName.trim();
    const emailTrim = email.trim();
    const loc = location.trim();
    const site = website.trim();
    const msg = message.trim();
    const ig = instagram.trim().replace(/^@+/, "");
    if (!name) return setErrorMsg(t("vendors.form_err_required"));
    if (!emailTrim || !isLikelyEmail(emailTrim)) {
      return setErrorMsg(t("vendors.form_err_email"));
    }
    if (!category) return setErrorMsg(t("vendors.form_err_category"));
    if (ig && !INSTAGRAM_HANDLE_RE.test(ig)) {
      return setErrorMsg(t("vendors.form_err_instagram_handle"));
    }
    // Client-side, only check non-empty rows. Empty slots are tolerated —
    // they're the placeholder we render. Backend re-validates regardless.
    const trimmedLinks = portfolioLinks.map((l) => l.trim()).filter((l) => l.length > 0);
    for (const link of trimmedLinks) {
      const candidate =
        link.startsWith("http://") || link.startsWith("https://") ? link : `https://${link}`;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
        if (!parsed.hostname) throw new Error();
      } catch {
        return setErrorMsg(t("vendors.form_err_portfolio_link"));
      }
    }
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
        portfolio_links: trimmedLinks,
        instagram_handle: ig ? ig : null,
        privacy_version: PRIVACY_VERSION,
        vendor_beta_notice_version: VENDOR_BETA_NOTICE_VERSION,
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
      <div className="card relative overflow-hidden text-center">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full bg-blush-200/40 blur-3xl dark:bg-blush-400/15"
        />
        <div className="relative">
          <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/20 dark:text-blush-300">
            <Check size={28} aria-hidden />
          </span>
          <h2 className="mt-4 font-serif text-3xl text-ink-900 dark:text-paper-50 sm:text-4xl">
            {t("vendors.form_success_title")}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-600 dark:text-umber-200">
            {t("vendors.form_success_body")}
          </p>
        </div>
      </div>
    );
  }

  const portfolioFilled = portfolioLinks.filter((l) => l.trim().length > 0).length;
  const portfolioAddDisabled = portfolioLinks.length >= MAX_PORTFOLIO_LINKS;

  return (
    <div className="relative">
      {/* Decorative blush blob behind the card — gives the form some hero
          weight without leaning on an illustration. Hidden in dark mode
          where the soft glow muddies the umber background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-blush-200/40 blur-3xl dark:hidden"
      />
      <div className="relative rounded-3xl border border-paper-300 bg-white p-6 shadow-soft sm:p-10 dark:border-umber-700 dark:bg-umber-800 dark:shadow-none">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700 dark:bg-blush-400/15 dark:text-blush-200">
            <Sparkles size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-3xl text-ink-900 dark:text-paper-50 sm:text-4xl">
              {t("vendors.contact_title")}
            </h2>
            <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">{t("vendors.form_sub")}</p>
          </div>
        </div>

        {/* Beta + future-monetization disclosure. */}
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-blush-200 bg-blush-50 p-4 text-sm text-ink-700 dark:border-blush-400/30 dark:bg-blush-400/10 dark:text-paper-100">
          <Info
            size={18}
            className="mt-0.5 shrink-0 text-blush-600 dark:text-blush-300"
            aria-hidden
          />
          <div className="flex-1">
            <p className="font-medium text-ink-900 dark:text-paper-50">
              {t("vendors.beta_notice_title")}
            </p>
            <p className="mt-1 leading-relaxed">{t("vendors.beta_notice_body")}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-8 space-y-10">
          {/* ── Section 1: business identity ─────────────────────────── */}
          <section className="space-y-5">
            <SectionHeader
              step={1}
              icon={<Briefcase size={16} />}
              title={t("vendors.section_business_title")}
              sub={t("vendors.section_business_sub")}
            />
            <div className="space-y-4">
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
                  autoComplete="organization"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="vendor-category"
                  className="field-label inline-flex items-center gap-1.5"
                >
                  <Tag size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
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
            </div>
          </section>

          {/* ── Section 2: contact + region ──────────────────────────── */}
          <section className="space-y-5">
            <SectionHeader
              step={2}
              icon={<Mail size={16} />}
              title={t("vendors.section_contact_title")}
              sub={t("vendors.section_contact_sub")}
            />
            <div className="space-y-4">
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
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="vendor-location"
                  className="field-label inline-flex items-center gap-1.5"
                >
                  <MapPin size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                  {t("vendors.form_location_label")}
                  <OptionalPill label={t("vendors.optional_pill")} />
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
            </div>
          </section>

          {/* ── Section 3: portfolio (category-aware) ────────────────── */}
          <section className="space-y-5">
            <SectionHeader
              step={3}
              icon={<ImageIcon size={16} />}
              title={t("vendors.section_portfolio_title")}
              sub={t("vendors.section_portfolio_sub")}
            />

            {/* Category-aware hint banner — copy comes from
                `vendors.portfolio_hint_<group>` and swaps as the category
                dropdown changes. */}
            <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4 text-sm leading-relaxed text-ink-700 dark:border-umber-700 dark:bg-umber-900/60 dark:text-paper-100">
              <p className="flex items-start gap-2">
                <Sparkles
                  size={14}
                  className="mt-0.5 shrink-0 text-blush-600 dark:text-blush-300"
                  aria-hidden
                />
                <span>{t(portfolioHintKey)}</span>
              </p>
            </div>

            <div>
              <label
                htmlFor="vendor-website"
                className="field-label inline-flex items-center gap-1.5"
              >
                {t("vendors.form_website_label")}
                <OptionalPill label={t("vendors.optional_pill")} />
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
              <label
                htmlFor="vendor-instagram"
                className="field-label inline-flex items-center gap-1.5"
              >
                <AtSign size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                {t("vendors.instagram_label")}
                <OptionalPill label={t("vendors.optional_pill")} />
              </label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                  aria-hidden
                >
                  @
                </span>
                <input
                  id="vendor-instagram"
                  className="input pl-7"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  maxLength={31}
                  placeholder={t("vendors.instagram_placeholder")}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <p className="field-help">{t("vendors.instagram_help")}</p>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="field-label mb-0 inline-flex items-center gap-1.5">
                  <Link2 size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                  {t("vendors.portfolio_links_label")}
                  <OptionalPill label={t("vendors.optional_pill")} />
                </span>
                <span className="text-xs tabular-nums text-ink-500 dark:text-umber-300">
                  {portfolioFilled}/{MAX_PORTFOLIO_LINKS}
                </span>
              </div>
              <div className="space-y-2">
                {portfolioLinks.map((value, idx) => (
                  <PortfolioLinkRow
                    key={idx}
                    index={idx}
                    value={value}
                    onChange={(next) => updatePortfolioLink(idx, next)}
                    onRemove={() => removePortfolioLink(idx)}
                    removable={portfolioLinks.length > 1 || value.length > 0}
                    placeholder={t("vendors.portfolio_links_placeholder")}
                    removeLabel={t("vendors.portfolio_link_remove")}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addPortfolioLink}
                  disabled={portfolioAddDisabled}
                  className="btn-ghost btn-sm inline-flex items-center gap-1"
                >
                  <Plus size={14} aria-hidden />
                  {t("vendors.portfolio_add_link")}
                </button>
                <p className="text-xs text-ink-500 dark:text-umber-300">
                  {t("vendors.portfolio_links_limit")}
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="vendor-message"
                className="field-label inline-flex items-center gap-1.5"
              >
                <MessageSquare size={11} aria-hidden className="text-ink-500 dark:text-umber-300" />
                {t("vendors.form_message_label")}
                <OptionalPill label={t("vendors.optional_pill")} />
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
          </section>

          {/* ── Consent + submit ─────────────────────────────────────── */}
          <div className="space-y-4 border-t border-paper-200 pt-6 dark:border-umber-700">
            <label
              htmlFor={consentId}
              className="flex cursor-pointer items-start gap-2 rounded-xl border border-paper-200 bg-paper-50 p-3 text-sm text-ink-700 transition-colors hover:border-blush-300 hover:bg-blush-50 dark:border-umber-700 dark:bg-umber-900/60 dark:text-paper-100 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/10"
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
                <Link
                  to="/privacy"
                  className="underline hover:text-ink-900"
                  target="_blank"
                  rel="noopener"
                >
                  {t("vendors.privacy_consent_link")}
                </Link>
                {t("vendors.privacy_consent_suffix")}
              </span>
            </label>
            {errorMsg && (
              <p className="text-sm text-blush-700 dark:text-blush-300" role="alert">
                {errorMsg}
              </p>
            )}
            <button
              type="submit"
              className="btn-primary btn-lg inline-flex w-full justify-center shadow-soft sm:w-auto"
              disabled={submitting || !privacyConsent}
            >
              {submitting ? t("vendors.form_submitting") : t("vendors.form_submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
