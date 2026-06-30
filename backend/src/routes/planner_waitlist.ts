// Planner waitlist — public submission (anon POST) + admin triage endpoints.
// Phase 1: data collection only. No triage email flow yet.

import { PRIVACY_VERSION } from "@shared/legal";
import type { PlannerWaitlistOutcome } from "@shared/planner_waitlist";
import { db } from "../db";
import { grantPlannerAccount } from "../domain/planner";
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
  km_radius: number | null;
  wedding_style_1: string | null;
  wedding_style_2: string | null;
  wedding_style_3: string | null;
  other_style: string | null;
  reference_links: string | null;
  early_bird: number;
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
    km_radius: row.km_radius ?? null,
    wedding_style_1: row.wedding_style_1 ?? null,
    wedding_style_2: row.wedding_style_2 ?? null,
    wedding_style_3: row.wedding_style_3 ?? null,
    other_style: row.other_style ?? null,
    reference_links: row.reference_links ?? null,
    early_bird: row.early_bird === 1,
    created_at: row.created_at,
  };
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "planner_waitlist", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<Record<string, unknown>>(ctx.req);
  const full_name = trimStr(body.full_name);
  const email = trimStr(body.email);
  const phone = trimStr(body.phone) || null;
  const company_name = trimStr(body.company_name) || null;
  const city = trimStr(body.city) || null;
  const message = trimStr(body.message) || null;
  const privacy_version = trimStr(body.privacy_version);

  if (!full_name) throw new HttpError(400, "full_name required");
  if (!email || !email.includes("@")) throw new HttpError(400, "valid email required");
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
    if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 9999) {
      weddings_per_year = parsed;
    }
  }

  let km_radius: number | null = null;
  if (body.km_radius !== undefined && body.km_radius !== null && body.km_radius !== "") {
    const parsed = Number(body.km_radius);
    if (!Number.isNaN(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 5000) {
      km_radius = parsed;
    }
  }

  const wedding_style_1 = trimStr(body.wedding_style_1) || null;
  const wedding_style_2 = trimStr(body.wedding_style_2) || null;
  const wedding_style_3 = trimStr(body.wedding_style_3) || null;
  const other_style = trimStr(body.other_style) || null;
  const reference_links = trimStr(body.reference_links) || null;
  const early_bird = body.early_bird === true ? 1 : 0;

  const now = Math.floor(Date.now() / 1000);
  // Auto-accept: applying to the waitlist now grants the planner account
  // immediately, no admin review gate. The admin triage list stays for
  // visibility, but `status` lands as 'accepted' on submit.
  const row = db
    .prepare(
      `INSERT INTO planner_waitlist
         (full_name, email, phone, company_name, city, years_experience, message, selected_plan, website,
          weddings_per_year, usage, km_radius, wedding_style_1, wedding_style_2, wedding_style_3,
          other_style, reference_links, early_bird, status, outcome_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)
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
      km_radius,
      wedding_style_1,
      wedding_style_2,
      wedding_style_3,
      other_style,
      reference_links,
      early_bird,
      now,
      now,
    ) as PlannerWaitlistRow;

  // If the applicant is already signed in, grant the planner account right
  // away so they can head straight to onboarding. A logged-out applicant gets
  // promoted at register time (handleRegister joins the waitlist by email).
  if (ctx.userId) grantPlannerAccount(ctx.userId, selected_plan);

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
