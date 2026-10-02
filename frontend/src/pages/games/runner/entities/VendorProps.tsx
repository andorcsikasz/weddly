/**
 * The second wave of wedding costs: one prop per directory category the first
 * set did not cover (food trucks, live music, sound, tents, suits, lighting,
 * dance lessons, content creators, accommodation, jewellery, nails,
 * invitations).
 *
 * Same rules as `Obstacles.tsx`: built from the shared primitives and
 * materials, drawn at the origin facing +z (the camera), and sized to fill the
 * collision volume the catalogue in `shared/runner.ts` declares for it — a
 * `jump` prop stays under 0.72 m, a `slide` prop hangs its solid part from
 * 1.0 m up, and a `lane` prop is a full-height wall. Anything that moves does so
 * from its own `useFrame` on a ref, never through React state.
 */

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type * as THREE from "three";
import { M, box, cone, cylinder, sphere, torus } from "../constants/materials";

/** A food truck: van body, serving hatch with a striped awning, and a menu
 *  board. The `catering` cost on wheels, and the second thing that can charge. */
export function FoodTruck() {
  return (
    <group>
      <mesh geometry={box(1.5, 1.5, 3.0)} material={M.ivory()} position={[0, 1.15, 0]} />
      <mesh geometry={box(1.52, 0.18, 3.02)} material={M.bowTie()} position={[0, 0.5, 0]} />
      <mesh geometry={box(1.44, 0.7, 0.9)} material={M.ivory()} position={[0, 0.85, 1.85]} />
      <mesh
        geometry={box(1.3, 0.42, 0.04)}
        material={M.glass()}
        position={[0, 1.36, 1.86]}
        rotation={[-0.35, 0, 0]}
      />
      {/* Serving hatch on the side facing the path, with the awning over it. */}
      <mesh geometry={box(0.04, 0.6, 1.6)} material={M.rubber()} position={[0.76, 1.35, -0.2]} />
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          geometry={box(0.42, 0.04, 0.4)}
          material={i % 2 === 0 ? M.blossom() : M.ivory()}
          position={[0.95, 1.78, -0.8 + i * 0.4]}
          rotation={[0, 0, -0.35]}
        />
      ))}
      <mesh geometry={box(0.5, 0.5, 0.05)} material={M.slate()} position={[0, 2.12, 1.2]} />
      <mesh
        geometry={sphere(0.14, 10)}
        material={M.gold()}
        position={[0, 2.12, 1.25]}
        scale={[1, 1, 0.3]}
      />
      {[
        [-0.7, 1.1],
        [0.7, 1.1],
        [-0.7, -1.0],
        [0.7, -1.0],
      ].map(([x, z]) => (
        <mesh
          key={`${x}:${z}`}
          geometry={cylinder(0.32, 0.32, 0.24, 12)}
          material={M.rubber()}
          position={[x ?? 0, 0.32, z ?? 0]}
          rotation={[0, 0, Math.PI / 2]}
        />
      ))}
      {[-0.5, 0.5].map((x) => (
        <mesh
          key={x}
          geometry={box(0.24, 0.12, 0.05)}
          material={M.glow()}
          position={[x, 0.8, 2.31]}
        />
      ))}
    </group>
  );
}

/** A grand piano with its lid up — live music, and a very expensive wall. */
export function GrandPiano() {
  return (
    <group>
      <mesh geometry={box(1.3, 0.34, 1.3)} material={M.tuxedo()} position={[0, 0.92, 0]} />
      <mesh
        geometry={cylinder(0.65, 0.65, 0.34, 18)}
        material={M.tuxedo()}
        position={[0, 0.92, -0.55]}
      />
      {/* The keyboard, facing the runner. */}
      <mesh geometry={box(1.2, 0.06, 0.24)} material={M.ivory()} position={[0, 0.98, 0.74]} />
      {Array.from({ length: 8 }, (_, i) => (
        <mesh
          key={i}
          geometry={box(0.06, 0.04, 0.13)}
          material={M.rubber()}
          position={[-0.5 + i * 0.14, 1.02, 0.7]}
        />
      ))}
      <mesh
        geometry={box(1.26, 0.04, 1.6)}
        material={M.tuxedo()}
        position={[0, 1.6, -0.3]}
        rotation={[0.75, 0, 0]}
      />
      <mesh
        geometry={box(0.03, 0.8, 0.03)}
        material={M.gold()}
        position={[0.5, 1.3, 0.1]}
        rotation={[0.2, 0, 0]}
      />
      {[-0.55, 0.55, 0].map((x, i) => (
        <mesh
          key={x}
          geometry={cylinder(0.05, 0.04, 0.75, 8)}
          material={M.tuxedo()}
          position={[x, 0.38, i === 2 ? -1.0 : 0.45]}
        />
      ))}
      {/* Floating notes, the one hint of sound a silent prop can give. */}
      <mesh geometry={sphere(0.07, 8)} material={M.gold()} position={[-0.3, 2.3, 0.2]} />
      <mesh geometry={box(0.02, 0.28, 0.02)} material={M.gold()} position={[-0.24, 2.44, 0.2]} />
    </group>
  );
}

/** A tower of PA speakers — sound tech. The cones pulse. */
export function SpeakerStack() {
  const cones = useRef<(THREE.Mesh | null)[]>([]);
  useFrame(({ clock }) => {
    const k = 1 + Math.max(0, Math.sin(clock.elapsedTime * 13)) * 0.12;
    for (const c of cones.current) c?.scale.set(k, 1, k);
  });
  return (
    <group>
      {[0, 1, 2].map((row) => (
        <group key={row} position={[0, 0.42 + row * 0.8, 0]}>
          <mesh geometry={box(1.0, 0.76, 0.8)} material={M.rubber()} />
          <mesh
            ref={(n) => {
              cones.current[row] = n;
            }}
            geometry={cylinder(0.28, 0.22, 0.06, 16)}
            material={M.slate()}
            position={[0, -0.04, 0.41]}
            rotation={[Math.PI / 2, 0, 0]}
          />
          <mesh geometry={sphere(0.07, 8)} material={M.chrome()} position={[0, -0.04, 0.45]} />
          <mesh
            geometry={cylinder(0.06, 0.06, 0.05, 10)}
            material={M.slate()}
            position={[0.36, 0.26, 0.41]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        </group>
      ))}
      <mesh geometry={box(0.12, 0.08, 0.04)} material={M.magnet()} position={[-0.36, 2.28, 0.41]} />
    </group>
  );
}

/** A marquee tent: white canvas, peaked roof, scalloped valance, door tied back. */
export function MarqueeTent() {
  return (
    <group>
      <mesh geometry={box(1.5, 1.6, 0.9)} material={M.ivory()} position={[0, 0.8, 0]} />
      <mesh material={M.paper()} position={[0, 2.0, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[1.12, 0.85, 4]} />
      </mesh>
      {[-0.6, -0.3, 0, 0.3, 0.6].map((x) => (
        <mesh
          key={x}
          geometry={sphere(0.13, 8)}
          material={M.blossom()}
          position={[x, 1.6, 0.46]}
          scale={[1.1, 0.6, 0.4]}
        />
      ))}
      {/* The tied-back door, dark inside: the reason it reads as a tent. */}
      <mesh geometry={box(0.6, 1.1, 0.02)} material={M.rubber()} position={[0, 0.55, 0.46]} />
      {[-0.32, 0.32].map((x) => (
        <mesh
          key={x}
          geometry={box(0.14, 1.12, 0.05)}
          material={M.paper()}
          position={[x, 0.56, 0.48]}
        />
      ))}
      <mesh
        geometry={cylinder(0.025, 0.025, 0.5, 6)}
        material={M.chrome()}
        position={[0, 2.65, 0]}
      />
      <mesh geometry={box(0.3, 0.16, 0.01)} material={M.danger()} position={[0.15, 2.82, 0]} />
    </group>
  );
}

/** A tailor's dummy in a half-finished morning suit, tape measure draped over. */
export function TailorMannequin() {
  return (
    <group>
      <mesh geometry={cylinder(0.32, 0.32, 0.05, 14)} material={M.lamp()} position={[0, 0.03, 0]} />
      <mesh geometry={cylinder(0.035, 0.035, 0.9, 8)} material={M.lamp()} position={[0, 0.5, 0]} />
      <mesh geometry={cylinder(0.26, 0.2, 0.8, 12)} material={M.tuxedo()} position={[0, 1.3, 0]} />
      <mesh
        geometry={sphere(0.27, 12)}
        material={M.tuxedo()}
        position={[0, 1.66, 0]}
        scale={[1.25, 0.5, 0.9]}
      />
      <mesh geometry={box(0.14, 0.5, 0.02)} material={M.shirt()} position={[0, 1.42, 0.24]} />
      <mesh geometry={box(0.16, 0.06, 0.03)} material={M.bowTie()} position={[0, 1.64, 0.25]} />
      <mesh geometry={cylinder(0.06, 0.06, 0.16, 8)} material={M.lamp()} position={[0, 1.86, 0]} />
      <mesh geometry={sphere(0.12, 10)} material={M.lamp()} position={[0, 2.0, 0]} />
      {/* The tape measure, round the neck and down both sides. */}
      {[-0.2, 0.2].map((x) => (
        <mesh
          key={x}
          geometry={box(0.04, 0.7, 0.02)}
          material={M.bulb()}
          position={[x, 1.35, 0.25]}
        />
      ))}
      {[0.12, -0.08, -0.28].map((y) => (
        <mesh
          key={y}
          geometry={sphere(0.025, 6)}
          material={M.gold()}
          position={[0.02, 1.4 + y, 0.26]}
        />
      ))}
    </group>
  );
}

/** A garland of fairy lights strung between two poles at head height. Slide. */
export function FairyLights() {
  const bulbs = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return { x: -0.72 + t * 1.44, y: 1.42 - Math.sin(t * Math.PI) * 0.3 };
  });
  return (
    <group>
      {[-0.82, 0.82].map((x) => (
        <group key={x}>
          <mesh
            geometry={cylinder(0.04, 0.05, 1.95, 8)}
            material={M.lamp()}
            position={[x, 0.98, 0]}
          />
          <mesh geometry={sphere(0.07, 8)} material={M.gold()} position={[x, 1.98, 0]} />
        </group>
      ))}
      {/* Three strands, so the curtain of light is solid enough to read as a gate. */}
      {[0, 0.22, 0.44].map((dy, row) =>
        bulbs.map((b, i) => (
          <mesh
            key={`${row}:${i}`}
            geometry={sphere(0.065, 8)}
            material={(i + row) % 2 === 0 ? M.bulb() : M.glow()}
            position={[b.x, b.y + dy, 0]}
          />
        )),
      )}
      {[0, 0.22, 0.44].map((dy) => (
        <mesh
          key={dy}
          geometry={box(1.64, 0.015, 0.015)}
          material={M.lamp()}
          position={[0, 1.34 + dy, 0]}
        />
      ))}
    </group>
  );
}

/** A mirror ball on a gantry, spinning — dance lessons, at head height. */
export function DiscoBall() {
  const ball = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ball.current) ball.current.rotation.y = clock.elapsedTime * 2.2;
  });
  return (
    <group>
      {[-0.78, 0.78].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.04, 0.05, 2.6, 8)}
          material={M.chrome()}
          position={[x, 1.3, 0]}
        />
      ))}
      <mesh geometry={box(1.64, 0.06, 0.06)} material={M.chrome()} position={[0, 2.6, 0]} />
      <mesh geometry={cylinder(0.01, 0.01, 0.6, 4)} material={M.chrome()} position={[0, 2.3, 0]} />
      <group ref={ball} position={[0, 1.55, 0]}>
        <mesh material={M.chrome()}>
          <icosahedronGeometry args={[0.45, 1]} />
        </mesh>
        {[0, 1.3, 2.6, 3.9, 5.2].map((a) => (
          <mesh
            key={a}
            geometry={box(0.1, 0.1, 0.02)}
            material={M.bulb()}
            position={[Math.cos(a) * 0.44, (a % 2) * 0.15 - 0.1, Math.sin(a) * 0.44]}
            rotation={[0, -a, 0]}
          />
        ))}
      </group>
    </group>
  );
}

/** A content creator's ring light on a tripod, phone in the middle. Slide. */
export function RingLight() {
  return (
    <group>
      {[-0.6, 0, 0.6].map((a) => (
        <mesh
          key={a}
          geometry={cylinder(0.025, 0.025, 1.3, 6)}
          material={M.rubber()}
          position={[Math.sin(a * 2) * 0.22, 0.55, Math.cos(a * 2) * 0.22 - 0.22]}
          rotation={[Math.cos(a * 2) * 0.35, 0, -Math.sin(a * 2) * 0.35]}
        />
      ))}
      <mesh geometry={cylinder(0.03, 0.03, 0.6, 6)} material={M.rubber()} position={[0, 1.2, 0]} />
      <mesh geometry={torus(0.46, 0.06, 10, 32)} material={M.glow()} position={[0, 1.62, 0]} />
      <mesh
        geometry={torus(0.46, 0.075, 6, 32)}
        material={M.rubber()}
        position={[0, 1.62, -0.03]}
      />
      <mesh geometry={box(0.2, 0.38, 0.03)} material={M.rubber()} position={[0, 1.62, 0.02]} />
      <mesh geometry={box(0.17, 0.33, 0.01)} material={M.glass()} position={[0, 1.62, 0.04]} />
      {/* The red "recording" dot. */}
      <mesh geometry={sphere(0.035, 8)} material={M.magnet()} position={[0.06, 1.74, 0.05]} />
    </group>
  );
}

/** A hotel bellhop cart: brass posts, a hanging rail of garment bags, suitcases
 *  stacked above head height. Accommodation, and a slide. */
export function LuggageCart() {
  return (
    <group>
      <mesh geometry={box(1.5, 0.08, 0.9)} material={M.lamp()} position={[0, 0.14, 0]} />
      {[-0.7, 0.7].map((x) => (
        <group key={x}>
          <mesh
            geometry={cylinder(0.035, 0.035, 2.2, 8)}
            material={M.gold()}
            position={[x, 1.2, 0]}
          />
          <mesh
            geometry={cylinder(0.09, 0.09, 0.06, 10)}
            material={M.rubber()}
            position={[x, 0.07, 0.35]}
            rotation={[0, 0, Math.PI / 2]}
          />
        </group>
      ))}
      <mesh
        geometry={torus(0.7, 0.035, 6, 20)}
        material={M.gold()}
        position={[0, 2.3, 0]}
        scale={[1, 0.4, 1]}
        rotation={[0, 0, 0]}
      />
      {/* Suitcases riding on the upper deck: the solid part of the gate. */}
      <mesh geometry={box(1.4, 0.06, 0.8)} material={M.gold()} position={[0, 1.1, 0]} />
      <mesh geometry={box(0.6, 0.5, 0.7)} material={M.danger()} position={[-0.32, 1.38, 0]} />
      <mesh geometry={box(0.56, 0.4, 0.6)} material={M.toteInk()} position={[0.34, 1.33, 0]} />
      <mesh geometry={box(0.46, 0.3, 0.5)} material={M.ivory()} position={[0.1, 1.79, 0]} />
      {[-0.32, 0.34].map((x) => (
        <mesh
          key={x}
          geometry={torus(0.08, 0.018, 6, 12)}
          material={M.rubber()}
          position={[x, 1.7, 0]}
        />
      ))}
    </group>
  );
}

/** A giant velvet ring box, lid open, with the ring that costs more than the
 *  venue. Low enough to jump. */
export function RingBox() {
  const ring = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ring.current) ring.current.rotation.y = clock.elapsedTime * 1.8;
  });
  return (
    <group>
      <mesh geometry={box(0.8, 0.4, 0.7)} material={M.blushVelvet()} position={[0, 0.2, 0]} />
      <mesh geometry={box(0.82, 0.04, 0.72)} material={M.gold()} position={[0, 0.4, 0]} />
      <mesh
        geometry={box(0.8, 0.5, 0.06)}
        material={M.blushVelvet()}
        position={[0, 0.62, -0.38]}
        rotation={[-0.25, 0, 0]}
      />
      <mesh geometry={box(0.6, 0.06, 0.4)} material={M.ivory()} position={[0, 0.43, 0.05]} />
      <group ref={ring} position={[0, 0.58, 0.05]}>
        <mesh geometry={torus(0.13, 0.03, 8, 20)} material={M.gold()} />
        <mesh material={M.glass()} position={[0, 0.16, 0]} scale={[0.09, 0.11, 0.09]}>
          <octahedronGeometry args={[1, 0]} />
        </mesh>
      </group>
    </group>
  );
}

/** A nail polish bottle the size of a bridesmaid. Jump. */
export function NailPolish() {
  return (
    <group>
      <mesh geometry={box(0.56, 0.42, 0.56)} material={M.blushVelvet()} position={[0, 0.21, 0]} />
      <mesh geometry={box(0.6, 0.44, 0.6)} material={M.glass()} position={[0, 0.22, 0]} />
      <mesh geometry={box(0.3, 0.06, 0.02)} material={M.ivory()} position={[0, 0.22, 0.31]} />
      <mesh geometry={cylinder(0.11, 0.11, 0.08, 10)} material={M.gold()} position={[0, 0.48, 0]} />
      <mesh
        geometry={cylinder(0.1, 0.12, 0.26, 10)}
        material={M.rubber()}
        position={[0, 0.64, 0]}
      />
    </group>
  );
}

/** A teetering stack of invitations, top one sealed with wax. Jump. */
export function InvitationStack() {
  return (
    <group>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh
          key={i}
          geometry={box(0.82, 0.09, 0.6)}
          material={i % 2 === 0 ? M.envelope() : M.paper()}
          position={[Math.sin(i * 1.7) * 0.05, 0.05 + i * 0.095, 0]}
          rotation={[0, Math.sin(i * 2.3) * 0.18, 0]}
        />
      ))}
      <mesh
        geometry={box(0.82, 0.02, 0.3)}
        material={M.paperDeep()}
        position={[0, 0.7, 0.12]}
        rotation={[0.3, 0, 0]}
      />
      <mesh
        geometry={cylinder(0.08, 0.08, 0.03, 12)}
        material={M.danger()}
        position={[0, 0.71, 0.18]}
      />
      <mesh
        geometry={cone(0.05, 0.4, 6)}
        material={M.gold()}
        position={[0.36, 0.86, -0.1]}
        rotation={[0, 0, -0.5]}
      />
    </group>
  );
}
