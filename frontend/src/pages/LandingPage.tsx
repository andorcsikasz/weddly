import {
  AlertTriangle,
  ChevronDown,
  Download,
  FileText,
  Filter,
  Gift,
  Globe,
  Heart,
  History,
  Info,
  LayoutGrid,
  Mail,
  Pause,
  Printer,
  Share2,
  Smartphone,
  Sparkles,
  Store,
  Users,
  Wallet,
} from "lucide-react";
import { lazy, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import { useToast } from "../components/ui";
import { publicStatsApi } from "../lib/endpoints";
import { currencySymbol, localeCurrency } from "../lib/format";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { Wordmark } from "../components/Wordmark";
import { SEO_FAQ } from "@shared/seo_faq";
import type { BlogPost } from "@shared/blog_posts";
import { blogApi } from "../lib/endpoints";
import { BlogCover } from "./BlogIndexPage";
import {
  COUPLE_CARD_DECKS,
  type Deck,
  DECK_SIZE,
  isAccentDeck,
  loadLemonadeRevealed,
  redLevel,
  saveLemonadeRevealed,
} from "../lib/couple_cards";

// Hand-rolled hamburger glyph. lucide 0.469 ships no burger icon (only `Beef`),
// and the price tooltip's value-prop is "for the price of a BigMac menu", so we
// draw a burger in the same 24x24 outline style as the rest of the lucide set:
// domed top bun, cheese + patty lines, rounded bottom bun.
function BurgerIcon({ size = 24, ...props }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* Top bun + sesame */}
      <path d="M3.5 10.3C3.5 6.5 7.3 4 12 4s8.5 2.5 8.5 6.3Z" />
      <path d="M8.8 7.4l.5.5M11.7 6.7l.5.5M14.8 7.4l.5.5" strokeWidth={1.4} />
      {/* Lettuce / filling ruffle */}
      <path d="M4 13.1c1.3 1.1 2.7 1.1 4 0s2.7-1.1 4 0 2.7 1.1 4 0 2.7-1.1 4 0" />
      {/* Bottom bun */}
      <path d="M4 16.4h16c0 2.2-1.8 3.6-4 3.6H8c-2.2 0-4-1.4-4-3.6Z" />
    </svg>
  );
}

// Mockups have known aspect ratios (from their SVG viewBox). LazyMount uses
// these to reserve layout space, so the page doesn't jump as below-fold
// SVGs mount when scrolled into view.
const MOCKUP_AR_FEATURE = "496 / 376";
const MOCKUP_AR_SUPPLIERS = "320 / 280";
const MOCKUP_AR_WORKSPACE = "656 / 456";

// Stash any `?ref=<source>` query param landing on a public page so the
// signup form can later attach it to the register call (which the backend
// records on `signup_events.referrer_source`). Session-scoped on purpose:
// a guest who landed from /rsvp into the landing → signup → register flow
// should carry the attribution; a re-visit from organic search a week
// later should not be tagged the same.
const REFERRER_SESSION_KEY = "weddly.ref";
const UTM_SESSION_KEY = "weddly.utm";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

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
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref === "rsvp" || ref === "site" || ref === "share") {
      try {
        window.sessionStorage.setItem(REFERRER_SESSION_KEY, ref);
      } catch {
        // sessionStorage blocked — drop attribution rather than crash.
      }
    }
    // Capture UTM campaign params the same session-scoped way as `?ref`: a
    // signup later in this session carries them; an organic revisit a week
    // later does not. Only the canonical five keys, trimmed and length-capped,
    // so a hostile `?utm_source=<huge>` can't bloat the payload. Stored only
    // when at least one is present so we don't clobber a real capture with {}.
    const utm: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const raw = params.get(key);
      if (raw) utm[key] = raw.slice(0, 200);
    }
    if (Object.keys(utm).length > 0) {
      try {
        window.sessionStorage.setItem(UTM_SESSION_KEY, JSON.stringify(utm));
      } catch {
        // sessionStorage blocked — drop attribution rather than crash.
      }
    }
  }, []);

  // Ticket cut-outs: the pricing card outline is clipped to a rounded rect
  // with a semicircle bitten out of each side edge, centered on the
  // perforation row. We use clip-path: path() rather than a mask because two
  // masked "holes" need cross-browser composite handling that silently falls
  // back to additive (filling the holes back in); path() is deterministic.
  // The path is rebuilt from the measured card size + row center so the
  // notches track the divider across locales and breakpoints.
  const pricingCardRef = useRef<HTMLDivElement>(null);
  const perforationRef = useRef<HTMLDivElement>(null);
  const [ticketClip, setTicketClip] = useState<string | null>(null);
  useEffect(() => {
    const card = pricingCardRef.current;
    const perf = perforationRef.current;
    if (!card || !perf) return;
    const measure = () => {
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const y = perf.offsetTop + perf.offsetHeight / 2; // row center, card coords
      const r = 16; // corner radius, matches rounded-2xl (1rem)
      const n = 22; // notch radius — the half-circle bitten into each edge
      // Clockwise outline (y-down). Convex corners use sweep-flag 1; the two
      // side notches use sweep-flag 0 so the arc bulges inward (a bite).
      const d = [
        `M${r},0`,
        `H${w - r}`,
        `A${r},${r} 0 0 1 ${w},${r}`,
        `V${y - n}`,
        `A${n},${n} 0 0 0 ${w},${y + n}`,
        `V${h - r}`,
        `A${r},${r} 0 0 1 ${w - r},${h}`,
        `H${r}`,
        `A${r},${r} 0 0 1 0,${h - r}`,
        `V${y + n}`,
        `A${n},${n} 0 0 0 0,${y - n}`,
        `V${r}`,
        `A${r},${r} 0 0 1 ${r},0`,
        "Z",
      ].join(" ");
      setTicketClip(`path('${d}')`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  return (
    <PublicShell>
      {/* ════════════════════════ 01 · HERO ════════════════════════
          Oversized italic serif title hanging into the left margin, sub
          + CTAs underneath. Mockup follows below as a full-bleed slab,
          tilted slightly so it reads as "the product, peeking up". */}
      {/* Negative margin pulls the section up behind the sticky header so the
          photo covers the full above-the-fold area on desktop. The header is
          z-40 / bg-paper-50/85 backdrop-blur, so the photo shows through it. */}
      <section className="relative -mt-14 overflow-hidden sm:-mt-[3.5rem]">
        {/* Hero background photo — gradient fade handled by .hero-bg in index.css. */}
        <div aria-hidden="true" className="hero-bg" />
        {/* min-h-dvh makes the hero exactly one viewport tall on desktop.
            pt-24/pt-28 keeps the headline clear of the sticky header. */}
        <div className="relative mx-auto flex min-h-[calc(62svh+3.5rem)] max-w-7xl flex-col justify-center px-4 pt-20 pb-8 sm:min-h-dvh sm:justify-center sm:px-6 sm:pt-28 lg:pt-32 lg:pb-12">
          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-14">
            <div>
              {/* Cap with `max-w-[18ch]` on mobile — HU translations are
               * 30-40% longer than EN and the old 14ch limit was wrapping
               * the title to 4+ lines on 360px phones. Desktop still gets
               * the tighter 14ch column for visual rhythm.
               *
               * The title strings carry authored `\n` line breaks for the
               * stacked mobile headline; `whitespace-pre-line` honours them
               * on mobile, and `sm:whitespace-normal` collapses them back to
               * spaces on desktop so the wrap is driven by max-w-[14ch] as
               * before — desktop copy/layout is unchanged. */}
              <h1 className="max-w-[18ch] whitespace-pre-line font-grotesk text-4xl font-semibold leading-[1] tracking-tight text-umber-900 dark:text-paper-50 sm:max-w-[14ch] sm:whitespace-normal sm:text-7xl sm:leading-[0.96] lg:text-8xl">
                {t("landing.hero_title")}
              </h1>
              {/* Subline removed from the visible hero per request; the
                  hero_sub string still feeds the SEO prerender body. */}
              <div className="mt-4 max-w-[18ch] sm:mt-8 sm:max-w-md">
                {/* Single primary CTA only. Login moved to the public header
                    (PublicShell) since "I already have an account" is a
                    secondary intent that doesn't deserve hero real-estate. */}
                <Link
                  to="/signup"
                  className="btn-primary btn-lifted btn-landing btn-lg w-full sm:w-auto"
                >
                  {t("landing.cta_signup")}
                </Link>
              </div>
            </div>
            {/* Tilted "try the demo" sticker — small, prominent enough to
                catch the eye, sits to the right of the headline on desktop
                and stacks below the CTAs on mobile. Hits POST /api/demo/start
                and drops the visitor into /app with a seeded workspace. */}
            {/* Mobile: drop the demo sticker lower and shove it to the right
                edge so it reads as a distinct secondary intent under the
                primary CTA, not a centered twin of it. Desktop (lg) keeps the
                vertically-centered right column untouched. */}
            <div className="mt-6 flex justify-end lg:mt-0 lg:justify-end">
              <DemoLaunchCard />
            </div>
          </div>
        </div>

        {/* Full-bleed mockup band — paper-100 background, full screenshot
            visible. The earlier "peeking up" treatment (negative margin
            cropping the bottom of the mockup) read to first-time visitors
            as a UI glitch instead of an intentional crop, so we landed the
            mockup flush against the section's bottom padding. */}
        <div className="relative mt-4 overflow-hidden bg-paper-50 dark:bg-umber-900 pt-4 sm:pt-8 lg:pt-10">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <div className="origin-bottom pb-6 sm:pb-10 lg:pb-14">
              <LazyMount aspectRatio={MOCKUP_AR_WORKSPACE}>
                {/* Smaller, shadowless preview per request — the SVG carries
                    its own card frame, so no extra drop shadow. */}
                <WorkspaceMockup className="h-auto w-full" />
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

      {/* ════════════════════════ Founding 200 — HOSPITALITY/SCARCITY ════════════
          The emotional FOMO beat: reframes signing up as "being our guest"
          rather than buying. Real (honest) couples count drives the
          "{n} of 200 founding seats taken" line; the count line self-hides
          once we pass 200 so the offer degrades gracefully. Carries a quick
          share affordance (native share sheet → clipboard fallback) so an
          engaged visitor can pass Weddly to another engaged couple. */}
      <FoundingCouplesBand />

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
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-14">
            <div>
              <h2 className="font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {t("landing.block_budget_title")}
              </h2>
              <ul className="mt-7 space-y-1">
                <IconRow icon={<Wallet size={16} />}>{t("landing.block_budget_bullet_1")}</IconRow>
                <IconRow icon={<Users size={16} />}>{t("landing.block_budget_bullet_2")}</IconRow>
                <IconRow icon={<History size={16} />}>{t("landing.block_budget_bullet_3")}</IconRow>
              </ul>
            </div>
            <div className="relative">
              <div className="relative rotate-[-2deg] bg-white dark:bg-umber-800 p-5 ring-1 ring-paper-300 dark:ring-umber-700 shadow-pop sm:p-6">
                <LazyMount aspectRatio={MOCKUP_AR_FEATURE}>
                  <BudgetMockup className="h-auto w-full" />
                </LazyMount>
                <p className="mt-4 text-center font-serif text-sm italic text-umber-700 dark:text-umber-300">
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
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-12">
            <div>
              <h2 className="font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {t("landing.block_guests_title")}
              </h2>
              <ul className="mt-7 space-y-1">
                <IconRow icon={<Smartphone size={16} />}>
                  {t("landing.block_guests_bullet_1")}
                </IconRow>
                <IconRow icon={<Filter size={16} />}>{t("landing.block_guests_bullet_2")}</IconRow>
                <IconRow icon={<Download size={16} />}>
                  {t("landing.block_guests_bullet_3")}
                </IconRow>
                <IconRow icon={<Globe size={16} />}>{t("landing.block_guests_bullet_4")}</IconRow>
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
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="grid gap-8 lg:grid-cols-[1fr_2fr] lg:items-center lg:gap-10">
            <div className="max-w-sm">
              <h2 className="whitespace-pre-line font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
                {t("landing.block_seating_title")}
              </h2>
              <ul className="mt-7 space-y-1">
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

      {/* ════════════════════════ 07 · Suppliers ════════════════════════ */}
      <section id="suppliers" className="relative scroll-mt-20 bg-white dark:bg-umber-900">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:gap-12 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <h2 className="font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
              {t("landing.suppliers_section_title")}
            </h2>
            <p className="mt-5 max-w-xl font-grotesk text-base text-umber-700 dark:text-umber-200 sm:text-lg">
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
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20">
          <h2 className="font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl">
            {t("landing.audience_title")}
          </h2>
          <div className="mt-8 divide-y divide-paper-300 dark:divide-umber-700 border-y border-paper-300 dark:border-umber-700">
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
          shadow. Leads with the founding offer (free for the first 200
          couples), with the standard 5 €/mo as the muted after-price. */}
      <section className="relative stationery">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 sm:py-20">
          {/* The lift shadow lives on the wrapper as a drop-shadow filter, not
              on the card, because clip-path clips a box-shadow away. As a
              filter on the parent it follows the card's clipped ticket outline,
              so the shadow gets the side notches too. */}
          <div className="relative mx-auto max-w-lg [filter:drop-shadow(0_22px_30px_rgba(16,24,48,0.20))]">
            <div
              ref={pricingCardRef}
              className="relative rounded-2xl bg-paper-50 dark:bg-umber-800 p-6 border border-paper-300 dark:border-umber-700 sm:p-8"
              style={
                ticketClip == null
                  ? undefined
                  : // Clip the card to the ticket outline so the side notches
                    // are real cut-outs that reveal the textured background
                    // behind — no painted fill.
                    { clipPath: ticketClip, WebkitClipPath: ticketClip }
              }
            >
              {/* Value-prop "burger" mark, pinned to the card's top-right corner.
                  Tooltip opens downward since there's no room above at the top. */}
              <span className="group absolute right-5 top-5 sm:right-6 sm:top-6">
                <button
                  type="button"
                  aria-label={t("landing.pricing_value_note")}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-umber-600 transition-colors hover:text-umber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:text-umber-300 dark:hover:text-paper-50"
                >
                  <BurgerIcon size={16} aria-hidden />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-60 rounded-lg bg-umber-900 px-3 py-2 text-xs leading-snug text-paper-50 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-umber-950"
                >
                  {t("landing.pricing_value_note")}
                </span>
              </span>
              <div className="flex items-end gap-2.5">
                <span className="inline-flex items-start font-serif text-6xl leading-[0.9] text-umber-900 dark:text-paper-50 sm:text-7xl">
                  <span>{t("landing.pricing_amount")}</span>
                  {t("landing.pricing_amount_decimal") && (
                    // Decimal rides high as a superscript (e.g. 5·⁵⁰): a small
                    // top pad drops it just enough that its cap-top sits level
                    // with the big "5" cap-top, not buried mid-numeral. The em
                    // here is the big font's (inherited text-6xl/7xl), so the
                    // offset scales with the responsive numeral.
                    <span className="self-start pt-[0.05em] text-[0.4em] leading-none">
                      .{t("landing.pricing_amount_decimal")}
                    </span>
                  )}
                </span>
                <span className="mb-2 font-serif text-3xl text-umber-600 dark:text-umber-200">
                  {currencySymbol(localeCurrency(locale), locale)}
                </span>
                <span className="mb-2.5 font-grotesk text-sm text-umber-600 dark:text-umber-300">
                  {t("landing.pricing_amount_sub")}
                </span>
              </div>
              {/* Early-access window + the regular price it reverts to. */}
              <p className="mt-1.5 font-grotesk text-xs text-umber-600 dark:text-umber-300">
                {t("landing.pricing_early_note")}
              </p>
              <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-umber-100 dark:bg-umber-700/50 px-3 py-2.5 ring-1 ring-umber-200/80 dark:ring-umber-600/50">
                <p className="font-grotesk text-sm leading-snug text-umber-800 dark:text-umber-100">
                  {t("landing.pricing_after")}
                </p>
                {/* Full founding-offer explanation tucked behind an info icon so
                    the callout stays a single readable line. Tooltip shows on
                    hover and keyboard focus. */}
                <span className="group relative ml-auto shrink-0">
                  <button
                    type="button"
                    aria-label={t("landing.pricing_after_detail")}
                    className="flex h-5 w-5 items-center justify-center rounded-full text-umber-600 transition-colors hover:text-umber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:text-umber-300 dark:hover:text-paper-50"
                  >
                    <Info size={16} aria-hidden />
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-64 rounded-lg bg-umber-900 px-3 py-2 text-xs leading-snug text-paper-50 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-umber-950"
                  >
                    {t("landing.pricing_after_detail")}
                  </span>
                </span>
              </div>
              {/* Ticket perforation between the price block and the feature
                  list: a dashed tear-line, with the side half-circle cut-outs
                  punched by the card mask (see the card's style above, which
                  measures this row's center). Inset so the dashes clear the
                  notches. */}
              <div ref={perforationRef} className="my-5 -mx-6 sm:-mx-8" aria-hidden="true">
                <div className="mx-7 border-t border-dashed border-paper-300 dark:border-umber-700" />
              </div>
              <ul className="space-y-2">
                <IconRow tone="coffee" icon={<Gift size={16} />}>
                  {t("landing.pricing_bullet_1")}
                </IconRow>
                <IconRow tone="coffee" icon={<Sparkles size={16} />}>
                  {t("landing.pricing_bullet_2")}
                </IconRow>
                <IconRow tone="coffee" icon={<FileText size={16} />}>
                  {t("landing.pricing_bullet_3")}
                </IconRow>
                <IconRow tone="coffee" icon={<Pause size={16} />}>
                  {t("landing.pricing_bullet_4")}
                </IconRow>
              </ul>
              <Link to="/signup" className="btn-primary btn-lifted btn-landing btn-lg mt-6 w-full">
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
      <section className="stationery relative flex min-h-[40vh] items-center justify-center px-4 py-24 text-center sm:min-h-[50vh] sm:px-6 sm:py-24">
        {/* Only the dark headline lives in flow, so the section's items-center
            puts the *dark text* at the true vertical middle of the stationery.
            The WĒDDLY wordmark above and the desktop CTA below are both
            absolutely positioned (bottom-full / top-full) so their weight
            doesn't pull the headline off center. py-24 reserves the room those
            absolute elements need (their gap + height stays under the 96px
            pads). */}
        <div className="relative w-full max-w-4xl">
          <Wordmark
            size="md"
            className="absolute inset-x-0 bottom-full mb-8 text-paper-400 dark:text-umber-600"
          />
          <h2 className="whitespace-pre-line font-grotesk text-5xl font-semibold leading-[0.96] tracking-tight text-umber-900 dark:text-paper-50 sm:text-6xl lg:text-7xl">
            {t("landing.closing_title")}
          </h2>
          {/* Closing CTA shown on desktop only. On mobile/tablet the persistent
              MobileStickySignup bar already keeps "Start planning" a thumb-tap
              away, so a second button here just duplicates it. */}
          <div className="absolute inset-x-0 top-full mt-10 hidden justify-center lg:flex">
            <Link to="/signup" className="btn-primary btn-lifted btn-landing btn-lg">
              {t("landing.cta_signup")}
            </Link>
          </div>
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
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <h2 className="font-grotesk text-3xl font-semibold leading-[1.05] tracking-tight text-umber-900 dark:text-paper-50 sm:whitespace-nowrap sm:text-4xl">
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
  const [gridRef, inView] = useInView<HTMLDivElement>();
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
    <section className="relative bg-paper-50 dark:bg-umber-900">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-14">
        {/* The count-up only fires once the tiles scroll into view (inView),
            so the flip plays when the user can see it — not silently on load
            while the band is still far below the fold. */}
        <div ref={gridRef} className="mx-auto grid max-w-md grid-cols-2 gap-6 sm:gap-10">
          <StatCounter
            value={stats.couples}
            locale={locale}
            label={t("landing.counter_couples_label")}
            run={inView}
          />
          <StatCounter
            value={stats.rsvps}
            locale={locale}
            label={t("landing.counter_rsvps_label")}
            run={inView}
          />
        </div>
      </div>
    </section>
  );
}

/** Founding-200 hospitality beat. Evergreen marketing copy (renders even if
 *  the stats fetch fails), with an honest "{n} of 200 founding seats taken"
 *  line driven off the real `publicStatsApi` couples count — capped at 200 and
 *  self-hidden once the table is full so we never broadcast "0 left". The
 *  share control prefers the native share sheet (best for "send it to a
 *  friend" on mobile), falling back to clipboard-copy + toast, then a visible
 *  manual-copy URL when the clipboard is refused (insecure context / iframe).
 *  The shared link carries `?ref=share`, the already-sanctioned referrer
 *  source the signup flow records on `signup_events.referrer_source`. */
function FoundingCouplesBand() {
  const { t } = useT();
  const toast = useToast();
  const [couples, setCouples] = useState<number | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicStatsApi
      .get()
      .then((r) => {
        if (!cancelled) setCouples(r.couples);
      })
      .catch(() => {
        // Evergreen section — never block on a stats failure; we just skip
        // the live count line and keep the offer copy.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The hero counts the seats still up for grabs: how many of the 200 free
  // founding places remain. Falls back to the full 200 when the live stats
  // call hasn't resolved (or failed), so the promise still stands.
  const claimed = couples === null ? null : Math.min(couples, 200);
  const remaining = claimed === null ? null : Math.max(0, 200 - claimed);
  const heroSeats = remaining ?? 200;

  async function shareFoundingLink() {
    const url = `${window.location.origin}/?ref=share`;
    // Native share sheet first — the highest-leverage "send to a friend"
    // affordance on mobile. A cancelled sheet rejects with AbortError, which
    // we swallow silently (NOT a reason to fall through to clipboard).
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: t("landing.founders_share_title"),
          text: t("landing.founders_share_text"),
          url,
        });
      } catch {
        // User dismissed the sheet, or the payload was rejected — stay quiet.
      }
      return;
    }
    // Desktop / unsupported: clipboard copy + toast, then a visible URL.
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no_clipboard");
      await navigator.clipboard.writeText(url);
      toast.success(t("landing.founders_share_copied"));
    } catch {
      setCopyFallback(url);
    }
  }

  return (
    // Compact warm-espresso feature-band: a deliberate inversion of the cream
    // page so the founding offer reads as one premium "moment", not another
    // stacked section. Warm umber ground (candlelit, not corporate navy) with a
    // cream-inverse CTA as the single bright object. Two-column on desktop
    // (pitch + promise | the 200 hero, progress and CTA). The 200 leads — it's
    // the offer; the live booked count is a demoted progress sliver underneath.
    // Mobile-only breathing gap above the dark band: the cream page shows
    // through this top margin so the espresso "moment" doesn't butt straight
    // up against the budget card. ~1.4x the prior gap (the budget demo's
    // py-12 = 48px bottom) → +20px ≈ 68px. Reset from sm up.
    <section className="mt-5 bg-umber-900 sm:mt-0">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-9 px-4 py-20 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-12 sm:py-16 sm:text-left">
        {/* Left: the pitch */}
        <div className="sm:max-w-md">
          <h2 className="font-grotesk text-2xl font-medium leading-snug tracking-tight text-paper-50 sm:text-3xl">
            {t("landing.founders_title")}
          </h2>
          {/* Capped + balanced so the promise sits under the title in two even
              rows and never overruns the column. */}
          <p className="mx-auto mt-4 max-w-[19rem] text-balance font-grotesk text-sm leading-relaxed text-paper-300 sm:mx-0 sm:text-base">
            {t("landing.founders_promise")}
          </p>
        </div>

        {/* Right: the live remaining-seats hero + the action row */}
        <div className="flex shrink-0 flex-col items-center gap-4 sm:items-end">
          <div className="flex flex-col items-center sm:items-end">
            <span className="font-grotesk text-6xl font-light tabular-nums leading-none tracking-tighter text-paper-50 sm:text-7xl">
              <FoundingCount value={heroSeats} />
            </span>
            <span className="mt-1 font-grotesk text-[0.7rem] font-medium uppercase tracking-[0.22em] text-paper-400">
              {t("landing.founders_seats_label")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/signup"
              className="btn btn-landing btn-lg bg-paper-50 px-8 font-grotesk text-xs uppercase tracking-[0.2em] text-umber-950 hover:bg-paper-200"
            >
              {t("landing.founders_cta")}
            </Link>
            <button
              type="button"
              onClick={shareFoundingLink}
              aria-label={t("landing.founders_share_cta")}
              title={t("landing.founders_share_cta")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-paper-300 transition-colors hover:bg-paper-50/10 hover:text-paper-50"
            >
              <Share2 size={18} aria-hidden />
            </button>
          </div>
          {copyFallback && (
            <p className="mt-1 max-w-xs break-all text-xs text-paper-400">{copyFallback}</p>
          )}
        </div>
      </div>
    </section>
  );
}

/** Inline count-up number for the founding-seats line — reuses the same
 *  `useFlipTo` flip animation as the live stat plinths so the number lands
 *  with matching gravitas (and respects prefers-reduced-motion). */
function FoundingCount({ value }: { value: number }) {
  const display = useFlipTo(value);
  return <>{display}</>;
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
  run,
}: {
  value: number;
  locale: string;
  label: string;
  run: boolean;
}) {
  const display = useFlipTo(value, run);
  const fmt = useMemo(() => new Intl.NumberFormat(locale === "hu" ? "hu-HU" : "en-GB"), [locale]);
  return (
    <div className="text-center">
      {/* Vintage split-flap tile — espresso card, cream serif digit, and a
          dark seam across the middle with a hairline highlight just below
          for the flap-card depth (coffee-shop counter / old tennis
          scoreboard). */}
      <div className="relative mx-auto flex aspect-[5/6] w-12 items-center justify-center overflow-hidden rounded-lg bg-umber-900 shadow-pop ring-1 ring-umber-950/50 sm:w-20 lg:w-24 dark:bg-umber-950 dark:ring-umber-700/60">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-[2px] -translate-y-px bg-black/30"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px translate-y-px bg-paper-50/12"
        />
        <span className="relative translate-y-[0.08em] font-serif text-2xl font-semibold tabular-nums leading-none text-paper-50 sm:text-4xl lg:text-5xl">
          {fmt.format(display)}
        </span>
      </div>
      <div className="mx-auto mt-2.5 max-w-[7rem] font-grotesk text-[11px] font-medium uppercase tracking-[0.18em] text-umber-700 dark:text-umber-200 sm:max-w-none sm:text-xs">
        {label}
      </div>
    </div>
  );
}

/** Count-up animation: eases the display from 0 up to `target` over
 *  `duration`, strictly monotonically — no random shuffle, no jumping, no
 *  overshoot. Uses an ease-out cubic so the number decelerates into its
 *  final value and lands exactly on `target`. Honours prefers-reduced-motion
 *  (renders the target immediately). */
function useFlipTo(target: number, run = true, duration = 1800): number {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    // Hold at 0 until `run` flips true (e.g. the counter scrolls into view),
    // so the count-up plays when the user can actually see it.
    if (!run) return;
    if (typeof window === "undefined") {
      setDisplay(target);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || target <= 0) {
      setDisplay(target);
      return;
    }

    let startTime = 0;
    let raf = 0;
    const easeOut = (t: number) => 1 - (1 - t) ** 3;

    const step = (now: number) => {
      if (!startTime) startTime = now;
      const t = Math.min(1, (now - startTime) / duration);
      // easeOut is monotonic increasing, so rounding * target never decreases
      // and never exceeds target — a clean count-up.
      setDisplay(Math.min(target, Math.round(easeOut(t) * target)));
      if (t < 1) raf = requestAnimationFrame(step);
    };

    setDisplay(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration]);

  return display;
}

/** Returns a callback ref + a boolean that flips true once the element scrolls
 *  into view (and stays true). Falls back to true where IntersectionObserver is
 *  unavailable so content never gets stuck hidden.
 *
 *  A *callback* ref (not useRef + useEffect) is deliberate: consumers like the
 *  live-stats band render `null` until their data loads, so the observed node
 *  mounts on a later render. A one-shot mount effect would read `ref.current`
 *  while it's still null and never re-attach — leaving `inView` stuck false and
 *  the count-up frozen at 0. The callback ref fires whenever the node actually
 *  attaches, so observation starts the moment the element exists. */
function useInView<T extends HTMLElement>() {
  const [inView, setInView] = useState(false);
  const obsRef = useRef<IntersectionObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    obsRef.current?.disconnect();
    obsRef.current = null;
    if (el === null || typeof window === "undefined") return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    obs.observe(el);
    obsRef.current = obs;
  }, []);
  return [ref, inView] as const;
}

/** Slug pinned to the featured slot on the landing teaser. The Bible-
 *  verses post is the one we want every first-time visitor to see; the
 *  other two slots cycle through the rest of the catalogue at random so
 *  the section feels alive instead of static. */
const FEATURED_SLUG = "bibliai-idezetek-eskuvore";

/** Blog teaser: one pinned featured post (Bible verses) plus two random
 *  others from the live catalogue. The asymmetric desktop layout (big
 *  card left, two small cards stacked right) gives the section visual
 *  rhythm instead of the boxy 3-up grid. Self-hides if the fetch fails
 *  or the catalogue is empty. */
function BlogTeaser() {
  const { t, locale } = useT();
  const [posts, setPosts] = useState<BlogPost[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    blogApi
      .list()
      .then((r) => {
        if (cancelled) return;
        const featured = r.posts.find((p) => p.slug === FEATURED_SLUG);
        const others = r.posts.filter((p) => p.slug !== FEATURED_SLUG);
        // Math.random sort is biased but the bias is invisible for a
        // 2-pick from a small array; lets the mix change on every visit
        // without ceremony.
        const shuffled = [...others].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, 2);
        setPosts(featured ? [featured, ...picked] : r.posts.slice(0, 3));
      })
      .catch(() => {
        if (!cancelled) setPosts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!posts || posts.length === 0) return null;

  const fmt = new Intl.DateTimeFormat(locale === "hu" ? "hu-HU" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <section className="relative bg-paper-50 pt-12 sm:pt-20 dark:bg-umber-900">
      {/* Title removed per request — the cards speak for themselves. */}
      {/* Mobile: horizontal snap carousel so all three posts are visible
       *  through swiping in one viewport. The first card peeks at ~80vw so
       *  the user immediately sees there's more to scroll. Tablet+ keeps
       *  the existing 3-up grid (re-rendered below). */}
      <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-6 scroll-pl-6 sm:hidden [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {posts.map((post) => {
          const copy = post[locale];
          const [y, m, d] = post.published_at.split("-").map(Number);
          const dateLabel =
            y && m && d ? fmt.format(new Date(Date.UTC(y, m - 1, d))) : post.published_at;
          return (
            <li key={post.slug} className="w-[80vw] max-w-[20rem] shrink-0 snap-start">
              <Link
                to={`/blog/${locale === "en" ? (post.en_slug ?? post.slug) : post.slug}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-800 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:border-ink-700 dark:bg-umber-800"
              >
                <BlogCover
                  url={post.cover_image_url ?? null}
                  alt={copy.title}
                  slug={post.slug}
                  category={post.category[locale]}
                />
                <div className="flex flex-1 flex-col p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-300">
                    {post.category[locale]}
                  </p>
                  <h3 className="mt-1.5 font-grotesk text-base font-semibold leading-[1.15] tracking-tight text-umber-900 dark:text-paper-50">
                    {copy.title}
                  </h3>
                  <div className="mt-auto flex items-center gap-2 pt-2 text-[11px] text-umber-700 dark:text-umber-300">
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
      <div className="mx-auto hidden max-w-6xl px-4 pb-16 sm:block sm:px-6 sm:pb-20">
        {/* Bottom padding gives the lifted CTA's drop shadow room to render
            inside this section — without it the shadow overflows the section
            edge and the next (opaque) section paints over it, clipping it. */}
        {/* `items-stretch` on the grid + `h-full` on each Link makes every
            cell take the row-max height; the inner column uses `flex-1` so
            the date/read-time row anchors to the bottom regardless of how
            many lines the title or lead wraps to. Result: three perfectly
            even tiles instead of jagged ones. */}
        <ul className="mt-4 grid gap-x-8 gap-y-10 sm:mt-2 sm:grid-cols-3 sm:items-stretch sm:gap-y-0">
          {posts.map((post) => {
            const copy = post[locale];
            const [y, m, d] = post.published_at.split("-").map(Number);
            const dateLabel =
              y && m && d ? fmt.format(new Date(Date.UTC(y, m - 1, d))) : post.published_at;
            return (
              <li key={post.slug} className="h-full">
                <Link
                  to={`/blog/${locale === "en" ? (post.en_slug ?? post.slug) : post.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-800 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:border-ink-700 dark:bg-umber-800 dark:focus-visible:ring-offset-umber-900"
                >
                  <BlogCover
                    url={post.cover_image_url ?? null}
                    alt={copy.title}
                    slug={post.slug}
                    category={post.category[locale]}
                  />
                  <div className="flex flex-1 flex-col p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-300">
                      {post.category[locale]}
                    </p>
                    <h3 className="mt-2 font-grotesk text-lg font-semibold leading-[1.15] tracking-tight text-umber-900 transition-colors group-hover:text-umber-500 dark:text-paper-50 dark:group-hover:text-umber-300 sm:text-xl">
                      {copy.title}
                    </h3>
                    <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-umber-700 dark:text-umber-300">
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
      <div className="flex justify-center pb-12 sm:hidden">
        <Link to="/blog" className="btn-outline btn-landing">
          {t("blog.section_cta")}
        </Link>
      </div>
    </section>
  );
}

// ─────────────────────────── Building blocks ───────────────────────────

function IconRow({
  icon,
  children,
  tone = "blush",
}: {
  icon: ReactNode;
  children: ReactNode;
  // "coffee" swaps the accent to the warm umber/oat palette (used on the
  // pricing card) instead of the default blush so no pink/red leaks in.
  tone?: "blush" | "coffee";
}) {
  const iconColor =
    tone === "coffee" ? "text-umber-600 dark:text-umber-300" : "text-umber-500 dark:text-umber-300";
  return (
    <li className="flex items-center gap-3">
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center ${iconColor}`}>
        {icon}
      </span>
      <span className="font-grotesk text-base text-umber-900 dark:text-paper-100">{children}</span>
    </li>
  );
}

/** Couple-cards teaser: a static mini-grid of the four decks with a single
 *  CTA into the tool page. Tiles and the CTA share the same locale-aware
 *  destination, so an EN visitor lands on the EN canonical slug. */
function CoupleCardsTeaser() {
  const { t, locale } = useT();
  const toolPath =
    locale === "hu" ? "/eszkozok/100-kerdes-eskuvo-elott" : "/tools/100-questions-before-marriage";

  // Mirror the tool-page easter egg here: a horizontal swipe on the deck
  // row reveals a hidden accent card tucked off the edge. Right-swipe
  // reveals lemonade (off the RIGHT edge); left-swipe reveals firstdate
  // (off the LEFT edge). Lemonade reveal is persisted via the shared
  // localStorage key so unlocking on either surface lights both up;
  // firstdate stays session-ephemeral like the tool page.
  const [isLemonadeRevealed, setIsLemonadeRevealed] = useState<boolean>(() =>
    loadLemonadeRevealed(),
  );
  const [isFirstDateRevealed, setIsFirstDateRevealed] = useState<boolean>(false);
  const visibleDecks = useMemo(
    () =>
      COUPLE_CARD_DECKS.filter(
        (deck) =>
          (deck.id !== "lemonade" || isLemonadeRevealed) &&
          (deck.id !== "firstdate" || isFirstDateRevealed),
      ),
    [isLemonadeRevealed, isFirstDateRevealed],
  );
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const wheelAcc = useRef(0);
  const revealLemonade = () => {
    setIsLemonadeRevealed(true);
    saveLemonadeRevealed();
  };
  const handleSwipeStart = (e: React.PointerEvent<HTMLUListElement>) => {
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const handleSwipeEnd = (e: React.PointerEvent<HTMLUListElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) <= 50 || Math.abs(dx) <= Math.abs(dy)) return;
    // Right-swipe pulls the row right → reveals lemonade off the right
    // edge; left-swipe reveals firstdate off the left edge.
    if (dx > 0) revealLemonade();
    else setIsFirstDateRevealed(true);
  };
  // macOS trackpad horizontal swipes fire wheel events with deltaX, not
  // pointer events. Accumulate horizontal deltaX and trip the matching
  // reveal once 60px have piled up; a vertical wheel resets the counter so
  // page scroll never accidentally unlocks the egg.
  const handleWheel = (e: React.WheelEvent<HTMLUListElement>) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      wheelAcc.current += e.deltaX;
      if (wheelAcc.current > 60) {
        revealLemonade();
        wheelAcc.current = 0;
      } else if (wheelAcc.current < -60) {
        setIsFirstDateRevealed(true);
        wheelAcc.current = 0;
      }
    } else {
      wheelAcc.current = 0;
    }
  };

  return (
    <section className="relative bg-white dark:bg-umber-900">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="text-center">
          <h2 className="font-grotesk text-2xl font-semibold leading-[1.05] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
            {t("landing.couple_cards_title")}
          </h2>
        </header>
        {/* Mobile: an infinite 3D coverflow — one deck centered, the prev/next
         *  decks peeking in at the sides, swipeable around a circular track.
         *  Tablet+ keeps the flat grid below. */}
        <CoupleCardsCarousel decks={visibleDecks} toolPath={toolPath} />
        {/* Tablet/desktop: all decks visible at once via a grid in the
         *  requested 2:3 portrait aspect. Tablet stays 2-up; desktop lays
         *  out 4-up. Whole cards are clickable. A horizontal swipe (>50px)
         *  on the row reveals the hidden 5th lemonade deck — same easter
         *  egg as the tool page. */}
        <ul
          onPointerDown={handleSwipeStart}
          onPointerUp={handleSwipeEnd}
          onPointerCancel={() => {
            swipeStart.current = null;
          }}
          onWheel={handleWheel}
          style={{ touchAction: "pan-y" }}
          className={`mt-5 hidden grid-cols-2 gap-3 sm:mt-10 sm:grid sm:gap-4 lg:gap-5 ${
            visibleDecks.length >= 6
              ? "lg:grid-cols-6"
              : visibleDecks.length === 5
                ? "lg:grid-cols-5"
                : "lg:grid-cols-4"
          }`}
        >
          {visibleDecks.map((deck) => {
            const isLemonade = deck.id === "lemonade";
            const isFirstDate = deck.id === "firstdate";
            const isAccent = isAccentDeck(deck.id);
            const hasCards = deck.questionsEn.length > 0;
            return (
              <li key={deck.id} className="h-full">
                <Link
                  to={`${toolPath}?deck=${deck.id}`}
                  className={`group flex aspect-[2/3] h-full flex-col items-center justify-between overflow-hidden rounded-2xl px-3 py-4 text-center transition-transform hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:aspect-[3/4] sm:px-5 sm:py-6 lg:px-6 lg:py-7 ${
                    isLemonade
                      ? "bg-lemonade-yellow text-lemonade-ink shadow-[0_18px_36px_-18px_rgba(161,98,7,0.55)] focus-visible:ring-lemonade-yellow"
                      : isFirstDate
                        ? "bg-firstdate-blue text-white shadow-[0_18px_36px_-18px_rgba(30,58,138,0.5)] focus-visible:ring-firstdate-blue"
                        : "bg-wnrs-red text-white shadow-[0_18px_36px_-18px_rgba(204,31,40,0.5)] focus-visible:ring-wnrs-red"
                  }`}
                >
                  <span aria-hidden="true" className="block h-1" />
                  <div className="flex flex-1 flex-col items-center justify-center">
                    <span className="font-display text-lg font-bold uppercase leading-[0.95] tracking-tight sm:text-2xl lg:text-3xl">
                      {isAccent
                        ? t(deck.titleKey).toUpperCase()
                        : t("tools.couple_cards.deck_number_label", { n: redLevel(deck.id) })}
                    </span>
                    {!isAccent ? (
                      <span className="mt-1.5 font-display text-[11px] font-bold uppercase tracking-[0.04em] sm:mt-2 sm:text-sm lg:text-base">
                        {t(deck.titleKey)}
                      </span>
                    ) : null}
                  </div>
                  <span className="font-display text-[8px] font-bold uppercase tracking-[0.24em] sm:text-[10px] sm:tracking-[0.28em]">
                    {"WĒDDLY · "}
                    {hasCards
                      ? t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })
                      : t("tools.couple_cards.deck_soon_label")}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Mobile-only infinite 3D coverflow for the 100-questions decks. The active
 *  deck sits full-size in the centre; the previous and next decks peek in from
 *  the sides, scaled down and angled in perspective (the cards themselves stay
 *  flat rectangles — the 3D read comes only from translate / scale / rotateY /
 *  opacity / z-index, never from warping the card). Swiping wraps around a
 *  circular track, so there is no first or last card. Tablet+ uses the flat
 *  grid instead (this component is `sm:hidden`). */
function CoupleCardsCarousel({ decks, toolPath }: { decks: readonly Deck[]; toolPath: string }) {
  const { t } = useT();
  const n = decks.length;
  const [active, setActive] = useState(0);
  // Live drag offset in px while the finger is down; 0 when settled.
  const [dragDx, setDragDx] = useState(0);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  // True for the click that fires right after a swipe so it doesn't navigate.
  const swallowClick = useRef(false);

  // One "step" of travel ≈ how far a neighbour sits from centre (56vw). Used to
  // turn pixel drag into a fractional card offset so the flip tracks the finger.
  const unitPx = () => (typeof window === "undefined" ? 360 : window.innerWidth * 0.56);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = drag.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 6) s.moved = true;
    // Cap the live drag at ±1 card so a single swipe advances one deck.
    setDragDx(clamp(dx, -unitPx(), unitPx()));
  };
  const onUp = () => {
    const s = drag.current;
    drag.current = null;
    const dx = dragDx;
    setDragDx(0);
    if (!s) return;
    if (s.moved) swallowClick.current = true;
    const threshold = unitPx() * 0.18;
    const step = dx <= -threshold ? 1 : dx >= threshold ? -1 : 0;
    if (step !== 0) setActive((a) => (((a + step) % n) + n) % n);
  };

  // Signed circular distance of card i from the active card, in [-n/2, n/2].
  const circularDelta = (i: number) => {
    let d = (((i - active) % n) + n) % n;
    if (d > n / 2) d -= n;
    return d;
  };

  const frac = drag.current ? dragDx / unitPx() : 0;

  return (
    <div className="sm:hidden">
      <div
        /* Clip horizontally: the side/off-screen cards translate up to
           ±112vw (translateX(p*56vw)), which otherwise widens the document
           past the viewport. That page-level horizontal overflow made the
           fixed bottom signup bar stretch to the scroll-width and spill off
           the right edge on phones. Clipping here keeps the peeking cards
           inside the viewport and the page non-scrollable sideways. */
        className="relative mt-6 select-none overflow-x-clip [perspective:1100px]"
        style={{ height: "58vw", touchAction: "pan-y" }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {decks.map((deck, idx) => {
          const baseDelta = circularDelta(idx);
          const p = baseDelta + frac; // continuous position while dragging
          const ap = Math.abs(p);
          const hidden = ap > 1.6;
          const isActive = baseDelta === 0;
          const scale = Math.max(0.7, 1 - 0.16 * ap);
          const rot = clamp(-p * 34, -38, 38);
          const opacity = hidden ? 0 : Math.max(0, 1 - 0.42 * ap);
          const isLemonade = deck.id === "lemonade";
          const isFirstDate = deck.id === "firstdate";
          const isAccent = isAccentDeck(deck.id);
          const hasCards = deck.questionsEn.length > 0;
          return (
            <Link
              key={deck.id}
              to={`${toolPath}?deck=${deck.id}`}
              aria-hidden={hidden}
              tabIndex={isActive ? 0 : -1}
              onClick={(e) => {
                if (swallowClick.current) {
                  swallowClick.current = false;
                  e.preventDefault();
                  return;
                }
                // Tapping a side card brings it to centre instead of navigating.
                if (!isActive) {
                  e.preventDefault();
                  setActive(idx);
                }
              }}
              className="absolute left-1/2 top-1/2 block w-[76vw] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-wnrs-red"
              style={{
                transform: `translate(-50%, -50%) translateX(${p * 56}vw) scale(${scale}) rotateY(${rot}deg)`,
                opacity,
                zIndex: Math.round(100 - ap * 10),
                pointerEvents: hidden ? "none" : "auto",
                transition: drag.current
                  ? "none"
                  : "transform 380ms cubic-bezier(.22,.61,.36,1), opacity 380ms ease",
                willChange: "transform",
              }}
            >
              {/* Landscape (3/2) face matching the tool's deck-cover card:
               *  number headline, parenthesised deck title, WĒDDLY footer. */}
              <div
                className={`flex aspect-[3/2] w-full flex-col items-center justify-between overflow-hidden rounded-2xl px-7 py-8 text-center ${
                  isLemonade
                    ? "bg-lemonade-yellow text-lemonade-ink shadow-[0_24px_50px_-20px_rgba(161,98,7,0.6)]"
                    : isFirstDate
                      ? "bg-firstdate-blue text-white shadow-[0_24px_50px_-20px_rgba(30,58,138,0.5)]"
                      : "bg-wnrs-red text-white shadow-[0_24px_50px_-20px_rgba(204,31,40,0.6)]"
                }`}
              >
                <span aria-hidden className="block h-1" />
                <div className="flex flex-1 flex-col items-center justify-center">
                  <span className="font-display text-4xl font-bold uppercase leading-[0.95] tracking-tight">
                    {isAccent
                      ? t(deck.titleKey).toUpperCase()
                      : t("tools.couple_cards.deck_number_label", { n: redLevel(deck.id) })}
                  </span>
                  {!isAccent ? (
                    <span className="mt-4 font-display text-lg font-bold uppercase tracking-[0.04em]">
                      ({t(deck.titleKey)})
                    </span>
                  ) : null}
                </div>
                <span className="font-display text-xs font-bold uppercase tracking-[0.28em]">
                  {"WĒDDLY · "}
                  {hasCards
                    ? t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })
                    : t("tools.couple_cards.deck_soon_label")}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      {/* Position dots — affordance that the track wraps. */}
      <div className="mt-4 flex justify-center gap-1.5">
        {decks.map((deck, idx) => (
          <button
            key={deck.id}
            type="button"
            aria-label={t("tools.couple_cards.deck_number_label", { n: idx + 1 })}
            onClick={() => setActive(idx)}
            className={`h-1.5 rounded-full transition-all ${
              circularDelta(idx) === 0 ? "w-5 bg-wnrs-red" : "w-1.5 bg-umber-300 dark:bg-umber-700"
            }`}
          />
        ))}
      </div>
    </div>
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
  // The whole row is the target — a full-width hover wash plus an arrow
  // that nudges right reads as more polished (and gives a 44px+ tap area)
  // than the old CTA-only link. `whitespace-nowrap` keeps long HU labels
  // ("Tovább a regisztrációhoz") on one line; the CTA stays visible at
  // every viewport so mobile never sees an ambiguous lone arrow.
  const className =
    "group flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800/50 sm:gap-5 sm:py-5";
  const inner = (
    <>
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-umber-600 text-white dark:bg-umber-400 dark:text-umber-900 sm:h-10 sm:w-10">
        {icon}
      </span>
      {/* Row label is the audience name ("For couples", "For vendors"),
          which acts as the section title for that row — h3 so screen
          readers get a heading landmark, not just running prose. */}
      <h3 className="min-w-0 flex-1 font-grotesk text-base font-medium leading-snug text-umber-900 dark:text-paper-50 sm:text-lg">
        {row}
      </h3>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-grotesk text-sm font-medium text-umber-800 transition-colors group-hover:text-umber-500 dark:text-paper-200 dark:group-hover:text-umber-300 sm:text-base">
        <span>{ctaLabel}</span>
        <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">
          →
        </span>
      </span>
    </>
  );
  const label = `${row}: ${ctaLabel}`;
  return to ? (
    <Link to={to} aria-label={label} className={className}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} className={className}>
      {inner}
    </button>
  );
}

function FaqCard({ q, a }: { q: string; a: ReactNode }) {
  return (
    <details className="group rounded-xl border border-paper-300 dark:border-umber-700 bg-paper-50 dark:bg-umber-800 px-4 py-3 transition-colors open:bg-white dark:open:bg-umber-700 sm:px-5 sm:py-3.5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
        <span className="font-grotesk text-base font-medium text-umber-900 dark:text-paper-50 sm:text-lg">
          {q}
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 text-umber-700 dark:text-umber-300 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="mt-2.5 font-grotesk text-sm leading-relaxed text-umber-700 dark:text-umber-200">
        {a}
      </p>
    </details>
  );
}
