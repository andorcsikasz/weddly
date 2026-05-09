import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  PhaseAftermathArt,
  PhaseGuestsArt,
  PhasePlanArt,
  PhaseSeatingArt,
  PhaseSuppliersArt,
  SuppliersPreview,
  WaveDivider,
} from "../components/illustrations";
import {
  BudgetMockup,
  CouplePortrait,
  GuestListMockup,
  SeatingMockup,
  WorkspaceMockup,
} from "../components/mockups";
import { PublicShell, useGuestCodePrompt } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

export default function LandingPage() {
  const { t } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");
  const askGuestCode = useGuestCodePrompt();

  return (
    <PublicShell>
      {/* ───────────────────── Hero ───────────────────── */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16 lg:pt-24 lg:pb-24">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-terracotta-200 bg-terracotta-50 px-3 py-1 text-xs font-medium uppercase tracking-wider text-terracotta-700">
            <span className="h-1.5 w-1.5 rounded-full bg-terracotta-500" />
            {t("landing.stats_eyebrow")} · {t("landing.stats_c_value")}
          </span>
          <h1 className="mt-5 font-display text-5xl leading-[1.02] tracking-tight text-ink-900 sm:text-6xl lg:text-7xl">
            {t("landing.hero_title")}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-600 sm:text-xl lg:mx-0">
            {t("landing.hero_sub")}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
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
        <div className="mx-auto w-full max-w-xl lg:max-w-none">
          <WorkspaceMockup className="h-auto w-full" />
        </div>
      </section>

      {/* ───────────────────── Stats strip ───────────────────── */}
      <section className="border-y border-chalk-200 bg-chalk-100/60">
        <div className="mx-auto grid max-w-6xl gap-y-8 px-4 py-10 sm:grid-cols-3 sm:gap-x-10 sm:px-6">
          <Stat value={t("landing.stats_a_value")} label={t("landing.stats_a_label")} />
          <Stat value={t("landing.stats_b_value")} label={t("landing.stats_b_label")} />
          <Stat value={t("landing.stats_c_value")} label={t("landing.stats_c_label")} />
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-6 text-center text-xs text-ink-500 sm:px-6 sm:text-left">
          {t("landing.stats_footnote")}
        </p>
      </section>

      {/* ───────────────────── Phases ───────────────────── */}
      <section id="phases" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-20">
          <div className="max-w-2xl">
            <Eyebrow>{t("landing.product_eyebrow")}</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink-900 sm:text-5xl">
              {t("landing.phases_title")}
            </h2>
          </div>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            <PhaseCard
              art={<PhasePlanArt className="h-14 w-14" />}
              title={t("landing.phase_plan_title")}
              body={t("landing.phase_plan_body")}
              step={1}
            />
            <PhaseCard
              art={<PhaseSuppliersArt className="h-14 w-14" />}
              title={t("landing.phase_suppliers_title")}
              body={t("landing.phase_suppliers_body")}
              step={2}
            />
            <PhaseCard
              art={<PhaseGuestsArt className="h-14 w-14" />}
              title={t("landing.phase_guests_title")}
              body={t("landing.phase_guests_body")}
              step={3}
            />
            <PhaseCard
              art={<PhaseSeatingArt className="h-14 w-14" />}
              title={t("landing.phase_seating_title")}
              body={t("landing.phase_seating_body")}
              step={4}
            />
            <PhaseCard
              art={<PhaseAftermathArt className="h-14 w-14" />}
              title={t("landing.phase_aftermath_title")}
              body={t("landing.phase_aftermath_body")}
              step={5}
            />
          </div>
        </div>
      </section>

      {/* ───────────────────── Product feature blocks ───────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <FeatureBlock
            eyebrow={t("landing.block_budget_eyebrow")}
            title={t("landing.block_budget_title")}
            body={t("landing.block_budget_body")}
            bullets={[
              t("landing.block_budget_bullet_1"),
              t("landing.block_budget_bullet_2"),
              t("landing.block_budget_bullet_3"),
            ]}
            mockup={<BudgetMockup className="h-auto w-full" />}
            reverse={false}
          />
          <FeatureBlock
            eyebrow={t("landing.block_guests_eyebrow")}
            title={t("landing.block_guests_title")}
            body={t("landing.block_guests_body")}
            bullets={[
              t("landing.block_guests_bullet_1"),
              t("landing.block_guests_bullet_2"),
              t("landing.block_guests_bullet_3"),
            ]}
            mockup={<GuestListMockup className="h-auto w-full" />}
            reverse={true}
          />
          <FeatureBlock
            eyebrow={t("landing.block_seating_eyebrow")}
            title={t("landing.block_seating_title")}
            body={t("landing.block_seating_body")}
            bullets={[
              t("landing.block_seating_bullet_1"),
              t("landing.block_seating_bullet_2"),
              t("landing.block_seating_bullet_3"),
            ]}
            mockup={<SeatingMockup className="h-auto w-full" />}
            reverse={false}
          />
        </div>
      </section>

      {/* ───────────────────── Why Weddly ───────────────────── */}
      <section className="bg-chalk-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-2xl">
            <Eyebrow>{t("landing.why_eyebrow")}</Eyebrow>
            <h2 className="mt-3 font-display text-3xl leading-tight text-ink-900 sm:text-5xl">
              {t("landing.why_title")}
            </h2>
          </div>
          <div className="mt-12 grid gap-10 sm:grid-cols-2">
            <WhyItem title={t("landing.why_a_title")} body={t("landing.why_a_body")} />
            <WhyItem title={t("landing.why_b_title")} body={t("landing.why_b_body")} />
            <WhyItem title={t("landing.why_c_title")} body={t("landing.why_c_body")} />
            <WhyItem title={t("landing.why_d_title")} body={t("landing.why_d_body")} />
          </div>
        </div>
      </section>

      {/* ───────────────────── Suppliers section ───────────────────── */}
      <SectionWave color="text-chalk-100" />
      <section id="suppliers" className="bg-chalk-100/70">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <Eyebrow>{t("landing.phase_suppliers_title")}</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink-900 sm:text-5xl">
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

      {/* ───────────────────── Testimonials ───────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-20">
          <div className="max-w-2xl">
            <Eyebrow>{t("landing.testimonials_eyebrow")}</Eyebrow>
            <h2 className="mt-3 font-display text-3xl text-ink-900 sm:text-5xl">
              {t("landing.testimonials_title")}
            </h2>
          </div>
          <div className="mt-12 grid gap-6 lg:grid-cols-3">
            <Testimonial
              variant={1}
              quote={t("landing.t1_quote")}
              name={t("landing.t1_name")}
              meta={t("landing.t1_meta")}
            />
            <Testimonial
              variant={2}
              quote={t("landing.t2_quote")}
              name={t("landing.t2_name")}
              meta={t("landing.t2_meta")}
            />
            <Testimonial
              variant={3}
              quote={t("landing.t3_quote")}
              name={t("landing.t3_name")}
              meta={t("landing.t3_meta")}
            />
          </div>
        </div>
      </section>

      {/* ───────────────────── Audience cards ───────────────────── */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 sm:pb-28">
        <div className="max-w-2xl">
          <Eyebrow>{t("landing.audience_title")}</Eyebrow>
          <p className="mt-3 text-base text-ink-600 sm:text-lg">{t("landing.audience_sub")}</p>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
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

      {/* ───────────────────── Pricing ───────────────────── */}
      <section className="bg-chalk-100/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
            <div>
              <Eyebrow>{t("landing.pricing_eyebrow")}</Eyebrow>
              <h2 className="mt-3 font-display text-3xl leading-tight text-ink-900 sm:text-5xl">
                {t("landing.pricing_title")}
              </h2>
              <p className="mt-5 max-w-xl text-base text-ink-600 sm:text-lg">
                {t("landing.pricing_body")}
              </p>
            </div>
            <div className="rounded-3xl bg-white p-8 ring-1 ring-chalk-200 shadow-soft">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-5xl text-ink-900 sm:text-6xl">0 Ft</span>
                <span className="text-sm text-ink-500">/ {t("landing.stats_eyebrow")}</span>
              </div>
              <ul className="mt-7 space-y-3">
                {[
                  t("landing.pricing_bullet_1"),
                  t("landing.pricing_bullet_2"),
                  t("landing.pricing_bullet_3"),
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm text-ink-700">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-terracotta-100 text-terracotta-700">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/signup"
                className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-terracotta-500 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-terracotta-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta-500 focus-visible:ring-offset-2 sm:w-auto"
              >
                {t("landing.cta_signup")}
              </Link>
              <p className="mt-4 border-t border-chalk-200 pt-4 text-xs leading-relaxed text-ink-500">
                {t("landing.pricing_v2_note")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── FAQ ───────────────────── */}
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

      {/* ───────────────────── Closing ───────────────────── */}
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

// ─────────────────────────── Building blocks ───────────────────────────

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-terracotta-700">
      {children}
    </span>
  );
}

function SectionWave({ color }: { color: string }) {
  return (
    <div className={color} aria-hidden="true">
      <WaveDivider className="block h-10 w-full sm:h-14" />
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-display text-3xl text-ink-900 sm:text-4xl">{value}</p>
      <p className="mt-1 text-sm text-ink-600">{label}</p>
    </div>
  );
}

function PhaseCard({
  art,
  title,
  body,
  step,
}: {
  art: ReactNode;
  title: string;
  body: string;
  step: number;
}) {
  return (
    <article className="rounded-3xl bg-chalk-50 p-6 transition-shadow hover:shadow-soft">
      <div className="flex items-start justify-between">
        <div>{art}</div>
        <span className="font-display text-sm text-chalk-400">0{step}</span>
      </div>
      <h3 className="mt-4 font-serif text-xl text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
    </article>
  );
}

function FeatureBlock({
  eyebrow,
  title,
  body,
  bullets,
  mockup,
  reverse,
}: {
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  mockup: ReactNode;
  reverse: boolean;
}) {
  return (
    <div
      className={`grid gap-12 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-24 ${
        reverse ? "lg:[&>*:first-child]:order-last" : ""
      }`}
    >
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-3 font-display text-3xl leading-tight text-ink-900 sm:text-4xl lg:text-5xl">
          {title}
        </h2>
        <p className="mt-5 max-w-xl text-base text-ink-600 sm:text-lg">{body}</p>
        <ul className="mt-7 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-3 text-sm text-ink-700">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-terracotta-100 text-terracotta-700">
                <Check size={12} strokeWidth={3} />
              </span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mx-auto w-full max-w-lg lg:max-w-none">{mockup}</div>
    </div>
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

function Testimonial({
  variant,
  quote,
  name,
  meta,
}: {
  variant: 1 | 2 | 3;
  quote: string;
  name: string;
  meta: string;
}) {
  return (
    <article className="flex flex-col rounded-3xl bg-white p-7 ring-1 ring-chalk-200 shadow-soft">
      <span className="font-display text-5xl leading-none text-terracotta-300" aria-hidden>
        &ldquo;
      </span>
      <p className="mt-2 font-serif text-lg leading-relaxed text-ink-800">{quote}</p>
      <div className="mt-auto flex items-center gap-3 pt-6">
        <CouplePortrait variant={variant} className="h-12 w-12 shrink-0" />
        <div>
          <p className="font-serif text-base text-ink-900">{name}</p>
          <p className="text-xs text-ink-500">{meta}</p>
        </div>
      </div>
    </article>
  );
}

function WhyItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="h-px w-10 bg-terracotta-400" aria-hidden="true" />
      <h3 className="font-serif text-xl text-ink-900">{title}</h3>
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
