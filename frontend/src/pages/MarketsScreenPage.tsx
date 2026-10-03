// WeddlyMarket big screen — /play/markets/:code/screen, meant for the venue
// TV or projector. Public and read-only, like the guest page it sits beside:
// it polls the same `GET /api/play/markets/:code` a not-yet-joined phone
// does, so it can show nothing a guest couldn't already see, and it needs no
// login on a laptop somebody plugged into the venue HDMI.
//
// This is what turns private betting into a room event: live odds bars, the
// ticker of who just bet what, the team battle, reactions floating up, and the
// reveal and podium moments full-screen. Everything is sized to be read from
// across a dance floor.

import { isFlashQuestion, type MarketPublicState, type MarketQuestion } from "@shared/markets";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  BetTicker,
  FlashBadge,
  Podium,
  ReactionLayer,
  RevealOverlay,
  TitleChips,
  useNow,
  useRevealQueue,
} from "../components/markets/party";
import { ApiError } from "../lib/api";
import { marketsPlayApi } from "../lib/endpoints";
import { useT } from "../lib/i18n";
import "./games/GamesConsole.css";

const SCREEN_POLL_MS = 2500;
// Three bars plus the header fit a 1080p TV with no scrolling; a fourth
// pushes the last one below the fold, where nobody across a room will see it.
const MAX_BARS = 3;

function OddsBar({ question, now }: { question: MarketQuestion; now: number }) {
  const { t } = useT();
  const yes = question.probability;
  const total = question.pool.yes + question.pool.no;
  return (
    <div className={`gc-card mk-pop-in p-5 ${isFlashQuestion(question) ? "border-star/70" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-3xl font-bold leading-snug text-white">{question.prompt}</p>
        <FlashBadge question={question} now={now} big />
      </div>
      <div className="mt-4 flex h-16 overflow-hidden rounded-2xl text-2xl font-black">
        <div
          className="flex items-center bg-[#45e39e] px-4 text-ink-900 transition-[width] duration-700"
          style={{ width: `${Math.max(yes, 12)}%` }}
        >
          {t("markets_play.bet_yes")} {yes}%
        </div>
        <div className="flex flex-1 items-center justify-end bg-[#ff5c7a] px-4 text-white transition-[width] duration-700">
          {100 - yes}% {t("markets_play.bet_no")}
        </div>
      </div>
      <p className="mt-2 text-lg tabular-nums text-white/60">🪙 {total}</p>
    </div>
  );
}

export default function MarketsScreenPage() {
  const { code = "" } = useParams<{ code: string }>();
  const { t } = useT();
  const [state, setState] = useState<MarketPublicState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const now = useNow(1000);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const s = await marketsPlayApi.lookup(code, null);
        if (alive) {
          setState(s);
          setNotFound(false);
        }
      } catch (e) {
        if (alive && e instanceof ApiError && e.status === 404) setNotFound(true);
      }
    }
    void load();
    const id = window.setInterval(() => void load(), SCREEN_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [code]);

  const reveal = useRevealQueue(state?.questions ?? null, `weddly.market.screen.revealed.${code}`);

  if (notFound) {
    return (
      <div className="gc-page flex min-h-screen items-center justify-center" style={{ margin: 0 }}>
        <p className="text-4xl text-white">{t("markets_play.not_found_title")}</p>
      </div>
    );
  }
  if (!state) return null;

  const joinUrl = `${window.location.host}/play/markets/${code.toUpperCase()}`;
  const open = state.questions
    .filter((q) => q.status === "open" && q.closesAt > now)
    .sort(
      (a, b) => Number(isFlashQuestion(b)) - Number(isFlashQuestion(a)) || a.closesAt - b.closesAt,
    )
    .slice(0, MAX_BARS);
  const [bride, groom] = state.teams;
  const teamTotal = (bride?.balance ?? 0) + (groom?.balance ?? 0);
  const showTeams = (bride?.players ?? 0) + (groom?.players ?? 0) > 0;

  return (
    <div className="gc-page min-h-screen overflow-hidden p-8" style={{ margin: 0 }}>
      <header className="mb-6 flex items-center justify-between gap-8">
        <div>
          <p className="text-xl font-black uppercase tracking-[0.25em] text-star">WeddlyMarket</p>
          {/* The couple, not the board title: a board is created titled after
              the game itself, which put "WeddlyMarket" under "WeddlyMarket". */}
          <h1 className="font-grotesk text-5xl text-white">
            {state.hostDisplayName || state.boardTitle}
          </h1>
          {state.prize && (
            <p className="mt-2 text-2xl text-white/80">
              🎁 {t("markets_party.prize_won", { prize: state.prize })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-5 rounded-3xl bg-white/5 p-4">
          <img
            src={marketsPlayApi.qrUrl(code)}
            alt={t("markets_party.screen_scan")}
            className="h-36 w-36 rounded-xl bg-white p-2"
          />
          <div>
            <p className="text-2xl font-bold text-white">{t("markets_party.screen_scan")}</p>
            <p className="text-lg text-white/60">{t("markets_party.screen_or")}</p>
            <p className="text-2xl font-semibold text-white">{joinUrl}</p>
            <p className="mt-1 font-mono text-5xl font-black tracking-[0.2em] text-star">
              {code.toUpperCase()}
            </p>
          </div>
        </div>
      </header>

      {state.status === "ended" ? (
        <div className="mt-6">
          <Podium leaderboard={state.leaderboard} prize={state.prize} big />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-8">
          <section className="col-span-2 space-y-5">
            {open.length === 0 ? (
              <p className="gc-card p-10 text-center text-3xl text-white/60">
                {t("markets_party.screen_no_open")}
              </p>
            ) : (
              open.map((q) => <OddsBar key={q.id} question={q} now={now} />)
            )}
          </section>

          <aside className="space-y-6">
            <section className="gc-card p-5">
              <h2 className="mb-3 text-2xl font-black text-white">
                {t("markets_play.leaderboard_title")}
              </h2>
              <ol className="space-y-2">
                {state.leaderboard.slice(0, 7).map((e) => (
                  <li key={e.player.id} className="flex items-center gap-3 text-2xl text-white">
                    <span className="w-9 text-right text-white/50">
                      {e.rank === 1 ? "👑" : e.rank}
                    </span>
                    <span aria-hidden>{e.player.avatar}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.player.name}</span>
                      <TitleChips titles={e.titles} />
                    </span>
                    <span className="font-black tabular-nums">{e.player.balance}</span>
                  </li>
                ))}
              </ol>
            </section>

            {showTeams && bride && groom && (
              <section className="gc-card p-5">
                <h2 className="mb-3 text-2xl font-black text-white">
                  {t("markets_party.teams_title")}
                </h2>
                <div className="flex h-12 overflow-hidden rounded-xl text-lg font-black">
                  <div
                    className="flex items-center bg-blush-300 px-3 text-ink-900 transition-[width] duration-700"
                    style={{
                      width: `${teamTotal > 0 ? Math.max(15, (bride.balance / teamTotal) * 100) : 50}%`,
                    }}
                  >
                    👰 {bride.balance}
                  </div>
                  <div className="flex flex-1 items-center justify-end bg-steel-300 px-3 text-ink-900">
                    {groom.balance} 🤵
                  </div>
                </div>
                <div className="mt-2 flex justify-between text-base text-white/60">
                  <span>
                    {t("markets_party.team_bride")} ·{" "}
                    {t("markets_party.team_players", { count: String(bride.players) })}
                  </span>
                  <span>
                    {t("markets_party.team_groom")} ·{" "}
                    {t("markets_party.team_players", { count: String(groom.players) })}
                  </span>
                </div>
              </section>
            )}

            <section className="gc-card p-5">
              <h2 className="mb-3 text-2xl font-black text-white">
                {t("markets_party.ticker_title")}
              </h2>
              <BetTicker bets={state.recentBets} big limit={6} />
            </section>
          </aside>
        </div>
      )}

      <ReactionLayer reactions={state.reactions} big />
      {reveal.current && <RevealOverlay question={reveal.current} big onDone={reveal.dismiss} />}
    </div>
  );
}
