// /app/games — the hub every Wēddly Games type lands on. Two brand tiles hand
// off to each game's own management page (/app/games/quiz, /app/games/markets)
// and one first-party tile to the runner (/app/games/runner). A new game type is
// one more tile here plus its own nested route in App.tsx.
//
// Dark "console" chrome (GamesConsole.css) rather than the standard paper
// app shell — same #0c1019 canvas as the public /games teaser and the live
// quiz host screen, so walking from this hub into either game feels like
// one product instead of a plain nav page bolted onto two flashy ones. Each
// tile carries a kicker chip, a heading in Space Grotesk, a short
// description and a pill CTA, composed on a deep panel that only tints with
// the game's own brand colour — restrained, so the white copy stays solid.

import { ArrowRight, Gamepad2, HeartPulse, Sparkles, TrendingUp } from "lucide-react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "../../lib/i18n";
import { GamesAmbient } from "./GamesAmbient";
import "./GamesConsole.css";

// Kahoot's four answer shapes in Kahoot's four answer colours. Each sits in
// its own wrapper so the float (wrapper) and the hover scatter (shape) are
// separate transforms and never fight each other.
const SHAPES = [
  { kind: "triangle", top: 26, right: 150, size: 1 },
  { kind: "diamond", top: 78, right: 70, size: 1 },
  { kind: "circle", top: 18, right: 64, size: 1 },
  { kind: "square", top: 118, right: 160, size: 1 },
  { kind: "circle", top: 140, right: 40, size: 0.6 },
  { kind: "diamond", top: 30, right: 220, size: 0.55 },
] as const;

function ShapeCluster() {
  return (
    <div className="gc-tile-deco gc-depth" aria-hidden="true">
      {SHAPES.map((sh, i) => (
        <span
          key={i}
          className="gc-shape-float"
          style={
            {
              top: sh.top,
              right: sh.right,
              "--i": i,
              scale: String(sh.size),
            } as CSSProperties
          }
        >
          <span className={`gc-shape gc-shape-${sh.kind} gc-shape-n${i}`} />
        </span>
      ))}
    </div>
  );
}

const SPARK = "0,46 20,40 40,44 60,30 80,34 100,20 120,24 140,12 160,8";

function SparkDeco() {
  return (
    <svg
      className="gc-tile-deco gc-depth gc-spark"
      viewBox="0 0 160 60"
      preserveAspectRatio="none"
      // `left`/`bottom` reset: .gc-tile-deco is `inset: 0`, which otherwise
      // pins this box to the tile's left edge, over the kicker chip.
      style={{ top: 26, right: 32, left: "auto", bottom: "auto", width: 230, height: 90 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gc-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(86, 150, 255)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="rgb(86, 150, 255)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="gc-spark-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(255,255,255,0.15)" />
          <stop offset="100%" stopColor="rgba(160,200,255,1)" />
        </linearGradient>
      </defs>
      <polygon
        className="gc-spark-area"
        points={`${SPARK} 160,60 0,60`}
        fill="url(#gc-spark-fill)"
      />
      <polyline
        className="gc-spark-line"
        pathLength={1}
        points={SPARK}
        fill="none"
        stroke="url(#gc-spark-stroke)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle className="gc-spark-ping" cx="160" cy="8" r="3.5" fill="rgb(160, 200, 255)" />
      <circle className="gc-spark-dot" cx="160" cy="8" r="3" fill="white" />
    </svg>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Tilt the tile toward the pointer, park the spotlight and glare under it,
 *  and hand the decoration a parallax offset so it floats above the copy.
 *  Mouse only: on touch the tilt would just flicker under a tap. */
function trackPointer(e: PointerEvent<HTMLAnchorElement>) {
  if (e.pointerType !== "mouse" || reducedMotion()) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.classList.add("gc-tracking");
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
  el.style.setProperty("--dx", (x - 0.5).toFixed(3));
  el.style.setProperty("--dy", (y - 0.5).toFixed(3));
  el.style.setProperty("--rx", `${((x - 0.5) * 9).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${((0.5 - y) * 9).toFixed(2)}deg`);
}

function resetPointer(e: PointerEvent<HTMLAnchorElement>) {
  const el = e.currentTarget;
  el.classList.remove("gc-tracking");
  for (const v of ["--rx", "--ry"]) el.style.setProperty(v, "0deg");
  for (const v of ["--dx", "--dy"]) el.style.setProperty(v, "0");
}

/** A ring of light bursts from where the tile was pressed. */
function ripple(e: PointerEvent<HTMLAnchorElement>) {
  if (reducedMotion()) return;
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const dot = document.createElement("span");
  dot.className = "gc-ripple";
  dot.style.left = `${e.clientX - r.left}px`;
  dot.style.top = `${e.clientY - r.top}px`;
  dot.addEventListener("animationend", () => dot.remove(), { once: true });
  el.appendChild(dot);
}

function GameTile({
  to,
  tone,
  accent,
  icon,
  deco,
  title,
  description,
  kicker,
  cta,
  delay,
}: {
  to: string;
  tone: "quiz" | "markets" | "runner";
  /** The game's own brand colour, declared with the tile rather than switched on
   *  it. `gc-tile-${tone}` still names the panel treatment in the stylesheet, but
   *  the accent now travels with the data, so a fourth game needs no branch here. */
  accent: string;
  icon: ReactNode;
  /** The per-tile scattered decoration, or null for a tile that draws its own. */
  deco: ReactNode;
  title: string;
  description: string;
  kicker: string;
  cta: string;
  delay: number;
}) {
  return (
    <Link
      to={to}
      className={`gc-tile gc-tile-${tone} gc-tilt gc-rise group`}
      style={{ "--gc-delay": `${delay}ms` } as CSSProperties}
      onPointerMove={trackPointer}
      onPointerLeave={resetPointer}
      onPointerDown={ripple}
    >
      <span className="gc-tile-border" aria-hidden="true" />
      <span className="gc-tile-glare" aria-hidden="true" />
      <span className="gc-tile-spot" aria-hidden="true" />
      <span className="gc-tile-glow" style={{ color: accent }} aria-hidden="true" />
      {deco}
      <div className="gc-tile-content">
        <span className="gc-kicker">
          {icon}
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
      <GamesAmbient />
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-12">
          <span className="gc-eyebrow gc-rise">
            <Sparkles size={12} className="gc-twinkle" aria-hidden /> Wēddly Games
          </span>
          <h1
            className="gc-rise mt-4 font-space text-3xl font-bold text-white sm:text-4xl"
            style={{ "--gc-delay": "80ms" } as CSSProperties}
          >
            <span className="gc-shimmer">{t("games_hub.title")}</span>
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
            accent="#8b3dff"
            icon={<Gamepad2 size={14} aria-hidden />}
            deco={<ShapeCluster />}
            title={t("games_hub.quiz_card_title")}
            description={t("games_hub.quiz_card_description")}
            kicker={t("games_hub.quiz_kicker")}
            cta={t("games_hub.cta")}
            delay={260}
          />
          <GameTile
            to="/app/games/markets"
            tone="markets"
            accent="#1652f0"
            icon={<TrendingUp size={14} aria-hidden />}
            deco={<SparkDeco />}
            title={t("games_hub.markets_card_title")}
            description={t("games_hub.markets_card_description")}
            kicker={t("games_hub.markets_kicker")}
            cta={t("games_hub.cta")}
            delay={360}
          />
          <GameTile
            to="/app/games/runner"
            tone="runner"
            accent="#d9738a"
            icon={<HeartPulse size={14} aria-hidden />}
            deco={null}
            title={t("games_hub.runner_card_title")}
            description={t("games_hub.runner_card_description")}
            kicker={t("games_hub.runner_kicker")}
            cta={t("games_hub.cta")}
            delay={460}
          />
        </div>
      </div>
    </div>
  );
}
