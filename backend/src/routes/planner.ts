import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { getCoupleById, toCouple } from "../domain/couples";

function requirePlannerAuth(ctx: Ctx): number {
  const userId = requireAuth(ctx);
  const user = db
    .prepare("SELECT user_type FROM users WHERE id = ?")
    .get(userId) as { user_type: string } | undefined;
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

  const target = db
    .prepare("SELECT id, couple_id FROM users WHERE LOWER(email) = ?")
    .get(email) as { id: number; couple_id: number | null } | undefined;
  if (!target) throw new HttpError(404, "No user found with that email");
  if (!target.couple_id) {
    throw new HttpError(400, "That user has not set up a wedding workspace yet");
  }

  const couple = getCoupleById(target.couple_id);
  if (!couple || couple.status === "deleting") {
    throw new HttpError(400, "Workspace unavailable");
  }

  const existing = db
    .prepare(
      "SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?",
    )
    .get(userId, target.couple_id);
  if (existing) throw new HttpError(409, "This couple is already linked to your account");

  db.prepare(
    "INSERT INTO planner_clients (planner_user_id, couple_id, status, created_at) VALUES (?, ?, 'active', ?)",
  ).run(userId, target.couple_id, now());

  addAuditLog({
    actor_user_id: userId,
    couple_id: target.couple_id,
    action: "planner.link_client",
    target_kind: "couple",
    target_id: target.couple_id,
    note: `linked by planner ${userId}`,
  });

  return json({ ok: true, couple_id: target.couple_id });
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

  const user = db
    .prepare("SELECT couple_id FROM users WHERE id = ?")
    .get(userId) as { couple_id: number | null } | undefined;

  const prevCoupleId = user?.couple_id ?? null;
  db.prepare("UPDATE users SET couple_id = NULL, updated_at = ? WHERE id = ?").run(
    now(),
    userId,
  );

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

export function registerPlannerRoutes(router: Router) {
  router.get("/api/planner/clients", handleListClients, true);
  router.post("/api/planner/clients", handleAddClient, true);
  router.patch("/api/planner/clients/:coupleId/notes", handleUpdateNotes, true);
  router.post("/api/planner/clients/:coupleId/enter", handleEnterClient, true);
  router.post("/api/planner/exit", handleExit, true);
  router.get("/api/planner/tasks", handleListTasks, true);
}
