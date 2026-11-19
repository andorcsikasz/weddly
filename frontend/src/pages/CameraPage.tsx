// /camera: public, unauthenticated landing page for Weddly Camera.
//
// Built like a product page, not a brochure: one full-bleed hero, then a few
// short chapters, each a two-tone headline, one sentence and one picture of
// the product. Motion is tied to the scroll (camera_scroll.css): the hero
// dims, phones tilt upright as they enter, photos settle in. Copy is kept to
// what a visitor needs to decide; the detail lives in the product itself.
//
// Forced dark, one font: this page always renders on the dark palette
// regardless of the site-wide theme toggle (the same local `dark`-class
// technique PublicFooter uses), and every line on it is font-grotesk.
import { ArrowRight, Camera } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FILM_PRICE_TIERS,
  type FilmPriceTier,
  filmTierPriceCents,
  formatEurCents,
} from "@shared/film_pricing";
import { useAuth } from "../lib/auth";
import { CameraPreview } from "../components/CameraHero";
import { CameraShare } from "../components/CameraShare";
import { PublicShell } from "../components/PublicShell";
import { WeddlyDove } from "../components/WeddlyDove";
import { useT } from "../lib/i18n";
import { useDocumentMeta } from "../lib/seo";
import { ANALOG_PREVIEW_FILTER } from "../lib/analog";
import "./camera_scroll.css";

/** What a guest's roll looks like: wedding shots through the in-app camera's
 *  own analog looks, each with the orange date print a disposable burns in. */
const ROLL: { src: string; filter: string; stamp: string; position?: string }[] = [
  { src: "/demo/film-01.jpg", filter: ANALOG_PREVIEW_FILTER, stamp: "'26 09 12" },
  {
    src: "/design-photos/12-ceremony-aisle.jpg",
    filter: ANALOG_PREVIEW_FILTER,
    stamp: "'26 09 12",
  },
  { src: "/design-photos/04-greenery-arch.jpg", filter: ANALOG_PREVIEW_FILTER, stamp: "'26 09 12" },
  {
    src: "/demo/wedding-party-hero.jpg",
    filter: ANALOG_PREVIEW_FILTER,
    stamp: "'26 09 12",
    position: "60% 50%",
  },
  { src: "/demo/film-02.jpg", filter: ANALOG_PREVIEW_FILTER, stamp: "'26 09 12" },
  {
    src: "/design-photos/01-reception-pergola.jpg",
    filter: ANALOG_PREVIEW_FILTER,
    stamp: "'26 09 12",
  },
  { src: "/design-photos/05-draped-arch.jpg", filter: ANALOG_PREVIEW_FILTER, stamp: "'26 09 12" },
  {
    src: "/design-photos/02-reception-candlelit.jpg",
    filter: ANALOG_PREVIEW_FILTER,
    stamp: "'26 09 13",
  },
  { src: "/demo/film-03.jpg", filter: ANALOG_PREVIEW_FILTER, stamp: "'26 09 13" },
  { src: "/design-photos/11-wedding-cake.jpg", filter: ANALOG_PREVIEW_FILTER, stamp: "'26 09 13" },
  {
    src: "/design-photos/06-pampas-candles.jpg",
    filter: ANALOG_PREVIEW_FILTER,
    stamp: "'26 09 13",
  },
];

/** The three phones that rise out of the hero. */
const HERO_PHONES: { src: string; position?: string }[] = [
  { src: "/demo/film-01.jpg" },
  { src: "/demo/wedding-party-hero.jpg", position: "60% 50%" },
  { src: "/demo/film-03.jpg" },
];

/** The gallery mosaic in the "One reveal" chapter. */
const REVEAL_SHOTS = [
  "/design-photos/02-reception-candlelit.jpg",
  "/design-photos/11-wedding-cake.jpg",
  "/design-photos/04-greenery-arch.jpg",
] as const;

/** Whether the browser scrubs `.cam-reveal` with the scroll on its own. */
function scrollTimelineSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timeline: view()")
  );
}

/** Fades its children up as they scroll into view. Where the browser has
 *  scroll-driven animations the CSS does it and this only sets the class;
 *  elsewhere an IntersectionObserver plays it once. Anything already on
 *  screen at mount is left visible, so nothing blinks on first paint. */
function Reveal({
  children,
  className = "",
  phone = false,
}: {
  children: ReactNode;
  className?: string;
  /** The tilt-up entrance used for phone mockups. */
  phone?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || scrollTimelineSupported()) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setHidden(true);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setHidden(false);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`cam-reveal ${phone ? "cam-phone" : ""} ${hidden ? "cam-reveal-hidden" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Two-tone chapter headline: the statement, then its answer in grey. */
function ChapterTitle({ a, b, center = false }: { a: string; b: string; center?: boolean }) {
  return (
    <h2
      className={`text-5xl font-bold leading-[0.95] tracking-[-0.045em] sm:text-6xl lg:text-7xl ${center ? "text-center" : ""}`}
    >
      <span className="block text-paper-50">{a}</span>
      <span className="block text-paper-500">{b}</span>
    </h2>
  );
}

/** One gallery photo, settling from a slight zoom as it scrolls in. */
function Shot({ src, className }: { src: string; className: string }) {
  return (
    <div className={`overflow-hidden rounded-3xl bg-umber-900 ${className}`}>
      <img
        src={src}
        alt=""
        loading="lazy"
        className="cam-zoom h-full w-full object-cover"
        style={{ filter: ANALOG_PREVIEW_FILTER }}
      />
    </div>
  );
}

/** How far (px) the roll drifts sideways over the whole time it is on screen. */
const ROLL_DRIFT_PX = 520;

// The ladder and both audiences' prices come from shared/film_pricing.ts, the
// same module the checkout charges from, so the page cannot quote a price the
// payment would not take.
const TIERS = FILM_PRICE_TIERS;

/** One option row of the pricing stack: label + headcount left, price right.
 *  `muted` is the card tucked behind the stack: smaller and quieter, so the
 *  Weddly price reads first and the stand-alone price reads second. */
function PriceRow({
  label,
  cap,
  price,
  muted = false,
  dove = false,
}: {
  label: string;
  /** The Weddly dove before the label, on the Weddly couples' price. */
  dove?: boolean;
  cap: string;
  price: string;
  muted?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 ${muted ? "pb-3 pt-1" : "py-4"}`}>
      <div>
        <p
          className={`flex items-center gap-1.5 font-semibold ${muted ? "text-sm text-paper-300" : "text-base text-paper-50"}`}
        >
          {dove && <WeddlyDove className={`shrink-0 ${muted ? "h-3.5 w-3.5" : "h-4 w-4"}`} />}
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
  const tier = TIERS[tierIndex] ?? (TIERS[1] as FilmPriceTier);
  const { user } = useAuth();
  const [frontCard, setFrontCard] = useState<"couple" | "standalone">("couple");
  const backCard = frontCard === "couple" ? "standalone" : "couple";
  const guestCap = t("camera.pricing_guest_cap", { n: tier.cap });
  const priceCards = {
    couple: {
      label: t("camera.pricing_couple_label"),
      dove: true,
      cap: guestCap,
      price: formatEurCents(filmTierPriceCents(tier, "couple")),
    },
    standalone: {
      label: t("camera.pricing_standard"),
      cap: guestCap,
      price: formatEurCents(filmTierPriceCents(tier, "standalone")),
    },
  };
  // The stand-alone card is a door, not a toggle: it leads straight to naming
  // the wedding and paying for the chosen tier (CameraStartPage).
  const standaloneStart = `/camera/start?cap=${tier.cap}`;
  // The main CTA is the Weddly-couple path: an existing workspace buys the film
  // from its film page, everyone else signs up first.
  const coupleStart = user?.couple_id ? "/app/media" : "/signup";
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

  const proof = [
    t("camera.feature_1_title"),
    t("camera.feature_2_title"),
    t("camera.feature_3_title"),
    t("camera.feature_4_title"),
  ];

  return (
    <PublicShell flushFooter>
      <div className="dark overflow-x-clip bg-umber-950 font-grotesk text-paper-100" lang={locale}>
        {/* Hero: one full-bleed photo, one line, one button. The photo dims
            and the copy lifts away as the page scrolls (camera_scroll.css). */}
        <section className="relative isolate flex min-h-[88svh] items-center justify-center overflow-hidden px-4 pb-48 pt-24 text-center sm:pb-56">
          <img
            src="/design-photos/20-vineyard-dusk.jpg"
            alt=""
            className="cam-zoom absolute inset-0 -z-20 h-full w-full object-cover"
            style={{ filter: ANALOG_PREVIEW_FILTER, objectPosition: "50% 40%" }}
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/60 via-black/40 to-umber-950" />
          <div className="cam-dim absolute inset-0 -z-10 bg-umber-950" />
          <div className="cam-hero-copy mx-auto max-w-4xl">
            <h1 className="text-5xl font-bold leading-[0.95] tracking-[-0.045em] text-paper-50 sm:text-7xl lg:text-8xl">
              {t("camera.hero_title")}
            </h1>
            <p className="mx-auto mt-6 max-w-md text-base text-paper-200 sm:text-lg">
              {t("camera.hero_sub")}
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                to={coupleStart}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-paper-50 px-7 py-3.5 text-sm font-semibold text-umber-950 transition-[transform,background-color] duration-150 ease-out hover:bg-paper-100 active:scale-[0.97]"
              >
                {t("camera.create_event_cta")}
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link
                to="/camera/try"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-paper-50/25 px-7 py-3.5 text-sm font-semibold text-paper-50 backdrop-blur-sm transition-[transform,background-color] duration-150 ease-out hover:bg-paper-50/10 active:scale-[0.97]"
              >
                <Camera size={16} aria-hidden="true" />
                {t("camera.try_cta")}
              </Link>
            </div>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {/* Three phones rise out of the hero and tilt upright as they scroll in. */}
          <Reveal
            phone
            className="relative z-10 -mt-40 flex items-end justify-center gap-3 sm:-mt-48 sm:gap-6"
          >
            {HERO_PHONES.map((shot, i) => (
              <CameraPreview
                key={shot.src}
                inline
                src={shot.src}
                filter={ANALOG_PREVIEW_FILTER}
                objectPosition={shot.position}
                stamp="'26 09 12"
                filmName={t("camera.roll_film_name")}
                shotsLabel={t("media.film_shots_short").replace("{{n}}", String(24 + i * 6))}
                className={
                  i === 1
                    ? "w-40 sm:w-60"
                    : `hidden w-32 sm:block sm:w-48 ${i === 0 ? "-rotate-3" : "rotate-3"}`
                }
              />
            ))}
          </Reveal>

          <Reveal className="mt-14 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-paper-400">
            {proof.map((label, i) => (
              <span key={label} className="flex items-center gap-5">
                {i > 0 && <span aria-hidden="true" className="h-4 w-px bg-paper-50/15" />}
                {label}
              </span>
            ))}
          </Reveal>

          {/* Scan. Shoot. */}
          <section className="mt-28 grid items-center gap-16 sm:mt-40 md:grid-cols-2">
            <Reveal>
              <ChapterTitle a={t("camera.chapter_shoot_a")} b={t("camera.chapter_shoot_b")} />
              <p className="mt-6 max-w-sm text-lg leading-relaxed text-paper-400">
                {t("camera.chapter_shoot_body")}
              </p>
            </Reveal>
            <Reveal phone className="relative mx-auto flex w-full max-w-sm justify-center">
              <CameraPreview
                inline
                live
                src="/demo/film-02.jpg"
                filter={ANALOG_PREVIEW_FILTER}
                stamp="'26 09 12"
                filmName={t("camera.roll_film_name")}
                shotsLabel={t("media.film_shots_short").replace("{{n}}", "27")}
                className="roll-item w-56 sm:w-64"
              />
              {/* The QR is real: it opens the try-out camera on the phone. */}
              <div className="cam-drift absolute -left-2 bottom-10 hidden w-32 -rotate-6 rounded-2xl bg-paper-50 p-3 text-center shadow-[0_24px_50px_rgba(0,0,0,0.55)] lg:block">
                <img src="/camera-try-qr.svg" alt="" className="block w-full" />
                <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-umber-950">
                  {t("camera.try_title")}
                </p>
              </div>
            </Reveal>
          </section>

          <div className="mt-28 sm:mt-40">
            <CameraShare coupleName={t("camera.roll_film_name")} />
          </div>

          {/* One reveal. */}
          <section className="mt-28 grid items-center gap-16 sm:mt-40 md:grid-cols-2">
            <Reveal className="md:order-2">
              <ChapterTitle a={t("camera.chapter_reveal_a")} b={t("camera.chapter_reveal_b")} />
              <p className="mt-6 max-w-sm text-lg leading-relaxed text-paper-400">
                {t("camera.chapter_reveal_body")}
              </p>
            </Reveal>
            <Reveal className="grid grid-cols-2 gap-3 sm:gap-4 md:order-1">
              <Shot src={REVEAL_SHOTS[0]} className="h-full" />
              <div className="cam-drift space-y-3 sm:space-y-4">
                <Shot src={REVEAL_SHOTS[1]} className="aspect-square" />
                <Shot src={REVEAL_SHOTS[2]} className="aspect-square" />
              </div>
            </Reveal>
          </section>

          {/* Every guest. One film. */}
          <Reveal className="mt-28 text-center sm:mt-40">
            <ChapterTitle a={t("camera.roll_title_a")} b={t("camera.roll_title_b")} center />
          </Reveal>

          {/* A guest's roll: a full-bleed strip of viewfinders, wider than
              the screen and centred on it, drifting sideways as the page
              scrolls. */}
          <section
            ref={rollRef}
            className={`relative left-1/2 mt-12 flex w-screen -translate-x-1/2 justify-center overflow-hidden py-6 ${
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

          {/* Stand-alone product */}
          <section id="standalone" className="mt-28 scroll-mt-20 pb-28 sm:mt-40 sm:pb-36">
            <div className="flex flex-col items-center text-center">
              <h2 className="text-5xl font-bold leading-[0.95] tracking-[-0.045em] text-paper-50 sm:text-6xl lg:text-7xl">
                {t("camera.standalone_title")}
              </h2>

              {/* Uber-style: a segmented headcount picker, then the price as
                  an option row, label left and number right. */}
              <div className="mt-12 w-full max-w-lg text-left">
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

                {/* Two price cards, one on top and one tucked under its bottom
                    edge, tilted away (rotateX from the top) so it reads as
                    sitting BEHIND while its own row stays legible. The Weddly
                    price is on top. The stand-alone card leads straight into
                    creating the event and paying; the Weddly card, if it is
                    ever the back one, swaps forward. */}
                <div className="group mt-3 [perspective:700px]">
                  <div
                    key={frontCard}
                    className="relative z-10 animate-card-lift rounded-2xl bg-umber-900 shadow-[0_14px_30px_-10px_rgba(0,0,0,0.85)] ring-2 ring-paper-50 motion-reduce:animate-none"
                  >
                    <PriceRow {...priceCards[frontCard]} />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      backCard === "standalone" ? navigate(standaloneStart) : setFrontCard(backCard)
                    }
                    aria-label={priceCards[backCard].label}
                    className="relative z-0 mx-auto -mt-4 block w-[93%] origin-top rounded-b-2xl bg-umber-800 pt-4 text-left ring-1 ring-paper-50/15 transition-transform duration-300 ease-out [transform:rotateX(14deg)] hover:bg-umber-700 group-hover:[transform:rotateX(0deg)_translateY(3px)]"
                  >
                    <PriceRow {...priceCards[backCard]} muted />
                  </button>
                </div>
                <Link
                  to={frontCard === "standalone" ? standaloneStart : coupleStart}
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
