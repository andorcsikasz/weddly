/** Research complete Slovak wedding vendors from Zoznam.sk and their websites. */

import { chromium } from "playwright";

type Category = "photography" | "videography" | "wedding_planner" | "wedding_decor" | "other";
type Candidate = {
  source_profile: string;
  country: "SK";
  name: string;
  category: Category;
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

const UA = "Mozilla/5.0 (compatible; WeddlyDirectoryResearch/1.0; +https://weddly.hu)";

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchZoznam(url: string): Promise<string | null> {
  const bytes = await fetchBytes(url);
  return bytes ? new TextDecoder("windows-1250").decode(bytes) : null;
}

async function pooledMap<T, R>(
  items: T[],
  limit: number,
  fn: (value: T) => Promise<R | null>,
): Promise<R[]> {
  let cursor = 0;
  const output: R[] = [];
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        const result = await fn(items[index]!);
        if (result !== null) output.push(result);
      }
    }),
  );
  return output;
}

const sources = [
  {
    base: "https://www.zoznam.sk/katalog/Sluzby-remesla/Fotosluzby-fotoateliery/Svadobni-fotografi%20a%20kameramani/",
    sid: 3873,
    pages: 14,
    category: "photography" as const,
  },
  {
    base: "https://www.zoznam.sk/katalog/Sluzby-remesla/Svadobne-agentury/",
    sid: 3704,
    pages: 3,
    category: "wedding_planner" as const,
  },
];

const listInputs = sources.flatMap((source) =>
  Array.from({ length: source.pages }, (_, index) => ({
    url:
      index === 0
        ? source.base
        : new URL(
            `sekcia.fcgi?sid=${source.sid}&so=&page=${index + 1}&desc=&shops=&kraj=&okres=&cast=&attr=`,
            source.base,
          ).toString(),
    category: source.category,
  })),
);

const listPages = await pooledMap(listInputs, 8, async (input) => {
  const html = await fetchZoznam(input.url);
  return html ? { ...input, html } : null;
});
const profileInputs = listPages.flatMap(({ html, category }) =>
  [
    ...new Set([...html.matchAll(/href=["'](\/firma\/\d+\/[^"']+)/gi)].map((match) => match[1]!)),
  ].map((path) => ({ url: new URL(path, "https://www.zoznam.sk").toString(), category })),
);
console.error(`Found ${profileInputs.length} Zoznam.sk wedding profiles`);

function parseProfile(source_profile: string, category: Category, html: string): Candidate | null {
  for (const match of html.matchAll(
    /<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(match[1]!);
      if (String(data?.["@type"]).toLowerCase() !== "localbusiness") continue;
      const name = String(data.name ?? "").trim();
      const email = String(data.email ?? "")
        .trim()
        .toLowerCase();
      const phone = String(data.telephone ?? "").trim();
      const website = String(data.url ?? "").trim();
      const street = String(data.address?.streetAddress ?? "").trim();
      const postal = String(data.address?.postalCode ?? "")
        .replace(/\s/g, "")
        .trim();
      const city = String(data.address?.addressLocality ?? "").trim();
      if (
        !name ||
        !email.includes("@") ||
        !phone ||
        !/^https?:\/\//.test(website) ||
        !street ||
        !/^\d{5}$/.test(postal) ||
        !city
      )
        return null;
      const combined =
        `${name} ${html.match(/<meta name=["']description["'] content=["']([^"']+)/i)?.[1] ?? ""}`.toLocaleLowerCase(
          "sk",
        );
      const resolvedCategory: Category = /video|kamer/.test(combined)
        ? "videography"
        : /výzdob|dekor/.test(combined)
          ? "wedding_decor"
          : category;
      return {
        source_profile,
        country: "SK",
        name,
        category: resolvedCategory,
        street,
        postal_code: postal,
        city,
        address: `${street}, ${postal.slice(0, 3)} ${postal.slice(3)} ${city}, Slovensko`,
        phone,
        email,
        website,
        lat: Number.isFinite(Number(data.geo?.latitude)) ? Number(data.geo.latitude) : null,
        lng: Number.isFinite(Number(data.geo?.longitude)) ? Number(data.geo.longitude) : null,
        gallery_urls: [],
      };
    } catch {
      // Ignore unrelated invalid structured data.
    }
  }
  return null;
}

const parsed = await pooledMap(profileInputs, 15, async ({ url, category }) => {
  const html = await fetchZoznam(url);
  return html ? parseProfile(url, category, html) : null;
});
const contacts = parsed.filter((candidate, index, all) => {
  let host = "";
  try {
    host = new URL(candidate.website).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  return (
    all.findIndex(
      (other) =>
        other.email === candidate.email ||
        new URL(other.website).hostname.replace(/^www\./, "") === host,
    ) === index
  );
});
console.error(
  `Accepted ${contacts.length} complete-contact Zoznam.sk profiles; rendering vendor images`,
);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "sk-SK",
});
await context.route("**/*", async (route) => {
  if (["font", "media"].includes(route.request().resourceType())) await route.abort();
  else await route.continue();
});
const ignored =
  /(?:logo|favicon|icon|sprite|placeholder|avatar|payment|social|cookie|tracking|pixel|loader|blank|transparent|captcha|gravatar)/i;
let cursor = 0;
let completed = 0;
const accepted: Candidate[] = [];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    const page = await context.newPage();
    while (true) {
      const index = cursor++;
      if (index >= contacts.length) break;
      const candidate = contacts[index]!;
      try {
        await page.goto(candidate.website, { waitUntil: "domcontentloaded", timeout: 18_000 });
        await page.waitForTimeout(1_200);
        await page.evaluate(() => window.scrollTo(0, Math.min(document.body.scrollHeight, 3000)));
        await page.waitForTimeout(800);
        const raw = await page.evaluate(() =>
          Array.from(document.images)
            .filter((image) => image.naturalWidth >= 300 && image.naturalHeight >= 180)
            .map((image) => image.currentSrc)
            .filter(Boolean),
        );
        const images: string[] = [];
        const seen = new Set<string>();
        for (const value of raw) {
          try {
            const url = new URL(value, page.url());
            if (!/^https?:$/.test(url.protocol) || ignored.test(url.pathname)) continue;
            const key = `${url.hostname}${url.pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, "")}`;
            if (seen.has(key)) continue;
            seen.add(key);
            images.push(url.toString());
          } catch {
            // Ignore malformed sources.
          }
        }
        if (images.length) accepted.push({ ...candidate, gallery_urls: images.slice(0, 3) });
      } catch {
        // Dead and blocked legacy websites remain excluded.
      }
      completed += 1;
      if (completed % 25 === 0 || completed === contacts.length)
        console.error(`Rendered ${completed}/${contacts.length}; accepted ${accepted.length}`);
    }
    await page.close();
  }),
);
await context.close();
await browser.close();
accepted.sort((a, b) => a.name.localeCompare(b.name, "sk"));
console.log(
  JSON.stringify(
    { generated_at: new Date().toISOString(), total: accepted.length, candidates: accepted },
    null,
    2,
  ),
);
