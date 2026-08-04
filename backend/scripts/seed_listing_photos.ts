// Resolve a `gallery_urls` seed for a batch of curated listings before it is
// written into `suppliers_data*.ts`, from each business's OWN website.
//
// Reads a JSON array of `{ name, website }` objects, collects the site's
// og:image plus its body-image candidates, DOWNLOADS every candidate and keeps
// only the ones that clear the hero quality gate, then writes the same array
// back with a verified `gallery_urls` on each hit. The boot gallery/hero sweeps
// re-host those locally afterwards, because the CSP `img-src` allow-list
// renders nothing from a foreign host.
//
//   bun backend/scripts/seed_listing_photos.ts <in.json> <out.json>
//   PL_PHOTO_DELAY_MS=900 PL_PHOTO_CONCURRENCY=2 bun … <in.json> <out.json>
//
// Why bake the seed in rather than leave it to the boot sweep: the sweep gets
// ONE attempt per listing ever (it stamps `hero_checked_at` on a miss too), so
// a site that happens to be slow or throttling on the morning of a deploy
// leaves that card on a placeholder permanently. Doing it here means the misses
// are visible, retryable, and the sweep still covers whatever this could not
// resolve.
//
// Run it slowly. Every candidate for one business sits on that business's own
// host, so an unpaced run is a dozen rapid hits on one small server, and these
// sites start refusing partway through, which shows up not as an error but as
// a run that quietly returns fewer photos each time it is repeated.

import { fetchLinkPreview, fetchPageImageCandidates } from "../src/lib/link_preview";
import { fetchRemoteImage } from "../src/lib/remote_image";
import { isAcceptableHero } from "../src/domain/listing_image_backfill";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) throw new Error("usage: seed_listing_photos.ts <in.json> <out.json>");

/** Photos to keep per venue: one hero plus a short strip, matching what the
 *  detail page draws. */
const KEEP = 6;
/** Candidates to download before giving up on a site. Enough to walk past a
 *  header logo and reach the slider without crawling the whole homepage. */
const TRY = 12;
const CONCURRENCY = Number(process.env.PL_PHOTO_CONCURRENCY ?? 4);
/** Politeness gap between two requests to the same host. Raise it (and drop
 *  the concurrency) for a retry pass over the misses, since those hosts have
 *  already been asked once. */
const PER_IMAGE_DELAY_MS = Number(process.env.PL_PHOTO_DELAY_MS ?? 350);

/** Stricter than the hero gate on purpose. `isAcceptableHero` passes an image
 *  whose size it cannot read, because there a rejection costs a card its only
 *  photo. Here we are choosing from a list, so an unmeasurable file is simply
 *  the weaker candidate and there is no reason to bake it in. */
function isGoodPhoto(w: number | null, h: number | null): boolean {
  if (!w || !h) return false;
  if (!isAcceptableHero(w, h)) return false;
  return Math.min(w, h) >= 400 && Math.max(w, h) >= 600;
}

interface Venue {
  id: string;
  name: string;
  website: string;
  gallery_urls?: string[];
}

const venues: Venue[] = JSON.parse(await Bun.file(inPath).text());

/** Where a site keeps its photos when the homepage is a JS-built splash with
 *  nothing an HTML read can see. Tried only after the homepage comes back
 *  empty, so an ordinary site costs one request as before. Polish paths
 *  because that is the batch this was written for; add others as needed. */
const GALLERY_PATHS = ["/galeria", "/galeria-zdjec", "/oferta", "/wesela", "/sala"];

async function collect(v: Venue): Promise<string[]> {
  if (!v.website) return [];
  const [preview, homepage] = await Promise.all([
    fetchLinkPreview(v.website).catch(() => null),
    fetchPageImageCandidates(v.website).catch(() => [] as string[]),
  ]);
  let body = homepage;
  for (const path of GALLERY_PATHS) {
    if (body.length > 0) break;
    await Bun.sleep(PER_IMAGE_DELAY_MS);
    body = await fetchPageImageCandidates(new URL(path, v.website).toString()).catch(
      () => [] as string[],
    );
  }
  // Dedupe on the file NAME, not the URL: these sites serve one photo from
  // several paths (a `/1920x1080/` resize, a CDN mirror on another host), and
  // keeping both would fill the strip with the same picture twice.
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const u of [preview?.image_url ?? null, ...body]) {
    if (!u) continue;
    const key = u.split("?")[0]?.split("/").pop()?.toLowerCase() ?? u;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(u);
  }

  // Two passes over the same downloads: prefer a photo big enough to stand as
  // a hero, and fall back to whatever clears the ordinary gate so a venue is
  // not left with a placeholder card over a size preference.
  const good: string[] = [];
  const ok: string[] = [];
  for (const url of ordered.slice(0, TRY)) {
    await Bun.sleep(PER_IMAGE_DELAY_MS);
    const img = await fetchRemoteImage(url);
    if (!img || !isAcceptableHero(img.width, img.height)) continue;
    (isGoodPhoto(img.width, img.height) ? good : ok).push(url);
    if (good.length >= KEEP) break;
  }
  return [...good, ...ok].slice(0, KEEP);
}

let done = 0;
let withPhotos = 0;
const queue = [...venues];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length > 0) {
      const v = queue.shift();
      if (!v) return;
      const urls = await collect(v);
      if (urls.length > 0) {
        v.gallery_urls = urls;
        withPhotos++;
      }
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${venues.length}, ${withPhotos} with photos`);
    }
  }),
);

await Bun.write(outPath, `${JSON.stringify(venues, null, 1)}\n`);
console.log(`done: ${withPhotos}/${venues.length} venues have at least one verified photo`);
