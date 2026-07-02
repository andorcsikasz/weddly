// Shared HTTP layer for the company-lookup providers. Three jobs:
//
//   1. Timeout + error normalisation: providers get `{ status, body }` on an
//      upstream answer and `null` on any network-level failure.
//   2. A small in-memory TTL cache keyed by URL+body. The KVK open-data API
//      allows roughly one query per minute, so repeat lookups (double-click,
//      back-and-forth in onboarding) must not re-hit the upstream.
//   3. The COMPANY_LOOKUP_FAKE=1 escape hatch: the E2E suite pins it so every
//      provider runs against deterministic fixtures instead of the network
//      (same pattern as GOOGLE_TEST_BYPASS in lib/google_oauth.ts).

import { log as logger } from "../logger";
import { fakeLookupResponse } from "./fake";

const TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h, mirrors the serpapi cache
const CACHE_MAX_ENTRIES = 500;

interface UpstreamAnswer {
  status: number;
  body: unknown;
}

const cache = new Map<string, { at: number; answer: UpstreamAnswer }>();

function fakeMode(): boolean {
  return process.env.COMPANY_LOOKUP_FAKE === "1";
}

/** GET/POST an upstream registry endpoint. Returns the parsed JSON answer
 *  (any status, including 404) or `null` on network failure / timeout. */
export async function lookupJson(
  url: string,
  init?: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string },
): Promise<UpstreamAnswer | null> {
  const key = `${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.answer;

  let answer: UpstreamAnswer | null;
  if (fakeMode()) {
    answer = fakeLookupResponse(url, init?.body);
  } else {
    answer = await realFetch(url, init);
  }

  // Cache definitive answers (success + not-found). 5xx and network failures
  // stay uncached so the next attempt retries the upstream.
  if (answer && (answer.status < 500 || answer.status === 404)) {
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), answer });
  }
  return answer;
}

async function realFetch(
  url: string,
  init?: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string },
): Promise<UpstreamAnswer | null> {
  try {
    const r = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { accept: "application/json", ...init?.headers },
      body: init?.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // registries throttle via redirects; treat as failure
    });
    if (!r.ok && r.status !== 404) {
      logger.warn("company_lookup.upstream_status", { url: url.split("?")[0], status: r.status });
      return { status: r.status, body: null };
    }
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } catch (e) {
    logger.warn("company_lookup.upstream_throw", { url: url.split("?")[0], error: String(e) });
    return null;
  }
}
