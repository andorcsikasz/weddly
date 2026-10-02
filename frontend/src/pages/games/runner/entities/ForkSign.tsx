/**
 * The signpost at a venue fork: one post in the centre lane, two arrow boards
 * naming where each side of the road goes. The names come from the page (they
 * are translated copy) through `ForkContext`, and the boards re-texture only
 * when a new fork arrives, not per frame.
 */

import { useFrame } from "@react-three/fiber";
import { createContext, useContext, useRef, useState } from "react";
import type { VenueId } from "@shared/runner";
import { M, box, cylinder, sphere } from "../constants/materials";
import { signTexture } from "../utils/textures";

export interface ForkInfo {
  read: () => { left: VenueId; right: VenueId } | null;
  names: Readonly<Record<VenueId, string>>;
}

export const ForkContext = createContext<ForkInfo | null>(null);

export function ForkSign() {
  const info = useContext(ForkContext);
  const [pair, setPair] = useState<{ left: VenueId; right: VenueId } | null>(null);
  const last = useRef("");
  useFrame(() => {
    const fork = info?.read() ?? null;
    const key = fork ? `${fork.left}|${fork.right}` : "";
    if (key && key !== last.current) {
      last.current = key;
      setPair({ left: fork!.left, right: fork!.right });
    }
  });
  const left =
    pair && info
      ? signTexture(info.names[pair.left], undefined, { board: "painted", arrow: "left" })
      : null;
  const right =
    pair && info
      ? signTexture(info.names[pair.right], undefined, { board: "painted", arrow: "right" })
      : null;
  return (
    <group>
      <mesh geometry={cylinder(0.09, 0.11, 2.9, 16)} material={M.lamp()} position={[0, 1.45, 0]} />
      <mesh geometry={sphere(0.14, 16)} material={M.gold()} position={[0, 2.95, 0]} />
      {/* A garland round the post: it is a wedding signpost. */}
      {[0.6, 1.0, 1.4].map((y, i) => (
        <mesh
          key={y}
          geometry={sphere(0.1, 10)}
          material={i % 2 ? M.blossom() : M.blossomPale()}
          position={[0.1, y, 0.06]}
        />
      ))}
      {[
        { tex: left, x: -0.78, y: 2.5, tilt: 0.06 },
        { tex: right, x: 0.78, y: 2.0, tilt: -0.06 },
      ].map((b) => (
        <group key={b.x} position={[b.x, b.y, 0.05]} rotation={[0, 0, b.tilt]}>
          <mesh geometry={box(1.5, 0.75, 0.06)} material={M.lamp()} />
          <mesh position={[0, 0, 0.035]}>
            <planeGeometry args={[1.44, 0.7]} />
            <meshStandardMaterial map={b.tex ?? undefined} roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
