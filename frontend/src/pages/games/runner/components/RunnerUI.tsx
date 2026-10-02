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

import { ArrowLeft, Heart, Pause, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Link } from "react-router-dom";
import { VERDICT_I18N } from "@shared/runner";
import type { Currency } from "@shared/types";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useRunnerStore } from "../store/runnerStore";
import { runDistance } from "../utils/format";

/** A money figure, in the couple's own currency. The only money renderer. */
function Money({ amount, currency }: { amount: number; currency: Currency }) {
  const locale = useT().locale;
  return <>{formatMoney(amount, currency, locale)}</>;
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
  const profit = useRunnerStore((s) => s.profit);
  const hearts = useRunnerStore((s) => s.hearts);
  const distance = useRunnerStore((s) => s.distance);
  const multiplier = useRunnerStore((s) => s.multiplier);
  const currency = useRunnerStore((s) => s.currency);
  const ready = useRunnerStore((s) => s.ready);
  const touch = useRunnerStore((s) => s.touch);

  if (!ready) {
    return (
      <div className="rn-overlay rn-overlay--solid">
        <p className="rn-waiting">{t("runner.preparing")}</p>
      </div>
    );
  }

  if (phase === "menu") {
    return (
      <div className="rn-overlay">
        <div className="rn-card rn-card--menu">
          <h1 className="rn-title">{t("runner.title")}</h1>
          <p className="rn-subtitle">{t("runner.subtitle")}</p>

          <section className="rn-block">
            <h2 className="rn-block-title">{t("runner.how_title")}</h2>
            <p className="rn-block-body">{t("runner.how_body")}</p>
          </section>

          <section className="rn-block">
            <h2 className="rn-block-title">{t("runner.controls_title")}</h2>
            {touch ? (
              <p className="rn-block-body">{t("runner.touch_controls")}</p>
            ) : (
              <ul className="rn-keys">
                {(
                  [
                    ["A / ←", "runner.control_left"],
                    ["D / →", "runner.control_right"],
                    ["W / ↑ / Space", "runner.control_jump"],
                    ["S / ↓", "runner.control_slide"],
                    ["Esc / P", "runner.control_pause"],
                  ] as const
                ).map(([key, label]) => (
                  <li key={key} className="rn-keyrow">
                    <kbd className="rn-kbd">{key}</kbd>
                    <span>{t(label)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <button type="button" className="rn-btn rn-btn--primary" onClick={onStart} autoFocus>
            {t("runner.start")}
          </button>
          {/* The route is full screen over the app shell, so the menu carries
              its own way back. */}
          <Link to="/app/games" className="rn-btn rn-btn--ghost">
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            {t("runner.back_to_games")}
          </Link>
        </div>
      </div>
    );
  }

  if (phase === "paused") {
    return (
      <div className="rn-overlay rn-overlay--scrim">
        <div className="rn-card rn-card--slim">
          <h2 className="rn-title rn-title--sm">{t("runner.paused_title")}</h2>
          <button type="button" className="rn-btn rn-btn--primary" onClick={onResume} autoFocus>
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

  return (
    <Hud
      multiplier={multiplier}
      hearts={hearts}
      profit={profit}
      distance={distance}
      currency={currency}
      muted={muted}
      onToggleMute={onToggleMute}
      onPause={onPause}
    />
  );
}

/* ── The live HUD ──────────────────────────────────────────────────────── */

function Hud(props: {
  multiplier: number;
  hearts: number;
  profit: number;
  distance: number;
  currency: Currency;
  muted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
}) {
  const { t, locale } = useT();
  return (
    <div className="rn-hud" aria-live="off">
      <div className="rn-hud-row">
        <div className="rn-stat rn-stat--lead">
          <span className="rn-stat-label">{t("runner.profit_label")}</span>
          <span className="rn-stat-value">
            <Money amount={props.profit} currency={props.currency} />
          </span>
        </div>
        <div className="rn-stat">
          <span className="rn-stat-label">{t("runner.distance_label")}</span>
          <span className="rn-stat-value">{runDistance(props.distance, locale)}</span>
        </div>
        <div className="rn-stat rn-stat--mult" aria-label={t("runner.multiplier_label")}>
          <span className="rn-stat-value">×{props.multiplier}</span>
        </div>
        <HeartRow hearts={props.hearts} />
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

  return (
    <div className="rn-overlay rn-overlay--scrim">
      <div className="rn-card rn-card--over">
        <h2 className="rn-title rn-title--sm">{t("runner.gameover_title")}</h2>
        <p className="rn-verdict">{t(VERDICT_KEY[summary.verdict].title)}</p>
        <p className="rn-verdict-body">{t(VERDICT_KEY[summary.verdict].body)}</p>

        <div className="rn-final">
          <span className="rn-stat-label">{t("runner.final_profit_label")}</span>
          <span className="rn-final-value">
            <Money amount={summary.profit} currency={summary.currency} />
          </span>
        </div>

        <dl className="rn-breakdown">
          <div className="rn-breakdown-row">
            <dt>{t("runner.collected_label")}</dt>
            <dd>
              <Money amount={summary.cash} currency={summary.currency} />
            </dd>
          </div>
          <div className="rn-breakdown-row">
            <dt>{t("runner.hits_label")}</dt>
            <dd>{summary.hits}</dd>
          </div>
          <div className="rn-breakdown-row">
            <dt>{t("runner.bags_label")}</dt>
            <dd>{summary.bags}</dd>
          </div>
          <div className="rn-breakdown-row">
            <dt>{t("runner.distance_label")}</dt>
            <dd>{runDistance(summary.distance, locale)}</dd>
          </div>
        </dl>

        {isBest ? (
          <p className="rn-best rn-best--new">{t("runner.new_best")}</p>
        ) : firstRun ? (
          <p className="rn-best">{t("runner.first_run")}</p>
        ) : best !== null ? (
          <p className="rn-best">
            {t("runner.your_best")}: <Money amount={best} currency={summary.currency} />
          </p>
        ) : null}

        <button type="button" className="rn-btn rn-btn--primary" onClick={onStart} autoFocus>
          <RotateCcw size={16} strokeWidth={1.5} aria-hidden />
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
