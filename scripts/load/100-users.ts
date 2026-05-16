// 100-user load harness.
//
// Boots an isolated Bun server (PORT 8788, DB ./data/load-test.db), then runs
// 100 simulated couples through a realistic flow with bounded concurrency.
// Per-step latency + error counts are aggregated and printed as Markdown.
//
// Usage:
//   bun run scripts/load/100-users.ts
// Env overrides:
//   USERS=100 CONCURRENCY=10 GUESTS_PER_USER=15 bun run scripts/load/100-users.ts

import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const USERS = Number(process.env.USERS ?? 100);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 10);
const GUESTS_PER_USER = Number(process.env.GUESTS_PER_USER ?? 15);
const HOUSEHOLDS_PER_USER = Number(process.env.HOUSEHOLDS_PER_USER ?? 3);
const TABLES_PER_USER = Number(process.env.TABLES_PER_USER ?? 3);
const PORT = Number(process.env.LOAD_PORT ?? 8788);
// Absolute so the spawned server (cwd=backend/) and the harness (cwd=repo root)
// both resolve to the same SQLite file.
const DB_PATH = resolve(process.env.LOAD_DB_PATH ?? "./data/load-test.db");
const BASE = `http://localhost:${PORT}`;

interface Sample {
  latencyMs: number;
  status: number;
  ok: boolean;
}

const samples: Map<string, Sample[]> = new Map();

function record(step: string, latencyMs: number, status: number) {
  const ok = status >= 200 && status < 300;
  let arr = samples.get(step);
  if (!arr) {
    arr = [];
    samples.set(step, arr);
  }
  arr.push({ latencyMs, status, ok });
}

async function req<T = unknown>(
  step: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; ip: string },
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Each simulated user gets a unique IP so we don't fight the rate limiter.
    "x-test-client-ip": opts.ip,
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const latencyMs = performance.now() - t0;
  record(step, latencyMs, res.status);
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data: data as T };
}

// ── server lifecycle ────────────────────────────────────────────────────────

function wipeDb() {
  for (const ext of ["", "-shm", "-wal"]) {
    const f = `${DB_PATH}${ext}`;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

async function startServer(): Promise<{ kill: () => void }> {
  const proc = spawn("bun", ["src/server.ts"], {
    cwd: `${process.cwd()}/backend`,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      DB_PATH,
      JWT_SECRET: "load-test-secret-0123456789abcdef0123456789abcdef0123456789abcdef",
      FRONTEND_BASE_URL: "http://localhost:5173",
      RESEND_API_KEY: "",
      ADMIN_EMAILS: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Surface fatal errors but stay quiet about the per-request log.
  proc.stderr?.on("data", (b: Buffer) => {
    const s = b.toString();
    if (s.includes("FATAL") || s.includes("error") || s.includes("Error")) {
      process.stderr.write(`[server] ${s}`);
    }
  });
  // Wait for /api/health to respond — up to ~10s.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        return { kill: () => proc.kill("SIGTERM") };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill("SIGTERM");
  throw new Error("server did not start within 10s");
}

// ── verification-token sidecar ──────────────────────────────────────────────
// The /api/couples/onboard endpoint requires verified_email = 1. In production
// this happens by the user clicking a link in their inbox. Here we open the
// SQLite file directly (read-only) and look up the freshest unconsumed token
// for the user, then POST it through the same /api/auth/verify/:token endpoint
// the frontend uses — so the harness exercises the real verification code path
// without needing an inbox.
let tokenDb: Database | null = null;
function getTokenDb(): Database {
  if (!tokenDb) tokenDb = new Database(DB_PATH, { readonly: true });
  return tokenDb;
}

function lookupVerifyToken(email: string): string {
  const row = getTokenDb()
    .prepare(
      "SELECT t.token FROM email_verification_tokens t " +
        "JOIN users u ON u.id = t.user_id " +
        "WHERE u.email = ? AND t.consumed_at IS NULL " +
        "ORDER BY t.id DESC LIMIT 1",
    )
    .get(email) as { token: string } | undefined;
  if (!row) throw new Error(`no verification token for ${email}`);
  return row.token;
}

// ── per-user flow ───────────────────────────────────────────────────────────

interface UserFailure {
  index: number;
  step: string;
  status: number;
  body: unknown;
}
const failures: UserFailure[] = [];

async function runOneUser(i: number): Promise<void> {
  const email = `load+${i.toString().padStart(3, "0")}@weddly.test`;
  const password = "supersafe123";
  // Deterministic IP per user so a single user's flow shares one rate-limit
  // bucket (mimicking a real client) — but each user has their own IP so 100
  // signups don't all fight over one 5-token bucket.
  const ip = `10.${Math.floor(i / 256)}.${i % 256}.1`;

  const fail = (step: string, status: number, body: unknown): never => {
    failures.push({ index: i, step, status, body });
    throw new Error(`user ${i} failed at ${step}: ${status}`);
  };

  // 1. Register
  const reg = await req<{ token: string }>("auth.register", "POST", "/api/auth/register", {
    body: { email, password, full_name: `Loader ${i}` },
    ip,
  });
  if (reg.status !== 201) return fail("auth.register", reg.status, reg.data);
  const token = reg.data.token;

  // 2. Verify email (look up token directly, then consume via API)
  let verifyToken: string;
  try {
    verifyToken = lookupVerifyToken(email);
  } catch (e) {
    return fail("auth.lookup_token", 0, String(e));
  }
  const consume = await req("auth.verify", "POST", `/api/auth/verify/${verifyToken}`, {
    body: {},
    ip,
  });
  if (consume.status !== 200) return fail("auth.verify", consume.status, consume.data);

  // 3. Onboard couple
  const onboard = await req<{ couple: { id: number } }>(
    "couples.onboard",
    "POST",
    "/api/couples/onboard",
    {
      token,
      ip,
      body: {
        display_name: `Couple ${i}`,
        wedding_date: "2026-09-12",
        target_guest_count: 80,
        budget_ceiling_huf: 5_000_000,
        style_tags: [],
      },
    },
  );
  if (onboard.status !== 201) return fail("couples.onboard", onboard.status, onboard.data);

  // 4. Households
  const householdIds: number[] = [];
  for (let h = 0; h < HOUSEHOLDS_PER_USER; h++) {
    const r = await req<{ household: { id: number } }>(
      "households.create",
      "POST",
      "/api/households",
      {
        token,
        ip,
        body: { label: `Háztartás ${h + 1}`, group_tag: h === 0 ? "her_family" : "his_family" },
      },
    );
    if (r.status === 201) householdIds.push(r.data.household.id);
  }

  // 5. Guests — split across the 3 households, mix of RSVP statuses
  const guestIds: number[] = [];
  for (let g = 0; g < GUESTS_PER_USER; g++) {
    const r = await req<{ guest: { id: number } }>("guests.create", "POST", "/api/guests", {
      token,
      ip,
      body: {
        full_name: `Vendég ${i}-${g}`,
        email: `g${g}@user${i}.test`,
        group_tag: g % 2 === 0 ? "her_family" : "his_family",
        kind: g % 7 === 0 ? "child" : "adult",
        rsvp_status: g % 3 === 0 ? "yes" : g % 3 === 1 ? "pending" : "maybe",
        meal_choice: g % 4 === 0 ? "vegetarian" : null,
      },
    });
    if (r.status === 201) guestIds.push(r.data.guest.id);
  }

  // 6. Seating tables. Default round Ø 1500 only seats ~5 (π·1500/800 ≈ 5.89),
  // so we pass a 2000mm round to fit 8 chairs and don't waste budget-side calls
  // chasing the soft-clamp.
  const tables: { id: number; seats: number }[] = [];
  for (let t = 0; t < TABLES_PER_USER; t++) {
    const r = await req<{ table: { id: number; seats: number } }>(
      "seating.create_table",
      "POST",
      "/api/seating/tables",
      {
        token,
        ip,
        body: {
          label: `T${t + 1}`,
          shape: "round",
          seats: 8,
          width_mm: 2000,
          length_mm: 2000,
          x_mm: 1000 + t * 2500,
          y_mm: 1000,
        },
      },
    );
    if (r.status === 201) tables.push({ id: r.data.table.id, seats: r.data.table.seats });
  }

  // 7. Assign guests up to each table's actual seat count.
  let assigned = 0;
  outer: for (const tbl of tables) {
    for (let seatIndex = 0; seatIndex < tbl.seats; seatIndex++) {
      if (assigned >= guestIds.length) break outer;
      await req("seating.assign", "POST", "/api/seating/assign", {
        token,
        ip,
        body: { table_id: tbl.id, seat_index: seatIndex, guest_id: guestIds[assigned]! },
      });
      assigned++;
    }
  }

  // 8. Budget lines (on top of the seeded ones)
  const extraCats = ["venue", "catering", "photo_video"];
  for (let b = 0; b < 3; b++) {
    await req("budget.create_line", "POST", "/api/budget/lines", {
      token,
      ip,
      body: {
        category: extraCats[b]!,
        label: `Extra ${b}`,
        planned_huf: 100_000 + b * 50_000,
        actual_huf: 0,
      },
    });
  }

  // 9. Planning tasks
  for (let p = 0; p < 3; p++) {
    await req("planning.create", "POST", "/api/planning", {
      token,
      ip,
      body: {
        kind: "task",
        title: `Feladat ${p + 1}`,
        body: null,
        due_date: "2026-08-01",
      },
    });
  }

  // 10. Schedule (run-of-show)
  for (let s = 0; s < 3; s++) {
    await req("schedule.create", "POST", "/api/schedule", {
      token,
      ip,
      body: {
        label: `Esemény ${s + 1}`,
        starts_at_minutes: 16 * 60 + s * 30,
        duration_minutes: 30,
      },
    });
  }

  // 11. Per-household RSVP toggles (added May 2026, commit 3f1e3d8). The
  // public RSVP form's "needs accommodation?" + "collect meal choices?"
  // questions migrated from couple-level to per-household. Touch the first
  // household so a regression in the new write path shows up here instead
  // of silently in a couple's prod data.
  if (householdIds.length > 0) {
    await req("households.rsvp_toggle", "PATCH", `/api/households/${householdIds[0]}`, {
      token,
      ip,
      body: { rsvp_offers_accommodation: true, rsvp_collects_meal: false },
    });
  }

  // 12. Dashboard-style reads (the ones that suffer first as data grows)
  await req("couples.activity", "GET", "/api/couples/activity", { token, ip });
  await req("guests.list", "GET", "/api/guests", { token, ip });
  await req("budget.list", "GET", "/api/budget/lines", { token, ip });
  await req("seating.get_plan", "GET", "/api/seating/plan", { token, ip });
  await req("schedule.list", "GET", "/api/schedule", { token, ip });
  await req("planning.list", "GET", "/api/planning", { token, ip });
  await req("households.list", "GET", "/api/households", { token, ip });
  // Multi-workspace listing (added May 2026, commit c3ead84). Every user has
  // exactly one workspace in this synthetic load so the response is short,
  // but the endpoint still goes through the couple_members junction join
  // that pre-existing couple lookups bypassed — useful regression sentinel.
  await req("workspaces.list", "GET", "/api/users/me/couples", { token, ip });

  // 13. Logout
  await req("auth.logout", "POST", "/api/auth/logout", { token, ip, body: {} });
}

// ── concurrency pool ────────────────────────────────────────────────────────

async function runPool(n: number, concurrency: number): Promise<void> {
  let next = 0;
  let completed = 0;
  const workers: Promise<void>[] = [];
  for (let w = 0; w < concurrency; w++) {
    workers.push(
      (async () => {
        for (;;) {
          const idx = next++;
          if (idx >= n) return;
          try {
            await runOneUser(idx);
          } catch {
            // failure already recorded
          }
          completed++;
          if (completed % 10 === 0 || completed === n) {
            process.stdout.write(`  progress: ${completed}/${n}\n`);
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
}

// ── reporting ───────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function fmtMs(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(2)}s`;
  return `${n.toFixed(0)}ms`;
}

// Run the steps in the same order they execute, so the report reads top→bottom
// as a user journey.
const STEP_ORDER = [
  "auth.register",
  "auth.verify",
  "couples.onboard",
  "households.create",
  "guests.create",
  "seating.create_table",
  "seating.assign",
  "budget.create_line",
  "planning.create",
  "schedule.create",
  "households.rsvp_toggle",
  "couples.activity",
  "guests.list",
  "budget.list",
  "seating.get_plan",
  "schedule.list",
  "planning.list",
  "households.list",
  "workspaces.list",
  "auth.logout",
];

function report(totalMs: number) {
  console.log("");
  console.log("## Per-step latency");
  console.log("");
  console.log("| step | n | ok | err | p50 | p95 | max |");
  console.log("|------|---:|---:|---:|---:|---:|---:|");
  const seen = new Set<string>();
  const print = (step: string) => {
    seen.add(step);
    const arr = samples.get(step);
    if (!arr || arr.length === 0) return;
    const lats = arr.map((s) => s.latencyMs);
    const ok = arr.filter((s) => s.ok).length;
    const err = arr.length - ok;
    console.log(
      `| ${step} | ${arr.length} | ${ok} | ${err} | ${fmtMs(percentile(lats, 50))} | ${fmtMs(
        percentile(lats, 95),
      )} | ${fmtMs(Math.max(...lats))} |`,
    );
  };
  for (const step of STEP_ORDER) print(step);
  // Anything unexpected (e.g. auth.lookup_token from a thrown sentinel) lands here.
  for (const step of samples.keys()) if (!seen.has(step)) print(step);

  console.log("");
  console.log("## Error breakdown");
  const errByStatus = new Map<string, number>();
  for (const [step, arr] of samples) {
    for (const s of arr) {
      if (!s.ok) {
        const key = `${step} ${s.status}`;
        errByStatus.set(key, (errByStatus.get(key) ?? 0) + 1);
      }
    }
  }
  if (errByStatus.size === 0) {
    console.log("");
    console.log("(none)");
  } else {
    console.log("");
    for (const [k, v] of [...errByStatus.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- ${k}: ${v}`);
    }
  }

  console.log("");
  console.log("## Totals");
  console.log("");
  const totalReqs = [...samples.values()].reduce((acc, a) => acc + a.length, 0);
  const totalErr = [...samples.values()].reduce((acc, a) => acc + a.filter((s) => !s.ok).length, 0);
  console.log(`- users completed: ${USERS - failures.length}/${USERS}`);
  console.log(`- total requests: ${totalReqs}`);
  console.log(`- total errors: ${totalErr}`);
  console.log(`- wall clock: ${fmtMs(totalMs)}`);
  console.log(`- throughput: ${(totalReqs / (totalMs / 1000)).toFixed(1)} req/s`);

  if (failures.length > 0) {
    console.log("");
    console.log("## Sample failures (first 5)");
    console.log("");
    for (const f of failures.slice(0, 5)) {
      const body = typeof f.body === "string" ? f.body : JSON.stringify(f.body).slice(0, 300);
      console.log(`- user ${f.index} @ ${f.step}: status=${f.status} body=${body}`);
    }
  }
}

// ── DB size sampling ────────────────────────────────────────────────────────

function dbTableCounts(): Record<string, number> {
  const ro = new Database(DB_PATH, { readonly: true });
  const tables = [
    "users",
    "couples",
    "households",
    "guests",
    "seating_tables",
    "seat_assignments",
    "budget_lines",
    "planning_items",
    "schedule_events",
    "audit_log",
    "email_log",
    "email_dispatches",
    "rate_limit_buckets",
    "sessions",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      const r = ro.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
      out[t] = r.n;
    } catch {
      out[t] = -1;
    }
  }
  ro.close();
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`# 100-user load test`);
  console.log("");
  console.log(`- users: ${USERS}`);
  console.log(`- concurrency: ${CONCURRENCY}`);
  console.log(
    `- per-user: ${HOUSEHOLDS_PER_USER} households / ${GUESTS_PER_USER} guests / ${TABLES_PER_USER} tables`,
  );
  console.log(`- base: ${BASE}`);
  console.log(`- db: ${DB_PATH}`);
  console.log("");

  console.log("Wiping load DB...");
  wipeDb();

  console.log("Starting server...");
  const server = await startServer();

  let t0 = 0;
  try {
    console.log("Running flow...");
    t0 = performance.now();
    await runPool(USERS, CONCURRENCY);
  } finally {
    const totalMs = performance.now() - t0;
    server.kill();
    // Give the server a moment to close its DB cleanly before we sample.
    await new Promise((r) => setTimeout(r, 500));
    report(totalMs);
    console.log("");
    console.log("## DB row counts");
    console.log("");
    const counts = dbTableCounts();
    for (const [k, v] of Object.entries(counts)) console.log(`- ${k}: ${v}`);
  }
}

await main();
