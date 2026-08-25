/** Resolve dynamically rendered first-party vendor images with Chromium. */

import { chromium } from "playwright";

type Candidate = {
  source_profile: string;
  country: "AT";
  name: string;
  category: string;
  street: string;
  postal_code: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  lat: number | null;
  lng: number | null;
  gallery_urls: string[];
};

const files = [
  "docs/vendor-research-at-white-lady-contacts.json",
  "docs/vendor-research-at-wko-contacts.json",
];
const all = (
  await Promise.all(
    files.map(async (file) => (await Bun.file(file).json()).candidates as Candidate[]),
  )
).flat();
const candidates = all.filter((candidate, index, rows) => {
  const host = new URL(candidate.website).hostname.replace(/^www\./, "");
  return (
    rows.findIndex(
      (other) =>
        other.email === candidate.email ||
        new URL(other.website).hostname.replace(/^www\./, "") === host,
    ) === index
  );
});

const ignored =
  /(?:logo|favicon|icon|sprite|placeholder|avatar|payment|facebook|instagram|linkedin|youtube|twitter|tiktok|cookie|tracking|pixel|loader|blank|transparent|captcha|gravatar)/i;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/148.0 Safari/537.36",
  locale: "de-AT",
});
await context.route("**/*", async (route) => {
  const type = route.request().resourceType();
  if (["font", "media"].includes(type)) await route.abort();
  else await route.continue();
});

let cursor = 0;
let completed = 0;
const output: Candidate[] = [];
const workerCount = 5;

await Promise.all(
  Array.from({ length: workerCount }, async () => {
    const page = await context.newPage();
    while (true) {
      const index = cursor++;
      if (index >= candidates.length) break;
      const candidate = candidates[index]!;
      try {
        await page.goto(candidate.website, { waitUntil: "domcontentloaded", timeout: 18_000 });
        await page.waitForTimeout(1_000);
        await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 2500)));
        await page.waitForTimeout(700);
        const urls = await page.evaluate(() => {
          const found: string[] = [];
          for (const img of Array.from(document.images)) {
            if (img.currentSrc && img.naturalWidth >= 300 && img.naturalHeight >= 180)
              found.push(img.currentSrc);
          }
          for (const element of Array.from(document.querySelectorAll("body *")).slice(0, 2000)) {
            const value = getComputedStyle(element).backgroundImage;
            if (!value || value === "none") continue;
            for (const match of value.matchAll(/url\(["']?([^"')]+)/g))
              if (match[1]) found.push(match[1]);
          }
          return found;
        });
        const seen = new Set<string>();
        const images: string[] = [];
        for (const raw of urls) {
          try {
            const url = new URL(raw, page.url());
            if (!/^https?:$/.test(url.protocol) || ignored.test(url.pathname)) continue;
            const key =
              `${url.hostname}${url.pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, "")}`.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            images.push(url.toString());
          } catch {
            // Ignore data/blob/malformed image sources.
          }
        }
        if (images.length) output.push({ ...candidate, gallery_urls: images.slice(0, 3) });
      } catch {
        // Dead, TLS-broken and consent-blocked sites remain excluded.
      }
      completed += 1;
      if (completed % 25 === 0 || completed === candidates.length) {
        console.error(
          `Browser-checked ${completed}/${candidates.length}; accepted ${output.length}`,
        );
      }
    }
    await page.close();
  }),
);

await context.close();
await browser.close();
output.sort((a, b) => a.name.localeCompare(b.name, "de"));
console.log(
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: "complete WKO/White Lady contacts plus images rendered from each vendor website",
      total: output.length,
      candidates: output,
    },
    null,
    2,
  ),
);
