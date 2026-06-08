// Re-scrape the Konzinfo (Hungarian MFA Consular Service) country/region link
// list and regenerate shared/konzinfo_country_links.json.
//
// Why a script: the Konzinfo content is NOT permanent — countries get added,
// renamed, or re-keyed. The link list must be refreshed periodically (run this
// every few months, or wire it into a cron) so the honeymoon Travel Safety block
// keeps pointing at live official pages. The destination→country map
// (shared/konzinfo_destination_map.json) is hand-curated config and is NOT
// touched here.
//
// How it works: every per-country page embeds the FULL country selector — a list
// of `<a class="dropdown-item use-ajax" ... aria-label="{HU name}" href=".../entity.node.canonical?route_params[node]={id}">`.
// We read that list off one country page, then resolve each Drupal node id to its
// canonical `/utazasi-tanacsok-orszagonkent/{slug}` alias via the same ajax
// endpoint the site uses. Links are never hand-guessed — only what the source
// returns is stored.
//
// Usage:
//   bun backend/scripts/scrape_konzinfo.ts
//
// Writes shared/konzinfo_country_links.json (sorted by Hungarian name) and
// prints a short diff summary vs. the previous file.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KonzinfoCountry } from "@shared/konzinfo";
import { KONZINFO_COUNTRIES, KONZINFO_INDEX_URL } from "@shared/konzinfo";

// Any live country page exposes the complete selector. Singapore is the seed the
// feature was built from; if it ever 404s, swap for another known slug.
const SEED_PAGE = `${KONZINFO_INDEX_URL}/szingapur`;
const OUT_PATH = resolve(import.meta.dir, "../../shared/konzinfo_country_links.json");
const CONCURRENCY = 8;

const UA = { "User-Agent": "WeddlyHoneymoonBot/1.0 (+https://weddly.hu)" };

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

/** Pull (node id, Hungarian name) for every option in the selector. */
function parseSelector(html: string): Array<{ nodeId: number; name: string }> {
  const out: Array<{ nodeId: number; name: string }> = [];
  const seen = new Set<number>();
  const re =
    /<a class="dropdown-item use-ajax"[^>]*route_params%5Bnode%5D=(\d+)[^>]*aria-label="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    const nodeId = Number(m[1]);
    const name = decodeEntities(m[2] ?? "");
    if (!seen.has(nodeId) && name) {
      seen.add(nodeId);
      out.push({ nodeId, name });
    }
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** Resolve one node id to its canonical advisory slug via the site's ajax link
 *  endpoint (returns a Drupal ajax command carrying the canonical href). */
async function resolveSlug(nodeId: number): Promise<string | null> {
  const url = `https://konzinfo.mfa.gov.hu/ajax-get-continue-link/entity.node.canonical?route_params%5Bnode%5D=${nodeId}&use_ajax=`;
  try {
    const body = await getText(url);
    const m = /utazasi-tanacsok-orszagonkent\\?\/([a-z0-9-]+)/.exec(body);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item !== undefined) out[idx] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  console.log(`[konzinfo] reading selector from ${SEED_PAGE}`);
  const options = parseSelector(await getText(SEED_PAGE));
  console.log(`[konzinfo] found ${options.length} countries/regions; resolving slugs…`);

  const resolved = await mapLimit(options, CONCURRENCY, async (o) => ({
    ...o,
    slug: await resolveSlug(o.nodeId),
  }));

  const missing = resolved.filter((r) => !r.slug);
  if (missing.length) {
    console.warn(`[konzinfo] ${missing.length} unresolved:`, missing.map((m) => m.name).join(", "));
  }

  const entries: KonzinfoCountry[] = resolved
    .filter((r): r is typeof r & { slug: string } => Boolean(r.slug))
    .map((r) => ({
      country_hu: r.name,
      slug: r.slug,
      konzinfo_url: `${KONZINFO_INDEX_URL}/${r.slug}`,
      node_id: r.nodeId,
    }))
    .sort((a, b) => a.country_hu.localeCompare(b.country_hu, "hu"));

  const prev = new Set(KONZINFO_COUNTRIES.map((c) => c.slug));
  const next = new Set(entries.map((c) => c.slug));
  const added = entries.filter((c) => !prev.has(c.slug)).map((c) => c.country_hu);
  const removed = KONZINFO_COUNTRIES.filter((c) => !next.has(c.slug)).map((c) => c.country_hu);

  writeFileSync(OUT_PATH, `${JSON.stringify(entries, null, 2)}\n`, "utf-8");
  console.log(`[konzinfo] wrote ${entries.length} entries to ${OUT_PATH}`);
  if (added.length) console.log(`[konzinfo] added: ${added.join(", ")}`);
  if (removed.length) console.log(`[konzinfo] removed: ${removed.join(", ")}`);
  if (!added.length && !removed.length) console.log("[konzinfo] no membership changes");
}

main().catch((err) => {
  console.error("[konzinfo] scrape failed:", err);
  process.exit(1);
});
