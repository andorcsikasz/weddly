// Magic-byte sniffing for the image-upload endpoints. The multipart part
// Content-Type is attacker-controlled, so before writing bytes to /uploads we
// confirm the actual leading bytes are a real image and derive the stored
// extension from THAT rather than from the claimed type. The static handler
// already serves /uploads/* with `X-Content-Type-Options: nosniff` and an
// extension-inferred type, so this is defense-in-depth against untrusted-byte
// storage (and against any future image reprocessing pipeline).

export type SniffedImageMime = "image/jpeg" | "image/png" | "image/webp";

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);

/** HEIC/HEIF uses the ISO Base Media File Format. We identify its `ftyp`
 *  brands separately from supported image formats so callers can explain the
 *  incompatibility instead of reporting a vague "bad file" error. Generic
 *  `mif1` is intentionally excluded because AVIF may use it too. */
export function isHeifImage(bytes: Uint8Array): boolean {
  if (
    bytes.length < 12 ||
    bytes[4] !== 0x66 ||
    bytes[5] !== 0x74 ||
    bytes[6] !== 0x79 ||
    bytes[7] !== 0x70
  ) {
    return false;
  }
  for (let offset = 8; offset + 3 < bytes.length; offset += 4) {
    const brand = String.fromCharCode(
      bytes[offset] ?? 0,
      bytes[offset + 1] ?? 0,
      bytes[offset + 2] ?? 0,
      bytes[offset + 3] ?? 0,
    );
    if (HEIF_BRANDS.has(brand)) return true;
  }
  return false;
}

/** Identify a supported image by its magic bytes, or null if it isn't one. */
export function sniffImageMime(bytes: Uint8Array): SniffedImageMime | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Read the leading bytes of an uploaded File and return its sniffed mime.
 *  The File is already fully buffered by `formData()` (and bounded by the
 *  server's maxRequestBodySize), so reading it back here is cheap. */
export async function sniffUploadedImage(file: File): Promise<SniffedImageMime | null> {
  const head = new Uint8Array(await file.arrayBuffer()).subarray(0, 12);
  return sniffImageMime(head);
}

/** Detect an unsupported HEIC/HEIF upload by content, never by the untrusted
 *  multipart MIME or filename alone. */
export async function isUploadedHeif(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.arrayBuffer()).subarray(0, 32);
  return isHeifImage(head);
}
