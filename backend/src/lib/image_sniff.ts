// Magic-byte sniffing for the image-upload endpoints. The multipart part
// Content-Type is attacker-controlled, so before writing bytes to /uploads we
// confirm the actual leading bytes are a real image and derive the stored
// extension from THAT rather than from the claimed type. The static handler
// already serves /uploads/* with `X-Content-Type-Options: nosniff` and an
// extension-inferred type, so this is defense-in-depth against untrusted-byte
// storage (and against any future image reprocessing pipeline).

export type SniffedImageMime = "image/jpeg" | "image/png" | "image/webp";

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
