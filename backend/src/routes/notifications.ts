// In-app notification center. Two endpoints, both couple-scoped via the
// session: read the merged feed (computed timeline + stored events) and stamp
// the "I opened the bell" read watermark. Deliberately NOT in EDIT_PREFIXES —
// reads + the seen stamp stay open for lapsed couples so the "you're behind"
// nudge still reaches them.

import { getCoupleForUser } from "../domain/couples";
import { getNotificationFeed, markNotificationsSeen } from "../domain/notifications";
import { db, now } from "../db";
import { type Ctx, json, requireAuth, type Router } from "../lib/http";

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  return json(getNotificationFeed(userId));
}

function handleMarkSeen(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  // No workspace yet → nothing to mark; respond cleanly so the client poller
  // doesn't error on a brand-new account.
  if (!couple) return json({ seen_at: null });
  const seenAt = markNotificationsSeen(userId, couple.id);
  return json({ seen_at: seenAt });
}

function handleSurveyDismiss(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  db.prepare("UPDATE users SET survey_prompted_at = ? WHERE id = ?").run(now(), userId);
  return json({ ok: true });
}

export function registerNotificationRoutes(router: Router) {
  router.get("/api/notifications", handleList, true);
  router.post("/api/notifications/seen", handleMarkSeen, true);
  router.post("/api/notifications/survey/dismiss", handleSurveyDismiss, true);
}
