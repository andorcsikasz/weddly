#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUTPUT = resolve(process.argv[2] || "docs/spain-bodalia-candidates-2026-08-19.json");
const BASE = "https://bodalia.es";
const USER_AGENT = "WeddlyResearchBot/1.0 (+https://tryweddly.com)";
const CATEGORIES = [
  "banquetes-y-celebracion",
  "fotografia-y-video",
  "musica-y-animacion",
  "moda-nupcial",
  "belleza",
  "decoracion-y-flores",
  "transporte",
  "viajes",
  "joyeria-y-alianzas",
  "invitaciones-y-papeleria",
  "organizacion-de-bodas",
  "otros-servicios",
];

async function get(url) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.includes("Sorry, you have been blocked")) throw new Error("Cloudflare block page");
      return html;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 900));
    }
  }
}

function providerUrls(html) {
  return [
    ...new Set(
      [...html.matchAll(/https:\/\/bodalia\.es\/proveedor\/[a-z0-9-]+/gi)].map((match) => match[0]),
    ),
  ];
}

async function collectCategory(category) {
  const firstUrl = `${BASE}/proveedores/${category}`;
  const firstHtml = await get(firstUrl);
  const lastPage = Math.max(
    1,
    ...[...firstHtml.matchAll(new RegExp(`${category}\\?page=(\\d+)`, "g"))].map((match) =>
      Number(match[1]),
    ),
  );
  const urls = providerUrls(firstHtml);
  for (let page = 2; page <= lastPage; page += 1) {
    urls.push(...providerUrls(await get(`${firstUrl}?page=${page}`)));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  const unique = [...new Set(urls)];
  process.stderr.write(`${category}: ${unique.length} profiles across ${lastPage} pages\n`);
  return unique.map((url) => ({ url, category }));
}

function parseProfile(html, sourceUrl, category) {
  const scripts = [
    ...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  let business = null;
  for (const [, raw] of scripts) {
    try {
      const value = JSON.parse(raw);
      if (value?.name && value?.address && value?.url === sourceUrl) {
        business = value;
        break;
      }
    } catch {
      // Ignore non-JSON scripts; the page's business payload is strict JSON.
    }
  }
  if (!business) return { source_url: sourceUrl, source_category: category, parse_error: true };

  const galleries = [
    ...html.matchAll(/<img\s+src=["'](https:\/\/bodalia\.es\/storage\/providers\/[^"']+)["']/gi),
  ]
    .map((match) => match[1])
    .filter((url) => !/_320\.webp(?:\?|$)/.test(url));
  const galleryUrls = [...new Set([business.image, ...galleries].filter(Boolean))].slice(0, 6);
  const locality = String(business.address?.addressLocality || "").trim();
  const region = String(business.address?.addressRegion || "").trim();
  const street = String(business.address?.streetAddress || "").trim();
  const postal = String(business.address?.postalCode || "").trim();
  const address = [street, postal, locality, region, "España"].filter(Boolean).join(", ");

  return {
    name: String(business.name || "").trim(),
    category_label: String(business["@type"] || "").trim(),
    source_category: category,
    source_url: sourceUrl,
    website: sourceUrl,
    contact_email: String(business.email || "")
      .trim()
      .toLowerCase(),
    contact_phone: String(business.telephone || "").trim(),
    gallery_urls: galleryUrls,
    address,
    city: locality,
    province: region,
    country: String(business.address?.addressCountry || "").trim(),
    description: String(business.description || "")
      .replace(/\s+/g, " ")
      .trim(),
    lat: null,
    lng: null,
  };
}

const categoryRows = (await Promise.all(CATEGORIES.map(collectCategory))).flat();
const categoryByUrl = new Map();
for (const { url, category } of categoryRows) {
  const existing = categoryByUrl.get(url);
  categoryByUrl.set(url, existing ? `${existing},${category}` : category);
}

const urls = [...categoryByUrl.keys()];
const rows = [];
let cursor = 0;
let finished = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < urls.length) {
    const index = cursor;
    cursor += 1;
    const url = urls[index];
    try {
      rows.push(parseProfile(await get(url), url, categoryByUrl.get(url)));
    } catch (error) {
      rows.push({
        source_url: url,
        source_category: categoryByUrl.get(url),
        fetch_error: String(error),
      });
    }
    finished += 1;
    if (finished % 50 === 0 || finished === urls.length)
      process.stderr.write(`profiles: ${finished}/${urls.length}\n`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  }
});
await Promise.all(workers);

rows.sort((a, b) =>
  String(a.name || a.source_url).localeCompare(String(b.name || b.source_url), "es"),
);
const complete = rows.filter(
  (row) =>
    row.name &&
    row.website &&
    row.contact_email &&
    row.contact_phone &&
    row.gallery_urls?.length &&
    row.address &&
    row.city &&
    row.country === "ES",
);
const summary = {
  researched_at: new Date().toISOString(),
  source: BASE,
  profiles_discovered: urls.length,
  profiles_parsed: rows.filter((row) => row.name).length,
  fully_complete: complete.length,
  missing: {
    email: rows.filter((row) => !row.contact_email).length,
    phone: rows.filter((row) => !row.contact_phone).length,
    image: rows.filter((row) => !row.gallery_urls?.length).length,
    location: rows.filter((row) => !row.address || !row.city).length,
  },
};
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
