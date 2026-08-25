#!/usr/bin/env node

// Enrich OSM wedding-adjacent businesses from their own public websites.
// The output keeps field-level provenance so a generated listing can always
// be audited back to OSM and the business's own contact page.

import { readFile, writeFile } from "node:fs/promises";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("usage: research_croatia_vendor_websites.mjs INPUT.json OUTPUT.json");
  process.exit(2);
}
const perCountryArg = process.argv.find((value) => value.startsWith("--per-country="));
const perCountry = perCountryArg
  ? Number.parseInt(perCountryArg.slice("--per-country=".length), 10)
  : Number.POSITIVE_INFINITY;
const countriesArg = process.argv.find((value) => value.startsWith("--countries="));
const requestedCountries = new Set(
  (countriesArg?.slice("--countries=".length) ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36";
const PAGE_LIMIT = 2_500_000;
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 18;

const fetchCache = new Map();

function normaliseUrl(raw) {
  if (!raw) return null;
  const first = raw.split(/[;,\s]+/).find((part) => /[A-Za-z0-9]/.test(part));
  if (!first) return null;
  const withScheme = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  try {
    const url = new URL(withScheme);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function safeDecodeUri(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function fetchHtml(url) {
  if (fetchCache.has(url)) return fetchCache.get(url);
  const pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !/html|xhtml/i.test(contentType)) {
        return { ok: false, status: response.status, url: response.url, html: "" };
      }
      const reader = response.body?.getReader();
      if (!reader) return { ok: false, status: response.status, url: response.url, html: "" };
      const chunks = [];
      let size = 0;
      while (size < PAGE_LIMIT) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
      if (size >= PAGE_LIMIT) await reader.cancel();
      const merged = new Uint8Array(Math.min(size, PAGE_LIMIT));
      let offset = 0;
      for (const chunk of chunks) {
        const part = chunk.subarray(0, Math.max(0, merged.length - offset));
        merged.set(part, offset);
        offset += part.length;
        if (offset >= merged.length) break;
      }
      return {
        ok: true,
        status: response.status,
        url: response.url,
        html: new TextDecoder().decode(merged),
      };
    } catch (error) {
      return { ok: false, status: 0, url, html: "", error: String(error) };
    } finally {
      clearTimeout(timer);
    }
  })();
  fetchCache.set(url, pending);
  return pending;
}

function stripMarkup(html) {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function cfEmail(hex) {
  try {
    const key = Number.parseInt(hex.slice(0, 2), 16);
    let value = "";
    for (let index = 2; index < hex.length; index += 2) {
      value += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16) ^ key);
    }
    return value;
  } catch {
    return null;
  }
}

function emailsFrom(html) {
  const values = [];
  for (const match of html.matchAll(/mailto:([^"'?#\s>]+)/gi)) {
    values.push(safeDecodeUri(match[1]));
  }
  for (const match of stripMarkup(html).matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    values.push(match[0]);
  }
  const deobfuscated = stripMarkup(html).replace(/\s*(?:\[at\]|\(at\)| at )\s*/gi, "@");
  for (const match of deobfuscated.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
    values.push(match[0]);
  }
  for (const match of html.matchAll(/data-cfemail=["']([a-f0-9]+)["']/gi)) {
    const decoded = cfEmail(match[1]);
    if (decoded) values.push(decoded);
  }
  return [...new Set(values.map((value) => value.trim().toLowerCase()))].filter(
    (value) =>
      !/example\.(?:com|org)|wixpress|sentry|domain|wordpress|schema\.org|email\.com/.test(value),
  );
}

function phonesFrom(html) {
  const values = [];
  for (const match of html.matchAll(/tel:([^"'?#\s>]+)/gi)) {
    values.push(safeDecodeUri(match[1]));
  }
  const text = stripMarkup(html);
  for (const match of text.matchAll(/(?:\+|00)385[\s()./-]*(?:\d[\s()./-]*){8,10}/g)) {
    values.push(match[0]);
  }
  for (const match of text.matchAll(
    /(?:^|\D)(0(?:1|2\d|3\d|4\d|5\d|9\d)[\s()./-]*(?:\d[\s()./-]*){6,8})(?=\D|$)/g,
  )) {
    values.push(match[1]);
  }
  return [...new Set(values.map((value) => value.replace(/\s+/g, " ").trim()))].filter(
    (value) => value.replace(/\D/g, "").length >= 10,
  );
}

function walkJson(value, visitor) {
  if (!value || typeof value !== "object") return;
  visitor(value);
  if (Array.isArray(value)) {
    for (const child of value) walkJson(child, visitor);
  } else {
    for (const child of Object.values(value)) walkJson(child, visitor);
  }
}

function structuredContacts(html) {
  const result = { emails: [], phones: [], addresses: [], images: [] };
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1]).replace(/^\s*<!--|-->\s*$/g, ""));
      walkJson(parsed, (node) => {
        if (typeof node.email === "string") result.emails.push(node.email.replace(/^mailto:/, ""));
        if (typeof node.telephone === "string") result.phones.push(node.telephone);
        const images = [node.image, node.photo, node.logo]
          .flat()
          .filter((item) => typeof item === "string");
        result.images.push(...images);
        if (node.address && typeof node.address === "object" && !Array.isArray(node.address)) {
          const street = node.address.streetAddress;
          const locality = node.address.addressLocality;
          const postcode = node.address.postalCode;
          const country =
            typeof node.address.addressCountry === "object"
              ? node.address.addressCountry.name
              : node.address.addressCountry;
          if (street && locality) {
            result.addresses.push({
              value: `${street}, ${[postcode, locality].filter(Boolean).join(" ")}${country ? `, ${country}` : ", Croatia"}`,
              city: locality,
            });
          }
        }
      });
    } catch {
      // Broken JSON-LD is common on old hotel sites; other extractors still run.
    }
  }
  return result;
}

function imageCandidates(html, pageUrl) {
  const structured = structuredContacts(html).images;
  const candidates = [...structured];
  for (const match of html.matchAll(
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+>/gi,
  )) {
    const value = match[0].match(/content=["']([^"']+)["']/i)?.[1];
    if (value) candidates.push(value);
  }
  for (const match of html.matchAll(
    /<(?:img|source)\b[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi,
  )) {
    candidates.push(match[1]);
  }
  for (const match of html.matchAll(
    /url\(["']?([^"')]+\.(?:avif|jpe?g|png|webp)[^"')]*)["']?\)/gi,
  )) {
    candidates.push(match[1]);
  }
  const output = [];
  for (const raw of candidates) {
    try {
      const value = new URL(decodeHtml(raw), pageUrl).href;
      if (/logo|favicon|icon|sprite|placeholder|avatar|badge|payment|loader|preload/i.test(value))
        continue;
      if (!/\.(?:avif|jpe?g|png|webp)(?:[?#]|$)/i.test(value) && !/\/assets\//i.test(value))
        continue;
      output.push(value);
    } catch {
      // Ignore malformed lazy-load values.
    }
  }
  return [...new Set(output)];
}

function contactLinks(html, pageUrl) {
  const scored = [];
  for (const match of html.matchAll(/<a\b[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), pageUrl);
      if (url.hostname !== new URL(pageUrl).hostname) continue;
      const clue = `${url.pathname} ${stripMarkup(match[2])}`.toLowerCase();
      let score = 0;
      if (/kontakt|contact|get-in-touch|reach-us/.test(clue)) score += 5;
      if (/impressum|imprint|legal|o-nama|about/.test(clue)) score += 3;
      if (!score) continue;
      url.hash = "";
      scored.push({ url: url.href, score });
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return [
    ...new Map(scored.sort((a, b) => b.score - a.score).map((item) => [item.url, item])).values(),
  ]
    .slice(0, 2)
    .map((item) => item.url);
}

function bestWebsiteEmail(values, website) {
  const host = new URL(website).hostname.replace(/^www\./, "");
  return (
    values.find((value) => value.split("@")[1]?.endsWith(host)) ||
    values.find((value) => !/noreply|no-reply|privacy|gdpr|webmaster/.test(value)) ||
    null
  );
}

function cleanPhone(value) {
  if (!value) return null;
  return value
    .replace(/^00385/, "+385")
    .replace(/\s+/g, " ")
    .trim();
}

function usableAddress(value) {
  return Boolean(value && /[A-Za-zÀ-ž]{3}/.test(value) && value.includes(","));
}

async function verifyImage(candidates) {
  for (const url of candidates.slice(0, 12)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "image/*" },
      });
      const type = response.headers.get("content-type") || "";
      const length = Number(response.headers.get("content-length") || 0);
      if (response.ok && /^image\//i.test(type) && (length === 0 || length >= 10_000)) {
        return response.url;
      }
      if (response.status === 403 || response.status === 405 || !/^image\//i.test(type)) {
        const getResponse = await fetch(url, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "user-agent": USER_AGENT,
            accept: "image/*",
            range: "bytes=0-16383",
          },
        });
        const getType = getResponse.headers.get("content-type") || "";
        if (getResponse.ok && /^image\//i.test(getType)) {
          await getResponse.body?.cancel();
          return getResponse.url;
        }
        await getResponse.body?.cancel();
      }
    } catch {
      // Try the next image.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function enrich(row) {
  const website = normaliseUrl(row.website);
  if (!website) return { ...row, accepted: false, error: "invalid website" };
  const hostname = new URL(website).hostname.replace(/^www\./, "");
  if (
    [
      "facebook.com",
      "instagram.com",
      "linkedin.com",
      "youtube.com",
      "tiktok.com",
      "booking.com",
      "tripadvisor.com",
      "eventbrite.com",
    ].some((platform) => hostname === platform || hostname.endsWith(`.${platform}`))
  ) {
    return { ...row, website, accepted: false, error: "platform website" };
  }
  const firstPage = await fetchHtml(website);
  if (!firstPage.ok) {
    return { ...row, website, accepted: false, error: `website HTTP ${firstPage.status}` };
  }
  const pages = [firstPage];
  for (const link of contactLinks(firstPage.html, firstPage.url)) {
    const page = await fetchHtml(link);
    if (page.ok) pages.push(page);
  }
  const emails = [];
  const phones = [];
  const addresses = [];
  const images = [];
  for (const page of pages) {
    const structured = structuredContacts(page.html);
    emails.push(...emailsFrom(page.html), ...structured.emails);
    phones.push(...phonesFrom(page.html), ...structured.phones);
    addresses.push(...structured.addresses);
    images.push(...imageCandidates(page.html, page.url));
  }
  if (row.image_hint) images.unshift(row.image_hint);
  const email = row.contact_email || bestWebsiteEmail([...new Set(emails)], firstPage.url);
  const phone = cleanPhone(row.contact_phone || phones[0]);
  const structuredAddress = addresses.find((item) => usableAddress(item.value));
  const address = row.address || structuredAddress?.value || null;
  const city = row.city || structuredAddress?.city || null;
  const image = await verifyImage(images);
  const accepted = Boolean(email && phone && usableAddress(address) && city && image);
  return {
    ...row,
    website: firstPage.url,
    contact_email: email,
    contact_phone: phone,
    address,
    city,
    gallery_urls: image ? [image] : [],
    pages_checked: pages.map((page) => page.url),
    accepted,
    missing: [
      !email && "email",
      !phone && "phone",
      !usableAddress(address) && "address",
      !city && "city",
      !image && "image",
    ].filter(Boolean),
  };
}

const parsedInput = JSON.parse(await readFile(inputPath, "utf8"));
let input = Array.isArray(parsedInput) ? parsedInput : parsedInput.candidates;
if (!Array.isArray(input)) throw new Error("input must be an array or contain a candidates array");
if (requestedCountries.size > 0) {
  input = input.filter((row) => requestedCountries.has(row.country));
}
if (Number.isFinite(perCountry)) {
  const grouped = new Map();
  for (const row of input) {
    const country = row.country || "unknown";
    const group = grouped.get(country) || [];
    group.push(row);
    grouped.set(country, group);
  }
  input = [...grouped.values()].flatMap((rows) =>
    rows
      .sort((a, b) => {
        const score = (row) =>
          (row.contact_email ? 4 : 0) + (row.contact_phone ? 3 : 0) + (row.image_hint ? 1 : 0);
        return score(b) - score(a) || a.name.localeCompare(b.name);
      })
      .slice(0, perCountry),
  );
}
const output = new Array(input.length);
let cursor = 0;
let completed = 0;
let accepted = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= input.length) return;
    output[index] = await enrich(input[index]);
    completed += 1;
    if (output[index].accepted) accepted += 1;
    if (completed % 50 === 0 || completed === input.length) {
      console.log(JSON.stringify({ completed, total: input.length, accepted }));
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
