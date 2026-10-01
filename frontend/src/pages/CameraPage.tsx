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
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FILM_FILTERS, FILM_TIER_CAPS, FILM_TIER_PRICE_EUR_CENTS } from "@shared/types";
import { CameraHero, CameraPreview, DEMO_STRIP } from "../components/CameraHero";
import { CameraReviews } from "../components/CameraReviews";
import { CameraShare } from "../components/CameraShare";
import { PublicShell } from "../components/PublicShell";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";

/** What a guest's roll looks like: wedding shots through the in-app camera's
 *  own analog looks, each with the orange date print a disposable burns in. */
const ROLL: { src: string; filter: string; stamp: string; position?: string }[] = [
  { src: "/demo/film-01.jpg", filter: FILM_FILTERS.warm, stamp: "'26 09 12" },
  { src: "/design-photos/12-ceremony-aisle.jpg", filter: FILM_FILTERS.vintage, stamp: "'26 09 12" },
  { src: "/design-photos/04-greenery-arch.jpg", filter: FILM_FILTERS.bw, stamp: "'26 09 12" },
  {
    src: "/demo/wedding-party-hero.jpg",
    filter: FILM_FILTERS.warm,
    stamp: "'26 09 12",
    position: "60% 50%",
  },
  { src: "/demo/film-02.jpg", filter: FILM_FILTERS.vintage, stamp: "'26 09 12" },
  { src: "/design-photos/01-reception-pergola.jpg", filter: FILM_FILTERS.bw, stamp: "'26 09 12" },
  { src: "/design-photos/05-draped-arch.jpg", filter: FILM_FILTERS.warm, stamp: "'26 09 12" },
  {
    src: "/design-photos/02-reception-candlelit.jpg",
    filter: FILM_FILTERS.cinematic,
    stamp: "'26 09 13",
  },
  { src: "/demo/film-03.jpg", filter: FILM_FILTERS.bw, stamp: "'26 09 13" },
  { src: "/design-photos/11-wedding-cake.jpg", filter: FILM_FILTERS.vintage, stamp: "'26 09 13" },
  {
    src: "/design-photos/06-pampas-candles.jpg",
    filter: FILM_FILTERS.cinematic,
    stamp: "'26 09 13",
  },
];

/** How far (px) the roll drifts sideways over the whole time it is on screen. */
const ROLL_DRIFT_PX = 520;

interface PricingTier {
  cap: number;
  /** Stand-alone price for a wedding that isn't on Weddly. */
  price: string;
}

// Anchored to the owner's own 10@50 / 25@100 pricing, extrapolated along
// pov.camera's published ladder. EUR, the same currency as the in-app film
// price beside it (owner call 2026-10-01): two currencies on one card made
// the Weddly discount impossible to read at a glance.
const TIERS: PricingTier[] = [
  { cap: 25, price: "€4.99" },
  { cap: 50, price: "€9.99" },
  { cap: 100, price: "€24.99" },
  { cap: 175, price: "€44.99" },
  { cap: 250, price: "€69.99" },
  { cap: 400, price: "€99.99" },
];

/** Headcounts above this get the Weddly price as half the stand-alone price
 *  (owner call 2026-10-01: at 175 guests Weddly is 50% off, not ~83%, and the
 *  same rule carries on to 250 and 400).
 *  NOTE: page copy only. The in-app film unlocks up to `FILM_TIER_CAPS.paid`
 *  (200) for `FILM_TIER_PRICE_EUR_CENTS.paid` and has no tier past that, so
 *  the 175 price disagrees with what the app charges and 250 / 400 are not
 *  purchasable in the app yet. */
const HALF_PRICE_FROM_CAP = 100;

/** What a Weddly couple pays for a tier: `included` up to the subscription's
 *  film cap, the in-app one-time unlock price up to 100 guests, and half the
 *  stand-alone price above that. */
function couplePrice(tier: PricingTier): "included" | string {
  if (tier.cap <= FILM_TIER_CAPS.free) return "included";
  if (tier.cap <= HALF_PRICE_FROM_CAP) {
    return `€${(FILM_TIER_PRICE_EUR_CENTS.paid / 100).toFixed(2)}`;
  }
  const standalone = Number(tier.price.replace(/[^0-9.]/g, ""));
  return `€${(Math.round((standalone / 2) * 10) / 10).toFixed(2)}`;
}

/** One option row of the pricing stack: label + headcount left, price right.
 *  `muted` is the card tucked behind the stack: smaller and quieter, so the
 *  Weddly price reads first and the stand-alone price reads second. */
function PriceRow({
  label,
  cap,
  price,
  muted = false,
}: {
  label: string;
  cap: string;
  price: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 ${muted ? "pb-3 pt-1" : "py-4"}`}>
      <div>
        <p
          className={`font-semibold ${muted ? "text-sm text-paper-300" : "text-base text-paper-50"}`}
        >
          {label}
        </p>
        <p
          key={cap}
          className={`mt-0.5 animate-card-lift text-paper-400 motion-reduce:animate-none ${muted ? "text-xs" : "text-sm"}`}
        >
          {cap}
        </p>
      </div>
      <span
        key={price}
        className={`stat-num animate-card-lift font-semibold tabular-nums tracking-[-0.02em] motion-reduce:animate-none ${
          muted ? "text-lg text-paper-300" : "text-2xl text-paper-50"
        }`}
      >
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
  const tierCouplePrice = couplePrice(tier);
  // The roll animates in once, the first time it scrolls into view.
  const rollRef = useRef<HTMLElement>(null);
  const [rollIn, setRollIn] = useState(false);
  useEffect(() => {
    const el = rollRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setRollIn(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRollIn(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ...and drifts sideways with the page scroll: right to left as the row
  // travels up through the viewport. While the row is on screen a rAF loop
  // re-reads its position EVERY frame and eases the track toward it (a lerp).
  // Driving it from scroll events instead made phones tremble on mobile: iOS
  // and Android deliver scroll events in bursts during momentum scrolling, so
  // the target jumped in steps the lerp then chased. The viewport height is
  // also pinned (re-read only on a real resize of the width or an orientation
  // change), because the mobile address bar collapsing changes innerHeight
  // mid-scroll and nudged every phone sideways. Written straight to the
  // track's style, so scrolling never re-renders the page.
  const rollTrackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const section = rollRef.current;
    const track = rollTrackRef.current;
    if (!section || !track) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let vh = window.innerHeight;
    let vw = window.innerWidth;
    const targetX = () => {
      const rect = section.getBoundingClientRect();
      const progress = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      return (0.5 - progress) * ROLL_DRIFT_PX;
    };
    let current = targetX();
    let frame = 0;
    const paint = () => {
      track.style.transform = `translate3d(${current.toFixed(2)}px,0,0)`;
    };
    const tick = () => {
      const target = targetX();
      const delta = target - current;
      current = Math.abs(delta) < 0.05 ? target : current + delta * 0.12;
      paint();
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const onResize = () => {
      if (window.innerWidth !== vw) {
        vw = window.innerWidth;
        vh = window.innerHeight;
      }
    };
    const onOrientation = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
    };
    paint();
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()), {
            rootMargin: "200px 0px",
          });
    if (io) io.observe(section);
    else start();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientation);
    return () => {
      stop();
      io?.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientation);
    };
  }, []);

  const features = [
    { Icon: ScanLine, title: t("camera.feature_1_title"), body: t("camera.feature_1_body") },
    { Icon: Camera, title: t("camera.feature_2_title"), body: t("camera.feature_2_body") },
    { Icon: Wifi, title: t("camera.feature_3_title"), body: t("camera.feature_3_body") },
    { Icon: Hourglass, title: t("camera.feature_4_title"), body: t("camera.feature_4_body") },
  ];

  return (
    <PublicShell flushFooter>
      <div className="dark overflow-x-clip bg-umber-950 font-grotesk text-paper-100">
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
          <section className="mt-32 sm:mt-48">
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

          {/* A guest's roll: a full-bleed strip of viewfinders, wider than
              the screen and centred on it, drifting sideways as the page
              scrolls. */}
          <section
            ref={rollRef}
            className={`relative left-1/2 mt-32 flex w-screen -translate-x-1/2 justify-center overflow-hidden py-6 sm:mt-48 ${
              rollIn ? "is-in" : ""
            }`}
          >
            <div
              ref={rollTrackRef}
              className="flex w-max shrink-0 gap-4 will-change-transform sm:gap-5"
            >
              {ROLL.map((shot, i) => (
                <div
                  key={shot.src}
                  className={`roll-item w-40 shrink-0 sm:w-52 ${i % 2 === 1 ? "mt-8" : ""}`}
                  style={{ "--roll-i": i } as CSSProperties}
                >
                  <div className="roll-bob">
                    <CameraPreview
                      inline
                      src={shot.src}
                      filter={shot.filter}
                      objectPosition={shot.position}
                      stamp={shot.stamp}
                      live
                      filmName={t("camera.roll_film_name")}
                      shotsLabel={t("media.film_shots_short").replace("{{n}}", String(36 - i * 3))}
                      className={i % 2 === 0 ? "-rotate-1" : "rotate-1"}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <div className="mt-32 sm:mt-48">
            <CameraShare coupleName={t("camera.roll_film_name")} />
          </div>

          <div className="mt-32 sm:mt-48">
            <CameraReviews />
          </div>

          {/* Stand-alone product */}
          <section
            id="standalone"
            className="mt-32 scroll-mt-20 border-t border-paper-50/10 pt-20 sm:mt-48 sm:pt-24"
          >
            <div className="flex flex-col items-center text-center">
              <h2 className="max-w-lg text-xl font-semibold tracking-tight text-paper-50 sm:text-2xl">
                {t("camera.standalone_title")}
              </h2>

              {/* Uber-style: a segmented headcount picker, then the price as
                  an option row, label left and number right. */}
              <div className="mt-8 w-full max-w-lg text-left">
                {/* The fill always runs from the start of the track to the
                    chosen stop and grows or shrinks as the headcount changes,
                    so "how many guests" reads as an amount, not a tab. */}
                <div
                  role="radiogroup"
                  aria-label={t("camera.standalone_title")}
                  className="relative grid grid-cols-6 gap-1 rounded-full bg-paper-50/[0.06] p-1"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1 left-1 rounded-full bg-paper-50 shadow-[0_2px_10px_rgba(0,0,0,0.35)] transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                    style={{
                      // (i + 1) chips plus the i gaps between them.
                      width: `calc(${tierIndex + 1} * (100% - 0.5rem - ${TIERS.length - 1} * 0.25rem) / ${TIERS.length} + ${tierIndex} * 0.25rem)`,
                    }}
                  />
                  {TIERS.map((tw, i) => (
                    <button
                      key={tw.cap}
                      type="button"
                      role="radio"
                      aria-checked={i === tierIndex}
                      aria-label={t("camera.pricing_guest_cap", { n: tw.cap })}
                      onClick={() => setTierIndex(i)}
                      className={`relative z-10 min-h-10 rounded-full text-sm font-semibold tabular-nums transition-colors duration-300 ${
                        i === tierIndex
                          ? "text-umber-950"
                          : i < tierIndex
                            ? "text-umber-950/40 hover:text-umber-950/70"
                            : "text-paper-50/35 hover:text-paper-50/70"
                      }`}
                    >
                      {tw.cap}
                    </button>
                  ))}
                </div>

                {/* The Weddly price is the card on top; the stand-alone price
                    is a second, narrower card tucked under its bottom edge and
                    tilted away (rotateX from the top), so it reads as sitting
                    BEHIND the Weddly card while its own row stays legible.
                    Past the in-app cap the stand-alone card is the only one. */}
                <div className="group mt-3 [perspective:700px]">
                  <div className="relative z-10 rounded-2xl bg-umber-900 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.85)] ring-2 ring-paper-50">
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
                  {tierCouplePrice && (
                    <div className="relative z-0 mx-auto -mt-4 w-[93%] origin-top rounded-b-2xl bg-umber-800 pt-4 ring-1 ring-paper-50/15 transition-transform duration-300 ease-out [transform:rotateX(14deg)] group-hover:[transform:rotateX(0deg)_translateY(3px)]">
                      <PriceRow
                        label={t("camera.pricing_standard")}
                        cap={t("camera.pricing_guest_cap", { n: tier.cap })}
                        price={tier.price}
                        muted
                      />
                    </div>
                  )}
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
        </div>
      </div>
    </PublicShell>
  );
}
