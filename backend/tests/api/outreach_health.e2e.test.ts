// Outreach Inbox health endpoint. The schema landed in a47199a as a Q3
// reservation; this file followed the prep stage. With the v1 send +
// list + detail endpoints now live, the stage marker flips to "v1" and
// `ready` to true. v1.5 (inbound webhook + reply archival) will bump the
// stage marker again.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req } from "../helpers";

interface OutreachHealth {
  stage: "schema-prep" | "v1" | "v1.5";
  ready: boolean;
  tables: {
    outreach_campaigns: boolean;
    outreach_messages: boolean;
    outreach_replies: boolean;
  };
}

describe("GET /api/outreach/health — Q3 status marker", () => {
  test("reports v1 stage with all three tables present once send + list ship", async () => {
    const r = await req<OutreachHealth>("GET", "/api/outreach/health");
    expect(r.status).toBe(200);
    expect(r.data.stage).toBe("v1");
    expect(r.data.ready).toBe(true);
    expect(r.data.tables.outreach_campaigns).toBe(true);
    expect(r.data.tables.outreach_messages).toBe(true);
    expect(r.data.tables.outreach_replies).toBe(true);
  });

  test("endpoint is unauthenticated (no 401 without bearer)", async () => {
    const r = await req<OutreachHealth>("GET", "/api/outreach/health");
    expect(r.status).toBe(200);
  });
});
