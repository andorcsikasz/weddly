// Admin console for the campaign PLAN (KEZELÉS → Kampányok → Terv). Four
// endpoints, all requireAdmin: read the plan, tune a schedule's knobs, build
// this round's campaign by hand, and launch the one that is waiting.
//
// There is no create/delete: the schedules ARE the campaign families, seeded at
// boot from shared/campaign_schedules.ts. An operator who wants a family to
// stop turns its repeat switch off; the row stays so it can be turned back on.

import type { UpdateCampaignScheduleInput } from "@shared/campaign_schedules";
import {
  getScheduleView,
  listPlan,
  prepareSchedule,
  runPreparedCampaign,
  updateSchedule,
} from "../domain/campaign_schedules";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  return id;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(listPlan());
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const id = parseId(ctx);
  const body = await readJson<UpdateCampaignScheduleInput>(ctx.req);
  const view = updateSchedule(id, body);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "campaign_schedule.update",
    target_kind: "campaign_schedule",
    target_id: id,
    after: {
      kind: view.schedule.kind,
      enabled: view.schedule.enabled,
      interval_days: view.schedule.interval_days,
      daily_cap: view.schedule.daily_cap,
      auto_start: view.schedule.auto_start,
    },
  });
  return json(view);
}

/** "Prepare now" — the operator not waiting for the due date. Forced, so it
 *  works on a paused plan too, but the in-flight and minimum-audience guards
 *  still apply and are reported back rather than silently swallowed. */
async function handlePrepare(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const id = parseId(ctx);
  const result = prepareSchedule(id, { force: true, actorUserId: actor });
  return json({ result, item: getScheduleView(id) });
}

async function handleRun(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const id = parseId(ctx);
  return json({ item: runPreparedCampaign(id, actor) });
}

export function registerAdminCampaignScheduleRoutes(router: Router): void {
  router.get("/api/admin/campaign-schedules", handleList);
  router.patch("/api/admin/campaign-schedules/:id", handleUpdate);
  router.post("/api/admin/campaign-schedules/:id/prepare", handlePrepare);
  router.post("/api/admin/campaign-schedules/:id/run", handleRun);
}
