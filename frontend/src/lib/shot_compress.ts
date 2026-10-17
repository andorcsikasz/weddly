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
