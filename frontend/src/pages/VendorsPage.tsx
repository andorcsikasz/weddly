import { ArrowLeft, Mail } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PhaseAftermathArt, PhaseGuestsArt, PhaseSuppliersArt } from "../components/illustrations";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
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

function WaitlistContact() {
  const { t } = useT();
  const subject = encodeURIComponent(t("vendors.contact_subject"));
  const href = `mailto:hello@weddly.hu?subject=${subject}`;

  return (
    <div className="card">
      <h2 className="font-serif text-3xl text-ink-900 sm:text-4xl">{t("vendors.contact_title")}</h2>
      <p className="mt-2 text-sm text-ink-600">{t("vendors.contact_body")}</p>
      <a
        href={href}
        className="btn-primary btn-lg mt-8 inline-flex w-full justify-center sm:w-auto"
      >
        <Mail size={16} />
        {t("vendors.contact_cta")}
      </a>
    </div>
  );
}
