// Vendor automations, the API behind /vendor/settings/automations.
//
//   GET    /api/vendor/automations                      - config + queue + activity
//   PUT    /api/vendor/automations/:key                 - partial patch of one switch
//   POST   /api/vendor/automations/proposals/:id/approve- send this review request
//   POST   /api/vendor/automations/proposals/:id/dismiss- never send it, never re-ask
//
// Authorisation: `resolveVendorAccount` (auth + role + owned account), then PRO
// on every WRITE and nothing on the read.
//
// The read staying open is the whole "a lapse parks it, it must not delete the
// vendor's text" rule made visible: a FREE vendor still opens the tab, still
// sees the message they wrote and the switch positions they chose, and gets an
// upgrade path instead of an empty form. Their configuration survives untouched
// because nothing on this route ever clears it, and the sweep skips them rather
// than disabling anything.

import { isVendorAutomationKey, type VendorAutomationKey } from "@shared/vendor_automations";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import {
  approveProposal,
  buildAutomationsView,
  dismissProposal,
  saveAutomation,
  type AutomationPatch,
} from "../domain/vendor_automations";
import { requireVendorPro, resolveVendorAccount } from "../domain/vendor_clients";

function automationKeyParam(ctx: Ctx): VendorAutomationKey {
  const raw = ctx.params?.key;
  if (!isVendorAutomationKey(raw)) {
    throw new HttpError(400, "Unknown automation", { code: "automation_unknown" });
  }
  return raw;
}

function runIdParam(ctx: Ctx): number {
  const id = Number(ctx.params?.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "automation run id required");
  return id;
}

/** Hand-written boundary guard, no schema library. Each field is optional and
 *  ABSENT MEANS UNCHANGED, so a body about the delay cannot silently disarm the
 *  switch and a body about the switch cannot blank the chosen text. */
function parsePatch(body: Record<string, unknown>): AutomationPatch {
  const patch: AutomationPatch = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be a boolean");
    patch.enabled = body.enabled;
  }
  if (body.template_id !== undefined) {
    if (body.template_id === null) {
      patch.template_id = null;
    } else {
      const id = Number(body.template_id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new HttpError(400, "template_id must be a positive id or null");
      }
      patch.template_id = id;
    }
  }
  if (body.delay_hours !== undefined) {
    const hours = Number(body.delay_hours);
    if (!Number.isFinite(hours)) throw new HttpError(400, "delay_hours must be a number");
    // Out-of-range values are CLAMPED rather than refused: the floor is a
    // property of the queue's own definition of "unanswered", not a typo the
    // vendor should be lectured about. `clampDelayHours` does the work.
    patch.delay_hours = hours;
  }
  return patch;
}

async function handleGet(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  return json(buildAutomationsView(account.id));
}

async function handleSave(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const key = automationKeyParam(ctx);
  const patch = parsePatch(await readJson<Record<string, unknown>>(ctx.req));
  const automation = saveAutomation(account.id, key, patch);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.automation_save",
    target_kind: "vendor_automation",
    target_id: account.id,
    after: {
      key,
      enabled: automation.enabled,
      template_id: automation.template_id,
      delay_hours: automation.delay_hours,
    },
  });
  return json(buildAutomationsView(account.id));
}

async function handleApprove(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const runId = runIdParam(ctx);
  await approveProposal(account.id, runId);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.automation_review_approved",
    target_kind: "vendor_automation_run",
    target_id: runId,
  });
  return json(buildAutomationsView(account.id));
}

async function handleDismiss(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  requireVendorPro(account.id);
  const runId = runIdParam(ctx);
  dismissProposal(account.id, runId);
  addAuditLog({
    actor_user_id: account.owner_user_id,
    couple_id: null,
    action: "vendor.automation_review_dismissed",
    target_kind: "vendor_automation_run",
    target_id: runId,
  });
  return json(buildAutomationsView(account.id));
}

export function registerVendorAutomationRoutes(router: Router) {
  router.get("/api/vendor/automations", handleGet, true);
  router.put("/api/vendor/automations/:key", handleSave, true);
  router.post("/api/vendor/automations/proposals/:id/approve", handleApprove, true);
  router.post("/api/vendor/automations/proposals/:id/dismiss", handleDismiss, true);
}
