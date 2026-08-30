// /camera — public, unauthenticated landing page for Wedding Camera.
//
// Two audiences share this one page, honestly: a Weddly couple, for whom the
// feature already ships free (the hero below is the exact CameraHero card
// rendered inside the authenticated dashboard — same component, so the
// promise and the product never drift apart), and a stand-alone buyer whose
// wedding isn't on Weddly at all, for whom only the waitlist further down is
// real today (the checkout for that half doesn't exist yet).
import { ArrowLeft, Camera, Hourglass, ScanLine, Sparkles, Wifi } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { CameraHero, DEMO_STRIP } from "../components/CameraHero";
import { NewsletterCapture } from "../components/NewsletterCapture";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

interface PricingTier {
  cap: number;
  price: string;
  couplePrice?: string;
}

// Anchored to the owner's own $10@50 / $25@100 pricing, extrapolated along
// pov.camera's published ladder. USD on purpose: this half's audience is not
// scoped to a couple's workspace currency. -25% is the standing Weddly
// couple discount on every paid tier; the free tier has no discount to show.
const TIERS: PricingTier[] = [
  { cap: 25, price: "$0" },
  { cap: 50, price: "$9.99", couplePrice: "$7.49" },
  { cap: 100, price: "$24.99", couplePrice: "$18.74" },
  { cap: 175, price: "$44.99", couplePrice: "$33.74" },
  { cap: 250, price: "$69.99", couplePrice: "$52.49" },
  { cap: 400, price: "$99.99", couplePrice: "$74.99" },
];

export default function CameraPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  useDocumentMeta("camera.seo_title", "camera.seo_description");

  const features = [
    { Icon: ScanLine, title: t("camera.feature_1_title"), body: t("camera.feature_1_body") },
    { Icon: Camera, title: t("camera.feature_2_title"), body: t("camera.feature_2_body") },
    { Icon: Wifi, title: t("camera.feature_3_title"), body: t("camera.feature_3_body") },
    { Icon: Hourglass, title: t("camera.feature_4_title"), body: t("camera.feature_4_body") },
  ];

  return (
    <PublicShell>
      <div className="flex items-center justify-center gap-2 bg-lemonade-yellow px-4 py-2.5 text-center text-sm font-medium text-lemonade-ink">
        <Sparkles size={16} aria-hidden="true" className="shrink-0" />
        <p>{t("camera.banner_text")}</p>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14" lang={locale}>
        <CameraHero
          album={null}
          coupleName={null}
          coverPhoto={DEMO_STRIP[0]}
          onCreate={() => navigate("/signup")}
          onShare={() => {}}
        />

        <p className="mt-5 text-center text-sm text-umber-600 dark:text-umber-300">
          {t("camera.already_included")}{" "}
          <Link
            to="/app/media"
            className="font-semibold text-blush-700 underline decoration-blush-300 underline-offset-2 hover:text-blush-800 dark:text-blush-300"
          >
            {t("camera.already_included_cta")}
          </Link>
        </p>

        {/* Feature highlights */}
        <section className="mt-20 sm:mt-28">
          <h2 className="font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("camera.features_title")}
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ Icon, title, body }) => (
              <div key={title}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-paper-200 dark:bg-umber-800">
                  <Icon
                    size={20}
                    className="text-blush-600 dark:text-blush-300"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="mt-4 font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-umber-700 dark:text-umber-200">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Stand-alone product */}
        <section
          id="standalone"
          className="mt-20 scroll-mt-20 border-t border-paper-300 pt-16 dark:border-umber-700 sm:mt-28"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-blush-700 dark:text-blush-300">
            {t("camera.standalone_eyebrow")}
          </p>
          <h2 className="mt-3 font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("camera.standalone_title")}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-umber-700 dark:text-umber-200">
            {t("camera.standalone_body")}
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {TIERS.map((tier) => (
              <div
                key={tier.cap}
                className="rounded-xl border border-paper-300 bg-white p-5 dark:border-umber-700 dark:bg-umber-800"
              >
                <p className="text-sm font-medium text-umber-600 dark:text-umber-300">
                  {t("camera.pricing_guest_cap", { n: tier.cap })}
                </p>
                <p className="mt-2 font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50">
                  {tier.price}
                </p>
                {tier.couplePrice && (
                  <p className="mt-1 text-xs text-blush-700 dark:text-blush-300">
                    {t("camera.pricing_couple_note", { price: tier.couplePrice })}
                  </p>
                )}
              </div>
            ))}
            <div className="rounded-xl border border-dashed border-paper-400 p-5 dark:border-umber-600">
              <p className="text-sm font-medium text-umber-600 dark:text-umber-300">
                {t("camera.pricing_custom_cap")}
              </p>
              <p className="mt-2 font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50">
                {t("camera.pricing_custom_price")}
              </p>
            </div>
          </div>
          <p className="mt-4 text-xs text-umber-500 dark:text-umber-400">
            {t("camera.pricing_note")}
          </p>

          <div className="mt-10 max-w-md">
            <p className="font-grotesk text-lg font-semibold text-umber-900 dark:text-paper-50">
              {t("camera.notify_title")}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-umber-700 dark:text-umber-200">
              {t("camera.notify_body")}
            </p>
            <div className="mt-4">
              <NewsletterCapture source="camera_page" />
            </div>
          </div>
        </section>

        <p className="mt-16 text-sm">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-ink-600 hover:text-ink-900 dark:text-umber-200 dark:hover:text-paper-50"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            {t("vendors.back_to_landing")}
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
