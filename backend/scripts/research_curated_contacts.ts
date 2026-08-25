// Research missing contact details for curated directory entries from their
// own public websites. This is deliberately a read-only researcher: it emits
// JSON to stdout and never touches the database or suppliers_data files.
//
// Usage:
//   bun backend/scripts/research_curated_contacts.ts
//   bun backend/scripts/research_curated_contacts.ts --ids=id-one,id-two
//   bun backend/scripts/research_curated_contacts.ts --limit=25
//   bun backend/scripts/research_curated_contacts.ts --output=research.json
//
// Every accepted value carries the exact page it came from. Only first-party
// websites are crawled; directory/social/profile hosts are skipped because an
// email on those pages commonly belongs to the platform rather than the vendor.

import { DIRECTORY } from "../src/domain/suppliers_data";

const CONCURRENCY = 8;
const TIMEOUT_MS = 12_000;
const MAX_HTML_BYTES = 1_500_000;

const PLATFORM_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
  "bridestory.com",
  "weddingwire.com",
  "theknot.com",
  "eskuvoihelyszinkereso.hu",
  "eskuvohelyszin.hu",
  "szallas.hu",
  "booking.com",
  "tripadvisor.com",
  "gigheaven.com",
  "topeskuvohelyszinek.hu",
  "kastelyok.com",
  "nagyvofely.hu",
  "visitrijeka.hr",
  "biznes-top.pl",
  "gallery.photo",
];

const TECHNICAL_EMAIL_HOSTS = [
  "sentry.io",
  "sentry-cdn.com",
  "bugsnag.com",
  "rollbar.com",
  "example.com",
  "wixpress.com",
  "squarespace.com",
  "vigbo.com",
  "interword.hu",
  "1marketing.hu",
  "swstudio.hu",
];

const CONTACT_HINTS = [
  "contact",
  "kontakt",
  "kapcsolat",
  "elerhetoseg",
  "elérhetőség",
  "impressum",
  "impresszum",
  "contatti",
  "contacto",
  "contactos",
  "kontaktai",
  "kontaktirajte",
  "kontaktiraj",
  "o-nama",
  "about/contact",
  "reservation",
  "rendezveny",
  "rendezvény",
  "event",
  "wedding",
  "eskuvo",
  "esküvő",
];

interface SourcedValue {
  value: string;
  source_url: string;
  evidence: "mailto" | "tel" | "json_ld" | "visible_text" | "cloudflare";
}

interface ResearchResult {
  id: string;
  name: string;
  website: string;
  contact_email: SourcedValue | null;
  contact_phone: SourcedValue | null;
  address: SourcedValue | null;
  pages_checked: string[];
  error: string | null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function hostMatches(host: string, candidates: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return candidates.some((candidate) => h === candidate || h.endsWith(`.${candidate}`));
}

function normalizeEmail(raw: string): string | null {
  let value = decodeEntities(raw)
    .replace(/^mailto:/i, "")
    .split(/[?&#]/, 1)[0]
    ?.trim()
    .toLowerCase();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the undecoded value; the syntax gate below still protects output.
  }
  value = value.replace(/[),.;:]+$/, "");
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value)) {
    return null;
  }
  const [local = "", host = ""] = value.split("@");
  if (
    local.includes("noreply") ||
    local.includes("no-reply") ||
    local.includes("donotreply") ||
    /^(privacy|gdpr|adatvedelem|webmaster)$/.test(local) ||
    local === "sentry" ||
    /^[0-9a-f]{24,}$/i.test(local) ||
    hostMatches(host, TECHNICAL_EMAIL_HOSTS)
  ) {
    return null;
  }
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(value)) return null;
  return value;
}

function normalizePhone(raw: string): string | null {
  let value = decodeEntities(raw).replace(/^tel:/i, "").trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the undecoded value.
  }
  value = value
    .replace(/\s+/g, " ")
    .replace(/[.;,]+$/, "")
    .trim();
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (/^(19|20)\d{6}$/.test(digits)) return null;
  return value;
}

function textOnly(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
}

function emailCandidates(html: string, sourceUrl: string): SourcedValue[] {
  const found: SourcedValue[] = [];
  const seen = new Set<string>();
  const add = (raw: string, evidence: SourcedValue["evidence"]) => {
    const value = normalizeEmail(raw);
    if (value && !seen.has(value)) {
      seen.add(value);
      found.push({ value, source_url: sourceUrl, evidence });
    }
  };
  for (const match of html.matchAll(/href\s*=\s*["']mailto:([^"']+)["']/gi)) {
    if (match[1]) add(match[1], "mailto");
  }
  // Cloudflare Email Address Obfuscation stores one XOR key byte followed by
  // the encrypted address in hex. Decoding it is deterministic and preserves
  // the same first-party evidence as a visible mailto link.
  for (const match of html.matchAll(/data-cfemail=["']([0-9a-f]+)["']/gi)) {
    const encoded = match[1];
    if (!encoded || encoded.length < 4 || encoded.length % 2 !== 0) continue;
    const key = Number.parseInt(encoded.slice(0, 2), 16);
    let decoded = "";
    for (let index = 2; index < encoded.length; index += 2) {
      decoded += String.fromCodePoint(Number.parseInt(encoded.slice(index, index + 2), 16) ^ key);
    }
    add(decoded, "cloudflare");
  }
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (!match[1]) continue;
    try {
      const root = JSON.parse(decodeEntities(match[1])) as unknown;
      const visit = (node: unknown) => {
        if (Array.isArray(node)) {
          for (const child of node) visit(child);
          return;
        }
        if (!node || typeof node !== "object") return;
        const item = node as Record<string, unknown>;
        if (typeof item.email === "string") add(item.email, "json_ld");
        for (const child of Object.values(item)) visit(child);
      };
      visit(root);
    } catch {
      // Broken JSON-LD is common; other extraction paths still apply.
    }
  }
  const visible = textOnly(html)
    .replace(/\s*(?:\[at\]|\(at\)| at )\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)| dot )\s*/gi, ".");
  for (const match of visible.matchAll(
    /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi,
  )) {
    if (match[0]) add(match[0], "visible_text");
  }
  return found;
}

function phoneCandidates(html: string, sourceUrl: string): SourcedValue[] {
  const found: SourcedValue[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']tel:([^"']+)["']/gi)) {
    const value = match[1] ? normalizePhone(match[1]) : null;
    if (value && !seen.has(value)) {
      seen.add(value);
      found.push({ value, source_url: sourceUrl, evidence: "tel" });
    }
  }
  return found;
}

function structuredAddresses(html: string, sourceUrl: string): SourcedValue[] {
  const values: SourcedValue[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    if (!match[1]) continue;
    try {
      const root = JSON.parse(decodeEntities(match[1])) as unknown;
      const visit = (node: unknown) => {
        if (Array.isArray(node)) {
          for (const child of node) visit(child);
          return;
        }
        if (!node || typeof node !== "object") return;
        const item = node as Record<string, unknown>;
        const address = item.address;
        if (address && typeof address === "object") {
          const a = address as Record<string, unknown>;
          const parts = [
            a.streetAddress,
            a.postalCode,
            a.addressLocality,
            a.addressRegion,
            a.addressCountry,
          ]
            .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
            .map((part) => part.trim());
          const value = [...new Set(parts)].join(", ");
          if (value.length >= 8 && !values.some((entry) => entry.value === value)) {
            values.push({ value, source_url: sourceUrl, evidence: "json_ld" });
          }
        } else if (typeof address === "string" && address.trim().length >= 8) {
          const value = address.trim().replace(/\s+/g, " ");
          if (!values.some((entry) => entry.value === value)) {
            values.push({ value, source_url: sourceUrl, evidence: "json_ld" });
          }
        }
        for (const child of Object.values(item)) visit(child);
      };
      visit(root);
    } catch {
      // Invalid JSON-LD is common and is not evidence of a failed page.
    }
  }
  return values;
}

function emailScore(candidate: SourcedValue, officialHost: string): number {
  const [local = "", host = ""] = candidate.value.split("@");
  let score = candidate.evidence === "mailto" ? 40 : 20;
  const cleanOfficial = officialHost.replace(/^www\./, "");
  if (host === cleanOfficial || host.endsWith(`.${cleanOfficial}`)) score += 50;
  if (
    /^(info|hello|contact|office|events?|wedding|weddings|sales|booking|reservation|rendezveny|kapcsolat)/.test(
      local,
    )
  ) {
    score += 15;
  }
  if (/^(privacy|gdpr|adatvedelem|webmaster|support|marketing|career|jobs)/.test(local))
    score -= 25;
  return score;
}

function contactLinks(html: string, pageUrl: URL): URL[] {
  const scored: Array<{ url: URL; score: number }> = [];
  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    if (!match[1]) continue;
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.hostname !== pageUrl.hostname) continue;
    const haystack = `${url.pathname} ${textOnly(match[2] ?? "")}`.toLowerCase();
    let score = 0;
    for (const hint of CONTACT_HINTS) if (haystack.includes(hint)) score += 1;
    if (score > 0) scored.push({ url, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .filter(
      (entry, index, all) => all.findIndex((other) => other.url.href === entry.url.href) === index,
    )
    .slice(0, 3)
    .map((entry) => entry.url);
}

async function fetchHtml(rawUrl: string): Promise<{ html: string; url: URL }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "WeddlyResearchBot/1.0 (+https://www.tryweddly.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      throw new Error(`non-HTML ${contentType || "response"}`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) throw new Error("HTML response too large");
    return { html: new TextDecoder().decode(buffer), url: new URL(response.url) };
  } finally {
    clearTimeout(timer);
  }
}

async function research(entry: (typeof DIRECTORY)[number]): Promise<ResearchResult> {
  const result: ResearchResult = {
    id: entry.id,
    name: entry.name,
    website: entry.website,
    contact_email: null,
    contact_phone: null,
    address: null,
    pages_checked: [],
    error: null,
  };
  let initial: URL;
  try {
    initial = new URL(entry.website);
  } catch {
    result.error = "invalid website URL";
    return result;
  }
  if (hostMatches(initial.hostname, PLATFORM_HOSTS)) {
    result.error = "platform/aggregator website skipped";
    return result;
  }

  try {
    const home = await fetchHtml(initial.href);
    const pages = [home];
    for (const link of contactLinks(home.html, home.url)) {
      try {
        pages.push(await fetchHtml(link.href));
      } catch {
        // One broken contact link must not discard evidence from other pages.
      }
    }
    const emails: SourcedValue[] = [];
    const phones: SourcedValue[] = [];
    const addresses: SourcedValue[] = [];
    for (const page of pages) {
      result.pages_checked.push(page.url.href);
      emails.push(...emailCandidates(page.html, page.url.href));
      phones.push(...phoneCandidates(page.html, page.url.href));
      addresses.push(...structuredAddresses(page.html, page.url.href));
    }
    result.contact_email =
      emails.sort(
        (a, b) => emailScore(b, home.url.hostname) - emailScore(a, home.url.hostname),
      )[0] ?? null;
    result.contact_phone = phones[0] ?? null;
    result.address = addresses[0] ?? null;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const item = items[index];
      if (item !== undefined) output[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

const idsArg = process.argv.find((arg) => arg.startsWith("--ids="));
const requestedIds = new Set(
  (idsArg?.slice("--ids=".length) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg
  ? Number.parseInt(limitArg.slice("--limit=".length), 10)
  : Number.POSITIVE_INFINITY;

const targets = DIRECTORY.filter(
  (entry) =>
    !entry.contact_email &&
    Boolean(entry.website) &&
    (requestedIds.size === 0 || requestedIds.has(entry.id)),
).slice(0, Number.isFinite(limit) && limit >= 0 ? limit : undefined);

const results = await mapLimit(targets, CONCURRENCY, research);
const report = {
  researched_at: new Date().toISOString(),
  target_count: targets.length,
  found_email_count: results.filter((result) => result.contact_email).length,
  found_phone_count: results.filter((result) => result.contact_phone).length,
  found_address_count: results.filter((result) => result.address).length,
  results,
};
const json = `${JSON.stringify(report, null, 2)}\n`;
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg?.slice("--output=".length).trim();
if (outputPath) {
  await Bun.write(outputPath, json);
  console.log(
    JSON.stringify({
      output: outputPath,
      target_count: report.target_count,
      found_email_count: report.found_email_count,
      found_phone_count: report.found_phone_count,
      found_address_count: report.found_address_count,
    }),
  );
} else {
  console.log(json);
}
