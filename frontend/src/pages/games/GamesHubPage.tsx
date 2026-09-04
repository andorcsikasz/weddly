// /app/games — the hub every Wēddly Games type lands on. Each game (the
// live quiz and the prediction markets board today) gets its own card with
// a status pill drawn from a light list-fetch, and hands off to that game's
// own management page (/app/games/quiz, /app/games/markets). A third game
// type is one more card here plus its own nested route in App.tsx.
//
// Dark "console" chrome (GamesConsole.css) rather than the standard paper
// app shell — same #0c1019 canvas as the public /games teaser and the live
// quiz host screen, so walking from this hub into either game feels like
// one product instead of a plain nav page bolted onto two flashy ones.

import {
  ArrowRight,
  Gamepad2,
  Layers,
  ListChecks,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { marketsApi, quizApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import type { MarketBoardSummary } from "@shared/markets";
import type { QuizSummary } from "@shared/quiz";
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

function StatusPill({ label, live }: { label: string; live: boolean }) {
  return (
    <span className={`gc-status-pill ${live ? "is-live" : ""}`}>
      {live && <span className="gc-live-dot" aria-hidden="true" />}
      {label}
    </span>
  );
}

function GameTile({
  to,
  tone,
  icon,
  title,
  body,
  statusLabel,
  statusLive,
  stats,
  cta,
}: {
  to: string;
  tone: "quiz" | "markets";
  icon: ReactNode;
  title: string;
  body: string;
  statusLabel: string | null;
  statusLive: boolean;
  stats: { icon: ReactNode; value: number }[];
  cta: string;
}) {
  return (
    <Link to={to} className={`gc-tile gc-tile-${tone} group flex`}>
      <span className="gc-tile-glow" aria-hidden="true" />
      {tone === "quiz" ? <ShapeCluster /> : <SparkDeco />}
      <div className="relative z-10 flex w-full flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <span className="gc-tile-icon">{icon}</span>
          {statusLabel && <StatusPill label={statusLabel} live={statusLive} />}
        </div>
        <h2 className="mt-6 font-grotesk text-2xl text-white">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/70">{body}</p>
        {stats.length > 0 && (
          <div className="mt-4 flex items-center gap-4 text-sm text-white/65">
            {stats.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {s.icon}
                {s.value}
              </span>
            ))}
          </div>
        )}
        <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-white">
          {cta}
          <ArrowRight size={16} className="transition group-hover:translate-x-1" aria-hidden />
        </span>
      </div>
    </Link>
  );
}

export default function GamesHubPage() {
  const { t } = useT();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [boards, setBoards] = useState<MarketBoardSummary[] | null>(null);

  useEffect(() => {
    quizApi
      .list()
      .then((r) => setQuizzes(r.quizzes))
      .catch(() => setQuizzes([]));
    marketsApi
      .list()
      .then((r) => setBoards(r.boards))
      .catch(() => setBoards([]));
  }, []);

  const quizLive = quizzes?.some((q) => q.status === "live") ?? false;
  const quizStatus =
    quizzes === null
      ? null
      : quizLive
        ? t("games_hub.quiz_status_live")
        : quizzes.length > 0
          ? t("games_hub.quiz_status_ready")
          : t("games_hub.quiz_status_empty");
  const quizSlides = quizzes?.reduce((sum, q) => sum + q.slideCount, 0) ?? 0;
  const quizPlayers = quizzes?.reduce((sum, q) => sum + q.playerCount, 0) ?? 0;

  const marketsLive = boards?.some((b) => b.status === "live") ?? false;
  const marketsPaused = boards?.some((b) => b.status === "ended") ?? false;
  const marketsStatus =
    boards === null
      ? null
      : marketsLive
        ? t("games_hub.markets_status_live")
        : marketsPaused
          ? t("games_hub.markets_status_ended")
          : t("games_hub.markets_status_draft");
  const marketsQuestions = boards?.reduce((sum, b) => sum + b.questionCount, 0) ?? 0;
  const marketsGuests = boards?.reduce((sum, b) => sum + b.playerCount, 0) ?? 0;

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

        <div className="grid gap-5 sm:grid-cols-2">
          <GameTile
            to="/app/games/quiz"
            tone="quiz"
            icon={<Gamepad2 size={24} aria-hidden />}
            title={t("games_hub.quiz_card_title")}
            body={t("quiz.list.subtitle")}
            statusLabel={quizStatus}
            statusLive={quizLive}
            stats={
              quizzes && quizzes.length > 0
                ? [
                    { icon: <Layers size={14} aria-hidden />, value: quizSlides },
                    { icon: <Users size={14} aria-hidden />, value: quizPlayers },
                  ]
                : []
            }
            cta={t("games_hub.quiz_card_cta")}
          />
          <GameTile
            to="/app/games/markets"
            tone="markets"
            icon={<TrendingUp size={24} aria-hidden />}
            title={t("markets.page_title")}
            body={t("markets.page_subtitle")}
            statusLabel={marketsStatus}
            statusLive={marketsLive}
            stats={
              boards && boards.length > 0
                ? [
                    { icon: <ListChecks size={14} aria-hidden />, value: marketsQuestions },
                    { icon: <Users size={14} aria-hidden />, value: marketsGuests },
                  ]
                : []
            }
            cta={t("games_hub.markets_card_cta")}
          />
        </div>
      </div>
    </div>
  );
}
