// Public vendor recruitment page. Pitches the vendor side and routes into the
// self-serve signup at /vendors/signup. The old 4-step public waitlist form
// (admin-accept → emailed token activation) is retired — vendors now create an
// account directly and run the in-app onboarding wizard.
//
// Messaging rules this page is built on, so a future edit doesn't undo them:
//
//   1. Couples are the product; vendors get ACCESS to what couples already
//      use. No "partner", no "community", nothing that reads as co-ownership.
//   2. Concrete over abstract: what a vendor gets, how fast, and what it
//      costs, in that order. Short sentences, no hedging.
//   3. NO COUNTS AND NO OFFER ON THE PAGE. Page views, inquiry totals and
//      "N spots left" are all gone: while the marketplace is young those
//      numbers argue against us, and a scarcity counter is the first thing a
//      vendor reads as marketing. The free window (founding / early) used to
//      survive as a promise under the CTA and is gone too, so the page now
//      fetches nothing and just states what a vendor gets.
//      Pictures never carry a review COUNT or a business name. A rating and a
//      price band appear on the shortlist tiles only as the shape of the field
//      (see VendorPitchMockups), and the one real-looking figure is a sample
//      quote, because a quote without amounts is not a picture of a quote.
//   4. ONE dominant call to action (signup), repeated once at the end, with
//      the demo as a real outline button beside it in both places. The demo
//      used to be a quiet text link and was too easy to miss: a vendor who
//      won't hand over an email yet still clicks "see the demo", and that is
//      the only path from this page into the product. The wrong-audience links
//      stay quiet text; there is deliberately no "log in" link in the hero,
//      because the header already carries one (icon on desktop, menu item on
//      mobile) and a second one just competes with the signup button.
//   5. BELOW THE HERO THE PAGE FOLLOWS THE SHAPE OF A PRODUCT PITCH: three
//      alternating blocks (Manage, Grow, Get booked), a rail of the trades the
//      directory covers, and a short FAQ. Every claim in them is a thing the
//      product does today, and none of them is a count, a price, a plan or a
//      testimonial (rules 3 and the empty VENDOR_TESTIMONIALS). The pictures
//      are templates (see VendorPitchMockups) and name nobody. "Get booked"
//      rather than "Get paid" on purpose: Weddly tracks a vendor's money, it
//      does not move it, and a heading promising otherwise would be the one
//      untrue line on the page.

import { isVendorSelfServeBlocked } from "@shared/suppliers";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Share2,
  Store,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { PublicShell } from "../components/PublicShell";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { TracingFrame } from "../components/TracingFrame";
import { VendorDemoLaunchButton } from "../components/VendorDemoLaunchButton";
import {
  CalendarMockup,
  HeroCollage,
  QuoteMockup,
  ShortlistMockup,
  TRADE_PHOTOS,
  tradesWithoutPhoto,
} from "../components/VendorPitchMockups";
import { VendorSearchBar } from "../components/VendorSearchBar";
import { useToast } from "../components/ui";
import { categoryIcon } from "../lib/category_icons";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** Real vendor quotes for the closing band, empty until we have some.
 *  DELIBERATELY EMPTY: an invented testimonial on a public page is a fabricated
 *  endorsement, and the block renders fine without one. To turn it on, paste
 *  real, permission-given quotes here (quote in the speaker's own language). */
const VENDOR_TESTIMONIALS: { quote: string; name: string; business: string }[] = [];

export default function VendorsPage() {
  const { t } = useT();
  const toast = useToast();
  useDocumentMeta("vendors.seo_title", "vendors.seo_description");
  // Register-a-vendor flow for random visitors (no account): the modal handles
  // the email-verify gate (Google one-tap → device token) and submits the
  // community listing on X-Visitor-Token.
  const [registerOpen, setRegisterOpen] = useState(false);

  // Growth loop: anyone on the vendor site can pass a link on so their friends
  // come recommend a supplier they trust. Native share sheet on mobile, with a
  // copy-to-clipboard fallback everywhere else. The link points at the vendor
  // site itself, where the "suggest a supplier" entry lives.
  async function shareRecommendPrompt() {
    const url = `${window.location.origin}/suppliers`;
    const message = t("vendors.recommend_share_message");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: t("vendors.recommend_title"), text: message, url });
        return;
      } catch {
        // User dismissed the sheet, or share failed — fall back to clipboard.
      }
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no_clipboard");
      await navigator.clipboard.writeText(`${message} ${url}`);
      toast.success(t("vendors.recommend_copied"));
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  return (
    <PublicShell black>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-10 sm:px-6 sm:pt-20 sm:pb-14 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
        <div className="text-center lg:text-left">
          {/* Headline and search box are ONE measure. `w-fit` sizes this
              wrapper to its widest max-content child, which here is the
              unwrapped headline, so the box below ends exactly where "away."
              does instead of running the last 40px out to the column edge.
              fit-content caps at the available width, so a longer locale that
              has to wrap simply gets the full column back.

              lg-only on purpose: below it the column is centred and the CTAs
              under the box are full-width slabs, so a box measured to a small
              headline would sit narrower than everything around it. */}
          <div className="lg:w-fit">
            {/* The headline is short enough to carry real display size now that
                no badge sits above it. */}
            <h1 className="font-grotesk text-4xl font-semibold leading-[1.02] tracking-tight text-ink-900 sm:text-6xl dark:text-paper-50">
              {t("vendors.hero_title")}
            </h1>
            {/* The directory's own front door, the same box the couples landing
                opens with, sitting between the headline and the CTAs. A vendor
                reading "be one click away" can check that click for themselves:
                type the business name and either find the listing waiting to be
                claimed or land in the open directory they are about to join. */}
            <VendorSearchBar black className="mt-8 text-left" />
          </div>
          {/* Two buttons, one dominant. Nothing sits under them any more: the
              effort claim and the free-window promise both read as marketing
              next to a headline that already says what the page is for.
              Stacked full-width on mobile so neither is a small tap target. */}
          <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center lg:justify-start">
            <Link
              to="/suppliers/signup"
              className="btn-primary btn-lg inline-flex items-center justify-center gap-2 shadow-sm"
            >
              {t("vendors.signup_cta")}
              <ArrowRight size={18} aria-hidden />
            </Link>
            <VendorDemoLaunchButton size="lg" />
          </div>
          {/* Wrong-audience escape hatch — one compact line, a size below the
              body copy so it never competes with the CTA (audit item 12). */}
          <div className="mt-5 text-xs text-ink-500 lg:text-left dark:text-umber-300">
            {t("vendors.wrong_audience")}{" "}
            <Link to="/signup" className="underline underline-offset-2">
              {t("vendors.couple_escape_link")}
            </Link>
            {" · "}
            <Link to="/planners" className="underline underline-offset-2">
              {t("vendors.planner_escape_link")}
            </Link>
          </div>
        </div>
        {/* A ceremony photograph with the product laid over it (an inquiry
            arriving, a quote accepted). No caption: the picture says which
            business this is for. */}
        <HeroCollage />
      </section>

      <PitchBlocks />
      <TradesRail />
      <Faq />

      {/* Recommend-a-supplier prompt — two ways to help: register the vendor
          yourself (verify email, no account needed) or pass the link on. It sits
          ABOVE the closing band on purpose: it is the secondary ask, aimed at a
          visitor who isn't the vendor, so it must not be what the page ends on.
          Same max-w-6xl + padding as the benefits grid above, so the two blocks
          share one edge instead of the ask reading as a narrower afterthought.
          Dark plate with a tracing frame (four laps, see `.trace-frame` in
          index.css): this is the one block on the page allowed to ask for
          attention, because everything else here is aimed at the vendor and
          this is aimed at whoever else wandered in. */}
      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <TracingFrame className="rounded-2xl shadow-soft dark:shadow-none">
          <div className="flex flex-col items-start gap-5 rounded-[calc(1rem-5px)] bg-black p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="min-w-0">
              <h2 className="font-grotesk text-xl text-paper-50 sm:text-2xl">
                {t("vendors.recommend_title")}
              </h2>
            </div>
            {/* Side by side on desktop rather than stacked: on the wider card the
                two-high stack left a lake of empty plate between the heading and
                the buttons. */}
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <button
                type="button"
                onClick={() => setRegisterOpen(true)}
                className="btn-outline inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Store size={16} aria-hidden />
                {t("vendors.recommend_register_cta")}
              </button>
              <button
                type="button"
                onClick={shareRecommendPrompt}
                className="btn-outline inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <Share2 size={16} aria-hidden />
                {t("vendors.recommend_share_cta")}
              </button>
            </div>
          </div>
        </TracingFrame>
      </section>

      <SubmitSupplierModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSubmitted={() => setRegisterOpen(false)}
        visitor
      />

      <ClosingBand />

      {/* Back to landing */}
      <section className="mx-auto max-w-2xl px-4 pb-12 text-center sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
        >
          <ArrowLeft size={14} />
          {t("vendors.back_to_landing")}
        </Link>
      </section>
    </PublicShell>
  );
}

/** Closing band: the one repeat of the primary CTA, plus real vendor quotes if
 *  we have any. It used to be a counter band ("N page views", "N spots left");
 *  those are gone on purpose (see rule 3 at the top) and so is the sub-line
 *  under the headline, which repeated the hero microcopy word for word before
 *  that microcopy was itself dropped.
 *
 *  The headline takes the TIMING angle ("next season is being booked now"), not
 *  the hero's "couples choose here" angle. It used to be a paraphrase of the
 *  hero title, which on a page this short read as the same block twice. Social
 *  proof would be the other natural angle here and is not available: counts are
 *  banned (rule 3) and VENDOR_TESTIMONIALS is empty until we have real quotes. */
function ClosingBand() {
  const { t } = useT();
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 text-center sm:px-6 sm:py-16">
      <h2 className="font-grotesk text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
        {t("vendors.closing_title")}
      </h2>
      {VENDOR_TESTIMONIALS.length > 0 && (
        <div className="mx-auto mt-10 grid max-w-4xl gap-4 text-left sm:grid-cols-2">
          {VENDOR_TESTIMONIALS.map((v) => (
            <figure key={v.business} className="card !p-6">
              <blockquote className="text-sm leading-relaxed text-ink-700 dark:text-umber-100">
                {v.quote}
              </blockquote>
              <figcaption className="mt-3 text-xs text-ink-500 dark:text-umber-300">
                {v.name} · {v.business}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {/* Same pair as the hero, same order. A visitor who scrolled the whole
          page without signing up is exactly who the demo is for. */}
      <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
        <Link
          to="/suppliers/signup"
          className="btn-primary btn-lg inline-flex items-center justify-center gap-2 shadow-sm"
        >
          {t("vendors.closing_cta")}
          <ArrowRight size={18} aria-hidden />
        </Link>
        <VendorDemoLaunchButton size="lg" />
      </div>
    </section>
  );
}

/** One block of the pitch: an eyebrow, a headline, three short lines and a
 *  picture, alternating sides down the page. The bullets are the whole copy on
 *  purpose (no lead paragraph): the picture carries the rest. */
function FeatureBlock({
  eyebrow,
  title,
  bullets,
  visual,
  flip,
}: {
  eyebrow: string;
  title: string;
  bullets: string[];
  visual: ReactNode;
  flip?: boolean;
}) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-20">
      <div className={flip ? "lg:order-2" : undefined}>
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-umber-500 dark:text-umber-300">
          {eyebrow}
        </p>
        <h2 className="mt-3 font-grotesk text-3xl font-semibold leading-[1.08] tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
          {title}
        </h2>
        <ul className="mt-6 space-y-3.5">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-3 text-base leading-relaxed text-ink-700 dark:text-paper-200"
            >
              <Check
                size={18}
                strokeWidth={1.75}
                className="mt-1 shrink-0 text-ink-900 dark:text-paper-50"
                aria-hidden
              />
              {b}
            </li>
          ))}
        </ul>
      </div>
      <div className={flip ? "lg:order-1" : undefined}>{visual}</div>
    </section>
  );
}

/** Manage / Grow / Get booked. Three headings, in the order a vendor's week
 *  actually runs: the work that arrives, the reason it arrives, the money it
 *  turns into. */
function PitchBlocks() {
  const { t } = useT();
  return (
    <>
      <FeatureBlock
        eyebrow={t("vendors.pitch_manage_eyebrow")}
        title={t("vendors.pitch_manage_title")}
        bullets={[
          t("vendors.pitch_manage_b1"),
          t("vendors.pitch_manage_b2"),
          t("vendors.pitch_manage_b3"),
        ]}
        visual={<CalendarMockup />}
      />
      <FeatureBlock
        flip
        eyebrow={t("vendors.pitch_grow_eyebrow")}
        title={t("vendors.pitch_grow_title")}
        bullets={[
          t("vendors.pitch_grow_b1"),
          t("vendors.pitch_grow_b2"),
          t("vendors.pitch_grow_b3"),
        ]}
        visual={<ShortlistMockup />}
      />
      <FeatureBlock
        eyebrow={t("vendors.pitch_book_eyebrow")}
        title={t("vendors.pitch_book_title")}
        bullets={[
          t("vendors.pitch_book_b1"),
          t("vendors.pitch_book_b2"),
          t("vendors.pitch_book_b3"),
        ]}
        visual={<QuoteMockup />}
      />
    </>
  );
}

const browseHref = (category: string) => `/suppliers/browse?category=${category}`;

/** The trades the directory covers. Photo cards for the ones we have an honest
 *  photograph of, chips for the rest, so the taxonomy is complete without a
 *  picture pretending to be someone's work. Each one opens the public browse
 *  page on that category: a vendor can see the room they are about to join. */
function TradesRail() {
  const { t } = useT();
  const others = tradesWithoutPhoto(isVendorSelfServeBlocked);
  const railRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const sync = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

  function page(direction: -1 | 1) {
    const el = railRef.current;
    if (!el) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reduced ? "auto" : "smooth" });
  }

  const arrow =
    "grid h-9 w-9 place-items-center rounded-full border border-ink-900/15 text-ink-900 transition hover:border-ink-900 disabled:pointer-events-none disabled:opacity-25 dark:border-paper-50/20 dark:text-paper-100";

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 className="font-grotesk text-3xl font-semibold leading-[1.08] tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
          {t("vendors.pitch_trades_title")}
        </h2>
        <div className="flex items-center gap-4">
          <Link
            to="/suppliers/browse"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-700 underline-offset-4 hover:text-ink-900 hover:underline dark:text-paper-200 dark:hover:text-paper-50"
          >
            {t("vendors.pitch_trades_cta")}
            <ArrowRight size={15} aria-hidden />
          </Link>
          {/* Chevrons from sm up: a phone swipes, but a mouse has no comfortable
              way to drive a horizontal scroller. Same pair, same labels and
              same edge-disabling as the browse page's category rails. */}
          <div className="hidden gap-2 sm:flex">
            <button
              type="button"
              className={arrow}
              onClick={() => page(-1)}
              disabled={edges.start}
              aria-label={t("vendorBrowse.rail_prev")}
            >
              <ChevronLeft size={17} aria-hidden />
            </button>
            <button
              type="button"
              className={arrow}
              onClick={() => page(1)}
              disabled={edges.end}
              aria-label={t("vendorBrowse.rail_next")}
            >
              <ChevronRight size={17} aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {/* A snap rail at every width. Cards bleed to the screen edge on phones so
          the row reads as swipeable without a scrollbar saying so; from sm up
          the rail sits exactly on the heading's edges. `scroll-pl-4` is
          load-bearing: a mandatory snap container aligns the first card to its
          PADDING box, which silently eats the inset and leaves the first card
          hanging left of the heading above it. */}
      <div
        ref={railRef}
        onScroll={sync}
        className="-mx-4 mt-8 flex snap-x snap-mandatory scroll-pl-4 gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:scroll-pl-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TRADE_PHOTOS.map((category) => (
          <Link
            key={category}
            to={browseHref(category)}
            className="group relative aspect-[4/5] w-52 shrink-0 snap-start overflow-hidden rounded-2xl bg-paper-200 sm:w-60 dark:bg-umber-800"
          >
            <img
              src={`/vendors-trades/${category}.jpg`}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent px-4 pb-4 pt-16">
              <span className="font-grotesk text-lg font-semibold leading-tight text-white">
                {t(`suppliers.cat.${category}`)}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {others.map((category) => {
          const Icon = categoryIcon(category);
          return (
            <Link
              key={category}
              to={browseHref(category)}
              className="inline-flex items-center gap-2 rounded-full border border-ink-900/15 px-3.5 py-2 text-sm text-ink-700 transition-colors hover:border-ink-900/40 hover:text-ink-900 dark:border-paper-50/15 dark:text-paper-200 dark:hover:border-paper-50/40 dark:hover:text-paper-50"
            >
              <Icon size={15} strokeWidth={1.5} aria-hidden />
              {t(`suppliers.cat.${category}`)}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

const FAQ_KEYS = [1, 2, 3, 4, 5, 6] as const;

/** Six answers, on the questions a vendor actually stops at. Native
 *  <details>: keyboard, screen reader and no-JS behaviour come for free, and
 *  there is no state to keep. There is deliberately no question about cost: the
 *  page states no price or offer (rule 3), and an answer that dodged it would
 *  read worse than its absence. */
function Faq() {
  const { t } = useT();
  return (
    <section className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h2 className="text-center font-grotesk text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
        {t("vendors.pitch_faq_title")}
      </h2>
      <div className="mt-8 border-t border-ink-900/10 dark:border-paper-50/10">
        {FAQ_KEYS.map((n) => (
          <details key={n} className="group border-b border-ink-900/10 dark:border-paper-50/10">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 font-grotesk text-lg font-medium text-ink-900 marker:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-700 dark:text-paper-50 dark:focus-visible:ring-paper-100 [&::-webkit-details-marker]:hidden">
              {t(`vendors.pitch_faq_${n}_q`)}
              <Plus
                size={20}
                strokeWidth={1.5}
                className="shrink-0 text-ink-500 transition-transform duration-200 group-open:rotate-45 motion-reduce:transition-none dark:text-umber-300"
                aria-hidden
              />
            </summary>
            <p className="pb-6 pr-10 leading-relaxed text-ink-600 dark:text-paper-200">
              {t(`vendors.pitch_faq_${n}_a`)}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
