/**
 * Research complete Austrian wedding suppliers from the official WKO
 * Firmen A-Z search and collect three candidate images from each supplier's
 * own public website. This script is read-only and prints an audit JSON file.
 *
 * Usage:
 *   bun backend/scripts/research_at_wko.ts > docs/vendor-research-at-wko-2000.json
 */

type Category =
  | "venue"
  | "wedding_planner"
  | "catering"
  | "cake_dessert"
  | "wedding_decor"
  | "florist"
  | "rental_equipment"
  | "photography"
  | "videography"
  | "photo_booth"
  | "dj"
  | "live_music"
  | "entertainment"
  | "mc_celebrant"
  | "celebrant"
  | "dance_lessons"
  | "sound_tech"
  | "bridal_boutique"
  | "suit_formal"
  | "hair_makeup"
  | "nails"
  | "wedding_jewelry"
  | "invitation_graphics"
  | "transport"
  | "other";

type Candidate = {
  source_profile: string;
  country: "AT";
  name: string;
  category: Category;
  street: string;
  postal_code: string;
  city: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  lat: null;
  lng: null;
  gallery_urls: string[];
};

const UA = "Mozilla/5.0 (compatible; WeddlyDirectoryResearch/1.0; +https://weddly.hu)";

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function textOnly(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(
  url: string,
  timeoutMs = 15_000,
): Promise<{ html: string; url: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("html")) return null;
    return { html: await response.text(), url: response.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWkoText(url: string): Promise<string | null> {
  // WKO's edge currently rejects Bun's TLS client fingerprint even with a
  // browser UA, while its public HTML is available to curl and browsers.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const child = Bun.spawn(["curl", "-L", "--max-time", "20", "-s", url], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const html = await new Response(child.stdout).text();
    const exitCode = await child.exited;
    if (exitCode === 0 && html.includes("search-result-article")) {
      await Bun.sleep(1_000);
      return html;
    }
    await Bun.sleep(3_000 * (attempt + 1));
  }
  return null;
}

async function fetchSiteText(url: string): Promise<{ html: string; url: string } | null> {
  const direct = await fetchText(url);
  if (direct) return direct;
  const marker = "\n__WEDDLY_FINAL_URL__";
  const child = Bun.spawn(
    ["curl", "-L", "--max-time", "20", "-s", "-A", UA, "-w", `${marker}%{url_effective}`, url],
    { stdout: "pipe", stderr: "ignore" },
  );
  const body = await new Response(child.stdout).text();
  const exitCode = await child.exited;
  if (exitCode !== 0) return null;
  const splitAt = body.lastIndexOf(marker);
  if (splitAt < 0) return null;
  const html = body.slice(0, splitAt);
  const finalUrl = body.slice(splitAt + marker.length).trim();
  return /<html|<!doctype/i.test(html) && finalUrl ? { html, url: finalUrl } : null;
}

async function pooledMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R | null>,
): Promise<R[]> {
  const output: R[] = [];
  let cursor = 0;
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

function inferCategory(value: string): Category {
  const s = value.toLocaleLowerCase("de");
  if (/fotobox|photobooth|foto.?box/.test(s)) return "photo_booth";
  if (/video|film|kameram/.test(s)) return "videography";
  if (/fotograf|fotografie|photo/.test(s)) return "photography";
  if (/hochzeitsplan|wedding.?plan|hochzeitsorgan|wedding & event|weddings & events/.test(s))
    return "wedding_planner";
  if (/location|hotel|restaurant|gasthaus|schloss|burg|heurig|weingut|seminarhof/.test(s))
    return "venue";
  if (/catering|partyservice|gastronomie/.test(s)) return "catering";
  if (/torte|konditor|patisserie|confiserie|süß|cake/.test(s)) return "cake_dessert";
  if (/flor|blumen|blüte/.test(s)) return "florist";
  if (/deko|dekoration|eventdesign/.test(s)) return "wedding_decor";
  if (/verleih|vermiet|mietmöbel|inventar/.test(s)) return "rental_equipment";
  if (/\bdj\b|discjockey|diskjockey/.test(s)) return "dj";
  if (/band|musik|sänger|sängerin|vokal|saxophon|geiger|pianist/.test(s)) return "live_music";
  if (/moderator|zeremonienmeister|hochzeitsredner|trauredner/.test(s)) return "mc_celebrant";
  if (/freie.?trau|standesbeamt|celebrant/.test(s)) return "celebrant";
  if (/tanzschul|tanzkurs/.test(s)) return "dance_lessons";
  if (/tontechnik|lichttechnik|veranstaltungstechnik|eventtechnik/.test(s)) return "sound_tech";
  if (/brautmode|brautkleid|bridal/.test(s)) return "bridal_boutique";
  if (/herrenausstatt|hochzeitsanzug|maßanzug/.test(s)) return "suit_formal";
  if (/make.?up|visag|brautstyling|friseur|haarstyling/.test(s)) return "hair_makeup";
  if (/nagel|nail/.test(s)) return "nails";
  if (/juwel|schmuck|ehering|goldschmied|trauring/.test(s)) return "wedding_jewelry";
  if (/papeterie|einladung|druck|grafik|karten/.test(s)) return "invitation_graphics";
  if (/limous|hochzeitsauto|kutsche|bus|taxi|transport/.test(s)) return "transport";
  if (/zauber|feuerwerk|kinderbetreuung|show|animation/.test(s)) return "entertainment";
  return "other";
}

function normalizeWebsite(raw: string): string | null {
  try {
    const url = new URL(decodeHtml(raw));
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parseWkoPage(pageUrl: string, html: string): Omit<Candidate, "gallery_urls">[] {
  const rows: Omit<Candidate, "gallery_urls">[] = [];
  for (const match of html.matchAll(
    /<article class=['"]search-result-article['"]>([\s\S]*?)<\/article>/gi,
  )) {
    const block = match[1]!;
    const name = textOnly(
      block.match(/class=["']title-link["'][^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>/i)?.[1] ?? "",
    );
    const details = textOnly(
      block.match(/class=["']title-details["']>([\s\S]*?)<\/div>/i)?.[1] ?? "",
    );
    const detailHref = decodeHtml(
      block.match(/class=["']title-link["'][^>]*href=["']([^"']+)/i)?.[1] ?? "",
    );
    const phone = decodeHtml(block.match(/href=["']tel:([^"']+)/i)?.[1] ?? "").trim();
    const email = decodeHtml(block.match(/href=["']mailto:([^"']+)/i)?.[1] ?? "")
      .trim()
      .toLowerCase();
    const website = normalizeWebsite(
      block.match(/data-gtm-event=["']kontaktinfo-web-click["'][^>]*href=["']([^"']+)/i)?.[1] ?? "",
    );
    const street = textOnly(block.match(/class=["']street["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const place = textOnly(block.match(/class=["']place["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "");
    const placeMatch = place.match(/^(\d{4})\s+(.+)$/);
    if (!name || !phone || !email.includes("@") || !website || !street || !placeMatch) continue;
    if (/wko\.at$/.test(new URL(website).hostname)) continue;
    rows.push({
      source_profile: new URL(detailHref || pageUrl, "https://firmen.wko.at").toString(),
      country: "AT",
      name,
      category: inferCategory(`${name} ${details}`),
      street,
      postal_code: placeMatch[1]!,
      city: placeMatch[2]!.trim(),
      address: `${street}, ${placeMatch[1]} ${placeMatch[2]!.trim()}, Österreich`,
      phone,
      email,
      website,
      lat: null,
      lng: null,
    });
  }
  return rows;
}

const ignoredImage =
  /(?:logo|favicon|icon|sprite|placeholder|avatar|payment|facebook|instagram|linkedin|youtube|twitter|tiktok|cookie|tracking|pixel|loader|blank|transparent|captcha)/i;

function imageCandidates(html: string, baseUrl: string): string[] {
  const expandedHtml = html.replaceAll("\\/", "/");
  const raw = [
    ...[
      ...expandedHtml.matchAll(
        /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/gi,
      ),
    ].map((m) => m[1]!),
    ...[
      ...expandedHtml.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/gi),
    ].map((m) => m[1]!),
    ...[
      ...expandedHtml.matchAll(
        /(?:src|data-src|data-lazy-src|data-bg|data-bgset|data-background-image)=["']([^"']+)/gi,
      ),
    ].map((m) => m[1]!),
    ...[...expandedHtml.matchAll(/srcset=["']([^"']+)/gi)].flatMap((m) =>
      m[1]!.split(",").map((part) => part.trim().split(/\s+/)[0]!),
    ),
    ...[
      ...expandedHtml.matchAll(/url\(["']?([^"')]+\.(?:jpe?g|png|webp|avif)(?:\?[^"')]*)?)/gi),
    ].map((m) => m[1]!),
    ...[
      ...expandedHtml.matchAll(
        /(https?:\/\/[^"'<>\s]+\.(?:jpe?g|png|webp|avif)(?:\?[^"'<>\s]*)?)/gi,
      ),
    ].map((m) => m[1]!),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    try {
      const url = new URL(decodeHtml(value.replace(/^url\(['"]?|['"]?\)$/g, "")), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      if (!/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(url.toString())) continue;
      if (ignoredImage.test(url.pathname)) continue;
      const key =
        `${url.hostname}${url.pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, "")}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url.toString());
    } catch {
      // Ignore malformed lazy-loader values.
    }
  }
  return out;
}

async function ownWebsiteImages(website: string): Promise<string[]> {
  let home = await fetchSiteText(website);
  if (!home) {
    try {
      const secure = new URL(website);
      secure.protocol = "https:";
      home = await fetchSiteText(secure.toString());
    } catch {
      // Invalid URLs were already filtered before this stage.
    }
  }
  if (!home) return [];
  let images = imageCandidates(home.html, home.url);
  if (images.length >= 3) return images.slice(0, 3);

  const links = [...home.html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((m) => m[1]!)
    .filter((href) =>
      /hochzeit|wedding|portfolio|galerie|gallery|referenz|leistung|angebot|ueber|über/i.test(href),
    )
    .map((href) => {
      try {
        return new URL(decodeHtml(href), home.url).toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => Boolean(url))
    .filter((url) => new URL(url).hostname === new URL(home.url).hostname)
    .slice(0, 6);
  for (const link of [...new Set(links)]) {
    const page = await fetchSiteText(link);
    if (!page) continue;
    images = [...images, ...imageCandidates(page.html, page.url)];
    const unique = [
      ...new Map(
        images.map((image) => [new URL(image).pathname.replace(/-\d+x\d+(?=\.[^.]+$)/, ""), image]),
      ).values(),
    ];
    if (unique.length >= 3) return unique.slice(0, 3);
  }
  return [...new Set(images)].slice(0, 3);
}

function parseWhiteLadyPage(pageUrl: string, html: string): Omit<Candidate, "gallery_urls">[] {
  const rows: Omit<Candidate, "gallery_urls">[] = [];
  for (const match of html.matchAll(
    /<article class=["']directorist-listing-single[^"']*["']>([\s\S]*?)<\/article>/gi,
  )) {
    const block = match[1]!;
    const title = block.match(
      /class=["']directorist-listing-title["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const sourceProfile = normalizeWebsite(title?.[1] ?? "");
    const name = textOnly(title?.[2] ?? "");
    const address = textOnly(
      block.match(/class=["']directorist-listing-card-address["'][^>]*>([\s\S]*?)<\/li>/i)?.[1] ??
        "",
    );
    const phone = decodeHtml(block.match(/href=["']tel:([^"']+)/i)?.[1] ?? "").trim();
    const email = decodeHtml(block.match(/href=["']mailto:([^"']+)/i)?.[1] ?? "")
      .trim()
      .toLowerCase();
    const website = normalizeWebsite(
      block.match(
        /class=["']directorist-listing-card-website["'][\s\S]*?href=["']([^"']+)/i,
      )?.[1] ?? "",
    );
    const addressMatch = address.match(/^(.*?),\s*(\d{4})\s+([^,]+),\s*Österreich$/i);
    if (!sourceProfile || !name || !addressMatch || !phone || !email.includes("@") || !website)
      continue;
    rows.push({
      source_profile: sourceProfile,
      country: "AT",
      name,
      category: inferCategory(name),
      street: addressMatch[1]!.trim(),
      postal_code: addressMatch[2]!,
      city: addressMatch[3]!.trim(),
      address,
      phone,
      email,
      website,
      lat: null,
      lng: null,
    });
  }
  return rows;
}

const searchTerms = [
  "hochzeit",
  "hochzeitsfotograf",
  "hochzeitsfotografie",
  "wedding-fotograf",
  "hochzeitsvideo",
  "hochzeitsfilmer",
  "wedding-film",
  "hochzeitsfotobox",
  "fotobox-hochzeit",
  "photobooth-hochzeit",
  "hochzeitsplaner",
  "hochzeitsplanung",
  "wedding-planner",
  "hochzeitsagentur",
  "wedding-design",
  "hochzeitsdeko",
  "hochzeitsdekoration",
  "eventdekoration-hochzeit",
  "hochzeitsfloristik",
  "brautstrauss",
  "hochzeitsblumen",
  "floristik-hochzeit",
  "hochzeitstorte",
  "wedding-cake",
  "torten-hochzeit",
  "hochzeitscatering",
  "catering-hochzeit",
  "hochzeits-dj",
  "hochzeitsdj",
  "dj-hochzeit",
  "hochzeitsband",
  "hochzeitsmusik",
  "trauungsmusik",
  "saengerin-hochzeit",
  "live-musik-hochzeit",
  "brautmode",
  "brautkleid",
  "brautmodengeschaeft",
  "hochzeitsanzug",
  "herrenausstatter-hochzeit",
  "eheringe",
  "trauringe",
  "hochzeitsschmuck",
  "hochzeitspapeterie",
  "hochzeitseinladung",
  "einladungskarten-hochzeit",
  "freie-trauung",
  "hochzeitsredner",
  "trauredner",
  "zeremonienmeister",
  "hochzeitsmoderator",
  "brautstyling",
  "hochzeitsfrisur",
  "hochzeitsmakeup",
  "visagistin-hochzeit",
  "hochzeitsauto",
  "hochzeitskutsche",
  "limousine-hochzeit",
  "hochzeitslocation",
  "hochzeitsfeuerwerk",
  "hochzeitstanz",
  "tanzschule-hochzeit",
  "eventtechnik-hochzeit",
  "veranstaltungstechnik-hochzeit",
  "zeltverleih-hochzeit",
  "moebelverleih-hochzeit",
  "kinderbetreuung-hochzeit",
  "hochzeitsentertainment",
  "hochzeitsgeschenke",
  "hochzeitskerzen",
];
const sourceMode = process.env.SOURCE_MODE ?? "all";
const termLimit = Number(process.env.WKO_TERMS ?? searchTerms.length);
const pages =
  sourceMode === "white_lady"
    ? []
    : searchTerms.slice(0, termLimit).map((term) => `https://firmen.wko.at/${term}/`);
console.error(`Reading ${pages.length} WKO wedding-service searches`);
let checkedSearches = 0;
const pageResults = await pooledMap(pages, 1, async (url) => {
  const html = await fetchWkoText(url);
  checkedSearches += 1;
  if (checkedSearches % 10 === 0 || checkedSearches === pages.length) {
    console.error(`Checked ${checkedSearches}/${pages.length} WKO searches`);
  }
  return html ? parseWkoPage(url, html) : null;
});
const whiteLadyPages =
  sourceMode === "wko"
    ? []
    : Array.from({ length: Number(process.env.WHITE_LADY_PAGES ?? 205) }, (_, index) =>
        index === 0
          ? "https://www.white-lady.at/hochzeitsplanung/hochzeitsdienstleister-bayern-oberoesterreich/"
          : `https://www.white-lady.at/hochzeitsplanung/hochzeitsdienstleister-bayern-oberoesterreich/page/${index + 1}/`,
      );
console.error(`Reading ${whiteLadyPages.length} White Lady directory pages`);
let checkedWhiteLady = 0;
const whiteLadyResults = await pooledMap(whiteLadyPages, 8, async (url) => {
  const response = await fetchText(url);
  checkedWhiteLady += 1;
  if (checkedWhiteLady % 25 === 0 || checkedWhiteLady === whiteLadyPages.length) {
    console.error(`Checked ${checkedWhiteLady}/${whiteLadyPages.length} White Lady pages`);
  }
  return response ? parseWhiteLadyPage(url, response.html) : null;
});

const raw = [...pageResults.flat(), ...whiteLadyResults.flat()];
const deduped = raw.filter((candidate, index, all) => {
  const key = `${candidate.email}|${new URL(candidate.website).hostname.replace(/^www\./, "")}`;
  return (
    all.findIndex(
      (other) => `${other.email}|${new URL(other.website).hostname.replace(/^www\./, "")}` === key,
    ) === index
  );
});
console.error(
  `Found ${deduped.length} unique complete-contact WKO suppliers; checking own-site images`,
);

const minimumImages = Math.max(0, Number(process.env.MIN_IMAGES ?? 3));
const candidates = await pooledMap(deduped, 10, async (candidate) => {
  const gallery_urls = minimumImages === 0 ? [] : await ownWebsiteImages(candidate.website);
  return gallery_urls.length >= minimumImages ? { ...candidate, gallery_urls } : null;
});
candidates.sort((a, b) => a.name.localeCompare(b.name, "de"));
console.error(
  `Accepted ${candidates.length} Austrian suppliers with at least ${minimumImages} own-site image(s)`,
);

const counts = candidates.reduce<Record<string, number>>((acc, candidate) => {
  acc[candidate.category] = (acc[candidate.category] ?? 0) + 1;
  return acc;
}, {});

console.log(
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      source: "WKO Firmen A-Z search for Hochzeit plus vendor-owned websites",
      rules: {
        required: [
          "name",
          "complete address",
          "phone",
          "email",
          "vendor website",
          `${minimumImages}+ own-site image(s)`,
        ],
      },
      total: candidates.length,
      counts,
      candidates,
    },
    null,
    2,
  ),
);
