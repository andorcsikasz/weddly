#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const PATH = resolve(process.argv[2] || "docs/spain-todoenlaces-candidates-2026-08-19.json");
const USER_AGENT = "WeddlyResearchBot/1.0 (+https://tryweddly.com)";
const data = JSON.parse(await readFile(PATH, "utf8"));

const preferredSources =
  /alimentacion|alojamiento|belleza|hosteleria-y-restauracion|moda-y-complementos|ocio-y-cultura|publicidad-y-marketing|comercio-y-tiendas/;
const negative =
  /abogad|asesor|jur[ií]dic|construcci[oó]n|reforma|fontaner|electric|cerrajer|taller|industrial|ingenier|mascota|veterin|dental|farmacia|inmobiliaria|mudanza/i;
const positive =
  /boda|novi|nupcial|wedding|evento|banquete|fiesta|fot[oó]graf|v[ií]deo|flor|decor|mobiliario|catering|pasteler|reposter|panader|tarta|restaurante|cafeter|bar|vino|bodega|hotel|hostal|alojamiento|casa rural|peluquer|maquill|belleza|est[eé]tica|joyer|vestido|ropa|moda|m[uú]sica|orquesta|dj|espect[aá]culo|animaci[oó]n|imprenta|papeler|diseñ|regalo|artesan/i;

function phoneFrom(html) {
  const candidates = [];
  for (const match of html.matchAll(/href=["']tel:([^"']+)/gi))
    candidates.push(decodeURIComponent(match[1]));
  for (const match of html.matchAll(/(?:\+34|0034)[\s().-]*(?:[6789](?:[\s().-]*\d){8})/g))
    candidates.push(match[0]);
  for (const match of html.matchAll(/(?<!\d)(?:[6789](?:[\s().-]*\d){8})(?!\d)/g))
    candidates.push(match[0]);
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "").replace(/^0034/, "34");
    const local = digits.startsWith("34") && digits.length === 11 ? digits.slice(2) : digits;
    if (local.length === 9 && /^[6789]/.test(local))
      return `+34 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
  }
  return "";
}

async function fetchHtml(url) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("html")) return "";
      return (await response.text()).slice(0, 2_000_000);
    } catch {
      if (attempt === 3) return "";
      await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500));
    }
  }
}

const targets = data.rows
  .map((row, index) => ({ row, index }))
  .filter(
    ({ row }) =>
      row.name &&
      row.website &&
      row.contact_email &&
      !row.contact_phone &&
      row.image_url &&
      row.address &&
      row.city &&
      row.country === "ES" &&
      preferredSources.test(row.source_category) &&
      !negative.test(`${row.name} ${row.category_detail}`),
  )
  .sort(
    (a, b) =>
      Number(positive.test(`${b.row.name} ${b.row.category_detail}`)) -
      Number(positive.test(`${a.row.name} ${a.row.category_detail}`)),
  )
  .slice(0, 260);

let cursor = 0;
let recovered = 0;
const workers = Array.from({ length: 10 }, async () => {
  while (cursor < targets.length) {
    const target = targets[cursor];
    cursor += 1;
    const html = await fetchHtml(target.row.website);
    const phone = phoneFrom(html);
    if (phone) {
      data.rows[target.index].contact_phone = phone;
      data.rows[target.index].phone_source_url = target.row.website;
      recovered += 1;
    }
    if (cursor % 50 === 0 || cursor === targets.length)
      process.stderr.write(`official sites: ${cursor}/${targets.length}; phones: ${recovered}\n`);
  }
});
await Promise.all(workers);

data.summary.enriched_at = new Date().toISOString();
data.summary.official_sites_checked_for_phone = targets.length;
data.summary.official_phone_recoveries = recovered;
data.summary.fully_complete = data.rows.filter(
  (row) =>
    row.name &&
    row.website &&
    row.contact_email &&
    row.contact_phone &&
    row.image_url &&
    row.address &&
    row.city &&
    row.country === "ES",
).length;
data.summary.missing.phone = data.rows.filter((row) => !row.contact_phone).length;
await writeFile(PATH, `${JSON.stringify(data, null, 2)}\n`);
console.log(
  JSON.stringify(
    { checked: targets.length, recovered, fully_complete: data.summary.fully_complete },
    null,
    2,
  ),
);
