import { PRIVACY_VERSION, VENDOR_BETA_NOTICE_VERSION } from "@shared/legal";
import { SUPPLIER_GROUPS, type SupplierCategory, type SupplierGroup } from "@shared/suppliers";
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Building2,
  Check,
  FileText,
  Globe,
  Image as ImageIcon,
  Info,
  Instagram,
  Link2,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
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
  const location = useLocation();

  // React Router doesn't natively scroll to a `#hash` after SPA navigation,
  // so deep links like `/vendors#waitlist` (from the landing's
  // "Kerüljetek a listára" CTA) land at the top of the page instead of the
  // form. We resolve the hash on mount + whenever it changes and scroll the
  // matching section into view. `scroll-mt-24` on the target absorbs the
  // sticky header so the headline isn't hidden under it.
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.slice(1);
    // requestAnimationFrame so the section has mounted before we measure.
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(raf);
  }, [location.hash]);

  return (
    <PublicShell>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-10 sm:px-6 sm:pt-20 sm:pb-14 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
        <div className="text-center lg:text-left">
          <h1 className="font-grotesk text-4xl leading-[1.05] tracking-tight text-ink-900 sm:text-6xl dark:text-paper-50">
            {t("vendors.hero_title")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-600 sm:text-lg lg:mx-0 dark:text-umber-200">
            {t("vendors.hero_sub")}
          </p>
          {/* Social proof trust signal */}
          <p className="mx-auto mt-4 flex items-center justify-center gap-1.5 text-sm text-ink-500 lg:justify-start dark:text-umber-300">
            <Check size={14} className="text-umber-600 dark:text-umber-400" aria-hidden />
            {t("vendors.trust_signal")}
          </p>
          <div className="mt-6 flex justify-center lg:justify-start">
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
      <section className="bg-paper-100/60 dark:bg-umber-900/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-6 lg:grid-cols-3 lg:items-stretch">
            <Benefit
              art={
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200/60 text-ink-800 dark:border-umber-600 dark:text-paper-100">
                  <Star size={17} strokeWidth={1.5} aria-hidden />
                </span>
              }
              title={t("vendors.benefit_1_title")}
              body={t("vendors.benefit_1_body")}
            />
            <Benefit
              art={
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200/60 text-ink-800 dark:border-umber-600 dark:text-paper-100">
                  <MapPin size={17} strokeWidth={1.5} aria-hidden />
                </span>
              }
              title={t("vendors.benefit_2_title")}
              body={t("vendors.benefit_2_body")}
            />
            <Benefit
              art={
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-200/60 text-ink-800 dark:border-umber-600 dark:text-paper-100">
                  <MessageSquare size={17} strokeWidth={1.5} aria-hidden />
                </span>
              }
              title={t("vendors.benefit_3_title")}
              body={t("vendors.benefit_3_body")}
            />
          </div>
        </div>
      </section>

      {/* Waitlist contact — real backend submission with category-aware
       *  portfolio block. The wider container vs. before is intentional:
       *  the redesigned form uses a 2-col layout on lg+ for short fields. */}
      <section id="waitlist" className="scroll-mt-24 bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
          <WaitlistContact />
        </div>
      </section>

      {/* Back to landing */}
      <section className="mx-auto max-w-2xl px-4 py-12 text-center sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
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
    <article className="card h-full !p-5">
      <div className="mb-3">{art}</div>
      <h3 className="font-grotesk text-xl text-ink-900 dark:text-paper-50">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{body}</p>
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
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          className="inline-flex h-tap w-tap shrink-0 items-center justify-center rounded-lg border border-paper-300 bg-paper-50 text-ink-500 transition-colors hover:border-blush-300 hover:bg-blush-50 hover:text-blush-700 dark:border-umber-700 dark:bg-umber-800 dark:text-umber-300 dark:hover:border-blush-400/40 dark:hover:bg-blush-400/10 dark:hover:text-blush-200"
        >
          <Trash2 size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Section header — eyebrow style. Small icon + uppercase tracked title +
 *  optional "opcionális" suffix. The previous serif h3 + subtitle pattern
 *  read "landing page", not "pro form"; this collapses each section marker
 *  to a single tight row that scans as structure, not as editorial copy. */
function SectionHeader({
  icon,
  title,
  optional,
  optionalLabel,
}: {
  icon: ReactNode;
  title: string;
  optional?: boolean;
  optionalLabel?: string;
}) {
  return (
    <header className="flex items-center gap-2 text-ink-700 dark:text-paper-100">
      <span className="text-blush-600 dark:text-blush-300" aria-hidden>
        {icon}
      </span>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em]">{title}</h3>
      {optional && optionalLabel && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-400 dark:text-umber-300">
          · {optionalLabel}
        </span>
      )}
    </header>
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
  const [priceList, setPriceList] = useState<File | null>(null);
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
    if (priceList && priceList.size > 10 * 1024 * 1024) {
      return setErrorMsg(t("vendors.form_err_price_list_size"));
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
        price_list: priceList,
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
          <h2 className="mt-4 font-grotesk text-3xl text-ink-900 dark:text-paper-50 sm:text-4xl">
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
          weight without leaning on an illustration. Smaller + tighter than
          before to keep focus on the form itself. Hidden in dark mode where
          the soft glow muddies the umber background. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -right-6 h-40 w-40 rounded-full bg-blush-200/35 blur-3xl dark:hidden"
      />
      <div className="relative rounded-3xl border border-paper-400 bg-white p-6 shadow-soft sm:p-8 dark:border-umber-700 dark:bg-umber-800 dark:shadow-none">
        {/* Compact form header — the round Sparkles badge + serif h2 felt
            duplicate next to the page hero. Now: tight serif title with
            mini Sparkles inline. Saves ~60px of vertical chrome. */}
        <div>
          <h2 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("vendors.contact_title")}
          </h2>
          <p className="mt-1.5 text-sm text-ink-600 dark:text-umber-200">{t("vendors.form_sub")}</p>
        </div>

        {/* Beta disclosure — single quiet line. */}
        <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-500 dark:text-umber-300">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {t("vendors.beta_notice_body")}{" "}
            <Link
              to="/terms/vendor-subscription"
              className="underline hover:text-ink-900 dark:hover:text-paper-50"
            >
              {t("vendors.beta_notice_terms_link")}
            </Link>
          </span>
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-5">
          {/* ── Section 1: business identity ─────────────────────────── */}
          <section className="space-y-3">
            <SectionHeader
              icon={<Briefcase size={12} />}
              title={t("vendors.section_business_title")}
            />
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-4">
              <div>
                <label htmlFor="vendor-business" className="field-label">
                  {t("vendors.form_business_label")}
                  <RequiredMark />
                </label>
                <div className="relative">
                  <Building2
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                    aria-hidden
                  />
                  <input
                    id="vendor-business"
                    className="input pl-9"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    maxLength={120}
                    autoComplete="organization"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="vendor-category" className="field-label">
                  {t("vendors.form_category_label")}
                  <RequiredMark />
                </label>
                <div className="relative">
                  <Tag
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                    aria-hidden
                  />
                  <select
                    id="vendor-category"
                    className="input pl-9"
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
            </div>
          </section>

          {/* ── Section 2: contact + region ──────────────────────────── */}
          <section className="space-y-3">
            <SectionHeader icon={<Mail size={12} />} title={t("vendors.section_contact_title")} />
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-4">
              <div>
                <label htmlFor="vendor-email" className="field-label">
                  {t("vendors.form_email_label")}
                  <RequiredMark />
                </label>
                <div className="relative">
                  <Mail
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                    aria-hidden
                  />
                  <input
                    id="vendor-email"
                    type="email"
                    className="input pl-9"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={200}
                    autoComplete="email"
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="vendor-location" className="field-label">
                  {t("vendors.form_location_label")}
                </label>
                <div className="relative">
                  <MapPin
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                    aria-hidden
                  />
                  <input
                    id="vendor-location"
                    className="input pl-9"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    maxLength={500}
                    placeholder={t("vendors.form_location_placeholder")}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ── Section 3: portfolio (category-aware) ────────────────── */}
          <section className="space-y-3">
            <SectionHeader
              icon={<ImageIcon size={12} />}
              title={t("vendors.section_portfolio_title")}
              optional
              optionalLabel={t("vendors.section_optional_label")}
            />

            {/* Category-aware hint — copy comes from
                `vendors.portfolio_hint_<group>` and swaps as the category
                dropdown changes. Quiet italic line, not a pill. */}
            <p className="text-xs italic leading-relaxed text-ink-500 dark:text-umber-300">
              {t(portfolioHintKey)}
            </p>

            <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-4">
              <div>
                <label htmlFor="vendor-website" className="field-label">
                  {t("vendors.form_website_label")}
                </label>
                <div className="relative">
                  <Globe
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                    aria-hidden
                  />
                  <input
                    id="vendor-website"
                    className="input pl-9"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    maxLength={300}
                    placeholder={t("vendors.form_website_placeholder")}
                    inputMode="url"
                    autoComplete="url"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="vendor-instagram" className="field-label">
                  {t("vendors.instagram_label")}
                </label>
                <div className="relative">
                  <Instagram
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-umber-300"
                    aria-hidden
                  />
                  <input
                    id="vendor-instagram"
                    className="input pl-9"
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    maxLength={31}
                    placeholder={t("vendors.instagram_placeholder")}
                    autoCapitalize="none"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="field-label mb-0">{t("vendors.portfolio_links_label")}</span>
                <span className="inline-flex items-baseline gap-2 text-xs text-ink-500 dark:text-umber-300">
                  <span className="hidden sm:inline">{t("vendors.portfolio_count_hint")}</span>
                  <span className="tabular-nums">
                    {portfolioFilled}/{MAX_PORTFOLIO_LINKS}
                  </span>
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
                    removable={portfolioLinks.length > 1}
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
              </div>
            </div>

            {/* Price list upload */}
            <div>
              <label className="field-label mb-1.5 block">
                {t("vendors.price_list_label")}
                <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-400 dark:text-umber-300">
                  · {t("vendors.section_optional_label")}
                </span>
              </label>
              <p className="mb-2 text-xs italic leading-relaxed text-ink-500 dark:text-umber-300">
                {t("vendors.price_list_hint")}
              </p>
              {priceList ? (
                <div className="flex items-center gap-2 rounded-lg border border-paper-300 bg-paper-50 px-3 py-2 dark:border-umber-700 dark:bg-umber-800">
                  <FileText size={16} className="shrink-0 text-ink-500 dark:text-umber-300" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-700 dark:text-paper-100">
                    {priceList.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPriceList(null)}
                    aria-label={t("vendors.price_list_remove")}
                    className="shrink-0 text-ink-400 hover:text-ink-700 dark:text-umber-300 dark:hover:text-paper-100"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              ) : (
                <label
                  htmlFor="vendor-price-list"
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-paper-400 bg-paper-50 px-3 py-3 text-sm text-ink-600 transition-colors hover:border-ink-400 hover:bg-paper-100 dark:border-umber-600 dark:bg-umber-800 dark:text-umber-200 dark:hover:border-umber-400"
                >
                  <FileText size={16} className="shrink-0" aria-hidden />
                  <span>{t("vendors.price_list_upload_cta")}</span>
                  <input
                    id="vendor-price-list"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setPriceList(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>

            <div>
              <label htmlFor="vendor-message" className="field-label">
                {t("vendors.form_message_label")}
              </label>
              <div className="relative">
                <MessageSquare
                  size={16}
                  className="pointer-events-none absolute left-3 top-3 text-ink-400 dark:text-umber-300"
                  aria-hidden
                />
                <textarea
                  id="vendor-message"
                  className="input pl-9"
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={1000}
                  placeholder={t("vendors.form_message_placeholder")}
                />
              </div>
            </div>
          </section>

          {/* ── Consent + submit footer ─────────────────────────────
              Pill background dropped — consent reads as a statement, not
              a "collectible UI element". Submit is right-aligned on sm+
              so the footer scans as a tight action row, not a column. */}
          <div className="border-t border-paper-300 pt-5 dark:border-umber-700">
            <label
              htmlFor={consentId}
              className="flex cursor-pointer items-start gap-2.5 text-xs leading-snug text-ink-600 dark:text-umber-200"
            >
              <input
                id={consentId}
                type="checkbox"
                checked={privacyConsent}
                onChange={(e) => setPrivacyConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-paper-400 text-blush-600 focus:ring-2 focus:ring-blush-300 dark:border-umber-600"
                aria-required="true"
              />
              <span className="flex-1">
                {t("vendors.privacy_consent_prefix")}
                <Link
                  to="/privacy"
                  className="underline underline-offset-2 hover:text-ink-900 dark:hover:text-paper-50"
                  target="_blank"
                  rel="noopener"
                >
                  {t("vendors.privacy_consent_link")}
                </Link>
                {t("vendors.privacy_consent_suffix")}
              </span>
            </label>
            {errorMsg && (
              <p
                className="mt-3 flex items-start gap-2 rounded-lg border border-blush-300 bg-blush-50 px-3 py-2 text-sm text-blush-700 dark:border-blush-400/40 dark:bg-blush-400/10 dark:text-blush-200"
                role="alert"
              >
                <AlertCircle size={16} aria-hidden className="mt-0.5 shrink-0" />
                <span>{errorMsg}</span>
              </p>
            )}
            <div className="mt-4">
              <button
                type="submit"
                className="btn-primary btn-lg w-full justify-center shadow-soft"
                disabled={submitting || !privacyConsent}
              >
                {submitting ? t("vendors.form_submitting") : t("vendors.form_submit")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Small blush asterisk for required labels — communicates "needed" at
 *  a glance without leaning on color alone (still semantic via `required`
 *  on the input). */
function RequiredMark() {
  return (
    <span className="ml-0.5 text-blush-500 dark:text-blush-300" aria-hidden>
      *
    </span>
  );
}
