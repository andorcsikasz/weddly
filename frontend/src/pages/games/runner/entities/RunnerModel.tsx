/**
 * The couple.
 *
 * ONE rig, two skins. The bride and the groom share a skeleton, a run cycle and
 * a collision body, and differ only in the parts hung on it — so there is no
 * such thing as the faster character, and swapping in a modelled bride or groom
 * later means replacing this file's meshes and leaving `RigInput` alone.
 *
 * The animation is a pure function of `RigInput` with per-joint damping, which
 * is what makes the transitions work without a state machine: a jump that
 * starts mid-stride, a lane change that lands mid-slide and a collision that
 * arrives during all of it all blend, because every joint is always chasing a
 * target rather than being told to play a clip.
 *
 * FACES ARE TWO DOTS. Modelling a mouth is the point at which a primitive-built
 * character stops being charming, and the brief is explicit about preferring a
 * stylised look. Two eyes and a colour on the cheeks carry the whole
 * expression from this camera distance.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import { M, box, cylinder, geo, sphere } from "../constants/materials";
import { PALETTE } from "../constants/palette";
import type { RunnerCharacter } from "../engine/RunEngine";

/* SMOOTH GEOMETRY. The rig is the one thing on screen the player stares at for
 * the whole run, so it is built at a much higher resolution than the props:
 * every sphere, cylinder and capsule below goes through these three, which
 * floor the segment counts. The props keep the low-poly look on purpose. */
const S = (r: number, segments = 12) => sphere(r, Math.max(segments, 28));
const C = (rt: number, rb: number, h: number, segments = 14) =>
  cylinder(rt, rb, h, Math.max(segments, 32));
const L = (radius: number, length: number, key: string) =>
  geo(`smoothLimb:${key}:${radius}:${length}`, () => {
    const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 10, 24);
    g.translate(0, -length / 2, 0);
    return g;
  });

export interface RigInput {
  /** World x of the root and feet height above the path. */
  x: number;
  y: number;
  /** World z. The player is 0 (the engine's convention: the world moves, the
   *  runner does not); the partner trails. Owned by the input so the same rig can
   *  draw a second figure off the line. */
  z: number;
  /** 0 on the ground → 1 at the top of the jump. Drives the tuck. */
  air: number;
  /** 0 → 1 blend into the slide pose. */
  slide: number;
  /** Forward speed in m/s; drives cadence and forward lean. */
  speed: number;
  /** Signed lane error in metres; drives the lean into a lane change. */
  laneDelta: number;
  /** The animation clock, in seconds. */
  clock: number;
  /** Seconds of invulnerability left; drives the hit flicker. */
  invuln: number;
  /** 0 → 1 celebration at the game-over screen. */
  celebrate: number;
  /** False at the menu / while paused: an idle pose instead of a run. */
  running: boolean;
  /** Extra vertical bob the caller wants, in metres (the partner's bounce). */
  bob: number;
}

/** Framerate-independent damping factor for a time constant. */
const damp = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

interface Joints {
  root: THREE.Group | null;
  body: THREE.Group | null;
  head: THREE.Group | null;
  armL: THREE.Group | null;
  armR: THREE.Group | null;
  foreL: THREE.Group | null;
  foreR: THREE.Group | null;
  thighL: THREE.Group | null;
  thighR: THREE.Group | null;
  shinL: THREE.Group | null;
  shinR: THREE.Group | null;
  skirt: THREE.Group | null;
  veil: THREE.Group | null;
  /** Bride: the train dragging behind the hem, and the two ribbon tails of the
   *  bow at the small of the back. Groom: the two jacket tails. All four are
   *  cloth, so all four lag the body instead of tracking it. */
  train: THREE.Group | null;
  ribbonL: THREE.Group | null;
  ribbonR: THREE.Group | null;
  tailL: THREE.Group | null;
  tailR: THREE.Group | null;
}

/**
 * The damping time constant, in seconds. Turning this off would make the rig
 * snap between poses; turning it up would make it feel like it is moving
 * through syrup. 55 ms reads as "responsive and physical" rather than as
 * either extreme.
 */
const TAU = 0.055;

/** Where the hips are, in metres above the path. Every limb hangs off this. */
const HIP_Y = 0.9;

export interface RunnerModelProps {
  character: RunnerCharacter;
  /** Called once a frame with everything the animation needs. Reading the
   *  engine through a closure rather than through props is what lets this run
   *  at 60 fps without re-rendering the component. */
  read: () => RigInput;
  /** Receives the root object, so the caller can read its world transform. */
  rootRef?: MutableRefObject<THREE.Object3D | null>;
  /** Scale the whole rig. */
  scale?: number;
  /** Detail level. `far` drops the face and the small props — the partner is
   *  30 m away and behind fog, so drawing a bow tie there is waste. */
  detail?: "full" | "far";
}

export function RunnerModel({
  character,
  read,
  rootRef,
  scale = 1,
  detail = "full",
}: RunnerModelProps) {
  const j = useRef<Joints>({
    root: null,
    body: null,
    head: null,
    armL: null,
    armR: null,
    foreL: null,
    foreR: null,
    thighL: null,
    thighR: null,
    shinL: null,
    shinR: null,
    skirt: null,
    veil: null,
    train: null,
    ribbonL: null,
    ribbonR: null,
    tailL: null,
    tailR: null,
  });
  const pose = useRef({
    phase: 0,
    thighL: 0,
    thighR: 0,
    shinL: 0,
    shinR: 0,
    armL: 0,
    armR: 0,
    foreL: 0,
    foreR: 0,
    lean: 0,
    pitch: 0,
    roll: 0,
    bob: 0,
    height: 0,
    x: 0,
    headTilt: 0,
    skirt: 0,
  });
  const far = detail === "far";
  const bride = character === "bride";

  const set = (key: keyof Joints) => (node: THREE.Group | null) => {
    j.current[key] = node;
  };

  const mat = useMemo(
    () => ({
      skin: M.skin(),
      skinDeep: M.skinDeep(),
      hair: bride ? M.hairLight() : M.hair(),
      ivory: M.ivory(),
      veil: M.veil(),
      tux: M.tuxedo(),
      lining: M.tuxedoLining(),
      shirt: M.shirt(),
      bow: M.bowTie(),
      blush: M.bouquet(),
      sneakerSole: M.bouquet(),
      cheek: M.blossom(),
      eye: M.rubber(),
      leaf: M.bouquetLeaf(),
      bloom1: M.bouquet(),
      bloom2: M.blossomPale(),
      tulle: M.tulle(),
      lace: M.lace(),
      pearl: M.pearl(),
      satin: M.satin(),
      satinInk: M.satinInk(),
      gold: M.gold(),
      chrome: M.chrome(),
      shoe: M.rubber(),
    }),
    [bride],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const input = read();
    const p = pose.current;
    const jc = j.current;
    if (!jc.root) return;

    /* ── Cadence. Faster feet, a longer stride and a deeper lean as the run
       speeds up; all three come off the SAME number, so a fast run never looks
       like it is sprinting on a conveyor belt. */
    const hz = input.running ? 2.2 + input.speed * 0.052 : 1.1;
    p.phase += dt * hz * Math.PI * 2;
    const stride = input.running ? 0.5 + input.speed * 0.0155 : 0.16;
    const swing = Math.sin(p.phase);
    const swing2 = Math.sin(p.phase + Math.PI);

    /* ── Target pose. Run is the base; air, slide and celebration are
       overrides the damping blends into, which is why a jump taken on the
       left foot still lands looking deliberate. */
    let tThighL = swing * stride;
    let tThighR = swing2 * stride;
    // A knee only ever folds backwards. That single constraint is the whole
    // difference between a run cycle and a windmill.
    let tShinL = Math.max(0, -swing) * 1.35 + 0.1;
    let tShinR = Math.max(0, -swing2) * 1.35 + 0.1;
    let tArmL = -swing * 0.78;
    let tArmR = -swing2 * 0.78;
    let tForeL = 1.25 + Math.sin(p.phase * 2) * 0.2;
    let tForeR = 1.25 - Math.sin(p.phase * 2) * 0.2;
    let tBob = Math.abs(Math.sin(p.phase * 2)) * (input.running ? 0.05 : 0.008);
    let tLean = input.running ? 0.15 + input.speed * 0.0055 : 0.03;
    let tRoll = input.running ? swing * 0.05 : Math.sin(input.clock * 1.1) * 0.02;
    let tSkirt = swing * 0.16;
    let tHead = -input.laneDelta * 0.12;

    if (input.air > 0.02) {
      // Tuck: legs up, arms reaching for the next stride rather than flailing.
      // A flailing jump reads as a bug; a tucked one reads as a decision.
      const a = Math.min(1, input.air);
      tThighL = 1.0 * a + swing * stride * (1 - a);
      tThighR = -0.3 * a + swing2 * stride * (1 - a);
      tShinL = 1.55 * a + tShinL * (1 - a);
      tShinR = 0.8 * a + tShinR * (1 - a);
      tArmL = -1.85 * a + tArmL * (1 - a);
      tArmR = -1.7 * a + tArmR * (1 - a);
      tForeL = 0.5 * a + tForeL * (1 - a);
      tForeR = 0.5 * a + tForeR * (1 - a);
      tBob = -0.02 * a;
      tLean = 0.24 * a + tLean * (1 - a);
      tRoll = swing * 0.03 * (1 - a);
      tSkirt = -0.4 * a;
      tHead = -0.06 * a;
    }

    if (input.slide > 0.01) {
      // Body pitched BACK, one leg out front, arms trailing. Pitching forward
      // is the mistake here — it puts the head into the ground and reads as a
      // faceplant rather than as a slide.
      const s = Math.min(1, input.slide);
      tThighL = 1.15 * s + tThighL * (1 - s);
      tThighR = 0.35 * s + tThighR * (1 - s);
      tShinL = 0.25 * s + tShinL * (1 - s);
      tShinR = 1.25 * s + tShinR * (1 - s);
      tArmL = 1.7 * s + tArmL * (1 - s);
      tArmR = 1.5 * s + tArmR * (1 - s);
      tForeL = 0.35 * s + tForeL * (1 - s);
      tForeR = 0.35 * s + tForeR * (1 - s);
      tBob = -0.58 * s + tBob * (1 - s);
      tLean = -0.34 * s + tLean * (1 - s);
      tRoll = 0.16 * s + tRoll * (1 - s);
      tSkirt = -0.55 * s;
      tHead = -0.22 * s;
    }

    if (input.celebrate > 0.01) {
      // Profitable game over: arms up, a little hop. Deliberately small — the
      // verdict screen is doing the talking.
      const c = Math.min(1, input.celebrate);
      tArmL = -2.6 * c + tArmL * (1 - c);
      tArmR = -2.6 * c + tArmR * (1 - c);
      tForeL = 0.2 * c + tForeL * (1 - c);
      tForeR = 0.2 * c + tForeR * (1 - c);
      tBob = Math.abs(Math.sin(input.clock * 7)) * 0.14 * c + tBob * (1 - c);
      tLean = -0.1 * c + tLean * (1 - c);
      tRoll = Math.sin(input.clock * 5) * 0.12 * c + tRoll * (1 - c);
    }

    const k = damp(dt, TAU);
    p.thighL += (tThighL - p.thighL) * k;
    p.thighR += (tThighR - p.thighR) * k;
    p.shinL += (tShinL - p.shinL) * k;
    p.shinR += (tShinR - p.shinR) * k;
    p.armL += (tArmL - p.armL) * k;
    p.armR += (tArmR - p.armR) * k;
    p.foreL += (tForeL - p.foreL) * k;
    p.foreR += (tForeR - p.foreR) * k;
    p.lean += (tLean - p.lean) * k;
    p.roll += (tRoll - p.roll) * k;
    p.bob += (tBob - p.bob) * k;
    p.skirt += (tSkirt - p.skirt) * k;
    p.headTilt += (tHead - p.headTilt) * k;
    // Position is damped harder than the joints: it is following a physical
    // lane the simulation already smoothed, so a second smoothing layer here
    // would only add lag.
    p.height += (input.y - p.height) * damp(dt, 0.02);
    p.x += (input.x - p.x) * damp(dt, 0.02);

    /* ── Commit. */
    const root = jc.root;
    // z comes straight from the input, NOT hardcoded to 0. The engine pins the
    // PLAYER at z = 0 — the whole world moves toward +z — but the partner runs a
    // few metres behind, so the rig has to own all three axes or the second copy
    // of it cannot be placed at all.
    root.position.set(p.x, p.height + p.bob + input.bob, input.z);
    // Lean into the lane change AND flinch away from the hit. Both are roll
    // about z, and the flinch is added on top rather than replacing the lean,
    // so a hit mid-lane-change reads as one movement rather than two.
    const flinch = input.invuln > 0 ? Math.sin(input.clock * 46) * 0.12 * input.invuln : 0;
    root.rotation.z = -input.laneDelta * 0.42 + flinch;
    root.rotation.y = input.laneDelta * 0.2;
    root.scale.setScalar(scale);
    // The invulnerability flicker, at ~9 Hz. The genre standard for "you are
    // briefly untouchable", and it is unmistakable at a glance.
    root.visible = input.invuln <= 0 || Math.floor(input.clock * 18) % 2 === 0;

    if (jc.body) {
      jc.body.rotation.x = p.lean;
      jc.body.rotation.z = p.roll;
    }
    if (jc.head) jc.head.rotation.z = p.headTilt + Math.sin(input.clock * 0.9) * 0.03;
    if (jc.armL) jc.armL.rotation.x = p.armL;
    if (jc.armR) jc.armR.rotation.x = p.armR;
    if (jc.foreL) jc.foreL.rotation.x = -p.foreL;
    if (jc.foreR) jc.foreR.rotation.x = -p.foreR;
    if (jc.thighL) jc.thighL.rotation.x = p.thighL;
    if (jc.thighR) jc.thighR.rotation.x = p.thighR;
    if (jc.shinL) jc.shinL.rotation.x = -p.shinL;
    if (jc.shinR) jc.shinR.rotation.x = -p.shinR;
    if (jc.skirt) {
      jc.skirt.rotation.x = p.skirt * 0.35;
      jc.skirt.rotation.z = p.roll * 1.4;
    }
    if (jc.veil) {
      // The veil trails. Its lag is what makes it read as fabric rather than
      // as a board taped to the head — it is chasing a value, not tracking one.
      jc.veil.rotation.x = -p.lean * 1.5 - 0.12 + Math.sin(input.clock * 5.5) * 0.06;
      jc.veil.rotation.z = -root.rotation.z * 1.6;
    }
    /* Cloth. Everything trailing gets the speed as a lift (the faster the run,
       the further back it flies) plus its own flutter at a frequency unrelated to
       the stride, so it reads as air moving through fabric rather than as a
       second pair of legs. */
    const wind = input.running ? Math.min(1, input.speed / 24) : 0.15;
    const flutter = Math.sin(input.clock * 9.5);
    const flutter2 = Math.sin(input.clock * 11.3 + 1.3);
    if (jc.train) {
      jc.train.rotation.x = -0.1 - wind * 0.25 + flutter * 0.04 - input.air * 0.5;
      jc.train.rotation.z = -root.rotation.z * 1.2 + swing * 0.08;
    }
    if (jc.ribbonL) jc.ribbonL.rotation.x = -0.25 - wind * 0.7 + flutter * 0.18;
    if (jc.ribbonR) jc.ribbonR.rotation.x = -0.3 - wind * 0.65 + flutter2 * 0.18;
    if (jc.ribbonL) jc.ribbonL.rotation.z = 0.25 + flutter2 * 0.08;
    if (jc.ribbonR) jc.ribbonR.rotation.z = -0.25 + flutter * 0.08;
    if (jc.tailL)
      jc.tailL.rotation.x = -0.2 - wind * 0.55 + flutter * 0.1 + Math.max(0, swing) * 0.15;
    if (jc.tailR)
      jc.tailR.rotation.x = -0.2 - wind * 0.55 + flutter2 * 0.1 + Math.max(0, swing2) * 0.15;
  });

  return (
    <group
      ref={(node) => {
        j.current.root = node;
        if (rootRef) rootRef.current = node;
      }}
    >
      {/* Contact shadow. A real shadow map at this sun angle costs more than it
          buys on a phone; one soft transparent quad sells the ground contact
          for the price of a draw call that is mostly alpha. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} renderOrder={2}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial color={PALETTE.umber950} transparent opacity={0.3} depthWrite={false} />
      </mesh>

      {/* The rig is modelled facing +z, but the runner heads down -z (the
          world streams toward the camera), so the body is turned to face the
          track. The flip sits INSIDE the root so the root's lane lean and
          flinch stay in world axes, and the body's forward lean now tips
          toward the direction of travel rather than at the camera. */}
      <group rotation={[0, Math.PI, 0]}>
        <group ref={set("body")}>
          {/* Legs hang off a group at hip height. The gown is a SIBLING of that
            group, not a child, so a swinging thigh can never drag the skirt
            with it — only the explicit sway below moves the fabric. */}
          <group position={[0, HIP_Y, 0]}>
            {(["L", "R"] as const).map((side) => (
              <group
                key={side}
                ref={set(side === "L" ? "thighL" : "thighR")}
                position={[side === "L" ? -0.115 : 0.115, 0, 0]}
              >
                <mesh geometry={L(0.082, 0.44, "thigh")} material={bride ? mat.skin : mat.tux} />
                {!bride && (
                  /* The satin side stripe: what makes trousers formalwear. */
                  <mesh
                    geometry={box(0.018, 0.42, 0.04)}
                    material={mat.satinInk}
                    position={[side === "L" ? -0.083 : 0.083, -0.22, 0]}
                  />
                )}
                <group ref={set(side === "L" ? "shinL" : "shinR")} position={[0, -0.44, 0]}>
                  <mesh geometry={L(0.07, 0.44, "shin")} material={bride ? mat.skin : mat.tux} />
                  {!bride && (
                    <mesh
                      geometry={box(0.018, 0.4, 0.04)}
                      material={mat.satinInk}
                      position={[side === "L" ? -0.072 : 0.072, -0.2, 0]}
                    />
                  )}
                  <Sneaker mat={mat} />
                </group>
              </group>
            ))}
          </group>

          {/* Gown / trousers seat. */}
          <group ref={set("skirt")} position={[0, HIP_Y, 0]}>
            {bride ? (
              <>
                {/* A-line gown: narrow at the waist, hem at 0.28 m — which is
                  exactly where the sneakers start showing. */}
                <mesh
                  geometry={C(0.19, 0.5, 1.0, 28)}
                  material={mat.ivory}
                  position={[0, -0.12, 0]}
                />
                {/* Sheer tulle overskirt, a touch wider and longer, so the edge of
                  the gown has depth instead of a single hard silhouette. */}
                <mesh
                  geometry={C(0.21, 0.56, 1.04, 28)}
                  material={mat.tulle}
                  position={[0, -0.14, 0]}
                />
                {/* Lace hem band and a scallop of lace at the waist seam. */}
                <mesh
                  geometry={C(0.505, 0.515, 0.07, 28)}
                  material={mat.lace}
                  position={[0, -0.585, 0]}
                />
                {Array.from({ length: 12 }, (_, i) => {
                  const a = (i / 12) * Math.PI * 2;
                  return (
                    <mesh
                      key={i}
                      geometry={S(0.04, 6)}
                      material={mat.lace}
                      position={[Math.sin(a) * 0.5, -0.54, Math.cos(a) * 0.5]}
                      scale={[1, 0.6, 0.5]}
                    />
                  );
                })}
                {/* The train: it trails from the back of the hem and drags. */}
                <group ref={set("train")} position={[0, -0.45, -0.32]}>
                  <mesh geometry={trainGeo} material={mat.ivory} rotation={[-1.35, 0, 0]} />
                  <mesh
                    geometry={trainGeo}
                    material={mat.tulle}
                    rotation={[-1.3, 0, 0]}
                    position={[0, 0.02, 0]}
                    scale={[1.08, 1.05, 1]}
                  />
                </group>
                {/* Satin sash with a big bow at the small of the back: the first
                  thing the chase camera sees. */}
                <mesh
                  geometry={C(0.205, 0.205, 0.08, 20)}
                  material={mat.satin}
                  position={[0, 0.36, 0]}
                />
                <group position={[0, 0.36, -0.2]}>
                  {[-1, 1].map((d) => (
                    <mesh
                      key={d}
                      geometry={S(0.085, 10)}
                      material={mat.satin}
                      position={[d * 0.085, 0.01, -0.02]}
                      scale={[1.2, 0.75, 0.45]}
                      rotation={[0, 0, d * 0.35]}
                    />
                  ))}
                  <mesh geometry={S(0.04, 8)} material={mat.satin} position={[0, 0, -0.04]} />
                  <group ref={set("ribbonL")} position={[-0.03, -0.02, -0.04]}>
                    <mesh
                      geometry={box(0.05, 0.42, 0.012)}
                      material={mat.satin}
                      position={[0, -0.21, 0]}
                    />
                  </group>
                  <group ref={set("ribbonR")} position={[0.03, -0.02, -0.04]}>
                    <mesh
                      geometry={box(0.05, 0.38, 0.012)}
                      material={mat.satin}
                      position={[0, -0.19, 0]}
                    />
                  </group>
                </group>
              </>
            ) : (
              <mesh geometry={C(0.2, 0.22, 0.44, 16)} material={mat.tux} position={[0, -0.02, 0]} />
            )}
          </group>

          {/* Torso. */}
          <group position={[0, HIP_Y, 0]}>
            {bride ? (
              <>
                {/* A fitted bodice, narrow at the waist, with a pearl edge along
                  the neckline and off-the-shoulder sleeves. */}
                <mesh
                  geometry={C(0.2, 0.165, 0.42, 18)}
                  material={mat.ivory}
                  position={[0, 0.6 - 0.28, 0]}
                  scale={[1, 1, 0.72]}
                />
                {Array.from({ length: 11 }, (_, i) => {
                  const a = (i / 10 - 0.5) * Math.PI * 1.1;
                  return (
                    <mesh
                      key={i}
                      geometry={S(0.016, 6)}
                      material={mat.pearl}
                      position={[Math.sin(a) * 0.19, 0.52, Math.cos(a) * 0.14]}
                    />
                  );
                })}
                {/* Bare shoulders above the bodice. */}
                <mesh
                  geometry={S(0.17, 14)}
                  material={mat.skin}
                  position={[0, 0.55, 0]}
                  scale={[1.35, 0.42, 0.8]}
                />
                {[-1, 1].map((d) => (
                  <mesh
                    key={d}
                    geometry={torusGeo}
                    material={mat.tulle}
                    position={[d * 0.215, 0.47, 0]}
                    rotation={[0, Math.PI / 2, d * 0.4]}
                  />
                ))}
                {/* Buttons down the back. */}
                {[0.2, 0.28, 0.36, 0.44].map((y) => (
                  <mesh
                    key={y}
                    geometry={S(0.013, 6)}
                    material={mat.pearl}
                    position={[0, y, -0.15]}
                  />
                ))}
              </>
            ) : (
              <>
                {/* A tailored jacket: broad at the shoulder, cut in at the waist. */}
                <mesh
                  geometry={C(0.24, 0.19, 0.46, 16)}
                  material={mat.tux}
                  position={[0, 0.32, 0]}
                  scale={[1, 1, 0.66]}
                />
                {[-1, 1].map((d) => (
                  <mesh
                    key={d}
                    geometry={S(0.085, 10)}
                    material={mat.tux}
                    position={[d * 0.22, 0.52, 0]}
                    scale={[1.1, 0.75, 1]}
                  />
                ))}
                {/* Shirt front, lapels, buttons, pocket square, boutonniere. */}
                <mesh
                  geometry={box(0.12, 0.3, 0.02)}
                  material={mat.shirt}
                  position={[0, 0.4, 0.152]}
                />
                {[-1, 1].map((d) => (
                  <mesh
                    key={d}
                    geometry={box(0.075, 0.3, 0.02)}
                    material={mat.satinInk}
                    position={[d * 0.075, 0.38, 0.158]}
                    rotation={[0, 0, d * -0.28]}
                  />
                ))}
                {[0.18, 0.26].map((y) => (
                  <mesh
                    key={y}
                    geometry={S(0.014, 6)}
                    material={mat.satinInk}
                    position={[0, y, 0.165]}
                  />
                ))}
                <mesh
                  geometry={box(0.06, 0.03, 0.02)}
                  material={mat.satin}
                  position={[0.12, 0.42, 0.16]}
                />
                <group position={[-0.12, 0.47, 0.17]}>
                  <mesh geometry={S(0.028, 8)} material={mat.bloom2} />
                  <mesh geometry={S(0.016, 6)} material={mat.leaf} position={[0.02, -0.025, 0]} />
                </group>
                {/* The back: collar and a centre seam the camera sees all run. */}
                <mesh
                  geometry={box(0.2, 0.05, 0.08)}
                  material={mat.tux}
                  position={[0, 0.56, -0.08]}
                />
                <mesh
                  geometry={box(0.012, 0.4, 0.01)}
                  material={mat.satinInk}
                  position={[0, 0.3, -0.158]}
                />
                {/* Split tails, each its own cloth joint. */}
                {(["L", "R"] as const).map((side) => (
                  <group
                    key={side}
                    ref={set(side === "L" ? "tailL" : "tailR")}
                    position={[side === "L" ? -0.08 : 0.08, 0.12, -0.13]}
                  >
                    <mesh
                      geometry={box(0.15, 0.44, 0.025)}
                      material={mat.tux}
                      position={[0, -0.22, 0]}
                    />
                  </group>
                ))}
              </>
            )}
            {/* Neck + head. */}
            <mesh
              geometry={C(0.055, 0.06, 0.1, 10)}
              material={mat.skinDeep}
              position={[0, 0.6, 0]}
            />
            <group ref={set("head")} position={[0, 0.74, 0]}>
              <mesh geometry={S(0.145, 18)} material={mat.skin} scale={[1, 1.06, 1]} />
              {/* Ears and a nose: tiny, but they turn a ball into a head. */}
              {[-1, 1].map((d) => (
                <mesh
                  key={d}
                  geometry={S(0.032, 8)}
                  material={mat.skinDeep}
                  position={[d * 0.142, 0, 0]}
                  scale={[0.5, 1, 0.8]}
                />
              ))}
              {!far && (
                <mesh geometry={S(0.02, 8)} material={mat.skinDeep} position={[0, -0.02, 0.145]} />
              )}
              {bride ? (
                <>
                  <mesh
                    geometry={S(0.153, 18)}
                    material={mat.hair}
                    scale={[1, 0.74, 1]}
                    position={[0, 0.045, -0.012]}
                  />
                  {/* The updo: a bun, wrapped, with a crown of small flowers round
                    it — the back of the head is what the player looks at. */}
                  <mesh geometry={S(0.085, 14)} material={mat.hair} position={[0, 0.05, -0.15]} />
                  <mesh
                    geometry={torusGeo}
                    material={mat.hair}
                    position={[0, 0.05, -0.15]}
                    scale={[0.55, 0.55, 0.55]}
                  />
                  {Array.from({ length: 7 }, (_, i) => {
                    const a = (i / 7) * Math.PI * 2;
                    return (
                      <mesh
                        key={i}
                        geometry={S(0.024, 8)}
                        material={i % 2 ? mat.bloom1 : mat.bloom2}
                        position={[Math.cos(a) * 0.088, 0.05 + Math.sin(a) * 0.088, -0.19]}
                      />
                    );
                  })}
                  {/* Two loose curls framing the face. */}
                  {[-1, 1].map((d) => (
                    <mesh
                      key={d}
                      geometry={L(0.018, 0.14, "curl")}
                      material={mat.hair}
                      position={[d * 0.13, -0.02, 0.05]}
                      rotation={[0, 0, d * 0.12]}
                    />
                  ))}
                  {!far &&
                    [-1, 1].map((d) => (
                      <mesh
                        key={d}
                        geometry={S(0.014, 6)}
                        material={mat.pearl}
                        position={[d * 0.15, -0.045, 0.01]}
                      />
                    ))}
                </>
              ) : (
                <>
                  <mesh
                    geometry={S(0.152, 16)}
                    material={mat.hair}
                    scale={[1, 0.62, 1.02]}
                    position={[0, 0.055, -0.01]}
                  />
                  {/* The quiff. */}
                  <mesh
                    geometry={S(0.08, 12)}
                    material={mat.hair}
                    position={[0.02, 0.12, 0.07]}
                    scale={[1.3, 0.6, 1]}
                    rotation={[0.3, 0, -0.2]}
                  />
                  <mesh
                    geometry={S(0.15, 14)}
                    material={mat.hair}
                    position={[0, 0.0, -0.035]}
                    scale={[1.02, 0.7, 0.9]}
                  />
                </>
              )}
              {!far && (
                <>
                  <mesh
                    geometry={S(0.017, 6)}
                    material={mat.eye}
                    position={[-0.05, 0.005, 0.135]}
                  />
                  <mesh geometry={S(0.017, 6)} material={mat.eye} position={[0.05, 0.005, 0.135]} />
                  <mesh
                    geometry={cheekGeo}
                    material={mat.cheek}
                    position={[-0.093, -0.035, 0.112]}
                    rotation={[0, -0.5, 0]}
                  />
                  <mesh
                    geometry={cheekGeo}
                    material={mat.cheek}
                    position={[0.093, -0.035, 0.112]}
                    rotation={[0, 0.5, 0]}
                  />
                </>
              )}
              {bride && !far && (
                /* The veil, on a pearl comb above the bun, trailing from the
                 crown. Two crossed planes so it reads from the chase camera and
                 from the side. */
                <group ref={set("veil")} position={[0, 0.1, -0.12]}>
                  <mesh geometry={box(0.16, 0.025, 0.03)} material={mat.pearl} />
                  <mesh geometry={veilGeo} material={mat.veil} position={[0, 0, -0.02]} />
                  <mesh geometry={veilGeo} material={mat.veil} rotation={[0, Math.PI / 2, 0]} />
                  <mesh
                    geometry={veilGeo}
                    material={mat.tulle}
                    position={[0, -0.02, -0.04]}
                    scale={[0.8, 0.82, 1]}
                  />
                </group>
              )}
            </group>
            {bride ? (
              /* The bouquet, carried in front of the chest rather than in a hand —
               attaching it to the hand would swing it through the gown on every
               stride and clip it through the body at full extension. */
              <group position={[0, 0.28, 0.24]}>
                {BOUQUET.map(([x, y, z, r], i) => (
                  <mesh
                    key={i}
                    geometry={S(r, 10)}
                    material={i % 3 === 0 ? mat.bloom2 : i % 3 === 1 ? mat.bloom1 : mat.blush}
                    position={[x, y, z]}
                  />
                ))}
                {[-0.6, 0, 0.6].map((a) => (
                  <mesh
                    key={a}
                    geometry={S(0.04, 6)}
                    material={mat.leaf}
                    position={[Math.sin(a) * 0.1, -0.03, Math.cos(a) * 0.04]}
                    scale={[1.4, 0.4, 0.8]}
                  />
                ))}
                <mesh
                  geometry={C(0.025, 0.018, 0.16, 8)}
                  material={mat.satin}
                  position={[0, -0.12, 0]}
                />
                <mesh
                  geometry={box(0.03, 0.2, 0.008)}
                  material={mat.satin}
                  position={[0.03, -0.24, 0]}
                  rotation={[0, 0, 0.15]}
                />
              </group>
            ) : (
              !far && (
                <group position={[0, 0.56, 0.12]}>
                  <mesh geometry={box(0.09, 0.05, 0.03)} material={mat.bow} />
                  <mesh geometry={box(0.035, 0.035, 0.035)} material={mat.bow} />
                </group>
              )
            )}
          </group>

          {/* Arms. Shoulders live on the torso group so they inherit its lean. */}
          <group position={[0, HIP_Y, 0]}>
            {(["L", "R"] as const).map((side) => (
              <group
                key={side}
                ref={set(side === "L" ? "armL" : "armR")}
                position={[side === "L" ? -0.25 : 0.25, 0.46, 0]}
              >
                <mesh geometry={L(0.058, 0.3, "upperArm")} material={bride ? mat.skin : mat.tux} />
                <group ref={set(side === "L" ? "foreL" : "foreR")} position={[0, -0.3, 0]}>
                  <mesh geometry={L(0.05, 0.28, "foreArm")} material={bride ? mat.skin : mat.tux} />
                  {!bride && (
                    /* A shirt cuff with a gold link, then the hand. */
                    <mesh
                      geometry={C(0.052, 0.052, 0.04, 10)}
                      material={mat.shirt}
                      position={[0, -0.25, 0]}
                    />
                  )}
                  {bride && (
                    <mesh
                      geometry={C(0.05, 0.05, 0.02, 10)}
                      material={mat.pearl}
                      position={[0, -0.24, 0]}
                    />
                  )}
                  <mesh
                    geometry={S(0.05, 10)}
                    material={mat.skin}
                    position={[0, -0.3, 0.01]}
                    scale={[0.9, 1.15, 0.7]}
                  />
                </group>
              </group>
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

/** One running sneaker: rounded toe, white upper, a blush stripe and a sole.
 *  The joke in the brief is that these are what the marathon is done in, so
 *  they deserve to look like real shoes. */
function Sneaker({ mat }: { mat: Record<string, THREE.Material> }) {
  return (
    <group position={[0, -0.42, 0.04]}>
      <mesh geometry={box(0.14, 0.085, 0.2)} material={mat.shirt} position={[0, 0, -0.02]} />
      <mesh
        geometry={S(0.072, 10)}
        material={mat.shirt}
        position={[0, -0.005, 0.08]}
        scale={[1, 0.6, 1.1]}
      />
      <mesh
        geometry={box(0.145, 0.02, 0.1)}
        material={mat.satin}
        position={[0, 0.005, 0.0]}
        rotation={[0.5, 0, 0]}
      />
      <mesh
        geometry={box(0.15, 0.032, 0.29)}
        material={mat.sneakerSole}
        position={[0, -0.045, 0.02]}
      />
    </group>
  );
}

/** Bouquet blooms: [x, y, z, radius]. Hand-placed into a dome. */
const BOUQUET: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0.03, 0.02, 0.065],
  [0.07, 0.01, 0.0, 0.05],
  [-0.07, 0.015, 0.0, 0.052],
  [0.035, 0.065, -0.02, 0.045],
  [-0.04, 0.06, -0.02, 0.045],
  [0.02, -0.03, 0.05, 0.045],
  [-0.03, -0.035, 0.045, 0.04],
  [0.08, -0.04, -0.02, 0.035],
  [-0.08, -0.04, -0.01, 0.035],
];

/** The cheek disc and the veil sheet, built once at module scope: both are
 *  identical for every rig in the scene and both are pure geometry. */
const cheekGeo = geo("cheek", () => new THREE.CircleGeometry(0.032, 24));
const veilGeo = geo("veil", () => new THREE.PlaneGeometry(0.56, 1.15, 4, 10));
// Translated down so the sheet hangs from the crown instead of straddling it.
veilGeo.translate(0, -0.575, 0);
/** The train: a tapered sheet built pointing down, laid back by its group so it
 *  drags behind the hem. */
const trainGeo = geo("train", () => {
  const g = new THREE.CylinderGeometry(0.34, 0.5, 0.75, 40, 4, true, Math.PI * 0.6, Math.PI * 0.8);
  g.translate(0, -0.375, 0);
  return g;
});
/** A thin ring, reused for the off-shoulder sleeves and the wrapped bun. */
const torusGeo = geo("rigTorus", () => new THREE.TorusGeometry(0.075, 0.03, 16, 36));
