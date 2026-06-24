import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { getCoupleById, toCouple } from "../domain/couples";
import { sendEmail } from "../lib/mailer";
import type { PlannerPlan } from "@shared/types";

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

  const plannerRow = db
    .prepare("SELECT planner_max_clients FROM users WHERE id = ?")
    .get(userId) as { planner_max_clients: number | null } | undefined;
  const maxClients = plannerRow?.planner_max_clients ?? 4;
  const activeCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM planner_clients WHERE planner_user_id = ? AND status = 'active'",
      )
      .get(userId) as { cnt: number }
  ).cnt;
  if (activeCount >= maxClients) {
    throw new HttpError(422, "Client limit reached for your plan");
  }

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

  const htmlBody = `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:600px">
<p style="white-space:pre-wrap">${bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0"/>
<p style="font-size:13px;color:#888">Küldő: ${planner.full_name} (${planner.email}) | Weddly</p>
</div>`;

  await sendEmail({
    to: recipientEmail,
    subject,
    html: htmlBody,
    text: bodyText,
    headers: { "Reply-To": planner.email },
  });

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

async function handleGetProfile(ctx: Ctx): Promise<Response> {
  const userId = requirePlannerAuth(ctx);
  const row = db
    .prepare(
      "SELECT full_name, email, business_name, planner_bio, planner_city, planner_website, planner_phone FROM users WHERE id = ?",
    )
    .get(userId) as {
    full_name: string;
    email: string;
    business_name: string | null;
    planner_bio: string | null;
    planner_city: string | null;
    planner_website: string | null;
    planner_phone: string | null;
  } | undefined;
  if (!row) throw new HttpError(404, "planner not found");
  return json(row);
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
  }>(ctx.req);

  const fields: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vals: any[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() || null : undefined);

  const fn = str(body.full_name);
  if (fn !== undefined) { fields.push("full_name = ?"); vals.push(fn ?? ""); }
  const bn = str(body.business_name);
  if (bn !== undefined) { fields.push("business_name = ?"); vals.push(bn); }
  const bio = str(body.planner_bio);
  if (bio !== undefined) { fields.push("planner_bio = ?"); vals.push(bio); }
  const city = str(body.planner_city);
  if (city !== undefined) { fields.push("planner_city = ?"); vals.push(city); }
  const web = str(body.planner_website);
  if (web !== undefined) { fields.push("planner_website = ?"); vals.push(web); }
  const phone = str(body.planner_phone);
  if (phone !== undefined) { fields.push("planner_phone = ?"); vals.push(phone); }

  if (fields.length > 0) {
    db.prepare(`UPDATE users SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`).run(
      ...vals,
      now(),
      userId,
    );
  }

  const updated = db
    .prepare(
      "SELECT full_name, email, business_name, planner_bio, planner_city, planner_website, planner_phone FROM users WHERE id = ?",
    )
    .get(userId);
  return json(updated);
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

  const link = db
    .prepare(
      "SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ? AND status = 'pending'",
    )
    .get(userId, coupleId);
  if (!link) throw new HttpError(404, "Invite not found");

  db.prepare(
    "UPDATE planner_clients SET status = 'active' WHERE planner_user_id = ? AND couple_id = ?",
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
      `SELECT pc.planner_user_id, pc.status, pc.created_at,
              u.full_name, u.email, u.business_name, u.planner_city, u.planner_bio
         FROM planner_clients pc
         JOIN users u ON u.id = pc.planner_user_id
        WHERE pc.couple_id = ?
        ORDER BY pc.created_at DESC`,
    )
    .all(coupleId) as Array<{
    planner_user_id: number;
    status: string;
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

async function handleInvitePlanner(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCoupleAuth(ctx);

  const body = await readJson<{ planner_email?: unknown }>(ctx.req);
  if (typeof body.planner_email !== "string" || !body.planner_email.trim()) {
    throw new HttpError(400, "planner_email required");
  }
  const plannerEmail = body.planner_email.trim().toLowerCase();

  const planner = db.prepare("SELECT id, user_type FROM users WHERE LOWER(email) = ?").get(
    plannerEmail,
  ) as { id: number; user_type: string } | undefined;
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

  const htmlBody = `<div style="font-family:sans-serif;font-size:15px;line-height:1.6;color:#222;max-width:600px">
<p>Kedves Tervező!</p>
<p><strong>${coupleName}</strong> meghívott, hogy csatlakozz az ő Weddly munkaterületükhöz tervezőként.</p>
<p>Nyisd meg a Weddly tervező felületed, és fogadd el vagy utasítsd el a meghívót.</p>
<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0"/>
<p style="font-size:13px;color:#888">Dear Planner — ${coupleName} has invited you to join their Weddly workspace as their planner. Open your Weddly planner dashboard to accept or decline.</p>
</div>`;

  await sendEmail({
    to: plannerEmail,
    subject: "Új ügyfél meghívó / New client invite — Weddly",
    html: htmlBody,
    text: `${coupleName} meghívott tervezőként a Weddly-n. Nyisd meg a tervező dashboardod a válaszhoz.`,
    headers: senderUser ? { "Reply-To": senderUser.email } : undefined,
  });

  return json({ ok: true });
}

async function handleRevokePlanner(ctx: Ctx): Promise<Response> {
  const { userId, coupleId } = requireCoupleAuth(ctx);
  const plannerUserId = Number(ctx.params?.plannerUserId);
  if (!Number.isFinite(plannerUserId) || plannerUserId <= 0) {
    throw new HttpError(400, "plannerUserId required");
  }

  db.prepare(
    "DELETE FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?",
  ).run(plannerUserId, coupleId);

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
        WHERE pc.planner_user_id = ? AND pc.status = 'active'
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
    .get(userId) as {
    planner_plan: string | null;
    planner_max_clients: number | null;
    planner_onboarding_done: number | null;
  } | undefined;

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

export function registerPlannerRoutes(router: Router) {
  // Planner-side: client management
  router.get("/api/planner/clients", handleListClients, true);
  router.post("/api/planner/clients", handleAddClient, true);
  router.patch("/api/planner/clients/:coupleId/notes", handleUpdateNotes, true);
  router.post("/api/planner/clients/:coupleId/enter", handleEnterClient, true);
  router.post("/api/planner/exit", handleExit, true);
  router.get("/api/planner/tasks", handleListTasks, true);
  // Planner-side: stats + onboarding
  router.get("/api/planner/stats", handleGetStats, true);
  router.post("/api/planner/complete-onboarding", handleCompleteOnboarding, true);
  // Planner-side: messages
  router.get("/api/planner/messages", handleListInbox, true);
  router.get("/api/planner/messages/:coupleId", handleListThread, true);
  router.post("/api/planner/messages/:coupleId", handleSendMessage, true);
  // Planner-side: profile (M3)
  router.get("/api/planner/profile", handleGetProfile, true);
  router.patch("/api/planner/profile", handleUpdateProfile, true);
  // Planner-side: couple-initiated invites (M1)
  router.get("/api/planner/invites", handleListInvites, true);
  router.post("/api/planner/invites/:coupleId/accept", handleAcceptInvite, true);
  router.post("/api/planner/invites/:coupleId/decline", handleDeclineInvite, true);
  // Couple-side: planner panel (M7)
  router.get("/api/couples/planners", handleListLinkedPlanners, true);
  router.post("/api/couples/planner-invite", handleInvitePlanner, true);
  router.delete("/api/couples/planners/:plannerUserId", handleRevokePlanner, true);
}
