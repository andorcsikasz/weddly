#!/usr/bin/env node

// Extract contact-complete Croatian wedding-adjacent businesses from public
// Moja Djelatnost profile pages.  robots.txt explicitly allows these profile
// URLs; the script does not call the site's disallowed contact/map endpoints.

import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const outputPath = process.argv[2];
if (!outputPath) {
  console.error("usage: research_moja_djelatnost_vendors.mjs OUTPUT.json");
  process.exit(2);
}

const SITEMAPS = [
  "https://www.moja-djelatnost.hr/sitemap1.xml",
  "https://www.moja-djelatnost.hr/sitemap2.xml",
];
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const CONCURRENCY = 6;
const TIMEOUT_MS = 10_000;
const TARGET_ACCEPTED = 1_600;
const execFileAsync = promisify(execFile);

const CATEGORY_RULES = [
  ["bridal_boutique", /vjencanic|salon-vjencanica|svecane-haljine/i],
  ["invitation_graphics", /pozivnice|papeterij/i],
  ["florist", /cvjec|cvijet|cvjet|florist/i],
  ["photography", /fotograf|foto-studio|fotostudio|snimanje-vjencanja/i],
  ["catering", /catering|ketering/i],
  ["cake_dessert", /slastic|torte|kolaci|kolači/i],
  ["wedding_jewelry", /zlatar|zlatarn|nakit|srebrnarn/i],
  [
    "hair_makeup",
    /kozmet|frizer|frizerski|salon-ljepote|saloni-ljepote|smink|make-?up|manikur|pedikur/i,
  ],
  ["wedding_planner", /organizacija-vjencanja|planiranje-vjencanja|wedding-planner/i],
  ["wedding_decor", /dekoracij.*vjen|vjen.*dekoracij|dekoriranje-vjencanja/i],
  ["rental_equipment", /najam-opreme|iznajmljivanje-opreme/i],
  ["suit_formal", /muska-odijela|svecana-odijela/i],
  ["transport", /prijevoz-putnika|rent-a-car|autobusni-prijevoz|taxi|limuzin/i],
  [
    "accommodation",
    /smjestaj|apartman|hotel|hostel|pansion|(?:^|-)(?:villa|vila)(?:-|$)|kuca-za-odmor|kuce-za-odmor|iznajmljivanje-soba|odmaral|kampiranje|kamp-/i,
  ],
];

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function text(value) {
  return decodeHtml(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function categoryFor(url) {
  const slug = decodeURI(new URL(url).pathname.split("/")[1] || "");
  return CATEGORY_RULES.find(([, pattern]) => pattern.test(slug))?.[0] || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, timeoutMs = TIMEOUT_MS) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(
        "curl",
        [
          "--location",
          "--fail",
          "--silent",
          "--show-error",
          "--max-time",
          String(Math.ceil(timeoutMs / 1000)),
          "--user-agent",
          USER_AGENT,
          url,
        ],
        {
          maxBuffer: 12 * 1024 * 1024,
        },
      );
      return stdout;
    } catch {
      // Retry connection resets and the directory's short overload windows.
    }
    await delay(600 * (attempt + 1));
  }
  return null;
}

function itemprop(html, property) {
  const pattern = new RegExp(
    `<[^>]+itemprop=["']${property}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "gi",
  );
  for (const match of html.matchAll(pattern)) {
    const value = text(match[1])
      .replace(/^mailto:/i, "")
      .trim();
    if (value) return value;
  }
  return null;
}

function addressFrom(html) {
  const street = itemprop(html, "streetAddress");
  const postcode = itemprop(html, "postalCode");
  const city = itemprop(html, "addressLocality");
  if (!street || !city) return null;
  return {
    value: `${street}, ${[postcode, city].filter(Boolean).join(" ")}, Croatia`,
    city,
  };
}

function firstBusinessEmail(html) {
  const value = itemprop(html, "email")?.replace(/^mailto:/i, "");
  if (
    value &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !value.toLowerCase().endsWith("@moja-djelatnost.hr")
  ) {
    return value.toLowerCase();
  }
  const beforeFooter = html.split(/<footer\b/i)[0];
  const match = beforeFooter.match(/mailto:([^"'?\s>]+)/i);
  const fallback = match ? decodeURIComponent(match[1]).toLowerCase() : null;
  return fallback?.endsWith("@moja-djelatnost.hr") ? null : fallback;
}

function firstBusinessPhone(html) {
  const value = itemprop(html, "telephone");
  if (!value || value.replace(/\D/g, "").length < 8) return null;
  return value.trim();
}

function imagesFrom(html, pageUrl) {
  const values = [];
  for (const match of html.matchAll(/<img\b[^>]+(?:src|data-src)=["']([^"']+)["']/gi)) {
    try {
      const value = new URL(decodeHtml(match[1]), pageUrl).href;
      if (/\/Content\/img\/|partnersdirectory|logo|favicon|badge/i.test(value)) continue;
      if (!/[?&]type=Gallery/i.test(value) && !/\.(?:avif|jpe?g|png|webp)(?:[?#]|$)/i.test(value)) {
        continue;
      }
      values.push(value);
    } catch {
      // Ignore malformed URLs.
    }
  }
  return [...new Set(values)].slice(0, 5);
}

function nameFrom(html) {
  const heading = html.match(/<h1[^>]+itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i);
  if (!heading) return null;
  const withoutSubtitle = heading[1].replace(/<span\b[\s\S]*?<\/span>/gi, " ");
  return text(withoutSubtitle);
}

function descriptionFrom(html) {
  const match = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  return match ? decodeHtml(match[1]).replace(/\s+/g, " ").trim() : null;
}

async function parseProfile(url, category) {
  const html = await fetchText(url);
  if (!html) return null;
  const name = nameFrom(html);
  const address = addressFrom(html);
  const email = firstBusinessEmail(html);
  const phone = firstBusinessPhone(html);
  const images = imagesFrom(html, url);
  if (!name || !address || !email || !phone || images.length === 0) return null;
  return {
    name,
    category,
    city: address.city,
    address: address.value,
    website: url,
    contact_email: email,
    contact_phone: phone,
    description_source: descriptionFrom(html),
    gallery_urls: images,
    source_url: url,
    source: "moja-djelatnost.hr public business profile",
  };
}

const allUrls = [];
for (const sitemap of SITEMAPS) {
  const xml = await fetchText(sitemap, 30_000);
  if (!xml) throw new Error(`Unable to fetch ${sitemap}`);
  allUrls.push(...[...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => decodeHtml(match[1])));
}
const candidates = allUrls
  .map((url) => ({ url, category: categoryFor(url) }))
  .filter((item) => item.category);

const results = [];
const seen = new Set();
let cursor = 0;
let completed = 0;

async function worker() {
  while (true) {
    if (results.length >= TARGET_ACCEPTED) return;
    const index = cursor++;
    if (index >= candidates.length) return;
    const candidate = candidates[index];
    const row = await parseProfile(candidate.url, candidate.category);
    await delay(150);
    completed += 1;
    if (row) {
      const key = `${row.name.toLocaleLowerCase("hr")}\0${row.city.toLocaleLowerCase("hr")}`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push(row);
      }
    }
    if (completed % 100 === 0 || completed === candidates.length) {
      console.log(
        JSON.stringify({ completed, total: candidates.length, accepted: results.length }),
      );
      await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
results.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, "hr"));
await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
