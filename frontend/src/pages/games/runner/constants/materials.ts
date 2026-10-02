/**
 * Shared materials and geometries.
 *
 * Everything in the game is built from primitives, so the single biggest cost
 * after fill rate is `new THREE.MeshStandardMaterial()` — a fresh material per
 * mesh means a fresh shader program per mesh, and a runner that rebuilds its
 * body on every lane change drops to single-digit FPS on a mid-range laptop.
 * These are created once, lazily, and shared by every mesh that asks for the
 * same look. They are never mutated after creation.
 */

import * as THREE from "three";
import { PALETTE } from "./palette";

const registry = new Map<string, THREE.Material>();

function mat(
  key: string,
  color: string,
  extra: {
    roughness?: number;
    metalness?: number;
    flatShading?: boolean;
    emissive?: string;
    /** Defaults to the faint 0.12 lift; pickups go much higher so they glow. */
    emissiveIntensity?: number;
    transparent?: boolean;
    opacity?: number;
    side?: THREE.Side;
  } = {},
): THREE.Material {
  const hit = registry.get(key);
  if (hit) return hit;
  const made = new THREE.MeshStandardMaterial({
    color,
    roughness: extra.roughness ?? 0.78,
    metalness: extra.metalness ?? 0,
    flatShading: extra.flatShading ?? false,
    // A whisper of self-illumination on the ivory and the gold so the low-sun
    // garden does not turn a white dress into a grey shape.
    emissive: extra.emissive ?? "#000000",
    emissiveIntensity: extra.emissive ? (extra.emissiveIntensity ?? 0.12) : 0,
    transparent: extra.transparent ?? false,
    opacity: extra.opacity ?? 1,
    side: extra.side ?? THREE.FrontSide,
    // Transparent props must not write depth or they occlude whatever is
    // behind them; the veil is the only one, and this is what keeps it a veil
    // rather than a milky panel.
    depthWrite: extra.transparent ? false : true,
  });
  registry.set(key, made);
  return made;
}

export const M = {
  /** The dress, the cake, the paper, the path markings. Slightly emissive so
   *  it stays ivory in shadow instead of reading as dirty grey. */
  ivory: () => mat("ivory", PALETTE.paper50, { roughness: 0.62, emissive: PALETTE.paper100 }),
  paper: () => mat("paper", PALETTE.paper200, { roughness: 0.85 }),
  paperDeep: () => mat("paperDeep", PALETTE.paper400, { roughness: 0.9 }),
  /** Skin. One warm tone shared by both characters — the faces are stylised
   *  (no eyes modelled, see `Runner.tsx`) so a single tone is enough and keeps
   *  the cast inclusive without a skin-tone picker. */
  skin: () => mat("skin", "#e8b892", { roughness: 0.7 }),
  skinDeep: () => mat("skinDeep", "#c98f66", { roughness: 0.7 }),
  hair: () => mat("hair", PALETTE.umber700, { roughness: 0.6 }),
  hairLight: () => mat("hairLight", "#9a6b3f", { roughness: 0.6 }),
  /** Groom's tailoring. `ink` rather than `umber` so the tuxedo reads as
   *  tailoring in a warm garden and not as a brown box. */
  tuxedo: () => mat("tuxedo", PALETTE.ink900, { roughness: 0.5 }),
  tuxedoLining: () => mat("tuxedoLining", PALETTE.blush500, { roughness: 0.6 }),
  shirt: () => mat("shirt", PALETTE.white, { roughness: 0.6 }),
  bowTie: () => mat("bowTie", PALETTE.blush600, { roughness: 0.5 }),
  /** The veil. Double-sided and transparent so the garden is visible through
   *  it — an opaque veil hides the character's whole silhouette. */
  veil: () =>
    mat("veil", PALETTE.paper100, {
      roughness: 0.92,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
    }),
  bouquet: () => mat("bouquet", PALETTE.blush300, { roughness: 0.6 }),
  bouquetLeaf: () => mat("bouquetLeaf", PALETTE.sage500, { roughness: 0.8 }),
  gold: () =>
    mat("gold", PALETTE.gold, { roughness: 0.28, metalness: 0.85, emissive: PALETTE.gold }),
  goldDeep: () => mat("goldDeep", PALETTE.goldDeep, { roughness: 0.3, metalness: 0.8 }),
  champagne: () =>
    mat("champagne", PALETTE.champagne, {
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
    }),
  /** Window glass: a limousine windscreen and the champagne coupes. Distinct
   *  from `champagne`, which is a LIQUID — reusing it here would put the
   *  drinks at the opacity of a car window. */
  glass: () =>
    mat("glass", "#bcd6e8", {
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
    }),
  /** PICKUPS GLOW. A coin used to be the metallic `gold` (0.85 metalness), which
   *  in this low sun rendered as a brown disc on a beige path: nothing about it
   *  said "collect me". Pickups are now saturated and self-lit, so money reads as
   *  money against every surface in the scene. */
  coin: () =>
    mat("coin", PALETTE.coin, {
      roughness: 0.35,
      metalness: 0.2,
      emissive: PALETTE.coin,
      emissiveIntensity: 0.55,
    }),
  coinRim: () =>
    mat("coinRim", PALETTE.coinDeep, {
      roughness: 0.3,
      metalness: 0.3,
      emissive: PALETTE.coinDeep,
      emissiveIntensity: 0.4,
    }),
  /** Banknotes: a vivid money green, lit from within for the same reason. */
  cash: () =>
    mat("cash", PALETTE.cash, { roughness: 0.55, emissive: PALETTE.cash, emissiveIntensity: 0.45 }),
  cashBack: () =>
    mat("cashBack", PALETTE.cashDeep, {
      roughness: 0.55,
      emissive: PALETTE.cashDeep,
      emissiveIntensity: 0.35,
    }),
  envelope: () => mat("envelope", PALETTE.paper50, { roughness: 0.85 }),
  /** A darker blush for the photo booth curtain and anything that has to read
   *  as fabric in shadow. `bowTie` is the same tone at a different size, but
   *  a curtain 2.3 m tall deserves its own name. */
  blushDeep: () => mat("blushDeep", PALETTE.blush600, { roughness: 0.62 }),
  /** Near-black for tyres. `tuxedo` is the dark navy of the suit, and a tyre is
   *  neither navy nor the same value as a windscreen, so it gets its own. */
  rubber: () => mat("rubber", PALETTE.umber950, { roughness: 0.95 }),
  /** The tote: cream canvas. */
  tote: () => mat("tote", PALETTE.paper100, { roughness: 0.92 }),
  toteInk: () => mat("toteInk", PALETTE.sage600, { roughness: 0.8 }),

  /* Environment */
  grass: () => mat("grass", PALETTE.sage500, { roughness: 0.95, flatShading: true }),
  grassDark: () => mat("grassDark", PALETTE.sage700, { roughness: 0.95, flatShading: true }),
  grassLight: () => mat("grassLight", PALETTE.sage400, { roughness: 0.95, flatShading: true }),
  bark: () => mat("bark", PALETTE.umber600, { roughness: 0.95, flatShading: true }),
  leaf: () => mat("leaf", PALETTE.moss600, { roughness: 0.9, flatShading: true }),
  leafLight: () => mat("leafLight", PALETTE.sage400, { roughness: 0.9, flatShading: true }),
  blossom: () => mat("blossom", PALETTE.blush200, { roughness: 0.75, flatShading: true }),
  blossomPale: () => mat("blossomPale", PALETTE.paper100, { roughness: 0.75, flatShading: true }),
  hedge: () => mat("hedge", PALETTE.sage800, { roughness: 0.95, flatShading: true }),
  stone: () => mat("stone", PALETTE.paper400, { roughness: 0.92, flatShading: true }),
  manor: () => mat("manor", "#cfc3ad", { roughness: 0.9, flatShading: true }),
  manorRoof: () => mat("manorRoof", "#8a7a68", { roughness: 0.9, flatShading: true }),
  lamp: () => mat("lamp", PALETTE.umber800, { roughness: 0.6, metalness: 0.4 }),
  /** Warm glass, emissive — the fairy lights and the champagne tower. */
  glow: () =>
    mat("glow", PALETTE.champagne, {
      roughness: 0.3,
      emissive: PALETTE.champagne,
    }),
  bulb: () => mat("bulb", PALETTE.gold, { roughness: 0.2, emissive: PALETTE.gold }),
  /** The red that means "this is a cost". */
  danger: () => mat("danger", PALETTE.blush600, { roughness: 0.6 }),
  slate: () => mat("slate", "#5d6b70", { roughness: 0.6, metalness: 0.3 }),
  chrome: () => mat("chrome", "#b8c0c4", { roughness: 0.25, metalness: 0.7 }),
  /** Tulle: the sheer overskirt over the gown. Double-sided so the layer reads
   *  from inside the hem too as the skirt swings. */
  tulle: () =>
    mat("tulle", PALETTE.paper50, {
      roughness: 0.95,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  /** Lace trim and pearls: brighter than the ivory, with a little sheen. */
  lace: () => mat("lace", PALETTE.white, { roughness: 0.75, emissive: PALETTE.paper50 }),
  pearl: () =>
    mat("pearl", PALETTE.paper50, { roughness: 0.15, metalness: 0.25, emissive: PALETTE.paper100 }),
  /** Satin: the sash, the bow and the groom's trouser stripe catch the light. */
  satin: () => mat("satin", PALETTE.blush300, { roughness: 0.3, metalness: 0.15 }),
  satinInk: () => mat("satinInk", PALETTE.ink700, { roughness: 0.25, metalness: 0.2 }),
  barnRed: () => mat("barnRed", PALETTE.barnRed, { roughness: 0.85, flatShading: true }),
  barnRoof: () => mat("barnRoof", PALETTE.barnRoof, { roughness: 0.9, flatShading: true }),
  hay: () => mat("hay", PALETTE.hay, { roughness: 1, flatShading: true }),
  iris: () => mat("iris", PALETTE.iris, { roughness: 0.3 }),
  /** Velvet: the ring box and the polish. Deep blush, fully matte. */
  blushVelvet: () => mat("blushVelvet", PALETTE.blush600, { roughness: 1 }),
  magnet: () => mat("magnet", PALETTE.magnet, { roughness: 0.35, emissive: PALETTE.magnet }),
  shieldGlass: () =>
    mat("shieldGlass", PALETTE.shield, {
      roughness: 0.1,
      metalness: 0.1,
      emissive: PALETTE.shield,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    }),
} as const;

/** A physically based cloth/skin material, registered like the rest. The rig
 *  is the one thing the camera stares at all run, so it gets sheen (fabric that
 *  catches a rim of light), clearcoat (satin lapels, a polished deck) and a
 *  softer roughness than the props' flat matte. */
function physical(key: string, params: THREE.MeshPhysicalMaterialParameters): THREE.Material {
  const hit = registry.get(key);
  if (hit) return hit;
  const made = new THREE.MeshPhysicalMaterial(params);
  registry.set(key, made);
  return made;
}

export const RIG = {
  gown: () =>
    physical("rig:gown", {
      color: PALETTE.paper50,
      roughness: 0.55,
      sheen: 1,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(PALETTE.blush100),
      emissive: new THREE.Color(PALETTE.paper100),
      emissiveIntensity: 0.18,
    }),
  tux: () =>
    physical("rig:tux", {
      color: PALETTE.ink900,
      roughness: 0.48,
      sheen: 0.6,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(PALETTE.ink700),
      clearcoat: 0.15,
    }),
  skin: () =>
    physical("rig:skin", {
      color: PALETTE.skinTone,
      roughness: 0.52,
      sheen: 0.4,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color(PALETTE.skinSheen),
    }),
  skinDeep: () =>
    physical("rig:skinDeep", {
      color: PALETTE.skinToneDeep,
      roughness: 0.55,
      sheen: 0.3,
      sheenColor: new THREE.Color(PALETTE.skinSheen),
    }),
  hair: () =>
    physical("rig:hair", {
      color: PALETTE.umber700,
      roughness: 0.38,
      sheen: 0.8,
      sheenRoughness: 0.3,
      sheenColor: new THREE.Color(PALETTE.hairSheen),
    }),
  hairLight: () =>
    physical("rig:hairLight", {
      color: PALETTE.hairLight,
      roughness: 0.38,
      sheen: 0.8,
      sheenRoughness: 0.3,
      sheenColor: new THREE.Color(PALETTE.hairLightSheen),
    }),
} as const;

/** Release every shared material. The scene owns these for the lifetime of the
 *  route, so the page calls this on unmount. */
export function disposeMaterials(): void {
  for (const material of registry.values()) material.dispose();
  registry.clear();
}

/** Geometry cache — same argument as the material registry: a `SphereGeometry`
 *  per flower petal is a lot of allocation for nothing. */
const geoRegistry = new Map<string, THREE.BufferGeometry>();

export function geo<T extends THREE.BufferGeometry>(key: string, build: () => T): T {
  const hit = geoRegistry.get(key);
  if (hit) return hit as T;
  const made = build();
  geoRegistry.set(key, made);
  return made;
}

export function disposeGeometries(): void {
  for (const g of geoRegistry.values()) g.dispose();
  geoRegistry.clear();
}

/** The capsule the collision box is drawn as, used for limbs and props. */
export const limb = (radius: number, length: number, key: string) =>
  geo(`limb:${key}`, () => {
    const g = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 10);
    // A capsule is built along +Y with its centre at the origin. Limbs are
    // rotated around their TOP joint, so every limb geometry is shifted down by
    // half its length once, here, rather than in each of the ~40 meshes that
    // use it.
    g.translate(0, -length / 2, 0);
    return g;
  });

export const box = (w: number, h: number, d: number) =>
  geo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

export const sphere = (r: number, segments = 12) =>
  geo(
    `sphere:${r}:${segments}`,
    () => new THREE.SphereGeometry(r, segments, Math.max(6, segments >> 1)),
  );

export const cylinder = (rt: number, rb: number, h: number, segments = 14) =>
  geo(`cyl:${rt}:${rb}:${h}:${segments}`, () => new THREE.CylinderGeometry(rt, rb, h, segments));

export const cone = (r: number, h: number, segments = 12) =>
  geo(`cone:${r}:${h}:${segments}`, () => new THREE.ConeGeometry(r, h, segments));

export const torus = (r: number, tube: number, segments = 8, rings = 16) =>
  geo(
    `torus:${r}:${tube}:${segments}:${rings}`,
    () => new THREE.TorusGeometry(r, tube, segments, rings),
  );

export const plane = (w: number, h: number) =>
  geo(`plane:${w}:${h}`, () => new THREE.PlaneGeometry(w, h));
