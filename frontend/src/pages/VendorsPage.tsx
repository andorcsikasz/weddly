import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import {
  PhaseAftermathArt,
  PhaseGuestsArt,
  PhaseSuppliersArt,
  VendorHeroArt,
} from "../components/illustrations";
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
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-12 pb-12 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-terracotta-200 bg-terracotta-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-terracotta-700">
            {t("vendors.pill")}
          </span>
          <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-ink-900 sm:text-6xl">
            {t("vendors.hero_title")}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-ink-600 sm:text-lg lg:mx-0">
            {t("vendors.hero_sub")}
          </p>
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <VendorHeroArt className="h-auto w-full" />
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 sm:pb-20">
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
      </section>

      {/* Waitlist form */}
      <section className="bg-white">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-20">
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
    <article className="rounded-3xl bg-chalk-50 p-6">
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
      <div className="rounded-3xl bg-terracotta-50 p-8 text-center ring-1 ring-terracotta-200">
        <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-terracotta-500 text-white">
          <CheckCircle2 size={22} />
        </div>
        <h2 className="mt-4 font-display text-3xl text-ink-900">
          {t("vendors.form_success_title")}
        </h2>
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
    <div>
      <h2 className="font-display text-3xl text-ink-900 sm:text-4xl">{t("vendors.form_title")}</h2>
      <p className="mt-2 text-sm text-ink-600">{t("vendors.form_sub")}</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
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
          className="btn-pill w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? t("vendors.form_submitting") : t("vendors.form_submit")}
        </button>
      </form>
    </div>
  );
}
