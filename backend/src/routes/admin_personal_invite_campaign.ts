// Admin console for the personal-invite campaign (KEZELÉS → Personal invites).
// Gated by requireAdmin() like every other admin surface.
//
// Same operator affordances as the vendor campaigns: create, import a contact
// list (CSV paste or a JSON array, deduped server-side against `users` +
// `email_optouts` so "already registered" is honoured against live prod data),
// preview the seeded rows, start, pause. No "send all now" button, cold-ish
// volume is a deliverability risk to the whole domain, so pacing belongs to the
// worker. `send-batch` exists for a small supervised first round and still
// honours the campaign's rolling-24h budget.

import type {
  CreatePersonalInviteCampaignInput,
  ImportContact,
  ImportPersonalInviteContactsInput,
  UpdatePersonalInviteCampaignInput,
} from "@shared/personal_invite_campaign";
import { requireAdmin } from "../domain/users";
import {
  campaignStats,
  createCampaign,
  getCampaignDetail,
  getCampaignRow,
  importContacts,
  listCampaigns,
  listSends,
  parseCsvContacts,
  sendCampaignBatch,
  updateCampaign,
} from "../domain/personal_invite_campaign";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

const MAX_MANUAL_BATCH = 50;
const SENDS_PAGE_LIMIT = 2000;
const MAX_IMPORT_CONTACTS = 20000;

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
  const body = await readJson<CreatePersonalInviteCampaignInput>(ctx.req);
  const campaign = createCampaign(body, actor);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "personal_invite.campaign.create",
    target_kind: "personal_invite_campaign",
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
  const body = await readJson<UpdatePersonalInviteCampaignInput>(ctx.req);
  const updated = updateCampaign(campaign.id, body);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "personal_invite.campaign.update",
    target_kind: "personal_invite_campaign",
    target_id: campaign.id,
    after: { status: updated.status, daily_cap: updated.daily_cap },
  });
  return json({ campaign: updated });
}

/** Coerce the request body into a contact list. Accepts either a `csv` string
 *  (with a name,email header) or a `contacts` array of {name,email}. */
function contactsFromBody(body: ImportPersonalInviteContactsInput): ImportContact[] {
  if (typeof body.csv === "string" && body.csv.trim().length > 0) {
    return parseCsvContacts(body.csv);
  }
  if (Array.isArray(body.contacts)) {
    const out: ImportContact[] = [];
    for (const c of body.contacts) {
      if (c && typeof c === "object") {
        const email =
          typeof (c as { email?: unknown }).email === "string"
            ? (c as { email: string }).email
            : "";
        const name =
          typeof (c as { name?: unknown }).name === "string" ? (c as { name: string }).name : "";
        if (email) out.push({ name, email });
      }
    }
    return out;
  }
  throw new HttpError(400, "Provide a `csv` string or a `contacts` array");
}

async function handleImport(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx).id;
  const campaign = requireCampaign(ctx);
  const body = await readJson<ImportPersonalInviteContactsInput>(ctx.req);
  const contacts = contactsFromBody(body);
  if (contacts.length === 0) throw new HttpError(400, "No contacts found in the payload");
  if (contacts.length > MAX_IMPORT_CONTACTS) {
    throw new HttpError(400, `Too many contacts (max ${MAX_IMPORT_CONTACTS})`);
  }
  const result = importContacts(campaign.id, contacts);
  addAuditLog({
    actor_user_id: actor,
    couple_id: null,
    action: "personal_invite.campaign.import",
    target_kind: "personal_invite_campaign",
    target_id: campaign.id,
    after: { ...result, received: contacts.length },
  });
  return json({ result, stats: campaignStats(getCampaignRow(campaign.id)!) });
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
    action: "personal_invite.campaign.send_batch",
    target_kind: "personal_invite_campaign",
    target_id: campaign.id,
    after: { requested: limit, sent },
  });
  return json({ sent, stats: campaignStats(getCampaignRow(campaign.id)!) });
}

export function registerAdminPersonalInviteCampaignRoutes(router: Router): void {
  router.get("/api/admin/personal-invite/campaigns", handleList);
  router.post("/api/admin/personal-invite/campaigns", handleCreate);
  router.get("/api/admin/personal-invite/campaigns/:id", handleDetail);
  router.patch("/api/admin/personal-invite/campaigns/:id", handleUpdate);
  router.post("/api/admin/personal-invite/campaigns/:id/import", handleImport);
  router.get("/api/admin/personal-invite/campaigns/:id/sends", handleSends);
  router.post("/api/admin/personal-invite/campaigns/:id/send-batch", handleSendBatch);
}
