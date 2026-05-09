import {
  Calendar,
  ChevronDown,
  HeartHandshake,
  PartyPopper,
  ShieldCheck,
  Sparkles,
  Store,
  Table2,
  Users,
} from "lucide-react";
import type { JSX, ReactNode } from "react";
import { Link } from "react-router-dom";
import { PublicShell, useGuestCodePrompt } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function LandingPage() {
  const { t } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");
  const askGuestCode = useGuestCodePrompt();

  return (
    <PublicShell>
      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pt-12 pb-16 text-center sm:px-6 sm:pt-20 sm:pb-24">
        <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-ink-900 sm:text-7xl">
          {t("landing.hero_title")}
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-600 sm:text-xl">
          {t("landing.hero_sub")}
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link to="/signup" className="btn-pill w-full sm:w-auto">
            {t("landing.cta_signup")}
          </Link>
          <Link to="/login" className="btn-square w-full sm:w-auto">
            {t("landing.cta_login")}
          </Link>
        </div>
        <p className="mt-3 text-xs text-ink-500">{t("landing.cta_signup_sub")}</p>
        <button
          type="button"
          onClick={() => {
            void askGuestCode();
          }}
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-600 underline decoration-chalk-400 underline-offset-4 hover:text-ink-900 hover:decoration-terracotta-500"
        >
          {t("landing.guest_link")}
        </button>
      </section>

      {/* Phases */}
      <section id="phases" className="border-y border-chalk-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="font-display text-3xl text-ink-900 sm:text-5xl">
            {t("landing.phases_title")}
          </h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <PhaseCard
              icon={<Calendar size={18} />}
              title={t("landing.phase_plan_title")}
              body={t("landing.phase_plan_body")}
            />
            <PhaseCard
              icon={<Store size={18} />}
              title={t("landing.phase_suppliers_title")}
              body={t("landing.phase_suppliers_body")}
            />
            <PhaseCard
              icon={<Users size={18} />}
              title={t("landing.phase_guests_title")}
              body={t("landing.phase_guests_body")}
            />
            <PhaseCard
              icon={<Table2 size={18} />}
              title={t("landing.phase_seating_title")}
              body={t("landing.phase_seating_body")}
            />
            <PhaseCard
              icon={<PartyPopper size={18} />}
              title={t("landing.phase_aftermath_title")}
              body={t("landing.phase_aftermath_body")}
            />
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl text-ink-900 sm:text-5xl">
            {t("landing.audience_title")}
          </h2>
          <p className="mt-4 text-base text-ink-600 sm:text-lg">{t("landing.audience_sub")}</p>
        </div>
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          <AudienceCard
            title={t("landing.card_couples_title")}
            body={t("landing.card_couples_body")}
            ctaLabel={t("landing.card_couples_cta")}
            to="/signup"
            tone="primary"
          />
          <AudienceCard
            title={t("landing.card_vendors_title")}
            body={t("landing.card_vendors_body")}
            ctaLabel={t("landing.card_vendors_cta")}
            to="/vendors"
          />
          <AudienceCard
            title={t("landing.card_guests_title")}
            body={t("landing.card_guests_body")}
            ctaLabel={t("landing.card_guests_cta")}
            onClick={() => {
              void askGuestCode();
            }}
          />
        </div>
      </section>

      {/* Suppliers section */}
      <section id="suppliers" className="border-y border-chalk-200 bg-chalk-100/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <h2 className="font-display text-3xl text-ink-900 sm:text-5xl">
              {t("landing.suppliers_section_title")}
            </h2>
            <p className="mt-4 max-w-xl text-base text-ink-600 sm:text-lg">
              {t("landing.suppliers_section_body")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className="btn-pill">
                {t("landing.suppliers_couple_cta")}
              </Link>
              <Link to="/vendors" className="btn-square">
                {t("landing.suppliers_vendor_cta")}
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SupplierTile label={t("landing.phase_suppliers_title")} icon={<Store size={18} />} />
            <SupplierTile label={t("landing.phase_guests_title")} icon={<Users size={18} />} />
            <SupplierTile label={t("landing.phase_seating_title")} icon={<Table2 size={18} />} />
            <SupplierTile label={t("landing.phase_plan_title")} icon={<Calendar size={18} />} />
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="grid gap-5 lg:grid-cols-3">
          <TrustCard
            icon={<HeartHandshake size={18} />}
            title={t("landing.trust_couple_title")}
            body={t("landing.trust_couple_body")}
          />
          <TrustCard
            icon={<Sparkles size={18} />}
            title={t("landing.trust_free_title")}
            body={t("landing.trust_free_body")}
          />
          <TrustCard
            icon={<ShieldCheck size={18} />}
            title={t("landing.trust_data_title")}
            body={t("landing.trust_data_body")}
          />
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-chalk-200 bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="font-display text-3xl text-ink-900 sm:text-5xl">
            {t("landing.faq_title")}
          </h2>
          <div className="mt-8 divide-y divide-chalk-200 border-y border-chalk-200">
            <FaqItem question={t("landing.faq_q_free")} answer={t("landing.faq_a_free")} />
            <FaqItem question={t("landing.faq_q_partner")} answer={t("landing.faq_a_partner")} />
            <FaqItem question={t("landing.faq_q_data")} answer={t("landing.faq_a_data")} />
            <FaqItem question={t("landing.faq_q_planner")} answer={t("landing.faq_a_planner")} />
            <FaqItem question={t("landing.faq_q_ready")} answer={t("landing.faq_a_ready")} />
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-24">
        <h2 className="font-display text-4xl tracking-tight text-ink-900 sm:text-6xl">
          {t("landing.closing_title")}
        </h2>
        <p className="mt-4 text-base text-ink-600 sm:text-lg">{t("landing.closing_body")}</p>
        <div className="mt-8 flex justify-center">
          <Link to="/signup" className="btn-pill">
            {t("landing.cta_signup")}
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}

function PhaseCard({
  icon,
  title,
  body,
}: {
  icon: JSX.Element;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-2xl border border-chalk-200 bg-chalk-50 p-5">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-terracotta-100 text-terracotta-700">
        {icon}
      </div>
      <h3 className="font-serif text-xl text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
    </article>
  );
}

function AudienceCard({
  title,
  body,
  ctaLabel,
  to,
  onClick,
  tone,
}: {
  title: string;
  body: string;
  ctaLabel: string;
  to?: string;
  onClick?: () => void;
  tone?: "primary";
}) {
  const isPrimary = tone === "primary";
  const cardClass = isPrimary
    ? "rounded-2xl border border-terracotta-200 bg-terracotta-50 p-7"
    : "rounded-2xl border border-chalk-200 bg-white p-7 shadow-soft";
  const ctaClass = isPrimary
    ? "mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-terracotta-700 hover:text-terracotta-800"
    : "mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 hover:text-terracotta-700";
  const cta = (
    <span className={ctaClass}>
      {ctaLabel}
      <span aria-hidden>→</span>
    </span>
  );
  return (
    <article className={cardClass}>
      <h3 className="font-display text-2xl text-ink-900 sm:text-3xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink-700">{body}</p>
      {to ? (
        <Link to={to}>{cta}</Link>
      ) : (
        <button type="button" onClick={onClick} className="text-left">
          {cta}
        </button>
      )}
    </article>
  );
}

function SupplierTile({ label, icon }: { label: string; icon: JSX.Element }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-chalk-200 bg-white px-4 py-5">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-chalk-100 text-ink-700">
        {icon}
      </span>
      <span className="text-sm font-medium text-ink-800">{label}</span>
    </div>
  );
}

function TrustCard({ icon, title, body }: { icon: JSX.Element; title: string; body: string }) {
  return (
    <article className="rounded-2xl border border-chalk-200 bg-white p-6">
      <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-chalk-100 text-ink-700">
        {icon}
      </div>
      <h3 className="font-serif text-lg text-ink-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink-600">{body}</p>
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
