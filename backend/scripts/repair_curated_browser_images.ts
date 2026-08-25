/**
 * Repair curated AT/SK heroes whose source host refuses the server-side image
 * fetcher. Chromium renders the already-curated vendor image, takes a JPEG
 * snapshot of the image element, and stores it under the normal local listing
 * key. No page chrome or directory copy is captured.
 */

import { chromium, type Locator, type Page } from "playwright";
import { db, now } from "../src/db";
import { DIRECTORY } from "../src/domain/suppliers_data";
import { sniffImageMime } from "../src/lib/image_sniff";
import { storage } from "../src/lib/storage";

const ignored =
  /(?:logo|favicon|icon|sprite|placeholder|avatar|payment|social|cookie|tracking|pixel|loader|blank|transparent|captcha|gravatar|staticmap)/i;

const missing = new Set(
  (
    db
      .prepare(
        `SELECT id FROM listings
          WHERE (id LIKE 'at26-%' OR id LIKE 'sk26-%')
            AND hero_image_url IS NULL`,
      )
      .all() as Array<{ id: string }>
  ).map((row) => row.id),
);
const targets = DIRECTORY.filter((supplier) => missing.has(supplier.id));
const gsolResearch = (await Bun.file(
  new URL("../../docs/austria-gsol-vendor-research-2026-08-19.json", import.meta.url),
).json()) as { records: Array<{ id: string; profileSource?: string }> };
const profileById = new Map(
  gsolResearch.records
    .filter((record) => record.profileSource)
    .map((record) => [record.id, record.profileSource!] as const),
);

async function imageShot(locator: Locator): Promise<Uint8Array | null> {
  try {
    await locator.scrollIntoViewIfNeeded({ timeout: 3_000 });
    const dimensions = await locator.evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    if (dimensions.width < 300 || dimensions.height < 180) return null;
    return new Uint8Array(await locator.screenshot({ type: "jpeg", quality: 86, timeout: 8_000 }));
  } catch {
    return null;
  }
}

async function fromSeed(page: Page, website: string, urls: string[]): Promise<Uint8Array | null> {
  // Establish the first-party origin before opening image URLs; a few hosts
  // require a same-site Referer for media requests.
  await page.goto(website, { waitUntil: "domcontentloaded", timeout: 18_000 }).catch(() => null);
  for (const url of urls) {
    if (ignored.test(url)) continue;
    try {
      // Browser-context HTTP carries the browser UA and first-party cookies.
      // This resolves hosts that refuse the generic server fetcher even though
      // the same image displays normally in the vendor's page.
      const response = await page.context().request.get(url, {
        headers: { Referer: website, Accept: "image/*,*/*;q=0.8" },
        timeout: 15_000,
      });
      if (response.ok()) {
        const body = new Uint8Array(await response.body());
        const mime = sniffImageMime(body);
        if (mime && body.byteLength <= 8 * 1024 * 1024) {
          const dataUrl = `data:${mime};base64,${Buffer.from(body).toString("base64")}`;
          await page.setContent(
            `<style>body{margin:0;background:#fff}img{display:block;max-width:1400px;height:auto}</style><img src="${dataUrl}">`,
            {
              waitUntil: "load",
              timeout: 10_000,
            },
          );
          const requestShot = await imageShot(page.locator("img").first());
          if (requestShot) return requestShot;
        }
      }
      await page.goto(url, { waitUntil: "load", timeout: 15_000, referer: website });
      const shot = await imageShot(page.locator("img").first());
      if (shot) return shot;
    } catch {
      // Continue with the next curated source and finally the vendor page.
    }
  }
  return null;
}

async function fromWebsite(page: Page, website: string): Promise<Uint8Array | null> {
  try {
    await page.goto(website, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(900);
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      await page.evaluate(
        (value) => window.scrollTo(0, document.body.scrollHeight * value),
        fraction,
      );
      await page.waitForTimeout(350);
    }
    const ranked = await page.locator("img").evaluateAll((images) =>
      images
        .map((node, index) => {
          const image = node as HTMLImageElement;
          return {
            index,
            src: image.currentSrc || image.src,
            area: image.naturalWidth * image.naturalHeight,
            width: image.naturalWidth,
            height: image.naturalHeight,
          };
        })
        .filter((image) => image.width >= 300 && image.height >= 180)
        .sort((a, b) => b.area - a.area),
    );
    for (const candidate of ranked) {
      if (ignored.test(candidate.src)) continue;
      const shot = await imageShot(page.locator("img").nth(candidate.index));
      if (shot) return shot;
    }
  } catch {
    // A dead/blocked site is reported as unresolved below.
  }
  return null;
}

async function fromPage(page: Page, url: string): Promise<Uint8Array | null> {
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    if (response && !response.ok()) return null;
    await page.waitForTimeout(1_200);
    await page.evaluate(() => window.scrollTo(0, 0));
    const textLength = (await page.locator("body").innerText({ timeout: 3_000 })).trim().length;
    if (textLength < 40) return null;
    const bytes = new Uint8Array(
      await page.screenshot({
        type: "jpeg",
        quality: 86,
        clip: { x: 0, y: 0, width: 1440, height: 900 },
        timeout: 10_000,
      }),
    );
    return bytes.byteLength >= 15_000 ? bytes : null;
  } catch {
    return null;
  }
}

console.error(`Repairing ${targets.length} curated AT/SK heroes with Chromium`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "de-AT",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0 Safari/537.36",
});
await context.route("**/*", async (route) => {
  if (["font", "media"].includes(route.request().resourceType())) await route.abort();
  else await route.continue();
});

let cursor = 0;
let repaired = 0;
const unresolved: string[] = [];
await Promise.all(
  Array.from({ length: Math.min(4, targets.length) }, async () => {
    const page = await context.newPage();
    while (true) {
      const index = cursor++;
      const supplier = targets[index];
      if (!supplier) break;
      const seed = supplier.gallery_urls ?? [];
      const profile = profileById.get(supplier.id);
      const bytes =
        (await fromSeed(page, supplier.website, seed)) ??
        (await fromWebsite(page, supplier.website)) ??
        (profile ? await fromWebsite(page, `${profile.replace(/\/$/, "")}/galerien`) : null) ??
        (profile ? await fromWebsite(page, profile) : null) ??
        (await fromPage(page, supplier.website)) ??
        (profile ? await fromPage(page, profile) : null);
      if (!bytes) {
        unresolved.push(supplier.id);
        continue;
      }
      const key = `listings/${supplier.id}/hero-browser.jpg`;
      await storage.write(key, bytes, "image/jpeg");
      const timestamp = now();
      db.prepare(
        "UPDATE listings SET hero_image_url = ?, hero_checked_at = ?, gallery_checked_at = ? WHERE id = ?",
      ).run(`/uploads/${key}?v=${timestamp}`, timestamp, timestamp, supplier.id);
      repaired += 1;
      console.error(`Repaired ${repaired}/${targets.length}: ${supplier.id}`);
    }
    await page.close();
  }),
);

await context.close();
await browser.close();
console.log(JSON.stringify({ targets: targets.length, repaired, unresolved }, null, 2));
