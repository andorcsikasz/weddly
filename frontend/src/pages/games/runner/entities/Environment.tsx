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
import type { ComponentType } from "react";
import { VENUE_IDS, type VenueId } from "@shared/runner";
import {
  Barn,
  Barrel,
  CastleWall,
  Cypress,
  Fence,
  HayBale,
  Jetty,
  Reeds,
  StringLights,
  Topiary,
  Tower,
  VineRow,
  Willow,
} from "./VenueScenery";
import * as THREE from "three";
import { FOG_COLOR, PALETTE, SKY_HORIZON, SKY_MID, SKY_TOP, SUN } from "../constants/palette";
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
type PropKind =
  | "tree"
  | "treeRound"
  | "treeSpire"
  | "treeBlossom"
  | "shrub"
  | "lamp"
  | "bench"
  | "tower"
  | "castleWall"
  | "topiary"
  | "vineRow"
  | "barrel"
  | "cypress"
  | "willow"
  | "reeds"
  | "jetty"
  | "barn"
  | "hay"
  | "fence"
  | "stringLights";

/** How each venue tints the lawn and the path. White is the texture as drawn. */
const VENUE_TINT: Readonly<Record<VenueId, { lawn: string; path: string }>> = {
  garden: { lawn: PALETTE.white, path: PALETTE.white },
  castle: { lawn: PALETTE.venueCastleLawn, path: PALETTE.venueCastlePath },
  vineyard: { lawn: PALETTE.venueVineyardLawn, path: PALETTE.venueVineyardPath },
  lakeside: { lawn: PALETTE.venueLakeLawn, path: PALETTE.white },
  barn: { lawn: PALETTE.venueBarnLawn, path: PALETTE.venueBarnPath },
};

/** The scatter for one venue: one list of props per road segment. Seeded per
 *  venue so each place is the same place every visit. */
function scatterFor(venue: VenueId): Prop[][] {
  const rand = lcg(0x5eed1a + VENUE_IDS.indexOf(venue) * 7919);
  const side = () => (rand() < 0.5 ? -1 : 1);
  return Array.from({ length: SEGMENTS }, () => {
    const out: Prop[] = [];
    const push = (kind: PropKind, z: number, x: number, scale = 1, spin = 0) =>
      out.push({ kind, z, x, scale, spin });
    if (venue === "garden") {
      const TREES: readonly PropKind[] = ["tree", "treeRound", "treeSpire", "treeBlossom"];
      for (let i = 0; i < 9; i++) {
        const kind = TREES[Math.floor(rand() * TREES.length)] ?? "tree";
        push(
          kind,
          (i / 9) * SPAN + rand() * 2,
          side() * (3.6 + rand() * 7),
          0.8 + rand() * 0.6,
          rand() * 6.28,
        );
      }
      for (let i = 0; i < 5; i++)
        push(
          "shrub",
          (i / 5) * SPAN + rand() * 3,
          side() * (2.9 + rand() * 0.7),
          0.8 + rand() * 0.5,
        );
      push("lamp", 8, -4.3);
      push("lamp", 21, 4.3);
      push("bench", 4, 5.4);
      push("bench", 17, -5.4);
    } else if (venue === "castle") {
      for (const z of [6, 22]) {
        push("castleWall", z, -5.2);
        push("castleWall", z, 5.2);
      }
      push("tower", 14, side() * 9, 0.9 + rand() * 0.3);
      push("tower", 28, side() * 11, 0.8 + rand() * 0.3);
      for (let i = 0; i < 6; i++) push("topiary", (i / 6) * SPAN + 2, (i % 2 ? -1 : 1) * 3.4, 0.9);
      for (let i = 0; i < 3; i++) push("treeSpire", rand() * SPAN, side() * (13 + rand() * 6), 1.1);
    } else if (venue === "vineyard") {
      for (let i = 0; i < 6; i++) {
        push("vineRow", (i / 6) * SPAN + 1, -9);
        push("vineRow", (i / 6) * SPAN + 3, 9);
      }
      for (let i = 0; i < 4; i++)
        push("cypress", (i / 4) * SPAN + rand() * 3, side() * (3.8 + rand()), 0.9 + rand() * 0.4);
      for (let i = 0; i < 3; i++)
        push("barrel", rand() * SPAN, side() * (3.4 + rand() * 0.6), 1, rand() * 3);
    } else if (venue === "lakeside") {
      for (let i = 0; i < 4; i++)
        push(
          "willow",
          (i / 4) * SPAN + rand() * 4,
          side() * (4.2 + rand() * 1.4),
          0.9 + rand() * 0.3,
          rand() * 3,
        );
      for (let i = 0; i < 6; i++)
        push("reeds", (i / 6) * SPAN + rand() * 2, side() * (5.8 + rand() * 1.2));
      push("jetty", 15, side() * 9, 1, Math.PI / 2);
      push("lamp", 10, -4.3);
      push("lamp", 25, 4.3);
    } else {
      push("barn", 12, side() * 11, 1, rand() < 0.5 ? -Math.PI / 2 : Math.PI / 2);
      for (let i = 0; i < 4; i++)
        push("hay", (i / 4) * SPAN + rand() * 3, side() * (3.8 + rand() * 2), 1, rand() * 2);
      for (const z of [6, 20]) {
        push("fence", z, -3.3);
        push("fence", z, 3.3);
      }
      push("stringLights", 13, -3.9);
      push("stringLights", 27, 3.9);
      for (let i = 0; i < 3; i++)
        push("tree", rand() * SPAN, side() * (14 + rand() * 6), 1.1, rand() * 3);
    }
    return out;
  });
}

const PROP_BODY: Readonly<Record<PropKind, ComponentType>> = {
  tree: () => <Tree variant="open" />,
  treeRound: () => <Tree variant="round" />,
  treeSpire: () => <Tree variant="spire" />,
  treeBlossom: () => <Tree variant="blossom" />,
  shrub: Shrub,
  lamp: Lamp,
  bench: Bench,
  tower: Tower,
  castleWall: CastleWall,
  topiary: Topiary,
  vineRow: VineRow,
  barrel: Barrel,
  cypress: Cypress,
  willow: Willow,
  reeds: Reeds,
  jetty: Jetty,
  barn: Barn,
  hay: HayBale,
  fence: Fence,
  stringLights: StringLights,
};

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
  /** Which venue lines the road right now. */
  venue: () => VenueId;
}

export function Environment({ distance, venue }: EnvironmentProps) {
  const segments = useRef<(THREE.Group | null)[]>([]);

  /** Every venue's scatter, built once. Only the current venue's groups are
   *  visible; the switch happens at a fork, under the camera whip. */
  const props = useMemo(
    () => Object.fromEntries(VENUE_IDS.map((v) => [v, scatterFor(v)])) as Record<VenueId, Prop[][]>,
    [],
  );
  const venueGroups = useRef<Partial<Record<VenueId, THREE.Group | null>>>({});
  const lawnMat = useRef<THREE.MeshStandardMaterial>(null);
  const pathMat = useRef<THREE.MeshStandardMaterial>(null);
  const water = useRef<THREE.Group>(null);
  const tint = useMemo(() => ({ lawn: new THREE.Color(), path: new THREE.Color() }), []);

  const path = useMemo(() => pathTexture(), []);
  const lawn = useMemo(() => lawnTexture(), []);
  const sky = useMemo(() => skyGradient(), []);

  useFrame((_, dt) => {
    const d = distance();
    const current = venue();
    for (const v of VENUE_IDS) {
      const g = venueGroups.current[v];
      if (g) g.visible = v === current;
    }
    if (water.current) water.current.visible = current === "lakeside";
    const k = 1 - Math.exp(-dt / 0.25);
    tint.lawn.set(VENUE_TINT[current].lawn);
    tint.path.set(VENUE_TINT[current].path);
    lawnMat.current?.color.lerp(tint.lawn, k);
    pathMat.current?.color.lerp(tint.path, k);
    for (let s = 0; s < SEGMENTS * VENUE_IDS.length; s++) {
      const node = segments.current[s];
      if (!node) continue;
      // The modulo is per segment, so each one slides forward a segment's worth
      // at a time and jumps back — which happens behind the fog.
      const seg = s % SEGMENTS;
      const z = ((seg * SPAN + d) % (SPAN * SEGMENTS)) - SPAN * (SEGMENTS - 1);
      node.position.z = z;
    }
  });

  return (
    <>
      {/* Sky. A large inverted sphere with a vertical gradient — cheaper than a
          skybox image and it tints with the fog for free. */}
      <mesh scale={[-1, 1, 1]} renderOrder={-2}>
        <sphereGeometry args={[200, 16, 12]} />
        <meshBasicMaterial
          map={sky}
          side={THREE.BackSide}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </mesh>
      <SunAndClouds />

      <fog attach="fog" args={[FOG_COLOR, FOG_NEAR, FOG_FAR]} />

      {/* The ground plane the path and the lawn sit on. One draw call, one
          texture, no geometry to stream: a flat plane cannot be a bottleneck
          and it never has to be recycled because it is infinitely long. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -FOG_FAR]}>
        <planeGeometry args={[90, FOG_FAR * 2.4, 24, 140]} />
        <meshStandardMaterial ref={lawnMat} map={lawn} roughness={0.95} />
      </mesh>

      {/* The path. Three lane-widths of gravel with the seams from
          `pathTexture` landing between the lanes. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, -FOG_FAR]}>
        <planeGeometry args={[5.4, FOG_FAR * 2.4, 3, 140]} />
        <meshStandardMaterial ref={pathMat} map={path} roughness={0.92} />
      </mesh>

      {/* The lake, both sides of the road, only at the lakeside venue. */}
      <group ref={water} visible={false}>
        {[-1, 1].map((side) => (
          <mesh key={side} rotation={[-Math.PI / 2, 0, 0]} position={[side * 27, 0.03, -FOG_FAR]}>
            <planeGeometry args={[40, FOG_FAR * 2.4, 10, 140]} />
            <meshStandardMaterial
              color={PALETTE.water}
              roughness={0.1}
              metalness={0.3}
              emissive={PALETTE.water}
              emissiveIntensity={0.2}
            />
          </mesh>
        ))}
      </group>

      {VENUE_IDS.map((v, vi) => (
        <group
          key={v}
          ref={(node) => {
            venueGroups.current[v] = node;
          }}
          visible={v === "garden"}
        >
          {props[v].map((list, seg) => (
            <group
              key={seg}
              ref={(node) => {
                segments.current[vi * SEGMENTS + seg] = node;
              }}
            >
              {list.map((p, i) => {
                const Body = PROP_BODY[p.kind];
                return (
                  <group key={i} position={[p.x, 0, p.z]} rotation={[0, p.spin, 0]} scale={p.scale}>
                    <Body />
                  </group>
                );
              })}
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
    grad.addColorStop(0.36, SKY_MID);
    grad.addColorStop(0.5, SKY_HORIZON);
    grad.addColorStop(1, FOG_COLOR);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** A low sun straight down the track, with a soft halo, and a few low-poly
 *  clouds drifting across. All unfogged and un-tonemapped: they are the sky. */
function SunAndClouds() {
  const clouds = useRef<THREE.Group>(null);
  const halo = useMemo(() => radialTexture(), []);
  useFrame((_, dt) => {
    const g = clouds.current;
    if (!g) return;
    for (const c of g.children) {
      c.position.x += dt * 1.2;
      if (c.position.x > 140) c.position.x = -140;
    }
  });
  const puffs = useMemo(() => {
    const rnd = lcg(77);
    return Array.from({ length: 9 }, () => ({
      x: -140 + rnd() * 280,
      y: 34 + rnd() * 30,
      z: -150 - rnd() * 30,
      s: 7 + rnd() * 7,
    }));
  }, []);
  return (
    <>
      <sprite position={[0, 18, -185]} scale={[90, 90, 1]} renderOrder={-1}>
        <spriteMaterial
          map={halo}
          color={SUN}
          transparent
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>
      <mesh position={[0, 18, -186]} renderOrder={-1}>
        <circleGeometry args={[7, 40]} />
        <meshBasicMaterial color={SUN} fog={false} toneMapped={false} depthWrite={false} />
      </mesh>
      <group ref={clouds}>
        {puffs.map((p, i) => (
          <group key={i} position={[p.x, p.y, p.z]} scale={p.s}>
            {[
              [0, 0, 0, 1],
              [1.1, -0.15, 0.1, 0.75],
              [-1.05, -0.2, 0, 0.7],
              [0.45, 0.45, 0, 0.7],
              [-0.5, 0.35, 0.1, 0.6],
            ].map(([x, y, z, r], k) => (
              <mesh key={k} position={[x ?? 0, y ?? 0, z ?? 0]} scale={[1, 0.72, 0.8]}>
                <icosahedronGeometry args={[r ?? 1, 1]} />
                <meshBasicMaterial
                  color={k % 2 ? PALETTE.cloudWarm : PALETTE.cloud}
                  fog={false}
                  toneMapped={false}
                />
              </mesh>
            ))}
          </group>
        ))}
      </group>
    </>
  );
}

/** A soft white-to-transparent disc for the sun's halo. */
function radialTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,0.95)");
    g.addColorStop(0.25, "rgba(255,240,200,0.55)");
    g.addColorStop(1, "rgba(255,220,170,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export { FOG_FAR as GARDEN_FOG_FAR, FOG_NEAR as GARDEN_FOG_NEAR };
