/**
 * The garden the whole thing happens in, streamed.
 *
 * THE WORLD NEVER MOVES. The player is pinned at z = 0 and everything that
 * matters travels toward +z, so nothing here has to advance along the track: a
 * tree's z is `mod(tree.zBase + distance, SPAN) - SPAN`, which is a modulo of one
 * number against the distance the player has run. That is the entire trick that
 * makes an endless garden out of a fixed mesh count, and it is why `distance` is
 * passed in as a plain number rather than the renderer keeping its own odometer.
 *
 * THREE SEGMENTS, EACH `SPAN` LONG, each recycled. At the tightest row gap the
 * player can see roughly 90 m of track before the fog closes, so `SPAN = 30`
 * with three segments gives 90 m of depth with three copies of everything. The
 * fog does the hiding: anything past it is not drawn and not needed.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { FOG_COLOR, PALETTE, SKY_HORIZON, SKY_TOP } from "../constants/palette";
import { M, box, cone, cylinder, sphere } from "../constants/materials";
import { lawnTexture, pathTexture } from "../utils/textures";

/** Length of one recycled segment, in metres. */
const SPAN = 30;
/** How many of them exist. 3 × 30 m = 90 m of visible track. */
const SEGMENTS = 3;
/** How far ahead the fog starts, and where it is solid. These two numbers are
 *  the depth cue: everything past `FOG_FAR` is the fog colour, which is why the
 *  garden can end without an edge being visible. */
const FOG_NEAR = 34;
const FOG_FAR = 92;

/** A deterministic scatter, so the garden is the same garden every run and a
 *  bug report can be reproduced. Same LCG as the gravel in `textures.ts`. */
function lcg(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a scattered prop IS, not how many there are. A union rather than an open
 *  number, so the switch that draws them is exhaustively checked and a new kind
 *  cannot be added without deciding how it looks. */
type PropKind = "tree" | "treeRound" | "treeSpire" | "treeBlossom" | "shrub" | "lamp" | "bench";

interface Prop {
  readonly z: number;
  readonly x: number;
  readonly kind: PropKind;
  readonly scale: number;
  readonly spin: number;
}

/** One tree. Four canopy shapes are the whole forest vocabulary, and three of
 *  them are spheres and one is a cone — a garden of six different cones reads as
 *  a low-poly asset pack, and four named silhouettes read as a garden. */
function Tree({ variant }: { variant: "open" | "round" | "spire" | "blossom" }) {
  return (
    <group>
      <mesh geometry={cylinder(0.16, 0.28, 3.4, 7)} material={M.bark()} position={[0, 1.7, 0]} />
      <mesh
        geometry={sphere(1.5, 10)}
        material={M.leaf()}
        position={[0, 4.1, 0]}
        scale={[1, variant === "spire" ? 0.6 : 0.9, 1]}
      />
      <mesh geometry={sphere(1.05, 9)} material={M.leafLight()} position={[0.7, 3.3, 0.3]} />
      {(variant === "round" || variant === "blossom") && (
        <>
          <mesh geometry={sphere(0.22, 8)} material={M.blossom()} position={[-0.9, 3.9, 0.5]} />
          <mesh geometry={sphere(0.18, 8)} material={M.blossomPale()} position={[0.2, 4.6, -0.6]} />
          <mesh geometry={sphere(0.15, 8)} material={M.bouquet()} position={[0.9, 4.2, 0.2]} />
        </>
      )}
      {variant === "spire" && (
        <mesh geometry={cone(0.6, 1.4, 8)} material={M.leaf()} position={[-0.5, 2.4, -0.4]} />
      )}
    </group>
  );
}

/** A round shrub, planted along the path edge where the hedge would be too
 *  regular. */
function Shrub() {
  return (
    <group>
      <mesh
        geometry={sphere(0.62, 9)}
        material={M.hedge()}
        position={[0, 0.5, 0]}
        scale={[1.2, 0.8, 1]}
      />
      <mesh geometry={sphere(0.4, 8)} material={M.leaf()} position={[0.5, 0.42, 0.3]} />
      <mesh geometry={sphere(0.14, 7)} material={M.blossom()} position={[-0.3, 0.86, 0.3]} />
    </group>
  );
}

/** A lamp post. Two of these per segment on alternating sides is the only
 *  vertical rhythm the path has. */
function Lamp() {
  return (
    <group>
      <mesh geometry={cylinder(0.07, 0.11, 3.4, 8)} material={M.lamp()} position={[0, 1.7, 0]} />
      <mesh geometry={sphere(0.22, 10)} material={M.bulb()} position={[0, 3.5, 0]} />
      <mesh geometry={cone(0.3, 0.3, 8)} material={M.lamp()} position={[0, 3.8, 0]} />
      <mesh geometry={cylinder(0.26, 0.3, 0.16, 10)} material={M.stone()} position={[0, 0.08, 0]} />
    </group>
  );
}

/** A bench, facing the path. Somewhere for the guests to watch the bride run. */
function Bench() {
  return (
    <group>
      <mesh geometry={box(1.9, 0.1, 0.6)} material={M.bark()} position={[0, 0.46, 0]} />
      <mesh
        geometry={box(1.9, 0.5, 0.1)}
        material={M.bark()}
        position={[0, 0.72, -0.26]}
        rotation={[0.2, 0, 0]}
      />
      {[-0.82, 0.82].map((x) => (
        <mesh
          key={x}
          geometry={box(0.1, 0.46, 0.56)}
          material={M.stone()}
          position={[x, 0.23, 0]}
        />
      ))}
    </group>
  );
}

export interface EnvironmentProps {
  /** Metres travelled. Read once a frame from the engine. */
  distance: () => number;
}

export function Environment({ distance }: EnvironmentProps) {
  const segments = useRef<(THREE.Group | null)[]>([]);

  /** The scatter, built once. Trees outside the path, alternating sides, never
   *  in a lane; the lane count is `LANE_WIDTH * 3` wide and everything here is
   *  at |x| > 3.4. */
  const props = useMemo<Prop[][]>(() => {
    const rand = lcg(0x5eed1a);
    return Array.from({ length: SEGMENTS }, (_unused, s) => {
      const out: Prop[] = [];
      const TREES: readonly PropKind[] = ["tree", "treeRound", "treeSpire", "treeBlossom"];
      for (let i = 0; i < 9; i++) {
        const side = rand() < 0.5 ? -1 : 1;
        out.push({
          z: (i / 9) * SPAN + rand() * 2,
          x: side * (3.6 + rand() * 7),
          kind: TREES[Math.floor(rand() * TREES.length)] ?? "tree",
          scale: 0.8 + rand() * 0.6,
          spin: rand() * Math.PI * 2,
        });
      }
      for (let i = 0; i < 5; i++) {
        const side = rand() < 0.5 ? -1 : 1;
        out.push({
          z: (i / 5) * SPAN + rand() * 3,
          x: side * (2.9 + rand() * 0.7),
          kind: "shrub",
          scale: 0.8 + rand() * 0.5,
          spin: 0,
        });
      }
      out.push({ z: 8, x: -4.3, kind: "lamp", scale: 1, spin: 0 });
      out.push({ z: 21, x: 4.3, kind: "lamp", scale: 1, spin: 0 });
      out.push({ z: 4, x: 5.4, kind: "bench", scale: 1, spin: 0 });
      out.push({ z: 17, x: -5.4, kind: "bench", scale: 1, spin: 0 });
      return out;
    });
  }, []);

  const path = useMemo(() => pathTexture(), []);
  const lawn = useMemo(() => lawnTexture(), []);
  const sky = useMemo(() => skyGradient(), []);

  useFrame(() => {
    const d = distance();
    for (let s = 0; s < SEGMENTS; s++) {
      const node = segments.current[s];
      if (!node) continue;
      // The modulo is per segment, so each one slides forward a segment's worth
      // at a time and jumps back — which happens behind the fog.
      const z = ((s * SPAN + d) % (SPAN * SEGMENTS)) - SPAN * (SEGMENTS - 1);
      node.position.z = z;
    }
  });

  return (
    <>
      {/* Sky. A large inverted sphere with a vertical gradient — cheaper than a
          skybox image and it tints with the fog for free. */}
      <mesh scale={[-1, 1, 1]} renderOrder={-2}>
        <sphereGeometry args={[200, 16, 12]} />
        <meshBasicMaterial map={sky} side={THREE.BackSide} depthWrite={false} fog={false} />
      </mesh>

      <fog attach="fog" args={[FOG_COLOR, FOG_NEAR, FOG_FAR]} />

      {/* The ground plane the path and the lawn sit on. One draw call, one
          texture, no geometry to stream: a flat plane cannot be a bottleneck
          and it never has to be recycled because it is infinitely long. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -FOG_FAR]}>
        <planeGeometry args={[90, FOG_FAR * 2.4]} />
        <meshStandardMaterial map={lawn} roughness={0.95} />
      </mesh>

      {/* The path. Three lane-widths of gravel with the seams from
          `pathTexture` landing between the lanes. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, -FOG_FAR]}>
        <planeGeometry args={[5.4, FOG_FAR * 2.4]} />
        <meshStandardMaterial map={path} roughness={0.92} />
      </mesh>

      {props.map((list, s) => (
        <group
          key={s}
          ref={(node) => {
            segments.current[s] = node;
          }}
        >
          {list.map((p, i) => (
            <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.spin, 0]} scale={p.scale}>
              {p.kind === "tree" && <Tree variant="open" />}
              {p.kind === "treeRound" && <Tree variant="round" />}
              {p.kind === "treeSpire" && <Tree variant="spire" />}
              {p.kind === "treeBlossom" && <Tree variant="blossom" />}
              {p.kind === "shrub" && <Shrub />}
              {p.kind === "lamp" && <Lamp />}
              {p.kind === "bench" && <Bench />}
            </group>
          ))}
        </group>
      ))}
    </>
  );
}

/** The sky's vertical gradient, drawn once into a 2 × 64 canvas and stretched
 *  over the dome. Deliberately not a flat colour: a flat sky reads as a void,
 *  and the whole scene is a warm late afternoon. */
function skyGradient() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(0.62, SKY_HORIZON);
    grad.addColorStop(1, PALETTE.fog);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export { FOG_FAR as GARDEN_FOG_FAR, FOG_NEAR as GARDEN_FOG_NEAR };
