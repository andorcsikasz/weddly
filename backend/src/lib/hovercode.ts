// Hovercode (https://hovercode.com/api/) dynamic QR codes with scan tracking.
// A dynamic code encodes a Hovercode short link, so where it lands can change
// after printing. Configured only when HOVERCODE_API_TOKEN and
// HOVERCODE_WORKSPACE_ID are set — same "configured?" gate as DeepL / Stripe:
// unset, the feature reports itself unavailable and the UI hides it.
// HOVERCODE_FAKE=1 answers from an in-process stub so the E2E suite never
// calls the network (mirrors DEEPL_FAKE). The token never leaves the server.

import { log } from "./logger";

const BASE = "https://hovercode.com/api/v2";
const TIMEOUT_MS = 10_000;
/** Scan counts are cached this long so page views don't spend the rate limit
 *  (120 reads a minute per token). */
const SCANS_TTL_MS = 5 * 60_000;

function token(): string | null {
  const t = process.env.HOVERCODE_API_TOKEN;
  return t && t.length > 0 ? t : null;
}
function workspace(): string | null {
  const w = process.env.HOVERCODE_WORKSPACE_ID;
  return w && w.length > 0 ? w : null;
}
function fakeMode(): boolean {
  return process.env.HOVERCODE_FAKE === "1";
}

export function hovercodeConfigured(): boolean {
  return token() !== null && workspace() !== null;
}

export class HovercodeError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Hovercode ${status}: ${detail}`);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Token ${token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 300);
    log.warn("hovercode.request_failed", { method, path, status: r.status, detail });
    throw new HovercodeError(r.status, detail);
  }
  return (await r.json()) as T;
}

/** Deterministic stand-in for tests: codes live in memory. */
export const _fakeHovercode = {
  created: 0,
  targets: new Map<string, string>(),
  scans: 3,
  reset() {
    this.created = 0;
    this.targets.clear();
  },
};

/** Create a dynamic Link code. Every call makes a new code that counts toward
 *  the Hovercode plan, so callers create once and store the id. */
export async function createDynamicQr(input: {
  url: string;
  name: string;
}): Promise<{ id: string; shortlinkUrl: string }> {
  if (fakeMode()) {
    const id = `fake-${++_fakeHovercode.created}`;
    _fakeHovercode.targets.set(id, input.url);
    return { id, shortlinkUrl: `https://qrr.to/${id}` };
  }
  const domain = process.env.HOVERCODE_DOMAIN;
  const r = await call<{ id: string; shortlink_url: string }>("POST", "/hovercode/create/", {
    workspace: workspace(),
    qr_type: "Link",
    qr_data: input.url,
    dynamic: true,
    display_name: input.name.slice(0, 100),
    error_correction: "H",
    ...(domain ? { domain } : {}),
  });
  return { id: r.id, shortlinkUrl: r.shortlink_url };
}

/** Point an existing dynamic code at a new URL. Printed copies follow. */
export async function retargetQr(id: string, url: string): Promise<void> {
  if (fakeMode()) {
    _fakeHovercode.targets.set(id, url);
    return;
  }
  await call("PATCH", `/hovercode/${encodeURIComponent(id)}/update/`, { qr_data: url });
}

const scansCache = new Map<string, { at: number; total: number }>();

/** Total scans of one code over the last `days` days. */
export async function qrScans(id: string, days = 30): Promise<number> {
  if (fakeMode()) return _fakeHovercode.scans;
  const key = `${id}:${days}`;
  const hit = scansCache.get(key);
  if (hit && Date.now() - hit.at < SCANS_TTL_MS) return hit.total;
  const r = await call<{ total_scans: number }>(
    "GET",
    `/hovercode/${encodeURIComponent(id)}/analytics/?days=${days}`,
  );
  const total = r.total_scans ?? 0;
  scansCache.set(key, { at: Date.now(), total });
  return total;
}

/** Print-ready image URLs: a high-resolution PNG and a vector SVG. */
export async function qrDownloads(id: string): Promise<{ png: string; svg: string }> {
  if (fakeMode())
    return { png: `https://cdn.example/${id}.png`, svg: `https://cdn.example/${id}.svg` };
  const r = await call<{ png_url: string; svg_url: string }>(
    "GET",
    `/hovercode/${encodeURIComponent(id)}/download/`,
  );
  return { png: r.png_url, svg: r.svg_url };
}
