// Wedding Camera hero — shared between the couple's authenticated dashboard
// (MediaPage, "hasFilm" states) and the public /camera landing page (always
// the empty-state variant: album=null). Single-sourced so the marketing page
// shows the same on-brand mockup the product itself renders, not a second
// hand-drawn approximation of it.
//
// The two states are deliberately different shapes, not just different copy.
// !album is the sell — a couple deciding whether to turn this on, so it earns
// the full phone-mockup collage. album (the dashboard) is a returning couple
// who already said yes; the real gallery, stats and QR code are a scroll away
// on the same page, so a second marketing composition above them was showing
// the couple their own feature pitched back at them. That state is a quiet
// masthead instead: mark, status, name, one button.
import type { PhotoAlbum } from "@shared/types";
import { FILM_FILTERS } from "@shared/types";
import {
  ArrowRight,
  Camera,
  GalleryHorizontalEnd,
  Lock,
  QrCode,
  ScanLine,
  Share2,
  Sparkles,
} from "lucide-react";
import { useT } from "../lib/i18n";
import { Wordmark } from "./Wordmark";

export const DEMO_STRIP = ["/demo/film-01.jpg", "/demo/film-02.jpg", "/demo/film-03.jpg"] as const;

function CameraPreview({
  src,
  filmName,
  shotsLabel,
  filter,
  className,
}: {
  src: string;
  filmName: string;
  shotsLabel: string;
  filter: string;
  className: string;
}) {
  return (
    <div
      className={`absolute rounded-[2rem] border border-paper-50/15 bg-umber-950 p-[5px] shadow-[0_28px_70px_rgba(0,0,0,0.55)] ${className}`}
    >
      <div className="relative aspect-[9/17] overflow-hidden rounded-[1.65rem] bg-umber-800">
        <img src={src} alt="" className="h-full w-full object-cover" style={{ filter }} />

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/25 to-transparent px-3 pb-10 pt-3 text-center">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/70" />
          <p className="truncate text-[8px] font-semibold tracking-wide text-white/95 sm:text-[9px]">
            {filmName}
          </p>
        </div>

        <div className="absolute right-2 top-1/4 flex flex-col gap-1.5">
          {[Camera, Sparkles, GalleryHorizontalEnd].map((Icon, index) => (
            <span
              key={index}
              className="flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/35 text-white/90 backdrop-blur-sm sm:h-6 sm:w-6"
            >
              <Icon size={9} strokeWidth={1.8} aria-hidden="true" />
            </span>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-3 pb-3 pt-14">
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <span className="pb-1 text-left font-grotesk text-[7px] font-semibold uppercase leading-tight tracking-[0.12em] text-white/80 sm:text-[8px]">
              {shotsLabel}
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-[3px] border-white bg-white/20 shadow-lg sm:h-12 sm:w-12">
              <span className="h-7 w-7 rounded-full bg-white sm:h-9 sm:w-9" />
            </span>
            <span className="ml-auto h-7 w-7 overflow-hidden rounded-md border border-white/20 sm:h-8 sm:w-8">
              <img src={src} alt="" className="h-full w-full object-cover" style={{ filter }} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Wordmark + camera-icon eyebrow row shared by both hero states. */
function HeroEyebrow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-paper-200">
      <Wordmark size="sm" className="text-paper-50" />
      <span className="h-4 w-px bg-paper-50/20" aria-hidden="true" />
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em]">
        <Camera size={13} strokeWidth={1.7} aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

export function CameraHero({
  album,
  coupleName,
  coverPhoto,
  onCreate,
  onShare,
  headingFont = "serif",
  accent = "blush",
}: {
  album: PhotoAlbum | null;
  coupleName: string | null;
  coverPhoto: string;
  onCreate: () => void;
  onShare: () => void;
  /** Dashboard keeps the workspace's display voice (default: the Cormorant
   *  italic heading); /app/media passes "space" so its headline matches the
   *  Space Grotesk display font of the /app/games console; the public
   *  /camera landing page passes "grotesk" so the hero title matches the
   *  single display font the rest of that page uses. */
  headingFont?: "serif" | "grotesk" | "space";
  /** Dashboard keeps the site-wide `blush` accent. The public /camera landing
   *  page passes "gold" — a champagne-on-espresso palette with no red in it,
   *  per owner direction against terracotta on that page. MediaPage also
   *  passes "gold" now, for the same reason. */
  accent?: "blush" | "gold";
}) {
  const { t } = useT();
  const filmName = album?.title || coupleName || t("media.film_settings_unnamed");
  const headingFontClass =
    headingFont === "grotesk"
      ? "font-grotesk"
      : headingFont === "space"
        ? "font-space"
        : "font-serif";
  const isGold = accent === "gold";
  const glowClass = isGold ? "bg-paper-300/10" : "bg-blush-500/20";
  const previewGlowClass = isGold ? "bg-paper-300/10" : "bg-blush-500/15";
  const ctaClass = isGold
    ? "bg-paper-100 text-umber-950 hover:bg-paper-50"
    : "bg-blush-500 text-white hover:bg-blush-600";
  // Read before the early return below, which would otherwise narrow
  // `album` to bare `null` for the rest of the function and turn every
  // `album?.x` past that point into a `never` access.
  const previewCount = album?.photoCount ?? 24;
  const previewAesthetic = album?.filmAesthetic ?? "vintage";

  // ── Dashboard masthead — a live film, so this is a returning couple ──────
  if (album) {
    return (
      <section className="relative order-1 isolate overflow-hidden rounded-[2rem] bg-umber-950 text-paper-50 shadow-soft">
        <div
          aria-hidden="true"
          className={`absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl ${glowClass}`}
        />
        <div className="relative flex flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9 lg:px-12">
          <div className="min-w-0">
            <HeroEyebrow label={t("media.film_title")} />
            <div className="mb-3 mt-5 inline-flex items-center gap-2 rounded-full border border-sage-400/30 bg-sage-500/15 px-3 py-1.5 text-xs font-semibold text-sage-200">
              <span className="h-1.5 w-1.5 rounded-full bg-sage-300" aria-hidden="true" />
              {t("media.film_header_active").replace("{count}", String(album.photoCount))}
            </div>
            <h1
              className={`max-w-[18ch] text-4xl font-semibold leading-[0.98] tracking-[-0.03em] !text-paper-50 sm:text-5xl ${headingFontClass}`}
            >
              {filmName}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-paper-300 sm:text-base">
              {t("media.film_sub")}
            </p>
          </div>

          <button
            type="button"
            onClick={onShare}
            className={`inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-grotesk text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50 focus-visible:ring-offset-2 focus-visible:ring-offset-umber-950 ${ctaClass}`}
          >
            <Share2 size={17} aria-hidden="true" />
            {t("media.film_cta_share")}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  // ── Marketing hero — no film yet, so this is the moment to sell it ──────
  return (
    <section className="relative order-1 isolate overflow-hidden rounded-[2rem] bg-umber-950 text-paper-50 shadow-soft">
      <div
        aria-hidden="true"
        className={`absolute -right-20 -top-32 h-80 w-80 rounded-full blur-3xl ${glowClass}`}
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-40 left-1/3 h-80 w-80 rounded-full bg-paper-300/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "linear-gradient(to bottom, black, transparent 76%)",
        }}
      />

      <div className="relative grid items-center gap-5 px-6 pb-5 pt-9 sm:px-10 sm:pb-8 sm:pt-11 lg:px-12 xl:min-h-[38rem] xl:grid-cols-[minmax(0,0.95fr)_minmax(25rem,1.05fr)] xl:gap-6 xl:px-16 xl:py-12">
        <div className="relative z-10 max-w-2xl">
          <div className="mb-6">
            <HeroEyebrow label={t("media.film_title")} />
          </div>

          <h1
            className={`max-w-[14ch] text-[3.15rem] font-semibold leading-[0.9] tracking-[-0.045em] !text-paper-50 sm:text-6xl lg:text-[4rem] xl:text-[4.4rem] ${headingFontClass}`}
          >
            {t("media.hero_title")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-paper-200 sm:text-lg">
            {t("media.hero_sub")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={onCreate}
              className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-7 py-3.5 font-grotesk text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-50 focus-visible:ring-offset-2 focus-visible:ring-offset-umber-950 ${ctaClass}`}
            >
              {t("media.film_cta_create")}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="mt-7 flex flex-wrap gap-2 text-xs font-medium text-paper-200">
            <span className="flex items-center gap-1.5 rounded-full border border-paper-50/10 bg-paper-50/[0.06] px-3 py-1.5">
              <ScanLine size={14} aria-hidden="true" />
              {t("media.film_no_app_hint")}
            </span>
            <span className="flex items-center gap-1.5 rounded-full border border-paper-50/10 bg-paper-50/[0.06] px-3 py-1.5">
              <Lock size={13} aria-hidden="true" />
              {t("media.film_privacy_notice")}
            </span>
          </div>
        </div>

        <div
          className="relative mx-auto h-[22rem] w-full max-w-[35rem] sm:h-[30rem] lg:h-[32rem]"
          aria-hidden="true"
        >
          <div
            className={`absolute left-[6%] top-[6%] h-[82%] w-[88%] rounded-[50%] blur-3xl ${previewGlowClass}`}
          />

          <CameraPreview
            src={DEMO_STRIP[2]}
            filmName={filmName}
            shotsLabel={t("media.film_shots_short").replace("{{n}}", "12")}
            filter={FILM_FILTERS.warm}
            className="left-[2%] top-[15%] z-10 w-[39%] -rotate-[7deg] opacity-90"
          />
          <CameraPreview
            src={coverPhoto}
            filmName={filmName}
            shotsLabel={t("media.film_shots_short").replace("{{n}}", String(previewCount))}
            filter={FILM_FILTERS[previewAesthetic]}
            className="left-1/2 top-[2%] z-20 w-[43%] -translate-x-1/2"
          />
          <CameraPreview
            src={DEMO_STRIP[1]}
            filmName={filmName}
            shotsLabel={t("media.film_shots_short").replace("{{n}}", "18")}
            filter={FILM_FILTERS.natural}
            className="right-[1%] top-[12%] z-10 w-[39%] rotate-[7deg] opacity-90"
          />

          <div className="absolute bottom-1 left-0 z-30 -rotate-6 rounded-2xl border border-paper-200 bg-paper-50 p-2.5 text-center text-umber-950 shadow-2xl sm:bottom-3 sm:left-[2%] sm:p-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border-2 border-umber-950 sm:h-[4.5rem] sm:w-[4.5rem]">
              <QrCode className="h-11 w-11 sm:h-14 sm:w-14" strokeWidth={1.6} aria-hidden="true" />
            </div>
            <p className="mt-1.5 font-grotesk text-[7px] font-bold uppercase tracking-[0.18em] sm:text-[8px]">
              {t("media.film_how_2_title")}
            </p>
          </div>
        </div>
      </div>

      <div className="relative grid border-t border-paper-50/10 bg-paper-50/[0.03] sm:grid-cols-3 sm:divide-x sm:divide-paper-50/10">
        {[
          {
            n: "01",
            icon: QrCode,
            title: t("media.film_how_1_title"),
            body: t("media.film_how_1_body"),
          },
          {
            n: "02",
            icon: Camera,
            title: t("media.film_how_2_title"),
            body: t("media.film_how_2_body"),
          },
          {
            n: "03",
            icon: GalleryHorizontalEnd,
            title: t("media.film_how_3_title"),
            body: t("media.film_how_3_body"),
          },
        ].map((step) => (
          <div
            key={step.n}
            className="grid grid-cols-[2.75rem_1fr] gap-3 border-t border-paper-50/10 px-6 py-5 first:border-t-0 sm:block sm:border-t-0 sm:px-7 sm:py-6"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-paper-50/10 bg-paper-50/[0.07] text-paper-300">
              <step.icon size={17} strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div className="sm:mt-4">
              <span className="font-grotesk text-[9px] font-semibold tracking-[0.2em] text-paper-300">
                {step.n}
              </span>
              {/* `!` forced: inside [data-app-shell] (the /app/media dashboard)
                  an unlayered light-mode rule repaints every bare h1/h2 to
                  umber-900, which otherwise wins over a plain text-paper-50
                  utility and reads as dark-on-dark against this card. The
                  /camera public page has no [data-app-shell] ancestor, so it
                  never showed the bug — this hero is the only place both
                  contexts share the markup. */}
              <h2 className="font-grotesk text-sm font-semibold !text-paper-50">{step.title}</h2>
              <p className="mt-1 text-xs leading-relaxed text-paper-300">{step.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
