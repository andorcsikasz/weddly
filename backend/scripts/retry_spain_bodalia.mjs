#!/usr/bin/env node
//
// DISABLED 2026-09-03 — see research_spain_bodalia.mjs. Same denylisted host.
process.stderr.write(
  "retry_spain_bodalia.mjs is disabled: bodalia.es is on the disputed-source denylist " +
    "(backend/src/lib/scrape_denylist.ts).\n",
);
process.exit(1);

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PATH = resolve(process.argv[2] || "docs/spain-bodalia-candidates-2026-08-19.json");
const USER_AGENT = "WeddlyResearchBot/1.0 (+https://tryweddly.com)";
const data = JSON.parse(await readFile(PATH, "utf8"));

async function get(url) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null);
    if (response?.ok) {
      const html = await response.text();
      if (!html.includes("Sorry, you have been blocked")) return html;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 3_000));
  }
  throw new Error("retry limit reached");
}

function parseProfile(html, original) {
  let business = null;
  for (const [, raw] of html.matchAll(
    /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const value = JSON.parse(raw);
      if (value?.name && value?.address && value?.url === original.source_url) {
        business = value;
        break;
      }
    } catch {
      // Continue to the next JSON-LD block.
    }
  }
  if (!business) throw new Error("business JSON-LD missing");
  const galleries = [
    ...html.matchAll(/<img\s+src=["'](https:\/\/bodalia\.es\/storage\/providers\/[^"']+)["']/gi),
  ]
    .map((match) => match[1])
    .filter((url) => !/_320\.webp(?:\?|$)/.test(url));
  const locality = String(business.address?.addressLocality || "").trim();
  const region = String(business.address?.addressRegion || "").trim();
  const street = String(business.address?.streetAddress || "").trim();
  const postal = String(business.address?.postalCode || "").trim();
  return {
    name: String(business.name || "").trim(),
    category_label: String(business["@type"] || "").trim(),
    source_category: original.source_category,
    source_url: original.source_url,
    website: original.source_url,
    contact_email: String(business.email || "")
      .trim()
      .toLowerCase(),
    contact_phone: String(business.telephone || "").trim(),
    gallery_urls: [...new Set([business.image, ...galleries].filter(Boolean))].slice(0, 6),
    address: [street, postal, locality, region, "España"].filter(Boolean).join(", "),
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

const failedIndexes = data.rows
  .map((row, index) => ({ row, index }))
  .filter(({ row }) => !row.name);
let recovered = 0;
for (const [position, { row, index }] of failedIndexes.entries()) {
  try {
    data.rows[index] = parseProfile(await get(row.source_url), row);
    recovered += 1;
  } catch (error) {
    data.rows[index] = { ...row, fetch_error: String(error) };
  }
  if ((position + 1) % 20 === 0 || position + 1 === failedIndexes.length) {
    process.stderr.write(
      `retried ${position + 1}/${failedIndexes.length}; recovered ${recovered}\n`,
    );
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_200));
}

data.rows.sort((a, b) =>
  String(a.name || a.source_url).localeCompare(String(b.name || b.source_url), "es"),
);
const complete = data.rows.filter(
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
data.summary.retried_at = new Date().toISOString();
data.summary.profiles_parsed = data.rows.filter((row) => row.name).length;
data.summary.fully_complete = complete.length;
data.summary.missing = {
  email: data.rows.filter((row) => !row.contact_email).length,
  phone: data.rows.filter((row) => !row.contact_phone).length,
  image: data.rows.filter((row) => !row.gallery_urls?.length).length,
  location: data.rows.filter((row) => !row.address || !row.city).length,
};
await writeFile(PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify(data.summary, null, 2));
