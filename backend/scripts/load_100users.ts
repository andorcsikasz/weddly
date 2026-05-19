// Stand-alone load script: spins up the test server (via tests/setup) and
// runs 100 simulated users in parallel, each pursuing one of 10 different
// goals. Reports a summary table at the end. Not part of `bun test` — run
// with `bun run backend/scripts/load_100users.ts`.

import "../tests/setup";

import { PRIVACY_VERSION, TERMS_VERSION } from "@shared/legal";
import { db } from "../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

interface ReqOpts {
  token?: string;
}

interface ApiResult<T> {
  status: number;
  data: T;
}

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts: ReqOpts = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Per-call random IP so rate-limit buckets don't bleed across simulated users.
    "x-test-client-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  return { status: res.status, data: data as T };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function verifyEmail(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const row = db
    .prepare(
      "SELECT token FROM email_verification_tokens WHERE user_id = (SELECT id FROM users WHERE email = ?) ORDER BY id DESC LIMIT 1",
    )
    .get(normalized) as { token: string } | undefined;
  if (!row) throw new Error(`no verification token for ${email}`);
  const r = await req("POST", `/api/auth/verify/${row.token}`, {});
  if (r.status !== 200) throw new Error(`verify failed (${r.status}) for ${email}`);
}

async function register(email: string): Promise<string> {
  const r = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "loadtest-pw-123",
    full_name: "LoadTest",
    // Required since commit 5c06181 — bare register payloads 400 without it.
    privacy_version: PRIVACY_VERSION,
    terms_version: TERMS_VERSION,
  });
  if (r.status !== 201) throw new Error(`register failed (${r.status}) for ${email}`);
  return r.data.token;
}

async function onboard(token: string): Promise<number> {
  const r = await req<{ couple: { id: number } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: "Load A & B",
      wedding_date: "2027-06-12",
      target_guest_count: 80,
      budget_ceiling_huf: 5_000_000,
      style_tags: [],
    },
    { token },
  );
  if (r.status !== 201) throw new Error(`onboard failed (${r.status})`);
  return r.data.couple.id;
}

// ──────────────────────────────────────────────────────────────────────
// Goals — each must return cleanly or throw to mark a failure.
// ──────────────────────────────────────────────────────────────────────

type Goal = (i: number) => Promise<void>;

const goals: Record<string, Goal> = {
  "register-and-me": async (i) => {
    const email = `lt-rm-${i}@weddly.test`;
    const token = await register(email);
    const me = await req("GET", "/api/auth/me", undefined, { token });
    if (me.status !== 200) throw new Error(`me failed (${me.status})`);
  },

  "onboard-couple": async (i) => {
    const email = `lt-ob-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
  },

  "add-20-guests": async (i) => {
    const email = `lt-gu-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    for (let g = 0; g < 20; g++) {
      const r = await req("POST", "/api/guests", { full_name: `Guest ${i}-${g}` }, { token });
      if (r.status !== 201) throw new Error(`guest ${g} failed (${r.status})`);
    }
  },

  "budget-fan-out": async (i) => {
    const email = `lt-bu-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    const list = await req<{
      lines: { id: number; category: string; label: string; planned_huf: number }[];
    }>("GET", "/api/budget/lines", undefined, { token });
    if (list.status !== 200) throw new Error(`budget list failed (${list.status})`);
    // Patch the first 5 lines with actual spend.
    for (const line of list.data.lines.slice(0, 5)) {
      const r = await req(
        "PATCH",
        `/api/budget/lines/${line.id}`,
        {
          category: line.category,
          label: line.label,
          planned_huf: line.planned_huf,
          actual_huf: Math.floor(line.planned_huf * 0.7),
        },
        { token },
      );
      if (r.status !== 200) throw new Error(`patch line ${line.id} failed (${r.status})`);
    }
    const snap = await req("POST", "/api/budget/snapshots", { name: `Snap ${i}` }, { token });
    if (snap.status !== 201) throw new Error(`snapshot failed (${snap.status})`);
  },

  "schedule-day": async (i) => {
    const email = `lt-sc-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    const events = [
      { label: "Welcome", starts_at_minutes: 540, location: "Garden" },
      { label: "Ceremony", starts_at_minutes: 600, location: "Chapel" },
      { label: "Photos", starts_at_minutes: 660, location: "Garden" },
      { label: "Cocktails", starts_at_minutes: 720, location: "Terrace" },
      { label: "Dinner", starts_at_minutes: 780, location: "Hall" },
      { label: "Speeches", starts_at_minutes: 900, location: "Hall" },
      { label: "First dance", starts_at_minutes: 960, location: "Hall" },
      { label: "Party", starts_at_minutes: 1020, location: "Hall" },
    ];
    for (const e of events) {
      const r = await req("POST", "/api/schedule", e, { token });
      if (r.status !== 201) throw new Error(`schedule ${e.label} failed (${r.status})`);
    }
  },

  "seating-init": async (i) => {
    const email = `lt-se-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    const guestIds: number[] = [];
    for (let g = 0; g < 4; g++) {
      const r = await req<{ guest: { id: number } }>(
        "POST",
        "/api/guests",
        { full_name: `Seated ${i}-${g}` },
        { token },
      );
      if (r.status !== 201) throw new Error(`guest ${g} failed (${r.status})`);
      guestIds.push(r.data.guest.id);
    }
    const t1 = await req<{ table: { id: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "T1", shape: "round", seats: 5, x_mm: 100, y_mm: 100 },
      { token },
    );
    if (t1.status !== 201) throw new Error(`table 1 failed (${t1.status})`);
    const t2 = await req<{ table: { id: number } }>(
      "POST",
      "/api/seating/tables",
      { label: "T2", shape: "round", seats: 5, x_mm: 3000, y_mm: 100 },
      { token },
    );
    if (t2.status !== 201) throw new Error(`table 2 failed (${t2.status})`);
    const tableIds = [t1.data.table.id, t2.data.table.id];
    for (let s = 0; s < guestIds.length; s++) {
      const r = await req(
        "POST",
        "/api/seating/assign",
        {
          table_id: tableIds[s % 2],
          seat_index: Math.floor(s / 2),
          guest_id: guestIds[s],
        },
        { token },
      );
      if (r.status !== 200) throw new Error(`assign ${s} failed (${r.status})`);
    }
  },

  "vendor-picks": async (i) => {
    const email = `lt-vp-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    const picks = [
      ["venue", "normafa-rendezvenyhaz"],
      ["catering", "anyas-catering"],
      ["decor_floral", "bloom-budapest"],
      ["music_dj", "the-jets-budapest"],
    ] as const;
    for (const [cat, sid] of picks) {
      const r = await req("PUT", `/api/picks/${cat}`, { supplier_id: sid }, { token });
      if (r.status !== 200) throw new Error(`pick ${cat} failed (${r.status})`);
    }
  },

  "honeymoon-set": async (i) => {
    const email = `lt-hm-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    const r = await req(
      "PATCH",
      "/api/couples/current",
      {
        honeymoon_destination: ["Bali", "Madeira", "Greece", "Iceland"][i % 4],
        honeymoon_start_date: "2027-08-01",
        honeymoon_end_date: "2027-08-10",
      },
      { token },
    );
    if (r.status !== 200) throw new Error(`honeymoon patch failed (${r.status})`);
  },

  "partner-invite": async (i) => {
    const email = `lt-pi-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    await onboard(token);
    const r = await req(
      "POST",
      "/api/couples/invites",
      { invited_email: `lt-pi-partner-${i}@weddly.test` },
      { token },
    );
    if (r.status !== 201) throw new Error(`invite failed (${r.status})`);
  },

  "suppliers-browse": async (i) => {
    const email = `lt-sb-${i}@weddly.test`;
    const token = await register(email);
    await verifyEmail(email);
    const sup = await req("GET", "/api/suppliers", undefined, { token });
    if (sup.status !== 200) throw new Error(`suppliers failed (${sup.status})`);
    const tax = await req("GET", "/api/supplier-categories", undefined, { token });
    if (tax.status !== 200) throw new Error(`taxonomy failed (${tax.status})`);
  },
};

// ──────────────────────────────────────────────────────────────────────
// Driver
// ──────────────────────────────────────────────────────────────────────

interface RunResult {
  goal: string;
  ok: boolean;
  ms: number;
  error?: string;
}

async function runOne(goal: string, fn: Goal, i: number): Promise<RunResult> {
  const t0 = performance.now();
  try {
    await fn(i);
    return { goal, ok: true, ms: performance.now() - t0 };
  } catch (e) {
    return {
      goal,
      ok: false,
      ms: performance.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
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

function parseArgs(): { users: number; seq: boolean } {
  let users = 100;
  let seq = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--seq") seq = true;
    else if (arg.startsWith("--users=")) {
      const n = Number(arg.slice("--users=".length));
      if (Number.isFinite(n) && n > 0) users = Math.max(Object.keys(goals).length, n);
    }
  }
  return { users, seq };
}

async function main() {
  const { users, seq } = parseArgs();
  const goalNames = Object.keys(goals);
  // Distribute `users` across goals as evenly as possible. With users=100 and
  // 10 goals → 10 each (matches the original behaviour).
  const perGoal = Math.floor(users / goalNames.length);
  const total = goalNames.length * perGoal;
  console.log(
    `\nStarting ${total} simulated users across ${goalNames.length} goals (${perGoal} each, ` +
      `mode=${seq ? "sequential" : "parallel"})…\n`,
  );

  const taskFactories: Array<() => Promise<RunResult>> = [];
  let i = 0;
  for (const name of goalNames) {
    for (let k = 0; k < perGoal; k++) {
      const idx = i++;
      taskFactories.push(() => runOne(name, goals[name]!, idx));
    }
  }

  const t0 = performance.now();
  let results: RunResult[];
  if (seq) {
    results = [];
    for (const f of taskFactories) results.push(await f());
  } else {
    results = await Promise.all(taskFactories.map((f) => f()));
  }
  const wallMs = performance.now() - t0;

  // Aggregate
  const byGoal = new Map<string, RunResult[]>();
  for (const r of results) {
    const list = byGoal.get(r.goal) ?? [];
    list.push(r);
    byGoal.set(r.goal, list);
  }

  const rows: Array<{
    goal: string;
    n: number;
    ok: number;
    fail: number;
    mean: number;
    p50: number;
    p95: number;
    max: number;
  }> = [];
  for (const [name, list] of byGoal) {
    const ok = list.filter((r) => r.ok).length;
    const fail = list.length - ok;
    const ms = list.map((r) => r.ms).sort((a, b) => a - b);
    const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
    rows.push({
      goal: name,
      n: list.length,
      ok,
      fail,
      mean,
      p50: quantile(ms, 0.5),
      p95: quantile(ms, 0.95),
      max: ms[ms.length - 1] ?? 0,
    });
  }
  rows.sort((a, b) => a.goal.localeCompare(b.goal));

  const totalOk = results.filter((r) => r.ok).length;
  const totalFail = results.length - totalOk;

  console.log("goal".padEnd(20) + "  n   ok  fail   mean   p50    p95    max");
  console.log("─".repeat(64));
  for (const r of rows) {
    console.log(
      r.goal.padEnd(20) +
        `  ${String(r.n).padStart(2)}  ${String(r.ok).padStart(3)}  ${String(r.fail).padStart(3)}   ` +
        `${r.mean.toFixed(0).padStart(5)}  ${r.p50.toFixed(0).padStart(4)}   ${r.p95.toFixed(0).padStart(4)}   ${r.max.toFixed(0).padStart(4)} ms`,
    );
  }
  console.log("─".repeat(64));
  console.log(
    `TOTAL`.padEnd(20) +
      `  ${String(results.length).padStart(2)}  ${String(totalOk).padStart(3)}  ${String(totalFail).padStart(3)}   ` +
      `wall ${wallMs.toFixed(0)} ms`,
  );

  if (totalFail > 0) {
    console.log(`\n${totalFail} failures:`);
    const sample = results.filter((r) => !r.ok).slice(0, 20);
    for (const r of sample) {
      console.log(`  • ${r.goal}: ${r.error}`);
    }
  }

  process.exit(totalFail === 0 ? 0 : 1);
}

await main();
