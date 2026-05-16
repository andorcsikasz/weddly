import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  Filter,
  Heart,
  History,
  LayoutGrid,
  Mail,
  Pause,
  Printer,
  Smartphone,
  Sparkles,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BotanicalCorner, EucalyptusStem, WatercolorBlob } from "../components/botanical";
import { PullQuote, SectionLabel, WatermarkNumeral } from "../components/editorial";
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
import { Wordmark } from "../components/Wordmark";

// Mockups have known aspect ratios (from their SVG viewBox). LazyMount uses
// these to reserve layout space, so the page doesn't jump as below-fold
// SVGs mount when scrolled into view.
const MOCKUP_AR_FEATURE = "480 / 360";
const MOCKUP_AR_SUPPLIERS = "320 / 280";
const MOCKUP_AR_WORKSPACE = "640 / 440";

export default function LandingPage() {
  const { t } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");
  const askGuestCode = useGuestCodePrompt();

  return (
    <PublicShell>
      {/* ════════════════════════ 01 · HERO ════════════════════════
          Oversized italic serif title hanging into the left margin, sub
          + CTAs underneath. Mockup follows below as a full-bleed slab,
          tilted slightly so it reads as "the product, peeking up". */}
      <section className="relative overflow-hidden">
        <MarginNumeral value="01" />
        {/* Soft watercolour wash bleeding from the right behind the
            headline — adds depth without breaking the paper aesthetic. */}
        <WatercolorBlob
          variant={2}
          className="pointer-events-none absolute -top-10 right-[-14rem] h-[36rem] w-[36rem] text-blush-100 sm:right-[-10rem]"
        />
        <div className="relative mx-auto max-w-7xl px-4 pt-10 pb-8 sm:px-6 sm:pt-16 lg:pt-20 lg:pb-12">
          <h1 className="max-w-[14ch] font-serif text-4xl italic leading-[1] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-7xl sm:leading-[0.96] lg:text-8xl">
            {t("landing.hero_title")}
          </h1>
          <div className="mt-8 max-w-md">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className="btn-primary btn-lg shadow-sm">
                {t("landing.cta_signup")}
              </Link>
              <Link to="/login" className="btn-outline btn-lg">
                {t("landing.cta_login")}
              </Link>
            </div>
            <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
              {t("landing.cta_signup_sub")}
            </p>
          </div>
        </div>

        {/* Full-bleed mockup band — paper-100 background, mockup tilted
            so its bottom is cropped by the section. Reads as "the product
            peeking up." */}
        <div className="relative mt-2 overflow-hidden bg-paper-100 dark:bg-umber-900 pt-6 sm:pt-8 lg:pt-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="origin-bottom -mb-4 sm:-mb-14 lg:-mb-20">
              <LazyMount aspectRatio={MOCKUP_AR_WORKSPACE}>
                <div className="rotate-[-1.5deg] drop-shadow-[0_30px_50px_rgba(16,24,48,0.18)]">
                  <WorkspaceMockup className="h-auto w-full" />
                </div>
              </LazyMount>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ Wordmark spine ════════════════════════
          Stationery letterhead beat: faded WĒDDLY centred on a thin
          band, flanked by italic serif tags. Gives the eye a horizontal
          rest between the loud hero and the dark stats below. */}
      <section className="stationery-light border-y border-paper-300 dark:border-umber-700">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-4 sm:px-6">
          <span className="hidden flex-1 font-serif text-sm italic text-blush-600 dark:text-blush-300 sm:block">
            Est. MMXXVI
          </span>
          <Wordmark size="lg" className="mx-auto text-paper-400 dark:text-umber-600 sm:mx-0" />
          <span className="hidden flex-1 text-right font-serif text-sm italic text-blush-600 dark:text-blush-300 sm:block">
            Budapest · Paper letters
          </span>
        </div>
      </section>

      {/* ════════════════════════ Stats — DARK BAND ════════════════════════
          One huge number does the talking; the other stat runs as a
          ledger entry underneath. Dark-stationery texture matches the
          paper hairline pattern used elsewhere on the page. */}
      <section className="stationery-dark text-paper-100">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
          <p className="mb-6 text-xs font-semibold uppercase tracking-[0.32em] text-paper-300 sm:mb-8">
            {t("landing.stats_eyebrow")}
          </p>
          <p className="font-serif text-6xl leading-[0.85] tracking-[-0.03em] text-paper-100 sm:text-8xl lg:text-9xl">
            {t("landing.stats_a_value")}
          </p>
          <p className="mt-5 font-serif text-xl text-paper-300 sm:mt-6 sm:text-3xl">
            {t("landing.stats_a_label")}
          </p>
        </div>
      </section>

      {/* ════════════════════════ 02 · Phases ════════════════════════
          Numbered timeline. Each phase has a giant italic numeral
          bleeding behind its title; one continuous rule line at the
          numeral baseline serves as the literal timeline. */}
      <section id="phases" className="relative bg-paper-50 dark:bg-umber-900">
        <MarginNumeral value="02" />
        <div className="mx-auto max-w-7xl px-4 pt-14 pb-12 sm:px-6 sm:pt-20 sm:pb-16">
          <SectionLabel num="—" label={t("landing.product_eyebrow")} />
          <h2 className="mt-6 max-w-3xl font-serif text-3xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.phases_title")}
          </h2>
          <ol className="mt-12 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-5 lg:gap-x-4">
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

      {/* ════════════════════════ 03 · Budget — POLAROID ════════════════════════
          Mockup framed as a tilted polaroid with a watermark "02.1" sitting
          behind it. Copy on the left in a narrow column. */}
      <section className="relative bg-white dark:bg-umber-900">
        <MarginNumeral value="03" />
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
            <div>
              <h2 className="font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {t("landing.block_budget_title")}
              </h2>
              <ul className="mt-7 space-y-3">
                <IconRow icon={<Wallet size={16} />}>{t("landing.block_budget_bullet_1")}</IconRow>
                <IconRow icon={<Users size={16} />}>{t("landing.block_budget_bullet_2")}</IconRow>
                <IconRow icon={<History size={16} />}>{t("landing.block_budget_bullet_3")}</IconRow>
              </ul>
            </div>
            <div className="relative">
              <WatermarkNumeral value="02.1" position="br" className="hidden lg:block" />
              <div className="relative rotate-[-2deg] bg-white dark:bg-umber-800 p-5 ring-1 ring-paper-300 dark:ring-umber-700 shadow-pop sm:p-6">
                <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                  <BudgetMockup className="h-auto w-full" />
                </LazyMount>
                <p className="mt-4 text-center font-serif text-sm italic text-ink-500 dark:text-umber-300">
                  {t("landing.block_budget_eyebrow")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 04 · Guests — MAGAZINE SPREAD ════════════════════════
          Full-bleed paper-100 surface, mockup centred above, copy below
          in two columns — the layout of a feature spread. */}
      <section className="relative bg-paper-100/70 dark:bg-umber-900/70">
        <MarginNumeral value="04" />
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="max-w-3xl font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.block_guests_title")}
          </h2>
          <div className="mx-auto mt-10 max-w-2xl">
            <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
              <GuestListMockup className="h-auto w-full" />
            </LazyMount>
          </div>
          <ul className="mx-auto mt-12 max-w-md space-y-3">
            <IconRow icon={<Smartphone size={16} />}>{t("landing.block_guests_bullet_1")}</IconRow>
            <IconRow icon={<Filter size={16} />}>{t("landing.block_guests_bullet_2")}</IconRow>
            <IconRow icon={<Download size={16} />}>{t("landing.block_guests_bullet_3")}</IconRow>
          </ul>
        </div>
      </section>

      {/* ════════════════════════ 05 · Seating — EDGE BLEED ════════════════════════
          Narrow copy column on the left, mockup blown up to bleed off
          the right edge of the viewport. */}
      <section className="relative overflow-hidden bg-white dark:bg-umber-900">
        <MarginNumeral value="05" />
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-center lg:gap-10">
            <div className="max-w-sm">
              <h2 className="font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {t("landing.block_seating_title")}
              </h2>
              <ul className="mt-7 space-y-3">
                <IconRow icon={<LayoutGrid size={16} />}>
                  {t("landing.block_seating_bullet_1")}
                </IconRow>
                <IconRow icon={<AlertTriangle size={16} />}>
                  {t("landing.block_seating_bullet_2")}
                </IconRow>
                <IconRow icon={<Printer size={16} />}>
                  {t("landing.block_seating_bullet_3")}
                </IconRow>
              </ul>
            </div>
            <div className="lg:-mr-32 xl:-mr-48">
              <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                <SeatingMockup className="h-auto w-full drop-shadow-[0_30px_50px_rgba(16,24,48,0.15)]" />
              </LazyMount>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 06 · Why — PULL-QUOTE ════════════════════════
          The page's editorial peak. One italic statement does the work;
          the four differentiation points reduce to a single keyword
          row underneath. */}
      <section className="stationery-light relative">
        <MarginNumeral value="06" />
        <BotanicalCorner
          corner="tl"
          className="pointer-events-none absolute left-4 top-12 h-24 w-24 text-paper-300 dark:text-umber-600 sm:h-40 sm:w-40 lg:left-12"
        />
        <BotanicalCorner
          corner="br"
          className="pointer-events-none absolute bottom-12 right-4 h-24 w-24 text-paper-300 dark:text-umber-600 sm:h-40 sm:w-40 lg:right-12"
        />
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-24">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("landing.why_eyebrow")}
          </p>
          <PullQuote quote={t("landing.why_title")} className="mt-8" />
          <div className="mt-10 grid gap-3 text-center text-xs font-semibold uppercase tracking-[0.28em] text-ink-500 dark:text-umber-300 sm:flex sm:flex-wrap sm:justify-center sm:gap-x-8 sm:gap-y-3">
            <WhyKeyword>{t("landing.why_a_title")}</WhyKeyword>
            <WhyKeyword>{t("landing.why_b_title")}</WhyKeyword>
            <WhyKeyword>{t("landing.why_c_title")}</WhyKeyword>
            <WhyKeyword>{t("landing.why_d_title")}</WhyKeyword>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 07 · Suppliers ════════════════════════ */}
      <section id="suppliers" className="relative bg-white dark:bg-umber-900">
        <MarginNumeral value="07" />
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionLabel num="—" label={t("landing.phase_suppliers_title")} />
            <h2 className="mt-5 font-serif text-4xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-5xl">
              {t("landing.suppliers_section_title")}
            </h2>
            <p className="mt-5 max-w-xl text-base text-ink-600 dark:text-umber-200 sm:text-lg">
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

      {/* ════════════════════════ 08 · Testimonials ════════════════════════
          One pull-quote dominates; two whispers underneath. */}
      <section className="relative bg-paper-100/60 dark:bg-umber-900/60">
        <MarginNumeral value="08" />
        <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("landing.testimonials_eyebrow")}
          </p>
          <FeaturedTestimonial
            quote={t("landing.t1_quote")}
            name={t("landing.t1_name")}
            meta={t("landing.t1_meta")}
            variant={1}
          />
          <div className="mt-10 grid gap-x-12 gap-y-10 border-t border-paper-300 dark:border-umber-700 pt-8 sm:grid-cols-2">
            <WhisperTestimonial
              quote={t("landing.t2_quote")}
              name={t("landing.t2_name")}
              meta={t("landing.t2_meta")}
              variant={2}
            />
            <WhisperTestimonial
              quote={t("landing.t3_quote")}
              name={t("landing.t3_name")}
              meta={t("landing.t3_meta")}
              variant={3}
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════ 09 · Audience — LEDGER ════════════════════════
          Replaced 3 cards with a 3-row ledger: row label, body, → link.
          Reads like a directory page in a printed program. */}
      <section className="relative bg-white dark:bg-umber-900">
        <MarginNumeral value="09" />
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-3xl leading-[1.1] tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.audience_title")}
          </h2>
          <div className="mt-10 divide-y divide-paper-300 dark:divide-umber-700 border-y border-paper-300 dark:border-umber-700">
            <AudienceRow
              icon={<Heart size={20} strokeWidth={1.5} />}
              row={t("landing.card_couples_title")}
              ctaLabel={t("landing.card_couples_cta")}
              to="/signup"
            />
            <AudienceRow
              icon={<Store size={20} strokeWidth={1.5} />}
              row={t("landing.card_vendors_title")}
              ctaLabel={t("landing.card_vendors_cta")}
              to="/vendors"
            />
            <AudienceRow
              icon={<Mail size={20} strokeWidth={1.5} />}
              row={t("landing.card_guests_title")}
              ctaLabel={t("landing.card_guests_cta")}
              onClick={() => {
                void askGuestCode();
              }}
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════ 10 · Pricing — STATIONERY ANCHOR ════════════════════════
          Stationery-textured background; price card floats with deep
          shadow. 0 Ft does the talking. */}
      <section className="relative stationery">
        <MarginNumeral value="10" />
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <SectionLabel num="—" label={t("landing.pricing_eyebrow")} className="justify-center" />
            <h2 className="mt-5 font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
              {t("landing.pricing_title")}
            </h2>
          </div>
          <div className="relative mx-auto mt-10 max-w-lg">
            <div className="rounded-2xl bg-paper-50 dark:bg-umber-800 p-8 ring-1 ring-paper-300 dark:ring-umber-700 shadow-[0_30px_60px_-20px_rgba(16,24,48,0.25)] sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                {t("landing.stats_eyebrow")}
              </p>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-serif text-7xl leading-[0.9] text-ink-900 dark:text-paper-50 sm:text-8xl">
                  0
                </span>
                <span className="mb-3 font-serif text-3xl text-ink-700 dark:text-paper-100 sm:text-4xl">
                  Ft
                </span>
              </div>
              <p className="mt-1 font-serif text-sm italic text-ink-500 dark:text-umber-300">
                / {t("app.name")}
              </p>
              <ul className="mt-8 space-y-3">
                <IconRow icon={<Sparkles size={16} />}>{t("landing.pricing_bullet_1")}</IconRow>
                <IconRow icon={<Pause size={16} />}>{t("landing.pricing_bullet_2")}</IconRow>
                <IconRow icon={<FileText size={16} />}>{t("landing.pricing_bullet_3")}</IconRow>
              </ul>
              <Link to="/signup" className="btn-primary btn-lg mt-8 w-full shadow-sm">
                {t("landing.cta_signup")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 11 · FAQ ════════════════════════
          Tight max-w-2xl, italic question-mark headline, rows as
          inflatable cards instead of dividers. */}
      <section className="relative bg-paper-50 dark:bg-umber-900">
        <MarginNumeral value="11" />
        <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="font-serif text-5xl italic leading-[0.96] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:text-7xl lg:text-8xl">
            {t("landing.faq_title")}
          </h2>
          <div className="mt-10 space-y-3">
            <FaqCard q={t("landing.faq_q_free")} a={t("landing.faq_a_free")} />
            <FaqCard q={t("landing.faq_q_partner")} a={t("landing.faq_a_partner")} />
            <FaqCard q={t("landing.faq_q_data")} a={t("landing.faq_a_data")} />
            <FaqCard q={t("landing.faq_q_after_wedding")} a={t("landing.faq_a_after_wedding")} />
            <FaqCard q={t("landing.faq_q_planner")} a={t("landing.faq_a_planner")} />
            <FaqCard q={t("landing.faq_q_ready")} a={t("landing.faq_a_ready")} />
          </div>
        </div>
      </section>

      {/* ════════════════════════ Closing ════════════════════════
          Stationery texture, faded WĒDDLY watermark, huge italic
          headline, signature, eucalyptus stem ornament. */}
      <section className="stationery relative flex min-h-[50vh] items-center sm:min-h-[60vh]">
        <EucalyptusStem
          className="pointer-events-none absolute left-4 top-12 h-24 w-auto text-paper-400 dark:text-umber-600 opacity-70 sm:left-12 sm:top-20 sm:h-32"
          flip
        />
        <EucalyptusStem className="pointer-events-none absolute bottom-12 right-4 h-24 w-auto text-paper-400 dark:text-umber-600 opacity-70 sm:bottom-20 sm:right-12 sm:h-32" />
        <div className="mx-auto w-full max-w-3xl px-4 py-24 text-center sm:px-6 sm:py-32">
          <Wordmark size="md" className="text-paper-400 dark:text-umber-600" />
          <h2 className="mt-8 font-serif text-5xl italic leading-[0.96] tracking-tight text-ink-900 dark:text-paper-50 sm:text-7xl lg:text-8xl">
            {t("landing.closing_title")}
          </h2>
          <div className="mt-10 flex justify-center">
            <Link to="/signup" className="btn-primary btn-lg shadow-sm">
              {t("landing.cta_signup")}
            </Link>
          </div>
          <p className="mt-10 font-serif text-sm italic text-ink-500 dark:text-umber-300">
            — {t("app.name")}, Budapest
          </p>
        </div>
      </section>
    </PublicShell>
  );
}

// ─────────────────────────── Building blocks ───────────────────────────

/** Editorial spine: italic numeral floated absolutely in the left
 *  gutter of each major section. Visible from `lg:` up — on smaller
 *  screens the section eyebrows already carry numbering. */
function MarginNumeral({ value }: { value: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-6 top-10 hidden font-serif text-sm italic text-paper-500 dark:text-umber-500 lg:block xl:left-10 xl:top-14"
    >
      {value}
    </span>
  );
}

function IconRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700">
        {icon}
      </span>
      <span className="font-serif text-base text-ink-800 dark:text-paper-100">{children}</span>
    </li>
  );
}

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
    <li className="relative flex flex-col">
      {/* Big italic numeral floated behind the title — the visual
          anchor for each phase. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-1 -top-8 select-none font-serif text-5xl italic leading-none text-blush-200 dark:text-umber-700 sm:-left-2 sm:-top-10 sm:text-7xl lg:-top-12 lg:text-8xl"
      >
        0{n}
      </span>
      <div className="relative">{art}</div>
      <h3 className="relative mt-3 font-serif text-xl text-ink-900 dark:text-paper-50">{title}</h3>
      <p className="relative mt-2 text-sm leading-relaxed text-ink-600 dark:text-umber-200">
        {body}
      </p>
    </li>
  );
}

function WhyKeyword({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span
        className="hidden h-px w-6 bg-paper-400 dark:bg-umber-600 sm:inline-block"
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

function FeaturedTestimonial({
  quote,
  name,
  meta,
  variant,
}: {
  quote: string;
  name: string;
  meta: string;
  variant: 1 | 2 | 3;
}) {
  return (
    <figure className="mt-8">
      <blockquote className="font-serif text-3xl leading-[1.2] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-8 flex items-center gap-4">
        <CouplePortrait variant={variant} className="h-14 w-14 shrink-0" />
        <div>
          <p className="font-serif text-base font-semibold text-ink-900 dark:text-paper-50 sm:text-lg">
            {name}
          </p>
          <p className="text-xs uppercase tracking-[0.2em] text-ink-500 dark:text-umber-300">
            {meta}
          </p>
        </div>
      </figcaption>
    </figure>
  );
}

function WhisperTestimonial({
  quote,
  name,
  meta,
  variant,
}: {
  quote: string;
  name: string;
  meta: string;
  variant: 1 | 2 | 3;
}) {
  return (
    <figure>
      <blockquote className="font-serif text-base italic leading-relaxed text-ink-800 dark:text-paper-100">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-4 flex items-center gap-3">
        <CouplePortrait variant={variant} className="h-9 w-9 shrink-0" />
        <div>
          <p className="font-serif text-sm font-semibold text-ink-900 dark:text-paper-50">{name}</p>
          <p className="text-xs text-ink-500 dark:text-umber-300">{meta}</p>
        </div>
      </figcaption>
    </figure>
  );
}

function AudienceRow({
  icon,
  row,
  ctaLabel,
  to,
  onClick,
}: {
  icon: ReactNode;
  row: string;
  ctaLabel: string;
  to?: string;
  onClick?: () => void;
}) {
  const cta = (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-serif text-lg leading-relaxed text-ink-900 dark:text-paper-50 transition-colors hover:text-blush-700 sm:text-xl">
      {ctaLabel}
      <span aria-hidden>→</span>
    </span>
  );
  return (
    <div className="flex items-center gap-4 py-6 sm:gap-6 sm:py-8">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-100 text-blush-700 sm:h-11 sm:w-11">
        {icon}
      </span>
      <p className="flex-1 font-serif text-lg leading-relaxed text-ink-900 dark:text-paper-50 sm:text-xl">
        {row}
      </p>
      <div>
        {to ? (
          <Link to={to}>{cta}</Link>
        ) : (
          <button type="button" onClick={onClick} className="text-left">
            {cta}
          </button>
        )}
      </div>
    </div>
  );
}

function FaqCard({ q, a }: { q: string; a: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-5 py-4 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-6 sm:py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="font-serif text-xl text-ink-900 dark:text-paper-50">{q}</span>
        <ChevronDown
          size={18}
          className="shrink-0 text-ink-500 dark:text-umber-300 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{a}</p>
    </details>
  );
}
