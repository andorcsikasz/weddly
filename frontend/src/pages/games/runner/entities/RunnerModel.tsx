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
import { M, box, cylinder, geo, limb, sphere } from "../constants/materials";
import { PALETTE } from "../constants/palette";
import type { RunnerCharacter } from "../engine/RunEngine";

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
            <group ref={set("thighL")} position={[-0.115, 0, 0]}>
              <mesh geometry={limb(0.082, 0.44, "thigh")} material={bride ? mat.skin : mat.tux} />
              <group ref={set("shinL")} position={[0, -0.44, 0]}>
                <mesh geometry={limb(0.07, 0.44, "shin")} material={bride ? mat.skin : mat.tux} />
                {/* Running sneakers, visible under the hem. The joke in the brief
                  is that these are what the marathon is actually done in. */}
                <mesh
                  geometry={box(0.15, 0.09, 0.26)}
                  material={mat.shirt}
                  position={[0, -0.42, 0.05]}
                />
                <mesh
                  geometry={box(0.16, 0.03, 0.27)}
                  material={mat.sneakerSole}
                  position={[0, -0.462, 0.05]}
                />
              </group>
            </group>
            <group ref={set("thighR")} position={[0.115, 0, 0]}>
              <mesh geometry={limb(0.082, 0.44, "thigh")} material={bride ? mat.skin : mat.tux} />
              <group ref={set("shinR")} position={[0, -0.44, 0]}>
                <mesh geometry={limb(0.07, 0.44, "shin")} material={bride ? mat.skin : mat.tux} />
                <mesh
                  geometry={box(0.15, 0.09, 0.26)}
                  material={mat.shirt}
                  position={[0, -0.42, 0.05]}
                />
                <mesh
                  geometry={box(0.16, 0.03, 0.27)}
                  material={mat.sneakerSole}
                  position={[0, -0.462, 0.05]}
                />
              </group>
            </group>
          </group>

          {/* Gown / trousers. */}
          <group ref={set("skirt")} position={[0, HIP_Y, 0]}>
            {bride ? (
              <>
                {/* A-line gown: narrow at the waist, hem at 0.28 m — which is
                  exactly where the sneakers start showing. */}
                <mesh
                  geometry={cylinder(0.2, 0.5, 1.0, 18)}
                  material={mat.ivory}
                  position={[0, -0.12, 0]}
                />
                <mesh
                  geometry={cylinder(0.19, 0.21, 0.2, 14)}
                  material={mat.ivory}
                  position={[0, 0.3, 0]}
                />
                {/* Blush sash at the waist — the one warm accent on the ivory. */}
                <mesh
                  geometry={cylinder(0.215, 0.215, 0.09, 16)}
                  material={mat.blush}
                  position={[0, 0.36, 0]}
                />
              </>
            ) : (
              <mesh
                geometry={cylinder(0.2, 0.22, 0.44, 14)}
                material={mat.tux}
                position={[0, -0.02, 0]}
              />
            )}
          </group>

          {/* Torso. */}
          <group position={[0, HIP_Y, 0]}>
            <mesh
              geometry={box(0.42, 0.46, 0.25)}
              material={bride ? mat.ivory : mat.tux}
              position={[0, 0.32, 0]}
            />
            {bride ? (
              <mesh geometry={box(0.44, 0.1, 0.26)} material={mat.ivory} position={[0, 0.5, 0]} />
            ) : (
              <>
                {/* Shirt front + blush lapels. The lining is what stops a black
                  tux from reading as a rectangle at this camera distance. */}
                <mesh
                  geometry={box(0.16, 0.4, 0.26)}
                  material={mat.shirt}
                  position={[0, 0.34, 0.005]}
                />
                <mesh
                  geometry={box(0.1, 0.34, 0.02)}
                  material={mat.lining}
                  position={[0.09, 0.32, 0.13]}
                />
                <mesh
                  geometry={box(0.1, 0.34, 0.02)}
                  material={mat.lining}
                  position={[-0.09, 0.32, 0.13]}
                />
                {/* Jacket tails, kicked back so the tux reads as a suit in motion. */}
                <mesh
                  geometry={box(0.34, 0.38, 0.03)}
                  material={mat.tux}
                  position={[0, -0.04, -0.14]}
                  rotation={[-0.22, 0, 0]}
                />
              </>
            )}
            {/* Neck + head. */}
            <mesh
              geometry={cylinder(0.055, 0.06, 0.1, 8)}
              material={mat.skinDeep}
              position={[0, 0.6, 0]}
            />
            <group ref={set("head")} position={[0, 0.74, 0]}>
              <mesh geometry={sphere(0.145, 14)} material={mat.skin} />
              {bride ? (
                <>
                  <mesh
                    geometry={sphere(0.152, 14)}
                    material={mat.hair}
                    scale={[1, 0.72, 1]}
                    position={[0, 0.045, -0.01]}
                  />
                  <mesh
                    geometry={sphere(0.075, 10)}
                    material={mat.hair}
                    position={[0, 0.03, -0.15]}
                  />
                </>
              ) : (
                <mesh
                  geometry={sphere(0.15, 12)}
                  material={mat.hair}
                  scale={[1, 0.6, 1]}
                  position={[0, 0.05, 0]}
                />
              )}
              {!far && (
                <>
                  <mesh
                    geometry={sphere(0.017, 6)}
                    material={mat.eye}
                    position={[-0.05, 0.005, 0.128]}
                  />
                  <mesh
                    geometry={sphere(0.017, 6)}
                    material={mat.eye}
                    position={[0.05, 0.005, 0.128]}
                  />
                  <mesh
                    geometry={cheekGeo}
                    material={mat.cheek}
                    position={[-0.093, -0.035, 0.105]}
                    rotation={[0, -0.5, 0]}
                  />
                  <mesh
                    geometry={cheekGeo}
                    material={mat.cheek}
                    position={[0.093, -0.035, 0.105]}
                    rotation={[0, 0.5, 0]}
                  />
                </>
              )}
              {bride && !far && (
                /* The veil, trailing from the crown. Two crossed planes so it
                 reads from the chase camera and from the side. */
                <group ref={set("veil")} position={[0, 0.06, -0.06]}>
                  <mesh geometry={veilGeo} material={mat.veil} position={[0, 0, -0.02]} />
                  <mesh geometry={veilGeo} material={mat.veil} rotation={[0, Math.PI / 2, 0]} />
                </group>
              )}
            </group>
            {bride ? (
              /* The bouquet, carried in front of the chest rather than in a hand —
               attaching it to the hand would swing it through the gown on every
               stride and clip it through the body at full extension. */
              <group position={[0, 0.3, 0.22]}>
                <mesh geometry={sphere(0.075, 10)} material={mat.bloom1} scale={[1, 0.85, 1]} />
                <mesh
                  geometry={sphere(0.05, 8)}
                  material={mat.blush}
                  position={[0.06, 0.02, 0.02]}
                />
                <mesh
                  geometry={sphere(0.04, 8)}
                  material={mat.bloom2}
                  position={[-0.04, -0.08, 0.03]}
                />
                <mesh
                  geometry={cylinder(0.012, 0.012, 0.18, 6)}
                  material={mat.leaf}
                  position={[0, -0.12, 0]}
                  rotation={[0.5, 0, 0.3]}
                />
              </group>
            ) : (
              !far && (
                <group position={[0, 0.56, 0.1]}>
                  <mesh geometry={box(0.09, 0.06, 0.03)} material={mat.bow} />
                  <mesh geometry={box(0.035, 0.035, 0.035)} material={mat.bow} />
                </group>
              )
            )}
          </group>

          {/* Arms. Shoulders live on the torso group so they inherit its lean. */}
          <group position={[0, HIP_Y, 0]}>
            <group ref={set("armL")} position={[-0.24, 0.44, 0]}>
              <mesh geometry={limb(0.058, 0.3, "upperArm")} material={bride ? mat.skin : mat.tux} />
              <group ref={set("foreL")} position={[0, -0.3, 0]}>
                <mesh geometry={limb(0.05, 0.28, "foreArm")} material={mat.skin} />
                <mesh geometry={sphere(0.055, 8)} material={mat.skin} position={[0, -0.28, 0]} />
              </group>
            </group>
            <group ref={set("armR")} position={[0.24, 0.44, 0]}>
              <mesh geometry={limb(0.058, 0.3, "upperArm")} material={bride ? mat.skin : mat.tux} />
              <group ref={set("foreR")} position={[0, -0.3, 0]}>
                <mesh geometry={limb(0.05, 0.28, "foreArm")} material={mat.skin} />
                <mesh geometry={sphere(0.055, 8)} material={mat.skin} position={[0, -0.28, 0]} />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/** The cheek disc and the veil sheet, built once at module scope: both are
 *  identical for every rig in the scene and both are pure geometry. */
const cheekGeo = geo("cheek", () => new THREE.CircleGeometry(0.032, 10));
const veilGeo = geo("veil", () => new THREE.PlaneGeometry(0.52, 0.92, 1, 3));
// Translated down so the sheet hangs from the crown instead of straddling it.
veilGeo.translate(0, -0.46, 0);
