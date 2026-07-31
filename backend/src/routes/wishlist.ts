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
  listInterestStatsForItems,
  listWishlistItems,
  parseUpsertCreate,
  parseUpsertPatch,
  toWishlistItem,
  updateWishlistItem,
} from "../domain/wishlist";
import { localizeWishlistImage } from "../domain/wishlist_image";
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
  const source =
    body.image_url === undefined
      ? parsed.url
        ? (await fetchLinkPreview(parsed.url)).image_url
        : null
      : parsed.image_url;
  // Whatever it came from, what we STORE is our own copy — a shop's CDN is not
  // in the CSP img-src allow-list and would render as a broken tile.
  parsed.image_url = await localizeWishlistImage(couple.id, source);
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
  // Resolve the preview image server-side unless the client passed its own.
  //  - link cleared        -> drop the image
  //  - link changed        -> fetch a fresh og:image
  //  - link set but no image yet (changed OR carried-over without a thumbnail)
  //    -> fetch, so re-saving an item is a recovery path for a link whose
  //       preview failed the first time (e.g. a site that was briefly down).
  //  - link unchanged + image already present -> keep it (no refetch).
  let source: string | null = parsed.image_url;
  if (body.image_url === undefined) {
    if (!parsed.url) {
      source = null;
    } else if (parsed.url !== existing.url || !existing.image_url) {
      source = (await fetchLinkPreview(parsed.url)).image_url;
    } else {
      source = existing.image_url;
    }
  }
  // Mirror locally (a no-op for a value that is already ours), so an ordinary
  // re-save is also what heals a legacy row still pointing at the shop's CDN.
  parsed.image_url = await localizeWishlistImage(couple.id, source);
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

  // Carry the coordination aggregates so a PATCH returns the same shape GET
  // does — editing an item must not blank out its progress bar in the client.
  const stats = listInterestStatsForItems([id]).get(id);
  return json({ item: toWishlistItem(row, stats?.count ?? 0, stats?.pledged ?? 0) });
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
  const preview = await fetchLinkPreview(raw);
  // Mirror before answering: the editor renders this in an <img>, and a remote
  // src is blocked by the CSP exactly like the saved card was. Deterministic
  // key, so saving the item right after costs no extra storage.
  const image_url = await localizeWishlistImage(couple.id, preview.image_url);
  const mirrored: WishlistLinkPreview = { ...preview, image_url };
  return json(mirrored);
}

export function registerWishlistRoutes(router: Router) {
  router.get("/api/wishlist", handleList, true);
  router.get("/api/wishlist/link-preview", handleLinkPreview, true);
  router.post("/api/wishlist", handleCreate, true);
  router.patch("/api/wishlist/:id", handleUpdate, true);
  router.delete("/api/wishlist/:id", handleDelete, true);
}
