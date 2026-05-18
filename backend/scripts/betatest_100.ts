// Synthetic "100 beta testers" — 4 persona buckets × 25 each, each user runs
// a realistic multi-step flow PLUS exploratory ops that probe likely product
// gaps ("I wish I could…" — bulk add, undo, custom category, etc.). Every
// non-2xx and every "endpoint missing" gets logged with the persona who hit
// it, then aggregated into a friction report at the end.
//
// Run: bun run backend/scripts/betatest_100.ts

import "../tests/setup";

import { PRIVACY_VERSION } from "@shared/legal";
import { db } from "../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

interface ReqResult<T> {
  status: number;
  data: T;
  path: string;
  method: string;
}

interface FrictionItem {
  persona: string;
  step: string;
  method: string;
  path: string;
  status: number;
  message: string;
}

const friction: FrictionItem[] = [];

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<ReqResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-client-ip": `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { _raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, data: data as T, path, method };
}

function record(persona: string, step: string, r: ReqResult<unknown>) {
  if (r.status >= 200 && r.status < 300) return;
  const errBody = r.data as { error?: string } | null;
  const msg = errBody?.error ?? `HTTP ${r.status}`;
  friction.push({
    persona,
    step,
    method: r.method,
    path: r.path,
    status: r.status,
    message: msg,
  });
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
// Personas — each returns the persona tag and runs its own flow.
// ──────────────────────────────────────────────────────────────────────

interface PersonaSpec {
  tag: string;
  index: number;
  display: string;
  guests: number;
  budgetHuf: number;
  scheduleEvents: number;
  tables: number;
  picks: Array<[string, string]>;
  honeymoon: string | null;
  invitePartner: boolean;
  // Exploratory ops the persona will try — each is "something a real user
  // would naturally attempt." If it fails, that's friction worth knowing.
  explore: string[];
}

function buildPersonas(): PersonaSpec[] {
  const personas: PersonaSpec[] = [];

  // 25 minimalist: 20–40 guests, 1–3M HUF, tight, intimate
  for (let i = 0; i < 25; i++) {
    personas.push({
      tag: "minimalist",
      index: i,
      display: "Anna & Bence (intimate)",
      guests: 20 + (i % 21),
      budgetHuf: 1_000_000 + (i % 3) * 500_000,
      scheduleEvents: 4,
      tables: 2,
      picks: [
        ["venue", "kis-csarda"],
        ["catering", "anyas-catering"],
      ],
      honeymoon: i % 3 === 0 ? null : "Lake Balaton",
      invitePartner: i % 2 === 0,
      explore: ["bulk-add-30", "filter-by-tag", "export-budget-pdf", "delete-guest"],
    });
  }

  // 25 traditional: 60–100 guests, 5–8M HUF
  for (let i = 0; i < 25; i++) {
    personas.push({
      tag: "traditional",
      index: i,
      display: "Eszter & Dávid",
      guests: 60 + (i % 41),
      budgetHuf: 5_000_000 + (i % 4) * 1_000_000,
      scheduleEvents: 8,
      tables: 8 + (i % 4),
      picks: [
        ["venue", "normafa-rendezvenyhaz"],
        ["catering", "anyas-catering"],
        ["decor_floral", "bloom-budapest"],
        ["music_dj", "the-jets-budapest"],
        ["photo_video", "bp-photo-studio"],
      ],
      honeymoon: "Italy",
      invitePartner: true,
      explore: [
        "bulk-add-30",
        "filter-by-tag",
        "export-budget-pdf",
        "custom-budget-category",
        "duplicate-event",
        "guest-csv-export",
      ],
    });
  }

  // 25 lavish: 120–200 guests, 10–30M HUF
  for (let i = 0; i < 25; i++) {
    personas.push({
      tag: "lavish",
      index: i,
      display: "Sára & Mátyás",
      guests: 120 + (i % 81),
      budgetHuf: 10_000_000 + (i % 5) * 4_000_000,
      scheduleEvents: 12,
      tables: 14 + (i % 6),
      picks: [
        ["venue", "boscolo-budapest"],
        ["catering", "michelin-events"],
        ["decor_floral", "bloom-budapest"],
        ["music_dj", "the-jets-budapest"],
        ["photo_video", "bp-photo-studio"],
        ["cake_dessert", "auguszt"],
        ["hair_makeup", "glamour-bp"],
      ],
      honeymoon: "Maldives",
      invitePartner: true,
      explore: [
        "bulk-add-30",
        "filter-by-tag",
        "export-budget-pdf",
        "custom-budget-category",
        "duplicate-event",
        "guest-csv-export",
        "seating-pdf-a3",
        "vendor-comparison",
      ],
    });
  }

  // 25 destination: 50–80 guests, variable
  for (let i = 0; i < 25; i++) {
    personas.push({
      tag: "destination",
      index: i,
      display: "Júlia & Marcell (Tuscany)",
      guests: 50 + (i % 31),
      budgetHuf: 8_000_000 + (i % 4) * 2_000_000,
      scheduleEvents: 6,
      tables: 6 + (i % 3),
      picks: [
        ["venue", "tuscany-villa-x"],
        ["catering", "anyas-catering"],
        ["photo_video", "bp-photo-studio"],
      ],
      honeymoon: "Greek islands",
      invitePartner: true,
      explore: [
        "bulk-add-30",
        "multi-day-schedule",
        "currency-eur",
        "vendor-shortlist",
        "guest-csv-export",
      ],
    });
  }

  return personas;
}

async function runPersona(p: PersonaSpec): Promise<void> {
  const tag = `${p.tag}#${p.index}`;
  const email = `beta-${p.tag}-${p.index}@weddly.test`;

  // ── 1. Register ────────────────────────────────────────────────────
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "betatest-pw-123",
    full_name: p.display,
    privacy_version: PRIVACY_VERSION,
  });
  record(tag, "register", reg);
  if (reg.status !== 201) return;
  const token = reg.data.token;

  // ── 2. Verify ──────────────────────────────────────────────────────
  try {
    await verifyEmail(email);
  } catch (e) {
    friction.push({
      persona: tag,
      step: "verify",
      method: "POST",
      path: "/api/auth/verify/*",
      status: 0,
      message: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  // ── 3. Onboard ─────────────────────────────────────────────────────
  const ob = await req<{ couple: { id: number } }>(
    "POST",
    "/api/couples/onboard",
    {
      display_name: p.display,
      wedding_date: "2027-06-12",
      target_guest_count: p.guests,
      budget_ceiling_huf: p.budgetHuf,
      style_tags: [],
    },
    token,
  );
  record(tag, "onboard", ob);
  if (ob.status !== 201) return;

  // ── 4. Add guests ──────────────────────────────────────────────────
  for (let g = 0; g < p.guests; g++) {
    const r = await req(
      "POST",
      "/api/guests",
      {
        full_name: `${p.tag} Guest ${p.index}-${g}`,
        group_tag: g % 2 === 0 ? "her_family" : "his_family",
      },
      token,
    );
    if (r.status !== 201) {
      record(tag, "add-guest", r);
      break;
    }
  }

  // ── 5. Schedule ────────────────────────────────────────────────────
  const baseHour = 9 * 60;
  for (let e = 0; e < p.scheduleEvents; e++) {
    const r = await req(
      "POST",
      "/api/schedule",
      {
        label: `Event ${e + 1}`,
        starts_at_minutes: baseHour + e * 60,
        location: e % 2 === 0 ? "Hall" : "Garden",
      },
      token,
    );
    if (r.status !== 201) record(tag, "schedule-add", r);
  }

  // ── 6. Budget ──────────────────────────────────────────────────────
  const lines = await req<{
    lines: Array<{ id: number; category: string; label: string; planned_huf: number }>;
  }>("GET", "/api/budget/lines", undefined, token);
  if (lines.status === 200) {
    for (const line of lines.data.lines.slice(0, 4)) {
      const r = await req(
        "PATCH",
        `/api/budget/lines/${line.id}`,
        {
          category: line.category,
          label: line.label,
          planned_huf: line.planned_huf,
          actual_huf: Math.floor(line.planned_huf * 0.6),
        },
        token,
      );
      if (r.status !== 200) record(tag, "budget-patch", r);
    }
    const snap = await req("POST", "/api/budget/snapshots", { name: `${p.tag} snapshot` }, token);
    if (snap.status !== 201) record(tag, "budget-snapshot", snap);
  } else {
    record(tag, "budget-list", lines);
  }

  // ── 7. Seating ─────────────────────────────────────────────────────
  for (let t = 0; t < p.tables; t++) {
    const r = await req(
      "POST",
      "/api/seating/tables",
      {
        label: `T${t + 1}`,
        shape: "round",
        seats: 8,
        x_mm: 100 + (t % 4) * 2000,
        y_mm: 100 + Math.floor(t / 4) * 2000,
      },
      token,
    );
    if (r.status !== 201) record(tag, "seating-table", r);
  }

  // ── 8. Picks ───────────────────────────────────────────────────────
  for (const [cat, sid] of p.picks) {
    const r = await req("PUT", `/api/picks/${cat}`, { supplier_id: sid }, token);
    if (r.status !== 200) record(tag, `pick-${cat}`, r);
  }

  // ── 9. Honeymoon ───────────────────────────────────────────────────
  if (p.honeymoon !== null) {
    const r = await req(
      "PATCH",
      "/api/couples/current",
      {
        honeymoon_destination: p.honeymoon,
        honeymoon_start_date: "2027-07-01",
        honeymoon_end_date: "2027-07-10",
      },
      token,
    );
    if (r.status !== 200) record(tag, "honeymoon-set", r);
  }

  // ── 10. Invite partner ─────────────────────────────────────────────
  if (p.invitePartner) {
    const r = await req(
      "POST",
      "/api/couples/invites",
      { invited_email: `beta-${p.tag}-${p.index}-partner@weddly.test` },
      token,
    );
    if (r.status !== 201) record(tag, "partner-invite", r);
  }

  // ── 11. Browse suppliers ───────────────────────────────────────────
  const sup = await req("GET", "/api/suppliers", undefined, token);
  if (sup.status !== 200) record(tag, "suppliers-browse", sup);

  // ── 12. Exploratory ops — these are "I wish I could…" attempts.
  // Anything that fails is friction worth knowing about.
  for (const op of p.explore) {
    await runExplore(tag, token, op, p);
  }
}

async function runExplore(tag: string, token: string, op: string, p: PersonaSpec): Promise<void> {
  switch (op) {
    case "bulk-add-30": {
      // Try a bulk endpoint that may not exist.
      const r = await req(
        "POST",
        "/api/guests/bulk",
        {
          guests: Array.from({ length: 30 }, (_, k) => ({
            full_name: `${p.tag} bulk ${p.index}-${k}`,
          })),
        },
        token,
      );
      if (r.status === 404) {
        friction.push({
          persona: tag,
          step: "explore:bulk-add-30",
          method: "POST",
          path: "/api/guests/bulk",
          status: 404,
          message: "no bulk-add-guests endpoint (sequential POSTs only)",
        });
      } else if (r.status >= 400) record(tag, "explore:bulk-add-30", r);
      break;
    }
    case "filter-by-tag": {
      const r = await req("GET", "/api/guests?group_tag=her_family", undefined, token);
      if (r.status !== 200) record(tag, "explore:filter-by-tag", r);
      else {
        // Did the server actually filter? It might return everything.
        const list = (r.data as { guests: { group_tag: string }[] }).guests;
        if (list && list.length > 0) {
          const wrong = list.filter((g) => g.group_tag && g.group_tag !== "her_family");
          if (wrong.length > 0) {
            friction.push({
              persona: tag,
              step: "explore:filter-by-tag",
              method: "GET",
              path: "/api/guests?group_tag=…",
              status: 200,
              message: "query param ignored — server returned all groups",
            });
          }
        }
      }
      break;
    }
    case "export-budget-pdf": {
      const r = await req("GET", "/api/budget/export.pdf", undefined, token);
      if (r.status === 404) {
        friction.push({
          persona: tag,
          step: "explore:export-budget-pdf",
          method: "GET",
          path: "/api/budget/export.pdf",
          status: 404,
          message: "no budget PDF export (only seating PDF exists)",
        });
      } else if (r.status >= 400) record(tag, "explore:export-budget-pdf", r);
      break;
    }
    case "delete-guest": {
      // List guests, try to delete the first one.
      const list = await req<{ guests: { id: number }[] }>("GET", "/api/guests", undefined, token);
      const id = list.data?.guests?.[0]?.id;
      if (!id) break;
      const del = await req("DELETE", `/api/guests/${id}`, undefined, token);
      if (del.status >= 400) record(tag, "explore:delete-guest", del);
      break;
    }
    case "custom-budget-category": {
      const r = await req(
        "POST",
        "/api/budget/lines",
        {
          category: "wedding_planner_fee",
          label: "Wedding planner",
          planned_huf: 500_000,
          actual_huf: 0,
        },
        token,
      );
      if (r.status >= 400) record(tag, "explore:custom-budget-category", r);
      break;
    }
    case "duplicate-event": {
      // List events, try duplicate the first via a hypothetical endpoint.
      const events = await req<{ events: { id: number }[] }>(
        "GET",
        "/api/schedule",
        undefined,
        token,
      );
      const id = events.data?.events?.[0]?.id;
      if (!id) break;
      const dup = await req("POST", `/api/schedule/${id}/duplicate`, {}, token);
      if (dup.status === 404) {
        friction.push({
          persona: tag,
          step: "explore:duplicate-event",
          method: "POST",
          path: "/api/schedule/:id/duplicate",
          status: 404,
          message: "no duplicate-event shortcut (manual re-entry only)",
        });
      } else if (dup.status >= 400) record(tag, "explore:duplicate-event", dup);
      break;
    }
    case "guest-csv-export": {
      const r = await req("GET", "/api/guests/csv", undefined, token);
      if (r.status >= 400) record(tag, "explore:guest-csv-export", r);
      break;
    }
    case "seating-pdf-a3": {
      const r = await req("GET", "/api/seating/export.pdf?size=A3", undefined, token);
      if (r.status >= 400) record(tag, "explore:seating-pdf-a3", r);
      break;
    }
    case "vendor-comparison": {
      const r = await req(
        "POST",
        "/api/suppliers/compare",
        { ids: ["normafa-rendezvenyhaz", "boscolo-budapest"] },
        token,
      );
      if (r.status === 404) {
        friction.push({
          persona: tag,
          step: "explore:vendor-comparison",
          method: "POST",
          path: "/api/suppliers/compare",
          status: 404,
          message: "no side-by-side vendor comparison endpoint",
        });
      } else if (r.status >= 400) record(tag, "explore:vendor-comparison", r);
      break;
    }
    case "multi-day-schedule": {
      // Schedule day 2 — minutes > 1440 hints at a multi-day need.
      const r = await req(
        "POST",
        "/api/schedule",
        { label: "Day 2 breakfast", starts_at_minutes: 24 * 60 + 9 * 60, location: "Garden" },
        token,
      );
      if (r.status === 400) {
        friction.push({
          persona: tag,
          step: "explore:multi-day-schedule",
          method: "POST",
          path: "/api/schedule",
          status: 400,
          message: "schedule rejects times past midnight — no multi-day support",
        });
      } else if (r.status >= 400) record(tag, "explore:multi-day-schedule", r);
      break;
    }
    case "currency-eur": {
      const r = await req("PATCH", "/api/couples/current", { currency: "EUR" }, token);
      if (r.status >= 400) record(tag, "explore:currency-eur", r);
      break;
    }
    case "vendor-shortlist": {
      // Try saving multiple suppliers as a shortlist (couple_suppliers maybe).
      const r = await req(
        "POST",
        "/api/couple-suppliers",
        { supplier_id: "normafa-rendezvenyhaz", note: "Shortlist 1" },
        token,
      );
      if (r.status >= 400) record(tag, "explore:vendor-shortlist", r);
      break;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Driver
// ──────────────────────────────────────────────────────────────────────

async function main() {
  const personas = buildPersonas();
  console.log(`\nLaunching ${personas.length} beta testers in parallel…\n`);
  const t0 = performance.now();
  const settled = await Promise.allSettled(personas.map((p) => runPersona(p)));
  const wallMs = performance.now() - t0;

  const completed = settled.filter((s) => s.status === "fulfilled").length;
  const crashed = settled.filter((s) => s.status === "rejected").length;

  console.log(`Beta cohort done in ${wallMs.toFixed(0)} ms`);
  console.log(`  completed: ${completed} / ${personas.length}`);
  console.log(`  crashed:   ${crashed}`);
  console.log(`  friction items: ${friction.length}\n`);

  if (friction.length === 0) {
    console.log("No friction recorded — every probe succeeded.");
    return;
  }

  // Aggregate by (step, path) → count + sample message + persona tags hit.
  interface Group {
    step: string;
    path: string;
    method: string;
    status: number;
    message: string;
    count: number;
    personas: Set<string>;
  }
  const groups = new Map<string, Group>();
  for (const f of friction) {
    const key = `${f.step}|${f.method} ${f.path}|${f.status}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.personas.add(f.persona.split("#")[0]!);
    } else {
      groups.set(key, {
        step: f.step,
        path: f.path,
        method: f.method,
        status: f.status,
        message: f.message,
        count: 1,
        personas: new Set([f.persona.split("#")[0]!]),
      });
    }
  }

  const ordered = Array.from(groups.values()).sort((a, b) => b.count - a.count);
  console.log("Aggregated friction (sorted by frequency):");
  console.log("─".repeat(96));
  console.log("count  status  step".padEnd(40) + "  endpoint".padEnd(38) + "  personas");
  console.log("─".repeat(96));
  for (const g of ordered) {
    const buckets = Array.from(g.personas).sort().join(",");
    console.log(
      `${String(g.count).padStart(4)}   ${String(g.status).padStart(4)}   ${g.step.padEnd(30).slice(0, 30)}  ` +
        `${(g.method + " " + g.path).padEnd(36).slice(0, 36)}  ${buckets}`,
    );
  }
  console.log("─".repeat(96));
  console.log("\nMessages (first per group):");
  for (const g of ordered) {
    console.log(`  • [${g.count}×] ${g.step}: ${g.message}`);
  }
}

await main();
process.exit(0);
