// Pause-to-delete: either partner can request, 30-day window, either can cancel.
// Status is auth-protected; effective delete happens via a future scheduled job.

import {
  type CouplePauseRequest,
  PAUSE_DELETE_WINDOW_MS,
  type PauseRequestStatus,
} from "@shared/types";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import { sendKind } from "../domain/emails";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";

interface PauseRow {
  id: number;
  couple_id: number;
  requested_by_user_id: number;
  scheduled_delete_at: number;
  status: string;
  reason: string | null;
  created_at: number;
  completed_at: number | null;
}

function toPause(r: PauseRow): CouplePauseRequest {
  const status: PauseRequestStatus =
    r.status === "cancelled" ? "cancelled" : r.status === "completed" ? "completed" : "pending";
  return {
    id: r.id,
    couple_id: r.couple_id,
    requested_by_user_id: r.requested_by_user_id,
    scheduled_delete_at: r.scheduled_delete_at,
    status,
    reason: r.reason,
    created_at: r.created_at,
    completed_at: r.completed_at,
  };
}

function activeRequest(coupleId: number): PauseRow | null {
  return (
    (db
      .prepare(
        "SELECT * FROM couple_pause_requests WHERE couple_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId) as PauseRow | undefined) ?? null
  );
}

function handleStatus(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const active = activeRequest(couple.id);
  return json({
    couple_status: couple.status,
    pause_request: active ? toPause(active) : null,
  });
}

interface PauseBody {
  reason?: unknown;
}

async function handlePause(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  if (couple.status !== "active") throw new HttpError(409, "Couple is not active");
  if (activeRequest(couple.id)) throw new HttpError(409, "Pause already requested");

  const body = await readJson<PauseBody>(ctx.req);
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

  const ts = now();
  const scheduled = ts + PAUSE_DELETE_WINDOW_MS;
  const result = db
    .prepare(
      `INSERT INTO couple_pause_requests
        (couple_id, requested_by_user_id, scheduled_delete_at, status, reason, created_at, completed_at)
       VALUES (?, ?, ?, 'pending', ?, ?, NULL)`,
    )
    .run(couple.id, userId, scheduled, reason, ts);
  const id = Number(result.lastInsertRowid);

  db.prepare("UPDATE couples SET status = 'paused', updated_at = ? WHERE id = ?").run(
    ts,
    couple.id,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.pause",
    target_kind: "couple",
    target_id: couple.id,
    after: { scheduled_delete_at: scheduled, reason },
  });

  // Notify both partners. Either of them can cancel the pause from Profile,
  // so both deserve to know. Fire-and-forget — pause must succeed even if
  // the mailer is misconfigured.
  const partners = db
    .prepare("SELECT id, email, full_name FROM users WHERE couple_id = ?")
    .all(couple.id) as Array<{ id: number; email: string; full_name: string }>;
  const requester = partners.find((p) => p.id === userId);
  const requestedByName = requester?.full_name?.trim() || "Your partner";
  const scheduledDeleteDate = new Date(scheduled).toLocaleDateString("hu-HU", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const cancelUrl = `${CONFIG.frontendBaseUrl}/app/profile`;
  for (const p of partners) {
    if (!p.email || p.email.endsWith("@purged.local")) continue;
    void sendKind(
      "couple_paused",
      { requestedByName, scheduledDeleteDate, cancelUrl },
      {
        user: { id: p.id, email: p.email, full_name: p.full_name },
        couple_id: couple.id,
      },
    );
  }

  const row = db.prepare("SELECT * FROM couple_pause_requests WHERE id = ?").get(id) as PauseRow;
  return json({ pause_request: toPause(row) }, { status: 201 });
}

function handleCancel(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const active = activeRequest(couple.id);
  if (!active) throw new HttpError(404, "No active pause request");

  const ts = now();
  db.prepare(
    "UPDATE couple_pause_requests SET status = 'cancelled', completed_at = ? WHERE id = ?",
  ).run(ts, active.id);
  db.prepare("UPDATE couples SET status = 'active', updated_at = ? WHERE id = ?").run(
    ts,
    couple.id,
  );

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "couple.unpause",
    target_kind: "couple_pause_request",
    target_id: active.id,
  });

  return json({ ok: true });
}

export function registerCouplePauseRoutes(router: Router) {
  router.get("/api/couples/pause", handleStatus, true);
  router.post("/api/couples/pause", handlePause, true);
  router.post("/api/couples/pause/cancel", handleCancel, true);
}
