// Rendered counterpart to seed_listing_photos.ts, for venue sites whose images
// only exist after JavaScript runs (sliders, lazy-loaded galleries). The plain
// HTML read in seed_listing_photos.ts sees nothing on those, so the venue ends
// up with no photo at all.
//
// Loads each site in headless Chromium, collects the image URLs the rendered
// page actually shows (src, lazy-load attributes, srcset, og:image), follows at
// most two same-site gallery-looking links, then downloads every candidate and
// keeps only the ones that clear the same hero gate the seed script uses.
//
//   bun backend/scripts/render_listing_photos.ts <in.json> <out.json>
//
// Input: [{ id, name, website }]. Output: [{ id, gallery_urls }] for every
// venue, empty when nothing cleared the gate. Run it paced: one venue at a
// time per host, with a pause between images.

import { chromium, type Page } from "playwright";
import { fetchRemoteImage } from "../src/lib/remote_image";
import { isAcceptableHero } from "../src/domain/listing_image_backfill";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: render_listing_photos.ts <in.json> <out.json>");

/** Photos per venue, matching the 2-4 target. */
const KEEP = 4;
/** Candidates to download before giving up on one venue. */
const TRY = 16;
const PAUSE_MS = Number(process.env.RP_PAUSE_MS ?? 400);
const IGNORED =
  /(?:logo|favicon|icon|sprite|placeholder|avatar|payment|facebook|instagram|youtube|cookie|tracking|pixel|loader|blank|transparent|captcha|gravatar|spacer|pixel|flag|badge|award|kiemel|map)/i;
const GALLERY_LINK = /(galéria|galeria|gallery|fotó|fotok|képek|kepek|photos|images|bilder|slide)/i;

interface Venue {
  id: string;
  name: string;
  website: string;
}

const venues: Venue[] = JSON.parse(await Bun.file(inPath).text());

/** Image URLs a rendered page shows, absolute, de-duplicated by file name. */
async function imagesOn(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const push = (u: string | null | undefined) => {
      if (!u) return;
      try {
        out.push(new URL(u, location.href).toString());
      } catch {
        /* not a URL */
      }
    };
    const og = document.querySelector('meta[property="og:image"]')?.getAttribute("content");
    push(og);
    for (const img of Array.from(document.images)) {
      push(img.currentSrc || img.src);
      for (const attr of ["data-src", "data-lazy-src", "data-original"])
        push(img.getAttribute(attr));
      const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset");
      if (srcset) push(srcset.split(",")[0]?.trim().split(" ")[0]);
    }
    return out;
  });
}

/** Same-site links whose text or href says "gallery" in one of our languages. */
async function galleryLinks(page: Page, origin: string): Promise<string[]> {
  return page.evaluate((origin) => {
    const hits: string[] = [];
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = (a as HTMLAnchorElement).href;
      if (!href.startsWith(origin)) continue;
      hits.push(`${href}|${a.textContent ?? ""}`);
    }
    return hits;
  }, origin);
}

async function collect(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  v: Venue,
): Promise<string[]> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0 Safari/537.36",
    locale: "hu-HU",
  });
  const page = await context.newPage();
  const found: string[] = [];
  try {
    await page.goto(v.website, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
    // Scroll so lazy-loaded images request their real sources.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(800);
    found.push(...(await imagesOn(page)));

    const origin = new URL(v.website).origin;
    const links = (await galleryLinks(page, origin))
      .map((s) => {
        const i = s.lastIndexOf("|");
        return { href: s.slice(0, i), text: s.slice(i + 1) };
      })
      .filter((l) => GALLERY_LINK.test(l.href) || GALLERY_LINK.test(l.text))
      .map((l) => l.href)
      .filter((h, i, a) => a.indexOf(h) === i)
      .slice(0, 2);
    for (const href of links) {
      await page.goto(href, { waitUntil: "networkidle", timeout: 30000 }).catch(() => null);
      await page.waitForTimeout(600);
      found.push(...(await imagesOn(page)));
    }
  } finally {
    await context.close();
  }

  // Dedupe by file name (one photo often comes in several resize paths).
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const u of found) {
    if (IGNORED.test(u) || /\.svg(\?|$)/i.test(u)) continue;
    const key = u.split("?")[0]?.split("/").pop()?.toLowerCase() ?? u;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(u);
  }

  const kept: string[] = [];
  let tried = 0;
  let fetched = 0;
  for (const url of ordered.slice(0, TRY)) {
    tried++;
    await Bun.sleep(PAUSE_MS);
    const img = await fetchRemoteImage(url);
    if (!img) continue;
    fetched++;
    if (!isAcceptableHero(img.width, img.height)) continue;
    if (
      Math.min(img.width ?? 0, img.height ?? 0) < 400 ||
      Math.max(img.width ?? 0, img.height ?? 0) < 600
    )
      continue;
    kept.push(url);
    if (kept.length >= KEEP) break;
  }
  if (process.env.RP_DEBUG) {
    console.log(
      `  ${v.id}: found ${found.length}, unique ${ordered.length}, tried ${tried}, fetched ${fetched}, kept ${kept.length}`,
    );
  }
  return kept;
}

// RP_CHROME points at an already-installed headless shell when the bundled
// Playwright build is not the one in the local browser cache.
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.RP_CHROME || undefined,
});
const out: { id: string; gallery_urls: string[] }[] = [];
let withPhotos = 0;
try {
  for (const v of venues) {
    const gallery_urls = await collect(browser, v).catch(() => [] as string[]);
    if (gallery_urls.length > 0) withPhotos++;
    out.push({ id: v.id, gallery_urls });
    console.log(`${out.length}/${venues.length} ${v.id}: ${gallery_urls.length}`);
  }
} finally {
  await browser.close();
}
await Bun.write(outPath, JSON.stringify(out, null, 1));
console.log(`done: ${withPhotos}/${venues.length} venues with at least one verified photo`);
