/**
 * What lines the road in each venue after a fork. Same rules as the garden in
 * `Environment.tsx`: built from the shared primitives, placed off the path
 * (|x| > 3), and recycled with the road segments, so a venue costs draw calls
 * only while it is the one on screen.
 */

import { M, box, cone, cylinder, sphere } from "../constants/materials";

/** A round stone tower with a blush conical roof and a pennant. */
export function Tower() {
  return (
    <group>
      <mesh geometry={cylinder(1.1, 1.25, 6, 14)} material={M.stone()} position={[0, 3, 0]} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh
            key={i}
            geometry={box(0.42, 0.5, 0.42)}
            material={M.stone()}
            position={[Math.cos(a) * 1.05, 6.2, Math.sin(a) * 1.05]}
          />
        );
      })}
      <mesh geometry={cone(1.35, 2.4, 14)} material={M.blushVelvet()} position={[0, 7.6, 0]} />
      <mesh geometry={cylinder(0.04, 0.04, 1.2, 6)} material={M.lamp()} position={[0, 9.3, 0]} />
      <mesh geometry={box(0.7, 0.4, 0.02)} material={M.coin()} position={[0.36, 9.7, 0]} />
      {[2.2, 4.0].map((y) => (
        <mesh key={y} geometry={box(0.4, 0.6, 0.1)} material={M.rubber()} position={[0, y, 1.2]} />
      ))}
    </group>
  );
}

/** A crenellated curtain wall section, running along the road. */
export function CastleWall() {
  return (
    <group>
      <mesh geometry={box(0.8, 2.6, 8)} material={M.stone()} position={[0, 1.3, 0]} />
      {Array.from({ length: 6 }, (_, i) => (
        <mesh
          key={i}
          geometry={box(0.82, 0.5, 0.7)}
          material={M.stone()}
          position={[0, 2.85, -3.4 + i * 1.36]}
        />
      ))}
      <mesh geometry={box(0.05, 1.4, 0.9)} material={M.blushVelvet()} position={[0.43, 1.6, 0]} />
    </group>
  );
}

/** A clipped cone of hedge on a stone pot: formal-garden punctuation. */
export function Topiary() {
  return (
    <group>
      <mesh geometry={cylinder(0.35, 0.3, 0.5, 10)} material={M.stone()} position={[0, 0.25, 0]} />
      <mesh geometry={cone(0.55, 1.8, 12)} material={M.hedge()} position={[0, 1.4, 0]} />
    </group>
  );
}

/** A vineyard row seen end-on: posts, a wire, and a long hedge of vine with
 *  grape clusters. Rows run perpendicular to the road, which is what makes a
 *  vineyard read as one at speed. */
export function VineRow() {
  return (
    <group>
      <mesh geometry={box(9, 1.1, 0.5)} material={M.leaf()} position={[0, 0.95, 0]} />
      <mesh geometry={box(9, 0.5, 0.4)} material={M.leafLight()} position={[0, 1.55, 0]} />
      {[-4, -1.5, 1, 3.5].map((x) => (
        <group key={x}>
          <mesh
            geometry={cylinder(0.05, 0.05, 1.9, 6)}
            material={M.bark()}
            position={[x, 0.95, 0]}
          />
          <mesh
            geometry={sphere(0.16, 8)}
            material={M.blushVelvet()}
            position={[x + 0.6, 0.55, 0.27]}
            scale={[0.8, 1.2, 0.8]}
          />
        </group>
      ))}
    </group>
  );
}

export function Barrel() {
  return (
    <group>
      <mesh geometry={cylinder(0.42, 0.42, 0.95, 14)} material={M.bark()} position={[0, 0.48, 0]} />
      {[0.15, 0.8].map((y) => (
        <mesh
          key={y}
          geometry={cylinder(0.44, 0.44, 0.06, 14)}
          material={M.lamp()}
          position={[0, y, 0]}
        />
      ))}
    </group>
  );
}

/** A tall thin cypress: the Tuscan exclamation mark. */
export function Cypress() {
  return (
    <group>
      <mesh geometry={cylinder(0.12, 0.16, 0.8, 6)} material={M.bark()} position={[0, 0.4, 0]} />
      <mesh
        geometry={sphere(0.75, 10)}
        material={M.hedge()}
        position={[0, 3, 0]}
        scale={[1, 3.2, 1]}
      />
    </group>
  );
}

/** A weeping willow: a round crown with long curtains of leaf. */
export function Willow() {
  return (
    <group>
      <mesh geometry={cylinder(0.2, 0.32, 3.2, 8)} material={M.bark()} position={[0, 1.6, 0]} />
      <mesh
        geometry={sphere(1.8, 12)}
        material={M.leafLight()}
        position={[0, 4, 0]}
        scale={[1, 0.7, 1]}
      />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <mesh
            key={i}
            geometry={box(0.5, 2.6, 0.12)}
            material={M.leaf()}
            position={[Math.cos(a) * 1.5, 2.6, Math.sin(a) * 1.5]}
            rotation={[0, -a, 0]}
          />
        );
      })}
    </group>
  );
}

export function Reeds() {
  return (
    <group>
      {Array.from({ length: 7 }, (_, i) => (
        <group key={i} position={[Math.sin(i * 2.1) * 0.5, 0, Math.cos(i * 1.7) * 0.5]}>
          <mesh
            geometry={cylinder(0.02, 0.03, 1.4 + (i % 3) * 0.3, 5)}
            material={M.leaf()}
            position={[0, 0.7, 0]}
            rotation={[0, 0, Math.sin(i) * 0.15]}
          />
          <mesh
            geometry={cylinder(0.05, 0.05, 0.3, 6)}
            material={M.bark()}
            position={[Math.sin(i) * 0.1, 1.5 + (i % 3) * 0.3, 0]}
          />
        </group>
      ))}
    </group>
  );
}

/** A little timber jetty with a rowboat tied to it. */
export function Jetty() {
  return (
    <group>
      <mesh geometry={box(4, 0.12, 1.4)} material={M.bark()} position={[0, 0.25, 0]} />
      {[-1.8, 0, 1.8].map((x) => (
        <mesh
          key={x}
          geometry={cylinder(0.08, 0.08, 0.8, 6)}
          material={M.bark()}
          position={[x, 0, 0.6]}
        />
      ))}
      <group position={[0.5, 0.05, 1.5]}>
        <mesh geometry={box(2.2, 0.35, 0.8)} material={M.ivory()} />
        <mesh geometry={box(2.0, 0.08, 0.6)} material={M.bark()} position={[0, 0.12, 0]} />
        <mesh
          geometry={cone(0.4, 0.6, 4)}
          material={M.ivory()}
          position={[1.3, 0, 0]}
          rotation={[0, 0, -Math.PI / 2]}
        />
      </group>
    </group>
  );
}

/** A red barn with a white-trimmed gable and a hay loft door. */
export function Barn() {
  return (
    <group>
      <mesh geometry={box(5, 3.4, 6)} material={M.barnRed()} position={[0, 1.7, 0]} />
      <mesh
        geometry={cylinder(0.01, 3.6, 2.2, 4)}
        material={M.barnRoof()}
        position={[0, 4.5, 0]}
        rotation={[0, Math.PI / 4, 0]}
        scale={[1, 1, 1.18]}
      />
      <mesh geometry={box(1.6, 2.2, 0.06)} material={M.ivory()} position={[0, 1.1, 3.02]} />
      <mesh geometry={box(1.2, 2.0, 0.07)} material={M.barnRed()} position={[0, 1.05, 3.03]} />
      <mesh geometry={box(0.8, 0.8, 0.06)} material={M.ivory()} position={[0, 3.1, 3.02]} />
      {[-1, 1].map((d) => (
        <mesh
          key={d}
          geometry={box(0.08, 2.2, 0.08)}
          material={M.ivory()}
          position={[d * 0.8, 1.1, 3.05]}
          rotation={[0, 0, d * 0.5]}
        />
      ))}
    </group>
  );
}

export function HayBale() {
  return (
    <group>
      <mesh
        geometry={cylinder(0.6, 0.6, 1.1, 14)}
        material={M.hay()}
        position={[0, 0.6, 0]}
        rotation={[0, 0, Math.PI / 2]}
      />
      <mesh
        geometry={cylinder(0.45, 0.45, 1.12, 14)}
        material={M.paperDeep()}
        position={[0, 0.6, 0]}
        rotation={[0, 0, Math.PI / 2]}
      />
    </group>
  );
}

/** A post-and-rail fence section, along the road. */
export function Fence() {
  return (
    <group>
      {[-2.4, -0.8, 0.8, 2.4].map((z) => (
        <mesh
          key={z}
          geometry={box(0.12, 1.1, 0.12)}
          material={M.ivory()}
          position={[0, 0.55, z]}
        />
      ))}
      {[0.45, 0.85].map((y) => (
        <mesh key={y} geometry={box(0.06, 0.1, 5)} material={M.ivory()} position={[0, y, 0]} />
      ))}
    </group>
  );
}

/** Festoon lights on two poles: the barn reception's string of bulbs. */
export function StringLights() {
  return (
    <group>
      {[-2.2, 2.2].map((z) => (
        <mesh
          key={z}
          geometry={cylinder(0.05, 0.06, 3.2, 6)}
          material={M.bark()}
          position={[0, 1.6, z]}
        />
      ))}
      {Array.from({ length: 9 }, (_, i) => {
        const t = i / 8;
        return (
          <mesh
            key={i}
            geometry={sphere(0.09, 8)}
            material={i % 2 ? M.bulb() : M.glow()}
            position={[0, 3.0 - Math.sin(t * Math.PI) * 0.5, -2.2 + t * 4.4]}
          />
        );
      })}
    </group>
  );
}
