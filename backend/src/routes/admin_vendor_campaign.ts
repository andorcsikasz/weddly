// Admin console for the vendor claim-invite campaign (KEZELÉS → Szolgáltatók →
// Meghívó kampány). Gated by requireAdmin() like every other admin surface.
//
// The operator affordances are deliberately narrow: create a campaign, look at
// exactly who it would write to, start it, pause it. There is no "send all now"
// button, because cold volume is a deliverability risk to the whole domain and
// the pacing belongs to the worker, not to an impatient click. `send-batch`
// exists for a small supervised first round; it still honours the campaign's
// rolling-24h budget.

import type { CreateVendorCampaignInput, UpdateVendorCampaignInput } from "@shared/vendor_campaign";
import {
  addOptOut,
  campaignStats,
  createCampaign,
  getCampaignDetail,
  getCampaignRow,
  listCampaigns,
  listSends,
  listTargets,
  sendCampaignBatch,
  sendCampaignReminders,
  updateCampaign,
} from "../domain/vendor_campaign";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

/** Ceiling on a single supervised batch. Above this the operator should let the
 *  worker pace it out instead. */
const MAX_MANUAL_BATCH = 50;
const TARGET_PREVIEW_LIMIT = 200;
const SENDS_PAGE_LIMIT = 500;

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
  const body = await readJson<CreateVendorCampaignInput>(ctx.req);
  const campaign = createCampaign(body, actor);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.campaign.create",
    target_kind: "vendor_campaign",
    target_id: campaign.id,
    after: { slug: campaign.slug, daily_cap: campaign.daily_cap, country: campaign.country },
  });
  return json({ campaign }, { status: 201 });
}

function handleDetail(ctx: Ctx): Response {
  requireAdmin(ctx);
  const detail = getCampaignDetail(parseId(ctx));
  if (!detail) throw new HttpError(404, "Campaign not found");
  return json(detail);
}

/** Who this campaign would write to next. The point of the endpoint is that an
 *  operator can read the actual addresses BEFORE starting something that cannot
 *  be unsent. */
function handleTargets(ctx: Ctx): Response {
  requireAdmin(ctx);
  const row = requireCampaign(ctx);
  return json({ targets: listTargets(row, TARGET_PREVIEW_LIMIT), stats: campaignStats(row) });
}

function handleSends(ctx: Ctx): Response {
  requireAdmin(ctx);
  const row = requireCampaign(ctx);
  return json({ sends: listSends(row.id, SENDS_PAGE_LIMIT) });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const row = requireCampaign(ctx);
  const body = await readJson<UpdateVendorCampaignInput>(ctx.req);
  const campaign = updateCampaign(row.id, body);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.campaign.update",
    target_kind: "vendor_campaign",
    target_id: campaign.id,
    before: { status: row.status, daily_cap: row.daily_cap },
    after: { status: campaign.status, daily_cap: campaign.daily_cap },
  });
  return json({ campaign });
}

interface SendBatchBody {
  limit?: unknown;
}

async function handleSendBatch(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const row = requireCampaign(ctx);
  const body = await readJson<SendBatchBody>(ctx.req);
  const raw = body.limit;
  const limit = typeof raw === "number" && Number.isInteger(raw) ? raw : 10;
  if (limit < 1 || limit > MAX_MANUAL_BATCH) {
    throw new HttpError(400, `limit must be between 1 and ${MAX_MANUAL_BATCH}`);
  }
  const sent = await sendCampaignBatch(row, limit);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.campaign.send_batch",
    target_kind: "vendor_campaign",
    target_id: row.id,
    after: { requested: limit, sent },
  });
  const detail = getCampaignDetail(row.id);
  return json({ sent, ...(detail ?? {}) });
}

interface OptOutBody {
  email?: unknown;
}

/** Manual suppression, for the "please take me off your list" reply that lands
 *  in the support inbox instead of going through the footer link. */
async function handleOptOut(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const body = await readJson<OptOutBody>(ctx.req);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length < 3 || !email.includes("@")) throw new HttpError(400, "email is required");
  const created = addOptOut(email, "manual");
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.campaign.optout",
    target_kind: "email",
    target_id: null,
    after: { email, created },
  });
  return json({ ok: true, created });
}

/** Manual trigger for the 2-day reminder sweep. The worker runs it hourly; this
 *  is here so an operator can flush it on demand while watching a first round. */
async function handleRunReminders(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const sent = await sendCampaignReminders(MAX_MANUAL_BATCH);
  return json({ sent });
}

export function registerAdminVendorCampaignRoutes(router: Router) {
  router.get("/api/admin/vendor-campaigns", handleList, true);
  router.post("/api/admin/vendor-campaigns", handleCreate, true);
  router.get("/api/admin/vendor-campaigns/:id", handleDetail, true);
  router.patch("/api/admin/vendor-campaigns/:id", handleUpdate, true);
  router.get("/api/admin/vendor-campaigns/:id/targets", handleTargets, true);
  router.get("/api/admin/vendor-campaigns/:id/sends", handleSends, true);
  router.post("/api/admin/vendor-campaigns/:id/send-batch", handleSendBatch, true);
  router.post("/api/admin/vendor-campaigns/reminders", handleRunReminders, true);
  router.post("/api/admin/vendor-campaigns/optout", handleOptOut, true);
}
