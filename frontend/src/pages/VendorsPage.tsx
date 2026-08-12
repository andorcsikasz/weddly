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
//      The hero mockup is the one place a NUMBER appears, and only as a
//      placeholder: the card shows a rating and a price band because those are
//      fields the vendor's real listing has. It still carries no review count,
//      which is the value that would read as invented proof.
//   4. ONE dominant call to action (signup), repeated once at the end, with
//      the demo as a real outline button beside it in both places. The demo
//      used to be a quiet text link and was too easy to miss: a vendor who
//      won't hand over an email yet still clicks "see the demo", and that is
//      the only path from this page into the product. The wrong-audience links
//      stay quiet text; there is deliberately no "log in" link in the hero,
//      because the header already carries one (icon on desktop, menu item on
//      mobile) and a second one just competes with the signup button.

import { ArrowLeft, ArrowRight, Gem, Inbox, Receipt, Share2, Store } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { TracingFrame } from "../components/TracingFrame";
import { VendorDemoLaunchButton } from "../components/VendorDemoLaunchButton";
import { VendorSearchBar } from "../components/VendorSearchBar";
import { useToast } from "../components/ui";
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
    <PublicShell>
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
            <VendorSearchBar className="mt-8 text-left" />
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
        {/* The card carries itself: a listing card next to a vendor pitch needs
            no line telling the vendor it is their listing card. The caption that
            used to sit here said what the picture already showed. */}
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
