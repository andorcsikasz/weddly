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
  createVerificationToken,
  findActiveByWebsite,
  getCommunitySupplierById,
  insertCommunitySupplier,
  insertReport,
  toDirectorySupplierBase,
} from "../domain/community_suppliers";
import { recordEmailAttempt } from "../domain/emails/log";
import { isGoogleMapsUrl, resolveGoogleMapsUrl } from "../domain/maps_resolver";
import { enrichSupplier } from "../domain/supplier_enrich";
import { log } from "../lib/logger";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, requireAuth, type Router } from "../lib/http";
import { bilingualBody, sendEmail } from "../lib/mailer";
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

  // `contact_email` is REQUIRED now — we send a verification link there to
  // confirm the listing belongs to that business before it goes public. Pre-
  // verification listings stored in the DB without one are grandfathered;
  // only new submissions are gated.
  const e = trimStr(body.contact_email);
  if (!e) throw new HttpError(400, "contact_email required");
  const at = e.indexOf("@");
  if (at < 1 || e.indexOf(".", at) === -1) {
    throw new HttpError(400, "contact_email is not a valid email");
  }
  if (e.length > 200) throw new HttpError(400, "contact_email too long (max 200)");
  const contact_email: string = e;

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

// Dedupe step runs only when there's a website to dedupe by.
function shouldCheckDuplicate(website: string): boolean {
  return website.length > 0;
}

async function sendVerificationEmail(
  toEmail: string,
  supplierName: string,
  token: string,
): Promise<void> {
  const url = `${CONFIG.frontendBaseUrl}/verify-supplier/${encodeURIComponent(token)}`;
  const { html, text } = bilingualBody({
    hu: {
      greeting: "Szia!",
      body:
        `Valaki a Weddly esküvőtervezőn felvette a vállalkozásod (${supplierName}) ` +
        "a közösségi szolgáltató-katalógusba. Ha tényleg szeretnéd, hogy szerepeljen, " +
        "erősítsd meg az alábbi linkkel — addig nem látszik a páraknak. Ha nem te küldted " +
        "és nem szeretnéd, hogy itt szerepelj, hagyd figyelmen kívül ezt az e-mailt: link " +
        "kattintás nélkül a hirdetés nem kerül publikálásra.",
      cta: "Hirdetés megerősítése",
    },
    en: {
      greeting: "Hi there,",
      body:
        `Someone added your business (${supplierName}) to the community supplier ` +
        "directory on Weddly. If you'd like the listing to go live, confirm via the link " +
        "below — until then it's hidden from couples. If this wasn't you, just ignore " +
        "this email: the listing won't publish without your confirmation.",
      cta: "Confirm listing",
    },
    ctaUrl: url,
  });

  try {
    await sendEmail({
      to: toEmail,
      subject: "Weddly: erősítsd meg a hirdetésed / confirm your listing",
      html,
      text,
    });
    recordEmailAttempt({
      user_id: null,
      couple_id: null,
      kind: "community_supplier_verify",
      category: "transactional",
      to_email: toEmail,
      subject: "Weddly: erősítsd meg a hirdetésed / confirm your listing",
      status: "sent",
      payload: { supplier_name: supplierName },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordEmailAttempt({
      user_id: null,
      couple_id: null,
      kind: "community_supplier_verify",
      category: "transactional",
      to_email: toEmail,
      subject: "Weddly: erősítsd meg a hirdetésed / confirm your listing",
      status: "failed",
      error: msg,
      payload: { supplier_name: supplierName },
    });
    // Don't rethrow — submission succeeds even if mail send hiccups; admin can
    // re-send from the moderation queue later. The user already sees a "check
    // your inbox" copy and can ask support if nothing arrives.
  }
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
  void enrichSupplier(id).catch((e) =>
    log.warn("supplier.enrich.failed", { supplierId: id, error: String(e) }),
  );

  // Issue a fresh verification token + send the email. The supplier stays in
  // 'pending' state until the token is consumed; only then does it move to
  // 'awaiting_review' (admin still has to approve before it's public).
  const token = createVerificationToken(id);
  await sendVerificationEmail(input.contact_email, input.name, token.token);

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
  const userId = requireAuth(ctx);
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
