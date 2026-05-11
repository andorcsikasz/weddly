// Public /vendors waitlist form (anon POST) + admin triage endpoints.

import type { SupplierCategory } from "@shared/suppliers";
import { CONFIG } from "../config";
import { sendKind } from "../domain/emails/send";
import { requireAdmin } from "../domain/users";
import {
  getVendorWaitlistById,
  insertVendorWaitlist,
  listVendorWaitlist,
  setVendorWaitlistStatus,
  toVendorWaitlistEntry,
  type VendorWaitlistStatus,
} from "../domain/vendor_waitlist";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const CATEGORY_LABEL_HU: Record<SupplierCategory, string> = {
  venue: "Esküvői helyszín",
  accommodation: "Szállás",
  catering: "Catering",
  cake_dessert: "Torta & desszert",
  bar_drinks: "Bár & italok",
  decor_floral: "Dekoráció & virág",
  lighting: "Világítás",
  music_dj: "Zene & DJ",
  photo_video: "Fotó & videó",
  entertainment: "Animáció & program",
  attire: "Ruha",
  hair_makeup: "Smink & haj",
  stationery: "Papír & nyomtatvány",
  transport: "Transzfer",
};

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
  business_name?: unknown;
  email?: unknown;
  category?: unknown;
  location?: unknown;
  message?: unknown;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  // Anon endpoint — IP-bucket only. 5 submissions per hour per IP keeps
  // bots away without locking out a vendor who fat-fingers the form.
  rateLimit(ctx.clientIp, "vendor_waitlist", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<SubmitBody>(ctx.req);

  const business_name = trimStr(body.business_name);
  if (!business_name) throw new HttpError(400, "business_name required");
  if (business_name.length > 120) throw new HttpError(400, "business_name too long (max 120)");

  const email = trimStr(body.email).toLowerCase();
  if (!email) throw new HttpError(400, "email required");
  if (email.length > 200) throw new HttpError(400, "email too long (max 200)");
  const at = email.indexOf("@");
  if (at < 1 || email.indexOf(".", at) === -1) {
    throw new HttpError(400, "email is not valid");
  }

  const category = trimStr(body.category);
  if (!VALID_CATEGORIES.has(category as SupplierCategory)) {
    throw new HttpError(400, "Invalid category");
  }

  let location: string | null = null;
  if (body.location != null && body.location !== "") {
    const loc = trimStr(body.location);
    if (loc) {
      if (loc.length > 500) throw new HttpError(400, "location too long (max 500)");
      location = loc;
    }
  }

  let message: string | null = null;
  if (body.message != null && body.message !== "") {
    const m = trimStr(body.message);
    if (m) {
      if (m.length > 1000) throw new HttpError(400, "message too long (max 1000)");
      message = m;
    }
  }

  const row = insertVendorWaitlist({ business_name, email, category, location, message });
  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "vendor_waitlist.create",
    target_kind: "vendor_waitlist",
    target_id: row.id,
    after: { business_name, email, category },
  });

  // Fire-and-forget confirmation to the vendor's email. Failures land in
  // email_log but never propagate — the form submission still succeeds.
  void sendKind(
    "vendor_waitlist_received",
    {
      businessName: business_name,
      categoryLabel: CATEGORY_LABEL_HU[category as SupplierCategory] ?? category,
      location,
      landingUrl: CONFIG.frontendBaseUrl,
    },
    { user: null, guest: { email, full_name: business_name } },
  );

  return json({ entry: toVendorWaitlistEntry(row) }, { status: 201 });
}

async function handleAdminList(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);
  const rows = listVendorWaitlist();
  return json({ entries: rows.map(toVendorWaitlistEntry) });
}

interface StatusBody {
  status?: unknown;
}

async function handleAdminStatus(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  const existing = getVendorWaitlistById(id);
  if (!existing) throw new HttpError(404, "Not found");

  const body = await readJson<StatusBody>(ctx.req);
  const status = trimStr(body.status);
  if (status !== "new" && status !== "contacted" && status !== "dismissed") {
    throw new HttpError(400, "status must be 'new', 'contacted', or 'dismissed'");
  }

  const updated = setVendorWaitlistStatus(id, status as VendorWaitlistStatus, admin.id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: `vendor_waitlist.${status}`,
    target_kind: "vendor_waitlist",
    target_id: id,
    before: { status: existing.status },
    after: { status },
  });
  return json({ entry: updated ? toVendorWaitlistEntry(updated) : null });
}

export function registerVendorWaitlistRoutes(router: Router) {
  router.post("/api/vendors/waitlist", handleSubmit);
  router.get("/api/admin/vendor-waitlist", handleAdminList, true);
  router.patch("/api/admin/vendor-waitlist/:id/status", handleAdminStatus, true);
}
