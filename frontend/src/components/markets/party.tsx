// WeddlyMarket party-mode building blocks, shared by the guest phone screen
// (PlayMarketsPage) and the venue big screen (MarketsScreenPage): the reveal
// moment, floating reactions, the bet ticker, the final podium, flash
// countdowns and leaderboard award chips.
//
// Everything here is driven by the same polled `MarketPublicState`. Nothing is
// pushed, so "new" is always decided client-side against what this screen has
// already seen: the first poll marks the world as seen, and only what changes
// after that animates. A screen opened mid-party therefore never replays the
// whole night's reveals or a minute of old reactions.

import {
  isFlashQuestion,
  type MarketBetEvent,
  type MarketLeaderboardEntry,
  type MarketQuestion,
  type MarketReaction,
  type MarketTitle,
  type MyMarketPosition,
} from "@shared/markets";
import { Crown, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fireConfetti } from "../../lib/confetti";
import { useT } from "../../lib/i18n";
import { playSound } from "../../lib/market_sfx";
import "./party.css";

const CONFETTI = ["#FFD000", "#2f9c52", "#d35d42", "#ffffff", "#7cc4ff"];

// ─── clocks ─────────────────────────────────────────────────────────────────────

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The FLASH badge with a live countdown; renders nothing for an ordinary
 *  question, or once the window has passed. */
export function FlashBadge({
  question,
  now,
  big = false,
}: {
  question: MarketQuestion;
  now: number;
  big?: boolean;
}) {
  const { t } = useT();
  if (question.status !== "open" || !isFlashQuestion(question)) return null;
  const left = question.closesAt - now;
  if (left <= 0) return null;
  return (
    <span
      className={`mk-flash inline-flex items-center gap-1 rounded-full bg-star font-black uppercase tracking-wide text-ink-900 ${
        big ? "px-4 py-1.5 text-2xl" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      <Zap size={big ? 22 : 12} aria-hidden strokeWidth={2.5} />
      {t("markets_party.flash")} {formatCountdown(left)}
    </span>
  );
}

// ─── "what's new since this screen last looked" ─────────────────────────────────

/** Ids this screen has seen. The first call to `diff` seeds the set and
 *  reports nothing, which is what keeps a late-opened screen quiet. */
function useSeen<T>(items: readonly T[] | null, key: (item: T) => number): T[] {
  const seen = useRef<Set<number> | null>(null);
  const [fresh, setFresh] = useState<T[]>([]);
  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map(key));
      return;
    }
    const set = seen.current;
    const added = items.filter((i) => !set.has(key(i)));
    if (added.length === 0) return;
    for (const a of added) set.add(key(a));
    setFresh(added);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  return fresh;
}

/** How far back a just-opened screen still plays a reveal it missed. A phone
 *  that slept through the moment in a pocket should still get its drumroll
 *  when it wakes; a screen opened an hour later should not replay the night. */
const REVEAL_CATCHUP_MS = 2 * 60 * 1000;

function readSeenIds(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

function writeSeenIds(key: string, ids: Set<number>): void {
  try {
    // Only the newest few matter: a board has tens of questions, not thousands.
    localStorage.setItem(key, JSON.stringify([...ids].slice(-200)));
  } catch {
    // best-effort; worst case a reveal replays once
  }
}

/** Resolved questions this device hasn't been shown yet, one at a time.
 *  "Shown" is remembered per device under `storageKey`, and on first load
 *  anything resolved within `REVEAL_CATCHUP_MS` that isn't remembered still
 *  plays, so neither a reload nor a sleeping phone loses the moment, and
 *  neither replays one already seen. `dismiss` moves to the next. */
export function useRevealQueue(questions: readonly MarketQuestion[] | null, storageKey: string) {
  const seen = useRef<Set<number> | null>(null);
  const [queue, setQueue] = useState<MarketQuestion[]>([]);

  useEffect(() => {
    if (!questions) return;
    const resolved = questions.filter((q) => q.status === "resolved");
    if (seen.current === null) {
      const stored = readSeenIds(storageKey);
      const cutoff = Date.now() - REVEAL_CATCHUP_MS;
      for (const q of resolved) {
        if ((q.resolvedAt ?? 0) < cutoff) stored.add(q.id);
      }
      seen.current = stored;
    }
    const set = seen.current;
    const fresh = resolved.filter((q) => !set.has(q.id));
    if (fresh.length === 0) return;
    for (const q of fresh) set.add(q.id);
    writeSeenIds(storageKey, set);
    setQueue((prev) => [...prev, ...fresh]);
  }, [questions, storageKey]);

  return { current: queue[0] ?? null, dismiss: () => setQueue((q) => q.slice(1)) };
}

/** Open questions that appeared after this screen started watching. */
export function useNewQuestions(questions: readonly MarketQuestion[] | null): MarketQuestion[] {
  const open = questions ? questions.filter((q) => q.status === "open") : null;
  return useSeen(open, (q) => q.id);
}

// ─── reveal ─────────────────────────────────────────────────────────────────────

const DRUMROLL_MS = 1300;
const REVEAL_HOLD_MS = 6500;

/** Drumroll, then the outcome slams in with the night's numbers. On a phone
 *  it also says how YOU did; on the big screen it is the room's moment. Taps
 *  anywhere to close, and closes itself after a few seconds either way. */
export function RevealOverlay({
  question,
  myPosition,
  big = false,
  onDone,
}: {
  question: MarketQuestion;
  myPosition?: MyMarketPosition;
  big?: boolean;
  onDone: () => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<"drum" | "slam">("drum");
  const outcome = question.outcome ?? "no";
  const won = myPosition ? myPosition.side === outcome : null;

  useEffect(() => {
    playSound("reveal");
    const slam = window.setTimeout(() => {
      setPhase("slam");
      if (won === false) playSound("lose");
      else {
        playSound("win");
        fireConfetti(undefined, { colors: CONFETTI, count: big ? 160 : 70 });
      }
    }, DRUMROLL_MS);
    const done = window.setTimeout(onDone, DRUMROLL_MS + REVEAL_HOLD_MS);
    return () => {
      window.clearTimeout(slam);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const s = question.settlement;
  return (
    <button
      type="button"
      onClick={onDone}
      aria-label={t("markets_party.tap_to_close")}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-ink-950/90 px-6 text-center backdrop-blur-sm"
    >
      <p className={`max-w-3xl font-semibold text-white/80 ${big ? "text-4xl" : "text-lg"}`}>
        {question.prompt}
      </p>
      {phase === "drum" ? (
        <p className={`font-black text-white ${big ? "text-7xl" : "text-4xl"}`}>
          <span className="mk-drum" aria-hidden>
            🥁
          </span>{" "}
          {t("markets_party.drumroll")}
        </p>
      ) : (
        <>
          <p
            className={`mk-slam font-black tracking-tight ${
              outcome === "yes" ? "text-sage-400" : "text-blush-400"
            } ${big ? "text-[12rem] leading-none" : "text-8xl"}`}
          >
            {t(outcome === "yes" ? "markets_party.reveal_yes" : "markets_party.reveal_no")}
          </p>
          <div className={`mk-pop-in space-y-1 text-white ${big ? "text-3xl" : "text-base"}`}>
            {s ? (
              <>
                <p>{t("markets_party.reveal_winners", { count: String(s.winnerCount) })}</p>
                {s.biggestWinner && (
                  <p className="font-bold text-star">
                    {s.biggestWinner.avatar}{" "}
                    {t("markets_party.reveal_biggest", {
                      name: s.biggestWinner.name,
                      profit: String(s.biggestWinner.profit),
                    })}
                  </p>
                )}
              </>
            ) : (
              <p>{t("markets_party.reveal_nobody")}</p>
            )}
            {myPosition && (
              <p className={`pt-2 text-xl font-black ${won ? "text-sage-300" : "text-blush-300"}`}>
                {won
                  ? t("markets_party.reveal_you_won", { payout: String(myPosition.payout ?? 0) })
                  : t("markets_party.reveal_you_lost", { stake: String(myPosition.stake) })}
              </p>
            )}
          </div>
          <p className="mt-4 text-xs text-white/50">{t("markets_party.tap_to_close")}</p>
        </>
      )}
    </button>
  );
}

// ─── reactions ──────────────────────────────────────────────────────────────────

/** Floats every reaction this screen hasn't shown yet from the bottom edge.
 *  The x position is derived from the id, so the same reaction lands in the
 *  same lane on every screen in the room. */
export function ReactionLayer({
  reactions,
  big = false,
}: {
  reactions: readonly MarketReaction[] | null;
  big?: boolean;
}) {
  const fresh = useSeen(reactions, (r) => r.id);
  const [live, setLive] = useState<MarketReaction[]>([]);
  useEffect(() => {
    if (!fresh.length) return;
    setLive((l) => [...l, ...fresh].slice(-40));
    const ids = new Set(fresh.map((r) => r.id));
    const id = window.setTimeout(() => setLive((l) => l.filter((r) => !ids.has(r.id))), 3400);
    return () => window.clearTimeout(id);
  }, [fresh]);

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden>
      {live.map((r, i) => (
        <span
          key={r.id}
          className={`mk-reaction ${big ? "text-7xl" : "text-4xl"}`}
          style={{ left: `${8 + ((r.id * 37) % 84)}%`, animationDelay: `${(i % 4) * 90}ms` }}
        >
          {r.emoji}
          {big && (
            <span className="ml-1 align-middle text-lg font-semibold text-white/80">{r.name}</span>
          )}
        </span>
      ))}
    </div>
  );
}

// ─── ticker ─────────────────────────────────────────────────────────────────────

export function BetTicker({
  bets,
  big = false,
  limit = 6,
}: {
  bets: readonly MarketBetEvent[];
  big?: boolean;
  limit?: number;
}) {
  const { t } = useT();
  if (bets.length === 0) {
    return (
      <p className={`${big ? "text-xl" : "text-sm"} text-white/50`}>
        {t("markets_party.ticker_empty")}
      </p>
    );
  }
  return (
    <ul className={`space-y-1.5 ${big ? "text-xl" : "text-sm"}`}>
      {bets.slice(0, limit).map((b) => (
        <li key={b.id} className="mk-pop-in flex items-center gap-2 text-white/85">
          <span aria-hidden>{b.avatar}</span>
          <span className="truncate">
            {t("markets_party.ticker_bet", {
              name: b.name,
              stake: String(b.stake),
              side: t(b.side === "yes" ? "markets_play.bet_yes" : "markets_play.bet_no"),
            })}
          </span>
          <span
            className={`ml-auto h-2 w-2 shrink-0 rounded-full ${
              b.side === "yes" ? "bg-sage-400" : "bg-blush-400"
            }`}
            aria-hidden
          />
        </li>
      ))}
    </ul>
  );
}

// ─── awards ─────────────────────────────────────────────────────────────────────

const TITLE_EMOJI: Record<MarketTitle, string> = {
  prophet: "🔮",
  degenerate: "🎰",
  oracle: "🦉",
  bailout_king: "🪂",
  rock_bottom: "🪨",
};

export function TitleChips({
  titles,
  big = false,
}: { titles: readonly MarketTitle[]; big?: boolean }) {
  const { t } = useT();
  if (titles.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {titles.map((title) => (
        <span
          key={title}
          title={t(`markets_party.title_${title}_hint`)}
          className={`rounded-full bg-white/10 font-semibold text-white/85 ${
            big ? "px-2.5 py-0.5 text-base" : "px-1.5 py-0.5 text-[10px]"
          }`}
        >
          {TITLE_EMOJI[title]} {t(`markets_party.title_${title}`)}
        </span>
      ))}
    </span>
  );
}

// ─── podium ─────────────────────────────────────────────────────────────────────

const STEP_ORDER = [1, 0, 2]; // silver, gold, bronze, left to right
const STEP_HEIGHT = ["h-40", "h-28", "h-20"];

/** The end of the night: top three on steps, every award underneath, and the
 *  couple's prize if they named one. Screenshot-friendly on purpose, since
 *  that is how it gets shared. */
export function Podium({
  leaderboard,
  prize,
  big = false,
}: {
  leaderboard: readonly MarketLeaderboardEntry[];
  prize: string | null;
  big?: boolean;
}) {
  const { t } = useT();
  const top = leaderboard.slice(0, 3);
  const awarded = leaderboard.filter((e) => e.titles.length > 0);

  useEffect(() => {
    if (top.length) fireConfetti(undefined, { colors: CONFETTI, count: big ? 200 : 90 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl text-center text-white">
      <p
        className={`font-black uppercase tracking-wide text-star ${big ? "text-5xl" : "text-2xl"}`}
      >
        {t("markets_party.podium_title")}
      </p>
      {prize && (
        <p className={`mt-2 text-white/80 ${big ? "text-2xl" : "text-sm"}`}>
          🎁 {t("markets_party.prize_won", { prize })}
        </p>
      )}
      <div className="mt-8 flex items-end justify-center gap-3">
        {STEP_ORDER.map((idx) => {
          const entry = top[idx];
          if (!entry) return <div key={idx} className="w-1/4" />;
          return (
            <div key={idx} className="flex w-1/3 max-w-[12rem] flex-col items-center">
              {idx === 0 && <Crown className="mb-1 text-star" size={big ? 48 : 28} aria-hidden />}
              <span className={big ? "text-7xl" : "text-4xl"} aria-hidden>
                {entry.player.avatar}
              </span>
              <span className={`mt-1 w-full truncate font-bold ${big ? "text-2xl" : "text-sm"}`}>
                {entry.player.name}
              </span>
              <span className={`tabular-nums text-white/70 ${big ? "text-xl" : "text-xs"}`}>
                {entry.player.balance} pts
              </span>
              <div
                className={`mk-podium-step mt-2 flex w-full items-start justify-center rounded-t-xl pt-2 font-black ${
                  STEP_HEIGHT[idx]
                } ${idx === 0 ? "bg-star text-ink-900" : "bg-white/15"} ${big ? "text-5xl" : "text-2xl"}`}
                style={{ animationDelay: `${(2 - idx) * 180}ms` }}
              >
                {idx + 1}
              </div>
            </div>
          );
        })}
      </div>
      {awarded.length > 0 && (
        <ul className={`mt-6 space-y-1.5 ${big ? "text-xl" : "text-sm"}`}>
          {awarded.map((e) => (
            <li key={e.player.id} className="flex items-center justify-center gap-2">
              <span aria-hidden>{e.player.avatar}</span>
              <span className="font-semibold">{e.player.name}</span>
              <TitleChips titles={e.titles} big={big} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
