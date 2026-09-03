// /play/:code — the guest's own screen. No login: scanning the host's QR or
// opening the shared link lands here directly. First visit asks for a name +
// a character (an avatar grid, Kahoot-style); after that the player's token
// lives in localStorage so a phone refresh mid-game never loses their score.
// No app chrome — bare full-bleed, same pattern as WeddingWebsitePage.tsx.

import { Check, Crown, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Shell } from "../../components/Shell";
import { ApiError } from "../../lib/api";
import { fireConfetti } from "../../lib/confetti";
import { quizPlayApi } from "../../lib/endpoints";
import { useT } from "../../lib/i18n";
import { useQuizPoll } from "../../lib/quizPoll";
import {
  QUIZ_AVATARS,
  QUIZ_PLAYER_NAME_MAX,
  quizSlideIsAnswerable,
  quizTimeRemainingMs,
  type QuizAnswerValue,
  type QuizBinaryConfig,
  type QuizHeatmapConfig,
  type QuizMcqConfig,
  type QuizNumberConfig,
  type QuizPublicState,
} from "@shared/quiz";
import { HeatmapPad, type HeatmapPoint } from "./HeatmapPad";
import { NumberSliderInput } from "./NumberSliderInput";
import { QuizAnswerButtons } from "./QuizAnswerButtons";
import "./QuizPlay.css";

interface StoredPlayer {
  token: string;
  playerId: number;
  name: string;
  avatar: string;
}

function storageKey(code: string): string {
  return `weddly.quiz.player.${code.toUpperCase()}`;
}

function readStoredPlayer(code: string): StoredPlayer | null {
  try {
    const raw = localStorage.getItem(storageKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as StoredPlayer;
  } catch {
    return null;
  }
}

function writeStoredPlayer(code: string, player: StoredPlayer): void {
  try {
    localStorage.setItem(storageKey(code), JSON.stringify(player));
  } catch {
    // localStorage unavailable (private mode) — the guest just re-joins on
    // the next visit, which is a fine fallback for a party game.
  }
}

export default function QuizPlayPage() {
  const { t } = useT();
  const { code: codeParam } = useParams<{ code: string }>();
  const code = (codeParam ?? "").toUpperCase();
  const [player, setPlayer] = useState<StoredPlayer | null>(() =>
    code ? readStoredPlayer(code) : null,
  );

  const { data: state, error } = useQuizPoll<QuizPublicState>(
    () => (player ? quizPlayApi.state(code, player.token) : quizPlayApi.lookup(code, null)),
    1300,
  );

  if (error instanceof ApiError && error.status === 404) {
    return (
      <Shell>
        <div className="mx-auto max-w-md text-center">
          <h1 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
            {t("quiz.play.not_found_title")}
          </h1>
          <p className="mt-3 text-sm text-ink-600 dark:text-umber-200">
            {t("quiz.play.not_found_body")}
          </p>
        </div>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <div className="mx-auto max-w-md text-center text-sm text-ink-500 dark:text-umber-300">
          {t("common.loading")}
        </div>
      </Shell>
    );
  }

  // A joined player who somehow lost server-side state (e.g. a host reset)
  // falls back to the join form rather than getting stuck.
  const joined = player && state.myScore !== null;

  if (!joined) {
    return (
      <div className="qz-page px-5 py-10">
        <JoinForm
          code={code}
          quizTitle={state.quizTitle}
          hostDisplayName={state.hostDisplayName}
          onJoined={(p) => {
            writeStoredPlayer(code, p);
            setPlayer(p);
          }}
        />
      </div>
    );
  }

  return (
    <div className="qz-page px-5 py-8">
      <PlayView code={code} player={player} state={state} />
    </div>
  );
}

// ─── join ────────────────────────────────────────────────────────────────────

function JoinForm({
  code,
  quizTitle,
  hostDisplayName,
  onJoined,
}: {
  code: string;
  quizTitle: string;
  hostDisplayName: string;
  onJoined: (player: StoredPlayer) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(QUIZ_AVATARS[0]!);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const existing = readStoredPlayer(code);
      const { player, token } = await quizPlayApi.join(
        code,
        name.trim(),
        avatar,
        existing?.token ?? null,
      );
      onJoined({ token, playerId: player.id, name: player.name, avatar: player.avatar });
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : t("common.error_generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm">
      <p className="text-center text-xs font-semibold uppercase tracking-wide text-white/40">
        {hostDisplayName
          ? t("quiz.play.hosted_by", { name: hostDisplayName })
          : t("quiz.play.join_kicker")}
      </p>
      <h1 className="mt-1 text-center font-grotesk text-2xl text-white">{quizTitle}</h1>

      <label
        className="mt-8 block text-xs font-semibold uppercase tracking-wide text-white/50"
        htmlFor="quiz-join-name"
      >
        {t("quiz.play.name_label")}
      </label>
      <input
        id="quiz-join-name"
        className="mt-1.5 w-full rounded-lg border border-white/20 bg-white/5 px-3.5 py-2.5 text-base text-white placeholder:text-white/30 focus:border-[#45e39e] focus:outline-none"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={QUIZ_PLAYER_NAME_MAX}
        placeholder={t("quiz.play.name_placeholder")}
        autoFocus
      />

      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/50">
        {t("quiz.play.avatar_label")}
      </p>
      <div className="qz-avatar-grid mt-1.5">
        {QUIZ_AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            className={`qz-avatar-choice ${avatar === a ? "is-selected" : ""}`}
            onClick={() => setAvatar(a)}
            aria-pressed={avatar === a}
            aria-label={a}
          >
            {a}
          </button>
        ))}
      </div>

      {formError && <p className="mt-4 text-center text-sm text-[#ff8080]">{formError}</p>}

      <button
        type="button"
        className="mt-7 w-full rounded-xl bg-[#45e39e] py-3.5 text-center text-base font-bold text-[#0c1019] disabled:opacity-40"
        onClick={submit}
        disabled={!name.trim() || busy}
      >
        {t("quiz.play.join_button")}
      </button>
    </div>
  );
}

// ─── play ────────────────────────────────────────────────────────────────────

function PlayView({
  code,
  player,
  state,
}: { code: string; player: StoredPlayer; state: QuizPublicState }) {
  const { t } = useT();
  const [now, setNow] = useState(Date.now());
  const [justAnswered, setJustAnswered] = useState<{
    slideId: number;
    correct: boolean | null;
    points: number;
  } | null>(null);
  const [celebrated, setCelebrated] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const currentSlideId = state.currentSlide?.id ?? null;
  useEffect(() => {
    setJustAnswered((prev) => (prev && prev.slideId === currentSlideId ? prev : null));
  }, [currentSlideId]);

  useEffect(() => {
    if (state.status === "ended" && state.myRank !== null && state.myRank <= 3 && !celebrated) {
      fireConfetti();
      setCelebrated(true);
    }
  }, [state.status, state.myRank, celebrated]);

  async function submitAnswer(value: QuizAnswerValue) {
    if (!state.currentSlide) return;
    try {
      const result = await quizPlayApi.answer(code, player.token, state.currentSlide.id, value);
      setJustAnswered({
        slideId: state.currentSlide.id,
        correct: result.correct,
        points: result.points,
      });
    } catch {
      // A rejected answer (closed window, stale slide) just falls through to
      // the next poll, which will show the current truth.
    }
  }

  if (state.status === "ended") {
    return (
      <div className="mx-auto max-w-sm text-center">
        <Trophy size={40} className="mx-auto text-[#f6bf54]" aria-hidden />
        <h1 className="mt-3 font-grotesk text-2xl text-white">{t("quiz.play.ended_title")}</h1>
        {state.myRank !== null && (
          <p className="mt-2 text-white/70">{t("quiz.play.your_rank", { rank: state.myRank })}</p>
        )}
        <p className="mt-1 text-4xl font-bold tabular-nums text-white">{state.myScore ?? 0}</p>
        <MiniLeaderboard entries={state.leaderboard} myPlayerId={player.playerId} />
      </div>
    );
  }

  if (state.phase === "lobby" || !state.currentSlide) {
    return (
      <div className="mx-auto max-w-sm text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-4xl">
          {player.avatar}
        </div>
        <h1 className="mt-4 font-grotesk text-2xl text-white">
          {t("quiz.play.waiting_title", { name: player.name })}
        </h1>
        <p className="mt-2 text-white/60">{t("quiz.play.waiting_body")}</p>
        <p className="mt-6 text-sm text-white/40">
          {t("quiz.play.players_joined", { count: state.totalPlayers })}
        </p>
      </div>
    );
  }

  const slide = state.currentSlide;
  const answerable = quizSlideIsAnswerable(slide.kind);
  const answered = state.hasAnswered || justAnswered?.slideId === slide.id;
  const remainingMs = quizTimeRemainingMs(
    { phase: state.phase, phase_started_at: state.phaseStartedAt, time_limit_s: slide.timeLimitS },
    now,
  );
  const revealing = state.phase === "reveal";

  return (
    <div className="mx-auto max-w-lg">
      {slide.timeLimitS !== null && state.phase === "active" && (
        <div className="qz-timer mx-auto mb-4">{Math.ceil(remainingMs / 1000)}</div>
      )}
      <h1 className="text-center text-xl font-semibold text-white">{slide.prompt}</h1>
      {slide.subtitle && <p className="mt-2 text-center text-white/60">{slide.subtitle}</p>}

      <div className="mt-6">
        {!answerable ? null : revealing ? (
          <RevealedAnswer
            slide={slide}
            justAnswered={justAnswered}
            myRank={state.myRank}
            myScore={state.myScore}
          />
        ) : answered ? (
          <WaitingForOthers justAnswered={justAnswered} />
        ) : (
          <AnswerInput slide={slide} onSubmit={submitAnswer} />
        )}
      </div>

      {revealing && <MiniLeaderboard entries={state.leaderboard} myPlayerId={player.playerId} />}
    </div>
  );
}

function WaitingForOthers({
  justAnswered,
}: { justAnswered: { correct: boolean | null; points: number } | null }) {
  const { t } = useT();
  return (
    <div className="text-center">
      {justAnswered && justAnswered.correct !== null && (
        <p
          className={`mb-3 text-lg font-bold ${justAnswered.correct ? "text-[#45e39e]" : "text-[#ff8080]"}`}
        >
          {justAnswered.correct
            ? t("quiz.play.correct_banner", { points: justAnswered.points })
            : t("quiz.play.incorrect_banner")}
        </p>
      )}
      <p className="text-white/60">{t("quiz.play.answer_locked_in")}</p>
    </div>
  );
}

function RevealedAnswer({
  slide,
  justAnswered,
  myRank,
  myScore,
}: {
  slide: QuizPublicState["currentSlide"];
  justAnswered: { correct: boolean | null; points: number } | null;
  myRank: number | null;
  myScore: number | null;
}) {
  const { t } = useT();
  if (!slide) return null;
  return (
    <div className="text-center">
      {justAnswered?.correct !== null && justAnswered !== null && (
        <p
          className={`mb-2 flex items-center justify-center gap-2 text-lg font-bold ${justAnswered.correct ? "text-[#45e39e]" : "text-[#ff8080]"}`}
        >
          {justAnswered.correct ? <Check size={20} /> : <X size={20} />}
          {justAnswered.correct
            ? t("quiz.play.correct_banner", { points: justAnswered.points })
            : t("quiz.play.incorrect_banner")}
        </p>
      )}
      {slide.kind === "mcq" || slide.kind === "binary" ? (
        <QuizAnswerButtons
          options={(slide.config as QuizMcqConfig | QuizBinaryConfig).options}
          correctIndex={(slide.config as QuizMcqConfig | QuizBinaryConfig).correctIndex}
          disabled
        />
      ) : slide.kind === "number" ? (
        <p className="text-white/70">
          {(slide.config as QuizNumberConfig).correctValue !== null
            ? t("quiz.play.correct_value", {
                value: (slide.config as QuizNumberConfig).correctValue as number,
              })
            : t("quiz.play.no_correct_answer")}
        </p>
      ) : null}
      {myRank !== null && (
        <p className="mt-3 text-sm text-white/50">
          {t("quiz.play.your_rank_score", { rank: myRank, score: myScore ?? 0 })}
        </p>
      )}
    </div>
  );
}

function AnswerInput({
  slide,
  onSubmit,
}: {
  slide: NonNullable<QuizPublicState["currentSlide"]>;
  onSubmit: (value: QuizAnswerValue) => void;
}) {
  if (slide.kind === "mcq" || slide.kind === "binary") {
    const config = slide.config as QuizMcqConfig | QuizBinaryConfig;
    return (
      <QuizAnswerButtons
        options={config.options}
        onSelect={(optionIndex) => onSubmit({ kind: slide.kind as "mcq" | "binary", optionIndex })}
      />
    );
  }
  if (slide.kind === "number") {
    return <NumberAnswer config={slide.config as QuizNumberConfig} onSubmit={onSubmit} />;
  }
  if (slide.kind === "heatmap") {
    return <HeatmapAnswer config={slide.config as QuizHeatmapConfig} onSubmit={onSubmit} />;
  }
  return null;
}

function NumberAnswer({
  config,
  onSubmit,
}: { config: QuizNumberConfig; onSubmit: (value: QuizAnswerValue) => void }) {
  const { t } = useT();
  const [value, setValue] = useState(Math.round((config.min + config.max) / 2));
  return (
    <div>
      <NumberSliderInput
        min={config.min}
        max={config.max}
        step={config.step}
        unit={config.unit}
        value={value}
        onChange={setValue}
      />
      <button
        type="button"
        className="mt-6 w-full rounded-xl bg-[#45e39e] py-3.5 text-center text-base font-bold text-[#0c1019]"
        onClick={() => onSubmit({ kind: "number", value })}
      >
        {t("quiz.play.submit_answer")}
      </button>
    </div>
  );
}

function HeatmapAnswer({
  config,
  onSubmit,
}: { config: QuizHeatmapConfig; onSubmit: (value: QuizAnswerValue) => void }) {
  const { t } = useT();
  const [point, setPoint] = useState<HeatmapPoint | null>(null);
  return (
    <div>
      <HeatmapPad
        xLabel={config.xLabel}
        yLabel={config.yLabel}
        mine={point}
        interactive
        onPick={setPoint}
      />
      <button
        type="button"
        className="mt-6 w-full rounded-xl bg-[#45e39e] py-3.5 text-center text-base font-bold text-[#0c1019] disabled:opacity-40"
        disabled={!point}
        onClick={() => point && onSubmit({ kind: "heatmap", x: point.x, y: point.y })}
      >
        {t("quiz.play.submit_answer")}
      </button>
    </div>
  );
}

function MiniLeaderboard({
  entries,
  myPlayerId,
}: { entries: QuizPublicState["leaderboard"]; myPlayerId: number }) {
  const top = useMemo(() => entries?.slice(0, 5) ?? [], [entries]);
  if (!entries || entries.length === 0) return null;
  return (
    <ul className="mx-auto mt-6 max-w-xs space-y-1.5 text-left">
      {top.map((entry) => (
        <li
          key={entry.player.id}
          className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${
            entry.player.id === myPlayerId ? "bg-white/15 text-white" : "bg-white/5 text-white/70"
          }`}
        >
          <span className="w-4 text-right font-bold">{entry.rank}</span>
          {entry.rank === 1 && <Crown size={14} className="text-[#f6bf54]" aria-hidden />}
          <span>{entry.player.avatar}</span>
          <span className="flex-1 truncate">{entry.player.name}</span>
          <span className="font-semibold tabular-nums">{entry.player.score}</span>
        </li>
      ))}
    </ul>
  );
}
