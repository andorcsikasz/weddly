// "Drop your own" supplier submissions. Gated by TWO sequential checks
// before a row goes live: (1) email-ownership verification and (2) admin
// approval. Admins can also hide or hard-delete via /api/admin/suppliers/*.

import type {
  CommunitySupplierReportReason,
  PriceBand,
  SubmitCommunitySupplierInput,
} from "@shared/community_suppliers";
import type { SupplierCategory } from "@shared/suppliers";
import { CONFIG } from "../config";
import {
  consumeVerificationToken,
  findActiveByContactEmail,
  findActiveByWebsite,
  getCommunitySupplierById,
  insertCommunitySupplier,
  insertReport,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { sendKind } from "../domain/emails/send";
import { isGoogleMapsUrl, resolveGoogleMapsUrl } from "../domain/maps_resolver";
import { enrichSupplier } from "../domain/supplier_enrich";
import { fetchAndStoreListingHero } from "../domain/listing_image_backfill";
import { log } from "../lib/logger";
import { addAuditLog } from "../lib/audit";
import { getUserById } from "../domain/users";
import {
  type Ctx,
  HttpError,
  json,
  readJson,
  requireAuth,
  requireVerifiedAuth,
  type Router,
} from "../lib/http";
import { rateLimit } from "../lib/rate_limit";

const VALID_REPORT_REASONS: ReadonlySet<CommunitySupplierReportReason> = new Set([
  "spam",
  "fake",
  "offensive",
  "wrong_info",
  "other",
]);

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "venue",
  "accommodation",
  "tent_pavilion",
  "catering",
  "cake_dessert",
  "bar_drinks",
  "decor_floral",
  "lighting",
  "music_dj",
  "sound_tech",
  "photo_video",
  "entertainment",
  "attire",
  "hair_makeup",
  "nails",
  "rings",
  "stationery",
  "wedding_website",
  "transport",
]);

interface SubmitBody {
  category?: unknown;
  /** "self" when the vendor submits their own business; "user" (default) when
   *  a couple recommends a supplier they like. Drives the trust pill on the
   *  public card. Accepts either string for forward-compat with potential
   *  future values. */
  submitter_type?: unknown;
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
  // Only name + category + price_band are truly required — they're what makes
  // a card displayable and rankable. Everything else is optional; the form
  // accepts skeletal entries that the submitter can complete later (or that
  // an admin can flesh out).
  const category = typeof body.category === "string" ? body.category : "";
  if (!VALID_CATEGORIES.has(category as SupplierCategory)) {
    throw new HttpError(400, "Invalid category");
  }

  const name = trimStr(body.name);
  if (!name) throw new HttpError(400, "name required");
  if (name.length > 120) throw new HttpError(400, "name too long (max 120)");

  const city = trimStr(body.city);
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
  if (blurb.length > 500) throw new HttpError(400, "blurb too long (max 500)");

  // Website is optional now. When present, still validate hard so we don't
  // store malformed or javascript: URLs.
  const website = trimStr(body.website);
  if (website) {
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
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new HttpError(400, "website protocol must be http or https");
    }
    if (!parsedUrl.hostname) throw new HttpError(400, "website hostname required");
  }

  // `contact_email` is OPTIONAL. When the submitter provides one we send a
  // verification link there to confirm the listing belongs to that business;
  // without it the submission skips straight to the admin moderation queue
  // (the admin gate is the last safety net either way). Format is still
  // validated when present so we don't queue bogus addresses for sending.
  let contact_email: string | null = null;
  const e = trimStr(body.contact_email);
  if (e) {
    const at = e.indexOf("@");
    if (at < 1 || e.indexOf(".", at) === -1) {
      throw new HttpError(400, "contact_email is not a valid email");
    }
    if (e.length > 200) throw new HttpError(400, "contact_email too long (max 200)");
    contact_email = e;
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

  // Default to 'user' for back-compat with legacy clients that don't send it.
  // Anything other than the literal "self" / "user" is rejected so a typo
  // doesn't silently become 'user' (which would mislabel a vendor submission).
  let submitter_type: "user" | "self" = "user";
  if (body.submitter_type != null) {
    if (body.submitter_type !== "user" && body.submitter_type !== "self") {
      throw new HttpError(400, "submitter_type must be 'user' or 'self'");
    }
    submitter_type = body.submitter_type;
  }

  return {
    category: category as SupplierCategory,
    submitter_type,
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

// Dedupe step runs only when there's a website to dedupe by.
function shouldCheckDuplicate(website: string): boolean {
  return website.length > 0;
}

// The verify-mail kickoff now lives in routes/admin_suppliers.ts:handleSendVerify.
// Submission alone no longer fires the cold mail — admin must release it
// explicitly so a logged-in couple can't blast verifications at any business
// by submitting them to the catalogue.

async function handleSubmit(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  // Per-IP guard runs before validation to throttle floods of garbage. Per-user
  // limit runs after validation so a submitter fixing typos doesn't burn their
  // hourly quota on validation errors.
  rateLimit(ctx.clientIp, "supplier_submit", { capacity: 5, refillRate: 1 / 600 });

  const body = await readJson<SubmitBody>(ctx.req);
  const input = parseSubmitBody(body);

  rateLimit(`user:${userId}`, "supplier_submit_user", { capacity: 5, refillRate: 1 / 3600 });

  // Dedupe by contact email first: a vendor who already submitted (and is
  // sitting in the verify / admin-review queue) shouldn't be able to pile up
  // duplicate rows by re-submitting. We surface a friendly "already registered,
  // you're on the waitlist" message rather than silently inserting again. The
  // `code` lets the client show a localised, non-error-flavoured toast.
  if (input.contact_email) {
    const emailDup = findActiveByContactEmail(input.contact_email);
    if (emailDup) {
      throw new HttpError(409, "Already registered with this email — on the waitlist", {
        code: "duplicate_email",
      });
    }
  }

  if (shouldCheckDuplicate(input.website)) {
    const dup = findActiveByWebsite(input.website);
    if (dup) {
      throw new HttpError(409, `Duplicate website — already in the directory: ${dup.name}`);
    }
  }

  const id = insertCommunitySupplier(userId, input);
  const row = getCommunitySupplierById(id);
  if (!row) throw new HttpError(500, "Failed to read inserted supplier");

  // Fire-and-forget enrichment: backfill blurb / phone / email / address from
  // the website + maps URL while the submitter goes through email verify.
  // The supplier is still 'pending' and invisible, so a network blip here
  // is harmless — admin can hit "Re-enrich" later from the moderation page.
  //
  // Skip in tests: hostnames like `crystal-hall.test` don't resolve but the
  // pending background fetch still pins down the event loop for 5s per row,
  // which blew past the test runner's per-test timeout budget once we had a
  // few dozen supplier-creating tests in a single run.
  if (process.env.NODE_ENV !== "test") {
    void enrichSupplier(id).catch((e) =>
      log.warn("supplier.enrich.failed", { supplierId: id, error: String(e) }),
    );
    // Alongside the text enrichment, try to pull a hero image from the venue's
    // own website (og:image). The mirrored `c<id>` listing row already exists
    // (insertCommunitySupplier synced it); the hero column is independent of the
    // enrich re-sync, so the two background jobs don't clobber each other.
    if (row.website) {
      void fetchAndStoreListingHero(`c${id}`, row.website).catch((e) =>
        log.warn("supplier.hero_fetch.failed", { supplierId: id, error: String(e) }),
      );
    }
  }

  // Submission lands silently in 'pending' for admin triage — no outbound
  // mail to the vendor yet. Previously the verify mail fired on submit,
  // which meant any logged-in couple could blast verification mail at any
  // business's contact_email by submitting them to the catalogue. Admin
  // must explicitly click "Send verify" in /app/admin/suppliers to release
  // the mail (handleSendVerify below).
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
      status: "pending",
    },
  });

  // Pending submissions aren't shown publicly, so the response shape is
  // primarily informational — clients show a "check your inbox" toast and
  // don't optimistically inject the supplier into the visible list.
  return json(
    {
      pending: true,
      supplier: { ...toDirectorySupplierBase(row), votes_score: 0, user_vote: 0 },
    },
    { status: 201 },
  );
}

interface VerifyParams {
  token?: string;
}

async function handleVerify(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "supplier_verify", { capacity: 10, refillRate: 1 / 60 });
  const params = ctx.params as VerifyParams;
  const raw = params.token ?? "";
  if (!raw || raw.length < 16 || raw.length > 128) {
    throw new HttpError(400, "Invalid verification token");
  }
  const result = consumeVerificationToken(raw);
  if (!result.ok) {
    if (result.reason === "not_found") throw new HttpError(404, "Token not found");
    if (result.reason === "expired") throw new HttpError(410, "Verification link expired");
    if (result.reason === "already_consumed") {
      // Idempotent re-click — tell the client the listing is live without
      // raising a hard error. UX: success page with a "Already verified" note.
      return json({ ok: true, already_consumed: true });
    }
    if (result.reason === "supplier_missing") {
      throw new HttpError(410, "Listing no longer exists");
    }
  } else {
    addAuditLog({
      actor_user_id: null,
      couple_id: null,
      action: "supplier.community.verified",
      target_kind: "community_supplier",
      target_id: result.supplierId,
      after: { activated: !result.alreadyActive },
    });
  }
  return json({ ok: true, already_consumed: false });
}

interface ResolveBody {
  url?: unknown;
}

async function handleResolveMapsUrl(ctx: Ctx): Promise<Response> {
  const userId = requireAuth(ctx);
  // Strict per-user bucket — Nominatim's TOS asks for ≤ 1 req/sec, and even
  // typing speed shouldn't produce more than one resolve per ~2 seconds.
  rateLimit(`user:${userId}`, "maps_resolve", { capacity: 5, refillRate: 1 / 2 });

  const body = await readJson<ResolveBody>(ctx.req);
  const raw = typeof body.url === "string" ? body.url.trim() : "";
  if (!raw) throw new HttpError(400, "url required");
  if (raw.length > 600) throw new HttpError(400, "url too long");
  if (!isGoogleMapsUrl(raw)) {
    throw new HttpError(400, "not a recognised Google Maps URL");
  }

  const resolved = await resolveGoogleMapsUrl(raw);
  return json({ place: resolved });
}

interface ReportBody {
  reason?: unknown;
  note?: unknown;
}

async function handleReport(ctx: Ctx): Promise<Response> {
  const userId = requireVerifiedAuth(ctx, getUserById);
  const rawId = ctx.params.id;
  const supplierId = Number(rawId);
  if (!Number.isFinite(supplierId) || supplierId <= 0) {
    throw new HttpError(400, "Invalid supplier id");
  }

  // Throttle both per-IP and per-user so a hijacked browser can't grief the
  // queue and so a single user can't blast reports across many suppliers.
  rateLimit(ctx.clientIp, "supplier_report", { capacity: 5, refillRate: 1 / 600 });
  rateLimit(`user:${userId}`, "supplier_report_user", { capacity: 10, refillRate: 1 / 600 });

  const supplier = getCommunitySupplierById(supplierId);
  if (!supplier) throw new HttpError(404, "Supplier not found");

  const body = await readJson<ReportBody>(ctx.req).catch(() => ({}) as ReportBody);
  const reasonRaw = typeof body.reason === "string" ? body.reason : "";
  if (!VALID_REPORT_REASONS.has(reasonRaw as CommunitySupplierReportReason)) {
    throw new HttpError(400, "Invalid reason");
  }
  const reason = reasonRaw as CommunitySupplierReportReason;

  let note: string | null = null;
  if (body.note != null && body.note !== "") {
    if (typeof body.note !== "string") throw new HttpError(400, "note must be a string");
    const t = body.note.trim();
    if (t) {
      if (t.length > 500) throw new HttpError(400, "note too long (max 500)");
      note = t;
    }
  }

  if (supplier.submitter_user_id === userId) {
    throw new HttpError(400, "You can't report your own submission — delete it instead");
  }

  const result = insertReport(supplierId, userId, reason, note);

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: result.inserted ? "supplier.community.report" : "supplier.community.report_duplicate",
    target_kind: "community_supplier",
    target_id: supplierId,
    after: {
      reason,
      report_count: result.reportCount,
      auto_hidden: result.autoHidden,
    },
  });

  if (result.autoHidden) {
    addAuditLog({
      actor_user_id: null,
      couple_id: null,
      action: "supplier.community.auto_hide",
      target_kind: "community_supplier",
      target_id: supplierId,
      after: { reason: `auto-hidden: ${result.reportCount} user reports` },
    });
  }

  // Heads-up to the listing contact on the FIRST user report — gives them a
  // chance to fix wrong info before the listing accumulates more reports
  // and the auto-hide threshold kicks in. Cooldown is "first report only"
  // (cheap, no schema needed); subsequent reports stay silent so a bad-
  // faith reporter can't spam the vendor's inbox.
  if (result.inserted && result.reportCount === 1 && supplier.contact_email) {
    void sendKind(
      "community_supplier_reported",
      { supplierName: supplier.name, reason },
      { user: null, guest: { email: supplier.contact_email, full_name: supplier.name } },
    );
  }

  return json({
    ok: true,
    duplicate: !result.inserted,
    auto_hidden: result.autoHidden,
    report_count: result.reportCount,
  });
}

export function registerCommunitySupplierRoutes(router: Router) {
  router.post("/api/suppliers/community", handleSubmit, true);
  router.post("/api/suppliers/community/:id/report", handleReport, true);
  router.post("/api/suppliers/resolve-maps-url", handleResolveMapsUrl, true);
  // Public — the link comes from an email and the recipient is the listing's
  // contact_email, who may not be a Weddly user. Token in path acts as bearer.
  router.post("/api/suppliers/community/verify/:token", handleVerify, false);
}
