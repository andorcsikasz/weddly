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
//   3. NO COUNTS ON THE PAGE. Page views, inquiry totals and "N spots left"
//      are all gone: while the marketplace is young those numbers argue
//      against us, and a scarcity counter is the first thing a vendor reads
//      as marketing. The only live thing left is WHICH free window a signup
//      lands in (founding / early), stated as a promise, never as a tally.
//      Same rule in the hero mockup: no invented business, rating or review
//      count in the card preview.
//   4. ONE dominant call to action (signup), repeated once at the end. Demo,
//      login and the wrong-audience escape hatches are all quiet text links.

import type { PublicVendorStats } from "@shared/vendor_billing";
import { ArrowLeft, ArrowRight, Gem, Inbox, Receipt, Share2, Store } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { VendorDemoLaunchButton } from "../components/VendorDemoLaunchButton";
import { useToast } from "../components/ui";
import { publicStatsApi } from "../lib/endpoints";
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

  // The only live thing on the page: which free window a signup lands in right
  // now. We read the offer tier and say what it grants; the slot count that
  // comes with it is deliberately never rendered. A failed fetch just drops the
  // promise line and leaves the evergreen copy standing.
  const [offer, setOffer] = useState<PublicVendorStats["offer"] | null>(null);
  useEffect(() => {
    let cancelled = false;
    publicStatsApi
      .vendors()
      .then((r) => {
        if (!cancelled) setOffer(r.offer);
      })
      .catch(() => {
        // Public endpoint, never block the page on a fetch failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A capped free window is running (and still has room) → say what it grants.
  // On the trial tier there is no such promise, so there is no line.
  const offerLine =
    offer && offer.spots_left > 0
      ? offer.tier === "founding"
        ? t("vendors.offer_founding")
        : offer.tier === "early"
          ? t("vendors.offer_early")
          : null
      : null;

  // Growth loop: anyone on the vendor site can pass a link on so their friends
  // come recommend a supplier they trust. Native share sheet on mobile, with a
  // copy-to-clipboard fallback everywhere else. The link points at the vendor
  // site itself, where the "suggest a supplier" entry lives.
  async function shareRecommendPrompt() {
    const url = `${window.location.origin}/vendors`;
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
    <PublicShell>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-12 pb-10 sm:px-6 sm:pt-20 sm:pb-14 lg:grid-cols-[1fr_1fr] lg:items-center lg:gap-16">
        <div className="text-center lg:text-left">
          {/* The headline is short enough to carry real display size now that
              no badge sits above it. */}
          <h1 className="font-grotesk text-4xl font-semibold leading-[1.02] tracking-tight text-ink-900 sm:text-6xl dark:text-paper-50">
            {t("vendors.hero_title")}
          </h1>
          <p className="mt-5 text-base leading-relaxed text-ink-600 sm:text-lg dark:text-umber-200">
            {t("vendors.hero_sub")}
          </p>
          {/* Single dominant action. Everything else below it is a text link. */}
          <div className="mt-8">
            <Link
              to="/vendors/signup"
              className="btn-primary btn-lg inline-flex items-center gap-2 shadow-sm"
            >
              {t("vendors.signup_cta")}
              <ArrowRight size={18} aria-hidden />
            </Link>
            <p className="mt-3 text-sm text-ink-500 dark:text-umber-300">
              {t("vendors.cta_microcopy")}
            </p>
            {offerLine && (
              <p className="mt-1 text-sm font-medium text-ink-700 dark:text-umber-100">
                {offerLine}
              </p>
            )}
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 lg:justify-start">
            <VendorDemoLaunchButton variant="quiet" />
            <Link
              to="/login"
              className="text-sm font-medium text-ink-600 underline-offset-2 hover:underline dark:text-umber-200"
            >
              {t("vendors.have_account_cta")}
            </Link>
          </div>
          {/* Wrong-audience escape hatch — one compact line so it stays quiet
              (audit item 12). */}
          <div className="mt-5 text-sm text-ink-500 lg:text-left dark:text-umber-300">
            {t("vendors.wrong_audience")}{" "}
            <Link to="/signup" className="font-medium underline underline-offset-2">
              {t("vendors.couple_escape_link")}
            </Link>
            {" · "}
            <Link to="/planners" className="font-medium underline underline-offset-2">
              {t("vendors.planner_escape_link")}
            </Link>
          </div>
        </div>
        <div className="mx-auto w-full max-w-md lg:max-w-none">
          <VendorListingMockup className="h-auto w-full" />
        </div>
      </section>

      {/* Benefits. Order is deliberate: what it costs, how fast you are live,
          why the list is short. */}
      <section className="bg-paper-100/60 dark:bg-umber-900/40">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
            <Benefit
              icon={<Receipt size={22} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_1_title")}
              body={t("vendors.benefit_1_body")}
            />
            <Benefit
              icon={<Inbox size={22} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_2_title")}
              body={t("vendors.benefit_2_body")}
            />
            <Benefit
              icon={<Gem size={22} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_3_title")}
              body={t("vendors.benefit_3_body")}
            />
          </div>
        </div>
      </section>

      <ClosingBand />

      {/* Recommend-a-supplier prompt — two ways to help: register the vendor
          yourself (verify email, no account needed) or pass the link on. */}
      <section className="mx-auto max-w-3xl px-4 pb-12 sm:px-6">
        <div className="card flex flex-col items-start gap-5 !p-6 sm:flex-row sm:items-center sm:justify-between sm:!p-8">
          <div className="min-w-0">
            <h2 className="font-grotesk text-xl text-ink-900 sm:text-2xl dark:text-paper-50">
              {t("vendors.recommend_title")}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-600 dark:text-umber-200">
              {t("vendors.recommend_body")}
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto">
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
      </section>

      <SubmitSupplierModal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        onSubmitted={() => setRegisterOpen(false)}
        visitor
      />

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
 *  those are gone on purpose (see rule 3 at the top) and the section now stands
 *  on the offer itself, which needs no number to be true. */
function ClosingBand() {
  const { t } = useT();
  return (
    <section className="mx-auto max-w-6xl px-4 py-12 text-center sm:px-6 sm:py-16">
      <h2 className="font-grotesk text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl dark:text-paper-50">
        {t("vendors.closing_title")}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-ink-600 dark:text-umber-200">
        {t("vendors.closing_body")}
      </p>
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
      <div className="mt-8">
        <Link
          to="/vendors/signup"
          className="btn-primary btn-lg inline-flex items-center gap-2 shadow-sm"
        >
          {t("vendors.closing_cta")}
          <ArrowRight size={18} aria-hidden />
        </Link>
      </div>
    </section>
  );
}

function Benefit({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <article className="card flex h-full items-start gap-3.5 !p-5">
      <span className="mt-0.5 inline-flex shrink-0 text-ink-900 dark:text-paper-50">{icon}</span>
      <div className="min-w-0">
        <h3 className="font-grotesk text-base text-ink-900 dark:text-paper-50">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-600 dark:text-umber-200">{body}</p>
      </div>
    </article>
  );
}
