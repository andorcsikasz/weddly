import { ArrowLeft, CheckCircle2, Filter, Globe2, Sparkles } from "lucide-react";
import { type FormEvent, type JSX, useState } from "react";
import { Link } from "react-router-dom";
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
      <section className="mx-auto max-w-4xl px-4 pt-12 pb-12 text-center sm:px-6 sm:pt-20">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-terracotta-200 bg-terracotta-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-terracotta-700">
          {t("vendors.pill")}
        </span>
        <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-ink-900 sm:text-6xl">
          {t("vendors.hero_title")}
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-ink-600 sm:text-lg">
          {t("vendors.hero_sub")}
        </p>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 sm:pb-20">
        <div className="grid gap-5 lg:grid-cols-3">
          <Benefit
            icon={<Filter size={18} />}
            title={t("vendors.benefit_1_title")}
            body={t("vendors.benefit_1_body")}
          />
          <Benefit
            icon={<Globe2 size={18} />}
            title={t("vendors.benefit_2_title")}
            body={t("vendors.benefit_2_body")}
          />
          <Benefit
            icon={<Sparkles size={18} />}
            title={t("vendors.benefit_3_title")}
            body={t("vendors.benefit_3_body")}
          />
        </div>
      </section>

      {/* Waitlist form */}
      <section className="border-y border-chalk-200 bg-white">
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

function Benefit({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-chalk-200 bg-chalk-50 p-6">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-terracotta-100 text-terracotta-700">
        {icon}
      </div>
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
      <div className="rounded-2xl border border-terracotta-200 bg-terracotta-50 p-8 text-center">
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
    // FE-only: simulate a brief network call so the submit state is visible.
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
