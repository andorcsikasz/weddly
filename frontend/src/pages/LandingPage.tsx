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
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EucalyptusStem } from "../components/botanical";
import { SectionLabel, WatermarkNumeral } from "../components/editorial";
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
  GuestListMockup,
  SeatingMockup,
  WorkspaceMockup,
} from "../components/mockups";
import { DemoLaunchCard } from "../components/DemoLaunchCard";
import { InteractiveBudgetDemo } from "../components/InteractiveBudgetDemo";
import { PublicShell, useGuestCodePrompt } from "../components/PublicShell";
import { publicStatsApi } from "../lib/endpoints";
import { currencySymbol, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { Wordmark } from "../components/Wordmark";
import { SEO_FAQ } from "@shared/seo_faq";

// Mockups have known aspect ratios (from their SVG viewBox). LazyMount uses
// these to reserve layout space, so the page doesn't jump as below-fold
// SVGs mount when scrolled into view.
const MOCKUP_AR_FEATURE = "480 / 360";
const MOCKUP_AR_SUPPLIERS = "320 / 280";
const MOCKUP_AR_WORKSPACE = "656 / 456";

// Stash any `?ref=<source>` query param landing on a public page so the
// signup form can later attach it to the register call (which the backend
// records on `signup_events.referrer_source`). Session-scoped on purpose:
// a guest who landed from /rsvp into the landing → signup → register flow
// should carry the attribution; a re-visit from organic search a week
// later should not be tagged the same.
const REFERRER_SESSION_KEY = "weddly.ref";

export default function LandingPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.home_title", "seo.home_description");
  const askGuestCode = useGuestCodePrompt();
  // Single source of truth (shared/seo_faq.ts) — same array also feeds the
  // FAQPage JSON-LD in seo_ssr.ts, so they can't drift.
  const faqEntries = SEO_FAQ[locale];

  // Capture the `?ref=<source>` query param once on mount. Only the
  // values we expect — `rsvp`, `site` (from /w/:slug footers), `share` —
  // make it into sessionStorage; anything else is dropped so a hostile
  // ?ref=<xss> can't survive into the register payload.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref === "rsvp" || ref === "site" || ref === "share") {
      try {
        window.sessionStorage.setItem(REFERRER_SESSION_KEY, ref);
      } catch {
        // sessionStorage blocked — drop attribution rather than crash.
      }
    }
  }, []);

  return (
    <PublicShell>
      {/* ════════════════════════ 01 · HERO ════════════════════════
          Oversized italic serif title hanging into the left margin, sub
          + CTAs underneath. Mockup follows below as a full-bleed slab,
          tilted slightly so it reads as "the product, peeking up". */}
      <section className="relative overflow-hidden">
        {/* WatercolorBlob removed — flagged as decoration-on-decoration
            sitting behind an already-loud italic headline + tilted demo
            sticker. The hero now leans on the typography alone. */}
        <div className="relative mx-auto max-w-7xl px-4 pt-10 pb-8 sm:px-6 sm:pt-16 lg:pt-20 lg:pb-12">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-14">
            <div>
              {/* Cap with `max-w-[18ch]` on mobile — HU translations are
               * 30–40% longer than EN and the old 14ch limit was wrapping
               * the title to 4+ lines on 360px phones. Desktop still gets
               * the tighter 14ch column for visual rhythm. */}
              <h1 className="max-w-[18ch] font-serif text-4xl italic leading-[1] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:max-w-[14ch] sm:text-7xl sm:leading-[0.96] lg:text-8xl">
                {t("landing.hero_title")}
              </h1>
              <div className="mt-8 sm:max-w-md">
                {/* Full-width thumb targets on mobile so the CTA pair anchors the
                    viewport rather than floating in the upper-left as two thin
                    inline pills. `sm:w-auto` snaps back to content-width for the
                    side-by-side desktop layout. */}
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link
                    to="/signup"
                    className="btn-primary btn-lifted btn-landing btn-lg w-full sm:w-auto"
                  >
                    {t("landing.cta_signup")}
                  </Link>
                  <Link
                    to="/login"
                    className="btn-outline btn-lifted btn-landing btn-lg w-full sm:w-auto"
                  >
                    {t("landing.cta_login")}
                  </Link>
                </div>
                <p className="mt-3 text-xs text-ink-500 dark:text-umber-300">
                  {t("landing.cta_signup_sub")}
                </p>
              </div>
            </div>
            {/* Tilted "try the demo" sticker — small, prominent enough to
                catch the eye, sits to the right of the headline on desktop
                and stacks below the CTAs on mobile. Hits POST /api/demo/start
                and drops the visitor into /app with a seeded workspace. */}
            <div className="flex justify-center lg:justify-end">
              <DemoLaunchCard />
            </div>
          </div>
        </div>

        {/* Full-bleed mockup band — paper-100 background, full screenshot
            visible. The earlier "peeking up" treatment (negative margin
            cropping the bottom of the mockup) read to first-time visitors
            as a UI glitch instead of an intentional crop, so we landed the
            mockup flush against the section's bottom padding. */}
        <div className="relative mt-2 overflow-hidden bg-paper-100 dark:bg-umber-900 pt-6 sm:pt-8 lg:pt-10">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="origin-bottom pb-6 sm:pb-10 lg:pb-14">
              <LazyMount aspectRatio={MOCKUP_AR_WORKSPACE}>
                {/* Rotation + heavy drop-shadow stripped: the page has
                    enough tilted/framed surfaces below (Budget polaroid
                    is the one literal "photo on paper" beat). */}
                <WorkspaceMockup className="h-auto w-full drop-shadow-[0_18px_30px_rgba(16,24,48,0.12)]" />
              </LazyMount>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ Interactive "Try it" demo ════════════════════════
          A no-signup budget calculator using the real DEFAULT_BUDGET_SPLIT.
          The CTA stashes the visitor's numbers into the onboarding draft so
          the wizard picks them up after register + verify. Goal: a visitor
          who plays here will have invested 30s of value before being asked
          to register. */}
      <InteractiveBudgetDemo />

      {/* ════════════════════════ Live counters ════════════════════════
          Two real numbers — onboarded couples + RSVPs collected — fed by
          GET /api/public/stats (60s server-side cache). Hides itself when
          both are 0 so a freshly-seeded environment doesn't broadcast
          "0 pár". This replaces the earlier fake "Open beta" stats band. */}
      <LiveStatsBand />

      {/* ════════════════════════ 02 · Phases ════════════════════════
          Numbered timeline. Each phase has a giant italic numeral
          bleeding behind its title; one continuous rule line at the
          numeral baseline serves as the literal timeline. */}
      <section id="phases" className="relative scroll-mt-20 bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-7xl px-4 pt-10 pb-10 sm:px-6 sm:pt-20 sm:pb-16">
          <SectionLabel num="—" label={t("landing.product_eyebrow")} />
          <h2 className="mt-6 max-w-3xl font-serif text-3xl leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.phases_title")}
          </h2>
          <ol className="mt-12 grid gap-x-6 gap-y-7 sm:gap-y-12 sm:grid-cols-2 lg:grid-cols-5 lg:gap-x-4">
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
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
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
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-20">
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
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-20">
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

      {/* ════════════════════════ 06 · Why — 2×2 ════════════════════════
          Plain section heading + 4 concrete points. The earlier italic
          serif pull-quote ("Először a lényeg…") and the botanical corner
          decorations were both flagged as AI-deck affectations; cut. */}
      <section className="stationery-light">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
            {t("landing.why_eyebrow")}
          </p>
          <h2 className="mx-auto mt-4 max-w-3xl text-center font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.why_title")}
          </h2>
          <ul className="mx-auto mt-10 grid max-w-4xl gap-x-10 gap-y-8 sm:mt-14 sm:grid-cols-2 sm:gap-y-10">
            <WhyPoint title={t("landing.why_a_title")} body={t("landing.why_a_body")} />
            <WhyPoint title={t("landing.why_b_title")} body={t("landing.why_b_body")} />
            <WhyPoint title={t("landing.why_c_title")} body={t("landing.why_c_body")} />
            <WhyPoint title={t("landing.why_d_title")} body={t("landing.why_d_body")} />
          </ul>
        </div>
      </section>

      {/* ════════════════════════ 07 · Suppliers ════════════════════════ */}
      <section id="suppliers" className="relative scroll-mt-20 bg-white dark:bg-umber-900">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:gap-12 sm:px-6 sm:py-20 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <SectionLabel num="—" label={t("landing.phase_suppliers_title")} />
            <h2 className="mt-5 font-serif text-4xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-5xl">
              {t("landing.suppliers_section_title")}
            </h2>
            <p className="mt-5 max-w-xl text-base text-ink-600 dark:text-umber-200 sm:text-lg">
              {t("landing.suppliers_section_body")}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className="btn-primary btn-lifted btn-landing w-full sm:w-auto">
                {t("landing.suppliers_couple_cta")}
              </Link>
              <Link
                to="/vendors#waitlist"
                className="btn-outline btn-lifted btn-landing w-full sm:w-auto"
              >
                {t("landing.suppliers_vendor_cta")}
              </Link>
            </div>
          </div>
          <LazyMount aspectRatio={MOCKUP_AR_SUPPLIERS} className="w-full">
            <SuppliersPreview className="h-auto w-full" />
          </LazyMount>
        </div>
      </section>

      {/* Testimonials section cut — three composite couples with the
          "composite from beta interviews" disclaimer stamped three times
          read as a confession of synthetic social proof. Bring it back
          when we have one real beta couple willing to be named. */}

      {/* ════════════════════════ 09 · Audience — LEDGER ════════════════════════
          Replaced 3 cards with a 3-row ledger: row label, body, → link.
          Reads like a directory page in a printed program. */}
      <section className="relative bg-white dark:bg-umber-900">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-20">
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
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <SectionLabel num="—" label={t("landing.pricing_eyebrow")} className="justify-center" />
          </div>
          <div className="relative mx-auto mt-8 max-w-lg">
            <div className="rounded-2xl bg-paper-50 dark:bg-umber-800 p-8 ring-1 ring-paper-300 dark:ring-umber-700 shadow-[0_30px_60px_-20px_rgba(16,24,48,0.25)] sm:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
                {t("landing.stats_eyebrow")}
              </p>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-serif text-7xl leading-[0.9] text-ink-900 dark:text-paper-50 sm:text-8xl">
                  0
                </span>
                <span className="mb-3 font-serif text-3xl text-ink-700 dark:text-paper-100 sm:text-4xl">
                  {currencySymbol(localeCurrency(locale), locale)}
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
              <Link to="/signup" className="btn-primary btn-lifted btn-landing btn-lg mt-8 w-full">
                {t("landing.cta_signup")}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 11 · FAQ ════════════════════════
          Tight max-w-2xl, italic question-mark headline scaled down so
          the section doesn't dominate vertically on small viewports. */}
      <section className="relative bg-paper-50 dark:bg-umber-900">
        <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
          <h2 className="font-serif text-3xl leading-[1.05] tracking-[-0.01em] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.faq_title")}
          </h2>
          <div className="mt-6 space-y-2 sm:mt-8">
            {faqEntries.map((entry) => (
              <FaqCard key={entry.q} q={entry.q} a={entry.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════ Closing ════════════════════════
          Stationery texture, faded WĒDDLY watermark, huge italic
          headline, signature, eucalyptus stem ornament. */}
      <section className="stationery relative flex min-h-[40vh] items-center sm:min-h-[50vh]">
        {/* One eucalyptus stem only (was two). Botanical decoration kept
            here as the single quiet ornament on the page after the
            BotanicalCorners on the Why section were removed. */}
        <EucalyptusStem className="pointer-events-none absolute bottom-12 right-4 h-20 w-auto text-paper-400 dark:text-umber-600 opacity-70 sm:bottom-20 sm:right-12 sm:h-28" />
        <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <Wordmark size="md" className="text-paper-400 dark:text-umber-600" />
          <h2 className="mt-8 font-serif text-5xl italic leading-[0.96] tracking-tight text-ink-900 dark:text-paper-50 sm:text-7xl lg:text-8xl">
            {t("landing.closing_title")}
          </h2>
          <div className="mt-10 flex justify-center">
            <Link
              to="/signup"
              className="btn-primary btn-lifted btn-landing btn-lg w-full max-w-sm sm:w-auto sm:max-w-none"
            >
              {t("landing.cta_signup")}
            </Link>
          </div>
          <p className="mt-10 font-serif text-sm italic text-ink-500 dark:text-umber-300">
            — {t("landing.brand_signature")}
          </p>
        </div>
      </section>
      <MobileStickySignup />
    </PublicShell>
  );
}

/** Bottom-sticky signup CTA shown only on mobile (`lg:hidden`). Appears
 *  after the visitor scrolls past the hero so the call-to-action never
 *  goes more than a thumb-tap away; hides again when the closing-section
 *  CTA is on screen so the two don't fight visually. Honours
 *  `prefers-reduced-motion` via the CSS-level transition timing. */
function MobileStickySignup() {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        const vh = window.innerHeight;
        const docH = document.documentElement.scrollHeight;
        // Show after the visitor has clearly cleared the hero (~75% of one
        // viewport — calibrated to the hero + mockup-band combined height),
        // and hide once the closing section's own CTA is in view (within the
        // last 600 px) so the sticky bar doesn't duplicate it.
        const past = y > vh * 0.75;
        const nearBottom = y + vh > docH - 600;
        setVisible(past && !nearBottom);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  // When `visible` is false we use the native `inert` attribute (HTML
  // spec, supported in React 19+) which makes the whole subtree
  // unfocusable + invisible to AT in one go — cleaner than aria-hidden
  // on an ancestor of a focusable Link (an ARIA-in-HTML violation).
  return (
    <div
      {...(visible ? {} : { inert: "" as unknown as boolean })}
      className={`pointer-events-none safe-edges fixed inset-x-0 bottom-0 z-30 px-4 pb-4 pt-2 transition-opacity duration-200 lg:hidden ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+8px)] bg-gradient-to-t from-paper-50 via-paper-50/95 to-transparent dark:from-umber-900 dark:via-umber-900/95" />
      <Link
        to="/signup"
        className="btn-primary btn-lifted btn-landing btn-lg pointer-events-auto w-full"
      >
        {t("landing.cta_signup")}
      </Link>
    </div>
  );
}

/** Two-number stats strip fed by GET /api/public/stats. Self-hiding when the
 *  fetch fails OR both counters are 0 — a "0 pár · 0 RSVP" sign reads worse
 *  than no band at all. Numbers are formatted with the user's locale grouping
 *  (`Intl.NumberFormat`), and the eyebrow + labels come from the i18n bundle
 *  so EN/HU stay in sync. */
function LiveStatsBand() {
  const { t, locale } = useT();
  const [stats, setStats] = useState<{ couples: number; rsvps: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicStatsApi
      .get()
      .then((r) => {
        if (!cancelled) setStats({ couples: r.couples, rsvps: r.rsvps });
      })
      .catch(() => {
        // Public counter — never block the page on a fetch failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) return null;
  if (stats.couples === 0 && stats.rsvps === 0) return null;

  const fmt = new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US");

  return (
    <section className="relative bg-paper-100 dark:bg-umber-900">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-center text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
          {t("landing.counter_eyebrow")}
        </p>
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-6 sm:gap-12">
          <StatCounter value={fmt.format(stats.couples)} label={t("landing.counter_couples_label")} />
          <StatCounter value={fmt.format(stats.rsvps)} label={t("landing.counter_rsvps_label")} />
        </div>
        <p className="mt-8 text-center font-serif text-xs italic text-ink-500 dark:text-umber-300">
          {t("landing.counter_footnote")}
        </p>
      </div>
    </section>
  );
}

function StatCounter({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="font-serif text-5xl italic leading-[0.95] text-ink-900 dark:text-paper-50 sm:text-7xl lg:text-8xl">
        {value}
      </div>
      <div className="mt-3 font-serif text-sm text-ink-600 dark:text-umber-200 sm:text-base">
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────── Building blocks ───────────────────────────

function IconRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-blush-700 dark:text-blush-300">
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
    // Mobile: art sits to the left of the title + body so each phase is one
    // compact row rather than a 200 px stack — cuts the section's mobile
    // height in half while keeping the numeral / illustration visual identity.
    // `sm:` flips back to the original vertical card layout for the desktop grid.
    <li className="relative flex flex-row items-start gap-4 sm:flex-col sm:gap-0">
      {/* Big italic numeral floated behind the title — the visual
          anchor for each phase. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-1 -top-8 select-none font-serif text-5xl italic leading-none text-blush-200 dark:text-umber-700 sm:-left-2 sm:-top-10 sm:text-7xl lg:-top-12 lg:text-8xl"
      >
        0{n}
      </span>
      <div className="relative shrink-0">{art}</div>
      <div className="relative min-w-0 flex-1">
        <h3 className="font-serif text-xl text-ink-900 dark:text-paper-50 sm:mt-3">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{body}</p>
      </div>
    </li>
  );
}

function WhyPoint({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <h3 className="font-serif text-xl text-ink-900 dark:text-paper-50 sm:text-2xl">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-600 dark:text-umber-200 sm:text-base">
        {body}
      </p>
    </li>
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
  // The CTA label is hidden behind the arrow on the narrowest viewports so
  // long HU strings (e.g. "Tovább a regisztrációhoz") don't force the row
  // to overflow horizontally. The whole row is still tappable through the
  // wrapping <Link>/<button>, and `aria-label` carries the full intent.
  const cta = (
    <span className="inline-flex items-center gap-2 font-serif text-lg leading-relaxed text-ink-900 transition-colors hover:text-blush-700 dark:text-paper-50 sm:text-xl">
      <span className="hidden sm:inline">{ctaLabel}</span>
      <span aria-hidden>→</span>
    </span>
  );
  return (
    <div className="flex items-center gap-4 py-6 sm:gap-6 sm:py-8">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-700 text-white sm:h-11 sm:w-11 dark:bg-blush-400 dark:text-umber-900">
        {icon}
      </span>
      <p className="min-w-0 flex-1 font-serif text-lg leading-relaxed text-ink-900 dark:text-paper-50 sm:text-xl">
        {row}
      </p>
      <div className="shrink-0">
        {to ? (
          <Link to={to} aria-label={ctaLabel}>
            {cta}
          </Link>
        ) : (
          <button type="button" onClick={onClick} aria-label={ctaLabel} className="text-left">
            {cta}
          </button>
        )}
      </div>
    </div>
  );
}

function FaqCard({ q, a }: { q: string; a: ReactNode }) {
  return (
    <details className="group rounded-xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-4 py-3 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-5 sm:py-3.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="font-serif text-base text-ink-900 dark:text-paper-50 sm:text-lg">{q}</span>
        <ChevronDown
          size={16}
          className="shrink-0 text-ink-500 dark:text-umber-300 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{a}</p>
    </details>
  );
}
