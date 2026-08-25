/** Match complete-contact Austrian vendors to their Hochzeit.click portfolios. */

type Contact = {
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

const UA = "Mozilla/5.0 (compatible; WeddlyDirectoryResearch/1.0; +https://weddly.hu)";
const stop = new Set([
  "e",
  "u",
  "eu",
  "gmbh",
  "kg",
  "og",
  "ag",
  "co",
  "ma",
  "ba",
  "msc",
  "mag",
  "ing",
  "dr",
  "fotografie",
  "photography",
  "foto",
  "hochzeit",
  "hochzeits",
  "wedding",
  "weddings",
  "event",
  "events",
  "austria",
  "oesterreich",
  "osterreich",
  "wien",
  "official",
  "the",
  "and",
  "und",
]);

function tokens(value: string): string[] {
  return value
    .toLocaleLowerCase("de")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/&/g, " und ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !stop.has(token));
}

function slugFromUrl(url: string): string {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return parts.at(-1) ?? "";
}

function similarity(name: string, profileUrl: string): number {
  const a = [...new Set(tokens(name))];
  const b = [...new Set(tokens(slugFromUrl(profileUrl)))];
  if (!a.length || !b.length) return 0;
  const ak = a.join("");
  const bk = b.join("");
  if (ak === bk) return 1;
  if (Math.min(ak.length, bk.length) >= 7 && (ak.includes(bk) || bk.includes(ak))) return 0.96;
  const overlap = a.filter((token) => b.includes(token));
  const containment = overlap.length / Math.min(a.length, b.length);
  const union = new Set([...a, ...b]).size;
  const jaccard = overlap.length / union;
  const rareSingle = overlap.length === 1 && overlap[0]!.length >= 8 ? 0.78 : 0;
  return Math.max(rareSingle, containment * 0.7 + jaccard * 0.3);
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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

const contactFiles = [
  "docs/vendor-research-at-white-lady-contacts.json",
  "docs/vendor-research-at-wko-contacts.json",
];
const contacts = (
  await Promise.all(
    contactFiles.map(async (file) => (await Bun.file(file).json()).candidates as Contact[]),
  )
).flat();
const deduped = contacts.filter((candidate, index, all) => {
  const host = new URL(candidate.website).hostname.replace(/^www\./, "");
  return (
    all.findIndex(
      (other) =>
        other.email === candidate.email ||
        new URL(other.website).hostname.replace(/^www\./, "") === host,
    ) === index
  );
});

const sitemapUrls = [
  "https://hochzeit.click/dienstleister-sitemap.xml",
  "https://hochzeit.click/dienstleister-sitemap2.xml",
  "https://hochzeit.click/dienstleister-sitemap3.xml",
  "https://hochzeit.click/dienstleister-sitemap4.xml",
  "https://hochzeit.click/fotograf-sitemap.xml",
  "https://hochzeit.click/fotograf-sitemap2.xml",
  "https://hochzeit.click/location-sitemap.xml",
  "https://hochzeit.click/location-sitemap2.xml",
];
const sitemapBodies = await pooledMap(sitemapUrls, 4, fetchText);
const profiles = [
  ...new Set(
    sitemapBodies.flatMap((xml) =>
      [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]!),
    ),
  ),
].filter((url) => /\/(?:hochzeitsdienstleister|hochzeitsfotograf|hochzeitslocation)\//.test(url));

const proposed = deduped.flatMap((contact) => {
  const ranked = profiles
    .map((profile) => ({ profile, score: similarity(contact.name, profile) }))
    .filter((match) => match.score >= 0.72)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return [];
  const second = ranked[1]?.score ?? 0;
  if (best.score < 0.94 && best.score - second < 0.12) return [];
  return [{ contact, profile: best.profile, score: best.score }];
});
console.error(
  `Matching ${deduped.length} contacts against ${profiles.length} portfolios: ${proposed.length} high-confidence names`,
);

const matches = await pooledMap(proposed, 10, async ({ contact, profile, score }) => {
  const html = await fetchText(profile);
  if (!html) return null;
  const pageName =
    html
      .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? "";
  if (similarity(contact.name, `https://x.invalid/${encodeURIComponent(pageName)}`) < 0.72)
    return null;
  const images = [
    ...new Set(
      [
        ...html.matchAll(
          /https:\/\/media\.hochzeit\.click\/image\/upload\/[^"'<>\s]+\.(?:jpe?g|png|webp)/gi,
        ),
      ].map((match) => match[0]!.replace(/\/w_880,/i, "/w_1800,")),
    ),
  ].slice(0, 3);
  if (images.length < 3) return null;
  return { ...contact, gallery_urls: images, gallery_profile: profile, match_score: score };
});
matches.sort((a, b) => a.name.localeCompare(b.name, "de"));
console.error(`Accepted ${matches.length} contact-to-gallery matches`);
console.log(
  JSON.stringify(
    { generated_at: new Date().toISOString(), total: matches.length, candidates: matches },
    null,
    2,
  ),
);
