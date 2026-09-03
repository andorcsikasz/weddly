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

import {
  estimatedPayout,
  MARKET_AVATARS,
  MARKET_MIN_STAKE,
  type MarketQuestion,
  type MarketSide,
} from "@shared/markets";
import { Coins, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Wordmark } from "../components/Wordmark";
import { ApiError } from "../lib/api";
import { marketsPlayApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import type { MarketPublicState } from "@shared/markets";

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

const STATE_POLL_MS = 5000;

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
  const payout = side ? estimatedPayout(question.pool, side, Math.min(stake, maxStake)) : 0;

  return (
    <div className="mt-3 rounded-xl bg-paper-100 p-3 dark:bg-umber-800/60">
      <div className="flex gap-2">
        <button
          type="button"
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            side === "yes"
              ? "border-sage-500 bg-sage-500 text-white"
              : "border-ink-900/15 text-ink-700 dark:border-umber-600 dark:text-umber-100"
          }`}
          onClick={() => setSide("yes")}
        >
          {t("markets_play.bet_yes")} · {question.probability}¢
        </button>
        <button
          type="button"
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${
            side === "no"
              ? "border-ink-900 bg-ink-900 text-white dark:border-paper-50 dark:bg-paper-50 dark:text-ink-900"
              : "border-ink-900/15 text-ink-700 dark:border-umber-600 dark:text-umber-100"
          }`}
          onClick={() => setSide("no")}
        >
          {t("markets_play.bet_no")} · {100 - question.probability}¢
        </button>
      </div>

      {side && (
        <div className="mt-3">
          <label
            htmlFor={`stake-${question.id}`}
            className="mb-1 block text-xs font-medium text-ink-600 dark:text-umber-200"
          >
            {t("markets_play.stake_label")}
          </label>
          <div className="flex items-center gap-2">
            <Coins size={16} className="text-ink-500 dark:text-umber-300" aria-hidden="true" />
            <input
              id={`stake-${question.id}`}
              type="range"
              min={MARKET_MIN_STAKE}
              max={maxStake || MARKET_MIN_STAKE}
              step={5}
              value={Math.min(stake, maxStake || MARKET_MIN_STAKE)}
              onChange={(e) => setStake(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-16 text-right text-sm font-semibold text-ink-900 dark:text-paper-50">
              {Math.min(stake, maxStake)}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between rounded-lg bg-paper-50 px-3 py-2 text-sm dark:bg-umber-900/60">
            <span className="text-ink-600 dark:text-umber-200">
              {t("markets_play.estimated_return_label")}
            </span>
            <span className="font-semibold text-ink-900 dark:text-paper-50">{payout} pts</span>
          </div>
          <p className="mt-1 text-xs text-ink-500 dark:text-umber-400">
            {t("markets_play.estimated_return_hint")}
          </p>
          <div className="mt-1 flex items-center justify-between text-xs text-ink-500 dark:text-umber-400">
            <span>{t("markets_play.profit_label")}</span>
            <span>{Math.max(0, payout - Math.min(stake, maxStake))} pts</span>
          </div>

          <button
            type="button"
            className="btn-primary btn-sm mt-3 w-full"
            disabled={busy || maxStake <= 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onBet(side, Math.min(stake, maxStake));
                setSide(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("markets_play.place_bet")}
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
  onBet,
}: {
  question: MarketQuestion;
  myBalance: number | null;
  myPosition: MarketPublicState["myPositions"][number] | undefined;
  onBet: (questionId: number, side: MarketSide, stake: number) => Promise<void>;
}) {
  const { t } = useT();

  return (
    <li className="rounded-2xl border border-ink-900/15 bg-paper-50 p-4 dark:border-umber-700 dark:bg-umber-900/40">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-ink-900 dark:text-paper-50">{question.prompt}</p>
        <span className="shrink-0 text-lg font-bold text-ink-900 dark:text-paper-50">
          {question.probability}%
        </span>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-paper-200 dark:bg-umber-800">
        <div
          className="h-full bg-sage-500 dark:bg-sage-400"
          style={{ width: `${question.probability}%` }}
        />
      </div>

      {myPosition && (
        <p className="mt-2 text-xs text-ink-600 dark:text-umber-200">
          {t("markets_play.your_position", {
            stake: String(myPosition.stake),
            side: t(`markets_play.bet_${myPosition.side}`),
          })}
        </p>
      )}

      {question.status === "closed" && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-umber-300">
          <Lock size={12} aria-hidden="true" /> {t("markets_play.closed_note")}
        </p>
      )}
      {question.status === "resolved" && question.outcome && (
        <p className="mt-2 text-xs font-medium text-ink-700 dark:text-umber-100">
          {t("markets_play.resolved_note", { outcome: t(`markets_play.bet_${question.outcome}`) })}
          {myPosition &&
            (myPosition.side === question.outcome
              ? myPosition.payout != null &&
                ` · ${t("markets_play.you_won", { payout: String(myPosition.payout) })}`
              : ` · ${t("markets_play.you_lost")}`)}
        </p>
      )}
      {question.status === "voided" && (
        <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
          {t("markets_play.voided_note")}
        </p>
      )}

      {question.status === "open" && myBalance !== null && !myPosition && (
        <BetControls
          question={question}
          balance={myBalance}
          onBet={(side, stake) => onBet(question.id, side, stake)}
        />
      )}
      {question.status === "open" && myPosition && (
        <p className="mt-2 text-xs text-ink-500 dark:text-umber-300">
          {t("markets_play.side_locked")}
        </p>
      )}
    </li>
  );
}

function JoinScreen({
  hostDisplayName,
  onJoin,
}: {
  hostDisplayName: string;
  onJoin: (name: string, avatar: string) => Promise<void>;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(MARKET_AVATARS[0] as string);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mx-auto max-w-sm px-4 py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500 dark:text-umber-300">
        {t("markets_play.join_kicker")}
      </p>
      {hostDisplayName && (
        <h1 className="mt-1 font-grotesk text-2xl text-ink-900 dark:text-paper-50">
          {t("markets_play.hosted_by", { name: hostDisplayName })}
        </h1>
      )}

      <label
        htmlFor="market-name"
        className="mt-6 mb-1 block text-left text-xs font-medium text-ink-600 dark:text-umber-200"
      >
        {t("markets_play.name_label")}
      </label>
      <input
        id="market-name"
        className="input w-full"
        placeholder={t("markets_play.name_placeholder")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
      />

      <p className="mt-4 mb-1 text-left text-xs font-medium text-ink-600 dark:text-umber-200">
        {t("markets_play.avatar_label")}
      </p>
      <div className="grid grid-cols-8 gap-1.5">
        {MARKET_AVATARS.map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={avatar === a}
            onClick={() => setAvatar(a)}
            className={`aspect-square rounded-lg text-lg transition-colors ${
              avatar === a ? "bg-sage-500" : "bg-paper-200 dark:bg-umber-800"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="btn-primary mt-6 w-full"
        disabled={!name.trim() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onJoin(name.trim(), avatar);
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

export default function PlayMarketsPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t } = useT();
  const [state, setState] = useState<MarketPublicState | null>(null);
  const [token, setToken] = useState<string | null>(() => readToken(code));
  const [notFound, setNotFound] = useState(false);
  const pollRef = useRef<number | null>(null);

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

  async function handleJoin(name: string, avatar: string) {
    const res = await marketsPlayApi.join(code, name, avatar, token);
    writeToken(code, res.token);
    setToken(res.token);
    setState(res.state);
  }

  async function handleBet(questionId: number, side: MarketSide, stake: number) {
    if (!token) return;
    const res = await marketsPlayApi.bet(code, token, questionId, side, stake);
    setState(res.state);
  }

  if (notFound) {
    return (
      <div className="mx-auto max-w-sm px-4 py-16 text-center">
        <h1 className="font-grotesk text-2xl text-ink-900 dark:text-paper-50">
          {t("markets_play.not_found_title")}
        </h1>
        <p className="mt-2 text-sm text-ink-600 dark:text-umber-200">
          {t("markets_play.not_found_body")}
        </p>
      </div>
    );
  }

  if (!state) return null;

  const joined = state.myBalance !== null;

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-ink-950">
      <header className="border-b border-ink-900/10 px-4 py-3 dark:border-umber-800">
        <Wordmark size="sm" />
      </header>

      {!joined ? (
        <JoinScreen hostDisplayName={state.hostDisplayName} onJoin={handleJoin} />
      ) : (
        <main className="mx-auto max-w-lg px-4 py-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-grotesk text-xl text-ink-900 dark:text-paper-50">
              {state.boardTitle}
            </h1>
            <span className="rounded-full bg-paper-200 px-3 py-1 text-sm font-semibold text-ink-900 dark:bg-umber-800 dark:text-paper-50">
              {t("markets_play.balance_label")}: {state.myBalance} pts
            </span>
          </div>

          {state.status === "draft" && (
            <p className="rounded-xl bg-paper-100 p-3 text-sm text-ink-600 dark:bg-umber-800 dark:text-umber-200">
              {t("markets_play.not_live_note")}
            </p>
          )}
          {state.status === "ended" && (
            <p className="rounded-xl bg-paper-100 p-3 text-sm text-ink-600 dark:bg-umber-800 dark:text-umber-200">
              {t("markets_play.ended_note")}
            </p>
          )}

          <ul className="space-y-3">
            {state.questions.map((q) => (
              <QuestionRow
                key={q.id}
                question={q}
                myBalance={state.myBalance}
                myPosition={state.myPositions.find((p) => p.questionId === q.id)}
                onBet={handleBet}
              />
            ))}
          </ul>

          <section className="mt-6">
            <h2 className="font-grotesk text-lg text-ink-900 dark:text-paper-50">
              {t("markets_play.leaderboard_title")}
            </h2>
            <ol className="mt-2 space-y-1.5">
              {state.leaderboard.slice(0, 10).map((entry) => (
                <li
                  key={entry.player.id}
                  className="flex items-center justify-between rounded-xl border border-ink-900/10 bg-paper-50 px-3 py-2 text-sm dark:border-umber-700 dark:bg-umber-900/40"
                >
                  <span className="flex items-center gap-2 text-ink-900 dark:text-paper-50">
                    <span className="text-ink-500 dark:text-umber-300">#{entry.rank}</span>
                    <span aria-hidden="true">{entry.player.avatar}</span>
                    {entry.player.name}
                  </span>
                  <span className="font-medium text-ink-900 dark:text-paper-50">
                    {entry.player.balance} pts
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </main>
      )}
    </div>
  );
}
