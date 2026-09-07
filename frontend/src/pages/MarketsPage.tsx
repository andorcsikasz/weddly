// Live wedding prediction markets — couple-authenticated board management at
// /app/games/markets, one of the two game types nested under the /app/games
// hub (GamesHubPage). Sibling feature to the quiz game
// (frontend/src/pages/quiz/), under the same "Wēddly Games" umbrella but its
// own join code, since a pari-mutuel points market has no slide-by-slide
// host console to share. See shared/markets.ts for the payout math.
//
// One board per couple in practice — the API supports several, but the page
// keeps that invisible: it auto-provisions the couple's first board on
// arrival and manages it directly, no board-picker UI to build or explain.
//
// Dark "console" chrome (GamesConsole.css), same #0c1019 canvas as the games
// hub and the public /games teaser. This page plays two roles at once — the
// question BUILDER and the live trading-floor HOST — so it leans into the
// Polymarket-flavoured probability bar + pool numbers rather than the plain
// paper-app card list it used to be.

import type { MarketBoardDetail, MarketLeaderboardEntry, MarketQuestion } from "@shared/markets";
import type { UiLocale } from "@shared/locales";
import {
  Check,
  ChevronLeft,
  Clock3,
  Coins,
  Copy,
  Crown,
  ListChecks,
  Pause,
  Play,
  QrCode,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MarketMiniChart } from "../components/MarketMiniChart";
import { useConfirm, useToast } from "../components/ui";
import { ApiError } from "../lib/api";
import { coupleApi, marketsApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { formatTimestamp } from "../lib/format";
import { useQuizPoll } from "../lib/quizPoll";
import { useDocumentMeta } from "../lib/seo";
import "./games/GamesConsole.css";

// Every question card's probability bar + trend chart should move as the
// room bets without the couple having to refresh — this page is as much a
// live "trading floor" host console as it is the question builder. Short-
// polling (see lib/quizPoll.ts's own header comment for why the codebase
// has no WebSocket layer to push this instead), a shade slower than the
// guest screen's 5s since the couple is watching a whole board, not betting
// on one question.
const BOARD_POLL_MS = 6000;

function playUrl(joinCode: string): string {
  return `${window.location.origin}/play/markets/${joinCode}`;
}

/** Suggested default for a new question's betting deadline: 22:00 on the
 *  wedding day. Just a starting point in the picker — the couple can change
 *  it per question. No suggestion when the date is still TBD. */
function defaultClosesAt(weddingDate: string | null): string {
  return weddingDate ? `${weddingDate}T22:00` : "";
}

const QUESTION_STATUS_TONE: Record<MarketQuestion["status"], string> = {
  open: "border-[#45e39e]/40 bg-[#45e39e]/12 text-[#6ff0b7]",
  closed: "border-[#f6bf54]/40 bg-[#f6bf54]/12 text-[#f6bf54]",
  resolved: "border-white/25 bg-white/10 text-white/80",
  voided: "border-white/15 bg-white/5 text-white/45",
};

function QuestionCard({
  question,
  locale,
  onResolve,
  onVoid,
  onDelete,
}: {
  question: MarketQuestion;
  locale: UiLocale;
  onResolve: (outcome: "yes" | "no") => void;
  onVoid: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const total = question.pool.yes + question.pool.no;
  const yesWidth = total > 0 ? question.probability : 50;
  const noWidth = 100 - yesWidth;

  return (
    <li className="gc-market-card rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-white">{question.prompt}</p>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${QUESTION_STATUS_TONE[question.status]}`}
        >
          {t(`markets.question_status_${question.status}`)}
        </span>
      </div>

      {question.status === "resolved" && question.outcome && (
        <p className="mt-1 text-sm font-medium text-[#6ff0b7]">
          {t("markets.outcome_label", { outcome: t(`common.${question.outcome}`) })}
        </p>
      )}

      <div className="mt-3 flex items-center gap-4">
        <span className="w-14 shrink-0 text-2xl font-bold tabular-nums text-white">
          {total > 0 ? question.probability : "–"}
          {total > 0 && <span className="text-sm font-semibold text-white/60">%</span>}
        </span>
        <div className="h-16 min-w-0 flex-1">
          <MarketMiniChart
            ticks={question.priceHistory}
            stroke="#2388ff"
            ariaLabel={t("markets.chart_alt")}
          />
        </div>
      </div>

      <div className="mt-3">
        <div className="gc-split-bar">
          <div className="gc-split-bar-yes" style={{ width: `${yesWidth}%` }} />
          <div className="gc-split-bar-no" style={{ width: `${noWidth}%` }} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-white/60">
          <span>
            {t("markets.pool_label", {
              yes: String(question.pool.yes),
              no: String(question.pool.no),
            })}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 size={12} aria-hidden />
            {t("markets.closes_at_label", { when: formatTimestamp(question.closesAt, locale) })}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {question.status === "closed" && (
          <>
            <button
              type="button"
              className="gc-outcome-btn gc-outcome-btn-yes"
              onClick={() => onResolve("yes")}
            >
              <Check size={14} aria-hidden /> {t("markets.resolve_yes")}
            </button>
            <button
              type="button"
              className="gc-outcome-btn gc-outcome-btn-no"
              onClick={() => onResolve("no")}
            >
              <X size={14} aria-hidden /> {t("markets.resolve_no")}
            </button>
          </>
        )}
        {(question.status === "open" || question.status === "closed") && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            onClick={onVoid}
          >
            <X size={13} aria-hidden="true" /> {t("markets.void_button")}
          </button>
        )}
        {question.status === "open" && total === 0 && (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            onClick={onDelete}
          >
            <Trash2 size={13} aria-hidden="true" /> {t("markets.delete_button")}
          </button>
        )}
      </div>
    </li>
  );
}

function StatCard({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
        {icon}
      </span>
      <div>
        <p className="text-lg font-bold leading-none tabular-nums text-white">{value}</p>
        <p className="mt-1 text-xs text-white/60">{label}</p>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const { t, locale } = useT();
  useDocumentMeta("seo.markets_title", "seo.markets_description");
  const toast = useToast();
  const confirm = useConfirm();

  const [board, setBoard] = useState<MarketBoardDetail | null>(null);
  const [leaderboard, setLeaderboard] = useState<MarketLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [weddingDate, setWeddingDate] = useState<string | null>(null);

  async function refresh(boardId: number) {
    const [b, lb] = await Promise.all([marketsApi.get(boardId), marketsApi.leaderboard(boardId)]);
    setBoard(b.board);
    setLeaderboard(lb.leaderboard);
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ boards }, { couple }] = await Promise.all([
          marketsApi.list(),
          coupleApi.current(),
        ]);
        const first = boards[0] ?? (await marketsApi.create(t("markets.page_title"))).board;
        if (!alive) return;
        setWeddingDate(couple?.wedding_date ?? null);
        setClosesAt(defaultClosesAt(couple?.wedding_date ?? null));
        await refresh(first.id);
      } catch (e) {
        if (alive) toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (qrUrl) URL.revokeObjectURL(qrUrl);
    };
  }, [qrUrl]);

  // Reactive board refresh — starts only once the initial load has picked
  // (or provisioned) a board, so the poll can never race the one-time
  // auto-create above into minting a second one.
  const boardId = board?.id ?? null;
  const { data: polled } = useQuizPoll(
    () =>
      boardId
        ? Promise.all([marketsApi.get(boardId), marketsApi.leaderboard(boardId)])
        : Promise.resolve(null),
    BOARD_POLL_MS,
  );
  useEffect(() => {
    if (!polled) return;
    const [b, lb] = polled;
    setBoard(b.board);
    setLeaderboard(lb.leaderboard);
  }, [polled]);

  async function toggleLive() {
    if (!board) return;
    try {
      const res =
        board.status === "live" ? await marketsApi.end(board.id) : await marketsApi.start(board.id);
      setBoard(res.board);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function copyLink() {
    if (!board) return;
    try {
      await navigator.clipboard.writeText(playUrl(board.joinCode));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function openQr() {
    if (!board) return;
    try {
      const blob = await marketsApi.qrBlob(board.id);
      const url = URL.createObjectURL(blob);
      setQrUrl(url);
      setQrOpen(true);
    } catch {
      toast.error(t("common.error_generic"));
    }
  }

  async function addQuestion() {
    if (!board || !prompt.trim() || !closesAt) return;
    const ms = new Date(closesAt).getTime();
    if (!Number.isFinite(ms)) return;
    setSubmitting(true);
    try {
      const res = await marketsApi.addQuestion(board.id, prompt.trim(), ms);
      setBoard(res.board);
      setPrompt("");
      setClosesAt(defaultClosesAt(weddingDate));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("markets.save_error"));
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveQuestion(questionId: number, outcome: "yes" | "no") {
    if (!board) return;
    try {
      await marketsApi.resolveQuestion(board.id, questionId, outcome);
      await refresh(board.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function voidQuestion(question: MarketQuestion) {
    if (!board) return;
    const ok = await confirm({
      title: t("markets.void_confirm_title"),
      body: t("markets.void_confirm_body"),
      confirmLabel: t("markets.void_button"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await marketsApi.voidQuestion(board.id, question.id);
      await refresh(board.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  async function deleteQuestion(question: MarketQuestion) {
    if (!board) return;
    const ok = await confirm({
      title: t("markets.delete_confirm_title"),
      body: t("markets.delete_confirm_body"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await marketsApi.removeQuestion(board.id, question.id);
      setBoard(res.board);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
    }
  }

  if (loading || !board) {
    return (
      <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
        <div className="mx-auto w-full max-w-3xl">
          <Link to="/app/games" className="gc-link mb-3 text-sm">
            <ChevronLeft size={14} aria-hidden /> {t("games_hub.title")}
          </Link>
          <h1 className="font-grotesk text-3xl text-white sm:text-4xl">
            {t("markets.page_title")}
          </h1>
        </div>
      </div>
    );
  }

  const openQuestions = board.questions.filter((q) => q.status === "open").length;
  const totalStaked = board.questions.reduce((sum, q) => sum + q.pool.yes + q.pool.no, 0);

  return (
    <div className="gc-page min-h-screen px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 xl:px-10">
      <div className="mx-auto w-full max-w-3xl">
        <Link to="/app/games" className="gc-link mb-3 text-sm">
          <ChevronLeft size={14} aria-hidden /> {t("games_hub.title")}
        </Link>
        <header className="mb-5">
          <h1 className="font-grotesk text-3xl text-white sm:text-4xl">
            {t("markets.page_title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-white/65">{t("markets.page_subtitle")}</p>
        </header>

        <section className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="gc-pin">
                <span>{t("markets.join_code_label")}</span> {board.joinCode}
              </p>
              <p className="mt-1.5 text-sm text-white/65">{t(`markets.status_${board.status}`)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="gc-btn gc-btn-outline gc-btn-sm" onClick={copyLink}>
                {copied ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <Copy size={14} aria-hidden="true" />
                )}
                {t("markets.copy_link")}
              </button>
              <button type="button" className="gc-btn gc-btn-outline gc-btn-sm" onClick={openQr}>
                <QrCode size={14} aria-hidden="true" />
                QR
              </button>
              <button
                type="button"
                className="gc-btn gc-btn-primary gc-btn-sm"
                onClick={toggleLive}
              >
                {board.status === "live" ? (
                  <>
                    <Pause size={14} aria-hidden="true" /> {t("markets.end_button")}
                  </>
                ) : (
                  <>
                    <Play size={14} aria-hidden="true" />
                    {board.status === "ended"
                      ? t("markets.resume_button")
                      : t("markets.start_button")}
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        {qrOpen && qrUrl && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            role="presentation"
            onMouseDown={() => setQrOpen(false)}
          >
            <div
              className="rounded-2xl border border-white/10 bg-[#0c1019] p-6 text-center"
              role="dialog"
              aria-modal="true"
              aria-label={t("markets.qr_alt")}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <img
                src={qrUrl}
                alt={t("markets.qr_alt")}
                className="mx-auto h-64 w-64 rounded-xl bg-white p-2"
              />
              <button
                type="button"
                className="gc-btn gc-btn-outline gc-btn-sm mt-4"
                onClick={() => setQrOpen(false)}
              >
                {t("common.dismiss")}
              </button>
            </div>
          </div>
        )}

        <section className="mb-6 grid grid-cols-3 gap-3">
          <StatCard
            icon={<ListChecks size={16} aria-hidden />}
            value={openQuestions}
            label={t("markets.stat_open_questions")}
          />
          <StatCard
            icon={<Coins size={16} aria-hidden />}
            value={totalStaked}
            label={t("markets.stat_total_staked")}
          />
          <StatCard
            icon={<Users size={16} aria-hidden />}
            value={board.playerCount}
            label={t("markets.stat_guests")}
          />
        </section>

        <section className="mb-6">
          {board.questions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/20 p-6 text-center text-sm text-white/60">
              {t("markets.empty_title")} — {t("markets.empty_body")}
            </p>
          ) : (
            <ul className="space-y-3">
              {board.questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  locale={locale}
                  onResolve={(outcome) => resolveQuestion(q.id, outcome)}
                  onVoid={() => voidQuestion(q)}
                  onDelete={() => deleteQuestion(q)}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 sm:p-5">
          <h2 className="font-grotesk text-lg text-white">{t("markets.add_question_title")}</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="markets-prompt" className="gc-label mb-1">
                {t("markets.prompt_label")}
              </label>
              <input
                id="markets-prompt"
                className="gc-input"
                placeholder={t("markets.prompt_placeholder")}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor="markets-closes-at" className="gc-label mb-1">
                {t("markets.closes_label")}
              </label>
              <input
                id="markets-closes-at"
                type="datetime-local"
                className="gc-input"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="gc-btn gc-btn-primary gc-btn-sm"
              disabled={!prompt.trim() || !closesAt || submitting}
              onClick={addQuestion}
            >
              {t("markets.add_button")}
            </button>
          </div>
        </section>

        <section>
          <h2 className="font-grotesk text-lg text-white">{t("markets.leaderboard_title")}</h2>
          {leaderboard.length === 0 ? (
            <p className="mt-2 text-sm text-white/60">{t("markets.leaderboard_empty")}</p>
          ) : (
            <ol className="mt-2 space-y-1.5">
              {leaderboard.map((entry) => (
                <li key={entry.player.id} className="gc-leaderboard-row">
                  <span className="w-6 shrink-0 text-right text-sm text-white/45">
                    {entry.rank}
                  </span>
                  {entry.rank === 1 ? (
                    <Crown size={16} className="shrink-0 text-[#f6bf54]" aria-hidden />
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden />
                  )}
                  <span aria-hidden="true">{entry.player.avatar}</span>
                  <span className="flex-1 truncate text-sm text-white">{entry.player.name}</span>
                  <span className="text-sm font-semibold tabular-nums text-white">
                    {t("markets.balance_pts", { balance: String(entry.player.balance) })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
