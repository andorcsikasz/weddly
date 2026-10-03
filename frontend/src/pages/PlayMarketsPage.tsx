// Live wedding prediction markets — public, no-login guest join/play at
// /play/markets/:code. Sibling of the quiz's /play/:code guest page, kept at
// its own path (rather than reusing /play/:code) so the two games' join
// codes can never collide. No account: a name + avatar picked at join time,
// stored as a device token in localStorage (same posture as the quiz's
// player token and the verified-visitor device token) — see
// domain/markets_play.ts on the backend for why this is deliberately
// lighter than a real auth credential.
//
// The payout math shown live here (`estimatedPayout`) is the SAME pure
// function the backend uses to settle a resolved question — imported
// straight from shared/markets.ts rather than re-derived, so the number a
// guest sees while dragging the stake can never disagree with what actually
// gets paid out.
//
// Party mode: the page runs on the same dark console canvas as the couple's
// board and the venue big screen, and everything that makes it a game rather
// than a form lives in components/markets/party.tsx (reveal, reactions,
// podium, flash countdowns), shared with the big screen so a phone and the TV
// tell the room the same story at the same moment.

import {
  bailoutRefund,
  estimatedPayout,
  isFlashQuestion,
  MARKET_AVATARS,
  MARKET_MIN_STAKE,
  MARKET_PITY_LOAN,
  MARKET_QUICK_STAKES,
  MARKET_REACTIONS,
  MARKET_TEAMS,
  type MarketPublicState,
  type MarketQuestion,
  type MarketSide,
  type MarketTeam,
  trendSinceOpen,
} from "@shared/markets";
import { Coins, Lock, TrendingDown, TrendingUp, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { MarketMiniChart } from "../components/MarketMiniChart";
import {
  FlashBadge,
  Podium,
  ReactionLayer,
  RevealOverlay,
  TitleChips,
  useNewQuestions,
  useNow,
  useRevealQueue,
} from "../components/markets/party";
import { useToast } from "../components/ui";
import { Wordmark } from "../components/Wordmark";
import { ApiError } from "../lib/api";
import { marketsPlayApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import { isMuted, playSound, setMuted } from "../lib/market_sfx";
import "./games/GamesConsole.css";

function tokenKey(code: string): string {
  return `weddly.market.${code}`;
}
function readToken(code: string): string | null {
  try {
    return localStorage.getItem(tokenKey(code));
  } catch {
    return null;
  }
}
function writeToken(code: string, token: string): void {
  try {
    localStorage.setItem(tokenKey(code), token);
  } catch {
    // best-effort only — a private tab just re-joins on every visit
  }
}

// Faster than the old 5s: flash questions live for a minute, and a reveal
// that lands 5 seconds after the big screen's reads as lag.
const STATE_POLL_MS = 3000;

function BetControls({
  question,
  balance,
  onBet,
}: {
  question: MarketQuestion;
  balance: number;
  onBet: (side: MarketSide, stake: number) => Promise<void>;
}) {
  const { t } = useT();
  const [side, setSide] = useState<MarketSide | null>(null);
  const [stake, setStake] = useState(50);
  const [busy, setBusy] = useState(false);

  if (question.status !== "open") return null;

  const maxStake = Math.max(0, balance);
  const effective = Math.min(stake, maxStake);
  const payout = side ? estimatedPayout(question.pool, side, effective) : 0;
  const allIn = effective === maxStake && maxStake > 0;

  return (
    <div className="mt-3 rounded-xl bg-white/5 p-3">
      <div className="gc-side-split">
        <button
          type="button"
          className={`gc-outcome-btn gc-outcome-btn-yes gc-outcome-btn-block ${
            side === "yes" ? "ring-2 ring-inset ring-white/80" : ""
          }`}
          onClick={() => setSide("yes")}
        >
          {t("markets_play.bet_yes")} · {question.probability}%
        </button>
        <button
          type="button"
          className={`gc-outcome-btn gc-outcome-btn-no gc-outcome-btn-block ${
            side === "no" ? "ring-2 ring-inset ring-white/80" : ""
          }`}
          onClick={() => setSide("no")}
        >
          {t("markets_play.bet_no")} · {100 - question.probability}%
        </button>
      </div>

      {side && (
        <div className="mk-pop-in mt-3">
          <p className="gc-label">{t("markets_play.stake_label")}</p>
          <div className="flex flex-wrap gap-1.5">
            {MARKET_QUICK_STAKES.filter((s) => s <= maxStake).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStake(s)}
                className={`mk-wiggle rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums ${
                  effective === s && !allIn ? "bg-white text-ink-900" : "bg-white/10 text-white"
                }`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setStake(maxStake)}
              disabled={maxStake <= 0}
              className={`mk-wiggle rounded-lg px-3 py-1.5 text-sm font-black tracking-wide ${
                allIn ? "bg-star text-ink-900" : "bg-star/20 text-star"
              }`}
            >
              {t("markets_party.all_in")}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Coins size={16} className="text-white/60" aria-hidden="true" />
            <input
              id={`stake-${question.id}`}
              aria-label={t("markets_play.stake_label")}
              type="range"
              min={MARKET_MIN_STAKE}
              max={maxStake || MARKET_MIN_STAKE}
              step={5}
              value={Math.min(stake, maxStake || MARKET_MIN_STAKE)}
              onChange={(e) => setStake(Number(e.target.value))}
              className="flex-1 accent-star"
            />
            <span className="w-14 text-right text-sm font-bold tabular-nums text-white">
              {effective}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
            <span className="text-white/70">{t("markets_play.estimated_return_label")}</span>
            <span className="font-bold tabular-nums text-white">{payout} pts</span>
          </div>
          {question.pool[side === "yes" ? "no" : "yes"] === 0 ? (
            // Pooled betting pays winners out of the OTHER side's stakes, so
            // with nobody across from you the profit really is zero for now.
            // A bare "0 pts" read as a pointless bet; this says why and when
            // that changes.
            <p className="mt-1 text-xs font-semibold text-star">
              {t("markets_party.first_in_hint")}
            </p>
          ) : (
            <div className="mt-1 flex items-center justify-between text-xs text-white/55">
              <span>{t("markets_play.profit_label")}</span>
              <span className="tabular-nums">{Math.max(0, payout - effective)} pts</span>
            </div>
          )}
          <p className="mt-1 text-[11px] text-white/45">
            {t("markets_play.estimated_return_hint")}
          </p>

          <button
            type="button"
            className={`gc-btn mt-3 w-full font-black ${allIn ? "bg-star text-ink-900" : "gc-btn-primary"}`}
            disabled={busy || maxStake <= 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onBet(side, effective);
                setSide(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {allIn ? `${t("markets_party.all_in")}!` : t("markets_play.place_bet")}
          </button>
        </div>
      )}
    </div>
  );
}

function QuestionRow({
  question,
  myBalance,
  myPosition,
  now,
  onBet,
  onBailout,
}: {
  question: MarketQuestion;
  myBalance: number | null;
  myPosition: MarketPublicState["myPositions"][number] | undefined;
  now: number;
  onBet: (questionId: number, side: MarketSide, stake: number) => Promise<void>;
  onBailout: (questionId: number) => Promise<void>;
}) {
  const { t } = useT();
  const trend = trendSinceOpen(question.priceHistory);
  const [busy, setBusy] = useState(false);
  // A flash window can pass between polls; lock the slip on the client clock
  // too, so nobody taps "bet" on a question the server already closed.
  const open = question.status === "open" && question.closesAt > now;

  return (
    <li
      className={`gc-card mk-pop-in p-4 ${
        isFlashQuestion(question) && open ? "border-star/60" : ""
      }`}
    >
      <div className="mb-1">
        <FlashBadge question={question} now={now} />
      </div>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold text-white">{question.prompt}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-2xl font-black tabular-nums text-white">
            {question.probability}%
          </span>
          {trend !== null && (
            <span className={`gc-trend ${trend > 0 ? "gc-trend-up" : "gc-trend-down"}`}>
              {trend > 0 ? (
                <TrendingUp size={11} aria-hidden />
              ) : (
                <TrendingDown size={11} aria-hidden />
              )}
              {trend > 0 ? "+" : ""}
              {trend}%
            </span>
          )}
        </div>
      </div>

      {question.pool.yes + question.pool.no > 0 && (
        <div className="mt-2 h-24">
          <MarketMiniChart
            ticks={question.priceHistory}
            stroke="#45e39e"
            ariaLabel={t("markets.chart_alt")}
            current={question.probability}
          />
        </div>
      )}

      {myPosition && (
        <p className="mt-2 text-xs text-white/75">
          {t("markets_play.your_position", {
            stake: String(myPosition.stake),
            side: t(`markets_play.bet_${myPosition.side}`),
          })}
          {open && (
            <span className="ml-1.5 font-semibold text-[#6ff0b7]">
              {t("markets_play.position_value", { value: String(myPosition.currentValue) })}
            </span>
          )}
        </p>
      )}

      {question.status === "open" && !open && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/60">
          <Lock size={12} aria-hidden="true" /> {t("markets_play.closed_note")}
        </p>
      )}
      {question.status === "closed" && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/60">
          <Lock size={12} aria-hidden="true" /> {t("markets_play.closed_note")}
        </p>
      )}
      {question.status === "resolved" && question.outcome && (
        <p className="mt-2 text-xs font-semibold text-white/85">
          {t("markets_play.resolved_note", { outcome: t(`markets_play.bet_${question.outcome}`) })}
          {myPosition &&
            (myPosition.side === question.outcome
              ? myPosition.payout != null &&
                ` · ${t("markets_play.you_won", { payout: String(myPosition.payout) })}`
              : ` · ${t("markets_play.you_lost")}`)}
        </p>
      )}
      {question.status === "voided" && (
        <p className="mt-2 text-xs text-white/60">{t("markets_play.voided_note")}</p>
      )}

      {open && myBalance !== null && !myPosition && (
        <BetControls
          question={question}
          balance={myBalance}
          onBet={(side, stake) => onBet(question.id, side, stake)}
        />
      )}
      {open && myPosition && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-white/50">{t("markets_party.bailout_hint")}</p>
          <button
            type="button"
            className="gc-btn gc-btn-outline gc-btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onBailout(question.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            🪂 {t("markets_party.bailout", { refund: String(bailoutRefund(myPosition.stake)) })}
          </button>
        </div>
      )}
    </li>
  );
}

function JoinScreen({
  hostDisplayName,
  prize,
  onJoin,
}: {
  hostDisplayName: string;
  prize: string | null;
  onJoin: (name: string, avatar: string, team: MarketTeam | null) => Promise<void>;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(MARKET_AVATARS[0] as string);
  const [team, setTeam] = useState<MarketTeam | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-sm px-4 py-10 text-center">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-star">
        {t("markets_play.join_kicker")}
      </p>
      {hostDisplayName && (
        <h1 className="mt-1 font-grotesk text-2xl text-white">
          {t("markets_play.hosted_by", { name: hostDisplayName })}
        </h1>
      )}
      {prize && (
        <p className="mt-2 text-sm text-white/75">🎁 {t("markets_party.prize_won", { prize })}</p>
      )}

      <label htmlFor="market-name" className="gc-label mt-6 text-left">
        {t("markets_play.name_label")}
      </label>
      <input
        id="market-name"
        className="gc-input"
        placeholder={t("markets_play.name_placeholder")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
      />

      <p className="gc-label mt-4 text-left">{t("markets_play.avatar_label")}</p>
      <div className="grid grid-cols-8 gap-1.5">
        {MARKET_AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={avatar === a}
            onClick={() => setAvatar(a)}
            className={`mk-wiggle aspect-square rounded-lg text-lg transition-colors ${
              avatar === a ? "bg-star" : "bg-white/10"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <p className="gc-label mt-4 text-left">{t("markets_party.team_label")}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {[...MARKET_TEAMS, null].map((tm) => (
          <button
            key={tm ?? "none"}
            type="button"
            aria-pressed={team === tm}
            onClick={() => setTeam(tm)}
            className={`rounded-lg px-2 py-2 text-xs font-bold leading-tight ${
              team === tm ? "bg-white text-ink-900" : "bg-white/10 text-white"
            }`}
          >
            {tm === "bride" ? "👰 " : tm === "groom" ? "🤵 " : "🎲 "}
            {t(tm ? `markets_party.team_${tm}` : "markets_party.team_none")}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="gc-btn gc-btn-primary mt-6 w-full font-black"
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onJoin(name.trim(), avatar, team);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("markets_play.join_button")}
      </button>
    </div>
  );
}

function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  const { t } = useT();
  return (
    <div
      role="group"
      aria-label={t("markets_party.react_label")}
      className="fixed inset-x-0 bottom-0 z-30 flex justify-center gap-1 border-t border-white/10 bg-[#0c1019]/95 px-2 py-2 backdrop-blur"
    >
      {MARKET_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          className="rounded-xl px-2 py-1 text-2xl transition-transform active:scale-125"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

export default function PlayMarketsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t } = useT();
  const toast = useToast();
  const [state, setState] = useState<MarketPublicState | null>(null);
  const [token, setToken] = useState<string | null>(() => readToken(code));
  const [notFound, setNotFound] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const pollRef = useRef<number | null>(null);
  const now = useNow(1000);

  async function load() {
    try {
      const s = token
        ? await marketsPlayApi.state(code, token)
        : await marketsPlayApi.lookup(code, null);
      setState(s);
      setNotFound(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }

  useEffect(() => {
    void load();
    pollRef.current = window.setInterval(() => void load(), STATE_POLL_MS);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token]);

  const joined = state !== null && state.myBalance !== null;
  const reveal = useRevealQueue(joined ? state.questions : null, `weddly.market.revealed.${code}`);
  const freshQuestions = useNewQuestions(joined ? state.questions : null);

  useEffect(() => {
    if (freshQuestions.length === 0) return;
    playSound("new");
    toast.success(`⚡ ${t("markets_party.new_question")}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshQuestions]);

  async function guarded<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      return await fn();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("common.error_generic"));
      return undefined;
    }
  }

  async function handleJoin(name: string, avatar: string, team: MarketTeam | null) {
    await guarded(async () => {
      const res = await marketsPlayApi.join(code, name, avatar, token, team);
      writeToken(code, res.token);
      setToken(res.token);
      setState(res.state);
    });
  }

  async function handleBet(questionId: number, side: MarketSide, stake: number) {
    if (!token || !state) return;
    const wasAllIn = stake === state.myBalance;
    const res = await guarded(() => marketsPlayApi.bet(code, token, questionId, side, stake));
    if (!res) return;
    playSound(wasAllIn ? "allin" : "bet");
    setState(res.state);
  }

  async function handleBailout(questionId: number) {
    if (!token) return;
    const res = await guarded(() => marketsPlayApi.bailout(code, token, questionId));
    if (!res) return;
    playSound("lock");
    toast.success(t("markets_party.bailout_done", { refund: String(res.result.refund) }));
    setState(res.state);
  }

  async function handlePity() {
    if (!token) return;
    const res = await guarded(() => marketsPlayApi.pity(code, token));
    if (!res) return;
    playSound("win");
    toast.success(t("markets_party.pity_done"));
    setState(res.state);
  }

  function handleReact(emoji: string) {
    if (!token) return;
    playSound("pop");
    void marketsPlayApi.react(code, token, emoji).catch(() => undefined);
  }

  function toggleMute() {
    setMuted(!muted);
    setMutedState(!muted);
  }

  if (notFound) {
    return (
      <div className="gc-page min-h-screen px-4 py-16 text-center" style={{ margin: 0 }}>
        <p className="text-6xl" aria-hidden>
          🚪
        </p>
        <h1 className="mt-3 font-grotesk text-2xl text-white">
          {t("markets_play.not_found_title")}
        </h1>
        <p className="mt-2 text-sm text-white/70">{t("markets_play.not_found_body")}</p>
      </div>
    );
  }

  if (!state) return null;

  const me = state.leaderboard.find((e) => e.player.id === state.me?.id);
  const ordered = [...state.questions].sort((a, b) => {
    // Live flash questions first, then other open ones, then the rest in order.
    const rank = (q: MarketQuestion) =>
      q.status === "open" && q.closesAt > now ? (isFlashQuestion(q) ? 0 : 1) : 2;
    return rank(a) - rank(b);
  });

  return (
    <div className="gc-page min-h-screen pb-20" style={{ margin: 0 }}>
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-white">
          <Wordmark size="sm" />
        </span>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={t(muted ? "markets_party.unmute" : "markets_party.mute")}
          className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white"
        >
          {muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
        </button>
      </header>

      {!joined ? (
        <JoinScreen
          hostDisplayName={state.hostDisplayName}
          prize={state.prize}
          onJoin={handleJoin}
        />
      ) : state.status === "ended" ? (
        <main className="px-4 py-10">
          <Podium leaderboard={state.leaderboard} prize={state.prize} />
          <p className="mt-8 text-center text-sm text-white/60">{t("markets_play.ended_note")}</p>
        </main>
      ) : (
        <main className="mx-auto max-w-lg px-4 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate font-grotesk text-xl text-white">{state.boardTitle}</h1>
              {me && (
                <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-white/60">
                  #{me.rank}
                  {state.me?.team && ` · ${t(`markets_party.team_${state.me.team}`)}`}
                  <TitleChips titles={me.titles} />
                </p>
              )}
            </div>
            <span className="shrink-0 rounded-full bg-star px-3 py-1 text-sm font-black tabular-nums text-ink-900">
              🪙 {state.myBalance}
            </span>
          </div>

          {state.prize && (
            <p className="mb-3 rounded-xl bg-white/5 px-3 py-2 text-sm text-white/80">
              🎁 {t("markets_party.prize_won", { prize: state.prize })}
            </p>
          )}

          {state.me?.pityAvailable && (
            <div className="mk-pop-in mb-3 rounded-xl border border-star/40 bg-star/10 p-3 text-center">
              <p className="text-sm font-semibold text-white">😵 {t("markets_party.pity_title")}</p>
              <button
                type="button"
                className="gc-btn gc-btn-sm mt-2 bg-star font-black text-ink-900"
                onClick={handlePity}
              >
                🙏 {t("markets_party.pity_button", { amount: String(MARKET_PITY_LOAN) })}
              </button>
            </div>
          )}

          {state.status === "draft" && (
            <p className="mb-3 rounded-xl bg-white/5 p-3 text-sm text-white/70">
              {t("markets_play.not_live_note")}
            </p>
          )}

          <ul className="space-y-3">
            {ordered.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                myBalance={state.myBalance}
                myPosition={state.myPositions.find((p) => p.questionId === q.id)}
                now={now}
                onBet={handleBet}
                onBailout={handleBailout}
              />
            ))}
          </ul>

          <section className="mt-6">
            <h2 className="font-grotesk text-lg text-white">
              {t("markets_play.leaderboard_title")}
            </h2>
            <ol className="mt-2 space-y-1.5">
              {state.leaderboard.slice(0, 10).map((entry) => (
                <li
                  key={entry.player.id}
                  className={`gc-leaderboard-row ${entry.player.id === state.me?.id ? "ring-1 ring-star/60" : ""}`}
                >
                  <span className="w-6 shrink-0 text-right text-sm text-white/45">
                    {entry.rank === 1 ? "👑" : `#${entry.rank}`}
                  </span>
                  <span aria-hidden="true">{entry.player.avatar}</span>
                  <span className="min-w-0 flex-1 text-sm text-white">
                    <span className="block truncate">{entry.player.name}</span>
                    <TitleChips titles={entry.titles} />
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-white">
                    {entry.player.balance}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </main>
      )}

      {joined && state.status === "live" && <ReactionBar onReact={handleReact} />}
      <ReactionLayer reactions={joined ? state.reactions : null} />
      {reveal.current && (
        <RevealOverlay
          question={reveal.current}
          myPosition={state.myPositions.find((p) => p.questionId === reveal.current?.id)}
          onDone={reveal.dismiss}
        />
      )}
    </div>
  );
}
