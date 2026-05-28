import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  Filter,
  Globe,
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
import { lazy, type ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EucalyptusStem } from "../components/botanical";
import { SectionLabel, WatermarkNumeral } from "../components/editorial";
import { LazyMount } from "../components/LazyMount";
import { WorkspaceMockup } from "../components/mockups";

// Below-the-fold SVG mockups (Budget, Guests, Seating, Suppliers) are
// heavy (~1500 lines combined) and never visible before the user scrolls.
// Dynamic-import them so they ship in their own chunk instead of being
// part of the eager landing payload. LazyMount's built-in Suspense
// fallback (null) covers the chunk-fetch window; the aspect-ratio div
// already reserves layout space so no jump.
const BudgetMockup = lazy(() =>
  import("../components/mockups").then((m) => ({ default: m.BudgetMockup })),
);
const GuestListMockup = lazy(() =>
  import("../components/mockups").then((m) => ({ default: m.GuestListMockup })),
);
const SeatingMockup = lazy(() =>
  import("../components/mockups").then((m) => ({ default: m.SeatingMockup })),
);
const SuppliersPreview = lazy(() =>
  import("../components/illustrations").then((m) => ({ default: m.SuppliersPreview })),
);
import { DemoLaunchCard } from "../components/DemoLaunchCard";
import { InteractiveBudgetDemo } from "../components/InteractiveBudgetDemo";
import { PublicShell, useGuestCodePrompt } from "../components/PublicShell";
import { publicStatsApi } from "../lib/endpoints";
import { currencySymbol, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { Wordmark } from "../components/Wordmark";
import { SEO_FAQ } from "@shared/seo_faq";
import type { BlogPost } from "@shared/blog_posts";
import { blogApi } from "../lib/endpoints";
import { BlogCover } from "./BlogIndexPage";
import { COUPLE_CARD_DECKS, DECK_SIZE } from "../lib/couple_cards";

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
  const { t, locale, currencyPref } = useT();
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
        {/* Tighter top padding on mobile so the CTA pair stays above the
            fold on 360x640 Android. The hero is H1 + subline + single
            primary CTA. */}
        <div className="relative mx-auto max-w-7xl px-4 pt-6 pb-8 sm:px-6 sm:pt-16 lg:pt-20 lg:pb-12">
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-14">
            <div>
              {/* Cap with `max-w-[18ch]` on mobile — HU translations are
               * 30-40% longer than EN and the old 14ch limit was wrapping
               * the title to 4+ lines on 360px phones. Desktop still gets
               * the tighter 14ch column for visual rhythm. */}
              <h1 className="max-w-[18ch] font-serif text-4xl italic leading-[1] tracking-[-0.02em] text-ink-900 dark:text-paper-50 sm:max-w-[14ch] sm:text-7xl sm:leading-[0.96] lg:text-8xl">
                {t("landing.hero_title")}
              </h1>
              {/* Subline: concrete value-prop sentence right after the
                  poetic headline. Without this, the H1's "in one place"
                  promise lands too abstractly to convert; with it, the
                  visitor sees the actual scope (budget, guests, RSVP,
                  seating, wedding site) before the CTA. */}
              <p className="mt-6 max-w-xl font-serif text-base leading-relaxed text-ink-700 dark:text-paper-100 sm:text-lg">
                {t("landing.hero_sub")}
              </p>
              <div className="mt-8 sm:max-w-md">
                {/* Single primary CTA only. Login moved to the public header
                    (PublicShell) since "I already have an account" is a
                    secondary intent that doesn't deserve hero real-estate. */}
                <Link
                  to="/signup"
                  className="btn-primary btn-lifted btn-landing btn-lg w-full sm:w-auto"
                >
                  {t("landing.cta_signup")}
                </Link>
                <p className="mt-3 text-xs text-ink-600 dark:text-umber-300">
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

      {/* ════════════════════════ 03 · Budget — POLAROID ════════════════════════
          Mockup framed as a tilted polaroid with a watermark "02.1" sitting
          behind it. Copy on the left in a narrow column. The `id="phases"`
          anchor lives here (rather than on a dedicated strip above) so the
          footer "Funkciók" link and the interactive-budget demo's "#phases"
          jump still land on the first feature block. */}
      <section id="phases" className="relative scroll-mt-20 bg-white dark:bg-umber-900">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
            <div>
              <h2 className="font-serif text-3xl italic leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
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
                <p className="mt-4 text-center font-serif text-sm italic text-ink-600 dark:text-umber-300">
                  {t("landing.block_budget_eyebrow")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 04 · Guests — TWO-COLUMN ════════════════════════
          Title + bullets on the left, GuestListMockup on the right so the
          whole block fits inside one viewport. Mobile stacks (title,
          bullets, mockup) — the mockup is wide and reads better below the
          copy at narrow widths. */}
      <section className="relative bg-paper-100/70 dark:bg-umber-900/70">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-12">
            <div>
              <h2 className="font-serif text-3xl italic leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {t("landing.block_guests_title")}
              </h2>
              <ul className="mt-7 space-y-3">
                <IconRow icon={<Smartphone size={16} />}>
                  {t("landing.block_guests_bullet_1")}
                </IconRow>
                <IconRow icon={<Filter size={16} />}>
                  {t("landing.block_guests_bullet_2")}
                </IconRow>
                <IconRow icon={<Download size={16} />}>
                  {t("landing.block_guests_bullet_3")}
                </IconRow>
                <IconRow icon={<Globe size={16} />}>
                  {t("landing.block_guests_bullet_4")}
                </IconRow>
              </ul>
            </div>
            <div>
              <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                <GuestListMockup className="h-auto w-full" />
              </LazyMount>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 05 · Seating — EDGE BLEED ════════════════════════
          Narrow copy column on the left, mockup blown up to bleed off
          the right edge of the viewport. Stationery hairline background
          breaks the paper-50/white monotony with a subtle diagonal
          texture so this mid-page beat reads as a distinct chapter. */}
      <section className="stationery-light relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-center lg:gap-10">
            <div className="max-w-sm">
              <h2 className="font-serif text-3xl italic leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
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
          <h2 className="mx-auto max-w-3xl text-center font-serif text-3xl leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
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
            <h2 className="mt-5 font-serif text-3xl italic leading-[1.1] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
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
          <h2 className="font-serif text-3xl italic leading-[1.1] tracking-tight text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
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
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-800 dark:text-blush-300">
                {t("landing.stats_eyebrow")}
              </p>
              <div className="mt-3 flex items-end gap-3">
                <span className="font-serif text-7xl leading-[0.9] text-ink-900 dark:text-paper-50 sm:text-8xl">
                  0
                </span>
                <span className="mb-3 font-serif text-3xl text-ink-700 dark:text-paper-100 sm:text-4xl">
                  {currencySymbol(currencyPref ?? localeCurrency(locale), locale)}
                </span>
              </div>
              <p className="mt-1 font-serif text-sm italic text-ink-600 dark:text-umber-300">
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

      {/* ════════════════════════ 11.5 · Blog teaser ════════════════════════
          Three latest posts from the static catalogue in
          shared/blog_posts.ts. Each card is a Link into /blog/:slug; the
          section also offers a "Browse the magazine" CTA into the /blog
          index for visitors who want to see the full list. */}
      <BlogTeaser />

      {/* ════════════════════════ 11.6 · Couple-cards teaser ═══════════════
          Four decks of 25 conversation cards. Mini grid mirrors the deck
          picker on the tool page; each tile and the bottom CTA navigate
          to the same tool slug (locale-aware). */}
      <CoupleCardsTeaser />

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
          <p className="mt-10 font-serif text-sm italic text-ink-600 dark:text-umber-300">
            {t("landing.brand_signature")}
          </p>
        </div>
      </section>

      {/* ════════════════════════ 12 · FAQ ════════════════════════
          Anchored as the last section per product call: questions answer
          doubts left over after the emotional closing CTA, and the
          FAQPage JSON-LD near the bottom of the document still indexes
          fine. Tight max-w-2xl, italic question-mark headline scaled
          down so the section doesn't dominate vertically on small
          viewports. */}
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

  return (
    <section className="relative bg-paper-100 dark:bg-umber-900">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-6 sm:gap-12">
          <StatCounter
            value={stats.couples}
            locale={locale}
            label={t("landing.counter_couples_label")}
          />
          <StatCounter
            value={stats.rsvps}
            locale={locale}
            label={t("landing.counter_rsvps_label")}
          />
        </div>
      </div>
    </section>
  );
}

/** One ivory plinth per stat (not per digit) — a hairline-bordered card on
 *  off-white paper, with a barely-there inset hairline at 50% height that
 *  whispers the split-flap reference without becoming the headline.
 *  Whole number sits centered inside in upright Cormorant with tabular
 *  figures so 1s and 8s align. Mounts with a count-up animation: the first
 *  85% of the duration spins through random digits at a steady fast cadence,
 *  the last 15% eases out so the final value lands readable. */
function StatCounter({
  value,
  locale,
  label,
}: {
  value: number;
  locale: string;
  label: string;
}) {
  const display = useFlipTo(value);
  const fmt = useMemo(
    () => new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-US"),
    [locale],
  );
  return (
    <div className="text-center">
      <div className="relative mx-auto flex aspect-[4/5] w-32 items-center justify-center overflow-hidden rounded-md border border-ink-200 bg-paper-50 shadow-soft sm:w-40 lg:w-48 dark:border-umber-700 dark:bg-umber-800">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-8 top-1/2 h-px -translate-y-1/2 bg-paper-300/60 dark:bg-umber-700"
        />
        <span className="relative font-serif text-6xl font-medium tabular-nums leading-none text-ink-900 dark:text-paper-50 sm:text-7xl lg:text-8xl">
          {fmt.format(display)}
        </span>
      </div>
      <div className="mt-5 font-serif text-sm text-ink-600 dark:text-umber-200 sm:mt-6 sm:text-base">
        {label}
      </div>
    </div>
  );
}

/** Count-up "flip" animation. First 85% of the duration shuffles random
 *  N-digit numbers at a steady ~55ms cadence (illegible blur, as requested);
 *  the last 15% drops to a slowing cadence that ramps from ~70ms toward
 *  ~290ms, with the random offset around `target` shrinking each tick so
 *  the final 2-3 values are readable before the card settles. Respects
 *  prefers-reduced-motion (renders the target immediately). */
function useFlipTo(target: number, duration = 1800): number {
  const [display, setDisplay] = useState(() => {
    const safe = Math.max(0, target);
    const len = Math.max(1, String(safe).length);
    return Math.floor(Math.random() * 10 ** len);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      setDisplay(target);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(target);
      return;
    }
    if (target <= 0) {
      setDisplay(target);
      return;
    }

    const len = String(target).length;
    const max = 10 ** len;
    const fastPhaseEnd = duration * 0.85;
    let startTime = 0;
    let lastTick = 0;
    let raf = 0;

    const step = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;

      if (elapsed >= duration) {
        setDisplay(target);
        return;
      }

      const inFast = elapsed < fastPhaseEnd;
      const slowProgress = inFast ? 0 : (elapsed - fastPhaseEnd) / (duration - fastPhaseEnd);
      const cadence = inFast ? 55 : 70 + slowProgress * 220;

      if (now - lastTick >= cadence) {
        lastTick = now;
        if (inFast) {
          setDisplay(Math.floor(Math.random() * max));
        } else {
          const variance = Math.max(1, Math.round((1 - slowProgress) * 6));
          const offset = Math.floor((Math.random() - 0.5) * (variance * 2 + 1));
          setDisplay(Math.max(0, target + offset));
        }
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

/** Blog teaser: three most recent published posts pulled live from
 *  GET /api/blog/posts. Tile-style layout mirrors `/blog` so the section
 *  reads like an excerpt of the index. Self-hides if the fetch fails or
 *  the catalogue is empty so the landing never shows a stub. */
function BlogTeaser() {
  const { t, locale } = useT();
  const [posts, setPosts] = useState<BlogPost[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    blogApi
      .list()
      .then((r) => {
        if (!cancelled) setPosts(r.posts.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!posts || posts.length === 0) return null;

  const fmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <section className="relative bg-paper-50 dark:bg-umber-900">
      {/* Outer wrapper keeps the centered header inside `max-w-6xl`, while
       *  the carousel breaks out edge-to-edge below `sm:` so the cards can
       *  visibly peek past the viewport (a strong swipe affordance on
       *  phones). Tablet+ falls back to the 3-up grid. */}
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-20">
        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-800 dark:text-blush-300">
            {t("blog.section_eyebrow")}
          </p>
          <h2 className="mt-2 font-serif text-2xl italic leading-[1.05] text-ink-900 dark:text-paper-50 sm:mt-3 sm:text-5xl">
            {t("blog.section_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-snug text-ink-600 sm:mt-4 sm:text-base sm:leading-relaxed dark:text-umber-200">
            {t("blog.section_lead")}
          </p>
        </header>
      </div>
      {/* Mobile: horizontal snap carousel so all three posts are visible
       *  through swiping in one viewport. The first card peeks at ~80vw so
       *  the user immediately sees there's more to scroll. Tablet+ keeps
       *  the existing 3-up grid (re-rendered below). */}
      <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-6 sm:hidden [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {posts.map((post) => {
          const copy = post[locale];
          const [y, m, d] = post.published_at.split("-").map(Number);
          const dateLabel =
            y && m && d ? fmt.format(new Date(Date.UTC(y, m - 1, d))) : post.published_at;
          return (
            <li
              key={post.slug}
              className="w-[80vw] max-w-[20rem] shrink-0 snap-start first:ml-0 last:mr-4"
            >
              <Link
                to={`/blog/${post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 dark:border-umber-700 dark:bg-umber-800"
              >
                <BlogCover
                  url={post.cover_image_url ?? null}
                  alt={copy.title}
                  slug={post.slug}
                  category={post.category[locale]}
                />
                <div className="flex flex-1 flex-col p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-blush-800 dark:text-blush-300">
                    {post.category[locale]}
                  </p>
                  <h3 className="mt-2 font-serif text-lg leading-[1.15] text-ink-900 dark:text-paper-50">
                    {copy.title}
                  </h3>
                  <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-ink-600 dark:text-umber-300">
                    <time dateTime={post.published_at}>{dateLabel}</time>
                    <span aria-hidden>·</span>
                    <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mx-auto hidden max-w-6xl px-4 sm:block sm:px-6">
        {/* `items-stretch` on the grid + `h-full` on each Link makes every
            cell take the row-max height; the inner column uses `flex-1` so
            the date/read-time row anchors to the bottom regardless of how
            many lines the title or lead wraps to. Result: three perfectly
            even tiles instead of jagged ones. */}
        <ul className="mt-4 grid gap-x-8 gap-y-10 sm:mt-10 sm:grid-cols-3 sm:items-stretch sm:gap-y-0">
          {posts.map((post) => {
            const copy = post[locale];
            const [y, m, d] = post.published_at.split("-").map(Number);
            const dateLabel =
              y && m && d ? fmt.format(new Date(Date.UTC(y, m - 1, d))) : post.published_at;
            return (
              <li key={post.slug} className="h-full">
                <Link
                  to={`/blog/${post.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-paper-300 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-blush-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:border-umber-700 dark:bg-umber-800 dark:focus-visible:ring-offset-umber-900"
                >
                  <BlogCover
                    url={post.cover_image_url ?? null}
                    alt={copy.title}
                    slug={post.slug}
                    category={post.category[locale]}
                  />
                  <div className="flex flex-1 flex-col p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-800 dark:text-blush-300">
                      {post.category[locale]}
                    </p>
                    <h3 className="mt-3 font-serif text-xl leading-[1.15] text-ink-900 transition-colors group-hover:text-blush-800 dark:text-paper-50 dark:group-hover:text-blush-300 sm:text-2xl">
                      {copy.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-ink-600 dark:text-umber-200">
                      {copy.lead}
                    </p>
                    <div className="mt-auto flex items-center gap-3 pt-5 text-xs text-ink-600 dark:text-umber-300">
                      <time dateTime={post.published_at}>{dateLabel}</time>
                      <span aria-hidden>·</span>
                      <span>{t("blog.read_minutes", { n: post.read_minutes })}</span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-12 flex justify-center">
          <Link to="/blog" className="btn-outline btn-lifted btn-landing btn-lg">
            {t("blog.section_cta")}
          </Link>
        </div>
      </div>
      <div className="flex justify-center pb-10 sm:hidden">
        <Link to="/blog" className="btn-outline btn-landing">
          {t("blog.section_cta")}
        </Link>
      </div>
    </section>
  );
}

// ─────────────────────────── Building blocks ───────────────────────────

function IconRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-blush-800 dark:text-blush-300">
        {icon}
      </span>
      <span className="font-serif text-base text-ink-800 dark:text-paper-100">{children}</span>
    </li>
  );
}

/** Couple-cards teaser: a static mini-grid of the four decks with a single
 *  CTA into the tool page. Tiles and the CTA share the same locale-aware
 *  destination, so an EN visitor lands on the EN canonical slug. */
function CoupleCardsTeaser() {
  const { t, locale } = useT();
  const toolPath =
    locale === "hu"
      ? "/eszkozok/100-kerdes-eskuvo-elott"
      : "/tools/100-questions-before-marriage";
  return (
    <section className="relative bg-white dark:bg-umber-900">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
        <header className="text-center">
          <h2 className="font-serif text-2xl italic leading-[1.05] text-ink-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.couple_cards_title")}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-snug text-ink-600 sm:mt-3 sm:text-base sm:leading-relaxed dark:text-umber-200">
            {t("landing.couple_cards_lead")}
          </p>
        </header>
        {/* All four decks visible at once on mobile via a 2x2 grid in the
         *  requested 2:3 portrait aspect. Tablet stays 2-up; desktop lays
         *  out 4-up. Whole cards are clickable. */}
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:mt-10 sm:gap-4 lg:grid-cols-4 lg:gap-5">
          {COUPLE_CARD_DECKS.map((deck, idx) => (
            <li key={deck.id} className="h-full">
              <Link
                to={toolPath}
                className="group flex aspect-[2/3] h-full flex-col items-center justify-between rounded-2xl bg-wnrs-red px-3 py-4 text-center text-white shadow-[0_24px_50px_-22px_rgba(177,35,42,0.55)] transition-all hover:-translate-y-0.5 hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-wnrs-red focus-visible:ring-offset-2 sm:aspect-[3/4] sm:px-5 sm:py-6 lg:px-6 lg:py-7"
              >
                <span aria-hidden="true" className="block h-1" />
                <div className="flex flex-1 flex-col items-center justify-center">
                  <span className="font-display text-lg font-bold uppercase leading-[0.95] tracking-tight text-white sm:text-2xl lg:text-3xl">
                    {t("tools.couple_cards.deck_number_label", { n: idx + 1 })}
                  </span>
                  <span className="mt-1.5 font-display text-[11px] font-bold uppercase tracking-[0.04em] text-white sm:mt-2 sm:text-sm lg:text-base">
                    ({t(deck.titleKey)})
                  </span>
                </div>
                <span className="font-display text-[8px] font-bold uppercase tracking-[0.24em] text-white sm:text-[10px] sm:tracking-[0.28em]">
                  {t("app.name")} ·{" "}
                  {t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
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
  // CTA label is shown at every viewport — the previous hidden-below-sm
  // collapse left mobile users with only a "→" arrow that read as both
  // too small (sub-44px target) and ambiguous. `whitespace-nowrap` keeps
  // long HU labels ("Tovább a regisztrációhoz") on one line; `text-sm`
  // base / `text-base` from sm trims width without dropping legibility.
  const cta = (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-serif text-sm leading-relaxed text-ink-900 transition-colors hover:text-blush-800 dark:text-paper-50 sm:gap-2 sm:text-xl">
      <span>{ctaLabel}</span>
      <span aria-hidden>→</span>
    </span>
  );
  return (
    <div className="flex items-center gap-3 py-6 sm:gap-6 sm:py-8">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blush-700 text-white sm:h-11 sm:w-11 dark:bg-blush-400 dark:text-umber-900">
        {icon}
      </span>
      {/* Row label is the audience name ("For couples", "For vendors"),
          which acts as the section title for that row — h3 so screen
          readers get a heading landmark, not just running prose. */}
      <h3 className="min-w-0 flex-1 font-serif text-base leading-snug text-ink-900 dark:text-paper-50 sm:text-xl">
        {row}
      </h3>
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
          className="shrink-0 text-ink-600 dark:text-umber-300 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-2.5 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{a}</p>
    </details>
  );
}
