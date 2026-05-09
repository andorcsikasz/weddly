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
} from "../components/illustrations";
import { LazyMount } from "../components/LazyMount";
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

// Mockups have known aspect ratios (from their SVG viewBox). LazyMount uses
// these to reserve layout space, so the page doesn't jump as below-fold
// SVGs mount when scrolled into view.
const MOCKUP_AR_FEATURE = "480 / 360";
const MOCKUP_AR_SUPPLIERS = "320 / 280";

export default function LandingPage() {
  const { t } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");
  const askGuestCode = useGuestCodePrompt();

  return (
    <PublicShell>
      {/* ───────────────────── 01 · Hero ─────────────────────
          Bg: paper-50. Eyebrow chip + huge serif headline (italic on
          the closing word) + dual CTA + workspace mockup on the right. */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:gap-16 lg:pt-24 lg:pb-24">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-blush-200 bg-blush-50 px-3 py-1 text-xs font-medium uppercase tracking-wider text-blush-700">
            <span className="h-1.5 w-1.5 rounded-full bg-blush-500" />
            {t("landing.stats_eyebrow")} · {t("landing.stats_c_value")}
          </span>
          <h1 className="mt-5 font-serif text-5xl leading-[1.02] tracking-tight text-ink-900 sm:text-6xl lg:text-[5.5rem]">
            {t("landing.hero_title")}
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-ink-600 sm:text-xl lg:mx-0">
            {t("landing.hero_sub")}
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Link to="/signup" className="btn-primary btn-lg w-full shadow-sm sm:w-auto">
              {t("landing.cta_signup")}
            </Link>
            <Link to="/login" className="btn-outline btn-lg w-full sm:w-auto">
              {t("landing.cta_login")}
            </Link>
          </div>
          <p className="mt-3 text-xs text-ink-500">{t("landing.cta_signup_sub")}</p>
          <button
            type="button"
            onClick={() => {
              void askGuestCode();
            }}
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-600 underline decoration-paper-400 underline-offset-4 hover:text-ink-900 hover:decoration-blush-500"
          >
            {t("landing.guest_link")}
          </button>
        </div>
        <div className="mx-auto w-full max-w-xl lg:max-w-none">
          <WorkspaceMockup className="h-auto w-full" />
        </div>
      </section>

      {/* ───────────────────── Stats — DARK BAND ─────────────────────
          The page's first attention break: dark ink-900 surface, paper-100
          numbers, blush-300 accents. Deliberate visual interruption. */}
      <section className="bg-ink-900 text-paper-100">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <div className="grid gap-y-10 sm:grid-cols-3 sm:gap-x-12">
            <DarkStat value={t("landing.stats_a_value")} label={t("landing.stats_a_label")} />
            <DarkStat value={t("landing.stats_b_value")} label={t("landing.stats_b_label")} />
            <DarkStat value={t("landing.stats_c_value")} label={t("landing.stats_c_label")} />
          </div>
          <p className="mt-10 max-w-3xl text-xs leading-relaxed text-paper-400 sm:text-sm">
            {t("landing.stats_footnote")}
          </p>
        </div>
      </section>

      {/* ───────────────────── 01 · Phases ─────────────────────
          White surface, big serif numerals as the visual anchor. */}
      <section id="phases" className="bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-20">
          <SectionEyebrow num="01" label={t("landing.product_eyebrow")} />
          <h2 className="mt-4 max-w-2xl font-serif text-4xl leading-tight text-ink-900 sm:text-5xl">
            {t("landing.phases_title")}
          </h2>
          <ol className="mt-14 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
            <PhaseStep
              n={1}
              art={<PhasePlanArt className="h-12 w-12" />}
              title={t("landing.phase_plan_title")}
              body={t("landing.phase_plan_body")}
            />
            <PhaseStep
              n={2}
              art={<PhaseSuppliersArt className="h-12 w-12" />}
              title={t("landing.phase_suppliers_title")}
              body={t("landing.phase_suppliers_body")}
            />
            <PhaseStep
              n={3}
              art={<PhaseGuestsArt className="h-12 w-12" />}
              title={t("landing.phase_guests_title")}
              body={t("landing.phase_guests_body")}
            />
            <PhaseStep
              n={4}
              art={<PhaseSeatingArt className="h-12 w-12" />}
              title={t("landing.phase_seating_title")}
              body={t("landing.phase_seating_body")}
            />
            <PhaseStep
              n={5}
              art={<PhaseAftermathArt className="h-12 w-12" />}
              title={t("landing.phase_aftermath_title")}
              body={t("landing.phase_aftermath_body")}
            />
          </ol>
        </div>
      </section>

      {/* ───────────────────── 02 · Product feature blocks ─────────────────────
          Three blocks, each on a different surface tone so they don't
          blur together: paper-50 → white → paper-100/40. Each carries
          its own sub-numeral. */}
      <section className="bg-paper-50">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <FeatureBlock
            num="02.1"
            eyebrow={t("landing.block_budget_eyebrow")}
            title={t("landing.block_budget_title")}
            body={t("landing.block_budget_body")}
            bullets={[
              t("landing.block_budget_bullet_1"),
              t("landing.block_budget_bullet_2"),
              t("landing.block_budget_bullet_3"),
            ]}
            mockup={
              <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                <BudgetMockup className="h-auto w-full" />
              </LazyMount>
            }
            reverse={false}
          />
        </div>
      </section>
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <FeatureBlock
            num="02.2"
            eyebrow={t("landing.block_guests_eyebrow")}
            title={t("landing.block_guests_title")}
            body={t("landing.block_guests_body")}
            bullets={[
              t("landing.block_guests_bullet_1"),
              t("landing.block_guests_bullet_2"),
              t("landing.block_guests_bullet_3"),
            ]}
            mockup={
              <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                <GuestListMockup className="h-auto w-full" />
              </LazyMount>
            }
            reverse={true}
          />
        </div>
      </section>
      <section className="bg-paper-100/40">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <FeatureBlock
            num="02.3"
            eyebrow={t("landing.block_seating_eyebrow")}
            title={t("landing.block_seating_title")}
            body={t("landing.block_seating_body")}
            bullets={[
              t("landing.block_seating_bullet_1"),
              t("landing.block_seating_bullet_2"),
              t("landing.block_seating_bullet_3"),
            ]}
            mockup={
              <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                <SeatingMockup className="h-auto w-full" />
              </LazyMount>
            }
            reverse={false}
          />
        </div>
      </section>

      {/* ───────────────────── 03 · Why Weddly ─────────────────────
          Centered editorial moment — the only section with a centred
          title. Italic accent on the differentiation. */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6 sm:py-28">
          <SectionEyebrow num="03" label={t("landing.why_eyebrow")} center />
          <h2 className="mx-auto mt-4 max-w-3xl font-serif text-4xl leading-[1.1] text-ink-900 sm:text-5xl lg:text-[3.5rem]">
            {t("landing.why_title")}
          </h2>
          <div className="mx-auto mt-14 grid max-w-5xl gap-10 text-left sm:grid-cols-2">
            <WhyItem title={t("landing.why_a_title")} body={t("landing.why_a_body")} />
            <WhyItem title={t("landing.why_b_title")} body={t("landing.why_b_body")} />
            <WhyItem title={t("landing.why_c_title")} body={t("landing.why_c_body")} />
            <WhyItem title={t("landing.why_d_title")} body={t("landing.why_d_body")} />
          </div>
        </div>
      </section>

      {/* ───────────────────── 04 · Suppliers ─────────────────────
          Asymmetric: copy + CTA stack on the left, illustrative
          directory snapshot on the right. */}
      <section id="suppliers" className="bg-paper-50">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionEyebrow num="04" label={t("landing.phase_suppliers_title")} />
            <h2 className="mt-4 font-serif text-4xl leading-tight text-ink-900 sm:text-5xl">
              {t("landing.suppliers_section_title")}
            </h2>
            <p className="mt-4 max-w-xl text-base text-ink-600 sm:text-lg">
              {t("landing.suppliers_section_body")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className="btn-primary">
                {t("landing.suppliers_couple_cta")}
              </Link>
              <Link to="/vendors" className="btn-outline">
                {t("landing.suppliers_vendor_cta")}
              </Link>
            </div>
          </div>
          <LazyMount aspectRatio={MOCKUP_AR_SUPPLIERS} className="w-full">
            <SuppliersPreview className="h-auto w-full" />
          </LazyMount>
        </div>
      </section>

      {/* ───────────────────── 05 · Testimonials ─────────────────────
          Featured layout — one large card spans 2 cols, two smaller
          cards stack in column 3. Asymmetric on lg+; equal on mobile. */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28 sm:pb-20">
          <SectionEyebrow num="05" label={t("landing.testimonials_eyebrow")} />
          <h2 className="mt-4 max-w-3xl font-serif text-4xl leading-tight text-ink-900 sm:text-5xl">
            {t("landing.testimonials_title")}
          </h2>
          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            <FeaturedTestimonial
              variant={1}
              quote={t("landing.t1_quote")}
              name={t("landing.t1_name")}
              meta={t("landing.t1_meta")}
            />
            <div className="grid gap-6">
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
        </div>
      </section>

      {/* ───────────────────── 06 · Audience ─────────────────────
          3 cards. Primary card lifted with a pop shadow and a slight
          scale to lead the eye. */}
      <section className="bg-paper-50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <SectionEyebrow num="06" label={t("landing.audience_title")} />
          <p className="mt-4 max-w-2xl text-lg text-ink-700 sm:text-xl">
            {t("landing.audience_sub")}
          </p>
          <div className="mt-12 grid gap-6 lg:grid-cols-3 lg:items-stretch">
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
        </div>
      </section>

      {/* ───────────────────── 07 · Pricing ─────────────────────
          Headline-led: copy on the left, an elevated price card on the
          right. The price card uses pop shadow + ring so it reads as a
          distinct artefact rather than blending in. */}
      <section className="bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="grid gap-12 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-20">
            <div>
              <SectionEyebrow num="07" label={t("landing.pricing_eyebrow")} />
              <h2 className="mt-4 font-serif text-4xl leading-[1.1] text-ink-900 sm:text-5xl lg:text-[3.5rem]">
                {t("landing.pricing_title")}
              </h2>
              <p className="mt-5 max-w-xl text-base text-ink-600 sm:text-lg">
                {t("landing.pricing_body")}
              </p>
            </div>
            <div className="rounded-2xl bg-paper-50 p-8 shadow-pop ring-1 ring-paper-300 sm:p-10">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-blush-700">
                {t("landing.stats_eyebrow")}
              </span>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="font-serif text-6xl text-ink-900 sm:text-7xl">0 Ft</span>
                <span className="text-sm text-ink-500">/ couple</span>
              </div>
              <ul className="mt-8 space-y-3">
                {[
                  t("landing.pricing_bullet_1"),
                  t("landing.pricing_bullet_2"),
                  t("landing.pricing_bullet_3"),
                ].map((b) => (
                  <li key={b} className="flex items-start gap-3 text-sm text-ink-700">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <Link to="/signup" className="btn-primary btn-lg mt-8 w-full shadow-sm">
                {t("landing.cta_signup")}
              </Link>
              <p className="mt-5 border-t border-paper-300 pt-4 text-xs leading-relaxed text-ink-500">
                {t("landing.pricing_v2_note")}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────────────── 08 · FAQ ─────────────────────
          Compact utility section — smaller heading, more rows per
          screen. Clearly separated from the marketing rhythm above. */}
      <section className="bg-paper-50">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
          <SectionEyebrow num="08" label={t("landing.faq_title")} />
          <div className="mt-8 divide-y divide-paper-300 border-y border-paper-300">
            <FaqItem question={t("landing.faq_q_free")} answer={t("landing.faq_a_free")} />
            <FaqItem question={t("landing.faq_q_partner")} answer={t("landing.faq_a_partner")} />
            <FaqItem question={t("landing.faq_q_data")} answer={t("landing.faq_a_data")} />
            <FaqItem question={t("landing.faq_q_planner")} answer={t("landing.faq_a_planner")} />
            <FaqItem question={t("landing.faq_q_ready")} answer={t("landing.faq_a_ready")} />
          </div>
        </div>
      </section>

      {/* ───────────────────── Closing ─────────────────────
          Stationery-textured paper-200, the page's emotional peak.
          One italic display headline, one CTA, no other distractions. */}
      <section className="stationery">
        <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6 sm:py-32">
          <h2 className="font-serif text-5xl italic leading-[1.05] tracking-tight text-ink-900 sm:text-7xl">
            {t("landing.closing_title")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-ink-700 sm:text-lg">
            {t("landing.closing_body")}
          </p>
          <div className="mt-10 flex justify-center">
            <Link to="/signup" className="btn-primary btn-lg shadow-sm">
              {t("landing.cta_signup")}
            </Link>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}

// ─────────────────────────── Building blocks ───────────────────────────

/** Section landmark: small italic numeral + uppercase eyebrow on one
 *  line, separated by a hairline. Gives the eye a scan anchor that the
 *  bare uppercase eyebrow couldn't on its own. */
function SectionEyebrow({
  num,
  label,
  center = false,
}: {
  num: string;
  label: string;
  center?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${center ? "justify-center" : ""}`}>
      <span className="font-serif text-base italic text-blush-700">{num}</span>
      <span className="h-px w-8 bg-paper-400" aria-hidden="true" />
      <span className="text-xs font-semibold uppercase tracking-[0.25em] text-ink-700">
        {label}
      </span>
    </div>
  );
}

/** Stat row inside the dark band. Uses paper tokens so the ratio
 *  paper-100 number / paper-400 label keeps contrast on ink-900. */
function DarkStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-serif text-5xl tracking-tight text-paper-100 sm:text-6xl">{value}</p>
      <p className="mt-2 text-sm text-paper-300">{label}</p>
    </div>
  );
}

/** Phase step in the numbered timeline. Big serif numeral leads, art
 *  is small, copy supports. */
function PhaseStep({
  n,
  art,
  title,
  body,
}: {
  n: number;
  art: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col">
      <span className="font-serif text-5xl italic text-blush-300 sm:text-6xl">0{n}</span>
      <div className="mt-2">{art}</div>
      <h3 className="mt-3 font-serif text-xl text-ink-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600">{body}</p>
    </li>
  );
}

/** Product feature block. Carries its own section sub-numeral so the
 *  three blocks read as three distinct moments. */
function FeatureBlock({
  num,
  eyebrow,
  title,
  body,
  bullets,
  mockup,
  reverse,
}: {
  num: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  mockup: ReactNode;
  reverse: boolean;
}) {
  return (
    <div
      className={`grid gap-12 py-20 sm:py-24 lg:grid-cols-2 lg:items-center lg:gap-16 lg:py-28 ${
        reverse ? "lg:[&>*:first-child]:order-last" : ""
      }`}
    >
      <div>
        <SectionEyebrow num={num} label={eyebrow} />
        <h2 className="mt-4 font-serif text-4xl leading-[1.1] text-ink-900 sm:text-5xl">{title}</h2>
        <p className="mt-5 max-w-xl text-base text-ink-600 sm:text-lg">{body}</p>
        <ul className="mt-7 space-y-3">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-3 text-sm text-ink-700">
              <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700">
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
  // Primary card uses a denser, lifted treatment so it reads as the
  // recommended choice without needing a "Best" badge.
  const cardClass = isPrimary ? "rounded-2xl bg-ink-900 text-paper-100 p-8 shadow-pop" : "card";
  const ctaClass = isPrimary
    ? "mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-blush-300 hover:text-blush-200"
    : "mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink-900 hover:text-blush-700";
  const cta = (
    <span className={ctaClass}>
      {ctaLabel}
      <span aria-hidden>→</span>
    </span>
  );
  return (
    <article className={cardClass}>
      <div className={`mb-4 ${isPrimary ? "[&_svg]:opacity-90" : ""}`}>{art}</div>
      <h3
        className={`font-serif text-2xl sm:text-3xl ${isPrimary ? "text-paper-100" : "text-ink-900"}`}
      >
        {title}
      </h3>
      <p
        className={`mt-3 text-sm leading-relaxed ${isPrimary ? "text-paper-300" : "text-ink-700"}`}
      >
        {body}
      </p>
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

/** Featured testimonial — taller card with a larger pull-quote. Used
 *  once per testimonials section. */
function FeaturedTestimonial({
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
    <article className="card flex flex-col bg-paper-50 p-8 lg:col-span-2 lg:p-10">
      <span className="font-serif text-7xl leading-none text-blush-300" aria-hidden>
        &ldquo;
      </span>
      <p className="mt-2 font-serif text-2xl leading-snug text-ink-900 sm:text-3xl">{quote}</p>
      <div className="mt-auto flex items-center gap-4 pt-8">
        <CouplePortrait variant={variant} className="h-14 w-14 shrink-0" />
        <div>
          <p className="font-serif text-lg font-semibold text-ink-900">{name}</p>
          <p className="text-xs text-ink-500">{meta}</p>
        </div>
      </div>
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
    <article className="card flex flex-col">
      <span className="font-serif text-4xl leading-none text-blush-300" aria-hidden>
        &ldquo;
      </span>
      <p className="mt-1 font-serif text-base leading-relaxed text-ink-800">{quote}</p>
      <div className="mt-auto flex items-center gap-3 pt-5">
        <CouplePortrait variant={variant} className="h-10 w-10 shrink-0" />
        <div>
          <p className="font-serif text-sm font-semibold text-ink-900">{name}</p>
          <p className="text-xs text-ink-500">{meta}</p>
        </div>
      </div>
    </article>
  );
}

function WhyItem({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="h-px w-10 bg-blush-400" aria-hidden="true" />
      <h3 className="font-serif text-xl text-ink-900">{title}</h3>
      <p className="text-sm leading-relaxed text-ink-600">{body}</p>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: ReactNode }) {
  return (
    <details className="group py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="font-serif text-lg text-ink-900">{question}</span>
        <ChevronDown
          size={18}
          className="shrink-0 text-ink-500 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-ink-600">{answer}</p>
    </details>
  );
}
