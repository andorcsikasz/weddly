#!/usr/bin/env bun
/**
 * Render the remaining public/og*.svg cards to their matching public/og*.png
 * at the canonical Open Graph size (1200×630). Run before deploys so social
 * scrapers (Twitter, Facebook, Slack) can show the share cards — many
 * of them don't render SVG og:image reliably.
 *
 * Also renders public/logo.svg → public/logo.png at 512×512 for the
 * Organization JSON-LD logo (referenced by backend/src/lib/seo_ssr.ts).
 * Google's structured-data tooling resolves the logo URL, so a PNG is
 * safer than SVG even though we'd prefer SVG.
 *
 * public/og.png is NOT in this list — it's the square dove logo mark now
 * (a supplied raster asset, brand-colour-remapped, no SVG source), so
 * running this script never overwrites it. Edit it directly if it needs
 * to change.
 *
 * public/apple-touch-icon.png, public/icon-512.png and public/logo-192.png
 * are also NOT in this list, and never should be: they're icon-only crops
 * of og.png (resized via `sips`), used where the icon renders small — the
 * apple-touch-icon link and the PWA manifest icons — because the full
 * wordmark lockup in logo.png/logo.svg is illegible at those sizes (same
 * reasoning as the dedicated /email/logo.png asset in
 * backend/src/domain/emails/template.ts). Re-crop from og.png by hand if
 * the mark changes; don't point them at logo.svg.
 *
 * Usage: `bun run og` from the frontend workspace.
 *
 * The SVGs are the source of truth for the variants below — edit them,
 * then re-run this script. Add a new variant by dropping `og-<name>.svg`
 * into public/.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const variants = [
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
    //
    // Self-host General Sans (the landing `font-grotesk` voice) so the
    // tagline renders in the real brand sans rather than a fallback.
    // System fonts won't have it, so point resvg at the woff2 files.
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Georgia",
      fontFiles: [
        resolve(root, "public/fonts/general-sans-400.woff2"),
        resolve(root, "public/fonts/general-sans-500.woff2"),
        resolve(root, "public/fonts/general-sans-600.woff2"),
      ],
    },
  });
  const png = resvg.render().asPng();
  writeFileSync(pngPath, png);
  console.log(`✓ wrote ${pngPath} (${png.byteLength} bytes)`);
}
