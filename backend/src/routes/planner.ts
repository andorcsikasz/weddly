import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { sniffUploadedImage } from "../lib/image_sniff";
import { keyFromUploadUrl, storage } from "../lib/storage";
import { getCoupleById, toCouple } from "../domain/couples";
import { sendKind } from "../domain/emails/send";
import { isPlannerPlan, plannerPlanMaxClients, waitlistPlanToPlannerPlan } from "../domain/planner";
import {
  createPlannerInvitation,
  getPlannerInvitationByToken,
  pendingInvitationCount,
  toPlannerInvitation,
} from "../domain/planner_invitations";
import type {
  PlannerEvent,
  PlannerPlan,
  PlannerPortfolioItem,
  PlannerProfile,
  PlannerWaitlistPrefill,
} from "@shared/types";

// Avatar + portfolio image uploads — JPEG/PNG/WebP up to 5 MB, mirroring the
// vendor listing hero upload (sniffed magic bytes, not the client content-type).
const MAX_PLANNER_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_IMAGE_MIMES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Read + validate a single uploaded image from a multipart `file` field and
 *  return its raw File plus the sniffed extension. Shared by avatar + portfolio. */
async function readUploadedImage(ctx: Ctx): Promise<{ file: File; ext: string }> {
  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required");
  });
  const raw = form.get("file");
  if (!(raw instanceof File)) throw new HttpError(400, "`file` field required");
  if (raw.size <= 0) throw new HttpError(400, "Empty file");
  if (raw.size > MAX_PLANNER_IMAGE_BYTES) {
    throw new HttpError(413, `File too large (max ${MAX_PLANNER_IMAGE_BYTES / 1024 / 1024} MB)`);
  }
  const sniffed = await sniffUploadedImage(raw);
  const ext = sniffed ? SUPPORTED_IMAGE_MIMES[sniffed] : undefined;
  if (!ext) throw new HttpError(415, "File contents are not a valid image (JPEG, PNG or WebP)");
  return { file: raw, ext };
}

interface PlannerPortfolioRow {
  id: number;
  title: string;
  description: string;
  image_url: string | null;
  sort_order: number;
  created_at: number;
}

function toPortfolioItem(r: PlannerPortfolioRow): PlannerPortfolioItem {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    image_url: r.image_url,
    sort_order: r.sort_order,
    created_at: r.created_at,
  };
}

function listPortfolio(userId: number): PlannerPortfolioItem[] {
  const rows = db
    .prepare(
      "SELECT id, title, description, image_url, sort_order, created_at FROM planner_portfolio WHERE planner_user_id = ? ORDER BY sort_order ASC, id ASC",
    )
    .all(userId) as PlannerPortfolioRow[];
  return rows.map(toPortfolioItem);
}

interface PlannerEventRow {
  id: number;
  couple_id: number | null;
  title: string;
  event_date: string;
  start_time: string | null;
  notes: string | null;
  created_at: number;
}

function toPlannerEvent(r: PlannerEventRow): PlannerEvent {
  return {
    id: r.id,
    couple_id: r.couple_id,
    title: r.title,
    event_date: r.event_date,
    start_time: r.start_time,
    notes: r.notes,
    created_at: r.created_at,
  };
}

/** YYYY-MM-DD with a real calendar check (rejects 2026-13-40). */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** HH:MM 24-hour clock. */
function isHhMm(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function requirePlannerAuth(ctx: Ctx): number {
  const userId = requireAuth(ctx);
  const user = db.prepare("SELECT user_type FROM users WHERE id = ?").get(userId) as
    | { user_type: string }
    | undefined;
  if (!user || user.user_type !== "planner") {
    throw new HttpError(403, "Planner account required");
  }
  return userId;
}

async function handleListClients(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const rows = db
    .prepare(
      `SELECT pc.couple_id, pc.status, pc.created_at, pc.notes,
              c.bride_name, c.groom_name, c.display_name, c.wedding_date,
              c.status AS couple_status,
              (SELECT u.email FROM users u WHERE u.couple_id = c.id LIMIT 1) AS primary_email,
              (SELECT COUNT(*) FROM guests g WHERE g.couple_id = c.id AND g.rsvp_status = 'yes') AS confirmed_guests,
              (SELECT COUNT(*) FROM planning_items pi WHERE pi.couple_id = c.id AND pi.kind = 'task') AS task_total,
              (SELECT COUNT(*) FROM planning_items pi WHERE pi.couple_id = c.id AND pi.kind = 'task' AND pi.done = 1) AS task_done,
              (SELECT COUNT(*) FROM planning_items pi WHERE pi.couple_id = c.id AND pi.kind = 'task' AND pi.done = 0 AND pi.due_date IS NOT NULL AND pi.due_date < date('now')) AS task_overdue
         FROM planner_clients pc
         JOIN couples c ON c.id = pc.couple_id
        WHERE pc.planner_user_id = ?
        ORDER BY pc.created_at DESC`,
    )
    .all(userId) as Array<{
    couple_id: number;
    status: string;
    created_at: number;
    notes: string | null;
    primary_email: string | null;
    bride_name: string;
    groom_name: string;
    display_name: string | null;
    wedding_date: string | null;
    couple_status: string;
    confirmed_guests: number;
    task_total: number;
    task_done: number;
    task_overdue: number;
  }>;

  return json({
    clients: rows.map((r) => ({
      couple_id: r.couple_id,
      status: r.status,
      display_name: r.display_name ?? `${r.bride_name} & ${r.groom_name}`,
      bride_name: r.bride_name,
      groom_name: r.groom_name,
      wedding_date: r.wedding_date,
      couple_status: r.couple_status,
      confirmed_guests: r.confirmed_guests,
      linked_at: r.created_at,
      notes: r.notes,
      primary_email: r.primary_email,
      task_summary: { total: r.task_total, done: r.task_done, overdue: r.task_overdue },
    })),
  });
}

async function handleAddClient(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const body = await readJson<{ email?: unknown }>(ctx.req);
  if (typeof body.email !== "string" || !body.email.trim()) {
    throw new HttpError(400, "email required");
  }
  const email = body.email.trim().toLowerCase();

  const target = db.prepare("SELECT id, couple_id FROM users WHERE LOWER(email) = ?").get(email) as
    | { id: number; couple_id: number | null }
    | undefined;
  if (!target) throw new HttpError(404, "No user found with that email");
  if (!target.couple_id) {
    throw new HttpError(400, "That user has not set up a wedding workspace yet");
  }

  const couple = getCoupleById(target.couple_id);
  if (!couple || couple.status === "deleting") {
    throw new HttpError(400, "Workspace unavailable");
  }

  const existing = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(userId, target.couple_id);
  if (existing) throw new HttpError(409, "This couple is already linked to your account");

  const plannerRow = db.prepare("SELECT planner_max_clients FROM users WHERE id = ?").get(userId) as
    | { planner_max_clients: number | null }
    | undefined;
  const maxClients = plannerRow?.planner_max_clients ?? 4;
  // Count pending requests AND active clients against the cap. Pending grants
  // no access, but bounding outstanding requests stops a planner from blasting
  // a consent-request email at unlimited couples (each insert sends one).
  const usedCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM planner_clients WHERE planner_user_id = ? AND status IN ('active', 'pending')",
      )
      .get(userId) as { cnt: number }
  ).cnt;
  if (usedCount >= maxClients) {
    throw new HttpError(422, "Client limit reached for your plan");
  }

  // Consent-gated: the planner REQUESTS access (status='pending',
  // initiated_by='planner'); the couple must accept before the planner can
  // enter the workspace. handleEnterClient requires 'active', so a pending
  // request grants nothing until the couple approves.
  const targetUser = db.prepare("SELECT email, full_name FROM users WHERE id = ?").get(target.id) as
    | { email: string; full_name: string | null }
    | undefined;
  await requestCoupleAccess(userId, target.couple_id, {
    id: target.id,
    email: targetUser?.email ?? "",
    full_name: targetUser?.full_name ?? null,
  });

  return json({ ok: true, status: "pending", couple_id: target.couple_id });
}

/** Planner's outward label (business name → full name → fallback) plus their
 *  email for Reply-To headers. */
function plannerLabelAndEmail(plannerUserId: number): { label: string; email: string | undefined } {
  const planner = db
    .prepare("SELECT full_name, business_name, email FROM users WHERE id = ?")
    .get(plannerUserId) as
    | { full_name: string | null; business_name: string | null; email: string }
    | undefined;
  const label = planner?.business_name?.trim() || planner?.full_name?.trim() || "Egy tervező";
  return { label, email: planner?.email };
}

/** Create a pending, planner-initiated access request against a couple that
 *  already has a workspace, and email the couple to approve it. Shared by the
 *  add-existing-couple path and the email-invitation path when the invitee
 *  turns out to be already onboarded. The caller has enforced the client cap.
 *  Throws 409 if a link already exists. */
async function requestCoupleAccess(
  plannerUserId: number,
  coupleId: number,
  targetUser: { id: number; email: string; full_name: string | null },
): Promise<void> {
  const existing = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(plannerUserId, coupleId);
  if (existing) throw new HttpError(409, "This couple is already linked to your account");

  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at) VALUES (?, ?, 'pending', 'planner', ?)",
  ).run(plannerUserId, coupleId, now());

  addAuditLog({
    actor_user_id: plannerUserId,
    couple_id: coupleId,
    action: "planner.request_client",
    target_kind: "couple",
    target_id: coupleId,
    note: `access requested by planner ${plannerUserId}`,
  });

  const { label, email: replyToEmail } = plannerLabelAndEmail(plannerUserId);
  if (targetUser.email) {
    await sendKind(
      "planner_access_requested",
      { plannerLabel: label, replyToEmail },
      {
        user: { id: targetUser.id, email: targetUser.email, full_name: targetUser.full_name ?? "" },
        couple_id: coupleId,
      },
    );
  }
}

/** Planner switches guest-page (vendégoldal) editing on/off for a client. The
 *  couple is viewer-only by default once their free window lapses (the planner
 *  edits); this hands back edit access to their own guest page as an extra. The
 *  planner can only switch it ON once the couple has prepaid their 30% share
 *  (`guest_page_prepaid`) via the 70%-off add-on checkout. */
async function handleSetGuestPageAccess(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const link = db
    .prepare(
      "SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ? AND status = 'active'",
    )
    .get(userId, coupleId);
  if (!link) throw new HttpError(403, "Not linked to this workspace");

  const body = await readJson<{ enabled?: unknown }>(ctx.req);
  const enabled = body.enabled === true;

  const couple = getCoupleById(coupleId);
  if (!couple) throw new HttpError(404, "Couple not found");
  if (enabled && !couple.guest_page_prepaid) {
    throw new HttpError(402, "The couple must purchase the guest-page add-on first", {
      code: "guest_page_not_prepaid",
    });
  }

  db.prepare("UPDATE couples SET guest_page_addon = ?, updated_at = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    now(),
    coupleId,
  );
  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.guest_page_addon",
    target_kind: "couple",
    target_id: coupleId,
    after: { enabled },
  });
  return json({ ok: true, guest_page_addon: enabled });
}

// ─── Planner email invitations (invite a stranger by email) ──────────────────

/** Count the planner's outstanding clients against their plan cap: active +
 *  pending links plus still-open email invitations. */
function plannerSeatsUsed(plannerUserId: number): number {
  const links = (
    db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM planner_clients WHERE planner_user_id = ? AND status IN ('active', 'pending')",
      )
      .get(plannerUserId) as { cnt: number }
  ).cnt;
  return links + pendingInvitationCount(plannerUserId);
}

function plannerMaxClients(plannerUserId: number): number {
  const row = db.prepare("SELECT planner_max_clients FROM users WHERE id = ?").get(plannerUserId) as
    | { planner_max_clients: number | null }
    | undefined;
  return row?.planner_max_clients ?? 4;
}

async function handleListInvitations(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const rows = db
    .prepare(
      "SELECT * FROM planner_invitations WHERE planner_user_id = ? AND status != 'revoked' ORDER BY created_at DESC",
    )
    .all(userId) as Parameters<typeof toPlannerInvitation>[0][];
  return json({ invitations: rows.map(toPlannerInvitation) });
}

/** Invite anyone by email to become a client. If the email already belongs to a
 *  user with a workspace, this falls through to the consent-request flow (same
 *  as Add client). Otherwise it sends a signup invitation; when the invitee
 *  later onboards, a pending access request is created for the couple to
 *  approve. Either way the couple approves before the planner gains access. */
async function handleCreateInvitation(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const body = await readJson<{ email?: unknown }>(ctx.req);
  if (typeof body.email !== "string" || !body.email.includes("@") || !body.email.trim()) {
    throw new HttpError(400, "valid email required");
  }
  const email = body.email.trim().toLowerCase();

  if (plannerSeatsUsed(userId) >= plannerMaxClients(userId)) {
    throw new HttpError(422, "Client limit reached for your plan");
  }

  // Already a Weddly user with a workspace → standard consent request.
  const target = db.prepare("SELECT id, couple_id FROM users WHERE LOWER(email) = ?").get(email) as
    | { id: number; couple_id: number | null }
    | undefined;
  if (target?.couple_id) {
    const couple = getCoupleById(target.couple_id);
    if (!couple || couple.status === "deleting") throw new HttpError(400, "Workspace unavailable");
    const targetUser = db.prepare("SELECT email, full_name FROM users WHERE id = ?").get(target.id) as
      | { email: string; full_name: string | null }
      | undefined;
    await requestCoupleAccess(userId, target.couple_id, {
      id: target.id,
      email: targetUser?.email ?? "",
      full_name: targetUser?.full_name ?? null,
    });
    return json({ kind: "request", couple_id: target.couple_id });
  }

  // Otherwise: send an email invitation. Dedupe outstanding invites per email.
  const dup = db
    .prepare(
      "SELECT id FROM planner_invitations WHERE planner_user_id = ? AND LOWER(email) = ? AND status = 'pending'",
    )
    .get(userId, email);
  if (dup) throw new HttpError(409, "You've already invited this email");

  const invite = createPlannerInvitation(userId, email);
  const { label, email: replyToEmail } = plannerLabelAndEmail(userId);
  const inviteUrl = `${CONFIG.frontendBaseUrl}/register?planner_invite=${invite.token}`;

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "planner.email_invite",
    target_kind: "user",
    target_id: userId,
    note: `invited ${email}`,
  });

  await sendKind(
    "planner_email_invite",
    { plannerLabel: label, inviteUrl, replyToEmail },
    { user: null, guest: { email, full_name: "" } },
  );

  return json({ kind: "invite", invitation: toPlannerInvitation(invite) });
}

async function handleRevokeInvitation(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const id = Number(ctx.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "id required");
  db.prepare(
    "UPDATE planner_invitations SET status = 'revoked' WHERE id = ? AND planner_user_id = ? AND status = 'pending'",
  ).run(id, userId);
  return json({ ok: true });
}

/** Public: surface who invited you on the signup page. */
async function handleLookupInvitation(ctx: Ctx): Promise<Response> {
  const token = String(ctx.params?.token ?? "");
  const invite = getPlannerInvitationByToken(token);
  if (!invite || invite.status !== "pending") throw new HttpError(404, "Invitation not found");
  if (invite.expires_at != null && invite.expires_at < now()) {
    throw new HttpError(410, "Invitation expired");
  }
  const { label } = plannerLabelAndEmail(invite.planner_user_id);
  return json({ planner_label: label, email: invite.email });
}

async function handleEnterClient(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) {
    throw new HttpError(400, "coupleId required");
  }

  const link = db
    .prepare(
      "SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ? AND status = 'active'",
    )
    .get(userId, coupleId);
  if (!link) throw new HttpError(403, "Not linked to this workspace");

  const couple = getCoupleById(coupleId);
  if (!couple || couple.status === "deleting") {
    throw new HttpError(400, "Workspace unavailable");
  }

  db.prepare("UPDATE users SET couple_id = ?, updated_at = ? WHERE id = ?").run(
    coupleId,
    now(),
    userId,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.enter_client",
    target_kind: "couple",
    target_id: coupleId,
  });

  return json({ couple: toCouple(couple) });
}

async function handleExit(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const user = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(userId) as
    | { couple_id: number | null }
    | undefined;

  const prevCoupleId = user?.couple_id ?? null;
  db.prepare("UPDATE users SET couple_id = NULL, updated_at = ? WHERE id = ?").run(now(), userId);

  if (prevCoupleId != null) {
    addAuditLog({
      actor_user_id: userId,
      couple_id: prevCoupleId,
      action: "planner.exit_client",
      target_kind: "couple",
      target_id: prevCoupleId,
    });
  }

  return json({ ok: true });
}

async function handleUpdateNotes(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const body = await readJson<{ notes?: unknown }>(ctx.req);
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  const link = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(userId, coupleId);
  if (!link) throw new HttpError(403, "Not linked to this workspace");

  db.prepare(
    "UPDATE planner_clients SET notes = ? WHERE planner_user_id = ? AND couple_id = ?",
  ).run(notes, userId, coupleId);

  return json({ ok: true });
}

async function handleGetClientCrm(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const row = db
    .prepare(
      `SELECT pc.couple_id, pc.notes, pc.client_phone, pc.client_alt_email, pc.lead_source,
              pc.contract_value, pc.deposit_paid, pc.stage,
              c.bride_name, c.groom_name, c.display_name, c.wedding_date,
              (SELECT u.email FROM users u WHERE u.couple_id = c.id LIMIT 1) AS primary_email,
              (SELECT COUNT(*) FROM guests g WHERE g.couple_id = c.id AND g.rsvp_status = 'yes') AS confirmed_guests,
              (SELECT COUNT(*) FROM planning_items pi WHERE pi.couple_id = c.id AND pi.kind = 'task') AS task_total,
              (SELECT COUNT(*) FROM planning_items pi WHERE pi.couple_id = c.id AND pi.kind = 'task' AND pi.done = 1) AS task_done,
              (SELECT COUNT(*) FROM planning_items pi WHERE pi.couple_id = c.id AND pi.kind = 'task' AND pi.done = 0 AND pi.due_date IS NOT NULL AND pi.due_date < date('now')) AS task_overdue
         FROM planner_clients pc
         JOIN couples c ON c.id = pc.couple_id
        WHERE pc.planner_user_id = ? AND pc.couple_id = ?`,
    )
    .get(userId, coupleId) as
    | {
        couple_id: number;
        notes: string | null;
        client_phone: string | null;
        client_alt_email: string | null;
        lead_source: string | null;
        contract_value: number | null;
        deposit_paid: number | null;
        stage: string | null;
        bride_name: string;
        groom_name: string;
        display_name: string | null;
        wedding_date: string | null;
        primary_email: string | null;
        confirmed_guests: number;
        task_total: number;
        task_done: number;
        task_overdue: number;
      }
    | undefined;

  if (!row) throw new HttpError(403, "Not linked to this workspace");

  return json({
    couple_id: row.couple_id,
    display_name: row.display_name ?? `${row.bride_name} & ${row.groom_name}`,
    bride_name: row.bride_name,
    groom_name: row.groom_name,
    wedding_date: row.wedding_date,
    primary_email: row.primary_email,
    confirmed_guests: row.confirmed_guests,
    task_summary: { total: row.task_total, done: row.task_done, overdue: row.task_overdue },
    notes: row.notes,
    client_phone: row.client_phone,
    client_alt_email: row.client_alt_email,
    lead_source: row.lead_source,
    contract_value: row.contract_value,
    deposit_paid: row.deposit_paid,
    stage: row.stage ?? "active",
  });
}

async function handleUpdateClientCrm(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const link = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(userId, coupleId);
  if (!link) throw new HttpError(403, "Not linked to this workspace");

  const body = await readJson<Record<string, unknown>>(ctx.req);

  const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : undefined);
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : undefined;

  const fields: Record<string, unknown> = {};
  if (str(body.client_phone) !== undefined) fields["client_phone"] = str(body.client_phone);
  if (str(body.client_alt_email) !== undefined)
    fields["client_alt_email"] = str(body.client_alt_email);
  if (str(body.lead_source) !== undefined) fields["lead_source"] = str(body.lead_source);
  if (num(body.contract_value) !== undefined) fields["contract_value"] = num(body.contract_value);
  if (num(body.deposit_paid) !== undefined) fields["deposit_paid"] = num(body.deposit_paid);
  if (str(body.stage) !== undefined) fields["stage"] = str(body.stage);
  if ("notes" in body) fields["notes"] = str(body.notes);

  if (Object.keys(fields).length === 0) return json({ ok: true });

  const setClauses = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(", ");
  db.prepare(
    `UPDATE planner_clients SET ${setClauses} WHERE planner_user_id = ? AND couple_id = ?`,
  ).run(...(Object.values(fields) as (string | number | null)[]), userId, coupleId);

  return json({ ok: true });
}

async function handleListTasks(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const rows = db
    .prepare(
      `SELECT pi.id AS task_id, pi.couple_id, pi.title, pi.due_date, pi.priority, pi.done,
              COALESCE(c.display_name, c.bride_name || ' & ' || c.groom_name) AS display_name
         FROM planning_items pi
         JOIN planner_clients pc ON pc.couple_id = pi.couple_id AND pc.planner_user_id = ?
         JOIN couples c ON c.id = pi.couple_id
        WHERE pi.kind = 'task'
          AND pi.done = 0
          AND pi.due_date IS NOT NULL
        ORDER BY pi.due_date ASC
        LIMIT 50`,
    )
    .all(userId) as Array<{
    task_id: number;
    couple_id: number;
    title: string;
    due_date: string;
    priority: number;
    done: number;
    display_name: string;
  }>;

  return json({ tasks: rows.map((r) => ({ ...r, done: r.done === 1 })) });
}

async function handleListInbox(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const rows = db
    .prepare(
      `SELECT pm.couple_id,
              COALESCE(c.display_name, c.bride_name || ' & ' || c.groom_name) AS display_name,
              MAX(pm.created_at) AS last_at,
              COUNT(*) AS message_count,
              (SELECT pm2.subject FROM planner_messages pm2
                WHERE pm2.planner_user_id = pm.planner_user_id AND pm2.couple_id = pm.couple_id
                ORDER BY pm2.created_at DESC LIMIT 1) AS last_subject
         FROM planner_messages pm
         JOIN couples c ON c.id = pm.couple_id
        WHERE pm.planner_user_id = ?
        GROUP BY pm.couple_id
        ORDER BY last_at DESC`,
    )
    .all(userId) as Array<{
    couple_id: number;
    display_name: string;
    last_at: number;
    message_count: number;
    last_subject: string;
  }>;

  return json({ threads: rows });
}

async function handleListThread(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const link = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(userId, coupleId);
  if (!link) throw new HttpError(403, "Not linked to this workspace");

  const messages = db
    .prepare(
      `SELECT id, direction, subject, body_text, recipient_email, status, created_at
         FROM planner_messages
        WHERE planner_user_id = ? AND couple_id = ?
        ORDER BY created_at ASC`,
    )
    .all(userId, coupleId) as Array<{
    id: number;
    direction: string;
    subject: string;
    body_text: string;
    recipient_email: string;
    status: string;
    created_at: number;
  }>;

  return json({ messages });
}

async function handleSendMessage(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const link = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(userId, coupleId);
  if (!link) throw new HttpError(403, "Not linked to this workspace");

  const body = await readJson<{
    subject?: unknown;
    body_text?: unknown;
    recipient_email?: unknown;
  }>(ctx.req);
  if (typeof body.subject !== "string" || !body.subject.trim())
    throw new HttpError(400, "subject required");
  if (typeof body.body_text !== "string" || !body.body_text.trim())
    throw new HttpError(400, "body_text required");
  if (typeof body.recipient_email !== "string" || !body.recipient_email.trim())
    throw new HttpError(400, "recipient_email required");

  const subject = body.subject.trim();
  const bodyText = body.body_text.trim();
  const recipientEmail = body.recipient_email.trim().toLowerCase();

  const planner = db.prepare("SELECT full_name, email FROM users WHERE id = ?").get(userId) as
    | { full_name: string; email: string }
    | undefined;
  if (!planner) throw new HttpError(500, "planner not found");

  const ts = now();
  db.prepare(
    `INSERT INTO planner_messages (planner_user_id, couple_id, direction, subject, body_text, recipient_email, status, created_at)
     VALUES (?, ?, 'out', ?, ?, ?, 'sent', ?)`,
  ).run(userId, coupleId, subject, bodyText, recipientEmail, ts);

  const msgId = (db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

  // Resolve the recipient to a Weddly user when one matches the typed address
  // (the couple owner, usually) so the mail renders in their locale + attaches
  // to the email log. Otherwise treat it as a plain addressee.
  const recipientUser = db
    .prepare("SELECT id, email, full_name FROM users WHERE LOWER(email) = ?")
    .get(recipientEmail) as { id: number; email: string; full_name: string | null } | undefined;

  await sendKind(
    "planner_message",
    {
      subject,
      bodyText,
      senderName: planner.full_name,
      senderEmail: planner.email,
    },
    recipientUser
      ? {
          user: {
            id: recipientUser.id,
            email: recipientUser.email,
            full_name: recipientUser.full_name ?? "",
          },
          couple_id: coupleId,
        }
      : {
          user: null,
          couple_id: coupleId,
          guest: { email: recipientEmail, full_name: "" },
        },
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.send_message",
    target_kind: "couple",
    target_id: coupleId,
    note: subject,
  });

  return json({
    message: {
      id: msgId,
      direction: "out",
      subject,
      body_text: bodyText,
      recipient_email: recipientEmail,
      status: "sent",
      created_at: ts,
    },
  });
}

// ─── M3: Planner profile ──────────────────────────────────────────────────────

interface PlannerUserRow {
  full_name: string;
  email: string;
  business_name: string | null;
  planner_bio: string | null;
  planner_city: string | null;
  planner_website: string | null;
  planner_phone: string | null;
  planner_weddings_per_year: number | null;
  planner_km_radius: number | null;
  planner_styles: string | null;
  planner_plan: string | null;
  planner_avatar_url: string | null;
}

const PLANNER_PROFILE_COLUMNS =
  "full_name, email, business_name, planner_bio, planner_city, planner_website, planner_phone, " +
  "planner_weddings_per_year, planner_km_radius, planner_styles, planner_plan, planner_avatar_url";

/** Parse a planner_styles JSON column into a clean string[] (or null). */
function parseStyles(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const styles = parsed.filter((s): s is string => typeof s === "string" && s.length > 0);
      return styles.length ? styles : null;
    }
  } catch {
    /* legacy/garbage value — treat as empty */
  }
  return null;
}

function toPlannerProfileBase(
  row: PlannerUserRow,
  userId: number,
): Omit<PlannerProfile, "waitlist_prefill"> {
  return {
    full_name: row.full_name,
    email: row.email,
    business_name: row.business_name,
    planner_bio: row.planner_bio,
    planner_city: row.planner_city,
    planner_website: row.planner_website,
    planner_phone: row.planner_phone,
    planner_weddings_per_year: row.planner_weddings_per_year,
    planner_km_radius: row.planner_km_radius,
    planner_styles: parseStyles(row.planner_styles),
    planner_plan: (row.planner_plan as PlannerPlan | null) ?? "starter",
    planner_avatar_url: row.planner_avatar_url,
    portfolio: listPortfolio(userId),
  };
}

async function handleGetProfile(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const row = db.prepare(`SELECT ${PLANNER_PROFILE_COLUMNS} FROM users WHERE id = ?`).get(userId) as
    | PlannerUserRow
    | undefined;
  if (!row) throw new HttpError(404, "planner not found");

  const waitlistRow = db
    .prepare(
      `SELECT full_name, phone, company_name, city, website,
              weddings_per_year, km_radius,
              wedding_style_1, wedding_style_2, wedding_style_3, other_style,
              reference_links, message, selected_plan
         FROM planner_waitlist
        WHERE LOWER(email) = LOWER(?)
        ORDER BY id DESC LIMIT 1`,
    )
    .get(row.email) as
    | {
        full_name: string | null;
        phone: string | null;
        company_name: string | null;
        city: string | null;
        website: string | null;
        weddings_per_year: number | null;
        km_radius: number | null;
        wedding_style_1: string | null;
        wedding_style_2: string | null;
        wedding_style_3: string | null;
        other_style: string | null;
        reference_links: string | null;
        message: string | null;
        selected_plan: string | null;
      }
    | undefined;

  const prefill: PlannerWaitlistPrefill | null = waitlistRow
    ? {
        full_name: waitlistRow.full_name,
        phone: waitlistRow.phone,
        company_name: waitlistRow.company_name,
        city: waitlistRow.city,
        website: waitlistRow.website,
        weddings_per_year: waitlistRow.weddings_per_year,
        km_radius: waitlistRow.km_radius,
        styles: [
          waitlistRow.wedding_style_1,
          waitlistRow.wedding_style_2,
          waitlistRow.wedding_style_3,
          waitlistRow.other_style,
        ].filter((s): s is string => !!s && s.trim().length > 0),
        reference_links: waitlistRow.reference_links,
        bio: waitlistRow.message,
        selected_plan:
          waitlistRow.selected_plan === "basic" ||
          waitlistRow.selected_plan === "pro" ||
          waitlistRow.selected_plan === "unlimited"
            ? waitlistRow.selected_plan
            : null,
        mapped_plan: waitlistPlanToPlannerPlan(waitlistRow.selected_plan),
      }
    : null;

  return json({ ...toPlannerProfileBase(row, userId), waitlist_prefill: prefill });
}

async function handleUpdateProfile(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const body = await readJson<{
    full_name?: unknown;
    business_name?: unknown;
    planner_bio?: unknown;
    planner_city?: unknown;
    planner_website?: unknown;
    planner_phone?: unknown;
    planner_weddings_per_year?: unknown;
    planner_km_radius?: unknown;
    planner_styles?: unknown;
    planner_plan?: unknown;
  }>(ctx.req);

  const fields: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vals: any[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : undefined);
  // Integer or null (when explicitly cleared); undefined = leave untouched.
  const intOrNull = (v: unknown) => {
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    return undefined;
  };

  const fn = str(body.full_name);
  if (fn !== undefined) {
    fields.push("full_name = ?");
    vals.push(fn ?? "");
  }
  const bn = str(body.business_name);
  if (bn !== undefined) {
    fields.push("business_name = ?");
    vals.push(bn);
  }
  const bio = str(body.planner_bio);
  if (bio !== undefined) {
    fields.push("planner_bio = ?");
    vals.push(bio);
  }
  const city = str(body.planner_city);
  if (city !== undefined) {
    fields.push("planner_city = ?");
    vals.push(city);
  }
  const web = str(body.planner_website);
  if (web !== undefined) {
    fields.push("planner_website = ?");
    vals.push(web);
  }
  const phone = str(body.planner_phone);
  if (phone !== undefined) {
    fields.push("planner_phone = ?");
    vals.push(phone);
  }
  const wpy = intOrNull(body.planner_weddings_per_year);
  if (wpy !== undefined) {
    fields.push("planner_weddings_per_year = ?");
    vals.push(wpy);
  }
  const km = intOrNull(body.planner_km_radius);
  if (km !== undefined) {
    fields.push("planner_km_radius = ?");
    vals.push(km);
  }
  if (Array.isArray(body.planner_styles)) {
    const styles = (body.planner_styles as unknown[]).filter(
      (s): s is string => typeof s === "string" && s.trim().length > 0,
    );
    fields.push("planner_styles = ?");
    vals.push(styles.length ? JSON.stringify(styles) : null);
  }
  // Plan confirm: keep planner_max_clients in lockstep with the chosen plan.
  if (body.planner_plan !== undefined) {
    if (!isPlannerPlan(body.planner_plan)) throw new HttpError(400, "invalid planner_plan");
    fields.push("planner_plan = ?");
    vals.push(body.planner_plan);
    fields.push("planner_max_clients = ?");
    vals.push(plannerPlanMaxClients(body.planner_plan));
  }

  if (fields.length > 0) {
    db.prepare(`UPDATE users SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).run(
      ...vals,
      now(),
      userId,
    );
  }

  const updated = db
    .prepare(`SELECT ${PLANNER_PROFILE_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as PlannerUserRow;
  return json(toPlannerProfileBase(updated, userId));
}

// ─── M4: Planner avatar + portfolio uploads ──────────────────────────────────

function reloadPlannerProfile(userId: number): Omit<PlannerProfile, "waitlist_prefill"> {
  const row = db
    .prepare(`SELECT ${PLANNER_PROFILE_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as PlannerUserRow;
  return toPlannerProfileBase(row, userId);
}

async function handleUploadAvatar(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const { file, ext } = await readUploadedImage(ctx);

  const key = `planners/${userId}/avatar.${ext}`;
  // Remove a previous avatar of a different extension (storage.write overwrites
  // same-name files in place, so this only matters on an ext transition).
  const prev = db.prepare("SELECT planner_avatar_url FROM users WHERE id = ?").get(userId) as
    | { planner_avatar_url: string | null }
    | undefined;
  const prevKey = prev?.planner_avatar_url ? keyFromUploadUrl(prev.planner_avatar_url) : null;
  if (prevKey && prevKey !== key) await storage.delete(prevKey);

  await storage.write(key, file);
  const ts = now();
  const publicUrl = `/uploads/${key}?v=${ts}`;
  db.prepare("UPDATE users SET planner_avatar_url = ?, updated_at = ? WHERE id = ?").run(
    publicUrl,
    ts,
    userId,
  );
  return json(reloadPlannerProfile(userId));
}

async function handleDeleteAvatar(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const prev = db.prepare("SELECT planner_avatar_url FROM users WHERE id = ?").get(userId) as
    | { planner_avatar_url: string | null }
    | undefined;
  const key = prev?.planner_avatar_url ? keyFromUploadUrl(prev.planner_avatar_url) : null;
  if (key) await storage.delete(key);
  db.prepare("UPDATE users SET planner_avatar_url = NULL, updated_at = ? WHERE id = ?").run(
    now(),
    userId,
  );
  return json(reloadPlannerProfile(userId));
}

async function handleAddPortfolio(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required");
  });
  const title = (form.get("title") as string | null)?.trim().slice(0, 120) ?? "";
  const description = (form.get("description") as string | null)?.trim().slice(0, 2000) ?? "";
  const raw = form.get("file");

  const ts = now();
  const nextSort =
    (
      db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM planner_portfolio WHERE planner_user_id = ?",
        )
        .get(userId) as { n: number }
    ).n ?? 1;

  // Insert first to mint a collision-free id, then name the image by that id.
  const inserted = db
    .prepare(
      "INSERT INTO planner_portfolio (planner_user_id, title, description, image_url, sort_order, created_at) VALUES (?, ?, ?, NULL, ?, ?) RETURNING id",
    )
    .get(userId, title, description, nextSort, ts) as { id: number };

  if (raw instanceof File && raw.size > 0) {
    if (raw.size > MAX_PLANNER_IMAGE_BYTES) {
      db.prepare("DELETE FROM planner_portfolio WHERE id = ?").run(inserted.id);
      throw new HttpError(413, `File too large (max ${MAX_PLANNER_IMAGE_BYTES / 1024 / 1024} MB)`);
    }
    const sniffed = await sniffUploadedImage(raw);
    const ext = sniffed ? SUPPORTED_IMAGE_MIMES[sniffed] : undefined;
    if (!ext) {
      db.prepare("DELETE FROM planner_portfolio WHERE id = ?").run(inserted.id);
      throw new HttpError(415, "File contents are not a valid image (JPEG, PNG or WebP)");
    }
    const key = `planners/${userId}/portfolio/${inserted.id}.${ext}`;
    await storage.write(key, raw);
    db.prepare("UPDATE planner_portfolio SET image_url = ? WHERE id = ?").run(
      `/uploads/${key}?v=${ts}`,
      inserted.id,
    );
  }

  return json({ portfolio: listPortfolio(userId) });
}

async function handleDeletePortfolio(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const id = Number(ctx.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "id required");

  const row = db
    .prepare("SELECT image_url FROM planner_portfolio WHERE id = ? AND planner_user_id = ?")
    .get(id, userId) as { image_url: string | null } | undefined;
  if (!row) throw new HttpError(404, "Not found");

  const key = row.image_url ? keyFromUploadUrl(row.image_url) : null;
  if (key) await storage.delete(key);
  db.prepare("DELETE FROM planner_portfolio WHERE id = ? AND planner_user_id = ?").run(id, userId);
  return json({ portfolio: listPortfolio(userId) });
}

// ─── M1: Planner invite accept/decline ───────────────────────────────────────

async function handleListInvites(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const rows = db
    .prepare(
      `SELECT pc.couple_id, pc.created_at,
              COALESCE(c.display_name, c.bride_name || ' & ' || c.groom_name) AS display_name,
              c.wedding_date
         FROM planner_clients pc
         JOIN couples c ON c.id = pc.couple_id
        WHERE pc.planner_user_id = ? AND pc.status = 'pending'
          AND pc.initiated_by = 'couple'
        ORDER BY pc.created_at DESC`,
    )
    .all(userId) as Array<{
    couple_id: number;
    created_at: number;
    display_name: string;
    wedding_date: string | null;
  }>;
  return json({
    invites: rows.map((r) => ({ ...r, status: "pending" as const })),
  });
}

async function handleAcceptInvite(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  // Only couple-initiated invites are acceptable by the planner. A planner can
  // NOT self-accept a request they themselves raised (initiated_by='planner') —
  // that would re-open the consent-less cross-tenant access this flow closes.
  const link = db
    .prepare(
      "SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ? AND status = 'pending' AND initiated_by = 'couple'",
    )
    .get(userId, coupleId);
  if (!link) throw new HttpError(404, "Invite not found");

  db.prepare(
    "UPDATE planner_clients SET status = 'active' WHERE planner_user_id = ? AND couple_id = ? AND initiated_by = 'couple'",
  ).run(userId, coupleId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.accept_invite",
    target_kind: "couple",
    target_id: coupleId,
  });

  return json({ ok: true });
}

async function handleDeclineInvite(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  db.prepare(
    "DELETE FROM planner_clients WHERE planner_user_id = ? AND couple_id = ? AND status = 'pending'",
  ).run(userId, coupleId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.decline_invite",
    target_kind: "couple",
    target_id: coupleId,
  });

  return json({ ok: true });
}

// ─── M1: Couple-side planner endpoints ───────────────────────────────────────

function requireCoupleAuth(ctx: Ctx): { userId: number; coupleId: number } {
  const userId = requireAuth(ctx);
  const user = db.prepare("SELECT couple_id FROM users WHERE id = ?").get(userId) as
    | { couple_id: number | null }
    | undefined;
  if (!user?.couple_id) throw new HttpError(403, "No couple workspace");
  return { userId, coupleId: user.couple_id };
}

async function handleListLinkedPlanners(ctx: Ctx): Promise<Response> {
  const { coupleId } = requireCoupleAuth(ctx);
  const rows = db
    .prepare(
      `SELECT pc.planner_user_id, pc.status, pc.initiated_by, pc.created_at,
              u.full_name, u.email, u.business_name, u.planner_city, u.planner_bio
         FROM planner_clients pc
         JOIN users u ON u.id = pc.planner_user_id
        WHERE pc.couple_id = ?
        ORDER BY pc.created_at DESC`,
    )
    .all(coupleId) as Array<{
    planner_user_id: number;
    status: string;
    initiated_by: string;
    created_at: number;
    full_name: string;
    email: string;
    business_name: string | null;
    planner_city: string | null;
    planner_bio: string | null;
  }>;
  return json({
    planners: rows.map((r) => ({ ...r, linked_at: r.created_at })),
  });
}

/** Couple-side approval of a planner-initiated access request. Flips the
 *  pending row (initiated_by='planner') to active so the planner can finally
 *  enter the workspace. The mirror of the planner's handleAcceptInvite — only
 *  the OTHER party can approve, so neither side can unilaterally grant access. */
async function handleAcceptPlannerRequest(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCoupleAuth(ctx);
  const plannerUserId = Number(ctx.params?.plannerUserId);
  if (!Number.isFinite(plannerUserId) || plannerUserId <= 0) {
    throw new HttpError(400, "plannerUserId required");
  }

  const link = db
    .prepare(
      "SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ? AND status = 'pending' AND initiated_by = 'planner'",
    )
    .get(plannerUserId, coupleId);
  if (!link) throw new HttpError(404, "No pending planner request found");

  // Enforce the planner's active-client ceiling at approval time too — the
  // limit check at request time is advisory; this is the one that gates access.
  const plannerRow = db
    .prepare("SELECT planner_max_clients FROM users WHERE id = ?")
    .get(plannerUserId) as { planner_max_clients: number | null } | undefined;
  const maxClients = plannerRow?.planner_max_clients ?? 4;
  const activeCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM planner_clients WHERE planner_user_id = ? AND status = 'active'",
      )
      .get(plannerUserId) as { cnt: number }
  ).cnt;
  if (activeCount >= maxClients) {
    throw new HttpError(422, "This planner has reached their client limit");
  }

  db.prepare(
    "UPDATE planner_clients SET status = 'active' WHERE planner_user_id = ? AND couple_id = ? AND initiated_by = 'planner'",
  ).run(plannerUserId, coupleId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.couple_accept",
    target_kind: "user",
    target_id: plannerUserId,
  });

  // Let the planner know they now have access.
  const planner = db
    .prepare("SELECT email, full_name FROM users WHERE id = ?")
    .get(plannerUserId) as { email: string; full_name: string | null } | undefined;
  const couple = db
    .prepare(
      "SELECT COALESCE(display_name, bride_name || ' & ' || groom_name) AS name FROM couples WHERE id = ?",
    )
    .get(coupleId) as { name: string } | undefined;
  if (planner?.email) {
    const coupleName = couple?.name ?? "Egy pár";
    await sendKind(
      "planner_access_approved",
      { coupleName },
      {
        user: { id: plannerUserId, email: planner.email, full_name: planner.full_name ?? "" },
        couple_id: coupleId,
      },
    );
  }

  return json({ ok: true });
}

async function handleInvitePlanner(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCoupleAuth(ctx);

  const body = await readJson<{ planner_email?: unknown }>(ctx.req);
  if (typeof body.planner_email !== "string" || !body.planner_email.trim()) {
    throw new HttpError(400, "planner_email required");
  }
  const plannerEmail = body.planner_email.trim().toLowerCase();

  const planner = db
    .prepare("SELECT id, user_type, email, full_name FROM users WHERE LOWER(email) = ?")
    .get(plannerEmail) as
    | { id: number; user_type: string; email: string; full_name: string | null }
    | undefined;
  if (!planner) throw new HttpError(404, "No planner found with that email");
  if (planner.user_type !== "planner") throw new HttpError(404, "No planner found with that email");

  const existing = db
    .prepare("SELECT id, status FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(planner.id, coupleId) as { id: number; status: string } | undefined;
  if (existing) throw new HttpError(409, "This planner is already linked to your account");

  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, 'pending', ?)",
  ).run(planner.id, coupleId, now());

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.couple_invite",
    target_kind: "user",
    target_id: planner.id,
    note: `invited planner ${plannerEmail}`,
  });

  const couple = db
    .prepare(
      "SELECT COALESCE(display_name, bride_name || ' & ' || groom_name) AS name FROM couples WHERE id = ?",
    )
    .get(coupleId) as { name: string } | undefined;
  const coupleName = couple?.name ?? "Egy pár";

  const senderUser = db.prepare("SELECT email FROM users WHERE id = ?").get(userId) as
    | { email: string }
    | undefined;

  await sendKind(
    "planner_client_invite",
    { coupleName, replyToEmail: senderUser?.email },
    {
      user: { id: planner.id, email: planner.email, full_name: planner.full_name ?? "" },
      couple_id: coupleId,
    },
  );

  return json({ ok: true });
}

async function handleRevokePlanner(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCoupleAuth(ctx);
  const plannerUserId = Number(ctx.params?.plannerUserId);
  if (!Number.isFinite(plannerUserId) || plannerUserId <= 0) {
    throw new HttpError(400, "plannerUserId required");
  }

  db.prepare("DELETE FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?").run(
    plannerUserId,
    coupleId,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.couple_revoke",
    target_kind: "user",
    target_id: plannerUserId,
  });

  return json({ ok: true });
}

async function handleGetStats(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);

  const clientCounts = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_clients,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_invites
       FROM planner_clients
      WHERE planner_user_id = ?`,
    )
    .get(userId) as { active_clients: number | null; pending_invites: number | null };

  // KPI semantic (shared by the aggregate task counts below AND the per_client
  // breakdown): both span EVERY linked client, active and pending alike,
  // exactly the set the client-list cards (handleListClients) display. Declined
  // links are deleted, not flagged, so "all rows for this planner" == "all
  // clients the planner sees". This keeps the dashboard reconcilable: the
  // aggregate total_tasks equals the sum of per_client.task_total. A pending
  // link grants no workspace ENTRY (handleEnterClient gates on 'active'); these
  // are read-only roll-up counts the planner already sees on the client card.
  const taskCounts = db
    .prepare(
      `SELECT
         COUNT(*) AS total_tasks,
         SUM(CASE WHEN pi.done = 1 THEN 1 ELSE 0 END) AS done_tasks,
         SUM(CASE WHEN pi.done = 0 AND pi.due_date IS NOT NULL AND pi.due_date < date('now') THEN 1 ELSE 0 END) AS overdue_tasks,
         SUM(CASE WHEN pi.done = 0 AND pi.due_date IS NOT NULL AND pi.due_date BETWEEN date('now') AND date('now', '+7 days') THEN 1 ELSE 0 END) AS due_this_week
       FROM planning_items pi
       JOIN planner_clients pc ON pc.couple_id = pi.couple_id AND pc.planner_user_id = ?
      WHERE pi.kind = 'task'`,
    )
    .get(userId) as {
    total_tasks: number | null;
    done_tasks: number | null;
    overdue_tasks: number | null;
    due_this_week: number | null;
  };

  const upcomingWeddings = (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt
           FROM couples c
           JOIN planner_clients pc ON pc.couple_id = c.id AND pc.planner_user_id = ?
          WHERE c.wedding_date BETWEEN date('now') AND date('now', '+30 days')`,
      )
      .get(userId) as { cnt: number }
  ).cnt;

  const perClientRows = db
    .prepare(
      `SELECT pc.couple_id,
              COALESCE(c.display_name, c.bride_name || ' & ' || c.groom_name) AS display_name,
              c.wedding_date,
              COUNT(pi.id) AS task_total,
              SUM(CASE WHEN pi.done = 1 THEN 1 ELSE 0 END) AS task_done,
              SUM(CASE WHEN pi.done = 0 AND pi.due_date IS NOT NULL AND pi.due_date < date('now') THEN 1 ELSE 0 END) AS task_overdue,
              SUM(CASE WHEN pi.done = 0 AND pi.due_date IS NOT NULL AND pi.due_date BETWEEN date('now') AND date('now', '+7 days') THEN 1 ELSE 0 END) AS due_this_week
         FROM planner_clients pc
         JOIN couples c ON c.id = pc.couple_id
         LEFT JOIN planning_items pi ON pi.couple_id = pc.couple_id AND pi.kind = 'task'
        WHERE pc.planner_user_id = ?
        GROUP BY pc.couple_id
        ORDER BY c.wedding_date ASC`,
    )
    .all(userId) as Array<{
    couple_id: number;
    display_name: string;
    wedding_date: string | null;
    task_total: number | null;
    task_done: number | null;
    task_overdue: number | null;
    due_this_week: number | null;
  }>;

  const plannerMeta = db
    .prepare(
      "SELECT planner_plan, planner_max_clients, planner_onboarding_done FROM users WHERE id = ?",
    )
    .get(userId) as
    | {
        planner_plan: string | null;
        planner_max_clients: number | null;
        planner_onboarding_done: number | null;
      }
    | undefined;

  const plan = (plannerMeta?.planner_plan ?? "starter") as PlannerPlan;
  const maxClients = plannerMeta?.planner_max_clients ?? 4;
  const onboardingDone = (plannerMeta?.planner_onboarding_done ?? 0) === 1;

  return json({
    stats: {
      active_clients: clientCounts.active_clients ?? 0,
      pending_invites: clientCounts.pending_invites ?? 0,
      total_tasks: taskCounts.total_tasks ?? 0,
      done_tasks: taskCounts.done_tasks ?? 0,
      overdue_tasks: taskCounts.overdue_tasks ?? 0,
      due_this_week: taskCounts.due_this_week ?? 0,
      upcoming_weddings_30d: upcomingWeddings,
      per_client: perClientRows.map((r) => ({
        couple_id: r.couple_id,
        display_name: r.display_name,
        wedding_date: r.wedding_date,
        task_total: r.task_total ?? 0,
        task_done: r.task_done ?? 0,
        task_overdue: r.task_overdue ?? 0,
        due_this_week: r.due_this_week ?? 0,
      })),
      plan,
      max_clients: maxClients,
      onboarding_done: onboardingDone,
    },
  });
}

async function handleCompleteOnboarding(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  db.prepare("UPDATE users SET planner_onboarding_done = 1, updated_at = ? WHERE id = ?").run(
    now(),
    userId,
  );
  return json({ ok: true });
}

// ─── Planner calendar events ─────────────────────────────────────────────────

/** Assert a couple_id (when present) is linked to this planner; events may
 *  only reference workspaces the planner is connected to (active or pending). */
function assertCoupleLinked(plannerUserId: number, coupleId: number): void {
  const link = db
    .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .get(plannerUserId, coupleId);
  if (!link) throw new HttpError(400, "couple_id is not one of your linked clients");
}

async function handleListEvents(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const url = new URL(ctx.req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from !== null && !isIsoDate(from)) throw new HttpError(400, "from must be YYYY-MM-DD");
  if (to !== null && !isIsoDate(to)) throw new HttpError(400, "to must be YYYY-MM-DD");

  const clauses = ["planner_user_id = ?"];
  const params: (string | number)[] = [userId];
  if (from !== null) {
    clauses.push("event_date >= ?");
    params.push(from);
  }
  if (to !== null) {
    clauses.push("event_date <= ?");
    params.push(to);
  }

  const rows = db
    .prepare(
      `SELECT id, couple_id, title, event_date, start_time, notes, created_at
         FROM planner_events
        WHERE ${clauses.join(" AND ")}
        ORDER BY event_date ASC, start_time ASC, id ASC`,
    )
    .all(...params) as PlannerEventRow[];

  return json({ events: rows.map(toPlannerEvent) });
}

async function handleCreateEvent(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const body = await readJson<{
    title?: unknown;
    event_date?: unknown;
    start_time?: unknown;
    couple_id?: unknown;
    notes?: unknown;
  }>(ctx.req);

  if (typeof body.title !== "string" || !body.title.trim()) {
    throw new HttpError(400, "title required");
  }
  if (!isIsoDate(body.event_date)) throw new HttpError(400, "event_date must be YYYY-MM-DD");
  const title = body.title.trim().slice(0, 200);

  let startTime: string | null = null;
  if (body.start_time !== undefined && body.start_time !== null && body.start_time !== "") {
    if (!isHhMm(body.start_time)) throw new HttpError(400, "start_time must be HH:MM");
    startTime = body.start_time;
  }

  let coupleId: number | null = null;
  if (body.couple_id !== undefined && body.couple_id !== null) {
    if (typeof body.couple_id !== "number" || !Number.isInteger(body.couple_id)) {
      throw new HttpError(400, "couple_id must be an integer");
    }
    assertCoupleLinked(userId, body.couple_id);
    coupleId = body.couple_id;
  }

  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  const ts = now();
  const row = db
    .prepare(
      `INSERT INTO planner_events (planner_user_id, couple_id, title, event_date, start_time, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id, couple_id, title, event_date, start_time, notes, created_at`,
    )
    .get(userId, coupleId, title, body.event_date, startTime, notes, ts) as PlannerEventRow;

  return json(toPlannerEvent(row));
}

async function handleUpdateEvent(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const id = Number(ctx.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "id required");

  const existing = db
    .prepare("SELECT id FROM planner_events WHERE id = ? AND planner_user_id = ?")
    .get(id, userId);
  if (!existing) throw new HttpError(404, "Event not found");

  const body = await readJson<{
    title?: unknown;
    event_date?: unknown;
    start_time?: unknown;
    couple_id?: unknown;
    notes?: unknown;
  }>(ctx.req);

  const fields: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vals: any[] = [];

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim()) {
      throw new HttpError(400, "title cannot be empty");
    }
    fields.push("title = ?");
    vals.push(body.title.trim().slice(0, 200));
  }
  if (body.event_date !== undefined) {
    if (!isIsoDate(body.event_date)) throw new HttpError(400, "event_date must be YYYY-MM-DD");
    fields.push("event_date = ?");
    vals.push(body.event_date);
  }
  if (body.start_time !== undefined) {
    if (body.start_time === null || body.start_time === "") {
      fields.push("start_time = ?");
      vals.push(null);
    } else {
      if (!isHhMm(body.start_time)) throw new HttpError(400, "start_time must be HH:MM");
      fields.push("start_time = ?");
      vals.push(body.start_time);
    }
  }
  if (body.couple_id !== undefined) {
    if (body.couple_id === null) {
      fields.push("couple_id = ?");
      vals.push(null);
    } else {
      if (typeof body.couple_id !== "number" || !Number.isInteger(body.couple_id)) {
        throw new HttpError(400, "couple_id must be an integer");
      }
      assertCoupleLinked(userId, body.couple_id);
      fields.push("couple_id = ?");
      vals.push(body.couple_id);
    }
  }
  if ("notes" in body) {
    fields.push("notes = ?");
    vals.push(typeof body.notes === "string" ? body.notes.trim() || null : null);
  }

  if (fields.length > 0) {
    db.prepare(
      `UPDATE planner_events SET ${fields.join(", ")} WHERE id = ? AND planner_user_id = ?`,
    ).run(...vals, id, userId);
  }

  const row = db
    .prepare(
      "SELECT id, couple_id, title, event_date, start_time, notes, created_at FROM planner_events WHERE id = ?",
    )
    .get(id) as PlannerEventRow;
  return json(toPlannerEvent(row));
}

async function handleDeleteEvent(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const id = Number(ctx.params?.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "id required");

  const res = db
    .prepare("DELETE FROM planner_events WHERE id = ? AND planner_user_id = ?")
    .run(id, userId);
  if (res.changes === 0) throw new HttpError(404, "Event not found");
  return json({ ok: true });
}

// ─── Notify me when paid plans launch ────────────────────────────────────────

async function handleNotifyPlans(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  // Idempotent opt-in: flips the flag on (a repeat call is a harmless no-op).
  db.prepare("UPDATE users SET planner_plan_notify = 1, updated_at = ? WHERE id = ?").run(
    now(),
    userId,
  );
  return json({ ok: true });
}

// ─── Planner-side hard client unlink ─────────────────────────────────────────

/** Hard-remove the planner↔couple link for THIS planner only. Deletes nothing
 *  but the link row; the couple and all their workspace data are untouched. */
async function handleRemoveClient(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const coupleId = Number(ctx.params?.coupleId);
  if (!Number.isFinite(coupleId) || coupleId <= 0) throw new HttpError(400, "coupleId required");

  const res = db
    .prepare("DELETE FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
    .run(userId, coupleId);
  if (res.changes === 0) throw new HttpError(404, "Not linked to this workspace");

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "planner.remove_client",
    target_kind: "couple",
    target_id: coupleId,
  });

  return json({ ok: true });
}

export function registerPlannerRoutes(router: Router) {
  // Planner-side: client management
  router.get("/api/planner/clients", handleListClients, true);
  router.post("/api/planner/clients", handleAddClient, true);
  router.patch("/api/planner/clients/:coupleId/notes", handleUpdateNotes, true);
  router.get("/api/planner/clients/:coupleId/crm", handleGetClientCrm, true);
  router.patch("/api/planner/clients/:coupleId/crm", handleUpdateClientCrm, true);
  router.post("/api/planner/clients/:coupleId/guest-page-access", handleSetGuestPageAccess, true);
  router.post("/api/planner/clients/:coupleId/enter", handleEnterClient, true);
  router.delete("/api/planner/clients/:coupleId", handleRemoveClient, true);
  router.post("/api/planner/exit", handleExit, true);
  router.get("/api/planner/tasks", handleListTasks, true);
  // Planner-side: calendar events
  router.get("/api/planner/events", handleListEvents, true);
  router.post("/api/planner/events", handleCreateEvent, true);
  router.patch("/api/planner/events/:id", handleUpdateEvent, true);
  router.delete("/api/planner/events/:id", handleDeleteEvent, true);
  // Planner-side: stats + onboarding
  router.get("/api/planner/stats", handleGetStats, true);
  router.post("/api/planner/complete-onboarding", handleCompleteOnboarding, true);
  router.post("/api/planner/notify-plans", handleNotifyPlans, true);
  // Planner-side: messages
  router.get("/api/planner/messages", handleListInbox, true);
  router.get("/api/planner/messages/:coupleId", handleListThread, true);
  router.post("/api/planner/messages/:coupleId", handleSendMessage, true);
  // Planner-side: profile (M3)
  router.get("/api/planner/profile", handleGetProfile, true);
  router.patch("/api/planner/profile", handleUpdateProfile, true);
  router.post("/api/planner/profile/avatar", handleUploadAvatar, true);
  router.delete("/api/planner/profile/avatar", handleDeleteAvatar, true);
  router.post("/api/planner/profile/portfolio", handleAddPortfolio, true);
  router.delete("/api/planner/profile/portfolio/:id", handleDeletePortfolio, true);
  // Planner-side: couple-initiated invites (M1)
  router.get("/api/planner/invites", handleListInvites, true);
  router.post("/api/planner/invites/:coupleId/accept", handleAcceptInvite, true);
  router.post("/api/planner/invites/:coupleId/decline", handleDeclineInvite, true);

  // Email invitations: a planner invites anyone by email to become a client.
  router.get("/api/planner/invitations", handleListInvitations, true);
  router.post("/api/planner/invitations", handleCreateInvitation, true);
  router.delete("/api/planner/invitations/:id", handleRevokeInvitation, true);
  // Public: signup page resolves the inviting planner from the token.
  router.get("/api/planner-invites/:token", handleLookupInvitation);
  // Couple-side: planner panel (M7)
  router.get("/api/couples/planners", handleListLinkedPlanners, true);
  router.post("/api/couples/planner-invite", handleInvitePlanner, true);
  router.post("/api/couples/planners/:plannerUserId/accept", handleAcceptPlannerRequest, true);
  router.delete("/api/couples/planners/:plannerUserId", handleRevokePlanner, true);
}
