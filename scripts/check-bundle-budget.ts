/**
 * Enforce transfer-size budgets for the production frontend.
 *
 * The server prefers pre-compressed `.br` siblings, so budgets use Brotli
 * bytes when available and the original asset size for very small files that
 * precompress.ts intentionally leaves uncompressed. The initial budget counts
 * every local JS/CSS asset referenced by dist/index.html, including
 * modulepreloads; those resources are fetched eagerly by supporting browsers.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const DIST = join(import.meta.dir, "..", "frontend", "dist");
const ASSETS = join(DIST, "assets");
const KIB = 1024;

/**
 * Lazy game engine, held to its own budget rather than exempted.
 *
 * `vendor-three` is Three.js + React Three Fiber, and it is ~150 KiB Brotli —
 * over the 140 KiB single-JS ceiling on its own, and it is a 3D engine, not
 * application code. There are two honest ways to handle that and only two:
 * raise the global ceiling, or bound the specific chunk.
 *
 * RAISING THE GLOBAL CEILING IS THE WRONG ONE. The ceiling exists to stop a
 * regression in the app shell; a budget every asset must clear is a budget that
 * stops catching anything once a 150 KiB chunk makes 150 KiB unremarkable. And
 * this chunk is NOT initial — `index.html` does not reference it, so it is not
 * fetched by anyone who does not open /app/games/runner. The cost is paid by the
 * couple who chose to play, once, and then cached.
 *
 * So the game engine gets its own number. It is still bounded, still printed,
 * still fails the build when it grows — it simply grows against a ceiling chosen
 * for a 3D library rather than for a React app. Exempting it outright, which is
 * the tempting shortcut, would mean no ceiling at all.
 */
const LAZY_ENGINE_BUDGETS: Readonly<Record<string, number>> = {
  "vendor-three": 200 * KIB,
};

// Keep modest headroom over the measured August 2026 production build:
// 478.4 KiB initial, 128.4 KiB largest JS, and 31.5 KiB largest CSS.
const BUDGETS = {
  initial: 525 * KIB,
  singleJs: 140 * KIB,
  singleCss: 36 * KIB,
} as const;

function transferBytes(path: string): number {
  const brotliPath = `${path}.br`;
  return statSync(existsSync(brotliPath) ? brotliPath : path).size;
}

function kib(bytes: number): string {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

function fail(message: string): never {
  console.error(`bundle-budget: ${message}`);
  process.exit(1);
}

const indexPath = join(DIST, "index.html");
if (!existsSync(indexPath) || !existsSync(ASSETS)) {
  fail("frontend/dist is missing; run the production frontend build first");
}

const html = readFileSync(indexPath, "utf8");
const initialReferences = new Set(
  [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]),
);

if (initialReferences.size === 0) {
  fail("dist/index.html contains no local initial JS or CSS assets");
}

const initialAssets = [...initialReferences].map((reference) => {
  const path = join(DIST, reference.slice(1));
  if (!existsSync(path)) fail(`referenced asset is missing: ${reference}`);
  return { name: basename(path), bytes: transferBytes(path) };
});
const initialBytes = initialAssets.reduce((sum, asset) => sum + asset.bytes, 0);

const compressedAssets = readdirSync(ASSETS)
  .filter((name) => name.endsWith(".js") || name.endsWith(".css"))
  .map((name) => ({
    name,
    bytes: transferBytes(join(ASSETS, name)),
  }));
const largestJs = compressedAssets
  .filter((asset) => asset.name.endsWith(".js"))
  .sort((a, b) => b.bytes - a.bytes)[0];
const largestCss = compressedAssets
  .filter((asset) => asset.name.endsWith(".css"))
  .sort((a, b) => b.bytes - a.bytes)[0];

/** Every built JS chunk, so a lazy game engine is held to ITS budget and the
 *  shell's largest is still measured against the shell's. The old check looked
 *  only at the single largest file in dist, which meant one 3D library could
 *  dictate the number the whole application is judged by. */
const jsChunks = compressedAssets
  .filter((asset) => asset.name.endsWith(".js"))
  .sort((a, b) => b.bytes - a.bytes);

if (!largestJs || !largestCss) {
  fail("could not find built JS and CSS assets");
}

const engineChunks = jsChunks.filter((asset) => asset.name.startsWith("vendor-three"));
const shellChunks = jsChunks.filter((asset) => !asset.name.startsWith("vendor-three"));
const largestShellJs = shellChunks[0];
if (!largestShellJs) {
  fail("no non-engine JS chunk was emitted; the vendor-three split looks wrong");
}
const largestEngineJs = engineChunks[0];

console.log(
  `bundle-budget: initial ${kib(initialBytes)} / ${kib(BUDGETS.initial)} (${initialAssets.length} assets)`,
);
console.log(
  `bundle-budget: largest shell JS ${kib(largestShellJs.bytes)} / ${kib(BUDGETS.singleJs)} (${largestShellJs.name})`,
);
console.log(
  `bundle-budget: largest CSS ${kib(largestCss.bytes)} / ${kib(BUDGETS.singleCss)} (${largestCss.name})`,
);
if (largestEngineJs) {
  console.log(
    `bundle-budget: lazy game engine ${kib(largestEngineJs.bytes)} / ${kib(LAZY_ENGINE_BUDGETS["vendor-three"] ?? 0)} (${largestEngineJs.name}, not initial)`,
  );
}

const failures: string[] = [];
if (initialBytes > BUDGETS.initial) {
  failures.push(`initial JS/CSS exceeds its budget by ${kib(initialBytes - BUDGETS.initial)}`);
}
if (largestShellJs.bytes > BUDGETS.singleJs) {
  failures.push(
    `${largestShellJs.name} exceeds the single-JS budget by ${kib(largestShellJs.bytes - BUDGETS.singleJs)}`,
  );
}
if (largestEngineJs) {
  const cap = LAZY_ENGINE_BUDGETS["vendor-three"] ?? 0;
  if (largestEngineJs.bytes > cap) {
    failures.push(
      `${largestEngineJs.name} exceeds the lazy-engine budget by ${kib(largestEngineJs.bytes - cap)}`,
    );
  }
}
if (largestCss.bytes > BUDGETS.singleCss) {
  failures.push(
    `${largestCss.name} exceeds the single-CSS budget by ${kib(largestCss.bytes - BUDGETS.singleCss)}`,
  );
}

if (failures.length > 0) fail(failures.join("; "));
console.log("bundle-budget: passed");
