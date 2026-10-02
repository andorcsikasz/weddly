/**
 * Every pixel of DOM in the runner: the menu, the live HUD, the pause sheet and
 * the game-over card.
 *
 * THE UI NEVER TOUCHES THE ENGINE. It reads the store snapshot and calls four
 * intents (`start`, `pause`, `resume`, `quit`), so the game is fully playable
 * with this component replaced by a test double, and so nothing here can move a
 * lane or score a pickup. Every figure comes out of `RunnerHud`, which is derived
 * in ONE place per tick — that is what makes the live HUD and the game-over card
 * incapable of disagreeing about the profit.
 *
 * THE ONE PLACE MONEY IS RENDERED IS `Money`, below. It takes a number and the
 * couple's currency and calls `formatMoney`. There is deliberately no symbol
 * concatenated here and no `formatHuf`: the currency is the workspace's, it is
 * one of twelve, and a component that built "Ft " + n by hand would be right in
 * exactly one of them.
 */

import {
  AlertTriangle,
  ArrowLeft,
  Coins,
  Flame,
  Heart,
  Magnet,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Trophy,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { OBSTACLE_COST, VERDICT_I18N, isStreakStep, streakBonus } from "@shared/runner";
import type { RunnerCharacter } from "../engine/RunEngine";
import type { Currency } from "@shared/types";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useRunnerStore } from "../store/runnerStore";
import type { RunnerHud } from "../store/runnerStore";
import { runDistance } from "../utils/format";

/** A money figure, in the couple's own currency. The only money renderer. */
function Money({ amount, currency }: { amount: number; currency: Currency }) {
  const locale = useT().locale;
  return <>{formatMoney(amount, currency, locale)}</>;
}

/* ── Character picker ───────────────────────────────────────────────────── */

/**
 * Bride or groom, chosen before the run rather than buried in settings.
 *
 * Two tiles, not a dropdown: the choice is the first thing the game asks, it has
 * exactly two answers, and the partner figure in the scene is DERIVED from it as
 * "the one you are not". A dropdown would hide that relationship behind a caret.
 *
 * The marks are drawn SVGs rather than emoji for the same reason the vendor portal
 * has no emoji: an emoji is a typeface picked by the OS, so it renders at a
 * different weight on every platform and cannot take the tile's selected colour —
 * which here is the ONLY thing that marks the selection besides the ring. Two
 * tiny silhouettes are also a truer preview than a word, since what changes is who
 * you see running.
 *
 * Selecting writes to the store AND to the engine, so the idle runner visible
 * behind the menu changes with the choice: the player sees the answer before they
 * press Start.
 */
function CharacterPicker() {
  const { t } = useT();
  const character = useRunnerStore((s) => s.character);
  const setCharacter = useRunnerStore((s) => s.setCharacter);
  // The picker writes ONLY to the store. Telling the engine is the page's job —
  // the engine is not in the store, so this component has no business reaching
  // into it, and the page mirrors the change into the rig in one effect.
  return (
    <section className="rn-block">
      <h2 className="rn-block-title">{t("runner.choose_title")}</h2>
      <div className="rn-choices" role="radiogroup" aria-label={t("runner.choose_title")}>
        {(["bride", "groom"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={character === id}
            className={`rn-choice${character === id ? " rn-choice--on" : ""}`}
            onClick={() => setCharacter(id)}
          >
            <CharacterMark kind={id} />
            <span className="rn-choice-label">{t(`runner.play_as_${id}`)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The two silhouettes. `currentColor` throughout, so the selected tile's own
 *  colour IS the mark — there is no second palette to keep in step. */
function CharacterMark({ kind }: { kind: RunnerCharacter }) {
  if (kind === "groom") {
    return (
      <svg viewBox="0 0 24 32" width="26" height="34" aria-hidden focusable="false">
        <circle cx="12" cy="5" r="3.4" />
        {/* Shoulders and lapels. */}
        <path d="M12 9.4 6.2 12.2 7.6 22h8.8l1.4-9.8Z" />
        {/* Trousers. */}
        <path d="M8.2 22h7.6l-.7 8.4H10.8L12 25l-1.2 5.4H8.9Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 32" width="26" height="34" aria-hidden focusable="false">
      <circle cx="12" cy="5" r="3.4" />
      {/* The bun, which is what makes the silhouette read at this size. */}
      <circle cx="15.4" cy="2.6" r="1.9" />
      {/* Bodice, then the skirt widening to the hem. */}
      <path d="M12 9.4 8.4 13.4h7.2Z" />
      <path d="M8.4 13.4h7.2l3.2 17.2H5.2Z" />
    </svg>
  );
}

/* ── Menu ──────────────────────────────────────────────────────────────── */

export interface RunnerUIProps {
  onStart: () => void;
  /** The HUD's pause button. A phone has no Escape key, so without it a touch
   *  player had no way to stop a run. */
  onPause: () => void;
  onResume: () => void;
  onQuit: () => void;
  onToggleMute: () => void;
  /** Whether the audio is muted RIGHT NOW. Read from the audio object by the page
   *  and passed down, rather than kept as a second copy inside the button: a local
   *  flag can disagree with the thing it describes the moment anything else mutes
   *  the audio, and a speaker button that says "sound on" over silent audio is the
   *  one control a player cannot learn to trust. It stays a plain prop rather than
   *  store state, so a tap is still not a 12 Hz render. */
  muted: boolean;
}

/** The three power-ups, in one table, so the menu legend and the HUD timers
 *  cannot name them differently. */
const POWERS: readonly {
  id: "magnet" | "doubler" | "shield";
  icon: LucideIcon;
  name: string;
  body: string;
}[] = [
  { id: "magnet", icon: Magnet, name: "runner.power_magnet", body: "runner.power_magnet_body" },
  { id: "doubler", icon: Coins, name: "runner.power_double", body: "runner.power_double_body" },
  { id: "shield", icon: Shield, name: "runner.power_shield", body: "runner.power_shield_body" },
];

export function RunnerUI({
  onStart,
  onPause,
  onResume,
  onQuit,
  onToggleMute,
  muted,
}: RunnerUIProps) {
  const { t } = useT();
  const phase = useRunnerStore((s) => s.phase);
  const ready = useRunnerStore((s) => s.ready);
  const touch = useRunnerStore((s) => s.touch);
  const best = useRunnerStore((s) => s.best);
  const currency = useRunnerStore((s) => s.currency);

  if (!ready) {
    return (
      <div className="rn-overlay rn-overlay--solid">
        <div className="rn-loader" aria-hidden />
        <p className="rn-waiting">{t("runner.preparing")}</p>
      </div>
    );
  }

  if (phase === "menu") {
    // ONE screen, no scroll: title, record, who you are, Start. The power-ups are
    // a row of icons (the sentence lives in the tooltip) and the controls are one
    // line, because a menu the player has to read is a menu between them and
    // the game.
    return (
      <div className="rn-overlay rn-overlay--menu">
        <div className="rn-card rn-card--menu">
          <p className="rn-eyebrow">Wēddly Games</p>
          <h1 className="rn-title rn-title--hero">{t("runner.title")}</h1>
          <p className="rn-subtitle">{t("runner.subtitle")}</p>

          {best !== null && best > 0 ? (
            <p className="rn-bestchip">
              <Trophy size={14} strokeWidth={1.75} aria-hidden />
              <Money amount={best} currency={currency} />
            </p>
          ) : null}

          <CharacterPicker />

          <button
            type="button"
            className="rn-btn rn-btn--primary rn-btn--big"
            onClick={onStart}
            autoFocus
          >
            <Play size={18} strokeWidth={2} aria-hidden fill="currentColor" />
            {t("runner.start")}
          </button>

          <ul className="rn-powers" aria-label={t("runner.power_title")}>
            {POWERS.map((p) => (
              <li key={p.id} className={`rn-power rn-power--${p.id}`} title={t(p.body)}>
                <p.icon size={15} strokeWidth={1.75} aria-hidden />
                <span>{t(p.name)}</span>
              </li>
            ))}
          </ul>

          <p className="rn-hint">
            {touch ? (
              t("runner.touch_controls")
            ) : (
              <>
                <kbd>←</kbd>
                <kbd>→</kbd> {t("runner.control_left")} / {t("runner.control_right")}
                <span className="rn-hint-dot" aria-hidden />
                <kbd>↑</kbd> {t("runner.control_jump")}
                <span className="rn-hint-dot" aria-hidden />
                <kbd>↓</kbd> {t("runner.control_slide")}
              </>
            )}
          </p>

          {/* The route is full screen over the app shell, so the menu carries
              its own way back. */}
          <Link to="/app/games" className="rn-backlink">
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden />
            {t("runner.back_to_games")}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "paused") {
    return (
      <div className="rn-overlay rn-overlay--scrim">
        <div className="rn-card rn-card--slim rn-pop">
          <h2 className="rn-title rn-title--sm">{t("runner.paused_title")}</h2>
          <button type="button" className="rn-btn rn-btn--primary" onClick={onResume} autoFocus>
            <Play size={16} strokeWidth={2} aria-hidden fill="currentColor" />
            {t("runner.resume")}
          </button>
          <button type="button" className="rn-btn rn-btn--ghost" onClick={onQuit}>
            {t("runner.quit")}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "over") {
    return <GameOver onStart={onStart} />;
  }

  return <Hud muted={muted} onToggleMute={onToggleMute} onPause={onPause} />;
}

/* ── The live HUD ──────────────────────────────────────────────────────── */

/** A value that changed since the last render, as a key that bumps when it does —
 *  the cheapest way to replay a CSS animation on a 12 Hz tick. */
function useBumpKey(value: number): number {
  const prev = useRef(value);
  const key = useRef(0);
  if (value !== prev.current) {
    if (value > prev.current) key.current += 1;
    prev.current = value;
  }
  return key.current;
}

/** The money feedback, in the CORNER rather than on the track: every change in
 *  the profit inside one short window is summed into a single "+x" chip under
 *  the counter, so a swept row of coins reads as one growing number instead of a
 *  stack of labels over the lane the player is reading. A drop (a hit's bill)
 *  starts a fresh chip in red. */
function useGainChip(profit: number): { amount: number; key: number } | null {
  const prev = useRef(profit);
  const [chip, setChip] = useState<{ amount: number; key: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const delta = profit - prev.current;
    prev.current = profit;
    // Losses belong to the hit toast, which can say WHAT cost the money.
    if (delta <= 0) {
      if (delta < 0) setChip(null);
      return;
    }
    setChip((c) => (c ? { amount: c.amount + delta, key: c.key + 1 } : { amount: delta, key: 1 }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setChip(null), 900);
  }, [profit]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return chip;
}

/** A banner that appears when `trigger` rises, and stays for `ms`. Seeded with the
 *  CURRENT value, so remounting the HUD after a pause does not replay the last
 *  milestone over a run that is simply resuming. */
function useRiseBanner(trigger: number, ms: number): number | null {
  const prev = useRef(trigger);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (trigger > prev.current) {
      setShown(trigger);
      const id = window.setTimeout(() => setShown(null), ms);
      prev.current = trigger;
      return () => window.clearTimeout(id);
    }
    prev.current = trigger;
    return undefined;
  }, [trigger, ms]);
  return shown;
}

function Hud(props: { muted: boolean; onToggleMute: () => void; onPause: () => void }) {
  const { t, locale } = useT();
  const profit = useRunnerStore((s) => s.profit);
  const hearts = useRunnerStore((s) => s.hearts);
  const hits = useRunnerStore((s) => s.hits);
  const distance = useRunnerStore((s) => s.distance);
  const multiplier = useRunnerStore((s) => s.multiplier);
  const currency = useRunnerStore((s) => s.currency);
  const combo = useRunnerStore((s) => s.combo);
  const comboLeft = useRunnerStore((s) => s.comboLeft);
  const magnet = useRunnerStore((s) => s.magnet);
  const doubler = useRunnerStore((s) => s.doubler);
  const shield = useRunnerStore((s) => s.shield);
  const countdown = useRunnerStore((s) => s.countdown);
  const lastHit = useRunnerStore((s) => s.lastHit);
  const speedT = useRunnerStore((s) => s.speedT);
  const toNext = useRunnerStore((s) => s.toNext);
  const nextMultiplier = useRunnerStore((s) => s.nextMultiplier);

  const profitKey = useBumpKey(profit);
  const gain = useGainChip(profit);
  const hitKey = useBumpKey(hits);
  const milestone = useRiseBanner(multiplier, 1600);
  // A streak banner fires on the exact counts the engine pays a bonus for.
  const streakStep = isStreakStep(combo) ? combo : 0;
  const streak = useRiseBanner(streakStep, 1500);
  const timers = { magnet, doubler, shield };

  return (
    <>
      <div className="rn-speedlines" style={{ opacity: speedT * 0.75 }} aria-hidden />
      {hitKey > 0 ? <div key={`hit-${hitKey}`} className="rn-hitflash" aria-hidden /> : null}

      <div className="rn-hud" aria-live="off">
        <div className="rn-hud-row">
          <div className="rn-stat rn-stat--lead">
            <span className="rn-stat-label">{t("runner.profit_label")}</span>
            <span key={profitKey} className={`rn-stat-value${profitKey > 0 ? " rn-bump" : ""}`}>
              <Money amount={profit} currency={currency} />
            </span>
            {gain ? (
              <span
                key={gain.key}
                className={`rn-gain${gain.amount < 0 ? " rn-gain--loss" : ""}`}
                aria-hidden
              >
                {gain.amount < 0 ? "−" : "+"}
                <Money amount={Math.abs(gain.amount)} currency={currency} />
              </span>
            ) : null}
          </div>
          <div className="rn-stat">
            <span className="rn-stat-label">{t("runner.distance_label")}</span>
            <span className="rn-stat-value">{runDistance(distance, locale)}</span>
          </div>
          <MultiplierRing
            multiplier={multiplier}
            progress={toNext}
            next={nextMultiplier}
            label={t("runner.multiplier_label")}
          />
          <div className="rn-hud-right">
            <HeartRow hearts={hearts} />
            <MuteButton muted={props.muted} onToggle={props.onToggleMute} />
            <button
              type="button"
              className="rn-iconbtn"
              onClick={props.onPause}
              aria-label={t("runner.control_pause")}
            >
              <Pause size={18} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
        </div>

        <div className="rn-hud-sub">
          {combo >= 3 ? (
            <div className={`rn-combo${combo >= 25 ? " rn-combo--hot" : ""}`}>
              <Flame size={16} strokeWidth={1.75} aria-hidden />
              <span className="rn-combo-count">{combo}</span>
              <span className="rn-combo-label">{t("runner.streak_label")}</span>
              <span className="rn-combo-bar" style={{ transform: `scaleX(${comboLeft})` }} />
            </div>
          ) : null}
          {POWERS.filter((p) => timers[p.id] > 0).map((p) => (
            <div
              key={p.id}
              className={`rn-timer rn-timer--${p.id}${timers[p.id] < 0.2 ? " rn-timer--ending" : ""}`}
            >
              <p.icon size={16} strokeWidth={1.75} aria-hidden />
              <span className="rn-timer-name">{t(p.name)}</span>
              <span className="rn-timer-bar" style={{ transform: `scaleX(${timers[p.id]})` }} />
            </div>
          ))}
        </div>
      </div>

      <HitToast hit={lastHit} currency={currency} />

      {countdown > 0 ? (
        <div className="rn-center" aria-live="assertive">
          <span key={countdown} className="rn-count">
            {countdown}
          </span>
        </div>
      ) : null}
      <GoFlash countdown={countdown} label={t("runner.go")} />

      {milestone !== null ? (
        <div className="rn-center rn-center--high" aria-live="polite">
          <span key={`m-${milestone}`} className="rn-banner">
            {t("runner.milestone_banner", { n: milestone })}
          </span>
        </div>
      ) : streak !== null ? (
        <div className="rn-center rn-center--high" aria-live="polite">
          <span key={`s-${streak}`} className="rn-banner rn-banner--streak">
            <Flame size={22} strokeWidth={2} aria-hidden />
            {t("runner.streak_banner", { count: streak })}
            <span className="rn-banner-amount">
              +<Money amount={streakBonus(streak, currency) * multiplier} currency={currency} />
            </span>
          </span>
        </div>
      ) : null}
    </>
  );
}

/** What just happened and what it cost: "Cakes & desserts −120 000 Ft". The
 *  vendor name is the directory's own category label, so it is translated
 *  wherever the directory is. Seeded with the current hit so a resume does not
 *  replay it; each new hit replaces the last one. */
function HitToast({ hit, currency }: { hit: RunnerHud["lastHit"]; currency: Currency }) {
  const { t } = useT();
  const shown = useRiseBanner(hit?.n ?? 0, 2200);
  if (shown === null || !hit || hit.n !== shown) return null;
  return (
    <div className="rn-toast-wrap" role="alert">
      <div key={hit.n} className="rn-toast">
        <span className="rn-toast-icon" aria-hidden>
          <AlertTriangle size={18} strokeWidth={2} />
        </span>
        <span className="rn-toast-text">
          <span className="rn-toast-title">
            {t(`suppliers.cat.${OBSTACLE_COST[hit.id].category}`)}
          </span>
          <span className="rn-toast-sub">{t("runner.hit_toast_sub")}</span>
        </span>
        <span className="rn-toast-amount">
          −<Money amount={hit.amount} currency={currency} />
        </span>
      </div>
    </div>
  );
}

/** "GO!" for one beat after the countdown reaches zero. */
function GoFlash({ countdown, label }: { countdown: number; label: string }) {
  // Rises 0 → 1 exactly when the 3-2-1 runs out; a HUD that mounts with the
  // countdown already over (a resume) starts at 1 and never fires.
  const shown = useRiseBanner(countdown > 0 ? 0 : 1, 700);
  if (shown === null) return null;
  return (
    <div className="rn-center">
      <span className="rn-count rn-count--go">{label}</span>
    </div>
  );
}

/** The score multiplier, wearing its progress to the next step as a ring. */
function MultiplierRing(props: {
  multiplier: number;
  progress: number;
  next: number | null;
  label: string;
}) {
  const r = 19;
  const c = 2 * Math.PI * r;
  const bump = useBumpKey(props.multiplier);
  return (
    <div className="rn-mult" aria-label={props.label} role="img">
      <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden>
        <circle cx="24" cy="24" r={r} className="rn-mult-track" />
        <circle
          cx="24"
          cy="24"
          r={r}
          className="rn-mult-arc"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - props.progress)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span key={bump} className={`rn-mult-value${bump > 0 ? " rn-bump" : ""}`}>
        ×{props.multiplier}
      </span>
    </div>
  );
}

function HeartRow({ hearts }: { hearts: number }) {
  const { t } = useT();
  return (
    <div className="rn-hearts" aria-label={t("runner.hearts_label")}>
      {[0, 1, 2].map((i) => (
        <Heart
          key={i}
          size={20}
          strokeWidth={1.5}
          aria-hidden
          className={i < hearts ? "rn-heart rn-heart--on" : "rn-heart rn-heart--off"}
          fill={i < hearts ? "currentColor" : "none"}
        />
      ))}
    </div>
  );
}

function MuteButton({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  const { t } = useT();
  return (
    <button
      type="button"
      className="rn-iconbtn"
      onClick={onToggle}
      aria-label={muted ? t("runner.mute_off") : t("runner.mute_on")}
      aria-pressed={muted}
    >
      {muted ? (
        <VolumeX size={18} strokeWidth={1.5} aria-hidden />
      ) : (
        <Volume2 size={18} strokeWidth={1.5} aria-hidden />
      )}
    </button>
  );
}

/* ── Game over ─────────────────────────────────────────────────────────── */

const VERDICT_KEY = VERDICT_I18N;

function GameOver({ onStart }: { onStart: () => void }) {
  const { t, locale } = useT();
  const summary = useRunnerStore((s) => s.summary);
  const best = useRunnerStore((s) => s.best);
  const firstRun = useRunnerStore((s) => s.firstRun);

  if (!summary) return null;
  // A first run trivially sets the best, so it is told it was a first run, not
  // that it broke a record nobody had set.
  const isBest = !firstRun && best !== null && summary.profit === best;
  const good = summary.verdict === "under_budget" || summary.verdict === "tight";

  return (
    <div className="rn-overlay rn-overlay--scrim">
      <div className={`rn-card rn-card--over rn-pop${good ? " rn-card--good" : ""}`}>
        {isBest ? (
          <p className="rn-ribbon">
            <Trophy size={14} strokeWidth={2} aria-hidden />
            {t("runner.new_best")}
          </p>
        ) : null}
        <h2 className="rn-title rn-title--sm">{t("runner.gameover_title")}</h2>
        <p className="rn-verdict">{t(VERDICT_KEY[summary.verdict].title)}</p>
        <p className="rn-verdict-body">{t(VERDICT_KEY[summary.verdict].body)}</p>

        <div className="rn-final">
          <span className="rn-stat-label">{t("runner.final_profit_label")}</span>
          <span className={`rn-final-value${good ? " rn-shine" : ""}`}>
            <Money amount={summary.profit} currency={summary.currency} />
          </span>
        </div>

        <dl className="rn-tiles">
          <div className="rn-tile">
            <dt>{t("runner.collected_label")}</dt>
            <dd>
              <Money amount={summary.cash} currency={summary.currency} />
            </dd>
          </div>
          <div className="rn-tile">
            <dt>{t("runner.distance_label")}</dt>
            <dd>{runDistance(summary.distance, locale)}</dd>
          </div>
          <div className="rn-tile">
            <dt>{t("runner.best_combo_label")}</dt>
            <dd>{summary.bestCombo ?? 0}</dd>
          </div>
          <div className="rn-tile">
            <dt>{t("runner.bags_label")}</dt>
            <dd>{summary.bags}</dd>
          </div>
          <div className="rn-tile">
            <dt>{t("runner.hits_label")}</dt>
            <dd>{summary.hits}</dd>
          </div>
          <div className="rn-tile">
            <dt>{t("runner.multiplier_label")}</dt>
            <dd>×{summary.multiplier}</dd>
          </div>
        </dl>

        {isBest ? null : firstRun ? (
          <p className="rn-best">{t("runner.first_run")}</p>
        ) : best !== null ? (
          <p className="rn-best">
            {t("runner.your_best")}: <Money amount={best} currency={summary.currency} />
          </p>
        ) : null}

        <button
          type="button"
          className="rn-btn rn-btn--primary rn-btn--big"
          onClick={onStart}
          autoFocus
        >
          <RotateCcw size={16} strokeWidth={1.75} aria-hidden />
          {t("runner.run_again")}
        </button>
        {/* "Back to games" is a LINK, not a quit-to-menu: the key says games, and
         *  the hub is also how the couple leaves the route. */}
        <Link to="/app/games" className="rn-btn rn-btn--ghost">
          {t("runner.back_to_games")}
        </Link>
      </div>
    </div>
  );
}
