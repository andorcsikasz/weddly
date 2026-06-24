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
      `SELECT pc.couple_id, pc.status, pc.created_at,
              c.bride_name, c.groom_name, c.display_name, c.wedding_date,
              c.status AS couple_status,
              (SELECT COUNT(*) FROM guests g WHERE g.couple_id = c.id AND g.status = 'confirmed') AS confirmed_guests
         FROM planner_clients pc
         JOIN couples c ON c.id = pc.couple_id
        WHERE pc.planner_user_id = ?
        ORDER BY pc.created_at DESC`,
    )
    .all(userId) as Array<{
    couple_id: number;
    status: string;
    created_at: number;
    bride_name: string;
    groom_name: string;
    display_name: string | null;
    wedding_date: string | null;
    couple_status: string;
    confirmed_guests: number;
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

export function registerPlannerRoutes(router: Router) {
  router.get("/api/planner/clients", handleListClients, true);
  router.post("/api/planner/clients", handleAddClient, true);
  router.post("/api/planner/clients/:coupleId/enter", handleEnterClient, true);
  router.post("/api/planner/exit", handleExit, true);
}
