// Camera-only accounts: the /camera "non-Weddly" path. Someone who came for the
// wedding camera and not for the planner signs up, names the wedding, and pays
// for a film tier, without walking the planner onboarding wizard.
//
// The film still needs a workspace (photo_albums.couple_id is NOT NULL and the
// whole film surface is couple-scoped), so this writes a real `couples` row with
// the two names and the date, and marks the USER `camera_only`. That flag is
// what puts the film on the stand-alone price ladder (shared/film_pricing.ts)
// and what gives the account a camera-only shell. Deliberately left out, next
// to onboarding: no billing trial (there is no subscription to try), no
// partner guest rows, no planner links. The real-name rule is the same one the
// wizard runs, since the names are what guests see on the film.
//
// Creating the film and paying for it are the existing endpoints
// (POST /api/photo-albums, POST /api/photo-albums/checkout {cap}); this route
// is only the workspace.

import { addAuditLog } from "../lib/audit";
import { db, now } from "../db";
import { addCoupleMember, assignOrganiserCode, getCoupleForUser } from "../domain/couples";
import { deriveSlugBase, uniqueCoupleSlug } from "../domain/slug";
import { getUserById } from "../domain/users";
import { recordGrowthEvent } from "../domain/growth_events";
import { HttpError, json, readJson, requireVerifiedAuth, type Ctx, type Router } from "../lib/http";
import { parsePartnerName } from "./couples";

interface CameraEventBody {
  bride_name?: unknown;
  groom_name?: unknown;
  wedding_date?: unknown;
}

function parseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new HttpError(400, "wedding_date must be YYYY-MM-DD", { code: "invalid_date" });
  }
  return raw;
}

/** POST /api/camera/events — create the camera-only workspace for this user. */
async function handleCreateCameraEvent(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const user = getUserById(userId);
  if (user?.role === "vendor" || user?.user_type === "planner") {
    throw new HttpError(403, "Camera events are for couples", { code: "not_a_couple" });
  }
  // Someone who already plans with Weddly buys the film from their workspace,
  // at the couple price. The client sends them to /app/media.
  if (getCoupleForUser(userId)) {
    throw new HttpError(409, "This account already has a workspace", { code: "has_workspace" });
  }

  const body = await readJson<CameraEventBody>(ctx.req);
  const brideName = parsePartnerName(body.bride_name, "bride_name");
  const groomName = parsePartnerName(body.groom_name, "groom_name");
  const displayName = `${brideName} & ${groomName}`;
  const weddingDate = parseDate(body.wedding_date);

  const ts = now();
  const coupleId = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO couples
           (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
            wedding_date, wedding_date_kind, currency, status,
            created_at, updated_at, onboarded_at)
         VALUES (?, NULL, ?, ?, ?, ?, ?, 'EUR', 'active', ?, ?, ?)`,
      )
      .run(
        userId,
        displayName,
        brideName,
        groomName,
        weddingDate,
        weddingDate ? "exact" : "tbd",
        ts,
        ts,
        ts,
      );
    const id = Number(result.lastInsertRowid);
    const slug = uniqueCoupleSlug(deriveSlugBase(brideName, groomName, displayName), id);
    db.prepare("UPDATE couples SET slug = ? WHERE id = ?").run(slug, id);
    assignOrganiserCode(id, ts);
    db.prepare(
      "UPDATE users SET couple_id = ?, role = 'owner', camera_only = 1, updated_at = ? WHERE id = ?",
    ).run(id, ts, userId);
    addCoupleMember(id, userId, "owner");
    addAuditLog({
      actor_user_id: userId,
      couple_id: id,
      action: "couple.camera_event_created",
      target_kind: "couple",
      target_id: id,
      after: { display_name: displayName, wedding_date: weddingDate },
    });
    return id;
  })();

  recordGrowthEvent("couple.created", {
    user_id: userId,
    couple_id: coupleId,
    user_agent: ctx.req.headers.get("user-agent"),
  });
  return json({ couple_id: coupleId }, { status: 201 });
}

export function registerCameraEventRoutes(router: Router): void {
  router.post("/api/camera/events", handleCreateCameraEvent, true);
}
