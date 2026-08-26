// /camera — public, unauthenticated pov.camera-style standalone product page.
// Open to anyone, not just Weddly couples (see the memory note this ships
// against: the buyer here has no `couples` row and no login). The checkout
// itself doesn't exist yet, which is why `dev_banner` is load-bearing copy,
// not a decorative ribbon — nothing on this page is bookable today.

import { ArrowLeft, Camera, HardHat, QrCode, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
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
// pov.camera's published ladder. USD on purpose: this product's audience is
// not scoped to a couple's workspace currency. -25% is the standing Weddly
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
  useDocumentMeta("camera.seo_title", "camera.seo_description");

  const steps = [
    { Icon: QrCode, title: t("camera.step1_title"), body: t("camera.step1_body") },
    { Icon: Camera, title: t("camera.step2_title"), body: t("camera.step2_body") },
    { Icon: Sparkles, title: t("camera.step3_title"), body: t("camera.step3_body") },
  ];

  return (
    <PublicShell>
      {/* Under-development banner. Lemonade is Weddly's own secondary accent
          (see the couple-cards deck), and it happens to echo pov.camera's own
          mustard-yellow CTA — a deliberate overlap, not a coincidence, since
          it lets this preview nod at the reference product without stepping
          outside the design system's approved tokens. */}
      <div className="flex items-center justify-center gap-2 bg-lemonade-yellow px-4 py-2.5 text-center text-sm font-medium text-lemonade-ink">
        <HardHat size={16} aria-hidden="true" className="shrink-0" />
        <p>{t("camera.dev_banner")}</p>
      </div>

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16" lang={locale}>
        {/* Hero */}
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-blush-700 dark:text-blush-300">
              {t("camera.eyebrow")}
            </p>
            <h1 className="mt-4 whitespace-pre-line font-grotesk text-4xl font-semibold leading-[1.08] tracking-tight text-umber-900 dark:text-paper-50 sm:text-5xl">
              {t("camera.h1")}
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-umber-700 dark:text-umber-200 sm:text-lg">
              {t("camera.subtitle")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#notify" className="btn-primary">
                {t("camera.cta_notify")}
              </a>
              <a href="#how-it-works" className="btn-outline">
                {t("camera.cta_how_it_works")}
              </a>
            </div>
          </div>

          {/* Decorative phone mockup — echoes the reference screenshots'
              persistent shot counter + yellow capture CTA without needing a
              real image asset. Entirely aria-hidden: it illustrates the
              product, the copy around it carries the actual information. */}
          <div className="mx-auto w-full max-w-[260px]" aria-hidden="true">
            <div className="dark aspect-[9/18] overflow-hidden rounded-[2rem] border-4 border-umber-950 bg-umber-950 shadow-xl">
              <div className="flex h-full flex-col justify-between p-5">
                <div className="flex items-center justify-between">
                  <span className="font-grotesk text-[10px] font-semibold tracking-[0.24em] text-paper-100">
                    {t("camera.mock_wordmark")}
                  </span>
                  <span className="h-2 w-2 rounded-full bg-blush-500" />
                </div>
                <div className="flex flex-1 items-center justify-center">
                  <Camera size={64} strokeWidth={1} className="text-paper-200/70" />
                </div>
                <div className="space-y-3">
                  <p className="text-center text-xs font-medium tracking-wide text-paper-200">
                    {t("camera.mock_counter")}
                  </p>
                  <div className="rounded-full bg-lemonade-yellow py-3 text-center text-sm font-semibold text-lemonade-ink">
                    {t("camera.mock_cta")}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* How it works */}
        <section id="how-it-works" className="mt-20 scroll-mt-20 sm:mt-28">
          <h2 className="font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("camera.how_it_works_title")}
          </h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            {steps.map(({ Icon, title, body }) => (
              <div key={title}>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-paper-200 dark:bg-umber-800">
                  <Icon
                    size={20}
                    className="text-umber-700 dark:text-umber-200"
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

        {/* Pricing */}
        <section className="mt-20 sm:mt-28">
          <h2 className="font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("camera.pricing_title")}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-umber-700 dark:text-umber-200">
            {t("camera.pricing_subtitle")}
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
        </section>

        {/* Notify */}
        <section id="notify" className="mt-20 scroll-mt-20 sm:mt-28">
          <h2 className="font-grotesk text-2xl font-semibold text-umber-900 dark:text-paper-50 sm:text-3xl">
            {t("camera.notify_title")}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-umber-700 dark:text-umber-200">
            {t("camera.notify_body")}
          </p>
          <div className="mt-6 max-w-md">
            <NewsletterCapture source="camera_page" />
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
