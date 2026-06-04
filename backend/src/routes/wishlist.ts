// Wishlist / gift-registry CRUD. Couple-scoped — every endpoint goes through
// requireAuth and getCoupleForUser. PATCH honours `If-Match: <updated_at>` for
// optimistic concurrency, matching schedule / budget / seating. Guest-side
// exposure + the interest toggle live in routes/public_wedding.ts (the
// confirmed-tier embed + the per-household tap), not here.

import type { UpsertWishlistItemInput, WishlistLinkPreview } from "@shared/wishlist";
import { addAuditLog } from "../lib/audit";
import { getCoupleForUser } from "../domain/couples";
import {
  deleteWishlistItem,
  getWishlistItemScoped,
  insertWishlistItem,
  listWishlistItems,
  parseUpsertCreate,
  parseUpsertPatch,
  toWishlistItem,
  updateWishlistItem,
} from "../domain/wishlist";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { fetchLinkPreview } from "../lib/link_preview";
import { rateLimit } from "../lib/rate_limit";

// Server-side link unfurls hit a couple-supplied URL, so cap how fast a single
// logged-in couple can trigger them (defence against using the preview as a
// scanning proxy, on top of the SSRF host guard in lib/link_preview.ts).
// ~20 burst then ~20/min sustained — the editor calls it a handful of times.
const LINK_PREVIEW_BUCKET = { capacity: 20, refillRate: 1 / 3 };

function handleList(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  return json({ items: listWishlistItems(couple.id) });
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");

  const body = await readJson<Partial<UpsertWishlistItemInput>>(ctx.req);
  const parsed = parseUpsertCreate(body);
  // Auto-resolve the preview image from the link when the client supplied a
  // URL but no explicit image (the common path — the editor may also pre-fetch
  // via /link-preview and pass image_url itself, which we respect).
  if (body.image_url === undefined && parsed.url) {
    parsed.image_url = (await fetchLinkPreview(parsed.url)).image_url;
  }
  const row = insertWishlistItem(couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "wishlist.item_create",
    target_kind: "wishlist_item",
    target_id: row.id,
    after: { title: parsed.title, kind: parsed.kind },
  });

  return json({ item: toWishlistItem(row) }, { status: 201 });
}

async function handleUpdate(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getWishlistItemScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Wishlist item not found");

  // Optimistic-concurrency guard: clients send the last-seen `updated_at` as
  // If-Match; a mid-air collision returns 409. Same shape as schedule.
  const ifMatchRaw = ctx.req.headers.get("if-match");
  if (ifMatchRaw) {
    const cleaned = ifMatchRaw.trim().replace(/^"(.*)"$/, "$1");
    if (cleaned && cleaned !== String(existing.updated_at)) {
      throw new HttpError(409, "Stale wishlist item — reload before saving", {
        code: "stale",
        current_updated_at: existing.updated_at,
      });
    }
  }

  const body = await readJson<Partial<UpsertWishlistItemInput>>(ctx.req);
  const parsed = parseUpsertPatch(body, existing);
  // Re-resolve the preview image whenever the URL changed and the client
  // didn't pass its own image_url: a new link fetches a fresh og:image, a
  // cleared link drops the image. URL unchanged -> the existing image is kept
  // (parseUpsertPatch already carried it over).
  if (body.image_url === undefined && parsed.url !== existing.url) {
    parsed.image_url = parsed.url ? (await fetchLinkPreview(parsed.url)).image_url : null;
  }
  const row = updateWishlistItem(id, couple.id, parsed);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "wishlist.item_update",
    target_kind: "wishlist_item",
    target_id: id,
    before: { title: existing.title, kind: existing.kind },
    after: { title: parsed.title, kind: parsed.kind },
  });

  return json({ item: toWishlistItem(row) });
}

function handleDelete(ctx: Ctx): Response {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");

  const existing = getWishlistItemScoped(id, couple.id);
  if (!existing) throw new HttpError(404, "Wishlist item not found");

  deleteWishlistItem(id, couple.id);

  addAuditLog({
    actor_user_id: userId,
    couple_id: couple.id,
    action: "wishlist.item_delete",
    target_kind: "wishlist_item",
    target_id: id,
    before: { title: existing.title, kind: existing.kind },
  });

  return json({ ok: true });
}

// Link unfurl for the editor: given ?url=, return the page's og:image + title
// so the form can show a thumbnail before the item is saved. Soft by contract
// (never errors on a dead/blocked URL — returns nulls), and rate-limited per
// couple. The SSRF host guard lives in lib/link_preview.ts.
async function handleLinkPreview(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  const couple = getCoupleForUser(userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  rateLimit(`wishlist:preview:${couple.id}`, "wishlist:preview", LINK_PREVIEW_BUCKET);

  const raw = ctx.url.searchParams.get("url")?.trim() ?? "";
  const empty: WishlistLinkPreview = { image_url: null, title: null };
  if (!raw) return json(empty);
  return json(await fetchLinkPreview(raw));
}

export function registerWishlistRoutes(router: Router) {
  router.get("/api/wishlist", handleList, true);
  router.get("/api/wishlist/link-preview", handleLinkPreview, true);
  router.post("/api/wishlist", handleCreate, true);
  router.patch("/api/wishlist/:id", handleUpdate, true);
  router.delete("/api/wishlist/:id", handleDelete, true);
}
