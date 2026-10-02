/**
 * Every texture in the game is DRAWN at runtime into a 2D canvas and uploaded
 * as a `THREE.CanvasTexture`. There is not one image file in this project.
 *
 * Two reasons, both of which are about being replaceable rather than about
 * saving bytes:
 *
 *  - The brief asks for a clean placeholder Weddly logo on the tote bags that
 *    can be swapped later. A generated wordmark is the most replaceable logo
 *    there is: `weddlyLogoTexture()` is one function, and replacing it with
 *    `new THREE.TextureLoader().load("/weddly-logo.png")` needs no other change
 *    in the codebase. Same for every sign.
 *  - The repo has no asset pipeline, no CDN and no image files anywhere in the
 *    games feature, so a game that wanted to ship art would mean introducing
 *    one. Drawing instead means the whole thing builds from source and every
 *    surface is inspectable.
 *
 * Textures are cached by their own key. Two arches showing the same sign share
 * one GPU upload, and re-rendering a canvas per frame would be the single
 * biggest cost in the scene.
 */

import * as THREE from "three";
import { PALETTE } from "../constants/palette";

type Ctx = CanvasRenderingContext2D;

const cache = new Map<string, THREE.CanvasTexture>();

/** Drop every cached texture. Called on unmount by the scene so a remount does
 *  not accumulate GPU uploads across route changes. */
export function disposeTextures(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: Ctx } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { canvas, ctx };
}

function finish(
  key: string,
  canvas: HTMLCanvasElement,
  opts: { srgb?: boolean; repeat?: [number, number] } = {},
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (opts.repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/* ── The Weddly placeholder mark ───────────────────────────────────────── */

/**
 * THE LOGO HOOK. A generated wordmark plus the domain, drawn on transparent
 * ground so it can be applied to any surface (the tote is the only one today).
 *
 * To use the real logo instead, delete this function's body and return
 * `new THREE.TextureLoader().load("/weddly-logo.png")` — every call site
 * already asks for a texture, so nothing else changes. `transparent` must be
 * preserved or the tote bag gets an opaque rectangle painted on it.
 */
export function weddlyLogoTexture(): THREE.CanvasTexture | null {
  const key = "weddly-logo";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(512, 256);
  if (!made) return null;
  const { canvas, ctx } = made;

  // The mark itself: a sprig of two leaves, standing in for the real logo's
  // growth motif without copying any shape that belongs to somebody else.
  ctx.save();
  ctx.translate(256, 96);
  ctx.fillStyle = PALETTE.sage500;
  ctx.beginPath();
  ctx.ellipse(-34, 6, 30, 15, -0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(30, -10, 26, 13, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.sage700;
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 34);
  ctx.lineTo(0, -28);
  ctx.stroke();
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.sage700;
  ctx.font = "700 78px Georgia, 'Times New Roman', serif";
  ctx.fillText("Weddly", 256, 178);

  ctx.fillStyle = PALETTE.sage500;
  ctx.font = "600 30px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.fillText("tryweddly.com", 256, 222);

  return finish(key, canvas);
}

/* ── Signage ───────────────────────────────────────────────────────────── */

export interface SignTextureOptions {
  /** Wood, painted board, hanging linen… changes the board and the grain. */
  readonly board?: "wood" | "painted" | "linen";
  readonly textColor?: string;
  readonly arrow?: "left" | "right" | "none";
}

/**
 * A direction signboard — the "Ceremony / Reception / Budget Exit" family.
 * Returns a board with the text baked in, sized for a 2:1 plane.
 */
export function signTexture(title: string, subtitle?: string, opts: SignTextureOptions = {}) {
  const key = `sign:${title}:${subtitle ?? ""}:${opts.board ?? "wood"}:${opts.arrow ?? "none"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(512, 256);
  if (!made) return null;
  const { canvas, ctx } = made;
  const board = opts.board ?? "wood";

  // Board.
  if (board === "wood") {
    ctx.fillStyle = PALETTE.umber600;
    ctx.fillRect(0, 0, 512, 256);
    // Grain: five low-alpha strokes, deterministic so the sign is identical
    // every time it is drawn.
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      const y = 26 + i * 42;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(140, y - 9, 340, y + 11, 512, y - 4);
      ctx.stroke();
    }
  } else if (board === "painted") {
    ctx.fillStyle = PALETTE.paper100;
    ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = PALETTE.sage600;
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, 484, 228);
  } else {
    ctx.fillStyle = PALETTE.paper200;
    ctx.fillRect(0, 0, 512, 256);
  }

  ctx.textAlign = "center";
  ctx.fillStyle = opts.textColor ?? (board === "wood" ? PALETTE.paper100 : PALETTE.umber800);
  ctx.font = "700 62px Georgia, 'Times New Roman', serif";
  ctx.fillText(title, 256, subtitle ? 116 : 148);

  if (subtitle) {
    ctx.font = "600 34px 'Helvetica Neue', Helvetica, Arial, sans-serif";
    ctx.globalAlpha = 0.72;
    ctx.fillText(subtitle, 256, 176);
    ctx.globalAlpha = 1;
  }

  if (opts.arrow && opts.arrow !== "none") {
    const x = opts.arrow === "left" ? 44 : 468;
    ctx.fillStyle = opts.textColor ?? (board === "wood" ? PALETTE.paper100 : PALETTE.umber800);
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x + (opts.arrow === "left" ? -30 : 30), 100);
    ctx.lineTo(x + (opts.arrow === "left" ? -30 : 30), 156);
    ctx.closePath();
    ctx.fill();
  }

  return finish(key, canvas);
}

/* ── The bills ─────────────────────────────────────────────────────────── */

/**
 * A printed invoice. Used for the giant receipt, the SERVICE FEE sign and the
 * last-minute cost board — the same prop three times with a different total,
 * which is the joke: it is always the same bill.
 *
 * `lines` are drawn as a monospaced receipt with a dotted rule, so at a glance
 * in-lane it reads as "money, unpleasant" without anyone having to read it.
 */
export function receiptTexture(headline: string, lines: readonly string[], total: string) {
  const key = `receipt:${headline}:${lines.join("|")}:${total}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(384, 512);
  if (!made) return null;
  const { canvas, ctx } = made;

  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(0, 0, 384, 512);
  // Torn top edge, so it reads as a receipt and not as a whiteboard.
  ctx.fillStyle = PALETTE.paper;
  ctx.beginPath();
  ctx.moveTo(0, 14);
  for (let x = 0; x <= 384; x += 16) {
    ctx.lineTo(x, x % 32 === 0 ? 0 : 14);
  }
  ctx.lineTo(384, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(43,38,32,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 26, 348, 470);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.ink;
  ctx.font = "700 42px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  wrapText(ctx, headline, 192, 84, 320, 48);

  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(40, 116);
  ctx.lineTo(344, 116);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "left";
  ctx.font = "400 26px 'SF Mono', Menlo, Consolas, monospace";
  ctx.fillStyle = "rgba(43,38,32,0.8)";
  let y = 152;
  for (const line of lines) {
    ctx.fillText(line, 40, y);
    y += 36;
  }

  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.moveTo(40, y + 6);
  ctx.lineTo(344, y + 6);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.blush600;
  ctx.font = "800 40px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.fillText(total, 192, y + 62);
  ctx.font = "600 22px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.fillStyle = "rgba(43,38,32,0.62)";
  ctx.fillText("thank you for your business", 192, y + 100);

  return finish(key, canvas);
}

/** The enormous SERVICE FEE board: one word, red, and nothing else. Reads as a
 *  threat from thirty metres out, which is the point. */
export function serviceFeeTexture() {
  const key = "service-fee";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(512, 512);
  if (!made) return null;
  const { canvas, ctx } = made;
  ctx.fillStyle = PALETTE.paper200;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = PALETTE.blush600;
  ctx.fillRect(0, 0, 512, 92);
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.paper50;
  ctx.font = "800 52px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.fillText("SERVICE", 256, 62);
  ctx.fillStyle = PALETTE.blush600;
  ctx.font = "800 132px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.fillText("FEE", 256, 258);
  ctx.fillStyle = PALETTE.umber800;
  ctx.font = "700 40px Georgia, serif";
  ctx.fillText("non-negotiable", 256, 330);
  ctx.font = "500 30px 'Helvetica Neue', Helvetica, Arial, sans-serif";
  ctx.fillStyle = "rgba(58,46,34,0.7)";
  ctx.fillText("per vendor · per hour", 256, 380);
  ctx.fillText("cash only", 256, 424);
  return finish(key, canvas);
}

/* ── Ground ────────────────────────────────────────────────────────────── */

/**
 * The garden path. One texture, tiled along z, scrolled every frame to sell
 * forward motion. Deliberately LOW contrast: the path's job is to show three
 * lanes and a direction, and a busy pattern under three lanes of obstacles is
 * how a runner becomes unreadable.
 *
 * The lane hint is baked in as two faint gravel seams, not three painted
 * stripes — a painted lane on a garden path would look like a bowling alley.
 */
export function pathTexture(): THREE.CanvasTexture | null {
  const key = "path";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(256, 256);
  if (!made) return null;
  const { canvas, ctx } = made;
  ctx.fillStyle = PALETTE.paper300;
  ctx.fillRect(0, 0, 256, 256);

  // Deterministic speckle: three passes of dots from a tiny LCG so the gravel
  // is identical on every machine (a per-run random path texture would make
  // the ground shimmer as the player scrolls past it).
  let a = 0x2f6e21;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = pass === 0 ? "rgba(126,109,73,0.16)" : "rgba(255,255,255,0.12)";
    for (let i = 0; i < 340; i++) {
      const r = pass === 0 ? 1.6 + rand() * 2.4 : 1 + rand() * 1.4;
      ctx.beginPath();
      ctx.arc(rand() * 256, rand() * 256, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Gravel seams where the path meets the lawn — one texture, three repeats
  // across, so the seam lines land between the lanes.
  ctx.fillStyle = "rgba(126,109,73,0.34)";
  ctx.fillRect(0, 0, 6, 256);
  ctx.fillRect(250, 0, 6, 256);
  return finish(key, canvas, { repeat: [3, 1] });
}

/** Mown lawn: broad two-tone stripes, no detail. A lawn with visible texture
 *  at this camera distance is a lawn you cannot see an obstacle against. */
export function lawnTexture(): THREE.CanvasTexture | null {
  const key = "lawn";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(256, 256);
  if (!made) return null;
  const { canvas, ctx } = made;
  ctx.fillStyle = PALETTE.sage500;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = PALETTE.sage600;
  ctx.fillRect(0, 0, 128, 256);
  ctx.fillStyle = PALETTE.sage400;
  for (let i = 0; i < 240; i++) {
    const a = (i * 97) % 256;
    const b = (i * 53) % 256;
    ctx.fillRect(a, b, 2, 6);
  }
  return finish(key, canvas, { repeat: [4, 1] });
}

/* ── Sprites ───────────────────────────────────────────────────────────── */

/** A soft round sparkle, used additively by every particle system. */
export function sparkTexture(): THREE.CanvasTexture | null {
  const key = "spark";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(64, 64);
  if (!made) return null;
  const { canvas, ctx } = made;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.65)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return finish(key, canvas);
}

/** A tiny receipt scrap, for the paper that flies when a hit lands. */
export function scrapTexture(): THREE.CanvasTexture | null {
  const key = "scrap";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(32, 32);
  if (!made) return null;
  const { canvas, ctx } = made;
  ctx.fillStyle = PALETTE.paper;
  ctx.fillRect(6, 2, 20, 28);
  ctx.fillStyle = "rgba(43,38,32,0.55)";
  for (let i = 0; i < 5; i++) ctx.fillRect(9, 7 + i * 5, 14, 1.6);
  return finish(key, canvas);
}

/** The soft round blob under the runner and the props — a cheap contact
 *  shadow that reads better at this sun angle than a real shadow map on a
 *  phone. */
export function blobTexture(): THREE.CanvasTexture | null {
  const key = "blob";
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(128, 128);
  if (!made) return null;
  const { canvas, ctx } = made;
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, "rgba(37,28,20,0.42)");
  grad.addColorStop(0.6, "rgba(37,28,20,0.18)");
  grad.addColorStop(1, "rgba(37,28,20,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return finish(key, canvas);
}

/** A soft vertical gradient used as a cheap stand-in for atmospheric depth on
 *  the manor silhouette. */
export function gradientStrip(top: string, bottom: string) {
  const key = `grad:${top}:${bottom}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const made = makeCanvas(4, 128);
  if (!made) return null;
  const { canvas, ctx } = made;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 128);
  return finish(key, canvas);
}

/** Wrap `text` to `width` and draw centred lines starting at `y`. Used for the
 *  one prop with a long headline. */
function wrapText(ctx: Ctx, text: string, x: number, y: number, width: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > width && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

/**
 * A money label for the pickup burst — the amount, drawn on a transparent ground.
 *
 * Sized to the TEXT rather than to a fixed canvas, because the strings come in two
 * shapes (`10 000` and `500 000`, and `1 500 000` once a multiplier is running) and
 * a fixed canvas either clips the long ones or wastes half its width on the short
 * ones. Measuring first costs one layout pass per DISTINCT string, and the cache
 * below means it happens once per string for the life of the process.
 *
 * `big` is the bag variant: heavier and gold rather than cream, so the one pickup
 * worth a fifth of the run's income reads differently at a glance from the ones
 * that are not.
 */
export function moneyLabelTexture(text: string, big: boolean): THREE.CanvasTexture | null {
  const key = `money:${big ? "b" : "s"}:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const fontSize = big ? 96 : 76;
  const probe = typeof document === "undefined" ? null : document.createElement("canvas");
  if (!probe) return null;
  const probeCtx = probe.getContext("2d");
  if (!probeCtx) return null;
  probeCtx.font = `800 ${fontSize}px "Georgia", "Times New Roman", serif`;
  const textWidth = Math.ceil(probeCtx.measureText(big ? "+" + text : text).width);

  const padX = Math.round(fontSize * 0.34);
  const padY = Math.round(fontSize * 0.3);
  const width = textWidth + padX * 2;
  const height = Math.round(fontSize * 1.5);

  const made = makeCanvas(width, height);
  if (!made) return null;
  const { canvas, ctx } = made;

  // A dark plate behind the digits. The label flies over a bright lawn AND over a
  // pale path, and cream-on-cream over the path is exactly the case that would
  // otherwise be unreadable in the second half of a run.
  const radius = height * 0.34;
  ctx.fillStyle = big ? "rgba(0, 0, 0, 0)" : "rgba(24, 30, 44, 0.78)";
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.arcTo(width, 0, width, height, radius);
  ctx.arcTo(width, height, 0, height, radius);
  ctx.arcTo(0, height, 0, 0, radius);
  ctx.arcTo(0, 0, width, 0, radius);
  ctx.closePath();
  ctx.fill();

  ctx.font = `800 ${fontSize}px "Georgia", "Times New Roman", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (big) {
    // No plate on the big label: an outline carries the contrast on its own and
    // the scene stays visible through the gaps between the digits.
    ctx.lineJoin = "round";
    ctx.lineWidth = fontSize * 0.16;
    ctx.strokeStyle = "rgba(58, 36, 12, 0.9)";
    ctx.strokeText("+" + text, width / 2, height / 2 + fontSize * 0.03);
    ctx.fillStyle = PALETTE.gold;
    ctx.fillText("+" + text, width / 2, height / 2 + fontSize * 0.03);
  } else {
    ctx.fillStyle = PALETTE.paper50;
    ctx.fillText(text, width / 2, height / 2 + fontSize * 0.03);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  cache.set(key, texture);
  return texture;
}
