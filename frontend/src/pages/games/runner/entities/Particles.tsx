/**
 * Everything that is not a solid: coins, confetti, dust, the "you just paid"
 * flash, and the vignette.
 *
 * ALL OF IT IS ONE POINTS CLOUD. A `THREE.Points` with a procedurally drawn
 * round sprite is the cheapest way to draw two hundred particles on a phone, and
 * the particle kinds differ only in their velocity, colour and lifetime — so they
 * share a buffer and differ only in a typed-array column. There is no per-particle
 * React component anywhere in this file, and there never should be: a particle
 * that lives for 0.6 s cannot afford a mount.
 *
 * THE POOL IS FIXED AND THERE IS NO GARBAGE COLLECTION. Dead slots are parked at
 * `y = -999` with a zero size, which is cheaper than a branch and cannot
 * accumulate: the worst case is a full buffer of invisible points.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { CONFETTI, DUST, PALETTE } from "../constants/palette";

const COUNT = 900;
/** Parked particles go here. Far enough that the fog eats them, close enough
 *  that they are inside the camera's frustum and do not cost a re-fit. */
const PARKED = -999;

type Kind = "confetti" | "coin" | "dust" | "cost" | "power";

/** Particles per request. A burst used to be ONE particle, which read as a
 *  flicker rather than as an event. */
const BURST: Readonly<Record<Kind, number>> = {
  coin: 7,
  cost: 16,
  dust: 6,
  confetti: 46,
  power: 30,
};

interface Particle {
  alive: boolean;
  kind: Kind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds left. */
  life: number;
  /** Total seconds, so the fade is `life / span` and one number covers both. */
  span: number;
  size: number;
  spin: number;
}

/** ONE sprite for all four kinds. A soft-edged rounded blob rather than a hard
 *  circle: a hard-edged square reads as a tumbling ribbon (which is what confetti
 *  should read as), and the same sprite with a soft edge reads as a spark or a
 *  puff of grit at the sizes involved. Two textures would mean two draw calls and
 *  two buffers for a difference nobody can see at 30 m/s. */
function sparkTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(10, 4, 44, 56, 12);
    ctx.fill();
    // Feather the edge so a square does not read as a hard chip.
    ctx.globalCompositeOperation = "destination-in";
    const g = ctx.createRadialGradient(32, 32, 8, 32, 32, 30);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.7, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export interface ParticlesProps {
  /** Live spawn requests, drained once a frame. The engine pushes a reason
   *  code and the position; the particle decides what that looks like. Because
   *  the buffer owns the motion, the engine never has to know what a "cost"
   *  particle is. */
  drain: () => ReadonlyArray<{ kind: Kind; x: number; y: number; z: number }>;
}

export function Particles({ drain }: ParticlesProps) {
  const points = useRef<THREE.Points>(null);
  const spark = useMemo(() => sparkTexture(), []);

  const state = useRef({
    pool: Array.from({ length: COUNT }, () => ({
      alive: false,
      kind: "confetti" as Kind,
      x: 0,
      y: PARKED,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      span: 1,
      size: 0,
      spin: 0,
    })),
    cursor: 0,
  });

  /** The GPU-side buffers. Reused across frames; only the used range is
   *  re-uploaded. */
  const buffers = useMemo(
    () => ({
      position: new Float32Array(COUNT * 3),
      color: new Float32Array(COUNT * 3),
      scale: new Float32Array(COUNT),
      alpha: new Float32Array(COUNT),
    }),
    [],
  );

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(buffers.position, 3));
    g.setAttribute("color", new THREE.BufferAttribute(buffers.color, 3));
    g.setAttribute("pscale", new THREE.BufferAttribute(buffers.scale, 1));
    g.setAttribute("palpha", new THREE.BufferAttribute(buffers.alpha, 1));
    // A fixed, generous sphere. The particles live inside a 30 m box around the
    // player, so an exact bound would only ever be a source of popping.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 60);
    return g;
  }, [buffers]);

  const material = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float pscale;
        attribute float palpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Size attenuation by hand: a Points material with a fixed pixel size
          // looks like a screen-space overlay, and a pure constant scale looks
          // like paper cut-outs. This is the middle.
          gl_PointSize = pscale * 260.0 / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        uniform sampler2D uSpark;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec4 tex = texture2D(uSpark, gl_PointCoord);
          if (tex.a < 0.02) discard;
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
        }
      `,
      uniforms: { uSpark: { value: spark } },
      vertexColors: true,
    });
    return m;
  }, [spark]);

  useFrame((_state, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const st = state.current;

    // 1. Drain the spawn requests. Ring-buffer the pool: the oldest particle is
    //    the one to sacrifice, which is invisible in practice because anything
    //    this old is already fading.
    for (const req of drain())
      for (let n = 0; n < BURST[req.kind]; n++) {
        const p = st.pool[st.cursor]!;
        st.cursor = (st.cursor + 1) % COUNT;
        p.alive = true;
        p.kind = req.kind;
        p.x = req.x;
        p.y = req.y;
        p.z = req.z;
        p.spin = Math.random() * Math.PI * 2;
        switch (req.kind) {
          case "coin":
            p.vx = (Math.random() - 0.5) * 1.6;
            p.vy = 1.6 + Math.random() * 1.4;
            p.vz = -2 - Math.random() * 3;
            p.life = 0.55;
            p.size = 0.16;
            break;
          case "cost":
            p.vx = (Math.random() - 0.5) * 2.4;
            p.vy = 2.4 + Math.random() * 1.6;
            p.vz = -1 - Math.random() * 2;
            p.life = 0.7;
            p.size = 0.2;
            break;
          case "power": {
            // A ring that blooms outward around the pickup.
            const a = Math.random() * Math.PI * 2;
            const r = 2.6 + Math.random() * 1.4;
            p.vx = Math.cos(a) * r;
            p.vy = Math.sin(a) * r * 0.8 + 0.6;
            p.vz = -2 - Math.random() * 2;
            p.life = 0.75;
            p.size = 0.18;
            break;
          }
          case "dust":
            p.vx = (Math.random() - 0.5) * 0.8;
            p.vy = 0.4 + Math.random() * 0.5;
            p.vz = -3 - Math.random() * 4;
            p.life = 0.4;
            p.size = 0.1;
            break;
          default:
            p.vx = (Math.random() - 0.5) * 5;
            p.vy = 3 + Math.random() * 4;
            p.vz = -3 - Math.random() * 6;
            p.life = 1.1 + Math.random() * 0.7;
            p.size = 0.15;
            break;
        }
        p.span = p.life;
      }

    // 2. Integrate, and write the visible range straight into the GPU buffers.
    const col = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const p = st.pool[i]!;
      const o = i * 3;
      if (!p.alive) {
        buffers.position[o + 1] = PARKED;
        buffers.alpha[i] = 0;
        buffers.scale[i] = 0;
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        p.y = PARKED;
        buffers.position[o + 1] = PARKED;
        buffers.alpha[i] = 0;
        buffers.scale[i] = 0;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      // Confetti falls; dust drifts; a coin spark is carried. Gravity per kind is
      // the only per-kind integration difference, which is why one loop can draw
      // four looks.
      if (p.kind === "confetti") p.vy -= 7 * dt;
      else if (p.kind === "cost") p.vy -= 4 * dt;

      const t = p.life / p.span;
      buffers.position[o] = p.x;
      buffers.position[o + 1] = p.y;
      buffers.position[o + 2] = p.z;
      buffers.scale[i] = p.size * (p.kind === "confetti" ? 1 + (1 - t) * 0.6 : 1);
      // Fade in fast, out slow — a linear fade makes a burst look like a leak.
      buffers.alpha[i] = Math.min(1, (1 - t) * 2.2);

      col.set(colorFor(p.kind));
      // Confetti takes its colour from the palette TABLE by the particle's own
      // spin angle, so a burst is multicoloured and the choice is free.
      if (p.kind === "confetti")
        col.set(CONFETTI[Math.floor(p.spin) % CONFETTI.length] ?? PALETTE.blush300);
      buffers.color[o] = col.r;
      buffers.color[o + 1] = col.g;
      buffers.color[o + 2] = col.b;
    }

    const g = points.current?.geometry;
    if (!g) return;
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("pscale") as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute("palpha") as THREE.BufferAttribute).needsUpdate = true;
  });

  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}

function colorFor(kind: Kind) {
  switch (kind) {
    case "coin":
      return PALETTE.gold;
    case "cost":
      return PALETTE.blush600;
    case "dust":
      return DUST;
    case "power":
      return PALETTE.shield;
    default:
      return PALETTE.blush400;
  }
}
