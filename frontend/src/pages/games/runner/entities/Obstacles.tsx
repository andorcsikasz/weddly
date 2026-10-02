/**
 * The wedding costs you have to get past.
 *
 * Every prop here is built from the SAME primitives as the couple and the
 * garden, so the whole game stays one visual language: a wedge of blush for a
 * florist's cart, a paper plane for the receipt that always says the same
 * number, a black slab for the DJ booth. Nothing is a modelled asset and nothing
 * is downloaded, which is what keeps the bundle inside its budget and means the
 * game has no third-party licences attached to it.
 *
 * THE POSE IS NOT THE COLLISION BOX. `OBSTACLES[id].half` is what the engine
 * tests, and each component below is drawn to fill that volume, not to fill the
 * lane — a limousine is 3 m long, a receipt is thin, and the player reads the
 * depth difference as "you can run past this one sideways".
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import * as THREE from "three";
import { OBSTACLES, type ObstacleId } from "@shared/runner";
import { M, box, cone, cylinder, sphere, torus } from "../constants/materials";
import { PALETTE } from "../constants/palette";
import type { ObstacleInstance } from "../engine/RunEngine";
import { receiptTexture, signTexture } from "../utils/textures";
import {
  DiscoBall,
  FairyLights,
  FoodTruck,
  GrandPiano,
  InvitationStack,
  LuggageCart,
  MarqueeTent,
  NailPolish,
  RingBox,
  RingLight,
  SpeakerStack,
  TailorMannequin,
} from "./VendorProps";
import { ForkSign } from "./ForkSign";

/** One prop's collision volume, flattened the same way the engine does it, so a
 *  mesh cannot be drawn somewhere the engine does not test. */
export function propVolume(id: ObstacleId) {
  const spec = OBSTACLES[id];
  return { x: spec.half.x, y: spec.half.y, z: spec.half.z, base: spec.base };
}

/** A three-wheel florist's cart: a wicker box on a chrome frame, tipped with
 *  blooms. The blooms are the read — you jump the flowers, not the cart. */
function FloristCart() {
  return (
    <group>
      <mesh geometry={box(1.72, 0.56, 0.9)} material={M.tote()} position={[0, 0.72, 0]} />
      <mesh geometry={box(1.78, 0.1, 0.96)} material={M.toteInk()} position={[0, 1.03, 0]} />
      {[-0.7, 0, 0.7].map((x) => (
        <mesh
          key={x}
          geometry={sphere(0.26, 10)}
          material={M.blossom()}
          position={[x, 1.24, 0.05]}
          scale={[1.15, 0.8, 1]}
        />
      ))}
      {[-0.5, 0.28, 0.72].map((x, i) => (
        <mesh
          key={x}
          geometry={sphere(0.15, 8)}
          material={i % 2 === 0 ? M.bouquet() : M.blossomPale()}
          position={[x, 1.36, -0.16]}
        />
      ))}
      {[-0.74, 0.74].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.24, 0.24, 0.09, 10)}
          material={M.chrome()}
          position={[x, 0.24, 0.28]}
          rotation={[0, 0, Math.PI / 2]}
        />
      ))}
      <mesh geometry={box(0.09, 1.06, 0.09)} material={M.chrome()} position={[0.72, 0.53, -0.4]} />
      <mesh geometry={box(0.72, 0.07, 0.07)} material={M.chrome()} position={[0.36, 1.0, -0.4]} />
    </group>
  );
}

/** The photographer: crouched behind a lens, low enough to jump. */
function Photographer() {
  return (
    <group>
      <mesh
        geometry={cylinder(0.16, 0.2, 0.44, 10)}
        material={M.tuxedo()}
        position={[0, 0.22, 0]}
      />
      <mesh geometry={sphere(0.16, 10)} material={M.skin()} position={[0, 0.6, 0]} />
      <mesh
        geometry={sphere(0.168, 10)}
        material={M.hair()}
        position={[0, 0.64, -0.02]}
        scale={[1, 0.6, 1]}
      />
      <mesh geometry={box(0.3, 0.24, 0.36)} material={M.slate()} position={[0, 0.42, 0.26]} />
      <mesh
        geometry={cylinder(0.09, 0.11, 0.22, 10)}
        material={M.tuxedo()}
        position={[0, 0.46, 0.5]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh
        geometry={cylinder(0.12, 0.12, 0.04, 10)}
        material={M.glass()}
        position={[0, 0.46, 0.62]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh geometry={box(0.5, 0.06, 0.06)} material={M.chrome()} position={[0, 0.3, 0.44]} />
    </group>
  );
}

/** The videographer: a shoulder rig on a monopod, floating from 1.02 m — a
 *  `slide` gate, and the tall thin silhouette is what says "duck". */
function Videographer() {
  return (
    <group position={[0, 1.02, 0]}>
      <mesh geometry={cylinder(0.3, 0.36, 0.6, 12)} material={M.tuxedo()} position={[0, 0.3, 0]} />
      <mesh geometry={box(0.42, 0.3, 0.5)} material={M.slate()} position={[0, 0.66, 0]} />
      <mesh
        geometry={cylinder(0.08, 0.08, 0.24, 10)}
        material={M.tuxedo()}
        position={[0, 0.74, 0.3]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh geometry={sphere(0.14, 10)} material={M.skinDeep()} position={[0.16, 0.9, 0]} />
      <mesh geometry={box(0.08, 0.6, 0.08)} material={M.chrome()} position={[-0.3, -0.4, 0]} />
      <mesh
        geometry={cone(0.18, 0.2, 10)}
        material={M.glow()}
        position={[-0.3, -0.76, 0]}
        rotation={[Math.PI, 0, 0]}
      />
    </group>
  );
}

/** The catering trolley: a chafing dish under a lifted lid, hung from 1.05 m. */
function CateringTrolley() {
  return (
    <group>
      <mesh geometry={box(1.6, 0.5, 0.86)} material={M.chrome()} position={[0, 0.6, 0]} />
      <mesh geometry={box(1.66, 0.08, 0.92)} material={M.ivory()} position={[0, 0.88, 0]} />
      {/* The lid, tipped back — the gap you slide under. */}
      <mesh
        geometry={box(1.6, 0.06, 0.6)}
        material={M.chrome()}
        position={[0, 1.72, -0.22]}
        rotation={[-0.7, 0, 0]}
      />
      <mesh
        geometry={sphere(0.2, 10)}
        material={M.champagne()}
        position={[0.4, 1.02, 0.1]}
        scale={[1.3, 0.7, 1.3]}
      />
      <mesh
        geometry={cylinder(0.14, 0.14, 0.1, 10)}
        material={M.ivory()}
        position={[-0.42, 0.96, 0.06]}
      />
      <mesh geometry={sphere(0.15, 8)} material={M.bowTie()} position={[-0.42, 1.06, 0.06]} />
      {[-0.7, 0.7].map((x) => (
        <mesh
          key={x}
          geometry={sphere(0.2, 8)}
          material={M.tuxedo()}
          position={[x, 0.2, 0.32]}
          rotation={[0, 0, Math.PI / 2]}
        />
      ))}
    </group>
  );
}

/** The cake trolley: a three-tier cake on a stand. The one thing in the game
 *  worth protecting, which is why it is the lowest `slide`-free blocker. */
function CakeTrolley() {
  return (
    <group>
      <mesh geometry={cylinder(0.62, 0.62, 0.08, 14)} material={M.ivory()} position={[0, 0.7, 0]} />
      <mesh geometry={cylinder(0.08, 0.1, 0.6, 10)} material={M.gold()} position={[0, 0.36, 0]} />
      <mesh geometry={cylinder(0.5, 0.5, 0.22, 16)} material={M.ivory()} position={[0, 0.86, 0]} />
      <mesh geometry={cylinder(0.38, 0.38, 0.2, 16)} material={M.ivory()} position={[0, 1.06, 0]} />
      <mesh
        geometry={cylinder(0.24, 0.24, 0.18, 14)}
        material={M.ivory()}
        position={[0, 1.24, 0]}
      />
      <mesh
        geometry={torus(0.5, 0.03, 6, 16)}
        material={M.bowTie()}
        position={[0, 0.98, 0]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      <mesh geometry={sphere(0.06, 8)} material={M.gold()} position={[0, 1.37, 0]} />
    </group>
  );
}

/** The champagne tower: a pyramid of coupes with the top ones hung in the air
 *  over your head, which is what makes it a duck. */
function ChampagneTower() {
  const coupes = useMemo(
    () =>
      Array.from({ length: 15 }, (_, i) => {
        const row = Math.floor(i / 3);
        const col = i % 3;
        return {
          x: (col - 1) * 0.3 + (row % 2 ? 0.15 : 0),
          y: 1.0 + row * 0.26,
          z: (row % 2 ? 0.16 : -0.16) * row * 0.3,
        };
      }),
    [],
  );
  return (
    <group>
      <mesh geometry={cylinder(0.7, 0.72, 0.1, 16)} material={M.ivory()} position={[0, 0.86, 0]} />
      <mesh
        geometry={cylinder(0.1, 0.12, 0.8, 10)}
        material={M.goldDeep()}
        position={[0, 0.44, 0]}
      />
      {coupes.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]}>
          <mesh
            geometry={cylinder(0.025, 0.02, 0.14, 6)}
            material={M.glass()}
            position={[0, -0.07, 0]}
          />
          <mesh
            geometry={cylinder(0.09, 0.03, 0.1, 8)}
            material={M.champagne()}
            position={[0, 0.04, 0]}
          />
        </group>
      ))}
    </group>
  );
}

/** The DJ booth: a black slab with a lit deck. Full height, full lane — the
 *  first obstacle in the game that cannot be jumped, slid or ignored. */
function DjBooth() {
  return (
    <group>
      <mesh geometry={box(1.06, 2.2, 0.88)} material={M.tuxedo()} position={[0, 1.1, 0]} />
      <mesh geometry={box(1.12, 0.1, 0.94)} material={M.slate()} position={[0, 2.2, 0]} />
      <mesh geometry={box(0.96, 0.06, 0.5)} material={M.slate()} position={[0, 1.16, 0.16]} />
      {[-0.28, 0.28].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.16, 0.16, 0.03, 12)}
          material={M.glow()}
          position={[x, 1.2, 0.16]}
        />
      ))}
      <mesh geometry={box(0.5, 0.9, 0.04)} material={M.slate()} position={[0, 1.7, -0.42]} />
      <mesh geometry={box(0.42, 0.8, 0.02)} material={M.glow()} position={[0, 1.7, -0.39]} />
      <mesh geometry={box(0.1, 0.7, 0.1)} material={M.chrome()} position={[0.44, 0.35, 0.3]} />
    </group>
  );
}

/** The limousine's four contact patches, hoisted so the tuple stays a typed
 *  const: destructuring an inline array literal under `noUncheckedIndexedAccess`
 *  types each element as `number | undefined`, and every `position` prop on the
 *  line below then fails to typecheck. */
const LIMOUSINE_WHEELS: ReadonlyArray<readonly [number, number]> = [
  [-0.95, 1.7],
  [0.95, 1.7],
  [-0.95, -1.7],
  [0.95, -1.7],
];

/** The limousine: the widest and deepest thing on the track. You cannot jump it
 *  and you cannot slide under it, and its 3 m length is what makes it read as
 *  "wait for the tail" rather than as a wall. */
function Limousine() {
  return (
    <group>
      <mesh geometry={box(2.2, 0.72, 5.4)} material={M.tuxedo()} position={[0, 0.72, 0]} />
      <mesh geometry={box(2.26, 0.16, 5.5)} material={M.bowTie()} position={[0, 0.34, 0]} />
      <mesh geometry={box(1.7, 0.86, 2.4)} material={M.slate()} position={[0, 1.5, -0.5]} />
      <mesh geometry={box(1.76, 0.5, 1.4)} material={M.glass()} position={[0, 1.56, 0.1]} />
      <mesh geometry={box(1.78, 0.44, 1.2)} material={M.glass()} position={[0, 1.56, -1.3]} />
      <mesh geometry={box(2.0, 0.2, 0.3)} material={M.gold()} position={[0, 1.98, -0.5]} />
      {LIMOUSINE_WHEELS.map(([x, z]) => (
        <mesh
          key={`${x}:${z}`}
          geometry={cylinder(0.42, 0.42, 0.28, 12)}
          material={M.rubber()}
          position={[x, 0.42, z]}
          rotation={[0, 0, Math.PI / 2]}
        />
      ))}
      {[-0.7, 0.7].map((x) => (
        <mesh
          key={x}
          geometry={box(0.3, 0.14, 0.06)}
          material={M.glow()}
          position={[x, 0.8, 2.72]}
        />
      ))}
    </group>
  );
}

/** A dress rack of spare gowns. Full height, so it is a lane decision — and it
 *  is the joke of the collection in one prop. */
function DressRack() {
  return (
    <group>
      {[-0.9, 0.9].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.05, 0.05, 2.4, 8)}
          material={M.chrome()}
          position={[x, 1.2, 0]}
        />
      ))}
      <mesh geometry={box(2, 0.07, 0.07)} material={M.chrome()} position={[0, 2.36, 0]} />
      {[-0.62, -0.2, 0.24, 0.66].map((x, i) => (
        <mesh
          key={x}
          geometry={cone(0.3, 1.5, 10)}
          material={i % 2 === 0 ? M.ivory() : M.paper()}
          position={[x, 1.5, 0]}
          rotation={[Math.PI, 0, 0]}
        />
      ))}
      <mesh geometry={box(1.9, 0.06, 0.5)} material={M.paperDeep()} position={[0, 0.03, 0]} />
    </group>
  );
}

/** The makeup station: a lit mirror on a wheeled frame. */
function MakeupStation() {
  return (
    <group>
      {[-0.36, 0.36].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.04, 0.04, 1.6, 8)}
          material={M.chrome()}
          position={[x, 0.8, 0]}
        />
      ))}
      <mesh geometry={box(0.94, 2.1, 0.1)} material={M.gold()} position={[0, 1.4, -0.2]} />
      <mesh geometry={box(0.8, 1.7, 0.04)} material={M.glow()} position={[0, 1.5, -0.14]} />
      <mesh geometry={box(0.98, 0.14, 0.5)} material={M.ivory()} position={[0, 0.78, 0.06]} />
      <mesh
        geometry={cylinder(0.05, 0.07, 0.16, 10)}
        material={M.bowTie()}
        position={[-0.24, 0.9, 0.06]}
      />
      <mesh geometry={sphere(0.09, 8)} material={M.blossomPale()} position={[0.18, 0.9, 0.06]} />
      <mesh geometry={box(0.06, 0.4, 0.4)} material={M.ivory()} position={[0, 1.1, -0.24]} />
      {[-0.42, 0.42].map((x) => (
        <mesh
          key={x}
          geometry={sphere(0.12, 8)}
          material={M.slate()}
          position={[x, 0.1, 0.2]}
          rotation={[0, 0, Math.PI / 2]}
        />
      ))}
    </group>
  );
}

/** The photo booth: a curtain, a bench, a lamp. */
function PhotoBooth() {
  return (
    <group>
      <mesh geometry={box(1.0, 2.3, 0.84)} material={M.slate()} position={[0, 1.15, -0.2]} />
      <mesh geometry={box(0.8, 1.9, 0.06)} material={M.blushDeep()} position={[0, 1.2, 0.22]} />
      {[-0.3, 0, 0.3].map((x) => (
        <mesh
          key={x}
          geometry={box(0.1, 1.9, 0.04)}
          material={M.danger()}
          position={[x, 1.2, 0.26]}
        />
      ))}
      <mesh geometry={box(1.06, 0.14, 0.92)} material={M.gold()} position={[0, 2.32, -0.2]} />
      <mesh
        geometry={cylinder(0.12, 0.08, 0.16, 10)}
        material={M.glow()}
        position={[0.3, 2.48, 0]}
      />
      <mesh geometry={box(0.7, 0.16, 0.36)} material={M.tote()} position={[0, 0.5, 0.06]} />
    </group>
  );
}

/** The decor arch: two uprights and a garland, which you cannot jump because
 *  the garland is at head height and cannot be slid under because the uprights
 *  are at the edges. */
function DecorArch() {
  return (
    <group>
      {[-0.94, 0.94].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.11, 0.14, 2.5, 10)}
          material={M.ivory()}
          position={[x, 1.25, 0]}
        />
      ))}
      <mesh geometry={box(2.1, 0.12, 0.12)} material={M.ivory()} position={[0, 2.5, 0]} />
      {Array.from({ length: 11 }, (_, i) => {
        const t = (i / 10 - 0.5) * 1.9;
        const dip = -Math.cos(t * 1.9) * 0.16 + 0.16;
        return (
          <mesh
            key={i}
            geometry={sphere(0.15, 8)}
            material={i % 3 === 0 ? M.blossom() : i % 3 === 1 ? M.leaf() : M.blossomPale()}
            position={[t, 2.42 - dip, 0.02]}
          />
        );
      })}
      {[-0.6, 0, 0.6].map((x) => (
        <mesh
          key={x}
          geometry={cone(0.2, 0.5, 8)}
          material={M.bowTie()}
          position={[x, 2.2, 0.06]}
          rotation={[0, 0, Math.PI]}
        />
      ))}
    </group>
  );
}

/** A stack of banquet chairs, folded. Low, wide, and exactly the shape of a
 *  thing you have decided not to step over. */
function ChairStack() {
  return (
    <group>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[0, 0.16 + i * 0.24, i * 0.03]} rotation={[0, i * 0.06, 0]}>
          <mesh geometry={box(1.7, 0.08, 0.82)} material={M.gold()} />
          <mesh geometry={box(1.7, 0.62, 0.08)} material={M.gold()} position={[0, 0.34, -0.36]} />
          <mesh geometry={box(0.08, 0.5, 0.78)} material={M.chrome()} position={[0.78, -0.1, 0]} />
          <mesh geometry={box(0.08, 0.5, 0.78)} material={M.chrome()} position={[-0.78, -0.1, 0]} />
        </group>
      ))}
    </group>
  );
}

/** The giant receipt, on a pole. Paper, printed, and always for the same number
 *  — the texture carries the joke, the geometry just has to be a wall. */
function GiantReceipt({ total }: { total: string }) {
  const paper = useMemo(
    () => receiptTexture("FLORAL UPCHARGE", ["ceremony arch", "extra blooms"], total),
    [total],
  );
  return (
    <group>
      <mesh geometry={box(0.9, 2.2, 0.06)} position={[0, 1.2, 0]}>
        <meshStandardMaterial map={paper} roughness={0.9} />
      </mesh>
      <mesh geometry={cylinder(0.06, 0.07, 1.2, 8)} material={M.bark()} position={[0, 0.5, 0]} />
      <mesh geometry={box(0.7, 0.14, 0.5)} material={M.lamp()} position={[0, 0.05, 0]} />
    </group>
  );
}

/** The SERVICE FEE board. One word, red, and it starts above your standing head
 *  and stops above your sliding head. */
function ServiceFeeSign({ amount }: { amount: string }) {
  const board = useMemo(
    () => signTexture("SERVICE FEE", amount, { board: "painted", textColor: PALETTE.blush600 }),
    [amount],
  );
  return (
    <group>
      <mesh geometry={box(0.98, 2.6, 0.08)} position={[0, 1.6, 0]}>
        <meshStandardMaterial map={board} roughness={0.85} />
      </mesh>
      <mesh geometry={cylinder(0.07, 0.09, 0.9, 8)} material={M.bark()} position={[0, 0.3, 0]} />
      <mesh geometry={box(0.6, 0.16, 0.6)} material={M.lamp()} position={[0, 0.06, 0]} />
    </group>
  );
}

/** The planner's clipboard, held out in front of a clipboard-shaped shadow of
 *  a person, asking for a signature nobody wants to give. Hung at 1.0 m. */
function PlannerClipboard() {
  return (
    <group position={[0, 1.0, 0]}>
      <mesh geometry={box(0.86, 1.2, 0.05)} material={M.bark()} position={[0, 0, 0]} />
      <mesh geometry={box(0.74, 1.06, 0.03)} material={M.paper()} position={[0, -0.03, 0.04]} />
      <mesh geometry={box(0.34, 0.12, 0.05)} material={M.chrome()} position={[0, 0.62, 0.05]} />
      {[0.36, 0.2, 0.04, -0.12].map((y, i) => (
        <mesh
          key={y}
          geometry={box(i === 3 ? 0.42 : 0.58, 0.03, 0.01)}
          material={M.bark()}
          position={[0, y, 0.06]}
        />
      ))}
      <mesh
        geometry={cylinder(0.05, 0.05, 0.3, 8)}
        material={M.bowTie()}
        position={[0.24, 0.5, 0.08]}
        rotation={[0, 0, 0.4]}
      />
    </group>
  );
}

/** The confetti cannon, aimed slightly up. Jump it and it fires; that is the
 *  whole interaction, and it is why it sits on `jump` rows. */
function ConfettiCannon() {
  return (
    <group>
      <mesh geometry={cylinder(0.2, 0.3, 0.5, 12)} material={M.slate()} position={[0, 0.25, 0]} />
      <mesh
        geometry={cylinder(0.18, 0.2, 0.7, 12)}
        material={M.danger()}
        position={[0, 0.72, -0.06]}
        rotation={[-0.5, 0, 0]}
      />
      <mesh
        geometry={torus(0.2, 0.04, 6, 12)}
        material={M.gold()}
        position={[0, 0.98, 0.16]}
        rotation={[1.07, 0, 0]}
      />
      <mesh geometry={sphere(0.06, 6)} material={M.glow()} position={[0, 1.02, 0.2]} />
    </group>
  );
}

/** The flower wall: a solid hedge of blooms with a gap you are meant to notice
 *  is on the other side. */
function FlowerWall() {
  return (
    <group>
      <mesh geometry={box(1.1, 2.3, 0.42)} material={M.hedge()} position={[0, 1.15, 0]} />
      {Array.from({ length: 18 }, (_, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        return (
          <mesh
            key={i}
            geometry={sphere(0.17, 8)}
            material={[M.blossom(), M.blossom(), M.blossomPale(), M.bouquet()][row] ?? M.blossom()}
            position={[(col - 2.5) * 0.2, 0.34 + row * 0.62, 0.2]}
          />
        );
      })}
      <mesh geometry={box(1.24, 0.14, 0.56)} material={M.grassDark()} position={[0, 2.36, 0]} />
    </group>
  );
}

/** The last-minute bill: the tallest, thinnest, reddest thing on the track, and
 *  the last thing a couple sees before they are broke. */
function LastMinuteBill({ amount }: { amount: string }) {
  const paper = useMemo(
    () =>
      receiptTexture("ADDITIONAL CHARGE", ["moved twice", "same florist", "same invoice"], amount),
    [amount],
  );
  return (
    <group>
      <mesh geometry={box(1.0, 2.7, 0.06)} position={[0, 1.5, 0]}>
        <meshStandardMaterial map={paper} roughness={0.88} />
      </mesh>
      <mesh geometry={box(1.1, 0.1, 0.2)} material={M.danger()} position={[0, 2.86, 0]} />
      <mesh geometry={cylinder(0.06, 0.08, 0.3, 8)} material={M.bark()} position={[0, 0.16, 0]} />
    </group>
  );
}

/* ── The catalogue → component map ─────────────────────────────────────── */

/** The props that print money on themselves. They are the only place in the
 *  scene where the couple's currency is legible IN THE WORLD rather than only in
 *  the HUD, which is why they take the formatted amount rather than reading the
 *  economy themselves: a texture is cached by its content, so the number has to
 *  be resolved before the canvas is drawn, and only the page knows the locale. */
type PrintedKind = "receipt" | "sign" | "bill";

const PRINTED: Readonly<Partial<Record<ObstacleId, PrintedKind>>> = {
  giant_receipt: "receipt",
  service_fee_sign: "sign",
  last_minute_bill: "bill",
};

export interface ObstaclesProps {
  /** The engine's live pool. Read every frame; nothing here is React state. */
  read: () => readonly ObstacleInstance[];
  /** One hit's bill, in the couple's currency — what the printed props say. */
  expenseLabel: string;
}

export function Obstacles({ read, expenseLabel }: ObstaclesProps) {
  const groups = useRef<(THREE.Group | null)[]>([]);
  const pool = useMemo(() => read(), []);

  /* A SLOT IS RECYCLED, AND `inst.id` IS NOT A REACT VALUE.
   *
   * The engine mutates its pool instances IN PLACE — the same object is reused
   * for the next obstacle, which is the whole point of pooling — so `inst.id`
   * never becomes a new prop for React. Reading it during render therefore froze
   * every slot at whatever it happened to be holding on first mount, and a slot
   * recycled from a photographer to a limousine kept DRAWING THE PHOTOGRAPHER at
   * the limousine's position: an invisible-but-solid wall on a lane the player
   * was told they had cleared. The collision box was the engine's, so the couple
   * collided with one prop and saw another.
   *
   * The rendered ids live in state, and the frame loop touches that state only
   * when a slot actually changes prop — a handful of times a run, not once a
   * frame. Position and visibility stay on the ref, where they belong. */
  const warnings = useRef<(THREE.Group | null)[]>([]);
  const [drawn, setDrawn] = useState<ObstacleId[]>(() => pool.map((i) => i.id));
  const drawnRef = useRef(drawn);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    let stale = false;
    for (let i = 0; i < pool.length; i++) {
      const inst = pool[i];
      const node = groups.current[i];
      if (!inst || !node) continue;
      if (drawnRef.current[i] !== inst.id) stale = true;
      node.visible = inst.active;
      if (!inst.active) continue;
      node.position.set(inst.x, 0, inst.z);
      // Obstacles do not spin, but a slow roll on the trolleys is what stops the
      // track reading as a conveyor belt of static props.
      node.rotation.y = HUMMERS.has(inst.id) ? Math.sin(t * 0.7 + i) * 0.05 : 0;
      node.rotation.x = 0;
      // A charging prop bounces on its suspension and leans into the run, so it
      // reads as DRIVING at you rather than as a parked one sliding faster.
      if (inst.charging) {
        node.position.y = Math.abs(Math.sin(t * 18 + i)) * 0.08;
        node.rotation.x = -0.05;
        node.rotation.y = Math.sin(t * 9 + i) * 0.04;
      }
      const warn = warnings.current[i];
      if (warn) {
        warn.visible = inst.charge;
        if (inst.charge) {
          const k = inst.charging ? 1 + Math.abs(Math.sin(t * 14)) * 0.35 : 0.85;
          warn.scale.set(k, k, k);
          warn.rotation.y = t * 3;
        }
      }
    }
    if (stale) {
      const next = pool.map((i) => i.id);
      drawnRef.current = next;
      setDrawn(next);
    }
  });

  return (
    <group>
      {pool.map((inst, i) => (
        <group
          key={inst.key}
          ref={(node) => {
            groups.current[i] = node;
          }}
          visible={false}
        >
          <Prop id={drawn[i] ?? inst.id} expenseLabel={expenseLabel} />
          {/* The warning marker over a prop that is about to drive at you. */}
          <group
            ref={(n) => {
              warnings.current[i] = n;
            }}
            position={[0, 2.35, 0]}
            visible={false}
          >
            <mesh rotation={[Math.PI, 0, 0]}>
              <coneGeometry args={[0.26, 0.5, 3]} />
              <meshBasicMaterial color={PALETTE.magnet} />
            </mesh>
            <mesh position={[0, -0.45, 0]}>
              <sphereGeometry args={[0.07, 8, 8]} />
              <meshBasicMaterial color={PALETTE.magnet} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/** One prop, with the printed three resolved to their real generated paper. */
function Prop({ id, expenseLabel }: { id: ObstacleId; expenseLabel: string }) {
  switch (PRINTED[id]) {
    case "receipt":
      return <GiantReceipt total={expenseLabel} />;
    case "sign":
      return <ServiceFeeSign amount={expenseLabel} />;
    case "bill":
      return <LastMinuteBill amount={expenseLabel} />;
    default:
      break;
  }
  const Body = PROPS[id];
  // The three printed ids are `null` above and were handled by the switch above,
  // so a null here means the table and `PRINTED` disagree — a bug, not a case.
  if (!Body) return null;
  return <Body />;
}

/** The props whose "idle" is a gentle sway rather than nothing at all. */
const HUMMERS = new Set<ObstacleId>([
  "florist_cart",
  "catering_trolley",
  "cake_trolley",
  "champagne_tower",
  "confetti_cannon",
  "makeup_station",
]);

const PROPS: Readonly<Record<ObstacleId, ComponentType | null>> = {
  photographer: Photographer,
  videographer: Videographer,
  dj_booth: DjBooth,
  florist_cart: FloristCart,
  catering_trolley: CateringTrolley,
  cake_trolley: CakeTrolley,
  champagne_tower: ChampagneTower,
  limousine: Limousine,
  dress_rack: DressRack,
  makeup_station: MakeupStation,
  photo_booth: PhotoBooth,
  decor_arch: DecorArch,
  chair_stack: ChairStack,
  planner_clipboard: PlannerClipboard,
  confetti_cannon: ConfettiCannon,
  flower_wall: FlowerWall,
  // The three printed props are handled by `Prop`, which resolves them to a real
  // generated paper. They are listed as null rather than omitted so that adding a
  // new obstacle id is a COMPILE error — an entry quietly missing here would
  // render an empty group on the track and read as a hole in the world.
  giant_receipt: null,
  service_fee_sign: null,
  last_minute_bill: null,
  food_truck: FoodTruck,
  grand_piano: GrandPiano,
  speaker_stack: SpeakerStack,
  marquee_tent: MarqueeTent,
  tailor_mannequin: TailorMannequin,
  fairy_lights: FairyLights,
  disco_ball: DiscoBall,
  ring_light: RingLight,
  luggage_cart: LuggageCart,
  ring_box: RingBox,
  nail_polish: NailPolish,
  invitation_stack: InvitationStack,
  fork_sign: ForkSign,
};
