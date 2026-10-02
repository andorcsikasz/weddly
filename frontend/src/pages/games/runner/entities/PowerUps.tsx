/**
 * Power-ups on the track, and what they look like ON the runner once taken.
 *
 * Three silhouettes that cannot be confused with cash at speed: a horseshoe
 * magnet, a gold "x2" diamond, and a glass bubble. Each floats over a glowing
 * ring in its own colour, because the ring is what the eye finds first in a
 * lane full of gold.
 *
 * The AURA is read straight off the engine's timers, so it can never outlast the
 * power-up it describes; it blinks for its last second and a half so the player
 * hears the clock running out with their eyes.
 */

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import type { ComponentType } from "react";
import * as THREE from "three";
import type { PowerUpId } from "@shared/runner";
import { M, box, cylinder, sphere, torus } from "../constants/materials";
import { PALETTE } from "../constants/palette";
import type { PowerUpInstance, RunState } from "../engine/RunEngine";

const RING_COLOR: Readonly<Record<PowerUpId, string>> = {
  magnet: PALETTE.magnet,
  double: PALETTE.gold,
  shield: PALETTE.shield,
};

function Magnet() {
  return (
    <group>
      {/* Half a torus turned upside down is the horseshoe; the chrome tips are
          the poles, pointing up. */}
      <mesh material={M.magnet()} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.24, 0.085, 8, 18, Math.PI]} />
      </mesh>
      {[-0.24, 0.24].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.088, 0.088, 0.16, 10)}
          material={M.chrome()}
          position={[x, 0.08, 0]}
        />
      ))}
    </group>
  );
}

function Doubler() {
  return (
    <group>
      <mesh material={M.gold()} scale={[0.32, 0.42, 0.32]}>
        <octahedronGeometry args={[1, 0]} />
      </mesh>
      <mesh
        geometry={box(0.5, 0.05, 0.05)}
        material={M.goldDeep()}
        rotation={[0, 0, Math.PI / 4]}
      />
      <mesh
        geometry={box(0.5, 0.05, 0.05)}
        material={M.goldDeep()}
        rotation={[0, 0, -Math.PI / 4]}
      />
    </group>
  );
}

function Shield() {
  return (
    <group>
      <mesh geometry={sphere(0.34, 18)} material={M.shieldGlass()} />
      <mesh geometry={sphere(0.13, 12)} material={M.ivory()} />
      <mesh
        geometry={torus(0.36, 0.02, 6, 24)}
        material={M.chrome()}
        rotation={[Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

const BODY: Readonly<Record<PowerUpId, ComponentType>> = {
  magnet: Magnet,
  double: Doubler,
  shield: Shield,
};

const KINDS = ["magnet", "double", "shield"] as const satisfies readonly PowerUpId[];

/** The pooled power-ups. Each slot mounts all three bodies and shows one, the
 *  same trick `Collectibles` uses for cash tiers. */
export function PowerUps({ read }: { read: () => readonly PowerUpInstance[] }) {
  const pool = useMemo(() => read(), []);
  const nodes = useRef<(THREE.Group | null)[]>([]);
  const bodies = useRef<Array<Array<THREE.Group | null>>>([]);
  const rings = useRef<(THREE.Mesh | null)[]>([]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < pool.length; i++) {
      const inst = pool[i];
      const node = nodes.current[i];
      if (!inst || !node) continue;
      node.visible = inst.active;
      if (!inst.active) continue;
      node.position.set(inst.x, inst.y + Math.sin(t * 3 + inst.phase) * 0.12, inst.z);
      const row = bodies.current[i];
      if (row) {
        for (let k = 0; k < KINDS.length; k++) {
          const b = row[k];
          if (!b) continue;
          b.visible = KINDS[k] === inst.kind;
          b.rotation.y = t * 2.2 + inst.phase;
        }
      }
      const ring = rings.current[i];
      if (ring) {
        (ring.material as THREE.MeshBasicMaterial).color.set(RING_COLOR[inst.kind]);
        const pulse = 1 + Math.sin(t * 6 + inst.phase) * 0.12;
        ring.scale.set(pulse, pulse, 1);
      }
    }
  });

  return (
    <group>
      {pool.map((_, i) => (
        <group
          key={i}
          ref={(n) => {
            nodes.current[i] = n;
          }}
          visible={false}
        >
          {KINDS.map((kind, k) => {
            const Body = BODY[kind];
            return (
              <group
                key={kind}
                ref={(n) => {
                  const row = (bodies.current[i] ??= [null, null, null]);
                  row[k] = n;
                }}
              >
                <Body />
              </group>
            );
          })}
          <mesh
            ref={(n) => {
              rings.current[i] = n;
            }}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, -0.88, 0]}
          >
            <ringGeometry args={[0.32, 0.5, 28]} />
            <meshBasicMaterial transparent opacity={0.7} depthWrite={false} />
          </mesh>
          {/* A tall soft beam so a power-up is findable from 60 m out. */}
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.05, 0.3, 3.2, 12, 1, true]} />
            <meshBasicMaterial
              color={PALETTE.champagne}
              transparent
              opacity={0.16}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** The shield bubble and the magnet halo, drawn around the runner. */
export function PlayerAura({ readState }: { readState: () => RunState }) {
  const bubble = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const s = readState();
    const t = clock.elapsedTime;
    const live = s.phase === "running" || s.phase === "paused";
    const height = s.sliding ? 0.55 : 0.95;
    // Blink for the last 1.5 s of any timer.
    const blink = (left: number) => left > 1.5 || Math.sin(t * 22) > 0;

    if (bubble.current) {
      const on = live && s.shield > 0 && blink(s.shield);
      bubble.current.visible = on;
      bubble.current.position.set(s.x, s.y + height, 0);
      const k = 1 + Math.sin(t * 5) * 0.04;
      bubble.current.scale.set(k, (s.sliding ? 0.7 : 1.05) * k, k);
    }
    if (halo.current) {
      const on = live && s.magnet > 0 && blink(s.magnet);
      halo.current.visible = on;
      halo.current.position.set(s.x, s.y + height, 0);
      halo.current.rotation.y = t * 4;
      halo.current.rotation.z = Math.sin(t * 2) * 0.3;
    }
    if (glow.current) {
      const on = live && s.doubler > 0 && blink(s.doubler);
      glow.current.visible = on;
      glow.current.position.set(s.x, 0.03, 0);
      const k = 1 + Math.sin(t * 8) * 0.1;
      glow.current.scale.set(k, k, 1);
    }
  });

  return (
    <>
      <mesh ref={bubble} geometry={sphere(1.0, 24)} material={M.shieldGlass()} visible={false} />
      <group ref={halo} visible={false}>
        {[0, 1, 2].map((i) => (
          <mesh
            key={i}
            geometry={torus(0.78 + i * 0.12, 0.018, 6, 36)}
            rotation={[Math.PI / 2 + i * 0.5, i * 0.7, 0]}
          >
            <meshBasicMaterial color={PALETTE.magnet} transparent opacity={0.55 - i * 0.12} />
          </mesh>
        ))}
      </group>
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.55, 0.85, 32]} />
        <meshBasicMaterial color={PALETTE.gold} transparent opacity={0.6} depthWrite={false} />
      </mesh>
    </>
  );
}
