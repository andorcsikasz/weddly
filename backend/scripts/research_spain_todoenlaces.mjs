#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const OUTPUT = resolve(process.argv[2] || "docs/spain-todoenlaces-candidates-2026-08-19.json");
const BASE = "https://www.todoenlaces.com";
const USER_AGENT = "WeddlyResearchBot/1.0 (+https://tryweddly.com)";

const CATEGORY_SLUGS = [
  "alimentacion",
  "alojamiento",
  "automocion-y-transporte",
  "belleza",
  "comercio-y-tiendas",
  "educacion-y-formacion",
  "hosteleria-y-restauracion",
  "moda-y-complementos",
  "ocio-y-cultura",
  "publicidad-y-marketing",
  "servicios-empresariales-y-consultoria",
  "servicios-para-el-hogar",
  "servicios-profesionales",
  "turismo-activo",
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function get(url) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 750));
    }
  }
}

function extractCollection(html, sourceCategory, pageUrl) {
  const cardCategories = new Map();
  for (const match of html.matchAll(
    /<a\s+href=["'](https:\/\/www\.todoenlaces\.com\/[^"'#?]+\/?)["'][^>]*\stitle=["']([^"']+)["']/gi,
  )) {
    const url = decodeHtml(match[1]).replace(/\/$/, "/");
    const title = decodeHtml(match[2]);
    const separator = title.lastIndexOf(" - ");
    const locationSeparator = title.lastIndexOf(" en ");
    if (separator < 0 || locationSeparator <= separator) continue;
    cardCategories.set(url, title.slice(separator + 3, locationSeparator).trim());
  }
  const scripts = [
    ...html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (const [, raw] of scripts) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const items = parsed?.mainEntity?.itemListElement;
    if (!Array.isArray(items)) continue;
    return {
      total: Number(parsed.mainEntity.numberOfItems || items.length),
      rows: items.map(({ item }) => ({
        name: decodeHtml(item?.name).trim(),
        category_label: decodeHtml(item?.keywords).trim(),
        category_detail: cardCategories.get(decodeHtml(item?.url).trim().replace(/\/$/, "/")) || "",
        source_category: sourceCategory,
        source_url: decodeHtml(item?.url).trim(),
        website: decodeHtml(Array.isArray(item?.sameAs) ? item.sameAs[0] : item?.sameAs).trim(),
        contact_email: decodeHtml(item?.email).trim().toLowerCase(),
        contact_phone: decodeHtml(item?.telephone).trim(),
        image_url: decodeHtml(
          typeof item?.image === "string" ? item.image : item?.image?.url,
        ).trim(),
        address: decodeHtml(item?.address?.streetAddress).replace(/\s+/g, " ").trim(),
        city: decodeHtml(item?.address?.addressLocality).replace(/\s+/g, " ").trim(),
        postal_code: decodeHtml(item?.address?.postalCode).trim(),
        country: decodeHtml(
          item?.address?.addressCountry?.name || item?.address?.addressCountry,
        ).trim(),
        lat: Number.isFinite(Number(item?.geo?.latitude)) ? Number(item.geo.latitude) : null,
        lng: Number.isFinite(Number(item?.geo?.longitude)) ? Number(item.geo.longitude) : null,
        discovered_on: pageUrl,
      })),
    };
  }
  throw new Error(`No collection JSON-LD found: ${pageUrl}`);
}

async function collectCategory(slug) {
  const firstUrl = `${BASE}/a/${slug}/`;
  const first = extractCollection(await get(firstUrl), slug, firstUrl);
  const pages = Math.max(1, Math.ceil(first.total / 20));
  const rows = [...first.rows];
  for (let page = 2; page <= pages; page += 1) {
    const url = `${BASE}/a/${slug}/page/${page}/`;
    const data = extractCollection(await get(url), slug, url);
    rows.push(...data.rows);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 80));
  }
  return { slug, advertised_total: first.total, collected: rows.length, rows };
}

const results = [];
let cursor = 0;
const workers = Array.from({ length: 4 }, async () => {
  while (cursor < CATEGORY_SLUGS.length) {
    const index = cursor;
    cursor += 1;
    const result = await collectCategory(CATEGORY_SLUGS[index]);
    results.push(result);
    process.stderr.write(`${result.slug}: ${result.collected}/${result.advertised_total}\n`);
  }
});
await Promise.all(workers);

const bySourceUrl = new Map();
for (const result of results) {
  for (const row of result.rows) {
    const existing = bySourceUrl.get(row.source_url);
    if (!existing) {
      bySourceUrl.set(row.source_url, row);
      continue;
    }
    existing.source_category = [
      ...new Set(`${existing.source_category},${row.source_category}`.split(",")),
    ]
      .sort()
      .join(",");
  }
}

const rows = [...bySourceUrl.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
const complete = rows.filter(
  (row) =>
    row.name &&
    row.website &&
    row.contact_email &&
    row.contact_phone &&
    row.image_url &&
    row.address &&
    row.city &&
    row.country === "ES",
);

const summary = {
  researched_at: new Date().toISOString(),
  source: BASE,
  categories: results
    .map(({ slug, advertised_total, collected }) => ({ slug, advertised_total, collected }))
    .sort((a, b) => a.slug.localeCompare(b.slug)),
  raw_unique: rows.length,
  fully_complete: complete.length,
  missing: {
    website: rows.filter((row) => !row.website).length,
    email: rows.filter((row) => !row.contact_email).length,
    phone: rows.filter((row) => !row.contact_phone).length,
    image: rows.filter((row) => !row.image_url).length,
    address: rows.filter((row) => !row.address || !row.city).length,
  },
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
