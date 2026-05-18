#!/usr/bin/env bun
/**
 * Render every public/og*.svg to its matching public/og*.png at the
 * canonical Open Graph size (1200×630). Run before deploys so social
 * scrapers (Twitter, Facebook, Slack) can show the share cards — many
 * of them don't render SVG og:image reliably.
 *
 * Also renders public/logo.svg → public/logo.png at 512×512 for the
 * Organization JSON-LD logo (referenced by backend/src/lib/seo_ssr.ts).
 * Google's structured-data tooling resolves the logo URL, so a PNG is
 * safer than SVG even though we'd prefer SVG.
 *
 * Usage: `bun run og` from the frontend workspace.
 *
 * The SVGs are the source of truth — edit them, then re-run this script.
 * Add a new variant by dropping `og-<name>.svg` into public/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const variants = [
  { svg: "public/og.svg", png: "public/og.png", width: 1200 },
  { svg: "public/og-rsvp.svg", png: "public/og-rsvp.png", width: 1200 },
  { svg: "public/logo.svg", png: "public/logo.png", width: 512 },
];

for (const v of variants) {
  const svgPath = resolve(root, v.svg);
  const pngPath = resolve(root, v.png);
  const svg = readFileSync(svgPath);
  // fitTo:width keeps the SVG viewBox proportional and pins the output
  // at exactly the target pixel width (og cards = 1200, square logo = 512).
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: v.width },
    // Use system serif as the Cormorant fallback; SVG references
    // 'Cormorant Garamond, Georgia, serif'. resvg-js falls through to
    // bundled noto fonts otherwise — Georgia approximates Cormorant
    // well enough for a one-shot social card.
    font: { loadSystemFonts: true, defaultFontFamily: "Georgia" },
  });
  const png = resvg.render().asPng();
  writeFileSync(pngPath, png);
  console.log(`✓ wrote ${pngPath} (${png.byteLength} bytes)`);
}
