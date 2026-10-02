/**
 * What you pick up, and what you pick up is the score.
 *
 * Three tiers of cash and one tote bag. The tiers are not cosmetic variants of
 * one object: a coin is a fat cylinder spinning on its axis, a bundle is a banded
 * roll, an envelope is a flat card with a wax seal — three silhouettes a player
 * can tell apart at 30 m/s in peripheral vision, which is the only vision that
 * matters in this genre. The bag is a fourth silhouette entirely and four times
 * the value, so it announces itself.
 *
 * THE AMOUNT IS NEVER DRAWN HERE. A coin carries no number on it; the number
 * floats up in the HUD as DOM text, formatted for the couple's currency. A
 * texture on a spinning coin would be unreadable anyway, and a painted figure
 * would be wrong the moment a couple switches to a currency this build has never
 * seen. See `utils/format.ts` for the one place a figure is turned into a string.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { CashId } from "@shared/runner";
import { M, box, cylinder, sphere, torus } from "../constants/materials";
import { PALETTE } from "../constants/palette";
import type { BagInstance, CashInstance } from "../engine/RunEngine";

/** One collectible, drawn at the origin. The caller places it. */
function Coin({ tier }: { tier: CashId }) {
  if (tier === "coin") {
    return (
      <group>
        <mesh
          geometry={cylinder(0.22, 0.22, 0.07, 14)}
          material={M.gold()}
          rotation={[0, 0, Math.PI / 2]}
        />
        <mesh
          geometry={torus(0.22, 0.028, 6, 14)}
          material={M.goldDeep()}
          rotation={[0, Math.PI / 2, 0]}
        />
        <mesh geometry={box(0.03, 0.2, 0.06)} material={M.goldDeep()} />
      </group>
    );
  }
  if (tier === "bundle") {
    return (
      <group>
        {/* A banded roll of notes, stood on end so the band is visible. */}
        <mesh
          geometry={cylinder(0.17, 0.17, 0.26, 12)}
          material={M.cash()}
          rotation={[0, 0, Math.PI / 2]}
        />
        <mesh
          geometry={cylinder(0.176, 0.176, 0.06, 12)}
          material={M.cashBack()}
          rotation={[0, 0, Math.PI / 2]}
        />
        <mesh
          geometry={cylinder(0.1, 0.1, 0.28, 8)}
          material={M.cashBack()}
          rotation={[0, 0, Math.PI / 2]}
        />
      </group>
    );
  }
  return (
    <group rotation={[0.18, 0, 0]}>
      {/* An envelope with a wax seal. The flat card is the silhouette: it is the
          only cash shape that is WIDER than it is tall. */}
      <mesh geometry={box(0.4, 0.26, 0.06)} material={M.envelope()} />
      <mesh geometry={box(0.4, 0.06, 0.062)} material={M.paperDeep()} position={[0, 0.1, 0]} />
      <mesh
        geometry={sphere(0.06, 10)}
        material={M.danger()}
        position={[0, 0, 0.04]}
        scale={[1, 1, 0.5]}
      />
    </group>
  );
}

/** The Weddly tote: the one bag on the track, and the reason a run is a budget.
 *  `weddlyLogoTexture` is a generated placeholder wordmark — swapping in the real
 *  logo is one function body, which is the whole reason it is drawn. */
function Tote({ mark }: { mark: THREE.Texture | null }) {
  return (
    <group>
      <mesh geometry={box(0.56, 0.5, 0.3)} material={M.tote()} position={[0, -0.1, 0]} />
      <mesh geometry={box(0.58, 0.08, 0.32)} material={M.toteInk()} position={[0, 0.1, 0]} />
      {/* Handles. Two arcs of a torus, which is the one shape that says "bag"
          without a texture. */}
      {[-0.14, 0.14].map((x) => (
        <mesh
          key={x}
          geometry={torus(0.16, 0.022, 6, 12)}
          material={M.toteInk()}
          position={[x, 0.16, 0]}
          rotation={[0, Math.PI / 2, 0]}
        />
      ))}
      {mark && (
        <mesh geometry={box(0.34, 0.17, 0.01)} position={[0, -0.08, 0.152]}>
          <meshBasicMaterial map={mark} transparent depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

export interface CollectiblesProps {
  readCash: () => readonly CashInstance[];
  readBags: () => readonly BagInstance[];
  mark: THREE.Texture | null;
}

/**
 * Both pools. Positions come from the engine array every frame; a pool slot's
 * whole lifetime is "be somewhere, then be invisible", and a pooled mesh is the
 * cheapest way to express that without React ever re-rendering.
 */
export function Collectibles({ readCash, readBags, mark }: CollectiblesProps) {
  const cashNodes = useRef<(THREE.Group | null)[]>([]);
  const bagNodes = useRef<(THREE.Group | null)[]>([]);
  /** One sub-group per tier per slot. Three tiny subtrees are mounted for each
   *  pool slot and only the slot's own tier is ever visible — which is cheaper
   *  than remounting a subtree every time a pool slot is handed a new tier, and
   *  it is why a 120-coin pool costs 120 draw calls of bookkeeping and nothing
   *  else. */
  const tierNodes = useRef<Array<Array<THREE.Group | null>>>([]);
  const pool = useMemo(() => readCash(), []);
  const bagPool = useMemo(() => readBags(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < pool.length; i++) {
      const inst = pool[i];
      const node = cashNodes.current[i];
      if (!inst || !node) continue;
      node.visible = inst.active;
      if (!inst.active) continue;
      const tiers = tierNodes.current[i];
      if (tiers) {
        tiers[0]!.visible = inst.tier === "coin";
        tiers[1]!.visible = inst.tier === "bundle";
        tiers[2]!.visible = inst.tier === "envelope";
      }
      node.position.set(inst.x, inst.y + Math.sin(t * 2.4 + inst.phase) * 0.05, inst.z);
      // Spin about the vertical, not the axis of travel, so a row of coins
      // flashes edge-on together — the classic runner tell that says "line".
      node.rotation.y = t * 3.1 + inst.phase;
    }
    for (let i = 0; i < bagPool.length; i++) {
      const inst = bagPool[i];
      const node = bagNodes.current[i];
      if (!inst || !node) continue;
      node.visible = inst.active;
      if (!inst.active) continue;
      node.position.set(inst.x, inst.y + Math.sin(t * 1.6 + inst.phase) * 0.07, inst.z);
      node.rotation.y = Math.sin(t * 0.9 + inst.phase) * 0.4;
    }
  });

  return (
    <group>
      {pool.map((inst, i) => (
        <group
          key={i}
          ref={(node) => {
            cashNodes.current[i] = node;
          }}
          visible={false}
        >
          {CASH_ORDER.map((tier, k) => (
            <group
              key={tier}
              ref={(node) => {
                const row = (tierNodes.current[i] ??= [null, null, null]);
                row[k] = node;
              }}
              visible={inst.tier === tier}
            >
              <Coin tier={tier} />
            </group>
          ))}
        </group>
      ))}
      {bagPool.map((_, i) => (
        <group
          key={i}
          ref={(node) => {
            bagNodes.current[i] = node;
          }}
          visible={false}
        >
          <Tote mark={mark} />
          {/* A gold rim-light disc under the bag so it is findable in a dense
              row of coins — the value is the reason to look for it. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.42, 0]}>
            <ringGeometry args={[0.3, 0.42, 20]} />
            <meshBasicMaterial color={PALETTE.gold} transparent opacity={0.45} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Draw order fixed, so the tier index in `tierNodes` means the same thing in
 *  the ref callback and in the visibility check. */
const CASH_ORDER = ["coin", "bundle", "envelope"] as const satisfies readonly CashId[];

export { Coin as CollectibleMesh, Tote as ToteMesh };
