// Response compression for the Bun server.
//
// The May 2026 SEO audit flagged 0% compression: every `new Response(...)` in
// server.ts shipped raw bytes, so the ~0.96MB JS bundle and every SSR'd HTML
// page crossed the wire uncompressed. This module is the generic infra side:
// it negotiates Accept-Encoding and compresses dynamic text responses.
//
// Two layers cooperate:
//   1. Static hashed assets in frontend/dist are precompressed at build time
//      into `.br` / `.gz` siblings (frontend/scripts/precompress.ts) and
//      served directly with a Content-Encoding header — so we never re-brotli
//      a megabyte bundle on every request.
//   2. Dynamic responses (per-request SSR HTML, JSON API payloads, the
//      sitemap/robots/llms.txt) are compressed on the fly here.
//
// maybeCompress is a no-op for anything that already carries Content-Encoding
// (the precompressed siblings) or whose Content-Type isn't text-like.

import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// Text-ish content types worth compressing. Images (png/jpg/webp) and PDFs are
// already compressed, so they're deliberately excluded.
const COMPRESSIBLE =
  /^(?:text\/|application\/(?:json|javascript|xml|ld\+json|manifest\+json|rss\+xml)|image\/svg\+xml)/i;

// Below this, the gzip/brotli framing overhead outweighs the savings.
const MIN_COMPRESS_BYTES = 1024;

export type WireEncoding = "br" | "gzip";

/** Pick the best encoding the client accepts. Brotli first (~15-20% smaller
 *  than gzip on our JS/CSS/HTML); gzip as the universal fallback; null when
 *  the client advertises neither (or sent no Accept-Encoding at all). */
export function negotiateEncoding(acceptEncoding: string | null): WireEncoding | null {
  if (!acceptEncoding) return null;
  const a = acceptEncoding.toLowerCase();
  if (/\bbr\b/.test(a)) return "br";
  if (/\bgzip\b/.test(a)) return "gzip";
  return null;
}

/** Compress a buffer with the given wire encoding. Quality is tuned for the
 *  on-the-fly path (speed over ratio); the build-time precompressor uses
 *  max quality since it only runs once. */
export function compress(buf: Uint8Array, enc: WireEncoding): Uint8Array {
  if (enc === "br") {
    return brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 5,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength,
      },
    });
  }
  return gzipSync(buf, { level: 6 });
}

/** Returns true when this response is a candidate for on-the-fly compression. */
export function isCompressible(res: Response): boolean {
  if (res.headers.has("Content-Encoding")) return false;
  const ct = res.headers.get("Content-Type");
  return !!ct && COMPRESSIBLE.test(ct);
}

/** Compress a dynamic response when the client accepts it and the body is a
 *  compressible text type over the min threshold. No-op otherwise (returns the
 *  original response untouched, body unconsumed). */
export async function maybeCompress(req: Request, res: Response): Promise<Response> {
  if (!isCompressible(res)) return res;
  const enc = negotiateEncoding(req.headers.get("accept-encoding"));
  if (!enc) return res;

  // Buffering the body is safe for our dynamic text responses — they're built
  // in memory already (SSR string, JSON.stringify output, sitemap XML).
  const raw = new Uint8Array(await res.arrayBuffer());
  if (raw.byteLength < MIN_COMPRESS_BYTES) {
    // Body already consumed; rebuild it uncompressed.
    return new Response(raw, { status: res.status, headers: res.headers });
  }

  const out = compress(raw, enc);
  const headers = new Headers(res.headers);
  headers.set("Content-Encoding", enc);
  headers.delete("Content-Length");
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", "Accept-Encoding");
  else if (!/accept-encoding/i.test(vary)) headers.set("Vary", `${vary}, Accept-Encoding`);
  return new Response(out, { status: res.status, headers });
}
