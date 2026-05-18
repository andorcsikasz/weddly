// 500 concurrent users, per-endpoint latency histograms.
//
// Goal: surface UX-freeze candidates. UI thresholds we treat as signals:
//   p50  > 200 ms → snappy → sluggish
//   p95  > 500 ms → "is the page broken?" zone
//   p95  > 1000 ms → freeze zone
//   p99  > 2000 ms → unbounded; users abandon
// Anything 5xx → hard error.
//
// Path params (/api/budget/lines/123) get normalised to /:id so they
// aggregate in the histogram.
//
// Run: bun run backend/scripts/loadtest_500.ts

import "../tests/setup";

import { PRIVACY_VERSION } from "@shared/legal";
import { db } from "../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;
const TARGET_USERS = 500;
const PERSONAS_PER_BUCKET = TARGET_USERS / 5;

interface Sample {
  ms: number;
  status: number;
}

const histogram = new Map<string, Sample[]>();

/** Collapse numeric / token-shaped path segments to ":id" so /api/guests/123
 *  and /api/guests/456 land in the same bucket. Hand-built (no regex package
 *  deps) — fast enough for 6k+ calls per run. */
function normalizePath(path: string): string {
  const pure = path.split("?")[0] ?? path;
  const parts = pure.split("/").map((seg) => {
    if (seg === "") return seg;
    // Pure number → :id
    if (/^\d+$/.test(seg)) return ":id";
    // Long opaque token (verify, invite, etc.) — 24+ hex/base64 chars
    if (/^[a-f0-9]{24,}$/i.test(seg)) return ":token";
    if (/^[A-Za-z0-9_-]{32,}$/.test(seg)) return ":token";
    return seg;
  });
  return parts.join("/");
}

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; data: T; ms: number }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-client-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  const key = `${method} ${normalizePath(path)}`;
  const list = histogram.get(key) ?? [];
  list.push({ ms, status: res.status });
  histogram.set(key, list);
  return { status: res.status, data: data as T, ms };
}

async function verifyEmail(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const row = db
    .prepare(
      "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
    )
    .get(normalized) as { token: string } | undefined;
  if (!row) throw new Error(`no verification token for ${email}`);
  await req("POST", `/api/auth/verify/${row.token}`, {});
}

// ──────────────────────────────────────────────────────────────────────
// Persona flows — 5 buckets × 100 users each = 500.
// Each runs a slim realistic flow (register → onboard → some entity work →
// list-back). Goal is per-endpoint coverage, not exhaustive coverage.
// ──────────────────────────────────────────────────────────────────────

type Flow = (index: number) => Promise<void>;

async function registerOnboard(prefix: string, index: number, opts?: { guests?: number }) {
  const email = `lt500-${prefix}-${index}@weddly.test`;
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "loadtest-pw-123",
    full_name: "LoadTest",
    privacy_version: PRIVACY_VERSION,
  });
  if (reg.status !== 201) throw new Error(`register ${reg.status}`);
  const token = reg.data.token;
  await verifyEmail(email);
  const ob = await req<{ couple: { id: number } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "LT500",
      wedding_date: "2027-06-12",
      target_guest_count: opts?.guests ?? 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: [],
    },
    token,
  );
  if (ob.status !== 201) throw new Error(`onboard ${ob.status}`);
  return { token, coupleId: ob.data.couple.id };
}

const flows: Record<string, Flow> = {
  // 100 users — fast smoke flow (register + onboard + list things)
  smoke: async (i) => {
    const { token } = await registerOnboard("sm", i);
    await req("GET", "/api/auth/me", undefined, token);
    await req("GET", "/api/couples/current", undefined, token);
    await req("GET", "/api/guests", undefined, token);
    await req("GET", "/api/budget/lines", undefined, token);
    await req("GET", "/api/schedule", undefined, token);
  },

  // 100 users — guest-heavy: bulk add 40 + filter
  guestsHeavy: async (i) => {
    const { token } = await registerOnboard("gh", i, { guests: 60 });
    const bulk = await req(
      "POST",
      "/api/guests/bulk",
      {
        guests: Array.from({ length: 40 }, (_, k) => ({
          full_name: `Bulk ${i}-${k}`,
          group_tag: k % 2 === 0 ? "her_family" : "his_family",
        })),
      },
      token,
    );
    if (bulk.status !== 201) throw new Error(`bulk ${bulk.status}`);
    await req("GET", "/api/guests?group_tag=her_family", undefined, token);
    await req("GET", "/api/guests?group_tag=his_family", undefined, token);
    await req("GET", "/api/guests/csv", undefined, token);
  },

  // 100 users — budget churn: patch 6 lines + create 2 snapshots
  budgetChurn: async (i) => {
    const { token } = await registerOnboard("bc", i);
    const lines = await req<{
      lines: Array<{ id: number; category: string; label: string; planned_huf: number }>;
    }>("GET", "/api/budget/lines", undefined, token);
    if (lines.status !== 200) throw new Error(`budget list ${lines.status}`);
    for (const line of lines.data.lines.slice(0, 6)) {
      await req(
        "PATCH",
        `/api/budget/lines/${line.id}`,
        {
          category: line.category,
          label: line.label,
          planned_huf: line.planned_huf,
          actual_huf: Math.floor(line.planned_huf * 0.55),
        },
        token,
      );
    }
    await req("POST", "/api/budget/snapshots", { name: `Snap-A-${i}` }, token);
    await req("POST", "/api/budget/snapshots", { name: `Snap-B-${i}` }, token);
  },

  // 100 users — seating: 6 tables, list plan
  seatingHeavy: async (i) => {
    const { token } = await registerOnboard("se", i);
    // Pre-seed 12 guests so seating has something to assign.
    await req(
      "POST",
      "/api/guests/bulk",
      {
        guests: Array.from({ length: 12 }, (_, k) => ({ full_name: `Seat ${i}-${k}` })),
      },
      token,
    );
    for (let t = 0; t < 6; t++) {
      await req(
        "POST",
        "/api/seating/tables",
        {
          label: `T${t}`,
          shape: "round",
          seats: 8,
          x_mm: 100 + (t % 3) * 2500,
          y_mm: 100 + Math.floor(t / 3) * 2500,
        },
        token,
      );
    }
    await req("GET", "/api/seating/plan", undefined, token);
    await req("GET", "/api/seating/conflicts", undefined, token);
  },

  // 100 users — read-only browsing: suppliers + categories + picks
  browse: async (i) => {
    const { token } = await registerOnboard("br", i);
    await req("GET", "/api/suppliers", undefined, token);
    await req("GET", "/api/supplier-categories", undefined, token);
    await req("GET", "/api/picks", undefined, token);
    await req("PUT", "/api/picks/venue", { supplier_id: "normafa-rendezvenyhaz" }, token);
    await req("GET", "/api/picks", undefined, token);
  },
};

interface RunResult {
  bucket: string;
  ok: boolean;
  error?: string;
}

async function runFlow(bucket: string, f: Flow, i: number): Promise<RunResult> {
  try {
    await f(i);
    return { bucket, ok: true };
  } catch (e) {
    return { bucket, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function fmt(n: number): string {
  if (n >= 1000) return n.toFixed(0);
  return n.toFixed(0);
}

async function main() {
  const tasks: Promise<RunResult>[] = [];
  for (const [bucket, flow] of Object.entries(flows)) {
    for (let i = 0; i < PERSONAS_PER_BUCKET; i++) {
      tasks.push(runFlow(bucket, flow, i));
    }
  }
  console.log(
    `\nLaunching ${tasks.length} users (${Object.keys(flows).length} flows × ${PERSONAS_PER_BUCKET}) in parallel…\n`,
  );
  const t0 = performance.now();
  const results = await Promise.all(tasks);
  const wallMs = performance.now() - t0;

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  const totalCalls = Array.from(histogram.values()).reduce((s, v) => s + v.length, 0);
  console.log(`Cohort done in ${(wallMs / 1000).toFixed(2)} s`);
  console.log(`  users:     ${ok} ok, ${fail} crashed`);
  console.log(`  api calls: ${totalCalls}`);
  console.log(`  endpoints: ${histogram.size}\n`);

  // Per-endpoint stats
  interface Row {
    endpoint: string;
    n: number;
    err: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    flag: string;
  }
  const rows: Row[] = [];
  for (const [endpoint, samples] of histogram) {
    const errs = samples.filter((s) => s.status >= 400).length;
    const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
    const p50 = quantile(ms, 0.5);
    const p95 = quantile(ms, 0.95);
    const p99 = quantile(ms, 0.99);
    const max = ms[ms.length - 1] ?? 0;
    let flag = "";
    if (errs > 0) flag = "ERR";
    else if (p95 >= 1000) flag = "FREEZE";
    else if (p95 >= 500) flag = "SLOW";
    rows.push({ endpoint, n: samples.length, err: errs, p50, p95, p99, max, flag });
  }
  rows.sort((a, b) => b.p95 - a.p95);

  console.log("endpoint".padEnd(46) + "n    err   p50   p95   p99   max  flag");
  console.log("─".repeat(92));
  for (const r of rows) {
    console.log(
      r.endpoint.padEnd(46).slice(0, 46) +
        `${String(r.n).padStart(4)}  ${String(r.err).padStart(3)}  ` +
        `${fmt(r.p50).padStart(4)}  ${fmt(r.p95).padStart(4)}  ${fmt(r.p99).padStart(4)}  ${fmt(r.max).padStart(4)}  ${r.flag}`,
    );
  }
  console.log("─".repeat(92));

  // UX-freeze summary
  const freezes = rows.filter((r) => r.flag === "FREEZE");
  const slow = rows.filter((r) => r.flag === "SLOW");
  const errs = rows.filter((r) => r.flag === "ERR");
  console.log(`\nUX assessment under ${ok}-user load (wall ${(wallMs / 1000).toFixed(2)}s):`);
  console.log(`  FREEZE candidates (p95 ≥ 1000ms): ${freezes.length}`);
  for (const r of freezes) {
    console.log(`    • ${r.endpoint}  — p95 ${fmt(r.p95)}ms, p99 ${fmt(r.p99)}ms, n=${r.n}`);
  }
  console.log(`  SLOW candidates (p95 500–999ms): ${slow.length}`);
  for (const r of slow) {
    console.log(`    • ${r.endpoint}  — p95 ${fmt(r.p95)}ms, n=${r.n}`);
  }
  console.log(`  ERR endpoints: ${errs.length}`);
  for (const r of errs) {
    console.log(`    • ${r.endpoint}  — ${r.err}/${r.n} 4xx/5xx`);
  }

  // Crashed flows
  if (fail > 0) {
    console.log(`\nCrashed flows (${fail}):`);
    const map = new Map<string, number>();
    for (const r of results.filter((r) => !r.ok)) {
      const key = `${r.bucket}: ${r.error}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    for (const [k, v] of Array.from(map.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${v}× ${k}`);
    }
  }
}

await main();
process.exit(0);
