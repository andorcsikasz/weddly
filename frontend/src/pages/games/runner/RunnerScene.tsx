/**
 * The 3D half of the runner: one `<Canvas>`, one engine, no React state.
 *
 * THE WHOLE FILE IS A BRIDGE, and it is worth being explicit about why there is
 * no `useState` in it. The simulation is a mutable fixed-step engine that has to
 * be read sixty times a second; React renders when its state changes, which is the
 * wrong shape for that by construction. So every component below receives a
 * `read` closure over the engine and pulls from it inside its own `useFrame`, and
 * the only React state anywhere near the game is the couple's CURRENCY, which
 * changes at most once and is not per-frame.
 *
 * That is also why the HUD is a SIBLING of the canvas and not a child of it: the
 * HUD needs the engine's numbers at about 12 Hz, not 60, and a DOM tree
 * re-rendering sixty times a second to move a score counter is the single most
 * expensive thing this screen could do. See `components/RunnerUI.tsx`.
 */

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useMemo, useRef } from "react";
import * as THREE from "three";
import { JUMP_APEX, SLIDE, laneX } from "@shared/runner";
import type { UiLocale } from "@shared/locales";
import type { Currency } from "@shared/types";
import { RunEngine, type RunState } from "./engine/RunEngine";
import { CameraRig } from "./entities/CameraRig";
import { Collectibles } from "./entities/Collectibles";
import { Environment } from "./entities/Environment";
import { Obstacles } from "./entities/Obstacles";
import { Partner } from "./entities/Partner";
import { Particles } from "./entities/Particles";
import { RunnerModel, type RigInput } from "./entities/RunnerModel";
import { PALETTE } from "./constants/palette";
import { expenseFor, runMoney } from "./utils/format";
import { weddlyLogoTexture } from "./utils/textures";

export interface RunnerSceneProps {
  engine: RunEngine;
  /** The couple's own currency. Drives the two PRINTED props and nothing else —
   *  every other figure comes off the engine, which already holds it. */
  currency: Currency;
  /** Locale for those two props. `runMoney` needs both a currency and a locale,
   *  and it is `UiLocale` rather than `string` because the money formatter closes
   *  over the five shipped locales — a bare `string` here is how a
   *  `UiLocale`-typed function ends up being handed a widened argument. */
  locale: UiLocale;
}

/** The scene, mounted inside the page's `<Canvas>`. */
export function RunnerScene({ engine, currency, locale }: RunnerSceneProps) {
  // Narrow read closures, so nothing below can reach into the engine and mutate
  // it by accident. The engine is handed in once, here, and from this point on
  // the view treats it as read-only.
  const readState = useCallback(() => engine.state, [engine]);
  const readObstacles = useCallback(() => engine.obstacles, [engine]);
  const readCash = useCallback(() => engine.cash, [engine]);
  const readBags = useCallback(() => engine.bags, [engine]);
  const readDistance = useCallback(() => engine.state.distance, [engine]);
  const drainSparks = useCallback(() => engine.drainSparks(), [engine]);

  // The printed props quote one hit's bill. Formatted here rather than in the
  // props themselves because a canvas texture is cached by its CONTENT, so the
  // string has to be final before the canvas is drawn, and only this component
  // knows the locale.
  const expenseLabel = useMemo(
    () => runMoney(expenseFor(currency), currency, locale),
    [currency, locale],
  );

  const mark = useMemo(() => weddlyLogoTexture(), []);

  return (
    <>
      <Lights />
      <Environment distance={readDistance} />
      <PlayerRig engine={engine} />
      <PartnerRig engine={engine} readState={readState} />
      <Obstacles read={readObstacles} expenseLabel={expenseLabel} />
      <Collectibles readCash={readCash} readBags={readBags} mark={mark} />
      <ContactShadow readState={readState} />
      <Particles drain={drainSparks} />
      <CameraRig readState={readState} />
    </>
  );
}

/**
 * The player.
 *
 * Its rig input is assembled HERE and not inside `RunnerModel`, because every
 * field of it is a reading of engine state and this mapping is the one part of the
 * frame that has to be right:
 *
 *  - `air` is the player's height NORMALISED BY `JUMP_APEX`, not a boolean and
 *    not raw metres. The rig tucks on the way up as well as on the way down, and
 *    normalising by the derived apex means the tuck still fills the pose if the
 *    gravity is ever retuned — which is exactly the change someone makes when
 *    the jump "feels floaty", so it cannot be allowed to silently break the
 *    animation.
 *  - `slide` is the remaining slide time over `SLIDE.seconds`. The engine owns the
 *    slide's length, so the pose cannot outlast the collision box that caused it.
 *  - `laneDelta` is the GAP between where the player is and where their lane is,
 *    which is what makes a lane change read as weight rather than as a snap.
 */
function PlayerRig({ engine }: { engine: RunEngine }) {
  const read = useCallback((): RigInput => {
    const s = engine.state;
    return {
      x: s.x,
      y: s.y,
      z: 0,
      air: s.airborne ? Math.min(1, s.y / JUMP_APEX) : 0,
      slide: s.slideTime > 0 ? Math.min(1, s.slideTime / SLIDE.seconds) : 0,
      speed: s.speed,
      laneDelta: s.x - laneX(s.lane),
      clock: engine.clock,
      invuln: s.invuln,
      celebrate: s.phase === "over" ? 1 : 0,
      running: s.phase === "running",
      bob: 0,
    };
  }, [engine]);

  return <RunnerModel character={engine.state.character} read={read} />;
}

/** The partner: the same rig, the other skin, a trailing z and the `far` detail
 *  level, all decided in `Partner`. The only decision left here is WHOSE skin,
 *  and that belongs to the engine because the player chose it. */
function PartnerRig({
  engine,
  readState,
}: {
  engine: RunEngine;
  readState: () => RunState;
}) {
  const character = engine.state.character === "bride" ? "groom" : "bride";
  return <Partner character={character} read={readState} />;
}

/**
 * The player's contact shadow.
 *
 * A painted ellipse, not a shadow map, and the reason is honest rather than
 * fashionable: `ContactShadows` is Drei, Drei is deliberately not installed, and
 * the eye does not want a shadow — it wants CONTACT. What sells a jump is the
 * shadow shrinking and fading underneath the runner, which here is three lines of
 * arithmetic on the height the engine already computed.
 *
 * It scales and fades with `JUMP_APEX` rather than with a guessed constant,
 * because the shadow has to vanish at the same instant the feet do. A shadow
 * that is still there under a jump apex makes the runner look like they are
 * hovering over their own footprint.
 */
function ContactShadow({ readState }: { readState: () => RunState }) {
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const node = mesh.current;
    if (!node) return;
    const s = readState();
    const height = Math.min(1, s.y / JUMP_APEX);
    const shrink = 1 - height * 0.45;
    node.position.set(s.x, 0.02, 0);
    node.scale.set(shrink, shrink, 1);
    const mat = node.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.24 * (1 - height) * (s.phase === "over" ? 0.5 : 1);
  });

  return (
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <circleGeometry args={[0.46, 24]} />
      <meshBasicMaterial color={PALETTE.umber900} transparent opacity={0.24} depthWrite={false} />
    </mesh>
  );
}

/** The canvas. The page owns nothing inside it. */
export function RunnerCanvas({ engine, currency, locale }: RunnerSceneProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      // A camera specified up front so the FIRST frame is already the shot the
      // rig takes over on frame one: no establishing wide shot, no jump-cut on
      // mount.
      camera={{ position: [0, 3.1, 6.4], fov: 62, near: 0.1, far: 260 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
    >
      <Suspense fallback={null}>
        <RunnerScene engine={engine} currency={currency} locale={locale} />
      </Suspense>
    </Canvas>
  );
}

/**
 * Two lights and no more.
 *
 * A scene lit by one directional light looks like a render; a scene lit by a
 * hemisphere plus a warm key reads as an afternoon, and the hemisphere does the
 * real work — it is what keeps the shadowed side of every prop the same colour as
 * the ground rather than black.
 */
function Lights() {
  return (
    <>
      <hemisphereLight args={[PALETTE.skyTop, PALETTE.sage600, 0.85]} />
      <directionalLight position={[-6, 9, -4]} intensity={1.15} color={PALETTE.skyHorizon} />
      {/* A cool fill from BEHIND the camera, so the player's face is never in
          shadow: the camera is behind them, so this is the light doing all the
          character reading. */}
      <directionalLight position={[3, 4, 7]} intensity={0.32} color={PALETTE.white} />
    </>
  );
}

export { RunnerScene as RunnerSceneRoot };
