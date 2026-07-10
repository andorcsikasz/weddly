// Public vendor marketing page. Pitches the vendor SaaS and routes into the
// self-serve signup at /vendors/signup. The old 4-step public waitlist form
// (admin-accept → emailed token activation) is retired — vendors now create an
// account directly and run the in-app onboarding wizard.

import { ArrowLeft, Check, Gem, MapPinned, PhoneCall } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { VendorDemoLaunchButton } from "../components/VendorDemoLaunchButton";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function VendorsPage() {
  const { t } = useT();
  useDocumentMeta("vendors.seo_title", "vendors.seo_description");

  return (
    <PublicShell>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-10 sm:px-6 sm:pt-20 sm:pb-14 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
        <div className="text-center lg:text-left">
          <p className="font-grotesk mb-3 text-xs font-semibold uppercase tracking-widest text-umber-500 dark:text-umber-400">
            {t("vendors.eyebrow")}
          </p>
          <h1 className="font-grotesk text-4xl leading-[1.05] tracking-tight text-ink-900 sm:text-6xl dark:text-paper-50">
            {t("vendors.hero_title")}
          </h1>
          <p className="mx-auto mt-4 flex items-center justify-center gap-1.5 text-sm text-ink-500 lg:justify-start dark:text-umber-300">
            <Check size={14} className="text-umber-600 dark:text-umber-400" aria-hidden />
            {t("vendors.trust_signal")}
          </p>
          <div className="mt-6 flex flex-col flex-wrap items-center gap-3 sm:flex-row lg:justify-start">
            <Link to="/vendors/signup" className="btn-primary btn-lg shadow-sm">
              {t("vendors.signup_cta")}
            </Link>
            <VendorDemoLaunchButton />
            <Link
              to="/login"
              className="text-sm font-medium text-ink-600 underline-offset-2 hover:underline dark:text-umber-200"
            >
              {t("vendors.have_account_cta")}
            </Link>
          </div>
          {/* Wrong-audience escape hatch — vendors shouldn't confuse themselves
              with couples or planners (audit item 12). */}
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm text-ink-500 lg:justify-start dark:text-umber-300">
            <span>
              {t("vendors.couple_escape")}{" "}
              <Link to="/signup" className="font-medium underline underline-offset-2">
                {t("vendors.couple_escape_link")}
              </Link>
            </span>
            <span>
              {t("vendors.planner_escape")}{" "}
              <Link to="/planners" className="font-medium underline underline-offset-2">
                {t("vendors.planner_escape_link")}
              </Link>
            </span>
          </div>
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <VendorListingMockup className="h-auto w-full" />
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-paper-100/60 dark:bg-umber-900/40">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
            <Benefit
              icon={<Gem size={26} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_1_title")}
              body={t("vendors.benefit_1_body")}
            />
            <Benefit
              icon={<MapPinned size={26} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_2_title")}
              body={t("vendors.benefit_2_body")}
            />
            <Benefit
              icon={<PhoneCall size={26} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_3_title")}
              body={t("vendors.benefit_3_body")}
            />
          </div>
        </div>
      </section>

      {/* Back to landing */}
      <section className="mx-auto max-w-2xl px-4 pb-12 text-center sm:px-6">
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

function Benefit({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <article className="card flex h-full flex-col !p-6">
      <span className="mb-4 inline-flex text-ink-900 dark:text-paper-50">{icon}</span>
      <h3 className="font-grotesk text-lg text-ink-900 dark:text-paper-50">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{body}</p>
    </article>
  );
}
