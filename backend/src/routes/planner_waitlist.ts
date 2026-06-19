// Planner waitlist — public submission (anon POST) + admin triage endpoints.
// Phase 1: data collection only. No triage email flow yet.

import { PRIVACY_VERSION } from "@shared/legal";
import type { PlannerWaitlistOutcome } from "@shared/planner_waitlist";
import { db } from "../db";
import { requireAdmin } from "../domain/users";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const VALID_OUTCOMES: ReadonlySet<PlannerWaitlistOutcome> = new Set([
  "under_review",
  "accepted",
  "rejected",
]);

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function str(v: unknown): string {
  return trimStr(v);
}

interface PlannerWaitlistRow {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  company_name: string | null;
  city: string | null;
  years_experience: number | null;
  message: string | null;
  status: string;
  reviewed_by_user_id: number | null;
  reviewed_at: number | null;
  outcome_at: number | null;
  notes: string | null;
  selected_plan: string | null;
  website: string | null;
  weddings_per_year: number | null;
  usage: string | null;
  created_at: number;
}

function toAdminView(row: PlannerWaitlistRow) {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    company_name: row.company_name,
    city: row.city,
    years_experience: row.years_experience,
    message: row.message,
    status: row.status,
    reviewed_at: row.reviewed_at,
    outcome_at: row.outcome_at,
    notes: row.notes,
    selected_plan: row.selected_plan ?? null,
    website: row.website ?? null,
    weddings_per_year: row.weddings_per_year ?? null,
    usage: row.usage ?? null,
    created_at: row.created_at,
  };
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "planner_waitlist", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const full_name = trimStr(body.full_name);
  const email = trimStr(body.email);
  const phone = trimStr(body.phone);
  const company_name = trimStr(body.company_name) || null;
  const city = trimStr(body.city) || null;
  const message = trimStr(body.message) || null;
  const privacy_version = trimStr(body.privacy_version);

  if (!full_name) throw new HttpError(400, "full_name required");
  if (!email || !email.includes("@")) throw new HttpError(400, "valid email required");
  if (!phone) throw new HttpError(400, "phone required");
  if (privacy_version !== PRIVACY_VERSION)
    throw new HttpError(400, `privacy_version must be ${PRIVACY_VERSION}`);

  let years_experience: number | null = null;
  if (
    body.years_experience !== undefined &&
    body.years_experience !== null &&
    body.years_experience !== 0 &&
    body.years_experience !== ""
  ) {
    const parsed = Number(body.years_experience);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 60) {
      throw new HttpError(400, "years_experience must be 0-60");
    }
    years_experience = parsed;
  }

  const selected_plan_raw = trimStr(body.selected_plan);
  const selected_plan = ["basic", "pro", "unlimited"].includes(selected_plan_raw)
    ? (selected_plan_raw as "basic" | "pro" | "unlimited")
    : null;
  const website = trimStr(body.website) || null;
  const usage = trimStr(body.usage) || null;

  let weddings_per_year: number | null = null;
  if (
    body.weddings_per_year !== undefined &&
    body.weddings_per_year !== null &&
    body.weddings_per_year !== ""
  ) {
    const parsed = Number(body.weddings_per_year);
    if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 500) {
      weddings_per_year = parsed;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `INSERT INTO planner_waitlist
         (full_name, email, phone, company_name, city, years_experience, message, selected_plan, website, weddings_per_year, usage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      full_name,
      email,
      phone,
      company_name,
      city,
      years_experience,
      message,
      selected_plan,
      website,
      weddings_per_year,
      usage,
      now,
    ) as PlannerWaitlistRow;

  return json(
    {
      entry: {
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        status: row.status,
        created_at: row.created_at,
      },
    },
    { status: 201 },
  );
}

function handleAdminList(ctx: Ctx): Response {
  requireAdmin(ctx);
  const status = ctx.url.searchParams.get("status");
  let rows: PlannerWaitlistRow[];
  if (status) {
    rows = db
      .prepare("SELECT * FROM planner_waitlist WHERE status = ? ORDER BY created_at DESC")
      .all(status) as PlannerWaitlistRow[];
  } else {
    rows = db
      .prepare("SELECT * FROM planner_waitlist ORDER BY created_at DESC")
      .all() as PlannerWaitlistRow[];
  }
  return json({ entries: rows.map(toAdminView) });
}

async function handleAdminDecide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const outcome = trimStr(body.outcome);
  const notes = trimStr(body.notes);

  if (!VALID_OUTCOMES.has(outcome as PlannerWaitlistOutcome)) {
    throw new HttpError(400, "outcome must be under_review | accepted | rejected");
  }

  const existing = db
    .prepare("SELECT * FROM planner_waitlist WHERE id = ?")
    .get(id) as PlannerWaitlistRow | null;
  if (!existing) throw new HttpError(404, "Not found");

  const now = Math.floor(Date.now() / 1000);
  const updated = db
    .prepare(
      `UPDATE planner_waitlist
          SET status = ?, reviewed_by_user_id = ?, reviewed_at = ?, outcome_at = ?, notes = ?
        WHERE id = ?
        RETURNING *`,
    )
    .get(outcome, admin.id, now, now, notes || null, id) as PlannerWaitlistRow | null;

  return json({ entry: updated ? toAdminView(updated) : null });
}

async function handleAdminReopen(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");

  const existing = db
    .prepare("SELECT * FROM planner_waitlist WHERE id = ?")
    .get(id) as PlannerWaitlistRow | null;
  if (!existing) throw new HttpError(404, "Not found");

  const now = Math.floor(Date.now() / 1000);
  const updated = db
    .prepare(
      `UPDATE planner_waitlist
          SET status = 'new', reviewed_by_user_id = ?, reviewed_at = ?, outcome_at = NULL
        WHERE id = ?
        RETURNING *`,
    )
    .get(admin.id, now, id) as PlannerWaitlistRow | null;

  return json({ entry: updated ? toAdminView(updated) : null });
}

export function registerPlannerWaitlistRoutes(router: Router) {
  router.post("/api/planners/waitlist", handleSubmit);
  router.get("/api/admin/planner-waitlist", handleAdminList, true);
  router.post("/api/admin/planner-waitlist/:id/decide", handleAdminDecide, true);
  router.post("/api/admin/planner-waitlist/:id/reopen", handleAdminReopen, true);
}
