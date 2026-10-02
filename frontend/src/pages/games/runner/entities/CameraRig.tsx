/**
 * The chase camera, and the shot it lives in.
 *
 * It never cuts and it never orbits. A runner camera that swings reads as a
 * different game every few seconds, and the one thing this camera has to do is
 * keep the NEXT TWO ROWS on screen while leaving enough headroom that a jump apex
 * is visible before the player has to commit to it.
 *
 * Everything is damped toward a target with a time constant, so the camera lags
 * the player by a fixed fraction of a second rather than snapping. The four
 * things it reacts to:
 *
 *  - LANE. The camera sits behind the player's own x, so a lane change is a pan
 *    rather than a turn, and the horizon never rolls.
 *  - SPEED. It pulls back, rises and widens with the ramp, which is the only cue
 *    that tells a player the game is speeding up before they have processed a
 *    single new obstacle.
 *  - SHAKE. A decaying 2D offset from `state.shake`, plus a short roll. Applied
 *    LAST, after the damped position, so a hit jolts the frame instead of
 *    feeding back into the damping.
 *  - GAME OVER. The dolly stops following and settles, so the final frame of a
 *    run is a held shot of the garden rather than a run-away one.
 *
 * THE FOV AND THE DOLLY READ THE SAME NUMBER. `speedFraction` is one pure
 * function of the engine's speed, called by both, precisely so the pull-back and
 * the widening cannot disagree — a camera that dollies back without widening
 * reads as the world shrinking, which is the opposite of speed.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { RunState } from "../engine/RunEngine";

/** Framerate-independent damping factor for a time constant. */
const damp = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

/** 0 at the slowest cruise, 1 at the fastest. Clamped, so a stumble — which
 *  drops `speed` for half a second — cannot slam the camera forward and back.
 *  The camera reads `cruiseSpeed`, NOT `speed`: the stumble is for the player to
 *  feel, and a camera that lurches with it says the GAME slowed down. */
function speedFraction(speed: number) {
  return Math.min(1, Math.max(0, (speed - 8) / 26));
}

export interface CameraRigProps {
  /** The engine's live state, read once a frame. */
  readState: () => RunState;
}

export function CameraRig({ readState }: CameraRigProps) {
  const { camera, gl, scene } = useThree();
  const p = useRef({ x: 0, y: 3.1, z: 6.4, look: 1.05, roll: 0, fov: 62 });

  useFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const s = readState();
    const cur = p.current;
    const t = speedFraction(s.cruiseSpeed);

    // The dolly. `over` widens the targets a little and drops the follow rate,
    // so the last frame of a run is a slower, wider, held shot.
    const settle = s.phase === "over" ? 0.55 : 1;
    const targetX = s.x * 0.62;
    const targetY = 2.55 + t * 1.15 + s.y * 0.22;
    const targetZ = 6.0 + t * 2.1 + (s.phase === "over" ? 1.2 : 0);
    const targetLook = 1.05 + s.y * 0.34;

    const k = damp(dt, 0.19 * settle);
    cur.x += (targetX - cur.x) * k;
    cur.y += (targetY - cur.y) * k;
    cur.z += (targetZ - cur.z) * k;
    cur.look += (targetLook - cur.look) * damp(dt, 0.13 * settle);

    // The shake is a HIGH-FREQUENCY offset: it must not be damped, because a
    // damped shake reads as a wobble. The engine decays `shake` for us.
    const jolt = s.phase === "over" ? 0 : s.shake;
    const jx = (Math.sin(s.lane * 31.7) * 0.06 + Math.random() * 0.5 - 0.25) * jolt;
    const jy = (Math.cos(s.lane * 19.3) * 0.05 + Math.random() * 0.35 - 0.175) * jolt;

    camera.position.set(cur.x + jx, cur.y + jy, cur.z);
    camera.lookAt(cur.x * 0.4, cur.look, -6);

    // A little roll into the shake, so a hit is felt in the frame's GEOMETRY and
    // not only in its position.
    cur.roll += ((Math.random() - 0.3) * 0.06 * jolt - cur.roll) * damp(dt, 0.05);
    camera.rotation.z += cur.roll;

    // The widening, off the same `t` as the dolly above: a camera that pulls
    // back without widening reads as the world shrinking, which is the exact
    // opposite of speed.
    cur.fov += (62 + t * 12 - cur.fov) * damp(dt, 0.3);
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.isPerspectiveCamera && Math.abs(cam.fov - cur.fov) > 0.01) {
      cam.fov = cur.fov;
      cam.updateProjectionMatrix();
    }
  });

  // Renderer and scene setup belongs to the shot, so it happens once here rather
  // than in a second component that would have to be mounted alongside this one.
  const target = scene as THREE.Scene;
  if (!target.userData.shotInit) {
    target.userData.shotInit = true;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.06;
  }

  return null;
}
