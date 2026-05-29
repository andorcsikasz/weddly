// Build-time asset precompression.
//
// Runs after `vite build` + `prerender.ts`. Walks frontend/dist and writes a
// brotli (`.br`) and gzip (`.gz`) sibling next to every text asset over 1KB.
// The Bun server (backend/src/server.ts, tryServeStatic) serves the sibling
// when the client's Accept-Encoding allows it, so the ~0.96MB JS bundle is
// compressed ONCE here at max quality rather than per-request.
//
// Why both: brotli for modern browsers (~15-20% smaller), gzip as the
// universal fallback for clients that only advertise gzip.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const DIST = join(import.meta.dir, "..", "dist");

// Text-ish extensions worth compressing. Images/PDFs are already compressed.
const COMPRESSIBLE_EXT = new Set([
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".svg",
  ".json",
  ".xml",
  ".txt",
  ".webmanifest",
]);
// Source maps (.map) are deliberately excluded: they're large and only
// fetched by devtools/Sentry, so precompressed siblings would just bloat the
// Docker image. The server falls back to on-the-fly compression if requested.

const MIN_BYTES = 1024;

let fileCount = 0;
let rawTotal = 0;
let brTotal = 0;

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
      continue;
    }
    // Skip siblings we may have written on a previous run.
    if (p.endsWith(".br") || p.endsWith(".gz")) continue;
    if (!COMPRESSIBLE_EXT.has(extname(p))) continue;
    if (st.size < MIN_BYTES) continue;

    const buf = readFileSync(p);
    const br = brotliCompressSync(buf, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength,
      },
    });
    const gz = gzipSync(buf, { level: 9 });
    writeFileSync(`${p}.br`, br);
    writeFileSync(`${p}.gz`, gz);

    fileCount += 1;
    rawTotal += buf.byteLength;
    brTotal += br.byteLength;
  }
}

walk(DIST);

const pct = rawTotal > 0 ? Math.round((1 - brTotal / rawTotal) * 100) : 0;
console.log(
  `precompress: ${fileCount} files, ${(rawTotal / 1024).toFixed(0)}KB -> ${(brTotal / 1024).toFixed(0)}KB brotli (${pct}% smaller)`,
);
