// /app/games — the hub every Wēddly Games type lands on. Two brand tiles
// hand off to each game's own management page (/app/games/quiz,
// /app/games/markets). A third game type is one more tile here plus its own
// nested route in App.tsx.
//
// Dark "console" chrome (GamesConsole.css) rather than the standard paper
// app shell — same #0c1019 canvas as the public /games teaser and the live
// quiz host screen, so walking from this hub into either game feels like
// one product instead of a plain nav page bolted onto two flashy ones. Each
// tile is deliberately bare — no icon, no copy, no status pill — just the
// game's own brand name set in white against that game's own brand colour:
// Kahoot's purple for the quiz, Polymarket's blue for the predictions board.

import { Gamepad2, Sparkles } from "lucide-react";
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
      style={{ top: 20, right: 20, width: 130, height: 50 }}
      aria-hidden="true"
    >
      <polyline
        points="0,46 24,40 48,44 72,26 96,30 120,14 144,20 160,8"
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GameTile({
  to,
  tone,
  title,
}: {
  to: string;
  tone: "quiz" | "markets";
  title: string;
}) {
  return (
    <Link to={to} className={`gc-tile gc-tile-${tone} group flex items-center`}>
      <span className="gc-tile-glow" aria-hidden="true" />
      {tone === "quiz" ? <ShapeCluster /> : <SparkDeco />}
      <h2 className="relative z-10 font-grotesk text-3xl text-white sm:text-4xl">{title}</h2>
    </Link>
  );
}

export default function GamesHubPage() {
  const { t } = useT();

  return (
    <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10">
          <span className="gc-eyebrow">
            <Sparkles size={12} aria-hidden /> Wēddly Games
          </span>
          <h1 className="mt-4 flex items-center gap-2.5 font-grotesk text-3xl text-white sm:text-4xl">
            <Gamepad2 size={30} aria-hidden /> {t("games_hub.title")}
          </h1>
          <p className="mt-2 max-w-xl text-white/60">{t("games_hub.subtitle")}</p>
        </header>

        <div className="flex flex-col gap-5">
          <GameTile to="/app/games/quiz" tone="quiz" title={t("games_hub.quiz_card_title")} />
          <GameTile
            to="/app/games/markets"
            tone="markets"
            title={t("games_hub.markets_card_title")}
          />
        </div>
      </div>
    </div>
  );
}
