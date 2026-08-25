// Apply the production hero-image size/aspect gate to a researched vendor
// report without re-crawling the websites. This is useful after a gallery
// discovery pass: only records whose selected hero can actually render well
// are marked importable.

import { fetchRemoteImage } from "../src/lib/remote_image";
import { isAcceptableHero } from "../src/domain/listing_image_backfill";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("usage: verify_vendor_photo_report.ts INPUT.json OUTPUT.json");
}

interface Row {
  gallery_urls?: string[];
  photo_quality_verified?: boolean;
  photo_width?: number | null;
  photo_height?: number | null;
}

const rows: Row[] = JSON.parse(await Bun.file(inputPath).text());
let cursor = 0;
let verified = 0;

async function worker(): Promise<void> {
  while (cursor < rows.length) {
    const row = rows[cursor++];
    if (!row) continue;
    const url = row.gallery_urls?.[0];
    const image = url ? await fetchRemoteImage(url) : null;
    row.photo_width = image?.width ?? null;
    row.photo_height = image?.height ?? null;
    row.photo_quality_verified = Boolean(
      image?.width &&
        image.height &&
        isAcceptableHero(image.width, image.height) &&
        Math.min(image.width, image.height) >= 400 &&
        Math.max(image.width, image.height) >= 600,
    );
    if (row.photo_quality_verified) verified++;
  }
}

await Promise.all(Array.from({ length: 8 }, () => worker()));
await Bun.write(outputPath, `${JSON.stringify(rows, null, 2)}\n`);
console.log(JSON.stringify({ total: rows.length, verified, output: outputPath }));
