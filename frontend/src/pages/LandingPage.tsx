import {
  AlertTriangle,
  Briefcase,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
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
  Plus,
  Printer,
  Share2,
  Smartphone,
  Sparkles,
  Store,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import { type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LazyMount } from "../components/LazyMount";

// Below-the-fold SVG mockups (Budget, Guests, Seating, Suppliers) are
// heavy (~1500 lines combined) and never visible before the user scrolls.
// Dynamic-import them so they ship in their own chunk instead of being
// part of the eager landing payload. LazyMount's built-in Suspense
// fallback (null) covers the chunk-fetch window; the aspect-ratio div
// already reserves layout space so no jump.
const BudgetMockup = lazyWithReload(() =>
  import("../components/mockups").then((m) => ({ default: m.BudgetMockup })),
);
const SeatingMockup = lazyWithReload(() =>
  import("../components/mockups").then((m) => ({ default: m.SeatingMockup })),
);
const SubmitSupplierModal = lazyWithReload(() =>
  import("../components/SubmitSupplierModal").then((m) => ({ default: m.SubmitSupplierModal })),
);
import { DemoLaunchButton } from "../components/DemoLaunchButton";
import { NewsletterCapture } from "../components/NewsletterCapture";
import { VendorSearchBar } from "../components/VendorSearchBar";
import { InteractiveBudgetDemo } from "../components/InteractiveBudgetDemo";
import { PublicShell, useGuestCodePrompt } from "../components/PublicShell";
import { useToast } from "../components/ui";
import { publicStatsApi } from "../lib/endpoints";
import { currencySymbol, formatNumber, intlLocale, localeCurrency } from "../lib/format";
import { contentLocale, type Locale, useT } from "../lib/i18n";
import { lazyWithReload } from "../lib/lazy_reload";
import { useDocumentMeta } from "../lib/seo";
import { Wordmark } from "../components/Wordmark";
import { SEO_FAQ } from "@shared/seo_faq";
// Every price the deck quotes comes from the billing contract, so the landing
// page and Stripe cannot tell a visitor two different numbers.
import { monthlyPrice } from "@shared/billing";
import { plannerPrice } from "@shared/planner_billing";
import { VENDOR_FOUNDING_CAP, vendorPrice } from "@shared/vendor_billing";
import type { BlogPost } from "@shared/blog_posts";
import { blogApi } from "../lib/endpoints";
import { blogCopy } from "@shared/blog_posts";
import { BlogCover } from "./BlogIndexPage";
import {
  COUPLE_CARD_DECKS,
  type Deck,
  DECK_SIZE,
  deckHasCards,
  isAccentDeck,
  loadLemonadeRevealed,
  redLevel,
  saveLemonadeRevealed,
} from "../lib/couple_cards";

// Hero "who are you" chips. Collapsed to an icon-only pill; the label track
// animates from 0fr → 1fr on hover/focus (overflow-hidden gives the grid track
// a 0 min-width so it can fully collapse). aria-label carries the full label so
// the control stays legible to assistive tech even while the text is clipped.
const roleChipClass =
  "group inline-flex items-center rounded-full border border-paper-400/70 bg-paper-50/70 py-2 pl-2.5 pr-2.5 text-umber-900 shadow-soft transition-colors duration-200 hover:border-umber-800 hover:bg-umber-900 hover:text-paper-50 focus-visible:border-umber-800 focus-visible:bg-umber-900 focus-visible:text-paper-50 dark:border-umber-700 dark:bg-umber-800/50 dark:text-paper-100 dark:hover:border-paper-200 dark:hover:bg-paper-50 dark:hover:text-umber-950 dark:focus-visible:border-paper-200 dark:focus-visible:bg-paper-50 dark:focus-visible:text-umber-950";
const roleChipTextWrap =
  "grid grid-cols-[0fr] transition-[grid-template-columns] duration-300 ease-out group-hover:grid-cols-[1fr] group-focus-visible:grid-cols-[1fr]";
const roleChipText =
  "overflow-hidden whitespace-nowrap pl-2 font-grotesk text-sm font-medium tracking-tight";

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
  // Community "recommend a supplier" wizard, opened from the directory block.
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Make the sticky header transparent while the hero section is still visible.
  // IntersectionObserver removes the class as soon as the hero scrolls out of
  // view, so dark icons never float over a transparent header on pale sections.
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".hero-section");
    if (!hero) {
      document.documentElement.classList.add("landing-hero-active");
      return () => document.documentElement.classList.remove("landing-hero-active");
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry!.isIntersecting) {
          document.documentElement.classList.add("landing-hero-active");
        } else {
          document.documentElement.classList.remove("landing-hero-active");
        }
      },
      { threshold: 0 },
    );
    obs.observe(hero);
    return () => {
      obs.disconnect();
      document.documentElement.classList.remove("landing-hero-active");
    };
  }, []);
  // Single source of truth (shared/seo_faq.ts) — same array also feeds the
  // FAQPage JSON-LD in seo_ssr.ts, so they can't drift.
  const faqEntries = SEO_FAQ[contentLocale(locale)];
  // Show the first few, reveal the rest behind a "+" so the section stays
  // short. All entries are always in the DOM's JSON-LD (built separately), so
  // this only affects the visible cards, not indexing.
  const [faqOpen, setFaqOpen] = useState(false);
  const FAQ_VISIBLE = 5;

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

  // Touch devices have no hover, so the icon-only role chips can't reveal their
  // label the way desktop does. The first tap expands the label (so the user
  // can read what the chip is); a second tap on the now-labelled chip acts.
  // Hover-capable devices keep the instant behaviour.
  const [revealedChip, setRevealedChip] = useState<string | null>(null);
  const chipTapProceeds = (e: React.MouseEvent, key: string): boolean => {
    const hoverCapable =
      typeof window !== "undefined" && !!window.matchMedia?.("(hover: hover)").matches;
    if (hoverCapable || revealedChip === key) return true;
    e.preventDefault();
    setRevealedChip(key);
    return false;
  };
  const chipTextWrap = (key: string) =>
    revealedChip === key
      ? "grid grid-cols-[1fr] transition-[grid-template-columns] duration-300 ease-out"
      : roleChipTextWrap;

  return (
    <PublicShell>
      {/* ════════════════════════ 01 · HERO ════════════════════════
          Oversized italic serif title hanging into the left margin, sub
          + CTAs underneath. Mockup follows below as a full-bleed slab,
          tilted slightly so it reads as "the product, peeking up". */}
      <section className="hero-section">
        {/* Media layer — full image anchored to the right 62% of the section.
            Cover scales by HEIGHT giving 849px horizontal overflow; left center
            shows bouquet at 38-59% viewport, dress 59-85%, groom 85-100%. */}
        <div aria-hidden="true" className="hero-media">
          <div className="hero-photo-img" />
          <div className="hero-overlay" />
        </div>

        {/* Content layer */}
        <div className="hero-content-wrap">
          {/* The phone min-height carries the same +5rem the CTA row adds to its
              top margin below: content and box grow together, so the centred
              headline stays put and only the buttons travel down, off the
              couple's faces. */}
          <div className="mx-auto flex min-h-[calc(75svh+5rem)] max-w-7xl flex-col justify-center px-4 pt-20 pb-8 sm:min-h-[calc(100dvh-3.5rem)] sm:justify-center sm:px-6 sm:pt-24 lg:pt-28 lg:pb-8">
            <div className="grid items-start gap-8 lg:items-center lg:gap-14">
              <div>
                <h1 className="max-w-[18ch] whitespace-pre-line font-grotesk text-4xl font-semibold leading-[1] tracking-tight text-umber-900 dark:text-paper-50 sm:max-w-[14ch] sm:whitespace-normal sm:text-7xl sm:leading-[0.96] lg:text-8xl">
                  {t("landing.hero_title")}
                </h1>
                {/* Signup + demo sit side by side: sign up, or look around
                    first. Stacked on phones, inline from sm up. On phones each
                    button is only as wide as its own label — a full-width slab
                    masks the couple behind it, and the photo is the point. The
                    row also sits 5rem lower there (paired with the wrapper's
                    min-height above) so it lands below their faces. */}
                <div className="mt-24 flex max-w-[17rem] flex-col items-start gap-3 sm:mt-6 sm:max-w-md sm:flex-row sm:flex-wrap sm:items-center">
                  <Link to="/signup" className="btn-primary btn-lifted btn-landing btn-lg w-auto">
                    {t("landing.cta_signup")}
                  </Link>
                  <DemoLaunchButton className="w-auto whitespace-nowrap" />
                </div>
                {/* Role escape-hatch chips: icon-only pills that reveal their
                 *  label on hover/focus. Same three audiences (+ icons) as the
                 *  footer who-are-you band; the guest chip opens the invite-code
                 *  prompt rather than navigating. */}
                <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5">
                  <Link
                    to="/vendors"
                    aria-label={t("landing.footer_band_cta_vendor")}
                    className={roleChipClass}
                    onClick={(e) => chipTapProceeds(e, "vendor")}
                  >
                    <Store size={16} strokeWidth={1.6} aria-hidden />
                    <span className={chipTextWrap("vendor")}>
                      <span className={roleChipText}>{t("landing.footer_band_cta_vendor")}</span>
                    </span>
                  </Link>
                  <Link
                    to="/planners"
                    aria-label={t("landing.footer_band_cta_planner")}
                    className={roleChipClass}
                    onClick={(e) => chipTapProceeds(e, "planner")}
                  >
                    <ClipboardList size={16} strokeWidth={1.6} aria-hidden />
                    <span className={chipTextWrap("planner")}>
                      <span className={roleChipText}>{t("landing.footer_band_cta_planner")}</span>
                    </span>
                  </Link>
                  <button
                    type="button"
                    aria-label={t("landing.footer_band_cta")}
                    className={roleChipClass}
                    onClick={(e) => {
                      if (chipTapProceeds(e, "guest")) void askGuestCode();
                    }}
                  >
                    <UserCheck size={16} strokeWidth={1.6} aria-hidden />
                    <span className={chipTextWrap("guest")}>
                      <span className={roleChipText}>
                        {/* Full label needs room; on phones use the compact one
                            so the expanded pill fits the viewport. */}
                        <span className="sm:hidden">{t("landing.footer_band_cta_short")}</span>
                        <span className="hidden sm:inline">{t("landing.footer_band_cta")}</span>
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════ 02 · Suppliers — THREE DOORS ════════════════════
          Pulled up from mid-page to the first scroll beat: the directory is
          the one thing a visitor can use before signing up, so it earns the
          slot right under the hero, ahead of the budget demo.
          Three doors, one per intent — find one, name one, be one. Rendered
          as full-width list rows (icon, label, one supporting line, chevron)
          instead of a button cluster: the three intents belong to three
          different people, so none of them is "primary", and a row gives a
          44px+ tap target with the sub-line doing the disambiguating.
          "Recommend" opens the community submission wizard in place —
          it's the same visitor-verified flow as /vendors, and bouncing a
          motivated recommender to another page to find the button lost them. */}
      <section id="suppliers" className="relative scroll-mt-20 bg-white dark:bg-umber-900">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:gap-12 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <h2 className="font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
              {t("landing.suppliers_section_title")}
            </h2>
            {/* Search first, doors under it: a visitor who knows what they're
                after types it; the two rows are for the ones who don't. */}
            <VendorSearchBar className="mt-8" />
            <div className="mt-6 divide-y divide-paper-300 border-y border-paper-300 dark:divide-umber-700 dark:border-umber-700">
              <SupplierAction
                icon={<Sparkles size={18} strokeWidth={1.6} />}
                label={t("landing.suppliers_action_suggest_label")}
                sub={t("landing.suppliers_action_suggest_sub")}
                onClick={() => setSuggestOpen(true)}
              />
              <SupplierAction
                icon={<Store size={18} strokeWidth={1.6} />}
                label={t("landing.suppliers_action_join_label")}
                sub={t("landing.suppliers_action_join_sub")}
                to="/vendors"
              />
            </div>
          </div>
          {/* Decorative: the heading and the search box carry the meaning, so
              this stays out of the accessibility tree. width/height are the
              real pixels so the row reserves its space before the file lands. */}
          <img
            src="/suppliers-illustration.jpg"
            alt=""
            aria-hidden="true"
            width={1100}
            height={1015}
            loading="lazy"
            decoding="async"
            className="h-auto w-full rounded-3xl"
          />
        </div>
      </section>

      {/* The wizard is ~1200 lines of form; mount it only once someone opens
          it so its chunk never touches the landing payload. `visitor` gates
          the form behind an email verification instead of a session. */}
      {suggestOpen && (
        <Suspense fallback={null}>
          <SubmitSupplierModal
            open
            onClose={() => setSuggestOpen(false)}
            onSubmitted={() => setSuggestOpen(false)}
            visitor
          />
        </Suspense>
      )}

      {/* ════════════════════════ Interactive "Try it" demo ════════════════════════
          A no-signup budget calculator using the real DEFAULT_BUDGET_SPLIT.
          The CTA stashes the visitor's numbers into the onboarding draft so
          the wizard picks them up after register + verify. Goal: a visitor
          who plays here will have invested 30s of value before being asked
          to register. */}
      <InteractiveBudgetDemo />

      {/* ═════════════════ Vendor founding round — HOSPITALITY/SCARCITY ═════════
          The emotional FOMO beat, aimed at the wedding professionals who see
          this page: the first twelve months of Pro are on us, so joining reads
          as being hosted rather than buying. The hero counts down
          VENDOR_FOUNDING_CAP minus the vendors already holding an account, so
          the scarcity line and the window a signup would actually be granted
          come from one number. The size of the directory sits under the
          promise. Carries a quick share affordance (native share sheet →
          clipboard fallback) so a couple who loves their photographer can pass
          the offer straight to them. */}
      <FoundingVendorsBand />

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
          Title + bullets on the left, the illustration on the right so the
          whole block fits inside one viewport. Mobile stacks (title,
          bullets, CTA, picture) — the picture is wide and reads better below
          the copy at narrow widths. */}
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
              {/* A guest who mislaid their invite link searches the couple's
                  wedding and lands here, not on their own RSVP page. /rsvp is
                  the lookup that gets them there, and this block is where they
                  are already reading about that link. Outline, not primary:
                  the page's one loud ask stays "register". */}
              <Link to="/rsvp" className="btn-outline btn-lifted btn-landing mt-8 inline-flex">
                {t("landing.block_guests_cta")}
              </Link>
            </div>
            <div>
              {/* Decorative: the heading and bullets carry the meaning, so this
                  stays out of the accessibility tree. width/height are the real
                  pixels so the row reserves its space before the file lands. */}
              <img
                src="/guests-illustration.jpg"
                alt=""
                aria-hidden="true"
                width={1200}
                height={773}
                loading="lazy"
                decoding="async"
                className="h-auto w-full rounded-3xl ring-1 ring-paper-300 dark:ring-umber-700"
              />
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
            {/* Planners are a paid product with their own portal, so they get
                their own row rather than being folded in with vendors. */}
            <AudienceRow
              icon={<ClipboardList size={20} strokeWidth={1.5} />}
              row={t("landing.card_planners_title")}
              ctaLabel={t("landing.card_planners_cta")}
              to="/planners"
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
          Every price on the marketplace, one deck: couples in front, vendors
          and planners peeking out behind. Opens on the value proposition
          rather than on a number, because the number is not the argument. */}
      <section id="pricing" className="relative stationery scroll-mt-20">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-grotesk text-[11px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-300">
              {t("landing.pricing_section_eyebrow")}
            </p>
            <h2 className="mt-3 font-grotesk text-3xl font-semibold leading-[1.1] tracking-tight text-umber-900 dark:text-paper-50 sm:text-4xl lg:text-5xl">
              {t("landing.pricing_section_title")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl font-grotesk text-base leading-relaxed text-umber-700 dark:text-umber-200">
              {t("landing.pricing_section_sub")}
            </p>
          </div>
          <PricingDeck />
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
            {(faqOpen ? faqEntries : faqEntries.slice(0, FAQ_VISIBLE)).map((entry) => (
              <FaqCard key={entry.q} q={entry.q} a={entry.a} cta={entry.cta} />
            ))}
          </div>
          {!faqOpen && faqEntries.length > FAQ_VISIBLE && (
            <div className="mt-3 flex justify-center">
              {/* Icon-only on purpose: the "+N more questions" label was
                  restating what a plus under a truncated list already says. */}
              <button
                type="button"
                onClick={() => setFaqOpen(true)}
                aria-label={t("landing.faq_show_more", { n: faqEntries.length - FAQ_VISIBLE })}
                title={t("landing.faq_show_more", { n: faqEntries.length - FAQ_VISIBLE })}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-ink-700 transition hover:border-ink-900 hover:text-ink-900 dark:border-umber-700 dark:bg-umber-800 dark:text-paper-100 dark:hover:border-paper-200"
              >
                <Plus size={18} aria-hidden />
              </button>
            </div>
          )}
          <div className="mt-10">
            <NewsletterCapture source="landing" />
          </div>
        </div>
      </section>
      <MobileStickySignup />
    </PublicShell>
  );
}

/** Bottom-sticky signup CTA shown only on mobile (`lg:hidden`). Appears
 *  after the visitor scrolls past the hero so the call-to-action never goes
 *  more than a thumb-tap away, and stands down while anything carrying
 *  `data-sticky-cta-stop` is on screen. Honours `prefers-reduced-motion` via
 *  the CSS-level transition timing.
 *
 *  Two things claim that attribute, for two different reasons. The pricing
 *  ticket's own "Start planning" claims it because the bar would otherwise
 *  render a second identical black pill a hundred pixels under the first —
 *  which is what it did, since the old rule looked only at the last 600 px of
 *  the page and the ticket sits in the middle of it. The footer claims it
 *  because the footer is a black slab in both themes and this bar's backdrop
 *  is a cream scrim built for the cream page: over the slab it reads as a
 *  smear rather than a separation.
 *
 *  What the old rule cost, and why it is gone: the closing section's CTA it
 *  was hiding behind is `hidden lg:flex`, desktop-only, precisely BECAUSE this
 *  bar exists. So on a phone the last screenful before the footer had no CTA
 *  at all, hidden in deference to a button that was never rendered.
 *
 *  The measurement is a rect check inside the existing rAF-throttled scroll
 *  handler rather than an IntersectionObserver, because the marked node is not
 *  stable — switching the pricing deck to the vendor or planner ticket
 *  unmounts it — and re-querying two nodes per scroll frame costs nothing
 *  next to keeping an observer's subscriptions in sync with that. */
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
        // Show after the visitor has clearly cleared the hero (~75% of one
        // viewport — calibrated to the hero + mockup-band combined height).
        const past = y > vh * 0.75;
        // A stopper counts as on screen only if it is actually painted: a
        // display:none node reports a 0x0 rect, which is how a desktop-only
        // CTA correctly fails this test on a phone.
        const stopped = Array.from(
          document.querySelectorAll<HTMLElement>("[data-sticky-cta-stop]"),
        ).some((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return false;
          return r.bottom > 0 && r.top < vh;
        });
        setVisible(past && !stopped);
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

/** Vendor founding-round hospitality beat. Evergreen marketing copy (renders
 *  even if the stats fetch fails), with the hero counting the free founding
 *  places still open: VENDOR_FOUNDING_CAP minus the vendors who already hold a
 *  Weddly account. The cap is imported, never typed, so the number on the
 *  landing and the slot a signup would actually be granted cannot disagree —
 *  the same rule the /vendors page follows.
 *
 *  One supporting figure sits under the promise: how many businesses are in
 *  the directory (`listings`, not `vendors`). It answers the question a
 *  professional actually has on this band, "is anyone here?", and the whole
 *  catalogue is the honest answer to it — curated, community-submitted and
 *  claimed alike. The account count is a fraction of that and reads as an
 *  empty marketplace, which is the opposite of the job. It is deliberately
 *  NOT arithmetic against the hero: the seats count down accounts, this
 *  counts businesses, so the copy under it says "in the directory" rather
 *  than "joined" and the two numbers make no claim about each other.
 *
 *  The share control prefers the native share sheet (best for "send it to a
 *  colleague" on mobile), falling back to clipboard-copy + toast, then a
 *  visible manual-copy URL when the clipboard is refused (insecure context /
 *  iframe). The shared link carries `?ref=share`, the already-sanctioned
 *  referrer source the signup flow records on
 *  `signup_events.referrer_source`. */
function FoundingVendorsBand() {
  const { t, locale } = useT();
  const toast = useToast();
  const [stats, setStats] = useState<{ vendors: number; listings: number } | null>(null);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const fmt = useMemo(() => new Intl.NumberFormat(intlLocale(locale)), [locale]);

  useEffect(() => {
    let cancelled = false;
    publicStatsApi
      .get()
      .then((r) => {
        if (!cancelled) setStats({ vendors: r.vendors, listings: r.listings });
      })
      .catch(() => {
        // Evergreen section — never block on a stats failure; we just skip
        // the live count line and keep the offer copy.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The hero counts the founding places still up for grabs. Falls back to the
  // full cap when the live stats call hasn't resolved (or failed), so the
  // promise still stands on a page that loaded without them.
  const taken = stats === null ? null : Math.min(stats.vendors, VENDOR_FOUNDING_CAP);
  const remaining = taken === null ? null : Math.max(0, VENDOR_FOUNDING_CAP - taken);
  const heroSeats = remaining ?? VENDOR_FOUNDING_CAP;

  async function shareFoundingLink() {
    const url = `${window.location.origin}/vendors?ref=share`;
    // Native share sheet first — the highest-leverage "send to a friend"
    // affordance on mobile. A cancelled sheet rejects with AbortError, which
    // we swallow silently (NOT a reason to fall through to clipboard).
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: t("landing.provendors_share_title"),
          text: t("landing.provendors_share_text"),
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
      toast.success(t("landing.provendors_share_copied"));
    } catch {
      setCopyFallback(url);
    }
  }

  return (
    // Compact warm-espresso feature-band: a deliberate inversion of the cream
    // page so the founding offer reads as one premium "moment", not another
    // stacked section. Warm umber ground (candlelit, not corporate navy) with a
    // cream-inverse CTA as the single bright object. Two-column on desktop
    // (pitch + promise + the two live figures | the remaining-seats hero and
    // the CTA). The seat count leads — it's the offer; how many vendors and
    // businesses are already here is the supporting evidence underneath.
    // Mobile-only breathing gap above the dark band: the cream page shows
    // through this top margin so the espresso "moment" doesn't butt straight
    // up against the budget card. ~1.4x the prior gap (the budget demo's
    // py-12 = 48px bottom) → +20px ≈ 68px. Reset from sm up.
    // Dark mode flips the inversion: the page is already espresso, so the
    // band goes cream with espresso text to keep reading as a distinct
    // "moment" instead of dissolving into the dark page.
    <section className="mt-5 bg-umber-900 sm:mt-0 dark:bg-paper-100">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-9 px-4 py-20 text-center sm:flex-row sm:items-center sm:justify-between sm:gap-12 sm:py-16 sm:text-left">
        {/* Left: the pitch */}
        <div className="sm:max-w-md">
          <h2 className="font-grotesk text-2xl font-medium leading-snug tracking-tight text-paper-50 sm:text-3xl dark:text-umber-900">
            {t("landing.provendors_title")}
          </h2>
          {/* Capped + balanced so the promise sits under the title in two even
              rows and never overruns the column. */}
          <p className="mx-auto mt-4 max-w-[19rem] text-balance font-grotesk text-sm leading-relaxed text-paper-300 sm:mx-0 sm:text-base dark:text-umber-700">
            {t("landing.provendors_promise")}
          </p>
          {/* The supporting figure. Rendered only once the stats land AND the
              directory has something in it — a "0 vendors" line under a
              scarcity offer reads as an empty marketplace, which is the
              opposite of the job. */}
          {stats && stats.listings > 0 && (
            <p className="mt-5 font-grotesk text-xs text-paper-400 dark:text-umber-600">
              <span className="font-medium tabular-nums text-paper-200 dark:text-umber-800">
                {fmt.format(stats.listings)}
              </span>{" "}
              {t("landing.provendors_count_listings")}
            </p>
          )}
        </div>

        {/* Right: the live remaining-seats hero + the action row */}
        <div className="flex shrink-0 flex-col items-center gap-4 sm:items-end">
          <div className="flex flex-col items-center sm:items-end">
            <span className="font-grotesk text-6xl font-light tabular-nums leading-none tracking-tighter text-paper-50 sm:text-7xl dark:text-umber-900">
              <FoundingCount value={heroSeats} />
            </span>
            <span className="mt-1 font-grotesk text-[0.7rem] font-medium uppercase tracking-[0.22em] text-paper-400 dark:text-umber-600">
              {t("landing.provendors_seats_label")}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/vendors/signup"
              className="btn btn-landing btn-lg bg-paper-50 px-8 font-grotesk text-xs uppercase tracking-[0.2em] text-umber-950 hover:bg-paper-200 dark:bg-umber-900 dark:text-paper-50 dark:hover:bg-umber-800"
            >
              {t("landing.provendors_cta")}
            </Link>
            <button
              type="button"
              onClick={shareFoundingLink}
              aria-label={t("landing.provendors_share_cta")}
              title={t("landing.provendors_share_cta")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-paper-300 transition-colors hover:bg-paper-50/10 hover:text-paper-50 dark:text-umber-600 dark:hover:bg-umber-900/10 dark:hover:text-umber-900"
            >
              <Share2 size={18} aria-hidden />
            </button>
          </div>
          {copyFallback && (
            <p className="mt-1 max-w-xs break-all text-xs text-paper-400 dark:text-umber-600">
              {copyFallback}
            </p>
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
  locale: Locale;
  label: string;
  run: boolean;
}) {
  const display = useFlipTo(value, run);
  const fmt = useMemo(() => new Intl.NumberFormat(intlLocale(locale)), [locale]);
  return (
    <div className="text-center">
      {/* Vintage split-flap tile — espresso card, cream serif digit, and a
          dark seam across the middle with a hairline highlight just below
          for the flap-card depth (coffee-shop counter / old tennis
          scoreboard). Dark mode inverts the tile to cream with an espresso
          digit so it pops off the dark page instead of sinking into it. */}
      <div className="relative mx-auto flex aspect-[5/6] w-12 items-center justify-center overflow-hidden rounded-lg bg-umber-900 shadow-pop ring-1 ring-umber-950/50 sm:w-20 lg:w-24 dark:bg-paper-100 dark:ring-paper-300">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-[2px] -translate-y-px bg-black/30 dark:bg-umber-900/20"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 h-px translate-y-px bg-paper-50/12 dark:bg-white/60"
        />
        <span className="relative translate-y-[0.08em] font-serif text-2xl font-semibold tabular-nums leading-none text-paper-50 sm:text-4xl lg:text-5xl dark:text-umber-900">
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

  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return (
    <section className="relative overflow-x-clip bg-paper-50 pt-12 sm:pt-20 dark:bg-umber-900">
      {/* Title removed per request — the cards speak for themselves. */}
      {/* Mobile: horizontal snap carousel so all three posts are visible
       *  through swiping in one viewport. The first card peeks at ~80vw so
       *  the user immediately sees there's more to scroll. Tablet+ keeps
       *  the existing 3-up grid (re-rendered below). */}
      <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-6 pb-6 scroll-pl-6 sm:hidden [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {posts.map((post) => {
          const { copy, category, locale: shown } = blogCopy(post, locale);
          const [y, m, d] = post.published_at.split("-").map(Number);
          const dateLabel =
            y && m && d ? fmt.format(new Date(Date.UTC(y, m - 1, d))) : post.published_at;
          return (
            <li key={post.slug} className="w-[80vw] max-w-[20rem] shrink-0 snap-start">
              <Link
                to={`/blog/${locale === "hu" ? post.slug : (post.en_slug ?? post.slug)}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-800 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:border-ink-700 dark:bg-umber-800"
              >
                <BlogCover
                  url={post.cover_image_url ?? null}
                  alt={copy.title}
                  slug={post.slug}
                  category={category}
                  lazy
                />
                <div className="flex flex-1 flex-col p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-300">
                    {category}
                  </p>
                  <h3
                    lang={shown}
                    className="mt-1.5 font-grotesk text-base font-semibold leading-[1.15] tracking-tight text-umber-900 dark:text-paper-50"
                  >
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
            const { copy, category, locale: shown } = blogCopy(post, locale);
            const [y, m, d] = post.published_at.split("-").map(Number);
            const dateLabel =
              y && m && d ? fmt.format(new Date(Date.UTC(y, m - 1, d))) : post.published_at;
            return (
              <li key={post.slug} className="h-full">
                <Link
                  to={`/blog/${locale === "hu" ? post.slug : (post.en_slug ?? post.slug)}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-800 bg-paper-50 transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 focus-visible:ring-offset-4 focus-visible:ring-offset-paper-50 dark:border-ink-700 dark:bg-umber-800 dark:focus-visible:ring-offset-umber-900"
                >
                  <BlogCover
                    url={post.cover_image_url ?? null}
                    alt={copy.title}
                    slug={post.slug}
                    category={category}
                    lazy
                  />
                  <div className="flex flex-1 flex-col p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.28em] text-umber-500 dark:text-umber-300">
                      {category}
                    </p>
                    <h3
                      lang={shown}
                      className="mt-2 font-grotesk text-lg font-semibold leading-[1.15] tracking-tight text-umber-900 transition-colors group-hover:text-umber-500 dark:text-paper-50 dark:group-hover:text-umber-300 sm:text-xl"
                    >
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

/** The three sides of the marketplace, each with its own price. */
type PricingAudience = "couples" | "vendors" | "planners";

/** Ring order for the pricing deck. Couples sits in the MIDDLE so the section
 *  opens as designed: the couple ticket in front, vendors peeking out to the
 *  left and planners to the right. Promoting a side card rotates the ring
 *  rather than swapping two slots, so no audience can ever appear twice and
 *  every card is one click from every other. */
const PRICING_RING: readonly PricingAudience[] = ["vendors", "couples", "planners"];

/** The ring neighbour `step` places away from `active` (-1 = left, +1 = right). */
function ringNeighbour(active: PricingAudience, step: -1 | 1): PricingAudience {
  const n = PRICING_RING.length;
  const i = PRICING_RING.indexOf(active);
  return PRICING_RING[(((i + step) % n) + n) % n] ?? active;
}

/** One bullet on a pricing ticket. */
interface PricingBullet {
  icon: ReactNode;
  text: string;
}

/** Everything one audience's ticket renders. Built per render because every
 *  string goes through `t()` and every amount through the shared price
 *  constants — the deck never carries a number of its own. */
interface PricingCard {
  label: string;
  icon: ReactNode;
  /** Whole units of `currency` (7, 2 490). Formatted, never spelled in copy. */
  amount: number;
  /** Planners price three tiers, so the deck quotes the entry one and has to
   *  say so. Couples and vendors have exactly one price. */
  from: boolean;
  /** Tooltip behind the mark in the card's top-right corner. */
  valueNote: string;
  /** Small print under the price. */
  note: string;
  /** The highlighted one-liner: this audience's actual offer. */
  callout: string;
  /** The full offer, behind the callout's info icon. */
  calloutDetail: string;
  bullets: PricingBullet[];
  ctaTo: string;
  ctaLabel: string;
}

/** Pricing deck: three tickets, one in front and two peeking out behind it.
 *  Clicking a peek promotes it to the main card (same idiom as the
 *  couple-cards coverflow above). The deck reserves its full footprint at
 *  every position, so promoting a card changes only how the three overlap,
 *  never how much room the section takes. */
/** Reads a media query, and re-reads it whenever it flips.
 *
 *  The FIRST render already answers truthfully rather than starting at `false`,
 *  so a desktop visitor never gets one frame of the narrow layout before it
 *  widens. That is only safe because the app mounts with `createRoot`, not
 *  `hydrateRoot` (see main.tsx): the prerendered markup is replaced outright,
 *  so a client/server disagreement here costs nothing. The guard is for the
 *  prerender pass itself, which has no `window`. */
function useMediaQuery(query: string): boolean {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/** Slot a card occupies right now. Derived from the ring, never stored. */
type PricingSlot = "front" | "left" | "right";

/** Signed ring distance from the front card to `id`, in [-1, 1] for a ring of
 *  three: -1 is the card on the left, +1 the one on the right. */
function ringDelta(id: PricingAudience, active: PricingAudience): number {
  const n = PRICING_RING.length;
  let d = (PRICING_RING.indexOf(id) - PRICING_RING.indexOf(active) + n) % n;
  if (d > n / 2) d -= n;
  return d;
}

/** Pricing deck: three tickets, one in front and two behind it. Clicking a
 *  card behind (or swiping, or pressing an arrow key) rotates the ring and
 *  that card BECOMES the front one, same idiom as the couple-cards coverflow
 *  further down the page.
 *
 *  Two things carry the whole feel and are worth not re-deriving:
 *
 *  - **Every audience owns ONE node for the life of the section.** The cards
 *    are positioned by transform off a shared centre, so promoting one makes
 *    all three TRAVEL to their new slots rather than swapping their contents
 *    in place. A crossfade between two stationary cards reads as a glitch; a
 *    card that moves reads as a deck.
 *  - **The deck's height is the TALLEST ticket, always.** An invisible grid
 *    stack of all three bodies sizes the box (one grid cell, three children),
 *    so the section's footprint is identical whichever card is in front, in
 *    every locale, with no measuring. Only the overlap changes. */
function PricingDeck() {
  const { t, locale } = useT();
  const [active, setActive] = useState<PricingAudience>("couples");
  // Wide enough for two peeks to say something readable beside a 32rem card.
  // Matches the `lg:` breakpoint the tap row hides at, so exactly one of the
  // two controls is ever on screen.
  const fanned = useMediaQuery("(min-width: 1024px)");
  const stillness = useMediaQuery("(prefers-reduced-motion: reduce)");

  // Ticket cut-outs: the front card's outline is clipped to a rounded rect
  // with a semicircle bitten out of each side edge, centered on the
  // perforation row. We use clip-path: path() rather than a mask because two
  // masked "holes" need cross-browser composite handling that silently falls
  // back to additive (filling the holes back in); path() is deterministic.
  // The path is rebuilt from the measured card size + row center so the
  // notches track the divider across locales, breakpoints AND audiences.
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
    // `active` swaps the front card's contents, which moves the perforation
    // row: the clip has to be rebuilt for the new ticket.
  }, [active]);

  // How far a card sits from centre in its side slots. Fanned, that is a
  // fraction of the deck so ~11rem of each peek stays clear of the front
  // ticket; narrow, it is the whole deck plus a gap, which turns the same
  // three nodes into an ordinary swipe carousel with nothing peeking.
  const deckRef = useRef<HTMLDivElement>(null);
  const [deckW, setDeckW] = useState(0);
  useEffect(() => {
    const el = deckRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDeckW(el.offsetWidth));
    ro.observe(el);
    setDeckW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  const step = fanned ? deckW * 0.215 : deckW + 24;

  // Pointer drag. `dragPx` offsets every card live so the deck tracks the
  // finger 1:1; on release anything past a fifth of a step commits a rotation.
  // The click that ends a drag is swallowed, or letting go over a peek would
  // promote a card the visitor was only sliding past.
  const [dragPx, setDragPx] = useState(0);
  const dragFrom = useRef<{ x: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const rotate = (dir: -1 | 1) => {
    const n = PRICING_RING.length;
    const i = (PRICING_RING.indexOf(active) + dir + n) % n;
    setActive(PRICING_RING[i] ?? active);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragFrom.current = { x: e.clientX, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    if (Math.abs(dx) > 4) from.moved = true;
    setDragPx(dx);
  };
  const onPointerUp = () => {
    const from = dragFrom.current;
    dragFrom.current = null;
    const dx = dragPx;
    setDragPx(0);
    if (!from) return;
    if (from.moved) swallowClick.current = true;
    if (step > 0 && Math.abs(dx) > step * 0.2) rotate(dx < 0 ? 1 : -1);
  };

  // Every amount comes from the shared billing constants, never from copy: a
  // price typed into a locale file is a price that drifts from what Stripe
  // actually charges. The visitor has no couple/vendor/planner row yet, so the
  // currency follows their UI language exactly like the try-it budget widget.
  const currency = localeCurrency(locale);
  const symbol = currencySymbol(currency, locale);

  const cards: Record<PricingAudience, PricingCard> = {
    couples: {
      label: t("landing.pricing_tab_couples"),
      icon: <Heart size={15} strokeWidth={1.6} aria-hidden />,
      amount: monthlyPrice(currency),
      from: false,
      valueNote: t("landing.pricing_value_note"),
      note: t("landing.pricing_early_note"),
      callout: t("landing.pricing_after"),
      calloutDetail: t("landing.pricing_after_detail"),
      bullets: [
        { icon: <Gift size={16} />, text: t("landing.pricing_bullet_1") },
        { icon: <Sparkles size={16} />, text: t("landing.pricing_bullet_2") },
        { icon: <FileText size={16} />, text: t("landing.pricing_bullet_3") },
        { icon: <Pause size={16} />, text: t("landing.pricing_bullet_4") },
        { icon: <Share2 size={16} />, text: t("landing.pricing_bullet_referral") },
      ],
      ctaTo: "/signup",
      ctaLabel: t("landing.cta_signup"),
    },
    vendors: {
      label: t("landing.pricing_tab_vendors"),
      icon: <Store size={15} strokeWidth={1.6} aria-hidden />,
      amount: vendorPrice(currency),
      from: false,
      valueNote: t("landing.pricing_vendor_value_note"),
      note: t("landing.pricing_early_note"),
      callout: t("landing.pricing_vendor_callout"),
      calloutDetail: t("landing.pricing_vendor_callout_detail"),
      bullets: [
        { icon: <Gift size={16} />, text: t("landing.pricing_vendor_bullet_1") },
        { icon: <Store size={16} />, text: t("landing.pricing_vendor_bullet_2") },
        { icon: <Mail size={16} />, text: t("landing.pricing_vendor_bullet_3") },
        { icon: <CalendarCheck size={16} />, text: t("landing.pricing_vendor_bullet_4") },
        { icon: <Pause size={16} />, text: t("landing.pricing_vendor_bullet_5") },
      ],
      ctaTo: "/vendors",
      ctaLabel: t("landing.pricing_vendor_cta"),
    },
    planners: {
      label: t("landing.pricing_tab_planners"),
      icon: <ClipboardList size={15} strokeWidth={1.6} aria-hidden />,
      amount: plannerPrice("starter", currency),
      from: true,
      valueNote: t("landing.pricing_planner_value_note"),
      note: t("landing.pricing_planner_note"),
      callout: t("landing.pricing_planner_callout"),
      calloutDetail: t("landing.pricing_planner_callout_detail"),
      bullets: [
        { icon: <Briefcase size={16} />, text: t("landing.pricing_planner_bullet_1") },
        { icon: <Globe size={16} />, text: t("landing.pricing_planner_bullet_2") },
        { icon: <LayoutGrid size={16} />, text: t("landing.pricing_planner_bullet_3") },
        { icon: <Sparkles size={16} />, text: t("landing.pricing_planner_bullet_4") },
        { icon: <Pause size={16} />, text: t("landing.pricing_planner_bullet_5") },
      ],
      ctaTo: "/planners",
      ctaLabel: t("landing.pricing_planner_cta"),
    },
  };

  const fromLabel = t("landing.pricing_from");
  const perMonth = t("landing.pricing_amount_sub");

  return (
    <div className="mt-10 sm:mt-12">
      {/* Below lg there is no room either side of the ticket for a peek to say
          anything readable, so the same three choices become a tap row. Both
          controls drive one piece of state, so the deck has one behaviour. */}
      <div className="mx-auto mb-7 grid max-w-lg grid-cols-3 gap-2 lg:hidden">
        {PRICING_RING.map((id) => {
          const card = cards[id];
          const isActive = id === active;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActive(id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors duration-300 ${
                isActive
                  ? "border-umber-400 bg-paper-50 dark:border-umber-400 dark:bg-umber-800"
                  : "border-paper-300 hover:bg-paper-100/70 dark:border-umber-700 dark:hover:bg-umber-800/60"
              }`}
            >
              <span className="font-grotesk text-[10px] font-semibold uppercase tracking-[0.14em] text-umber-600 dark:text-umber-300">
                {card.label}
              </span>
              <span className="font-serif text-lg leading-none text-umber-900 dark:text-paper-50">
                {card.from ? `${fromLabel} ` : ""}
                {formatNumber(card.amount, locale)} {symbol}
              </span>
            </button>
          );
        })}
      </div>

      {/* The deck. Arrow keys work wherever focus sits inside it (the peeks and
          the tap row are both real buttons, so the event reaches here), and a
          drag anywhere on it slides the ring. overflow-x-clip keeps the narrow
          layout's off-screen cards from widening the document; clip rather
          than hidden so the cards' shadows still bleed vertically. */}
      <div
        ref={deckRef}
        className="relative mx-auto max-w-4xl overflow-x-clip"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            rotate(-1);
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            rotate(1);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: "pan-y" }}
      >
        {/* The height reservation: all three bodies in ONE grid cell, so the
            box is as tall as the tallest of them and stops changing. Nothing
            here is visible, focusable or announced — `ghost` renders the CTA
            as a span so the hidden copies add no tab stops. */}
        <div className="invisible grid" aria-hidden="true">
          {PRICING_RING.map((id) => (
            <div
              key={id}
              className={`col-start-1 row-start-1 mx-auto w-full max-w-lg ${TICKET_BOX} ${TICKET_FILL_FRONT}`}
            >
              <PricingTicketBody card={cards[id]} audience={id} ghost />
            </div>
          ))}
        </div>

        {PRICING_RING.map((id) => {
          const d = ringDelta(id, active);
          const slot: PricingSlot = d === 0 ? "front" : d < 0 ? "left" : "right";
          // Continuous position, so a half-finished drag renders half-way
          // between two slots rather than snapping at the threshold.
          const p = step > 0 ? d + dragPx / step : d;
          const ap = Math.min(Math.abs(p), 1);
          const isFront = slot === "front";
          return (
            <div
              key={id}
              className="absolute left-1/2 top-0 h-full w-full max-w-lg [filter:drop-shadow(0_20px_28px_rgba(16,24,48,0.16))]"
              style={{
                transform: `translateX(calc(-50% + ${p * step}px)) rotate(${(fanned ? 3 : 0) * p}deg) scale(${1 - 0.06 * ap})`,
                zIndex: Math.round(20 - ap * 10),
                transition:
                  dragFrom.current || stillness
                    ? "none"
                    : "transform 520ms cubic-bezier(0.22, 1, 0.36, 1)",
                willChange: "transform",
              }}
            >
              {isFront ? (
                <div
                  ref={pricingCardRef}
                  className={`relative flex h-full flex-col ${TICKET_BOX} ${TICKET_FILL_FRONT}`}
                  style={
                    ticketClip == null
                      ? undefined
                      : // Clip the card to the ticket outline so the side
                        // notches are real cut-outs that reveal whichever card
                        // is standing behind them.
                        { clipPath: ticketClip, WebkitClipPath: ticketClip }
                  }
                >
                  {/* Keyed on the slot so the body fades in as the card
                      arrives, instead of the text hard-cutting mid-travel. */}
                  <div
                    key={slot}
                    className={`flex h-full flex-col ${stillness ? "" : "animate-fade-in"}`}
                  >
                    <PricingTicketBody
                      card={cards[id]}
                      audience={id}
                      perforationRef={perforationRef}
                    />
                  </div>
                </div>
              ) : (
                <PricingPeek
                  side={slot}
                  card={cards[id]}
                  symbol={symbol}
                  fromLabel={fromLabel}
                  perMonth={perMonth}
                  locale={locale}
                  onSelect={() => {
                    if (swallowClick.current) {
                      swallowClick.current = false;
                      return;
                    }
                    setActive(id);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The ticket's own box, WITHOUT a fill: hairline, radius and padding, shared
 *  by the front card, the two peeks and the invisible height-reserving stack
 *  so all four can never drift apart. The fill is deliberately left to each
 *  caller rather than defaulted here and overridden: two background utilities
 *  on one element resolve by Tailwind's own stylesheet order, not by the order
 *  they are written in, so "override the default" is a coin toss.
 *
 *  The dark border is a much bigger step off the surface than the light one on
 *  purpose: in dark mode the card fill and the stationery section behind it are
 *  the SAME token (umber-800), so the hairline is the only thing drawing the
 *  ticket. umber-700 against umber-800 was invisible. */
const TICKET_BOX = "rounded-2xl border border-paper-300 p-6 dark:border-umber-500 sm:p-8";

/** Fill of the card in front: the brightest surface in the deck. */
const TICKET_FILL_FRONT = "bg-paper-50 dark:bg-umber-800";

/** Fill of a card standing behind: one step back from the front card in both
 *  themes, so depth survives even where the shadow is barely readable. */
const TICKET_FILL_BEHIND = "bg-paper-100 dark:bg-umber-900/70";

/** Everything inside the front ticket. Rendered a second time, invisibly, by
 *  the height reservation above — `ghost` is that pass, and it downgrades the
 *  CTA to a span so the hidden copies contribute no tab stops. */
function PricingTicketBody({
  card,
  audience,
  ghost = false,
  perforationRef,
}: {
  card: PricingCard;
  audience: PricingAudience;
  ghost?: boolean;
  perforationRef?: React.RefObject<HTMLDivElement | null>;
}) {
  const { t, locale } = useT();
  const symbol = currencySymbol(localeCurrency(locale), locale);
  const cta = "btn-primary btn-lifted btn-landing btn-lg mt-auto w-full";
  return (
    <>
      {/* Value-prop mark, pinned to the card's top-right corner. Tooltip opens
          downward since there's no room above at the top. The couple card
          keeps its burger (the BigMac price anchor); the trade cards get a
          plain info mark. */}
      <span className="group absolute right-5 top-5 sm:right-6 sm:top-6">
        <button
          type="button"
          tabIndex={ghost ? -1 : undefined}
          aria-label={card.valueNote}
          className="flex h-5 w-5 items-center justify-center rounded-full text-umber-600 transition-colors hover:text-umber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:text-umber-300 dark:hover:text-paper-50"
        >
          {audience === "couples" ? (
            <BurgerIcon size={16} aria-hidden />
          ) : (
            <Info size={16} aria-hidden />
          )}
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-60 rounded-lg bg-umber-900 px-3 py-2 text-xs leading-snug text-paper-50 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-umber-950"
        >
          {card.valueNote}
        </span>
      </span>
      {/* Who this ticket is for. The deck shows three prices, so the number
          needs a name beside it or it is just a number. */}
      <span className="inline-flex items-center gap-1.5 font-grotesk text-[11px] font-semibold uppercase tracking-[0.18em] text-umber-500 dark:text-umber-300">
        {card.icon}
        {card.label}
      </span>
      <div className="mt-2 flex items-end gap-2.5">
        {card.from && (
          <span className="mb-3 font-grotesk text-sm text-umber-600 dark:text-umber-300">
            {t("landing.pricing_from")}
          </span>
        )}
        <span className="font-serif text-6xl leading-[0.9] text-umber-900 dark:text-paper-50 sm:text-7xl">
          {formatNumber(card.amount, locale)}
        </span>
        <span className="mb-2 font-serif text-3xl text-umber-600 dark:text-umber-200">
          {symbol}
        </span>
        <span className="mb-2.5 font-grotesk text-sm text-umber-600 dark:text-umber-300">
          {t("landing.pricing_amount_sub")}
        </span>
      </div>
      {/* Billing cadence + what the price is qualified by. */}
      <p className="mt-1.5 font-grotesk text-xs text-umber-600 dark:text-umber-300">{card.note}</p>
      <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-umber-100 px-3 py-2.5 ring-1 ring-umber-200/80 dark:bg-umber-700/50 dark:ring-umber-600/50">
        <p className="font-grotesk text-sm leading-snug text-umber-800 dark:text-umber-100">
          {card.callout}
        </p>
        {/* Full offer tucked behind an info icon so the callout stays a single
            readable line. Shows on hover and keyboard focus. */}
        <span className="group relative ml-auto shrink-0">
          <button
            type="button"
            tabIndex={ghost ? -1 : undefined}
            aria-label={card.calloutDetail}
            className="flex h-5 w-5 items-center justify-center rounded-full text-umber-600 transition-colors hover:text-umber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 dark:text-umber-300 dark:hover:text-paper-50"
          >
            <Info size={16} aria-hidden />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 w-64 rounded-lg bg-umber-900 px-3 py-2 text-xs leading-snug text-paper-50 opacity-0 shadow-pop transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-umber-950"
          >
            {card.calloutDetail}
          </span>
        </span>
      </div>
      {/* Ticket perforation between the price block and the feature list: a
          dashed tear-line, with the side half-circle cut-outs punched by the
          card's clip (see the front card's style, which measures this row's
          centre). Inset so the dashes clear the notches. */}
      <div ref={perforationRef} className="-mx-6 my-5 sm:-mx-8" aria-hidden="true">
        <div className="mx-7 border-t border-dashed border-paper-300 dark:border-umber-500" />
      </div>
      {/* Five bullets on every ticket, so the three are close to one height
          and the deck's reserved box is never mostly empty. */}
      <ul className="space-y-2 pb-6">
        {card.bullets.map((bullet) => (
          <IconRow key={bullet.text} tone="coffee" icon={bullet.icon}>
            {bullet.text}
          </IconRow>
        ))}
      </ul>
      {/* mt-auto pins the CTA to the bottom of the reserved box, so all three
          tickets put their button on the same line however long their copy is. */}
      {ghost ? (
        <span className={cta}>{card.ctaLabel}</span>
      ) : (
        <Link
          to={card.ctaTo}
          className={cta}
          // Marks this as a real, on-page signup CTA so the mobile sticky bar
          // stands down while it is on screen (see MobileStickySignup). Only
          // the signup ticket claims it: the vendor and planner tickets lead
          // somewhere else, so the sticky bar is not a duplicate of them.
          {...(card.ctaTo === "/signup" ? { "data-sticky-cta-stop": "" } : {})}
        >
          {card.ctaLabel}
        </Link>
      )}
    </>
  );
}

/** One of the two tickets standing behind the front card. Shows only what fits
 *  in the strip the front card does not cover: who it is for, and what it
 *  costs. The whole card is the control that promotes it, so its visible text
 *  IS its accessible name and it needs no aria-label. */
function PricingPeek({
  side,
  card,
  symbol,
  fromLabel,
  perMonth,
  locale,
  onSelect,
}: {
  side: "left" | "right";
  card: PricingCard;
  symbol: string;
  fromLabel: string;
  perMonth: string;
  locale: Locale;
  onSelect: () => void;
}) {
  const isLeft = side === "left";
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex h-full w-full flex-col items-start justify-start text-left ${TICKET_BOX} ${TICKET_FILL_BEHIND} opacity-95 transition-opacity duration-300 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-umber-400 ${
        // Content hugs the OUTER edge on each side: the inner two thirds of a
        // peek sits under the front ticket, so anything laid out there is
        // simply invisible. Narrow screens have no peeks on show at all (the
        // cards are parked off-deck), which is why the padding is lg-only.
        isLeft ? "lg:pr-[21rem]" : "lg:items-end lg:pl-[21rem] lg:text-right"
      }`}
    >
      <span className="inline-flex items-center gap-1.5 font-grotesk text-[11px] font-semibold uppercase tracking-[0.18em] text-umber-500 dark:text-umber-300">
        {card.icon}
        {card.label}
      </span>
      {card.from && (
        <span className="mt-2 font-grotesk text-xs text-umber-600 dark:text-umber-300">
          {fromLabel}
        </span>
      )}
      <span className={`flex items-end gap-1.5 ${card.from ? "mt-0.5" : "mt-3"}`}>
        <span className="font-serif text-4xl leading-none text-umber-900 dark:text-paper-50">
          {formatNumber(card.amount, locale)}
        </span>
        <span className="font-serif text-xl leading-none text-umber-600 dark:text-umber-200">
          {symbol}
        </span>
      </span>
      <span className="mt-1.5 font-grotesk text-xs text-umber-600 dark:text-umber-300">
        {perMonth}
      </span>
    </button>
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
            const hasCards = deckHasCards(deck);
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
                  {/* Match the coverflow: LEVEL decks drop the WĒDDLY footer. */}
                  {(isAccent || !hasCards) && (
                    <span className="font-display text-[8px] font-bold uppercase tracking-[0.24em] sm:text-[10px] sm:tracking-[0.28em]">
                      {"WĒDDLY · "}
                      {hasCards
                        ? t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })
                        : t("tools.couple_cards.deck_soon_label")}
                    </span>
                  )}
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
          const hasCards = deckHasCards(deck);
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
                    <span className="mt-1.5 font-display text-sm font-bold uppercase tracking-[0.04em]">
                      ({t(deck.titleKey)})
                    </span>
                  ) : null}
                </div>
                {/* LEVEL decks keep only the number + (title); the WĒDDLY ·
                 *  N CARDS footer is dropped to lighten the card. Accent decks
                 *  and coming-soon decks keep it (the latter for the "Soon"
                 *  cue). */}
                {(isAccent || !hasCards) && (
                  <span className="font-display text-xs font-bold uppercase tracking-[0.28em]">
                    {"WĒDDLY · "}
                    {hasCards
                      ? t("tools.couple_cards.deck_count_label", { n: DECK_SIZE })
                      : t("tools.couple_cards.deck_soon_label")}
                  </span>
                )}
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
            /* The visible dot stays 6px tall, but a transparent ::before
               extends the hit area to a 44px-tall band that reaches each
               neighbour's midpoint (gap-1.5 → +0.375rem), so the tap target
               clears the WCAG/iOS floor without enlarging the dot itself. */
            className={`relative h-1.5 rounded-full transition-all before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-[calc(100%+0.375rem)] before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] ${
              circularDelta(idx) === 0 ? "w-5 bg-wnrs-red" : "w-1.5 bg-umber-300 dark:bg-umber-700"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// One door of the suppliers block. Icon medallion, label, one supporting
// line, chevron — the whole row is the target, and the medallion inverts to
// solid ink on hover so the row reads as a control rather than a list item.
// Same shape whether it navigates (`to`) or opens the wizard (`onClick`).
function SupplierAction({
  icon,
  label,
  sub,
  to,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  sub: string;
  to?: string;
  onClick?: () => void;
}) {
  const className =
    "group flex w-full items-center gap-4 py-4 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800/50 sm:gap-5 sm:py-5";
  const inner = (
    <>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-paper-300 text-umber-800 transition-colors group-hover:border-umber-900 group-hover:bg-umber-900 group-hover:text-paper-50 dark:border-umber-700 dark:text-paper-100 dark:group-hover:border-paper-200 dark:group-hover:bg-paper-50 dark:group-hover:text-umber-900 sm:h-11 sm:w-11">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-grotesk text-base font-medium leading-snug text-umber-900 dark:text-paper-50 sm:text-lg">
          {label}
        </span>
        <span className="mt-0.5 block font-grotesk text-sm leading-snug text-umber-700 dark:text-umber-200">
          {sub}
        </span>
      </span>
      <ChevronRight
        size={18}
        strokeWidth={1.8}
        aria-hidden
        className="shrink-0 text-umber-500 transition-transform duration-200 group-hover:translate-x-0.5 dark:text-umber-300"
      />
    </>
  );
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
  //
  // `flex-wrap` below sm is what pays for that promise: a one-word HU label
  // ("Szolgáltatóknak") can't hyphenate and the CTA can't wrap, so on a 360px
  // viewport the two used to print straight through each other. Wrapping drops
  // the CTA onto its own line instead. Locked to nowrap from sm up, where the
  // pair always fits and the right-aligned CTA is the point of the ledger.
  const className =
    "group flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-4 text-left transition-colors hover:bg-paper-50 dark:hover:bg-umber-800/50 sm:flex-nowrap sm:gap-x-5 sm:py-5";
  const inner = (
    <>
      {/* Black disc, not the umber brown the rest of the page uses: on the
          white ledger it reads as ink on paper, which is the register this
          section wants. Inverts to a white disc on the dark background. */}
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black sm:h-10 sm:w-10">
        {icon}
      </span>
      {/* Row label is the audience name ("For couples", "For vendors"),
          which acts as the section title for that row — h3 so screen
          readers get a heading landmark, not just running prose. */}
      {/* `flex-auto`, not `flex-1`: a 0% basis makes the row's hypothetical
          width 0, so the line never wraps and the label just prints through
          the CTA. An auto basis measures the text, which is what lets the
          wrap above fire. */}
      <h3 className="min-w-0 flex-auto font-grotesk text-base font-medium leading-snug text-black dark:text-paper-50 sm:text-lg">
        {row}
      </h3>
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-grotesk text-sm font-medium text-black transition-colors group-hover:text-black/55 dark:text-paper-200 dark:group-hover:text-white sm:text-base">
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

function FaqCard({
  q,
  a,
  cta,
}: { q: string; a: ReactNode; cta?: { href: string; label: string } }) {
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
      {cta && (
        <Link
          to={cta.href}
          className="group/faq mt-2.5 inline-flex items-center gap-1.5 pb-1 font-grotesk text-sm font-medium text-umber-800 transition-colors hover:text-umber-500 dark:text-paper-200 dark:hover:text-umber-300"
        >
          <span>{cta.label}</span>
          <span
            aria-hidden
            className="transition-transform duration-200 group-hover/faq:translate-x-0.5"
          >
            →
          </span>
        </Link>
      )}
    </details>
  );
}
