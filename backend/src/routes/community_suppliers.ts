// "Drop your own" supplier submissions. Auto-published — no moderation queue.
// Admins can hide or hard-delete via /api/admin/suppliers/*.

import type { PriceBand, SubmitCommunitySupplierInput } from "@shared/community_suppliers";
import type { SupplierCategory } from "@shared/suppliers";
import {
  findActiveByWebsite,
  getCommunitySupplierById,
  insertCommunitySupplier,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "venue",
  "accommodation",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "stationery",
  "transport",
]);

interface SubmitBody {
  category?: unknown;
  name?: unknown;
  city?: unknown;
  address?: unknown;
  website?: unknown;
  contact_email?: unknown;
  contact_phone?: unknown;
  blurb?: unknown;
  price_band?: unknown;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseSubmitBody(body: SubmitBody): SubmitCommunitySupplierInput {
  const category = typeof body.category === "string" ? body.category : "";
  if (!VALID_CATEGORIES.has(category as SupplierCategory)) {
    throw new HttpError(400, "Invalid category");
  }

  const name = trimStr(body.name);
  if (!name) throw new HttpError(400, "name required");
  if (name.length > 120) throw new HttpError(400, "name too long (max 120)");

  const city = trimStr(body.city);
  if (!city) throw new HttpError(400, "city required");
  if (city.length > 80) throw new HttpError(400, "city too long (max 80)");

  let address: string | null = null;
  if (body.address != null && body.address !== "") {
    const a = trimStr(body.address);
    if (a) {
      if (a.length > 200) throw new HttpError(400, "address too long (max 200)");
      address = a;
    }
  }

  const blurb = trimStr(body.blurb);
  if (!blurb) throw new HttpError(400, "blurb required");
  if (blurb.length > 500) throw new HttpError(400, "blurb too long (max 500)");

  const website = trimStr(body.website);
  if (!website) throw new HttpError(400, "website required");
  if (website.length > 300) throw new HttpError(400, "website too long (max 300)");
  if (!website.startsWith("http://") && !website.startsWith("https://")) {
    throw new HttpError(400, "website must start with http:// or https://");
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(website);
  } catch {
    throw new HttpError(400, "website is not a valid URL");
  }
  // Defence in depth: reject anything that parses as a non-http(s) scheme even
  // after the prefix check (e.g. "https://x@javascript:..." craft attempts).
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new HttpError(400, "website protocol must be http or https");
  }
  if (!parsedUrl.hostname) throw new HttpError(400, "website hostname required");

  let contact_email: string | null = null;
  if (body.contact_email != null && body.contact_email !== "") {
    const e = trimStr(body.contact_email);
    if (e) {
      const at = e.indexOf("@");
      if (at < 1 || e.indexOf(".", at) === -1) {
        throw new HttpError(400, "contact_email is not a valid email");
      }
      if (e.length > 200) throw new HttpError(400, "contact_email too long (max 200)");
      contact_email = e;
    }
  }

  let contact_phone: string | null = null;
  if (body.contact_phone != null && body.contact_phone !== "") {
    const p = trimStr(body.contact_phone);
    if (p) {
      if (p.length > 30) throw new HttpError(400, "contact_phone too long (max 30)");
      contact_phone = p;
    }
  }

  const pbRaw = body.price_band;
  const pbNum = typeof pbRaw === "number" ? pbRaw : Number(pbRaw);
  if (!Number.isInteger(pbNum) || pbNum < 1 || pbNum > 5) {
    throw new HttpError(400, "price_band must be an integer 1..5");
  }
  const price_band = pbNum as PriceBand;

  return {
    category: category as SupplierCategory,
    name,
    city,
    address,
    website,
    contact_email,
    contact_phone,
    blurb,
    price_band,
  };
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  // Per-IP guard runs before validation to throttle floods of garbage. Per-user
  // limit runs after validation so a submitter fixing typos doesn't burn their
  // hourly quota on validation errors.
  rateLimit(ctx.clientIp, "supplier_submit", { capacity: 5, refillRate: 1 / 600 });

  const body = await readJson<SubmitBody>(ctx.req);
  const input = parseSubmitBody(body);

  rateLimit(`user:${userId}`, "supplier_submit_user", { capacity: 5, refillRate: 1 / 3600 });

  const dup = findActiveByWebsite(input.website);
  if (dup) {
    throw new HttpError(409, `Duplicate website — already in the directory: ${dup.name}`);
  }

  const id = insertCommunitySupplier(userId, input);
  const row = getCommunitySupplierById(id);
  if (!row) throw new HttpError(500, "Failed to read inserted supplier");

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "supplier.community.create",
    target_kind: "community_supplier",
    target_id: id,
    after: {
      id,
      name: input.name,
      category: input.category,
      price_band: input.price_band,
      website: input.website,
    },
  });

  // Fresh submission → no votes yet; overlay zeros so the frontend's
  // `DirectorySupplier` shape is satisfied without a second list fetch.
  return json(
    { supplier: { ...toDirectorySupplierBase(row), votes_score: 0, user_vote: 0 } },
    { status: 201 },
  );
}

export function registerCommunitySupplierRoutes(router: Router) {
  router.post("/api/suppliers/community", handleSubmit, true);
}
