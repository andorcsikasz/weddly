// /camera — public, unauthenticated landing page for Wedding Camera.
//
// Two audiences share this one page, honestly: a Weddly couple, for whom the
// feature already ships free (the hero below is the exact CameraHero card
// rendered inside the authenticated dashboard — same component, so the
// promise and the product never drift apart), and a stand-alone buyer whose
// wedding isn't on Weddly at all, for whom only the waitlist further down is
// real today (the checkout for that half doesn't exist yet).
//
// Forced dark, one font: this page always renders on the dark palette
// regardless of the site-wide theme toggle (the same local `dark`-class
// technique PublicFooter uses to stay a black slab in both themes), and
// every heading and body line on it is font-grotesk, so the hero's h1 opts
// out of the workspace's usual Cormorant serif via `headingFont`.
import { ArrowRight, Camera, Hourglass, ScanLine, Wifi } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FILM_TIER_CAPS, FILM_TIER_PRICE_EUR_CENTS } from "@shared/types";
import { CameraHero, DEMO_STRIP } from "../components/CameraHero";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

interface PricingTier {
  cap: number;
  /** Stand-alone price for a wedding that isn't on Weddly. */
  price: string;
}

// Anchored to the owner's own $10@50 / $25@100 pricing, extrapolated along
// pov.camera's published ladder. USD on purpose: this half's audience is not
// scoped to a couple's workspace currency.
const TIERS: PricingTier[] = [
  { cap: 25, price: "$0" },
  { cap: 50, price: "$9.99" },
  { cap: 100, price: "$24.99" },
  { cap: 175, price: "$44.99" },
  { cap: 250, price: "$69.99" },
  { cap: 400, price: "$99.99" },
];

/** What a Weddly couple pays for a tier, derived from the SAME constants the
 *  in-app film enforces, so this page cannot promise a cap the product does
 *  not grant. `included` up to the subscription's cap, the one-time unlock up
 *  to its cap, and null past it (the app has no tier that large). */
function couplePrice(cap: number): "included" | string | null {
  if (cap <= FILM_TIER_CAPS.free) return "included";
  if (cap <= FILM_TIER_CAPS.paid) return `€${(FILM_TIER_PRICE_EUR_CENTS.paid / 100).toFixed(2)}`;
  return null;
}

/** One option row of the pricing stack: label + headcount left, price right.
 *  `hidden` renders the card behind the stack, where only its edge shows. */
function PriceRow({
  label,
  cap,
  price,
  hidden = false,
}: {
  label: string;
  cap: string;
  price: string;
  hidden?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 px-5 py-4 ${hidden ? "invisible" : ""}`}
    >
      <div>
        <p className="text-base font-semibold text-paper-50">{label}</p>
        <p className="mt-0.5 text-sm text-paper-400">{cap}</p>
      </div>
      <span className="stat-num text-2xl font-semibold tabular-nums tracking-[-0.02em] text-paper-50">
        {price}
      </span>
    </div>
  );
}

export default function CameraPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  useDocumentMeta("camera.seo_title", "camera.seo_description");
  const [tierIndex, setTierIndex] = useState(1);
  // TIERS[1] as the fallback: the picker only offers to [0, TIERS.length - 1]
  // so this only ever matters to the type checker, never at runtime.
  const tier = TIERS[tierIndex] ?? (TIERS[1] as PricingTier);
  const tierCouplePrice = couplePrice(tier.cap);
  const includedLine = t("camera.already_included", { n: FILM_TIER_CAPS.free });

  const features = [
    { Icon: ScanLine, title: t("camera.feature_1_title"), body: t("camera.feature_1_body") },
    { Icon: Camera, title: t("camera.feature_2_title"), body: t("camera.feature_2_body") },
    { Icon: Wifi, title: t("camera.feature_3_title"), body: t("camera.feature_3_body") },
    { Icon: Hourglass, title: t("camera.feature_4_title"), body: t("camera.feature_4_body") },
  ];

  return (
    <PublicShell>
      <div className="dark bg-umber-950 font-grotesk text-paper-100">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20" lang={locale}>
          <CameraHero
            album={null}
            coupleName={null}
            coverPhoto={DEMO_STRIP[0]}
            onCreate={() => navigate("/signup")}
            onShare={() => {}}
            headingFont="grotesk"
            accent="gold"
            minimal
            title={t("camera.hero_title")}
            subtitle={t("camera.hero_sub")}
            finePrint={includedLine}
            tryQr={{ src: "/camera-try-qr.svg", label: t("camera.try_title") }}
            secondaryAction={
              // On a phone the visitor IS on the device, so a link beats a QR.
              <Link
                to="/camera/try"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-paper-50/20 px-7 py-3.5 text-sm font-semibold text-paper-50 transition-[transform,background-color] duration-150 ease-out hover:bg-paper-50/5 active:scale-[0.97] lg:hidden"
              >
                <Camera size={16} aria-hidden="true" />
                {t("camera.try_cta")}
              </Link>
            }
          />

          {/* Feature highlights — icon, title, one short line. No cards, no
              counters: four plain columns read calmer than four boxes. */}
          <section className="mt-24 sm:mt-32">
            <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {features.map(({ Icon, title, body }) => (
                <div key={title}>
                  <Icon size={20} strokeWidth={1.5} className="text-paper-300" aria-hidden="true" />
                  <h3 className="mt-4 text-base font-semibold text-paper-50">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-paper-400">{body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Stand-alone product */}
          <section
            id="standalone"
            className="mt-20 scroll-mt-20 border-t border-paper-50/10 pt-14 sm:mt-24 sm:pt-16"
          >
            <div className="flex flex-col items-center text-center">
              <h2 className="max-w-lg text-xl font-semibold tracking-tight text-paper-50 sm:text-2xl">
                {t("camera.standalone_title")}
              </h2>
              <p className="mt-2 text-sm text-paper-400">{t("camera.standalone_body")}</p>

              {/* Uber-style: a segmented headcount picker, then the price as
                  an option row, label left and number right. */}
              <div className="mt-8 w-full max-w-lg text-left">
                <div
                  role="radiogroup"
                  aria-label={t("camera.standalone_title")}
                  className="grid grid-cols-6 gap-1 rounded-full bg-paper-50/[0.06] p-1"
                >
                  {TIERS.map((tw, i) => (
                    <button
                      key={tw.cap}
                      type="button"
                      role="radio"
                      aria-checked={i === tierIndex}
                      aria-label={t("camera.pricing_guest_cap", { n: tw.cap })}
                      onClick={() => setTierIndex(i)}
                      className={`min-h-10 rounded-full text-sm font-semibold tabular-nums transition-colors duration-150 ${
                        i === tierIndex
                          ? "bg-paper-50 text-umber-950"
                          : "text-paper-300 hover:bg-paper-50/[0.06] hover:text-paper-50"
                      }`}
                    >
                      {tw.cap}
                    </button>
                  ))}
                </div>

                {/* The Weddly price is the card on top; the stand-alone price
                    is a second card tucked behind it, only its edge showing,
                    so the number a couple pays is the only one read. Both
                    cards share one grid cell so the stack is as tall as a
                    single row. Past the in-app cap the stand-alone card is
                    the only one and sits on top. */}
                <div className="group mt-3 mb-4 grid">
                  {tierCouplePrice && (
                    <div className="col-start-1 row-start-1 rounded-2xl bg-umber-600 ring-1 ring-paper-50/30 transition-transform duration-300 ease-out [transform:translateY(14px)_scale(0.92)] group-hover:[transform:translateY(20px)_scale(0.92)]">
                      <PriceRow
                        label={t("camera.pricing_standard")}
                        cap={t("camera.pricing_guest_cap", { n: tier.cap })}
                        price={tier.price}
                        hidden
                      />
                    </div>
                  )}
                  <div className="relative col-start-1 row-start-1 rounded-2xl bg-umber-900 shadow-[0_12px_28px_-12px_rgba(0,0,0,0.8)] ring-2 ring-paper-50">
                    <PriceRow
                      label={t(
                        tierCouplePrice ? "camera.pricing_couple_label" : "camera.pricing_standard",
                      )}
                      cap={t("camera.pricing_guest_cap", { n: tier.cap })}
                      price={
                        tierCouplePrice === "included" ? "€0" : (tierCouplePrice ?? tier.price)
                      }
                    />
                  </div>
                </div>
                <Link
                  to="/signup"
                  className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-paper-50 px-7 py-3.5 text-base font-semibold text-umber-950 transition-[transform,background-color] duration-150 ease-out hover:bg-paper-100 active:scale-[0.98]"
                >
                  {t("camera.create_event_cta")}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </div>

              <p className="mt-5 text-xs text-paper-500">
                {t("camera.pricing_custom_cap")} · {t("camera.pricing_custom_price")} ·{" "}
                {t("camera.pricing_note")}
              </p>
            </div>
          </section>

          <p className="mt-24 text-center text-sm text-paper-400">
            {includedLine}{" "}
            <Link
              to="/app/media"
              className="font-semibold text-paper-100 underline decoration-paper-50/25 underline-offset-4 transition-colors hover:decoration-paper-50/60"
            >
              {t("camera.already_included_cta")}
            </Link>
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
