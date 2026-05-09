// Public RSVP endpoints. The invite code is the credential — no auth header.
// Heavy rate-limit per IP to slow code-guessing.

import { CONFIG } from "../config";
import { db, now } from "../db";
import { getCoupleById } from "../domain/couples";
import { sendKind } from "../domain/emails";
import {
  getGuestByInviteCode,
  isMealChoice,
  isRsvpStatus,
  toPublicRsvpView,
} from "../domain/guests";
import { getUserById } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// More forgiving than auth, but still slows enumeration.
const RSVP_BUCKET = { capacity: 30, refillRate: 1 / 5 };

function loadGuest(code: string) {
  if (!code || code.length > 32) throw new HttpError(400, "Invalid code");
  const row = getGuestByInviteCode(code.toUpperCase());
  if (!row) throw new HttpError(404, "Invite not found");
  return row;
}

function handleGet(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "rsvp:get", RSVP_BUCKET);
  const guest = loadGuest(ctx.params.code ?? "");
  const couple = getCoupleById(guest.couple_id);
  if (!couple) throw new HttpError(404, "Couple gone");
  return json({ rsvp: toPublicRsvpView(guest, couple.display_name, couple.wedding_date) });
}

interface RsvpBody {
  rsvp_status?: unknown;
  meal_choice?: unknown;
  dietary?: unknown;
  plus_one_name?: unknown;
  plus_one_meal?: unknown;
  accommodation_needed?: unknown;
  song_request?: unknown;
}

function strOrNull(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return trimmed.slice(0, max);
  return trimmed;
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "rsvp:submit", RSVP_BUCKET);
  const guest = loadGuest(ctx.params.code ?? "");

  const body = await readJson<RsvpBody>(ctx.req);
  const status = typeof body.rsvp_status === "string" ? body.rsvp_status : "";
  if (!isRsvpStatus(status)) throw new HttpError(400, "Invalid rsvp_status");

  const mealRaw = typeof body.meal_choice === "string" ? body.meal_choice : null;
  const meal = mealRaw && isMealChoice(mealRaw) ? mealRaw : null;
  const plusMealRaw = typeof body.plus_one_meal === "string" ? body.plus_one_meal : null;
  const plusMeal = plusMealRaw && isMealChoice(plusMealRaw) ? plusMealRaw : null;

  const ts = now();
  db.prepare(
    `UPDATE guests SET
        rsvp_status = ?, meal_choice = ?, dietary = ?, plus_one_name = ?, plus_one_meal = ?,
        accommodation_needed = ?, song_request = ?, rsvp_responded_at = ?, updated_at = ?
       WHERE id = ?`,
  ).run(
    status,
    meal,
    strOrNull(body.dietary, 500),
    strOrNull(body.plus_one_name, 200),
    plusMeal,
    body.accommodation_needed ? 1 : 0,
    strOrNull(body.song_request, 500),
    ts,
    ts,
    guest.id,
  );

  addAuditLog({
    actor_user_id: null,
    couple_id: guest.couple_id,
    action: "rsvp.submit",
    target_kind: "guest",
    target_id: guest.id,
    after: { status, meal, plus_one: Boolean(strOrNull(body.plus_one_name, 200)) },
  });

  const refreshed = getGuestByInviteCode(guest.invite_code);
  if (!refreshed) throw new HttpError(500, "Guest vanished");
  const couple = getCoupleById(refreshed.couple_id);
  if (!couple) throw new HttpError(404, "Couple gone");

  // Email side-effects. We only fire on real responses (not status='pending').
  if (status !== "pending") {
    notifyCoupleOnRsvp(couple.partner_a_id, couple.partner_b_id, {
      guestName: refreshed.full_name,
      rsvpStatus: status,
      coupleId: couple.id,
    });
    if (refreshed.email) {
      void sendKind(
        "rsvp_thanks_for_guest",
        {
          coupleDisplayName: couple.display_name,
          weddingDate: couple.wedding_date,
          rsvpStatus: status,
          rsvpPageUrl: `${CONFIG.frontendBaseUrl}/rsvp/${refreshed.invite_code}`,
        },
        {
          user: null,
          guest: { email: refreshed.email, full_name: refreshed.full_name },
          couple_id: couple.id,
        },
      );
    }
  }

  return json({ rsvp: toPublicRsvpView(refreshed, couple.display_name, couple.wedding_date) });
}

function notifyCoupleOnRsvp(
  partnerAId: number,
  partnerBId: number | null,
  payload: { guestName: string; rsvpStatus: "yes" | "no" | "maybe"; coupleId: number },
): void {
  const guestPageUrl = `${CONFIG.frontendBaseUrl}/guests`;
  for (const id of [partnerAId, partnerBId]) {
    if (!id) continue;
    const partner = getUserById(id);
    if (!partner) continue;
    void sendKind(
      "rsvp_received_for_couple",
      { guestName: payload.guestName, rsvpStatus: payload.rsvpStatus, guestPageUrl },
      {
        user: { id: partner.id, email: partner.email, full_name: partner.full_name },
        couple_id: payload.coupleId,
      },
    );
  }
}

export function registerRsvpRoutes(router: Router) {
  router.get("/api/rsvp/:code", handleGet);
  router.post("/api/rsvp/:code", handleSubmit);
}
