// Supplier Outreach Inbox — Q3 milestone.
//
// Schema is in place (`outreach_campaigns / outreach_messages / outreach_replies`
// in schema.sql), GDPR purge cascade is wired (domain/purge.ts), but the
// send pipeline + inbound webhook + UI all land in Q3 per the 5-agent debate
// Agent C verdict. This file exists as a route reservation so the next dev
// session has a stub to extend instead of a clean-sheet bootstrap.
//
// Today: a single `GET /api/outreach/health` endpoint reports the prep stage
// so external monitors (and the Q3 dev) know whether the migration succeeded.
// It's an unauthenticated read because the response is content-free.

import { db } from "../db";
import { json, type Router } from "../lib/http";

interface OutreachHealth {
  /** Build stage marker. Bumps to "v1" when POST /api/outreach/campaigns lands. */
  stage: "schema-prep" | "v1";
  /** True once the v1 build has wired actual send + inbound webhook plumbing. */
  ready: boolean;
  /** Schema sanity — confirms the three tables exist and are query-able. */
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
    stage: "schema-prep",
    ready: false,
    tables: {
      outreach_campaigns: tableExists("outreach_campaigns"),
      outreach_messages: tableExists("outreach_messages"),
      outreach_replies: tableExists("outreach_replies"),
    },
  };
  return json(payload);
}

export function registerOutreachRoutes(router: Router) {
  router.get("/api/outreach/health", handleHealth);
}
