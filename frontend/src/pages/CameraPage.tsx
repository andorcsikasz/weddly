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
import { ArrowLeft, Camera, Hourglass, ScanLine, Wifi } from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CameraHero, DEMO_STRIP } from "../components/CameraHero";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

interface PricingTier {
  cap: number;
  price: string;
  /** 25% off for a Weddly couple on every paid tier, except the 50-guest
   *  tier, which is free outright for couples already on Weddly (`"free"`).
   *  The 25-guest tier needs no couple note since it's already free for
   *  everyone. */
  couplePrice?: string | "free";
}

// Anchored to the owner's own $10@50 / $25@100 pricing, extrapolated along
// pov.camera's published ladder. USD on purpose: this half's audience is not
// scoped to a couple's workspace currency.
const TIERS: PricingTier[] = [
  { cap: 25, price: "$0" },
  { cap: 50, price: "$9.99", couplePrice: "free" },
  { cap: 100, price: "$24.99", couplePrice: "$18.74" },
  { cap: 175, price: "$44.99", couplePrice: "$33.74" },
  { cap: 250, price: "$69.99", couplePrice: "$52.49" },
  { cap: 400, price: "$99.99", couplePrice: "$74.99" },
];

/** Thumb-aware fill offset for `.camera-slider`'s `--camera-slider-fill` var,
 *  same idiom as the budget sliders' `rangeFillStyle`: the raw step
 *  percentage overshoots near the middle and undershoots near the ends
 *  because the native thumb travels between `thumbPx/2` and
 *  `width - thumbPx/2`, not edge to edge. */
function cameraSliderStyle(index: number, max: number, thumbPx = 20): CSSProperties {
  const pct = max > 0 ? (index / max) * 100 : 0;
  const offsetPx = thumbPx * (0.5 - pct / 100);
  return { "--camera-slider-fill": `calc(${pct}% + ${offsetPx.toFixed(3)}px)` } as CSSProperties;
}

export default function CameraPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  useDocumentMeta("camera.seo_title", "camera.seo_description");
  const [tierIndex, setTierIndex] = useState(1);
  // TIERS[1] as the fallback: the slider is clamped to [0, TIERS.length - 1]
  // so this only ever matters to the type checker, never at runtime.
  const tier = TIERS[tierIndex] ?? (TIERS[1] as PricingTier);

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
          />

          <p className="mt-5 text-center text-sm text-paper-300">
            {t("camera.already_included")}{" "}
            <Link
              to="/app/media"
              className="font-semibold text-paper-200 underline decoration-paper-300/50 underline-offset-2 hover:text-paper-50"
            >
              {t("camera.already_included_cta")}
            </Link>
          </p>

          {/* Feature highlights */}
          <section className="mt-20 sm:mt-28">
            <h2 className="text-2xl font-bold tracking-tight text-paper-50 sm:text-3xl">
              {t("camera.features_title")}
            </h2>
            <div className="mt-8 grid overflow-hidden rounded-2xl border border-paper-50/10 sm:grid-cols-2 sm:divide-x sm:divide-paper-50/10 lg:grid-cols-4">
              {features.map(({ Icon, title, body }, i) => (
                <div
                  key={title}
                  className="border-t border-paper-50/10 p-6 first:border-t-0 sm:border-t-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-paper-50/15 bg-paper-50/[0.04]">
                      <Icon size={20} className="text-paper-300" aria-hidden="true" />
                    </span>
                    <span className="font-grotesk text-[11px] font-semibold tracking-[0.2em] text-paper-500">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-paper-50">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-paper-300">{body}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Stand-alone product */}
          <section
            id="standalone"
            className="mt-20 scroll-mt-20 border-t border-paper-50/10 pt-16 sm:mt-28 sm:pt-20"
          >
            <div className="flex min-h-[28rem] flex-col items-center justify-center text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-paper-300">
                {t("camera.standalone_eyebrow")}
              </p>
              <h2 className="mt-3 max-w-lg text-2xl font-bold tracking-tight text-paper-50 sm:text-3xl">
                {t("camera.standalone_title")}
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-paper-300">
                {t("camera.standalone_body")}
              </p>

              <div className="mt-10 w-full max-w-md rounded-[2rem] border border-paper-50/10 bg-gradient-to-b from-paper-50/[0.05] to-transparent p-8 shadow-[0_24px_70px_rgba(0,0,0,0.4)] sm:p-10">
                <span
                  key={tier.price}
                  className="stat-num animate-fade-in-up block text-6xl font-bold tracking-tight text-paper-50"
                >
                  {tier.price}
                </span>
                <p className="mt-2 text-sm font-semibold text-paper-400">
                  {t("camera.pricing_guest_cap", { n: tier.cap })}
                </p>
                {tier.couplePrice && (
                  <span className="mt-4 inline-flex rounded-full bg-paper-300/15 px-3 py-1 text-xs font-bold text-paper-100 ring-1 ring-paper-300/20">
                    {tier.couplePrice === "free"
                      ? t("camera.pricing_couple_free")
                      : t("camera.pricing_couple_note", { price: tier.couplePrice })}
                  </span>
                )}

                <div className="mt-9 text-left">
                  <input
                    type="range"
                    min={0}
                    max={TIERS.length - 1}
                    step={1}
                    value={tierIndex}
                    onChange={(e) => setTierIndex(Number(e.target.value))}
                    className="camera-slider"
                    style={cameraSliderStyle(tierIndex, TIERS.length - 1)}
                    aria-label={t("camera.standalone_title")}
                    aria-valuetext={t("camera.pricing_guest_cap", { n: tier.cap })}
                  />
                  <div className="mt-3 flex justify-between">
                    {TIERS.map((tw, i) => (
                      <button
                        key={tw.cap}
                        type="button"
                        onClick={() => setTierIndex(i)}
                        aria-label={t("camera.pricing_guest_cap", { n: tw.cap })}
                        aria-current={i === tierIndex}
                        className={`min-h-6 min-w-6 text-xs font-bold tabular-nums transition-colors ${
                          i === tierIndex ? "text-paper-50" : "text-paper-500 hover:text-paper-300"
                        }`}
                      >
                        {tw.cap}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <p className="mt-6 text-xs text-paper-400">
                {t("camera.pricing_custom_cap")} · {t("camera.pricing_custom_price")} ·{" "}
                {t("camera.pricing_note")}
              </p>
            </div>
          </section>

          <p className="mt-16 text-center text-sm">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-paper-300 hover:text-paper-50"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {t("vendors.back_to_landing")}
            </Link>
          </p>
        </div>
      </div>
    </PublicShell>
  );
}
