// Sizing for a guest-camera shot before it leaves the phone. A wedding venue is
// the worst network a phone sees all year: a hall of guests on one mast, or a
// barn with no signal at all. Every byte here is a byte a guest waits on, and
// one the outbox has to hold on a phone that may be short of space.
//
// 1600px on the long edge is past what a reveal ever shows (a full-screen
// phone view, a laptop lightbox) and the 1 MB budget is comfortable for it, so
// the first rung of the quality ladder almost always lands. The lower rungs
// are for the shot that really is busy: confetti, foliage, a sequinned dress.

export const SHOT_MAX_LONG_EDGE = 1600;
export const SHOT_MAX_BYTES = 1_000_000;
/** Highest first: the first encode under budget wins, so a typical shot costs
 *  one pass. The floor stays well above where JPEG blocking shows on faces. */
export const SHOT_QUALITY_LADDER = [0.85, 0.75, 0.65, 0.55, 0.45] as const;

/** Scale (w, h) so the long edge is at most `max`, keeping the aspect ratio.
 *  Never upscales: a smaller source is returned as it is. */
export function fitLongEdge(
  width: number,
  height: number,
  max = SHOT_MAX_LONG_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Walk the quality ladder until an encode fits the budget. If none does, the
 *  smallest encode is returned anyway: a 1.1 MB photo sent is worth more than
 *  a shot refused, and the server's own ceiling is far higher. Resolves null
 *  only if the encoder produced nothing at all. */
export async function encodeUnderBudget(
  encode: (quality: number) => Promise<Blob | null>,
  budget = SHOT_MAX_BYTES,
  ladder: readonly number[] = SHOT_QUALITY_LADDER,
): Promise<Blob | null> {
  let smallest: Blob | null = null;
  for (const quality of ladder) {
    const blob = await encode(quality);
    if (!blob) continue;
    if (blob.size <= budget) return blob;
    if (!smallest || blob.size < smallest.size) smallest = blob;
  }
  return smallest;
}

/** `canvas.toBlob` as a promise, for `encodeUnderBudget`. */
export function canvasJpegEncoder(
  canvas: HTMLCanvasElement,
): (quality: number) => Promise<Blob | null> {
  return (quality) =>
    new Promise((resolve) => {
      try {
        canvas.toBlob(resolve, "image/jpeg", quality);
      } catch {
        resolve(null);
      }
    });
}

/** Draw a source at its fitted size and encode it under budget. The ONE
 *  pipeline for a shot: the live camera's frame and a photo picked from the
 *  gallery both come through here, so they leave the phone the same shape.
 *  Each call draws on its own canvas (a burst would otherwise overwrite a shot
 *  still on the ladder). The draw is synchronous, before the first await, so a
 *  live frame is captured the instant this is called. */
export async function renderShot(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  opts: {
    mirror?: boolean;
    /** Digital zoom: the part of the source to keep, in source pixels. The
     *  output is fitted to the CROP, so a 2x crop of a 1920 frame is 960 wide
     *  (fitLongEdge never upscales: no invented pixels). */
    crop?: { sx: number; sy: number; sw: number; sh: number };
  } = {},
): Promise<Blob | null> {
  const crop = opts.crop ?? { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
  const { width, height } = fitLongEdge(Math.round(crop.sw), Math.round(crop.sh));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // A transparent PNG would encode its empty pixels as black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (opts.mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  return encodeUnderBudget(canvasJpegEncoder(canvas));
}

/** A photo picked from the gallery, through the same pipeline as a camera
 *  shot. A phone original is 3-8 MB, the exact upload a venue's signal
 *  cannot carry. Decoded through an <img>, which applies the photo's EXIF
 *  rotation when drawn (every browser since 2020), so a portrait shot stays
 *  portrait. Re-encoding also drops the EXIF block, GPS position included,
 *  which a guest sharing to a couple's film never meant to send.
 *
 *  An iPhone HEIC comes out as a JPEG wherever the browser can decode HEIC
 *  (Safari). Anything that will not decode is returned UNCHANGED, so the
 *  caller's existing checks (HEIC guidance, the server's type sniff) still
 *  answer it exactly as before. */
export async function compressPickedImage(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (!img.naturalWidth || !img.naturalHeight) return file;
    const blob = await renderShot(img, img.naturalWidth, img.naturalHeight);
    if (!blob) return file;
    const name = `${file.name.replace(/\.[^.]*$/, "") || "photo"}.jpg`;
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
