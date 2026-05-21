// Public wedding website endpoint — couple-branded landing page served at
// `/w/:slug` on the frontend. No auth, no household code; this is the page
// the couple shares on social or prints on save-the-dates. The shape lives
// in shared/wedding_website.ts so the frontend renders against the same
// contract.
//
// What's exposed: display name, bride/groom, wedding date, ceremony kind,
// approximate venue location (with the couple's privacy radius applied),
// and the day-of schedule if authored. What's NOT exposed: guests,
// budget, supplier list, anything per-household. Rate-limited per IP to
// slow slug enumeration.

import type { CeremonyKind } from "@shared/types";
import type {
  PublicWeddingScheduleEntry,
  PublicWeddingWebsiteView,
} from "@shared/wedding_website";
import { db, now } from "../db";
import { type CoupleRow } from "../domain/couples";
import { listScheduleEvents } from "../domain/schedule";
import { normalizeSlugInput } from "../domain/slug";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

// 20-token burst then ~10/min sustained per IP. Slug enumeration is the
// concern (the only credential to a wedding site is the slug itself), so the
// sustained rate stays low. Legitimate guests open the link 1-3 times an
// hour; the burst absorbs simultaneous social-share fan-out off a single
// shared NAT without locking anyone out.
const WEDDING_BUCKET = { capacity: 20, refillRate: 1 / 6 };

const CEREMONY_KINDS: ReadonlySet<CeremonyKind> = new Set(["civil", "religious", "both"]);

function resolveCoupleBySlug(slug: string): CoupleRow {
  if (!slug || slug.length > 64) throw new HttpError(400, "Invalid couple identifier");
  const cleaned = normalizeSlugInput(slug);
  if (!cleaned) throw new HttpError(404, "Couple not found");
  const row = db.prepare("SELECT * FROM couples WHERE slug = ?").get(cleaned) as
    | CoupleRow
    | undefined;
  if (!row) throw new HttpError(404, "Couple not found");
  // Don't expose archived / paused / purged workspaces publicly — those
  // couples explicitly stepped out of "wedding-in-progress" state.
  if (row.status !== "active") throw new HttpError(404, "Couple not found");
  return row;
}

function handleGetWeddingWebsite(ctx: Ctx): Response {
  rateLimit(ctx.clientIp, "public:wedding", WEDDING_BUCKET);

  const slug = ctx.params.slug ?? "";
  const couple = resolveCoupleBySlug(slug);

  const schedule: PublicWeddingScheduleEntry[] = listScheduleEvents(couple.id).map((e) => ({
    id: e.id,
    label: e.label,
    starts_at_minutes: e.starts_at_minutes,
    duration_minutes: e.duration_minutes,
    location: e.location,
    notes: e.notes,
  }));

  const ceremonyKind: CeremonyKind | null =
    couple.ceremony_kind && CEREMONY_KINDS.has(couple.ceremony_kind as CeremonyKind)
      ? (couple.ceremony_kind as CeremonyKind)
      : null;

  const view: PublicWeddingWebsiteView = {
    couple_slug: couple.slug ?? "",
    couple_display_name: couple.display_name,
    bride_name: couple.bride_name || null,
    groom_name: couple.groom_name || null,
    wedding_date: couple.wedding_date,
    ceremony_kind: ceremonyKind,
    location_lat: couple.location_lat,
    location_lng: couple.location_lng,
    location_radius_km: couple.location_radius_km,
    schedule,
    fetched_at: now(),
  };
  return json({ wedding: view });
}

export function registerPublicWeddingRoutes(router: Router) {
  // Public — no auth flag. Path param `:slug` is the couple's slug.
  router.get("/api/public/wedding/:slug", handleGetWeddingWebsite);
}
