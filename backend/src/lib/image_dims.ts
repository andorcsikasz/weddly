// Pixel-dimension reader for the three formats we store (jpg/png/webp). Reads
// only the header, no decode — enough to apply a quality gate when auto-pulling
// a venue's og:image as a hero (a tiny logo or a skinny banner shouldn't win the
// card). Returns null when the bytes aren't a recognised header or are too short
// to parse; callers treat "unknown" as "don't block" so a good image is never
// dropped just because we couldn't measure it.

export interface ImageDimensions {
  width: number;
  height: number;
}

function u16be(b: Uint8Array, off: number): number | null {
  const hi = b[off];
  const lo = b[off + 1];
  if (hi === undefined || lo === undefined) return null;
  return (hi << 8) | lo;
}

function u32be(b: Uint8Array, off: number): number | null {
  const a = b[off];
  const c = b[off + 1];
  const d = b[off + 2];
  const e = b[off + 3];
  if (a === undefined || c === undefined || d === undefined || e === undefined) return null;
  return ((a << 24) | (c << 16) | (d << 8) | e) >>> 0;
}

/** PNG: 8-byte signature, then an IHDR chunk whose width/height are big-endian
 *  uint32 at byte offsets 16 and 20. */
function pngDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 24) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (!width || !height) return null;
  return { width, height };
}

// JPEG Start-Of-Frame markers carry the frame dimensions. Markers without a
// payload (RSTn, SOI, EOI, TEM) are skipped without a length read.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
function isStandaloneMarker(m: number): boolean {
  return m === 0x01 || (m >= 0xd0 && m <= 0xd9);
}

/** JPEG: walk the segment markers from after the SOI until a Start-Of-Frame,
 *  whose payload is precision(1) height(2 BE) width(2 BE). */
function jpegDimensions(b: Uint8Array): ImageDimensions | null {
  let i = 2; // skip SOI (FF D8)
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      i++; // resync past fill bytes / corruption
      continue;
    }
    const marker = b[i + 1];
    if (marker === undefined) return null;
    if (isStandaloneMarker(marker)) {
      i += 2;
      continue;
    }
    const segLen = u16be(b, i + 2);
    if (segLen === null || segLen < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      if (!width || !height) return null;
      return { width, height };
    }
    i += 2 + segLen;
  }
  return null;
}

/** WebP: "RIFF"…"WEBP" then a format chunk — VP8 (lossy), VP8L (lossless), or
 *  VP8X (extended). Best-effort; returns null on the rarer shapes so the caller
 *  doesn't block a webp it merely couldn't measure. */
function webpDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0);
  if (fourcc === "VP8 ") {
    // Lossy: VP8 bitstream at off 20 — frame tag (3) + start code 9D 01 2A (3),
    // then 16-bit LE width at 26 and height at 28, each holding the value in its
    // low 14 bits (stored as the actual dimension, no -1 offset).
    const width = (((b[27] ?? 0) << 8) | (b[26] ?? 0)) & 0x3fff;
    const height = (((b[29] ?? 0) << 8) | (b[28] ?? 0)) & 0x3fff;
    if (!width || !height) return null;
    return { width, height };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit (canvas width-1) and (height-1), little-endian, at off 24.
    const w = ((b[26] ?? 0) << 16) | ((b[25] ?? 0) << 8) | (b[24] ?? 0);
    const h = ((b[29] ?? 0) << 16) | ((b[28] ?? 0) << 8) | (b[27] ?? 0);
    return { width: w + 1, height: h + 1 };
  }
  if (fourcc === "VP8L") {
    // Lossless: 0x2F signature at 20, then 14-bit (width-1),(height-1) packed LE.
    if (b[20] !== 0x2f) return null;
    const bits = ((b[24] ?? 0) << 24) | ((b[23] ?? 0) << 16) | ((b[22] ?? 0) << 8) | (b[21] ?? 0);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  return null;
}

/** Read the pixel dimensions of a jpg/png/webp from its header bytes, or null
 *  if unrecognised / too short. Pure, no decode. */
export function imageDimensions(b: Uint8Array): ImageDimensions | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return pngDimensions(b);
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return jpegDimensions(b);
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return webpDimensions(b);
  }
  return null;
}
