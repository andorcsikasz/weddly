// Per-user couple-membership endpoints (today: just "leave"). Splitting these
// out keeps `auth.ts` focused on credentials and `couples.ts` focused on the
// workspace itself.

import { CONFIG } from "../config";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { getCoupleById, getCoupleForUser, removeCoupleMember } from "../domain/couples";
import { sendKind } from "../domain/emails";
import { getUserById } from "../domain/users";
import { type Ctx, HttpError, json, requireAuth, type Router } from "../lib/http";

/** POST /api/users/me/leave-couple — partner B disengages from the
 *  workspace. The couple keeps existing (partner A stays in it); partner B's
 *  `users.couple_id` is nulled and the couple's `partner_b_id` FK is cleared
 *  so partner A can later re-invite someone if they want to.
 *
 *  Partner A (the owner) cannot use this — leaving a workspace they own
 *  would orphan all the data, so we 409 them and point at the explicit
 *  delete flow (pause → 30-day purge).
 */
async function handleLeaveCouple(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(404, "No couple to leave");

  if (couple.partner_a_id === userId) {
    throw new HttpError(409, "Owner cannot leave; delete workspace instead", {
      code: "owner_cannot_leave",
    });
  }
  // Defence: we expect the caller to be partner B if they're not partner A,
  // but defend explicitly so a malformed row doesn't quietly clear the wrong
  // FK.
  if (couple.partner_b_id !== userId) {
    throw new HttpError(409, "User does not belong to this couple's partner slots");
  }

  const ts = now();
  const tx = db.transaction(() => {
    db.prepare("UPDATE users SET couple_id = NULL, updated_at = ? WHERE id = ?").run(ts, userId);
    db.prepare("UPDATE couples SET partner_b_id = NULL, updated_at = ? WHERE id = ?").run(
      ts,
      couple.id,
    );
    // Drop the membership so the workspace stops appearing in this user's
    // switcher. (Couple-side ON DELETE CASCADE handles the inverse: when a
    // couple is purged, every member row goes with it.)
    removeCoupleMember(couple.id, userId);
  });
  tx();

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "user.leave_couple",
    target_kind: "couple",
    target_id: couple.id,
    note: `partner_b ${userId} left the workspace`,
  });

  // Heads-up to the owner. They invited this person and now the workspace
  // looks subtly different — guest list mentions, audit logs change shape.
  // Fire-and-forget; leaving must succeed even if the mailer hiccups.
  const owner = couple.partner_a_id ? getUserById(couple.partner_a_id) : null;
  const leaver = getUserById(userId);
  const freshCouple = getCoupleById(couple.id);
  if (owner && leaver) {
    void sendKind(
      "partner_left_workspace",
      {
        partnerName: leaver.full_name || leaver.email,
        coupleDisplayName: freshCouple?.display_name ?? undefined,
        reinviteUrl: `${CONFIG.frontendBaseUrl}/app/profile`,
      },
      {
        user: { id: owner.id, email: owner.email, full_name: owner.full_name ?? "" },
        couple_id: couple.id,
      },
    );
  }

  return json({ ok: true });
}

export function registerUserCoupleRoutes(router: Router) {
  router.post("/api/users/me/leave-couple", handleLeaveCouple, true);
}
