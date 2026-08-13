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

if (!largestJs || !largestCss) {
  fail("could not find built JS and CSS assets");
}

console.log(
  `bundle-budget: initial ${kib(initialBytes)} / ${kib(BUDGETS.initial)} (${initialAssets.length} assets)`,
);
console.log(
  `bundle-budget: largest JS ${kib(largestJs.bytes)} / ${kib(BUDGETS.singleJs)} (${largestJs.name})`,
);
console.log(
  `bundle-budget: largest CSS ${kib(largestCss.bytes)} / ${kib(BUDGETS.singleCss)} (${largestCss.name})`,
);

const failures: string[] = [];
if (initialBytes > BUDGETS.initial) {
  failures.push(`initial JS/CSS exceeds its budget by ${kib(initialBytes - BUDGETS.initial)}`);
}
if (largestJs.bytes > BUDGETS.singleJs) {
  failures.push(
    `${largestJs.name} exceeds the single-JS budget by ${kib(largestJs.bytes - BUDGETS.singleJs)}`,
  );
}
if (largestCss.bytes > BUDGETS.singleCss) {
  failures.push(
    `${largestCss.name} exceeds the single-CSS budget by ${kib(largestCss.bytes - BUDGETS.singleCss)}`,
  );
}

if (failures.length > 0) fail(failures.join("; "));
console.log("bundle-budget: passed");
