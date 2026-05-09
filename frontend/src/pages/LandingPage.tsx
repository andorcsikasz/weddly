import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  HeroArt,
  PhaseAftermathArt,
  PhaseGuestsArt,
  PhasePlanArt,
  PhaseSeatingArt,
  PhaseSuppliersArt,
  SuppliersPreview,
  WaveDivider,
} from "../components/illustrations";
import { PublicShell, useGuestCodePrompt } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function LandingPage() {
  const { t } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");
  const askGuestCode = useGuestCodePrompt();

  return (
    <PublicShell>
      {/* Hero — text + illustration */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-20 sm:px-6 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-16 lg:pt-24">
        <div className="text-center lg:text-left">
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-ink-900 sm:text-6xl lg:text-[5.5rem]">
            {t("landing.hero_title")}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-600 sm:text-xl lg:mx-0">
            {t("landing.hero_sub")}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
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
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <HeroArt className="h-auto w-full" />
        </div>
      </section>

      {/* Phases */}
      <SectionWave color="text-white" />
      <section id="phases" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-20 sm:px-6 sm:pt-12 sm:pb-28">
          <h2 className="max-w-2xl font-display text-3xl text-ink-900 sm:text-5xl">
            {t("landing.phases_title")}
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <PhaseCard
              art={<PhasePlanArt className="h-16 w-16" />}
              title={t("landing.phase_plan_title")}
              body={t("landing.phase_plan_body")}
            />
            <PhaseCard
              art={<PhaseSuppliersArt className="h-16 w-16" />}
              title={t("landing.phase_suppliers_title")}
              body={t("landing.phase_suppliers_body")}
            />
            <PhaseCard
              art={<PhaseGuestsArt className="h-16 w-16" />}
              title={t("landing.phase_guests_title")}
              body={t("landing.phase_guests_body")}
            />
            <PhaseCard
              art={<PhaseSeatingArt className="h-16 w-16" />}
              title={t("landing.phase_seating_title")}
              body={t("landing.phase_seating_body")}
            />
            <PhaseCard
              art={<PhaseAftermathArt className="h-16 w-16" />}
              title={t("landing.phase_aftermath_title")}
              body={t("landing.phase_aftermath_body")}
            />
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl text-ink-900 sm:text-5xl">
            {t("landing.audience_title")}
          </h2>
          <p className="mt-4 text-base text-ink-600 sm:text-lg">{t("landing.audience_sub")}</p>
        </div>
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          <AudienceCard
            art={<PhasePlanArt className="h-12 w-12" />}
            title={t("landing.card_couples_title")}
            body={t("landing.card_couples_body")}
            ctaLabel={t("landing.card_couples_cta")}
            to="/signup"
            tone="primary"
          />
          <AudienceCard
            art={<PhaseSuppliersArt className="h-12 w-12" />}
            title={t("landing.card_vendors_title")}
            body={t("landing.card_vendors_body")}
            ctaLabel={t("landing.card_vendors_cta")}
            to="/vendors"
          />
          <AudienceCard
            art={<PhaseGuestsArt className="h-12 w-12" />}
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
      <SectionWave color="text-chalk-100" />
      <section id="suppliers" className="bg-chalk-100/70">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
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
          <SuppliersPreview className="h-auto w-full" />
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-10 sm:grid-cols-3">
          <TrustItem
            title={t("landing.trust_couple_title")}
            body={t("landing.trust_couple_body")}
          />
          <TrustItem title={t("landing.trust_free_title")} body={t("landing.trust_free_body")} />
          <TrustItem title={t("landing.trust_data_title")} body={t("landing.trust_data_body")} />
        </div>
      </section>

      {/* FAQ */}
      <SectionWave color="text-white" />
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-28">
          <h2 className="font-display text-3xl text-ink-900 sm:text-5xl">
            {t("landing.faq_title")}
          </h2>
          <div className="mt-10 divide-y divide-chalk-200">
            <FaqItem question={t("landing.faq_q_free")} answer={t("landing.faq_a_free")} />
            <FaqItem question={t("landing.faq_q_partner")} answer={t("landing.faq_a_partner")} />
            <FaqItem question={t("landing.faq_q_data")} answer={t("landing.faq_a_data")} />
            <FaqItem question={t("landing.faq_q_planner")} answer={t("landing.faq_a_planner")} />
            <FaqItem question={t("landing.faq_q_ready")} answer={t("landing.faq_a_ready")} />
          </div>
        </div>
      </section>

      {/* Closing */}
      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28">
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

/** Single curved transition between two surface colours. The wave's
 *  fill matches the *next* section's background so it reads as the
 *  next surface gently rising into the previous one. */
function SectionWave({ color }: { color: string }) {
  return (
    <div className={color} aria-hidden="true">
      <WaveDivider className="block h-10 w-full sm:h-14" />
    </div>
  );
}

function PhaseCard({
  art,
  title,
  body,
}: {
  art: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-3xl bg-chalk-50 p-6 transition-shadow hover:shadow-soft">
      <div className="mb-4">{art}</div>
      <h3 className="font-serif text-xl text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
    </article>
  );
}

function AudienceCard({
  art,
  title,
  body,
  ctaLabel,
  to,
  onClick,
  tone,
}: {
  art: ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  to?: string;
  onClick?: () => void;
  tone?: "primary";
}) {
  const isPrimary = tone === "primary";
  const cardClass = isPrimary
    ? "rounded-3xl bg-terracotta-50 p-8 ring-1 ring-terracotta-200"
    : "rounded-3xl bg-white p-8 ring-1 ring-chalk-200 shadow-soft";
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
      <div className="mb-4">{art}</div>
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

function TrustItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="h-px w-10 bg-terracotta-400" aria-hidden="true" />
      <h3 className="font-serif text-lg text-ink-900">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: ReactNode }) {
  return (
    <details className="group py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="text-base font-medium text-ink-900">{question}</span>
        <ChevronDown
          size={18}
          className="shrink-0 text-ink-500 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">{answer}</p>
    </details>
  );
}
