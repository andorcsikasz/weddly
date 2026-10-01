// /app/games — the hub every Wēddly Games type lands on. Two brand tiles
// hand off to each game's own management page (/app/games/quiz,
// /app/games/markets). A third game type is one more tile here plus its own
// nested route in App.tsx.
//
// Dark "console" chrome (GamesConsole.css) rather than the standard paper
// app shell — same #0c1019 canvas as the public /games teaser and the live
// quiz host screen, so walking from this hub into either game feels like
// one product instead of a plain nav page bolted onto two flashy ones. Each
// tile carries a kicker chip, a heading in Space Grotesk, a short
// description and a pill CTA, composed on a deep panel that only tints with
// the game's own brand colour — restrained, so the white copy stays solid.

import { ArrowRight, Gamepad2, Sparkles, TrendingUp } from "lucide-react";
import type { CSSProperties, PointerEvent } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import "./GamesConsole.css";

function ShapeCluster() {
  return (
    <div className="gc-tile-deco" aria-hidden="true">
      <span className="gc-shape gc-shape-triangle" style={{ top: 24, right: 112 }} />
      <span className="gc-shape gc-shape-diamond" style={{ top: 66, right: 58 }} />
      <span className="gc-shape gc-shape-circle" style={{ top: 14, right: 54 }} />
      <span className="gc-shape gc-shape-square" style={{ top: 96, right: 122 }} />
    </div>
  );
}

function SparkDeco() {
  return (
    <svg
      className="gc-tile-deco"
      viewBox="0 0 160 60"
      preserveAspectRatio="none"
      // `left`/`bottom` reset: .gc-tile-deco is `inset: 0`, which otherwise
      // pins this box to the tile's left edge, over the kicker chip.
      style={{ top: 28, right: 32, left: "auto", bottom: "auto", width: 150, height: 56 }}
      aria-hidden="true"
    >
      <polyline
        className="gc-spark-line"
        pathLength={1}
        points="0,46 24,40 48,44 72,26 96,30 120,14 144,20 160,8"
        fill="none"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle className="gc-spark-ping" cx="160" cy="8" r="3.5" fill="white" />
    </svg>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Tilt the tile toward the pointer and park the spotlight under it. Mouse
 *  only: on touch the tilt would just flicker under a tap. */
function trackPointer(e: PointerEvent<HTMLAnchorElement>) {
  if (e.pointerType !== "mouse" || reducedMotion()) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.classList.add("gc-tracking");
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  el.style.setProperty("--rx", `${((x - 0.5) * 5).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${((0.5 - y) * 5).toFixed(2)}deg`);
}

function resetPointer(e: PointerEvent<HTMLAnchorElement>) {
  const el = e.currentTarget;
  el.classList.remove("gc-tracking");
  el.style.setProperty("--rx", "0deg");
  el.style.setProperty("--ry", "0deg");
}

function GameTile({
  to,
  tone,
  title,
  description,
  kicker,
  cta,
  delay,
}: {
  to: string;
  tone: "quiz" | "markets";
  title: string;
  description: string;
  kicker: string;
  cta: string;
  delay: number;
}) {
  const accent = tone === "quiz" ? "#8b3dff" : "#1652f0";
  return (
    <Link
      to={to}
      className={`gc-tile gc-tile-${tone} gc-tilt gc-rise group`}
      style={{ "--gc-delay": `${delay}ms` } as CSSProperties}
      onPointerMove={trackPointer}
      onPointerLeave={resetPointer}
    >
      <span className="gc-tile-spot" aria-hidden="true" />
      <span className="gc-tile-glow" style={{ color: accent }} aria-hidden="true" />
      {tone === "quiz" ? <ShapeCluster /> : <SparkDeco />}
      <div className="gc-tile-content">
        <span className="gc-kicker">
          {tone === "quiz" ? (
            <Gamepad2 size={14} aria-hidden />
          ) : (
            <TrendingUp size={14} aria-hidden />
          )}
          {kicker}
        </span>
        <h2 className="font-space text-2xl font-bold text-white sm:text-3xl">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-white/70">{description}</p>
        <span className="gc-tile-cta">
          {cta}
          <ArrowRight size={15} className="gc-arrow" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export default function GamesHubPage() {
  const { t } = useT();

  return (
    <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-12">
          <span className="gc-eyebrow gc-rise">
            <Sparkles size={12} className="gc-twinkle" aria-hidden /> Wēddly Games
          </span>
          <h1
            className="gc-rise mt-4 font-space text-3xl font-bold text-white sm:text-4xl"
            style={{ "--gc-delay": "80ms" } as CSSProperties}
          >
            {t("games_hub.title")}
          </h1>
          <p
            className="gc-rise mt-3 max-w-xl text-base text-white/70"
            style={{ "--gc-delay": "160ms" } as CSSProperties}
          >
            {t("games_hub.subtitle")}
          </p>
        </header>

        <div className="flex flex-col gap-5">
          <GameTile
            to="/app/games/quiz"
            tone="quiz"
            title={t("games_hub.quiz_card_title")}
            description={t("games_hub.quiz_card_description")}
            kicker={t("games_hub.quiz_kicker")}
            cta={t("games_hub.cta")}
            delay={260}
          />
          <GameTile
            to="/app/games/markets"
            tone="markets"
            title={t("games_hub.markets_card_title")}
            description={t("games_hub.markets_card_description")}
            kicker={t("games_hub.markets_kicker")}
            cta={t("games_hub.cta")}
            delay={360}
          />
        </div>
      </div>
    </div>
  );
}
