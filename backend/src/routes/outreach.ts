// Supplier Outreach Inbox — Q3 (P2.E).
//
// v1 ships the send pipeline + history surfaces:
//   - POST   /api/outreach/campaigns    — create + fire a campaign
//   - GET    /api/outreach/campaigns    — couple's recent campaigns
//   - GET    /api/outreach/campaigns/:id — campaign + messages + replies
//   - GET    /api/outreach/health        — schema/version marker for ops
//
// v1.5 adds the Resend inbound webhook (POST /api/inbound/email) + the
// "Add to outreach" button on /app/suppliers cards. For v1 the vendor
// replies straight to the couple's email (Reply-To is the couple's own
// inbox), so the in-app /app/outreach surface is "sent history" only —
// no replies appear in the in-app thread yet, which is communicated to
// the user via the UI copy.
//
// Sending is also the couple-facing INQUIRY path: a recipient whose listing
// is claimed by an entitled vendor gets a `supplier_bookings` row so the
// message shows up in their Weddly client list, dashboard and stats — not
// only in whatever inbox `listings.contact_email` points at. See
// `deliverInquiryFromOutreach`. The two vendor-side hops below mirror the
// admin booking route.

import type { OutreachCampaign, OutreachCampaignDetail } from "@shared/outreach";
import { getCoupleForUser } from "../domain/couples";
import {
  createCampaign,
  getCampaignDetail,
  listCampaigns,
  parseCreateInput,
} from "../domain/outreach";
import { db } from "../db";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { addAuditLog } from "../lib/audit";
import { markVendorCalendarDirty } from "../domain/vendor_google_calendar";
import { ensureVendorScheduledSubscription } from "./vendor_billing";

interface OutreachHealth {
  /** Build stage marker. Bumps to "v1" with the send + list + detail
   *  endpoints; "v1.5" when the inbound webhook lands. */
  stage: "schema-prep" | "v1" | "v1.5";
  /** True when the send + list + detail endpoints are live. v1.5 will
   *  flip this to true on a SEPARATE marker; consumers shouldn't gate
   *  features on `ready` alone — read `stage`. */
  ready: boolean;
  tables: {
    outreach_campaigns: boolean;
    outreach_messages: boolean;
    outreach_replies: boolean;
  };
}

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return row !== undefined;
}

function handleHealth(): Response {
  const payload: OutreachHealth = {
    stage: "v1",
    ready: true,
    tables: {
      outreach_campaigns: tableExists("outreach_campaigns"),
      outreach_messages: tableExists("outreach_messages"),
      outreach_replies: tableExists("outreach_replies"),
    },
  };
  return json(payload);
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) {
    throw new HttpError(403, "Couple workspace required to send outreach", { code: "no_couple" });
  }
  const raw = await readJson<unknown>(ctx.req);
  const input = parseCreateInput(raw);
  const { detail, inquiries } = createCampaign(couple, input);
  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "outreach.campaign_create",
    target_kind: "outreach_campaign",
    target_id: detail.id,
    after: {
      supplier_ids: detail.messages.map((m) => m.supplier_id),
      message_count: detail.messages.length,
      inquiry_count: inquiries.length,
      subject: detail.subject,
    },
  });
  // Vendor-side side effects for every recipient the message actually reached
  // in-app. Same two hops the admin booking route runs, and for the same
  // reason: this request is the COUPLE's, so the owning vendor is resolved off
  // the inquiry rather than the session.
  for (const inquiry of inquiries) {
    markVendorCalendarDirty(inquiry.vendorAccountId);
    // Freemium: a delivered lead can spend the vendor's last free credit, which
    // schedules their first payment. Only a genuinely new inquiry does that —
    // a follow-up on an open one costs nothing.
    if (inquiry.isNew) void ensureVendorScheduledSubscription(inquiry.vendorAccountId);
  }
  return json(detail, { status: 201 });
}

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) {
    throw new HttpError(403, "Couple workspace required", { code: "no_couple" });
  }
  const campaigns: OutreachCampaign[] = listCampaigns(couple.id);
  return json({ campaigns });
}

function handleDetail(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) {
    throw new HttpError(403, "Couple workspace required", { code: "no_couple" });
  }
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) {
    throw new HttpError(400, "Invalid campaign id");
  }
  const detail: OutreachCampaignDetail | null = getCampaignDetail(couple.id, id);
  if (!detail) {
    throw new HttpError(404, "Campaign not found", { code: "campaign_not_found" });
  }
  return json(detail);
}

export function registerOutreachRoutes(router: Router) {
  router.get("/api/outreach/health", handleHealth);
  router.post("/api/outreach/campaigns", handleCreate);
  router.get("/api/outreach/campaigns", handleList);
  router.get("/api/outreach/campaigns/:id", handleDetail);
}
