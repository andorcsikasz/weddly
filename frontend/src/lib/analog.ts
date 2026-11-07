// The one film look every guest shot gets. Couples don't pick a filter: the
// camera simply shoots "film", the way a disposable on the table would.
//
// It is baked into the saved JPEG (not a CSS tint on top), so the photo looks
// the same in the reveal, in the couple's download and in a guest's camera
// roll. The live viewfinder can't run per-pixel work at 30fps, so it shows a
// close CSS stand-in (ANALOG_PREVIEW_FILTER + the overlays in index.css).
//
// The recipe, roughly a warm consumer colour negative:
//   - soft S-curve with lifted blacks and rolled-off whites (no pure 0 or 255)
//   - warm highlights, slightly cool shadows, a touch less saturation
//   - a gentle vignette
//   - monochrome grain, strongest in the midtones
//   - an amber date stamp in the corner, exposed "into" the frame so it gets
//     the same grain and tone as the picture

/** CSS approximation of the baked look, for the live viewfinder. */
export const ANALOG_PREVIEW_FILTER = "sepia(0.14) saturate(0.88) contrast(0.93) brightness(1.04)";

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Per-channel tone curves, 256 entries each. */
export function analogCurves(): {
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
} {
  const r = new Uint8ClampedArray(256);
  const g = new Uint8ClampedArray(256);
  const b = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const s = x * x * (3 - 2 * x);
    // Lifted blacks (~13) and soft whites (~245).
    const base = 0.05 + (x * 0.6 + s * 0.4) * 0.91;
    r[i] = clamp255((base + 0.025 * x) * 255);
    g[i] = clamp255(base * 255);
    b[i] = clamp255((base * 0.94 + 0.04 * (1 - x)) * 255);
  }
  return { r, g, b };
}

/** Small fast seeded PRNG, so a test can pin the grain. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Apply the film look to RGBA pixels in place. */
export function analogize(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  seed = (Math.random() * 2 ** 32) >>> 0,
): void {
  const { r: cr, g: cg, b: cb } = analogCurves();
  const rand = mulberry32(seed);
  const cx = width / 2;
  const cy = height / 2;
  const SAT = 0.88;
  const GRAIN = 7;
  for (let y = 0; y < height; y++) {
    const dy = (y - cy) / cy;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = cr[data[i] as number] as number;
      let g = cg[data[i + 1] as number] as number;
      let b = cb[data[i + 2] as number] as number;
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * SAT;
      g = l + (g - l) * SAT;
      b = l + (b - l) * SAT;
      // Vignette: untouched in the middle, about a third darker in the corners.
      const dx = (x - cx) / cx;
      const d = (dx * dx + dy * dy) / 2;
      const t = d > 0.25 ? (d - 0.25) / 0.75 : 0;
      const v = 1 - 0.3 * t * t;
      // Grain: one value for all three channels, as film grain is.
      const mid = 1 - Math.abs((2 * l) / 255 - 1);
      const n = (rand() + rand() - 1) * GRAIN * (0.55 + 0.45 * mid);
      data[i] = clamp255(r * v + n);
      data[i + 1] = clamp255(g * v + n);
      data[i + 2] = clamp255(b * v + n);
    }
  }
}

/** "'26 11 06", the way a film camera's date back prints it. */
export function dateStamp(d: Date): string {
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `'${yy} ${mm} ${dd}`;
}

/** Stamp the date, then develop the whole frame. */
export function developOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  takenAt: Date = new Date(),
): void {
  try {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const size = Math.max(12, Math.round(Math.min(width, height) * 0.038));
    ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255, 150, 60, 0.92)";
    ctx.shadowColor = "rgba(255, 110, 20, 0.85)";
    ctx.shadowBlur = size * 0.45;
    const margin = Math.round(size * 1.3);
    ctx.fillText(dateStamp(takenAt), width - margin, height - margin);
    ctx.restore();
    const img = ctx.getImageData(0, 0, width, height);
    analogize(img.data, width, height);
    ctx.putImageData(img, 0, 0);
  } catch {
    // A tainted or lost canvas keeps the plain shot rather than losing it.
  }
}
