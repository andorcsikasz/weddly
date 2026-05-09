import {
  Calendar,
  ChevronDown,
  Heart,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Shell } from "../components/Shell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function LandingPage() {
  const { t } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");

  return (
    <Shell>
      <section className="mx-auto max-w-3xl py-12 text-center sm:py-20">
        <h1 className="font-serif text-4xl leading-tight tracking-tight sm:text-6xl">
          {t("landing.hero_title")}
        </h1>
        <p className="mt-6 text-base text-ink-600 sm:text-lg">{t("landing.hero_sub")}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/signup" className="btn-primary btn-lg w-full shadow-sm sm:w-auto">
            {t("landing.cta_signup")}
          </Link>
          <Link to="/login" className="btn-outline btn-lg w-full sm:w-auto">
            {t("landing.cta_login")}
          </Link>
        </div>
        <p className="mt-3 text-xs text-ink-500">{t("landing.cta_signup_sub")}</p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <FeatureCard
          icon={<Calendar size={20} />}
          title={t("landing.feature_planning_title")}
          body={t("landing.feature_planning_body")}
        />
        <FeatureCard
          icon={<Users size={20} />}
          title={t("landing.feature_guests_title")}
          body={t("landing.feature_guests_body")}
        />
        <FeatureCard
          icon={<Heart size={20} />}
          title={t("landing.feature_seating_title")}
          body={t("landing.feature_seating_body")}
        />
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        <TrustCard
          icon={<HeartHandshake size={20} />}
          title={t("landing.trust_couple_title")}
          body={t("landing.trust_couple_body")}
        />
        <TrustCard
          icon={<Sparkles size={20} />}
          title={t("landing.trust_free_title")}
          body={t("landing.trust_free_body")}
        />
        <TrustCard
          icon={<ShieldCheck size={20} />}
          title={t("landing.trust_data_title")}
          body={t("landing.trust_data_body")}
        />
      </section>

      <section className="mx-auto mt-16 max-w-2xl">
        <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">{t("landing.faq_title")}</h2>
        <div className="mt-6 divide-y divide-paper-300 border-y border-paper-300">
          <FaqItem question={t("landing.faq_q_free")} answer={t("landing.faq_a_free")} />
          <FaqItem question={t("landing.faq_q_partner")} answer={t("landing.faq_a_partner")} />
          <FaqItem question={t("landing.faq_q_data")} answer={t("landing.faq_a_data")} />
          <FaqItem question={t("landing.faq_q_planner")} answer={t("landing.faq_a_planner")} />
          <FaqItem question={t("landing.faq_q_ready")} answer={t("landing.faq_a_ready")} />
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-2xl pb-12 text-center sm:pb-20">
        <h2 className="font-serif text-3xl tracking-tight sm:text-4xl">
          {t("landing.closing_title")}
        </h2>
        <p className="mt-4 text-ink-600">{t("landing.closing_body")}</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/signup" className="btn-primary btn-lg w-full shadow-sm sm:w-auto">
            {t("landing.cta_signup")}
          </Link>
        </div>
        <p className="mt-3 text-xs text-ink-500">{t("landing.cta_signup_sub")}</p>
      </section>
    </Shell>
  );
}

function FeatureCard({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="card-hover">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-blush-100 text-blush-700">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 text-sm text-ink-600">{body}</p>
    </article>
  );
}

function TrustCard({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="rounded-xl bg-paper-50 p-5">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-paper-200 text-ink-800">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      <p className="mt-1 text-sm text-ink-600">{body}</p>
    </article>
  );
}

function FaqItem({ question, answer }: { question: string; answer: ReactNode }) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="text-base font-medium text-ink-900">{question}</span>
        <ChevronDown
          size={18}
          className="shrink-0 text-ink-500 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{answer}</p>
    </details>
  );
}
