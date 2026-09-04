// /app/games/quiz/:quizId/host — the "admin slide": QR + join code in the lobby,
// live answer count + countdown while a question is open, breakdown +
// leaderboard on reveal, final leaderboard + confetti at the end. Polls
// GET /api/quizzes/:id/host-state — no WebSocket in this codebase, see
// shared/quiz.ts's header comment for why that's the deliberate choice here.

import { ArrowRight, Crown, Eye, RotateCcw, Square, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useConfirm, useToast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { quizApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { fireConfetti } from "../../lib/confetti";
import { useQuizPoll } from "../../lib/quizPoll";
import {
  quizRoundPosition,
  quizTimeRemainingMs,
  quizSlideIsAnswerable,
  type QuizBinaryConfig,
  type QuizHeatmapConfig,
  type QuizHostState,
  type QuizMcqConfig,
  type QuizNumberConfig,
  type QuizRoundPosition,
  type QuizSlide,
} from "@shared/quiz";
import { HeatmapPad } from "./HeatmapPad";
import "./QuizPlay.css";

export default function QuizHostPage() {
  const { t } = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { quizId: quizIdParam } = useParams<{ quizId: string }>();
  const quizId = Number(quizIdParam);

  const { data: state, error } = useQuizPoll(() => quizApi.hostState(quizId), 1500);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [celebrated, setCelebrated] = useState(false);
  // Fetched once (not polled) purely to know where the ROUND boundaries are
  // — the host-state poll only ever carries the one currentSlide, and slide
  // editing is locked for the whole time a quiz is live anyway, so this list
  // can't go stale under the host's feet mid-session.
  const [slides, setSlides] = useState<QuizSlide[] | null>(null);

  useEffect(() => {
    if (!Number.isFinite(quizId)) return;
    quizApi
      .get(quizId)
      .then((r) => setSlides(r.quiz.slides))
      .catch(() => setSlides(null));
  }, [quizId]);

  const roundInfo: QuizRoundPosition | null =
    slides && state?.currentSlide ? quizRoundPosition(slides, state.currentSlide.position) : null;

  useEffect(() => {
    if (!Number.isFinite(quizId)) return;
    let url: string | null = null;
    quizApi
      .qrBlob(quizId)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setQrSrc(url);
      })
      .catch(() => setQrSrc(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [quizId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (state?.quiz.status === "ended" && !celebrated) {
      fireConfetti();
      setCelebrated(true);
    }
  }, [state?.quiz.status, celebrated]);

  async function run<T>(action: () => Promise<T>) {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    const ok = await confirm({
      title: t("quiz.host.reset_confirm_title"),
      body: t("quiz.host.reset_confirm_body"),
      confirmLabel: t("quiz.host.reset_confirm_action"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setCelebrated(false);
    run(() => quizApi.hostReset(quizId));
  }

  if (!state) {
    return (
      <div className="qz-page flex min-h-screen items-center justify-center">
        {error ? (
          <p className="text-white/60">{t("common.error_generic")}</p>
        ) : (
          <p className="text-white/60">{t("common.loading")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="qz-page flex min-h-screen flex-col items-center px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="font-grotesk text-xl text-white">{state.quiz.title}</h1>
          <span className="flex items-center gap-1.5 text-sm text-white/50">
            <Users size={15} aria-hidden /> {state.totalPlayers}
          </span>
        </header>

        {(state.phase === "active" || state.phase === "reveal") && (
          <RoundTracker roundInfo={roundInfo} />
        )}

        {state.quiz.status === "draft" && (
          <DraftView onStart={() => run(() => quizApi.hostStart(quizId))} busy={busy} />
        )}

        {state.quiz.status === "live" && state.phase === "lobby" && (
          <LobbyView
            state={state}
            qrSrc={qrSrc}
            onBegin={() => run(() => quizApi.hostBeginSlide(quizId, "next"))}
            busy={busy}
          />
        )}

        {state.quiz.status === "live" && state.phase === "active" && (
          <ActiveView
            state={state}
            now={now}
            roundInfo={roundInfo}
            onReveal={() => run(() => quizApi.hostReveal(quizId))}
            onNext={() => run(() => quizApi.hostBeginSlide(quizId, "next"))}
            busy={busy}
          />
        )}

        {state.quiz.status === "live" && state.phase === "reveal" && (
          <RevealView
            state={state}
            onNext={() => run(() => quizApi.hostBeginSlide(quizId, "next"))}
            onEnd={() => run(() => quizApi.hostEnd(quizId))}
            busy={busy}
          />
        )}

        {state.quiz.status === "ended" && (
          <EndedView state={state} onReset={handleReset} busy={busy} />
        )}
      </div>
    </div>
  );
}

function DraftView({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  const { t } = useT();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
      <p className="text-white/70">{t("quiz.host.draft_body")}</p>
      <button type="button" className="btn-primary mt-6" onClick={onStart} disabled={busy}>
        {t("quiz.host.start_button")}
      </button>
    </div>
  );
}

function LobbyView({
  state,
  qrSrc,
  onBegin,
  busy,
}: {
  state: QuizHostState;
  qrSrc: string | null;
  onBegin: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      <p className="qz-pin justify-center text-2xl">
        <span>{t("quiz.host.join_code_label")}</span> {state.quiz.joinCode}
      </p>
      {qrSrc && (
        <img
          src={qrSrc}
          alt={t("quiz.host.qr_alt")}
          className="mx-auto mt-5 h-52 w-52 rounded-xl bg-white p-2"
        />
      )}
      <p className="mt-4 text-sm text-white/50">{t("quiz.host.lobby_hint")}</p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {state.players.map((p) => (
          <span
            key={p.id}
            className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white"
          >
            <span className="text-lg">{p.avatar}</span> {p.name}
          </span>
        ))}
        {state.players.length === 0 && (
          <span className="text-sm text-white/40">{t("quiz.host.no_players_yet")}</span>
        )}
      </div>

      <button
        type="button"
        className="btn-primary mt-8"
        onClick={onBegin}
        disabled={busy || state.players.length === 0}
      >
        {t("quiz.host.begin_button")} <ArrowRight size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Slim step tracker across the top of the live view — only worth showing
 *  once the quiz actually has more than one round (see `quizRoundPosition`'s
 *  own comment for why a quiz with no section slides is "1 of 1", which this
 *  suppresses rather than render as a pointless single dot). */
function RoundTracker({ roundInfo }: { roundInfo: QuizRoundPosition | null }) {
  const { t } = useT();
  if (!roundInfo || roundInfo.totalRounds <= 1) return null;
  return (
    <div className="mb-4 flex items-center justify-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">
        {t("quiz.host.round_progress", {
          current: String(roundInfo.round),
          total: String(roundInfo.totalRounds),
        })}
      </span>
      <span className="flex items-center gap-1.5" aria-hidden="true">
        {Array.from({ length: roundInfo.totalRounds }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`h-1.5 rounded-full transition-all ${
              n === roundInfo.round ? "w-5 bg-[#a78bfa]" : "w-1.5 bg-white/20"
            }`}
          />
        ))}
      </span>
    </div>
  );
}

/** The Kahoot-style "ROUND 2: FIRSTS" title card a `section` slide gets
 *  instead of the generic question layout — a couple built this as a
 *  deliberate transition beat between clusters of questions, and it read as
 *  just another (answerless, timerless) question before this. */
function SectionView({
  slide,
  roundInfo,
  onNext,
  busy,
}: {
  slide: QuizSlide;
  roundInfo: QuizRoundPosition | null;
  onNext: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#4c1d95]/60 via-white/5 to-white/5 p-10 text-center sm:p-14">
      {roundInfo && (
        <p className="text-6xl font-bold text-[#a78bfa] sm:text-7xl">{roundInfo.round}</p>
      )}
      <h2 className="mt-4 font-grotesk text-3xl text-white sm:text-4xl">{slide.prompt}</h2>
      {slide.subtitle && <p className="mt-3 text-lg text-white/60">{slide.subtitle}</p>}
      <button type="button" className="btn-primary mt-9" onClick={onNext} disabled={busy}>
        {t("quiz.host.next_button")} <ArrowRight size={16} aria-hidden />
      </button>
    </div>
  );
}

function ActiveView({
  state,
  now,
  roundInfo,
  onReveal,
  onNext,
  busy,
}: {
  state: QuizHostState;
  now: number;
  roundInfo: QuizRoundPosition | null;
  onReveal: () => void;
  onNext: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  const slide = state.currentSlide;
  if (!slide) return null;
  if (slide.kind === "section") {
    return <SectionView slide={slide} roundInfo={roundInfo} onNext={onNext} busy={busy} />;
  }
  const answerable = quizSlideIsAnswerable(slide.kind);
  const remainingMs = quizTimeRemainingMs(
    { phase: state.phase, phase_started_at: state.phaseStartedAt, time_limit_s: slide.timeLimitS },
    now,
  );

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
      {slide.timeLimitS !== null && (
        <div className="qz-timer mx-auto mb-4">{Math.ceil(remainingMs / 1000)}</div>
      )}
      <p className="text-2xl font-semibold text-white">{slide.prompt}</p>
      {slide.subtitle && <p className="mt-2 text-white/60">{slide.subtitle}</p>}

      {answerable && (
        <p className="mt-6 text-lg text-white/70">
          {t("quiz.host.answered_count", {
            answered: state.answeredCount,
            total: state.totalPlayers,
          })}
        </p>
      )}

      <div className="mt-8">
        {answerable ? (
          <button type="button" className="btn-primary" onClick={onReveal} disabled={busy}>
            <Eye size={16} aria-hidden /> {t("quiz.host.reveal_button")}
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={onNext} disabled={busy}>
            {t("quiz.host.next_button")} <ArrowRight size={16} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function RevealView({
  state,
  onNext,
  onEnd,
  busy,
}: {
  state: QuizHostState;
  onNext: () => void;
  onEnd: () => void;
  busy: boolean;
}) {
  const { t } = useT();
  const slide = state.currentSlide;
  return (
    <div className="space-y-6">
      {slide && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <p className="text-center text-xl font-semibold text-white">{slide.prompt}</p>
          <div className="mt-5">
            <AnswerBreakdown state={state} />
          </div>
        </div>
      )}

      <Leaderboard entries={state.leaderboard} showDelta />

      <div className="flex justify-center gap-3">
        <button type="button" className="btn-primary" onClick={onNext} disabled={busy}>
          {t("quiz.host.next_button")} <ArrowRight size={16} aria-hidden />
        </button>
        <button
          type="button"
          className="btn-outline border-white/20 text-white"
          onClick={onEnd}
          disabled={busy}
        >
          <Square size={15} aria-hidden /> {t("quiz.host.end_button")}
        </button>
      </div>
    </div>
  );
}

function EndedView({
  state,
  onReset,
  busy,
}: { state: QuizHostState; onReset: () => void; busy: boolean }) {
  const { t } = useT();
  return (
    <div className="space-y-6">
      <h2 className="text-center text-2xl font-bold text-white">
        {t("quiz.host.final_leaderboard_title")}
      </h2>
      <Leaderboard entries={state.leaderboard} />
      <div className="flex justify-center">
        <button
          type="button"
          className="btn-outline border-white/20 text-white"
          onClick={onReset}
          disabled={busy}
        >
          <RotateCcw size={15} aria-hidden /> {t("quiz.host.reset_button")}
        </button>
      </div>
    </div>
  );
}

function Leaderboard({
  entries,
  showDelta,
}: { entries: QuizHostState["leaderboard"]; showDelta?: boolean }) {
  return (
    <ul className="mx-auto max-w-lg space-y-1.5">
      {entries.slice(0, 10).map((entry) => (
        <li
          key={entry.player.id}
          className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-2.5 text-white"
        >
          <span className="w-6 text-right font-bold text-white/50">{entry.rank}</span>
          {entry.rank === 1 && <Crown size={16} className="text-[#f6bf54]" aria-hidden />}
          <span className="text-xl">{entry.player.avatar}</span>
          <span className="flex-1 truncate">{entry.player.name}</span>
          {showDelta && entry.delta !== null && entry.delta > 0 && (
            <span className="text-sm text-[#45e39e]">+{entry.delta}</span>
          )}
          <span className="font-semibold tabular-nums">{entry.player.score}</span>
        </li>
      ))}
    </ul>
  );
}

function AnswerBreakdown({ state }: { state: QuizHostState }) {
  const slide = state.currentSlide;
  const answers = state.currentSlideAnswers;
  if (!slide || !answers) return null;

  if (slide.kind === "mcq" || slide.kind === "binary") {
    const config = slide.config as QuizMcqConfig | QuizBinaryConfig;
    const counts = config.options.map(
      (_, i) =>
        answers.filter(
          (a) =>
            a.value.kind === slide.kind && "optionIndex" in a.value && a.value.optionIndex === i,
        ).length,
    );
    const max = Math.max(1, ...counts);
    return (
      <div className="space-y-2">
        {config.options.map((opt, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className={`w-28 shrink-0 truncate text-sm ${config.correctIndex === i ? "font-bold text-[#45e39e]" : "text-white/70"}`}
            >
              {opt}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded bg-white/10">
              <div
                className="h-full rounded bg-[#2388ff]"
                style={{ width: `${(counts[i]! / max) * 100}%` }}
              />
            </div>
            <span className="w-6 text-right text-sm text-white/60">{counts[i]}</span>
          </div>
        ))}
      </div>
    );
  }

  if (slide.kind === "number") {
    const config = slide.config as QuizNumberConfig;
    return (
      <div className="relative h-16">
        <div className="absolute inset-x-0 top-8 h-1 rounded bg-white/15" />
        {answers.map((a, i) =>
          a.value.kind === "number" ? (
            <span
              key={i}
              className="absolute top-6 h-4 w-4 -translate-x-1/2 rounded-full bg-[#2388ff]"
              style={{
                left: `${((a.value.value - config.min) / Math.max(1e-9, config.max - config.min)) * 100}%`,
              }}
            />
          ) : null,
        )}
        {config.correctValue !== null && (
          <span
            className="absolute top-4 h-8 w-1 -translate-x-1/2 rounded bg-[#45e39e]"
            style={{
              left: `${((config.correctValue - config.min) / Math.max(1e-9, config.max - config.min)) * 100}%`,
            }}
          />
        )}
      </div>
    );
  }

  if (slide.kind === "heatmap") {
    const config = slide.config as QuizHeatmapConfig;
    return (
      <HeatmapPad
        xLabel={config.xLabel}
        yLabel={config.yLabel}
        target={config.target}
        others={answers
          .filter((a) => a.value.kind === "heatmap")
          .map((a) => a.value as { x: number; y: number })}
      />
    );
  }

  return null;
}
