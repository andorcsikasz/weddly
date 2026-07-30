// Planner email invitations — a planner invites a not-yet-onboarded person by
// email to become their client. The invitee signs up (or logs in) and builds a
// workspace; at that point `linkPlannerInvitationsForCouple` creates a PENDING
// planner_clients link (initiated_by='planner') which the new couple must still
// approve before the planner gains edit access. Consent is preserved end to
// end — an invitation never grants access on its own.

import { randomBytes } from "node:crypto";
import type { PlannerInvitation } from "@shared/types";
import { db, now } from "../db";
import { emitPlannerEvent } from "./planner_points";

/** 30-day validity window. An invitee who never signs up lets it lapse. */
const INVITE_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export interface PlannerInvitationRow {
  id: number;
  planner_user_id: number;
  email: string;
  token: string;
  status: string;
  accepted_user_id: number | null;
  accepted_at: number | null;
  expires_at: number | null;
  created_at: number;
}

export function toPlannerInvitation(row: PlannerInvitationRow): PlannerInvitation {
  const status =
    row.status === "accepted" ? "accepted" : row.status === "revoked" ? "revoked" : "pending";
  return {
    id: row.id,
    email: row.email,
    status,
    accepted_at: row.accepted_at,
    expires_at: row.expires_at,
    created_at: row.created_at,
  };
}

/** Insert a fresh pending invitation with a URL-safe random token. */
export function createPlannerInvitation(
  plannerUserId: number,
  email: string,
): PlannerInvitationRow {
  const token = randomBytes(24).toString("base64url");
  const ts = now();
  return db
    .prepare(
      `INSERT INTO planner_invitations
         (planner_user_id, email, token, status, expires_at, created_at)
       VALUES (?, ?, ?, 'pending', ?, ?)
       RETURNING *`,
    )
    .get(plannerUserId, email.toLowerCase(), token, ts + INVITE_TTL_MS, ts) as PlannerInvitationRow;
}

export function getPlannerInvitationByToken(token: string): PlannerInvitationRow | undefined {
  return db.prepare("SELECT * FROM planner_invitations WHERE token = ?").get(token) as
    | PlannerInvitationRow
    | undefined;
}

/** Count outstanding (pending, not expired) invitations for cap accounting. */
export function pendingInvitationCount(plannerUserId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS cnt FROM planner_invitations
          WHERE planner_user_id = ? AND status = 'pending'
            AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .get(plannerUserId, now()) as { cnt: number }
  ).cnt;
}

/** Re-bind an invitation to the email the invitee actually registered with, so
 *  the onboarding email-match still links them even if they signed up under a
 *  different address than the one invited. No-op when the email is unchanged. */
export function rebindInvitationEmail(token: string, email: string): void {
  db.prepare("UPDATE planner_invitations SET email = ? WHERE token = ? AND status = 'pending'").run(
    email.toLowerCase(),
    token,
  );
}

/** Called at couple onboarding. For every pending, non-expired invitation whose
 *  email matches the freshly-onboarded user, create a PENDING planner_clients
 *  link (the planner brought them in) and mark the invitation accepted. The
 *  couple still approves the request before the planner gains access. */
export function linkPlannerInvitationsForCouple(
  userId: number,
  coupleId: number,
  email: string,
): void {
  const lower = email.trim().toLowerCase();
  if (!lower) return;
  const ts = now();
  const pending = db
    .prepare(
      `SELECT * FROM planner_invitations
        WHERE LOWER(email) = ? AND status = 'pending'
          AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .all(lower, ts) as PlannerInvitationRow[];

  for (const inv of pending) {
    const exists = db
      .prepare("SELECT id FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?")
      .get(inv.planner_user_id, coupleId);
    if (!exists) {
      db.prepare(
        `INSERT INTO planner_clients (planner_user_id, couple_id, status, initiated_by, created_at)
         VALUES (?, ?, 'pending', 'planner', ?)`,
      ).run(inv.planner_user_id, coupleId, ts);
    }
    db.prepare(
      "UPDATE planner_invitations SET status = 'accepted', accepted_user_id = ?, accepted_at = ? WHERE id = ?",
    ).run(userId, ts, inv.id);
    // Weddly Points: the planner brought a NEW couple to Weddly. Paid separately
    // from `client_linked`, which the couple's own approval fires later, because
    // these are two different things a planner can do.
    emitPlannerEvent(inv.planner_user_id, "invite.accepted", { invitation_id: inv.id });
  }
}
