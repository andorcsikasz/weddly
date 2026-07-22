// Admin console for the vendor review-invite campaign (KEZELÉS → Szolgáltatók →
// Vélemény kampány). Gated by requireAdmin() like every other admin surface.
//
// Same operator affordances as the claim campaign: create, preview exactly who
// it would write to, start, pause. No "send all now" button — cold-ish volume
// is a deliverability risk to the whole domain, so pacing belongs to the worker.
// `send-batch` exists for a small supervised first round and still honours the
// campaign's rolling-24h budget.

import type {
  CreateVendorReviewCampaignInput,
  UpdateVendorReviewCampaignInput,
} from "@shared/vendor_review_campaign";
import { requireAdmin } from "../domain/users";
import {
  addOptOut,
  campaignStats,
  createCampaign,
  getCampaignDetail,
  getCampaignRow,
  listCampaigns,
  listSegments,
  listSends,
  listTargets,
  sendCampaignBatch,
  sendCampaignReminders,
  updateCampaign,
} from "../domain/vendor_review_campaign";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

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
  const body = await readJson<CreateVendorReviewCampaignInput>(ctx.req);
  const campaign = createCampaign(body, actor);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.review_campaign.create",
    target_kind: "vendor_review_campaign",
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

/** Who this campaign would write to next — read the actual addresses BEFORE
 *  starting something that cannot be unsent. */
function handleTargets(ctx: Ctx): Response {
  requireAdmin(ctx);
  const row = requireCampaign(ctx);
  return json({ targets: listTargets(row, TARGET_PREVIEW_LIMIT), stats: campaignStats(row) });
}

function handleSegments(ctx: Ctx): Response {
  requireAdmin(ctx);
  return json(listSegments());
}

function handleSends(ctx: Ctx): Response {
  requireAdmin(ctx);
  const row = requireCampaign(ctx);
  return json({ sends: listSends(row.id, SENDS_PAGE_LIMIT) });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const row = requireCampaign(ctx);
  const body = await readJson<UpdateVendorReviewCampaignInput>(ctx.req);
  const campaign = updateCampaign(row.id, body);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.review_campaign.update",
    target_kind: "vendor_review_campaign",
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
    action: "vendor.review_campaign.send_batch",
    target_kind: "vendor_review_campaign",
    target_id: row.id,
    after: { requested: limit, sent },
  });
  const detail = getCampaignDetail(row.id);
  return json({ sent, ...(detail ?? {}) });
}

interface OptOutBody {
  email?: unknown;
}

async function handleOptOut(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const body = await readJson<OptOutBody>(ctx.req);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email.length < 3 || !email.includes("@")) throw new HttpError(400, "email is required");
  const created = addOptOut(email, "manual");
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "vendor.review_campaign.optout",
    target_kind: "email",
    target_id: null,
    after: { email, created },
  });
  return json({ ok: true, created });
}

async function handleRunReminders(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const sent = await sendCampaignReminders(MAX_MANUAL_BATCH);
  return json({ sent });
}

export function registerAdminVendorReviewCampaignRoutes(router: Router) {
  router.get("/api/admin/vendor-review-campaigns", handleList, true);
  router.post("/api/admin/vendor-review-campaigns", handleCreate, true);
  router.get("/api/admin/vendor-review-campaigns/segments", handleSegments, true);
  router.get("/api/admin/vendor-review-campaigns/:id", handleDetail, true);
  router.patch("/api/admin/vendor-review-campaigns/:id", handleUpdate, true);
  router.get("/api/admin/vendor-review-campaigns/:id/targets", handleTargets, true);
  router.get("/api/admin/vendor-review-campaigns/:id/sends", handleSends, true);
  router.post("/api/admin/vendor-review-campaigns/:id/send-batch", handleSendBatch, true);
  router.post("/api/admin/vendor-review-campaigns/reminders", handleRunReminders, true);
  router.post("/api/admin/vendor-review-campaigns/optout", handleOptOut, true);
}
