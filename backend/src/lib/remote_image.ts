// Safely download a remote image into bytes we can hand to lib/storage. The URL
// is derived from user/third-party input (an og:image resolved by
// lib/link_preview, a venue's website hero, …), so this carries the same SSRF
// posture as the link unfurler: refuse non-http(s) schemes, DNS-guard every
// host (re-validating each redirect hop via lib/ssrf), cap the body, time out
// fast, and confirm the real magic bytes are a supported image before we trust
// them. Soft by contract — any failure resolves to `null` so a dead image never
// throws into a background sweep.

import { assertSafeFetchUrl } from "./ssrf";
import { sniffImageMime } from "./image_sniff";
import { imageDimensions } from "./image_dims";

const FETCH_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 4;
// Venue marketing heroes run larger than the 1 MiB head-cap the HTML unfurler
// uses; 8 MiB comfortably covers a full-res JPEG while still bounding memory.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const EXT_BY_MIME: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface FetchedImage {
  bytes: Uint8Array;
  /** Storage extension derived from the sniffed magic bytes, not the URL. */
  ext: "jpg" | "png" | "webp";
  /** Pixel dimensions from the header, or null when unmeasurable — callers
   *  apply quality gates but treat null as "don't block". */
  width: number | null;
  height: number | null;
}

/** Read at most MAX_IMAGE_BYTES of the response body. Returns null if the stream
 *  exceeds the cap (an oversized asset we refuse to buffer) or is empty. */
async function readCappedBytes(res: Response): Promise<Uint8Array | null> {
  const body = res.body;
  if (!body) return null;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) return null; // oversized — refuse
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (total === 0) return null;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Download `rawUrl` and return its bytes + sniffed extension, or null on any
 *  failure (blocked host, timeout, non-OK, oversized, not a supported image).
 *  Follows redirects manually so each hop's host is re-validated against the
 *  SSRF guard. Never throws. */
export async function fetchRemoteImage(rawUrl: string): Promise<FetchedImage | null> {
  let current: string;
  try {
    current = (await assertSafeFetchUrl(rawUrl)).toString();
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": IMAGE_UA, Accept: "image/*,*/*;q=0.8" },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        current = (await assertSafeFetchUrl(new URL(location, current).toString())).toString();
        continue;
      }

      if (!res.ok) return null;
      const bytes = await readCappedBytes(res);
      if (!bytes) return null;
      const mime = sniffImageMime(bytes);
      const ext = mime ? EXT_BY_MIME[mime] : undefined;
      if (!ext) return null;
      const dims = imageDimensions(bytes);
      return { bytes, ext, width: dims?.width ?? null, height: dims?.height ?? null };
    }
    return null; // too many redirects
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
