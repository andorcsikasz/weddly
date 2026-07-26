// Admin console for the onboarding re-engagement campaign (KEZELÉS → Campaigns
// → Onboarding). Gated by requireAdmin() like every other admin surface.
//
// Same operator affordances as the other campaigns: create, sync the current
// orphan segment into send rows (the live-query counterpart to personal-invite's
// CSV import), preview the seeded rows, start, pause. No "send all now": pacing
// belongs to the worker. `send-batch` exists for a small supervised first round
// and still honours the campaign's rolling-24h budget.

import type {
  CreateOnboardingCampaignInput,
  UpdateOnboardingCampaignInput,
} from "@shared/onboarding_campaign";
import {
  campaignStats,
  createCampaign,
  getCampaignDetail,
  getCampaignRow,
  listCampaigns,
  listSends,
  sendCampaignBatch,
  syncTargets,
  updateCampaign,
} from "../domain/onboarding_campaign";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

const MAX_MANUAL_BATCH = 50;
const SENDS_PAGE_LIMIT = 2000;

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  return id;
}

function requireCampaign(ctx: Ctx) {
  const row = getCampaignRow(parseId(ctx));
  if (!row) throw new HttpError(404, "Campaign not found");
  return row;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json({ campaigns: listCampaigns() });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const body = await readJson<CreateOnboardingCampaignInput>(ctx.req);
  const campaign = createCampaign(body, actor);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "onboarding_campaign.create",
    target_kind: "onboarding_campaign",
    target_id: campaign.id,
    after: { slug: campaign.slug },
  });
  return json({ campaign }, { status: 201 });
}

function handleDetail(ctx: Ctx): Response {
  requireAdmin(ctx);
  const detail = getCampaignDetail(parseId(ctx));
  if (!detail) throw new HttpError(404, "Campaign not found");
  return json(detail);
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const campaign = requireCampaign(ctx);
  const body = await readJson<UpdateOnboardingCampaignInput>(ctx.req);
  const updated = updateCampaign(campaign.id, body);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "onboarding_campaign.update",
    target_kind: "onboarding_campaign",
    target_id: campaign.id,
    after: { status: updated.status, daily_cap: updated.daily_cap },
  });
  return json({ campaign: updated });
}

async function handleSync(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const campaign = requireCampaign(ctx);
  const result = syncTargets(campaign.id);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "onboarding_campaign.sync",
    target_kind: "onboarding_campaign",
    target_id: campaign.id,
    after: { ...result },
  });
  const row = getCampaignRow(campaign.id);
  if (!row) throw new HttpError(404, "Campaign not found");
  return json({ result, stats: campaignStats(row) });
}

function handleSends(ctx: Ctx): Response {
  requireAdmin(ctx);
  const campaign = requireCampaign(ctx);
  return json({ sends: listSends(campaign.id, SENDS_PAGE_LIMIT) });
}

async function handleSendBatch(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const campaign = requireCampaign(ctx);
  const body = await readJson<{ limit?: unknown }>(ctx.req);
  const rawLimit = typeof body.limit === "number" ? body.limit : MAX_MANUAL_BATCH;
  const limit = Math.max(1, Math.min(MAX_MANUAL_BATCH, Math.floor(rawLimit)));
  const sent = await sendCampaignBatch(campaign, limit);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "onboarding_campaign.send_batch",
    target_kind: "onboarding_campaign",
    target_id: campaign.id,
    after: { requested: limit, sent },
  });
  const row = getCampaignRow(campaign.id);
  if (!row) throw new HttpError(404, "Campaign not found");
  return json({ sent, stats: campaignStats(row) });
}

export function registerAdminOnboardingCampaignRoutes(router: Router): void {
  router.get("/api/admin/onboarding-campaigns", handleList);
  router.post("/api/admin/onboarding-campaigns", handleCreate);
  router.get("/api/admin/onboarding-campaigns/:id", handleDetail);
  router.patch("/api/admin/onboarding-campaigns/:id", handleUpdate);
  router.post("/api/admin/onboarding-campaigns/:id/sync", handleSync);
  router.get("/api/admin/onboarding-campaigns/:id/sends", handleSends);
  router.post("/api/admin/onboarding-campaigns/:id/send-batch", handleSendBatch);
}
