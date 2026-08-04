// Admin editor for the public landing counters.
//
//   GET   /api/admin/public-stats — every counter: measured, offset, shown
//   PATCH /api/admin/public-stats — set one or more offsets
//
// The GET always returns the measured number beside the shown one. That is not
// decoration: the offset means the landing page no longer answers "how big is
// Weddly", so this route is the only place that still does, and an operator
// who cannot see both figures at once ends up steering on the padded one.
//
// The PATCH is PARTIAL by contract, like the community-supplier edit: an
// absent key means "leave it alone", so a form about the couples counter can
// never blank the other three. A negative offset is a 400 rather than a clamp
// (see `normalizeBoost`), and every accepted write busts the 60s public cache
// so the change is live before the operator reloads the landing.

import {
  type AdminPublicStatRow,
  type AdminPublicStatsPatch,
  type AdminPublicStatsView,
  MAX_STAT_BOOST,
  PUBLIC_STAT_KEYS,
} from "@shared/public_stats";
import {
  computePublicStatsReal,
  getStatBoosts,
  getStatBoostTimestamps,
  normalizeBoost,
  setStatBoosts,
} from "../domain/public_stats";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { resetPublicStatsCache } from "./public_stats";

function buildView(): AdminPublicStatsView {
  const real = computePublicStatsReal();
  const boost = getStatBoosts();
  const stamps = getStatBoostTimestamps();
  const items: AdminPublicStatRow[] = PUBLIC_STAT_KEYS.map((key) => ({
    key,
    real: real[key],
    boost: boost[key],
    shown: real[key] + boost[key],
    updated_at: stamps[key] ?? null,
  }));
  return { items };
}

async function handleGet(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  return json(buildView());
}

async function handlePatch(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const body = await readJson<Record<string, unknown> | null>(ctx.req);
  if (!body || typeof body !== "object") throw new HttpError(400, "body required");

  const patch: AdminPublicStatsPatch = {};
  for (const key of PUBLIC_STAT_KEYS) {
    if (!(key in body)) continue;
    const value = normalizeBoost(body[key]);
    if (value === null) {
      throw new HttpError(400, `${key} must be a whole number between 0 and ${MAX_STAT_BOOST}`);
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) throw new HttpError(400, "no counter named");

  const changed = setStatBoosts(patch, admin.id);
  if (changed.length > 0) {
    resetPublicStatsCache();
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "public_stats.boost_updated",
      target_kind: "public_stats",
      target_id: null,
      note: changed.map((key) => `${key}=${patch[key]}`).join(" "),
    });
  }
  return json(buildView());
}

export function registerAdminPublicStatsRoutes(router: Router) {
  router.get("/api/admin/public-stats", handleGet, true);
  router.patch("/api/admin/public-stats", handlePatch, true);
}
