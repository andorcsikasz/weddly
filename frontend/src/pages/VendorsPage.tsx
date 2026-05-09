import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { PhaseAftermathArt, PhaseGuestsArt, PhaseSuppliersArt } from "../components/illustrations";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { TextField } from "../components/ui/TextField";
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
              {t("vendors.form_submit")}
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

      {/* Waitlist form */}
      <section id="waitlist" className="bg-paper-50">
        <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6 sm:py-24">
          <WaitlistForm />
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

function WaitlistForm() {
  const { t } = useT();
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  if (submitted) {
    return (
      <div className="rounded-2xl border border-blush-200 bg-blush-50 p-8 text-center">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-blush-500 text-white">
          <CheckCircle2 size={22} />
        </div>
        <h2 className="mt-4 font-serif text-3xl text-ink-900">{t("vendors.form_success_title")}</h2>
        <p className="mt-2 text-base text-ink-700">{t("vendors.form_success_body")}</p>
      </div>
    );
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitted(true);
      setSubmitting(false);
    }, 400);
  }

  return (
    <div className="card">
      <h2 className="font-serif text-3xl text-ink-900 sm:text-4xl">{t("vendors.form_title")}</h2>
      <p className="mt-2 text-sm text-ink-600">{t("vendors.form_sub")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <TextField
          id="vendor-business"
          label={t("vendors.form_business_label")}
          value={business}
          onChange={(e) => setBusiness(e.target.value)}
          required
          autoComplete="organization"
        />
        <TextField
          id="vendor-email"
          label={t("vendors.form_email_label")}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <TextField
          id="vendor-category"
          label={t("vendors.form_category_label")}
          placeholder={t("vendors.form_category_placeholder")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
        />
        <button
          type="submit"
          disabled={submitting}
          className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t("vendors.form_submitting") : t("vendors.form_submit")}
        </button>
      </form>
    </div>
  );
}
