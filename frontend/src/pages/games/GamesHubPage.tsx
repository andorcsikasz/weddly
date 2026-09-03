// /app/games — the hub every Wēddly Games type lands on. Each game (the
// live quiz and the prediction markets board today) gets its own card with
// a status pill drawn from a light list-fetch, and hands off to that game's
// own management page (/app/games/quiz, /app/games/markets). A third game
// type is one more card here plus its own nested route in App.tsx.

import { ArrowRight, Gamepad2, TrendingUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { marketsApi, quizApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import type { MarketBoardSummary } from "@shared/markets";
import type { QuizSummary } from "@shared/quiz";

function GameCard({
  to,
  tone,
  icon,
  title,
  body,
  statusLabel,
  statusLive,
  cta,
}: {
  to: string;
  tone: "sage" | "blush";
  icon: ReactNode;
  title: string;
  body: string;
  statusLabel: string | null;
  statusLive: boolean;
  cta: string;
}) {
  const gradient =
    tone === "sage"
      ? "from-sage-600 via-sage-700 to-sage-900"
      : "from-blush-600 via-blush-700 to-blush-900";
  return (
    <Link
      to={to}
      className={`group relative flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br ${gradient} p-6 text-paper-50 shadow-elevated transition hover:-translate-y-1 hover:shadow-pop sm:p-8`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl transition group-hover:bg-white/20"
      />
      <div className="relative z-10 flex items-center justify-between gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur-sm">
          {icon}
        </span>
        {statusLabel && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-sm ${
              statusLive ? "bg-white text-ink-900" : "bg-white/15 text-paper-50"
            }`}
          >
            {statusLive && <span className="h-1.5 w-1.5 rounded-full bg-sage-500" aria-hidden />}
            {statusLabel}
          </span>
        )}
      </div>
      <h2 className="relative z-10 mt-6 font-grotesk text-2xl">{title}</h2>
      <p className="relative z-10 mt-2 max-w-sm text-sm leading-relaxed text-paper-50/80">{body}</p>
      <span className="relative z-10 mt-6 inline-flex items-center gap-1.5 text-sm font-semibold">
        {cta}
        <ArrowRight size={16} className="transition group-hover:translate-x-1" aria-hidden />
      </span>
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

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 xl:px-10">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 font-grotesk text-3xl text-ink-900 dark:text-paper-50 sm:text-4xl">
          <Gamepad2 size={28} aria-hidden /> {t("games_hub.title")}
        </h1>
        <p className="mt-2 max-w-xl text-ink-600 dark:text-umber-200">{t("games_hub.subtitle")}</p>
      </header>

      <div className="grid gap-5 sm:grid-cols-2">
        <GameCard
          to="/app/games/quiz"
          tone="sage"
          icon={<Gamepad2 size={24} aria-hidden />}
          title={t("games_hub.quiz_card_title")}
          body={t("quiz.list.subtitle")}
          statusLabel={quizStatus}
          statusLive={quizLive}
          cta={t("games_hub.quiz_card_cta")}
        />
        <GameCard
          to="/app/games/markets"
          tone="blush"
          icon={<TrendingUp size={24} aria-hidden />}
          title={t("markets.page_title")}
          body={t("markets.page_subtitle")}
          statusLabel={marketsStatus}
          statusLive={marketsLive}
          cta={t("games_hub.markets_card_cta")}
        />
      </div>
    </div>
  );
}
