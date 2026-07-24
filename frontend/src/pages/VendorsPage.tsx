// Public vendor marketing page. Pitches the vendor SaaS and routes into the
// self-serve signup at /vendors/signup. The old 4-step public waitlist form
// (admin-accept → emailed token activation) is retired — vendors now create an
// account directly and run the in-app onboarding wizard.

import { ArrowLeft, Gem, MapPinned, PhoneCall, Share2, Store } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { VendorListingMockup } from "../components/mockups";
import { PublicShell } from "../components/PublicShell";
import { SubmitSupplierModal } from "../components/SubmitSupplierModal";
import { VendorDemoLaunchButton } from "../components/VendorDemoLaunchButton";
import { useToast } from "../components/ui";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

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
          <h1 className="font-grotesk text-4xl leading-[1.05] tracking-tight text-ink-900 sm:text-6xl dark:text-paper-50">
            {t("vendors.hero_title")}
          </h1>
          <div className="mt-8 flex flex-col flex-wrap items-center gap-3 sm:flex-row lg:justify-start">
            <Link to="/vendors/signup" className="btn-primary btn-lg shadow-sm">
              {t("vendors.signup_cta")}
            </Link>
            <VendorDemoLaunchButton />
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

      {/* Benefits */}
      <section className="bg-paper-100/60 dark:bg-umber-900/40">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
            {/* Direct contact leads — it's the differentiator vendors care about
                most (audit item 9). */}
            <Benefit
              icon={<PhoneCall size={22} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_3_title")}
              body={t("vendors.benefit_3_body")}
            />
            <Benefit
              icon={<Gem size={22} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_1_title")}
              body={t("vendors.benefit_1_body")}
            />
            <Benefit
              icon={<MapPinned size={22} strokeWidth={1.75} aria-hidden />}
              title={t("vendors.benefit_2_title")}
              body={t("vendors.benefit_2_body")}
            />
          </div>
        </div>
      </section>

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
              className="btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap"
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
