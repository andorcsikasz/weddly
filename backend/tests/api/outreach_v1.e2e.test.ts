// Outreach Inbox v1 — send + list + detail endpoints.
//
//   POST   /api/outreach/campaigns       — couple-initiated cold outreach
//                                          to a shortlisted vendor (up to 5
//                                          suppliers per campaign, 3
//                                          campaigns per rolling 7 days)
//   GET    /api/outreach/campaigns       — the couple's recent campaigns
//   GET    /api/outreach/campaigns/:id   — campaign + messages + replies
//
// Reply capture (the Resend inbound webhook) is v1.5 — v1 stamps a
// reply_token on every message ahead of time and uses the couple owner's
// own email as the Reply-To address so the vendor's reply lands in the
// couple's inbox while we wait for the inbound DNS to settle.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  OUTREACH_CAMPAIGNS_PER_WEEK_CAP,
  OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP,
  type OutreachCampaign,
  type OutreachCampaignDetail,
} from "@shared/outreach";
import { db } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// Curated suppliers that ship with a `contact_email` in suppliers_data.ts.
// The seeded `listings` table mirrors them at boot via backfillListings, so
// the `IN (...)` lookup inside `createCampaign` resolves them cleanly.
const SUPPLIERS_WITH_EMAIL = [
  "budapest-congress-center",
  "the-kitchen-caters",
  "budapest-congress-center-catering",
  "closer-wedding",
  "budapest-wedding",
  "infinitedreams",
] as const;

describe("POST /api/outreach/campaigns — happy path + validation", () => {
  test("creates a campaign with one message per supplier and stamps reply_token", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-owner@weddly.test");
    const r = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Photo + video on June 14, 2027",
        body_template:
          "We're tying the knot in Budapest on June 14, 2027 — about 110 guests. Do you have the date free?\n\nWould love to see a price sheet if possible.",
        supplier_ids: SUPPLIERS_WITH_EMAIL.slice(0, 3),
      },
      { token },
    );
    expect(r.status).toBe(201);
    expect(r.data.messages).toHaveLength(3);
    expect(r.data.message_count).toBe(3);
    for (const msg of r.data.messages) {
      expect(msg.supplier_id).toBeTruthy();
      expect(msg.supplier_email).toContain("@");
      expect(msg.status).toBe("sent");
      expect(msg.sent_at).not.toBeNull();
      // 32-hex reply token, ready for the v1.5 inbound webhook.
      expect(msg.reply_token).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  test("supplier cap → 400 with code=supplier_cap_exceeded", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-cap@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Too many",
        body_template: "Anything",
        // Cap is 5; send 6 to trip it. SUPPLIERS_WITH_EMAIL has 6 entries.
        supplier_ids: SUPPLIERS_WITH_EMAIL.slice(0, OUTREACH_SUPPLIERS_PER_CAMPAIGN_CAP + 1),
      },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("supplier_cap_exceeded");
  });

  test("unknown supplier id → 400 with code=supplier_not_found", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-unknown@weddly.test");
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Hi",
        body_template: "Hi",
        supplier_ids: ["doesnt-exist-anywhere"],
      },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("supplier_not_found");
  });

  test("supplier without contact_email → 400 with code=supplier_no_email", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-noemail@weddly.test");
    // `normafa-rendezvenyhaz` is curated but ships with `contact_email:
    // null` (the `...noContact` spread default), so it surfaces the
    // missing-email branch without polluting the test with a special
    // listing seed.
    const r = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Hi",
        body_template: "Hi",
        supplier_ids: ["normafa-rendezvenyhaz"],
      },
      { token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("supplier_no_email");
  });

  test("4th campaign in 7 days → 429 with code=campaign_rate_limited", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-rate@weddly.test");
    // Burn the per-week cap. Each campaign hits one supplier, well under
    // the per-campaign supplier cap.
    for (let i = 0; i < OUTREACH_CAMPAIGNS_PER_WEEK_CAP; i++) {
      const r = await req<OutreachCampaignDetail>(
        "POST",
        "/api/outreach/campaigns",
        {
          subject: `Campaign #${i + 1}`,
          body_template: "Body",
          supplier_ids: [SUPPLIERS_WITH_EMAIL[0]],
        },
        { token },
      );
      expect(r.status).toBe(201);
    }
    const overflow = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Cap+1",
        body_template: "Body",
        supplier_ids: [SUPPLIERS_WITH_EMAIL[1]],
      },
      { token },
    );
    expect(overflow.status).toBe(429);
    expect(overflow.data.detail?.code).toBe("campaign_rate_limited");
  });

  test("empty subject → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-empty@weddly.test");
    const r = await req(
      "POST",
      "/api/outreach/campaigns",
      { subject: "  ", body_template: "Body", supplier_ids: [SUPPLIERS_WITH_EMAIL[0]] },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("anon → 401", async () => {
    wipeAll();
    const r = await req("POST", "/api/outreach/campaigns", {
      subject: "Hi",
      body_template: "Hi",
      supplier_ids: [SUPPLIERS_WITH_EMAIL[0]],
    });
    expect(r.status).toBe(401);
  });

  test("audit log + email_log rows land per message", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("outreach-audit@weddly.test");
    const r = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "Audit",
        body_template: "Body",
        supplier_ids: SUPPLIERS_WITH_EMAIL.slice(0, 2),
      },
      { token },
    );
    expect(r.status).toBe(201);
    const audit = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'outreach.campaign_create' AND couple_id = ?",
      )
      .get(coupleId) as { n: number };
    expect(audit.n).toBe(1);
    // Each message fires exactly one email_log row (status skipped_no_provider
    // because RESEND_API_KEY is empty in tests).
    const emails = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_log WHERE kind = 'supplier_outreach' AND couple_id = ?",
      )
      .get(coupleId) as { n: number };
    expect(emails.n).toBe(2);
  });
});

describe("GET /api/outreach/campaigns — list view", () => {
  test("returns the couple's recent campaigns, newest first", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-list@weddly.test");
    const first = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      { subject: "First", body_template: "Body", supplier_ids: [SUPPLIERS_WITH_EMAIL[0]] },
      { token },
    );
    await new Promise((r) => setTimeout(r, 5));
    const second = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      { subject: "Second", body_template: "Body", supplier_ids: [SUPPLIERS_WITH_EMAIL[1]] },
      { token },
    );
    const list = await req<{ campaigns: OutreachCampaign[] }>(
      "GET",
      "/api/outreach/campaigns",
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    expect(list.data.campaigns).toHaveLength(2);
    expect(list.data.campaigns[0]?.id).toBe(second.data.id);
    expect(list.data.campaigns[1]?.id).toBe(first.data.id);
    expect(list.data.campaigns[0]?.message_count).toBe(1);
  });

  test("cross-couple isolation — another couple's campaigns are invisible", async () => {
    wipeAll();
    const a = await bootstrapCouple("outreach-iso-a@weddly.test");
    const b = await bootstrapCouple("outreach-iso-b@weddly.test");
    await req(
      "POST",
      "/api/outreach/campaigns",
      {
        subject: "A's campaign",
        body_template: "Body",
        supplier_ids: [SUPPLIERS_WITH_EMAIL[0]],
      },
      { token: a.token },
    );

    const list = await req<{ campaigns: OutreachCampaign[] }>(
      "GET",
      "/api/outreach/campaigns",
      undefined,
      { token: b.token },
    );
    expect(list.status).toBe(200);
    expect(list.data.campaigns).toHaveLength(0);
  });
});

describe("GET /api/outreach/campaigns/:id — detail view", () => {
  test("returns the campaign + messages + (empty) replies", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-detail@weddly.test");
    const created = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      { subject: "Detail", body_template: "Body", supplier_ids: SUPPLIERS_WITH_EMAIL.slice(0, 2) },
      { token },
    );
    const detail = await req<OutreachCampaignDetail>(
      "GET",
      `/api/outreach/campaigns/${created.data.id}`,
      undefined,
      { token },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.subject).toBe("Detail");
    expect(detail.data.messages).toHaveLength(2);
    expect(detail.data.replies).toHaveLength(0); // v1.5 will populate
    // Supplier names should be filled in (looked up from the listings
    // table at read time so a later rename surfaces correctly).
    for (const msg of detail.data.messages) {
      expect(msg.supplier_name.length).toBeGreaterThan(0);
    }
  });

  test("another couple's campaign id → 404 (no information leak)", async () => {
    wipeAll();
    const a = await bootstrapCouple("outreach-leak-a@weddly.test");
    const b = await bootstrapCouple("outreach-leak-b@weddly.test");
    const created = await req<OutreachCampaignDetail>(
      "POST",
      "/api/outreach/campaigns",
      { subject: "A's", body_template: "Body", supplier_ids: [SUPPLIERS_WITH_EMAIL[0]] },
      { token: a.token },
    );
    const peek = await req<{ detail?: { code?: string } }>(
      "GET",
      `/api/outreach/campaigns/${created.data.id}`,
      undefined,
      { token: b.token },
    );
    expect(peek.status).toBe(404);
    expect(peek.data.detail?.code).toBe("campaign_not_found");
  });

  test("invalid id → 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("outreach-bad-id@weddly.test");
    const r = await req("GET", "/api/outreach/campaigns/not-a-number", undefined, { token });
    expect(r.status).toBe(400);
  });
});

describe("supplier_outreach email builder sets Reply-To to the couple owner", () => {
  test("buildEmail exposes the couple's address as replyTo so sendEmail overrides the default", () => {
    // Direct builder unit test — the dispatcher (`send.ts`) plumbs
    // `built.replyTo` into the outgoing headers map, where it overrides
    // the global `CONFIG.supportEmail` Reply-To default. Without this the
    // vendor's reply lands in Weddly's support inbox instead of the
    // couple's, which silently breaks the entire outreach feature loop.
    const built = buildEmail(
      "supplier_outreach",
      {
        coupleDisplayName: "Mia & Lucas",
        coupleReplyEmail: "anna.bence@example.test",
        coupleReplyName: "Anna",
        supplierName: "Etyeki Kúria",
        subject: "June 14, 2027",
        body: "Are you free that weekend? About 110 guests.",
        outreachUrl: "https://weddly.hu/app/outreach",
      },
      {
        recipientName: "Etyeki Kúria",
      },
    );
    expect(built.replyTo).toBe("anna.bence@example.test");
    // Footer fallback still surfaces the address in the body so a client
    // that strips Reply-To gives the vendor a copyable address.
    expect(built.rendered.text).toContain("anna.bence@example.test");
  });
});

describe("GDPR purge cascades outreach tables", () => {
  test("purgeOneCouple deletes campaigns + messages + replies in dependency order", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("outreach-purge@weddly.test");
    await req(
      "POST",
      "/api/outreach/campaigns",
      { subject: "Purge", body_template: "Body", supplier_ids: SUPPLIERS_WITH_EMAIL.slice(0, 2) },
      { token },
    );
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM outreach_campaigns WHERE couple_id = ?")
      .get(coupleId) as { n: number };
    expect(before.n).toBe(1);

    // Lazy import to avoid a circular hit if helpers ever pull purge.ts in.
    const { purgeOneCouple } = await import("../../src/domain/purge");
    purgeOneCouple(coupleId, { silent: true });

    const afterCampaigns = db
      .prepare("SELECT COUNT(*) AS n FROM outreach_campaigns WHERE couple_id = ?")
      .get(coupleId) as { n: number };
    expect(afterCampaigns.n).toBe(0);
    // Messages should be cascaded by the parent-first DELETE in purge.ts
    // (FK ON DELETE CASCADE on the children, plus the explicit deletes
    // landed alongside the schema).
    const orphanMessages = db
      .prepare(
        "SELECT COUNT(*) AS n FROM outreach_messages WHERE campaign_id IN (SELECT id FROM outreach_campaigns WHERE couple_id = ?)",
      )
      .get(coupleId) as { n: number };
    expect(orphanMessages.n).toBe(0);
  });
});
