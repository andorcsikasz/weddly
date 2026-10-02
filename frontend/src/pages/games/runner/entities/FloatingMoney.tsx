/**
 * The money labels that rise off a pickup.
 *
 * WHY A SEPARATE COMPONENT AND NOT A FLAG ON THE COIN: the coin is DEACTIVATED the
 * instant it is collected, because the engine pools instances and a slot that
 * lingers is a slot the next row cannot use. So there is nothing left to hang an
 * animation on. These labels are their own pooled objects instead, living for well
 * under a second, and — like everything else on screen — they advance off the
 * ENGINE'S clock rather than React state, because a setState per label per frame
 * would re-render the whole scene sixty times a second to move a sprite.
 *
 * THE AMOUNT IS NOT COMPUTED HERE. `FloatRequest.value` is what the engine actually
 * paid, multiplier included. Deriving it again from the tier would be a second
 * answer to "what was that worth", and it would read the face value — the one
 * number on screen that is wrong precisely when the player feels richest.
 */

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group, Texture } from "three";
import { Sprite, SpriteMaterial } from "three";
import type { FloatRequest } from "../engine/RunEngine";
import { moneyLabelTexture } from "../utils/textures";

/** How long one label lives, in seconds of GAME time — which is what makes this
 *  robust: a dropped frame shortens a label's life instead of stretching it, and a
 *  pause does not resume every label halfway up. Long enough to be read at running
 *  speed, short enough to stay out of the track's way. */
const LIFE = 0.85;
const BAG_LIFE = 1.15;
/** Metres a label climbs over its life. */
const RISE = 1.6;
/** Fraction of the life spent popping, before the rise takes over. */
const POP = 0.18;
/** Width:height of the plate `moneyLabelTexture` draws, plus the arc on the bag
 *  variant. Matches the texture's own canvas so the sprite is never squashed. */
const ASPECT = 4.1;

/** Pool, sized for a sustained sweep rather than a single burst: crossing a whole
 *  row queues three at once, and an arc collected cleanly keeps producing more
 *  while the previous ones are still climbing. */
const POOL = 14;

export interface FloatingMoneyProps {
  /** Drain the engine's queue. The component calls this itself, once a frame. */
  drain: () => readonly FloatRequest[];
  readClock: () => number;
  /** The couple's money, formatted. Passed in rather than imported so this file
   *  holds no opinion about the locale or the currency. */
  format: (amount: number, currency: FloatRequest["currency"]) => string;
}

interface Slot {
  sprite: Sprite;
  material: SpriteMaterial;
  /** Absolute engine time this label was born at, or null when the slot is idle. */
  born: number | null;
  life: number;
  big: boolean;
  /** The cached texture this slot is currently showing, so a slot is never
   *  re-rasterised for a label it is not about to draw. */
  key: string;
  baseY: number;
}

export function FloatingMoney({ drain, readClock, format }: FloatingMoneyProps) {
  const group = useRef<Group>(null);
  const slots = useMemo<Slot[]>(
    () =>
      Array.from({ length: POOL }, () => {
        const material = new SpriteMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        const sprite = new Sprite(material);
        sprite.visible = false;
        // Above every prop, so a label is never half-buried in a hedge.
        sprite.renderOrder = 20;
        return { sprite, material, born: null, life: 0, big: false, key: "", baseY: 0 };
      }),
    [],
  );

  // A pool of materials and sprites is GPU memory, so it goes back on unmount.
  // The TEXTURES are not disposed here: they live in the shared texture cache,
  // which the scene owns and disposes wholesale.
  useEffect(() => {
    const parent = group.current;
    return () => {
      for (const slot of slots) slot.material.dispose();
      for (const slot of slots) parent?.remove(slot.sprite);
    };
  }, [slots]);

  useFrame(() => {
    const parent = group.current;
    if (!parent) return;

    const batch = drain();
    for (const request of batch) {
      const slot = slots.find((s) => s.born === null);
      if (!slot) break;
      const text = format(request.value, request.currency);
      const key = `${request.big ? "b" : "s"}|${text}`;
      if (slot.key !== key) {
        const texture: Texture | null = moneyLabelTexture(text, request.big);
        if (texture) {
          slot.material.map = texture;
          slot.material.needsUpdate = true;
          slot.key = key;
        }
      }
      slot.born = readClock();
      slot.life = request.big ? BAG_LIFE : LIFE;
      slot.big = request.big;
      slot.baseY = request.y;
      slot.sprite.position.set(request.x, request.y, request.z);
      slot.material.opacity = 1;
      const base = request.big ? 0.66 : 0.44;
      slot.sprite.scale.set(base * ASPECT, base, 1);
      slot.sprite.visible = true;
      if (slot.sprite.parent !== parent) parent.add(slot.sprite);
    }

    const now = readClock();
    for (const slot of slots) {
      if (slot.born === null) continue;
      const elapsed = now - slot.born;
      if (elapsed >= slot.life) {
        slot.born = null;
        slot.sprite.visible = false;
        parent.remove(slot.sprite);
        continue;
      }
      const t = elapsed / slot.life;

      // Pop first, then rise. Both curves matter: a label that only rises reads as
      // a bubble, and one that only pops disappears before it can be read.
      const ease = 1 - Math.pow(1 - t, 2);
      slot.sprite.position.y = slot.baseY + RISE * ease;
      slot.material.opacity = t < POP ? 1 : 1 - (t - POP) / (1 - POP);
      const pop = t < POP ? 1.5 - (t / POP) * 0.5 : 1;
      const base = slot.big ? 0.66 : 0.44;
      slot.sprite.scale.set(base * pop * ASPECT, base * pop, 1);
    }
  });

  return <group ref={group} />;
}
