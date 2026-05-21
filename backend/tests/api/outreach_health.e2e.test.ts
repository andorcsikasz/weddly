// Outreach Inbox schema-prep stub. The full Q3 build (POST campaigns,
// inbound reply webhook, in-app inbox UI) lands later; this commit only
// reserves the schema + the route. The health endpoint exists so future-us
// can confirm the tables are query-able in a deployment before wiring real
// send pipelines on top.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req } from "../helpers";

interface OutreachHealth {
  stage: "schema-prep" | "v1";
  ready: boolean;
  tables: {
    outreach_campaigns: boolean;
    outreach_messages: boolean;
    outreach_replies: boolean;
  };
}

describe("GET /api/outreach/health — Q3 schema-prep marker", () => {
  test("reports schema-prep stage with all three tables present", async () => {
    const r = await req<OutreachHealth>("GET", "/api/outreach/health");
    expect(r.status).toBe(200);
    expect(r.data.stage).toBe("schema-prep");
    expect(r.data.ready).toBe(false);
    expect(r.data.tables.outreach_campaigns).toBe(true);
    expect(r.data.tables.outreach_messages).toBe(true);
    expect(r.data.tables.outreach_replies).toBe(true);
  });

  test("endpoint is unauthenticated (no 401 without bearer)", async () => {
    const r = await req<OutreachHealth>("GET", "/api/outreach/health");
    expect(r.status).toBe(200);
  });
});
