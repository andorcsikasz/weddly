// Admin editor for the public landing counters.
//
//   GET   /api/admin/public-stats — every counter: measured, offset, shown
//   PATCH /api/admin/public-stats — set one or more offsets, and/or hide/show
//
// The GET always returns the measured number beside the shown one. That is not
// decoration: the offset means the landing page no longer answers "how big is
// Weddly", so this route is the only place that still does, and an operator
// who cannot see both figures at once ends up steering on the padded one.
//
// The PATCH is PARTIAL by contract, like the community-supplier edit: an
// absent key means "leave it alone", so a form about the couples counter can
// never blank the other three. That holds for the `hidden` map too — a body
// that says nothing about a counter's visibility must not put a withheld one
// back on the public page. A negative offset is a 400 rather than a clamp (see
// `normalizeBoost`), and every accepted write busts the 60s public cache so the
// change is live before the operator reloads the landing.
//
// Hiding is deliberately NOT modelled as a boost of 0: zero still publishes the
// measured number, and the reason to reach for this is that the measured number
// is the thing not worth quoting yet.

import {
  type AdminPublicStatRow,
  type AdminPublicStatsPatch,
  type AdminPublicStatsView,
  isPublicStatKey,
  MAX_STAT_BOOST,
  PUBLIC_STAT_KEYS,
} from "@shared/public_stats";
import {
  computePublicStatsReal,
  getStatSettings,
  normalizeBoost,
  setStatSettings,
} from "../domain/public_stats";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { resetPublicStatsCache } from "./public_stats";

function buildView(): AdminPublicStatsView {
  const real = computePublicStatsReal();
  const settings = getStatSettings();
  const items: AdminPublicStatRow[] = PUBLIC_STAT_KEYS.map((key) => ({
    key,
    real: real[key],
    boost: settings[key].boost,
    // Reported even while the counter is hidden: admin is the surface that
    // still answers "how big is Weddly", and a blank there would be the same
    // mistake as steering on the padded number.
    shown: real[key] + settings[key].boost,
    hidden: settings[key].hidden,
    updated_at: settings[key].updated_at,
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

  // `hidden` is a sibling map rather than a counter key, so it can never
  // collide with one. Only a real boolean counts: an absent entry leaves that
  // counter's visibility exactly as it was.
  if (body.hidden !== undefined) {
    const raw = body.hidden;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new HttpError(400, "hidden must be a map of counter to true/false");
    }
    const hidden: NonNullable<AdminPublicStatsPatch["hidden"]> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!isPublicStatKey(key)) throw new HttpError(400, `hidden.${key} is not a counter`);
      if (typeof value !== "boolean")
        throw new HttpError(400, `hidden.${key} must be true or false`);
      hidden[key] = value;
    }
    if (Object.keys(hidden).length > 0) patch.hidden = hidden;
  }

  if (Object.keys(patch).length === 0) throw new HttpError(400, "no counter named");

  const changed = setStatSettings(patch, admin.id);
  if (changed.length > 0) {
    resetPublicStatsCache();
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "public_stats.boost_updated",
      target_kind: "public_stats",
      target_id: null,
      note: changed.join(" "),
    });
  }
  return json(buildView());
}

export function registerAdminPublicStatsRoutes(router: Router) {
  router.get("/api/admin/public-stats", handleGet, true);
  router.patch("/api/admin/public-stats", handlePatch, true);
}
