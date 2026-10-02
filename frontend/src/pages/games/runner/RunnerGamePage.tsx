/**
 * `/app/games/runner` — the endless runner.
 *
 * THIS PAGE OWNS THE ENGINE, AND THAT IS THE WHOLE ARCHITECTURE.
 *
 * `RunEngine` is a mutable fixed-step simulation. If it lived in the store, every
 * subscriber would re-render 60 times a second to read numbers the player cannot
 * read that fast. So the engine is a plain `useRef`, created once, and the store
 * receives a 12 Hz SNAPSHOT through `onTick`. React renders the snapshot; the
 * scene mutates the engine directly inside `useFrame`. Nothing in React is ever
 * the source of truth for a position, a collision or a score.
 *
 * THE CURRENCY IS RESOLVED BEFORE THE FIRST FRAME. A euro workspace and a forint
 * workspace score on completely different scales — a coin is €10 in one and
 * 10 000 Ft in the other — so the engine cannot be constructed before
 * `coupleApi.current()` answers. Until it does the page shows `runner.preparing`
 * and mounts no Canvas, rather than starting a run in the wrong unit and
 * re-pricing it afterwards: the printed props in the world bake the amount into
 * a canvas texture, and a mid-run currency change would leave half the track
 * quoting one currency and the HUD quoting another.
 *
 * THE INPUT LAYER HAS NO GAME LOGIC IN IT. Keyboard, pointer and swipe all reduce
 * to the same five intents the engine exposes, and the intent list is declared
 * once, as `INTENTS`, so a device that can only reach four of them (a phone has
 * no Escape key) is a shorter list rather than a different code path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Canvas } from "@react-three/fiber";
import { disposeGeometries, disposeMaterials } from "./constants/materials";
import { createRunnerAudio } from "./audio/runnerAudio";
import { RunEngine } from "./engine/RunEngine";
import { RunnerScene } from "./RunnerScene";
import { RunnerUI } from "./components/RunnerUI";
import { useRunnerStore } from "./store/runnerStore";
import { coupleApi } from "@/lib/endpoints";
import { useT } from "@/lib/i18n";
import type { BudgetGoal, Currency } from "@shared/types";
import { VENUE_IDS, type VenueId } from "@shared/runner";
import "./runner.css";

/** The five things a player can ask for. Every input device below maps onto this
 *  and nothing else — a touch swipe and an arrow key must not be able to reach
 *  different engine methods, or the two drift apart within a release. */
type Intent = "left" | "right" | "jump" | "slide" | "pause";

const KEY_INTENTS: Readonly<Record<string, Intent>> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
  ArrowDown: "slide",
  KeyS: "slide",
  Escape: "pause",
  KeyP: "pause",
};

function fire(engine: RunEngine, intent: Intent): void {
  switch (intent) {
    case "left":
      engine.moveLane(-1);
      return;
    case "right":
      engine.moveLane(1);
      return;
    case "jump":
      engine.jump();
      return;
    case "slide":
      engine.slide();
      return;
    case "pause":
      if (engine.state.phase === "running") engine.pause();
      else if (engine.state.phase === "paused") engine.resume();
      return;
  }
}

/** Drives the engine from the render loop. Deliberately a component rather than a
 *  `requestAnimationFrame` in an effect: R3F's loop already runs once a frame and
 *  is already paused by the browser when the tab is hidden, so a second loop of
 *  our own would step the simulation while nothing is being drawn — which is how a
 *  run ends without the player ever seeing the hit that ended it. */
function Loop({ engine }: { engine: RunEngine }) {
  useFrame((_, delta) => engine.advance(Math.min(delta, 0.1)));
  return null;
}

export default function RunnerGamePage() {
  const { locale, t } = useT();
  const venueNames = useMemo(
    () =>
      Object.fromEntries(VENUE_IDS.map((v) => [v, t(`runner.venue_${v}`)])) as Record<
        VenueId,
        string
      >,
    [t],
  );
  const setReady = useRunnerStore((s) => s.setReady);
  const tick = useRunnerStore((s) => s.tick);
  const finish = useRunnerStore((s) => s.finish);
  const resetHud = useRunnerStore((s) => s.reset);

  // The engine exists for the whole mount regardless of whether the currency has
  // landed; `setCurrency` is a no-op mid-run, so the lookup can resolve at any
  // moment and the engine adopts it. What CANNOT happen is a run starting before
  // the currency is known, which the `ready` gate below enforces.
  const engine = useMemo(() => new RunEngine(), []);
  // Dev-only handle for poking the simulation from the console or a QA script
  // (grant a power-up, jump to 600 m). Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __runner?: RunEngine }).__runner = engine;
    return () => {
      delete (window as unknown as { __runner?: RunEngine }).__runner;
    };
  }, [engine]);
  const audio = useMemo(() => createRunnerAudio(), []);

  const currency = useRef<Currency | null>(null);
  /** The couple's own wedding budget, in their currency: every hit is priced
   *  against it (see `hitCost`). Null when they have not set one. */
  const budget = useRef<number | null>(null);

  /* ── Who you are ────────────────────────────────────────────────────────── */
  const character = useRunnerStore((s) => s.character);
  // The store owns the CHOICE, the engine owns the RIG, and this is the one place
  // the two meet. `setCharacter` is a no-op once a run is under way, so the
  // effect firing again on a phase change cannot swap the model mid-stride.
  useEffect(() => {
    engine.setCharacter(character);
  }, [engine, character]);

  /* ── The couple's currency ─────────────────────────────────────────────── */
  useEffect(() => {
    let live = true;
    void coupleApi
      .current()
      .then((r) => {
        if (!live) return;
        currency.current = r.couple?.currency ?? "HUF";
        budget.current = budgetFromGoal(r.couple?.budget_goal ?? null);
      })
      .catch(() => {
        if (!live) return;
        // A workspace lookup that fails must not leave the game on a spinner
        // forever. HUF is the app's own default for a couple with no currency set
        // (see `localeCurrency`), so it is the honest fallback rather than a
        // silent EUR.
        currency.current = "HUF";
      })
      .finally(() => {
        if (!live) return;
        const resolved = currency.current ?? "HUF";
        currency.current = resolved;
        setReady(resolved, isTouchDevice());
      });
    return () => {
      live = false;
    };
  }, [setReady]);

  /* ── The engine → HUD bridge, and the one place a run can END ─────────── */
  useEffect(() => {
    engine.onTick = (state, extra) => tick(state, extra, currency.current ?? "HUF");
    engine.onGameOver = (summary) => finish(summary);
    return () => {
      engine.onTick = null;
      engine.onGameOver = null;
    };
  }, [engine, tick, finish]);

  /* ── Audio: drained every frame, unlocked by the first real gesture ───── */
  useEffect(() => {
    let raf = 0;
    const pump = () => {
      audio.attach(engine);
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    // Every browser requires a user gesture to start an AudioContext, and the one
    // gesture that always exists in this game is the Start button. `unlock` is
    // idempotent, so the listener is removed on the first hit rather than firing
    // `resume()` on every later click.
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [audio, engine]);

  /* ── Dispose ──────────────────────────────────────────────────────────── */
  useEffect(
    () => () => {
      // The shared material and geometry registries are module-level and are
      // scoped to this ROUTE, so a remount without this leaks every material and
      // every geometry the run created — and the second run would be slower for
      // no visible reason.
      disposeMaterials();
      disposeGeometries();
    },
    [],
  );

  /* ── Intents ──────────────────────────────────────────────────────────── */
  // A phase change is pushed to the HUD at once rather than on the next 12 Hz
  // tick, which only runs inside a rendered frame: otherwise Start, Pause and
  // Quit wait a frame (or, in a throttled tab, indefinitely) to show anything.
  const sync = useCallback(
    () => tick(engine.state, { clock: engine.clock, milestonePulse: 0 }, currency.current ?? "HUF"),
    [engine, tick],
  );

  const start = useCallback(() => {
    void audio.unlock();
    engine.setCurrency(currency.current ?? "HUF");
    engine.setBudget(budget.current);
    resetHud();
    // Three seconds of 3-2-1 with the track already laid out in front.
    engine.start(undefined, 3);
    sync();
  }, [audio, engine, resetHud, sync]);

  const startRef = useRef(start);
  startRef.current = start;

  const pause = useCallback(() => {
    engine.pause();
    sync();
  }, [engine, sync]);
  const resume = useCallback(() => {
    engine.resume();
    sync();
  }, [engine, sync]);

  // A hidden tab stops R3F's loop, so the run freezes mid-air; coming back to a
  // run already in motion is how a player loses a heart they never saw. Park it
  // on the pause sheet instead.
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) pause();
    };
    const onBlur = () => pause();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
    };
  }, [pause]);
  const quit = useCallback(() => {
    // "Quit" is ABANDONED, not lost: the run never reaches `over`, so no summary
    // is pushed and no best is banked. A player who quits with 300 000 on the
    // clock has not earned a record, and letting them bank it would make quitting
    // the optimal strategy.
    engine.toMenu();
    sync();
  }, [engine, sync]);
  // The AUDIO OBJECT owns the mute; this flag exists only to re-render the
  // speaker glyph. It is deliberately not the source of truth and never consulted
  // when deciding whether to mute — `toggleMute` reads `audio.isMuted` back every
  // time, so a flag that drifted could never leave the game permanently silent.
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => {
    audio.setMuted(!audio.isMuted);
    setMuted(audio.isMuted);
  }, [audio]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Straight back into a run from the verdict card: R (or Enter, which the
      // focused button already handles).
      if (e.code === "KeyR" && engine.state.phase === "over") {
        e.preventDefault();
        startRef.current();
        return;
      }
      const intent = KEY_INTENTS[e.code];
      if (!intent) return;
      // Off the track, a focused Start / Run again button must keep Space as its
      // own activation key instead of having it swallowed as a jump.
      if (
        engine.state.phase !== "running" &&
        intent !== "pause" &&
        (e.target as HTMLElement | null)?.closest?.("button, a")
      ) {
        return;
      }
      // Space and the arrows scroll the page underneath, and a scroll during a run
      // moves the whole viewport out from under the HUD.
      e.preventDefault();
      fire(engine, intent);
      if (intent === "pause") sync();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, sync]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // The overlay swallows its own pointers, so a tap on Start or Resume must
      // not ALSO steer the couple.
      // Same for the HUD's own buttons (mute, pause): a tap on them is not a
      // steer.
      if ((e.target as HTMLElement).closest(".rn-overlay, button, a")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - rect.left - rect.width / 2;
      const dy = e.clientY - rect.top - rect.height / 2;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      // The vertical intent wins ties and near-ties: a swipe that is mostly
      // vertical is a jump or a slide, and the axis with the larger magnitude is
      // the one the player meant.
      if (ay > ax * 0.8) fire(engine, dy < 0 ? "jump" : "slide");
      else if (ax > 24) fire(engine, dx < 0 ? "left" : "right");
    },
    [engine],
  );

  const ready = useRunnerStore((s) => s.ready);

  return (
    <div className="rn-page" onPointerDown={onPointerDown}>
      {/* The Canvas is mounted only once the currency is known. An unmounted
          Canvas is cheaper than an engine running in the wrong unit, and the
          overlay's `runner.preparing` copy is the reason a half-second wait is
          not a blank screen. */}
      {ready && currency.current ? (
        <Canvas
          className="rn-canvas"
          dpr={[1, 1.75]}
          camera={{ fov: 62, near: 0.1, far: 260, position: [0, 3.4, 7.6] }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
        >
          <Loop engine={engine} />
          <RunnerScene
            engine={engine}
            currency={currency.current}
            locale={locale}
            venueNames={venueNames}
          />
        </Canvas>
      ) : null}
      <RunnerUI
        onStart={start}
        onPause={pause}
        onResume={resume}
        onQuit={quit}
        onToggleMute={toggleMute}
        muted={muted}
      />
    </div>
  );
}

function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  // `pointer: coarse` is the honest test — it is the one that is true for a
  // phone and false for a touchscreen laptop, where a mouse is the real input.
  // A `maxTouchPoints` check would put the swipe copy in front of someone who has
  // a keyboard, and they would then have no key hints at all.
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/** One number out of the couple's budget goal: the exact figure, or the middle
 *  of a range, or whichever end of it they filled in. Null for "don't know yet". */
function budgetFromGoal(goal: BudgetGoal | null): number | null {
  if (!goal) return null;
  if (goal.exact_huf) return goal.exact_huf;
  const lo = goal.min_huf ?? null;
  const hi = goal.max_huf ?? null;
  if (lo && hi) return (lo + hi) / 2;
  return lo ?? hi ?? null;
}
