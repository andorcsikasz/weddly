// Public /vendors waitlist form (anon POST) + admin triage endpoints.
//
// Admin triage flow: every entry lands in `status='new'` (the "Beérkezett"
// inbox). One of three outcome buttons moves it out — accepted / under_review
// / rejected — each sending a template email via /decide. The admin can
// re-open a decided entry back to the inbox via /reopen.

import { PRIVACY_VERSION, VENDOR_BETA_NOTICE_VERSION } from "@shared/legal";
import type { SupplierCategory } from "@shared/suppliers";
import type { VendorWaitlistOutcome } from "@shared/vendor_waitlist";
import { CONFIG } from "../config";
import { recordConsent } from "../domain/consents";
import { sendKind } from "../domain/emails/send";
import { requireAdmin } from "../domain/users";
import {
  decideVendorWaitlist,
  getVendorWaitlistById,
  insertVendorWaitlist,
  listVendorWaitlist,
  reopenVendorWaitlist,
  toVendorWaitlistAdminView,
  toVendorWaitlistEntry,
} from "../domain/vendor_waitlist";
import { sendDecisionEmail } from "../domain/vendor_waitlist_emails";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { log } from "../lib/logger";
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
  sound_tech: "Hangtechnika",
  photo_video: "Fotó & videó",
  entertainment: "Animáció & program",
  attire: "Ruha",
  hair_makeup: "Smink & haj",
  nails: "Köröm",
  stationery: "Papír & nyomtatvány",
  transport: "Transzfer",
  rings: "Karikagyűrűk",
  tent_pavilion: "Sátor & pavilon",
  wedding_website: "Esküvői honlap",
};

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

const VALID_OUTCOMES: ReadonlySet<VendorWaitlistOutcome> = new Set([
  "under_review",
  "accepted",
  "rejected",
]);

interface SubmitBody {
  business_name?: unknown;
  email?: unknown;
  category?: unknown;
  location?: unknown;
  website?: unknown;
  message?: unknown;
  portfolio_links?: unknown;
  instagram_handle?: unknown;
  /** GDPR-style consent: privacy policy + the free-beta / future-paid
   *  disclosure. Both required — the public form blocks submit until the
   *  checkbox is ticked, and the server records both as separate ledger
   *  rows so we can demonstrate the vendor saw the monetisation notice. */
  privacy_version?: unknown;
  vendor_beta_notice_version?: unknown;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Normalise one portfolio URL the same way the `website` field does: accept
 *  bare hosts (auto-prefix https://), reject non-URL strings, enforce http(s).
 *  Returns the canonical URL string (with scheme) so the admin clicks straight
 *  through. */
function normalisePortfolioUrl(raw: string): string {
  if (raw.length > 500) {
    throw new HttpError(400, "portfolio link too long (max 500)");
  }
  const candidate =
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new HttpError(400, "portfolio link is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "portfolio link protocol must be http or https");
  }
  if (!parsed.hostname) throw new HttpError(400, "portfolio link hostname required");
  return candidate;
}

/** Instagram handles: alphanumeric + dot + underscore, 1-30 chars (IG's own
 *  limit). Accept either "@handle" or bare "handle" — strip leading '@'. */
const IG_HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
function normaliseInstagramHandle(raw: string): string {
  const stripped = raw.replace(/^@+/, "");
  if (!IG_HANDLE_RE.test(stripped)) {
    throw new HttpError(400, "instagram_handle must be 1-30 chars of letters, digits, '.' or '_'");
  }
  return stripped;
}

async function handleSubmit(ctx: Ctx): Promise<Response> {
  // Anon endpoint — IP-bucket only. 5 submissions per hour per IP keeps
  // bots away without locking out a vendor who fat-fingers the form.
  rateLimit(ctx.clientIp, "vendor_waitlist", { capacity: 5, refillRate: 1 / 720 });

  const body = await readJson<SubmitBody>(ctx.req);

  if (body.privacy_version !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (body.vendor_beta_notice_version !== VENDOR_BETA_NOTICE_VERSION) {
    throw new HttpError(400, "Beta notice version is out of date — please refresh the page");
  }

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

  // Optional. Accept a bare hostname ("example.com") by auto-prefixing
  // "https://" so the field is forgiving — vendors paste from a browser bar.
  // We still parse it through `new URL` to reject "asdf" and similar garbage.
  let website: string | null = null;
  if (body.website != null && body.website !== "") {
    const raw = trimStr(body.website);
    if (raw) {
      if (raw.length > 300) throw new HttpError(400, "website too long (max 300)");
      const candidate =
        raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new HttpError(400, "website is not a valid URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new HttpError(400, "website protocol must be http or https");
      }
      if (!parsed.hostname) throw new HttpError(400, "website hostname required");
      website = candidate;
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

  // Portfolio links — optional list of URLs. Cap at 6 so a misbehaving
  // client can't dump a thousand entries onto us. Same auto-prefix +
  // URL-parse forgiveness as the `website` field.
  const portfolioLinks: string[] = [];
  if (Array.isArray(body.portfolio_links)) {
    if (body.portfolio_links.length > 6) {
      throw new HttpError(400, "portfolio_links too many (max 6)");
    }
    for (const raw of body.portfolio_links) {
      const link = trimStr(raw);
      if (!link) continue;
      portfolioLinks.push(normalisePortfolioUrl(link));
    }
  } else if (body.portfolio_links != null) {
    throw new HttpError(400, "portfolio_links must be an array");
  }

  // Instagram handle — optional. Strip leading '@' so the admin display
  // logic doesn't have to handle both forms.
  let instagramHandle: string | null = null;
  if (body.instagram_handle != null && body.instagram_handle !== "") {
    const raw = trimStr(body.instagram_handle);
    if (raw) instagramHandle = normaliseInstagramHandle(raw);
  }

  const row = insertVendorWaitlist({
    business_name,
    email,
    category,
    location,
    website,
    message,
    portfolio_links: portfolioLinks,
    instagram_handle: instagramHandle,
  });

  // One ledger row per accepted document. The IP / UA matches across both
  // because they came in the same submit click — keeps the audit trail
  // honest about which moment the vendor consented.
  const ip = ctx.clientIp;
  const userAgent = ctx.req.headers.get("user-agent");
  const subjectRef = String(row.id);
  recordConsent({
    subjectUserId: null,
    subjectKind: "vendor_waitlist",
    subjectRef,
    document: "privacy",
    version: PRIVACY_VERSION,
    ip,
    userAgent,
  });
  recordConsent({
    subjectUserId: null,
    subjectKind: "vendor_waitlist",
    subjectRef,
    document: "vendor_beta_notice",
    version: VENDOR_BETA_NOTICE_VERSION,
    ip,
    userAgent,
  });

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
  return json({ entries: rows.map(toVendorWaitlistAdminView) });
}

interface DecideBody {
  outcome?: unknown;
  subject?: unknown;
  body?: unknown;
  notes?: unknown;
}

async function handleAdminDecide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  const existing = getVendorWaitlistById(id);
  if (!existing) throw new HttpError(404, "Not found");

  const body = await readJson<DecideBody>(ctx.req);

  const outcome = trimStr(body.outcome);
  if (!VALID_OUTCOMES.has(outcome as VendorWaitlistOutcome)) {
    throw new HttpError(400, "outcome must be 'under_review', 'accepted', or 'rejected'");
  }

  // Subject + body are required (the admin can edit but can't blank them).
  // Length caps mirror the field caps on the public form so we don't get
  // hit with a 1MB blob via the admin path.
  const subject = trimStr(body.subject);
  if (!subject) throw new HttpError(400, "subject required");
  if (subject.length > 200) throw new HttpError(400, "subject too long (max 200)");

  const emailBody = typeof body.body === "string" ? body.body : "";
  const emailBodyTrimmed = emailBody.trim();
  if (!emailBodyTrimmed) throw new HttpError(400, "body required");
  if (emailBody.length > 5000) throw new HttpError(400, "body too long (max 5000)");

  // Notes are free-form and may legitimately be empty.
  const notes = typeof body.notes === "string" ? body.notes : "";
  if (notes.length > 2000) throw new HttpError(400, "notes too long (max 2000)");

  // Send first; if delivery fails we still record the attempt by stamping the
  // row, but propagate the error to the admin so they can re-try. Skipping
  // the send (no RESEND_API_KEY in dev/test) is a no-op and never throws.
  let sendError: string | null = null;
  try {
    await sendDecisionEmail({
      to: existing.email,
      subject,
      body: emailBody,
    });
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
    log.error("vendor_waitlist.decide_send_failed", {
      id,
      to: existing.email,
      outcome,
      reason: sendError,
    });
  }

  const updated = decideVendorWaitlist(
    id,
    {
      outcome: outcome as VendorWaitlistOutcome,
      notes,
      sent_subject: subject,
      sent_body: emailBody,
    },
    admin.id,
  );

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: `vendor_waitlist.${outcome}`,
    target_kind: "vendor_waitlist",
    target_id: id,
    before: { status: existing.status },
    after: { status: outcome, subject, has_notes: notes.length > 0 },
  });

  if (sendError) {
    // Row was updated — the admin's notes + decision are persisted — but the
    // send itself failed. Surface a 502 so the toast tells them to retry.
    throw new HttpError(502, `Email send failed: ${sendError}`);
  }

  return json({ entry: updated ? toVendorWaitlistAdminView(updated) : null });
}

async function handleAdminReopen(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = Number(ctx.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  const existing = getVendorWaitlistById(id);
  if (!existing) throw new HttpError(404, "Not found");

  const updated = reopenVendorWaitlist(id, admin.id);
  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "vendor_waitlist.reopen",
    target_kind: "vendor_waitlist",
    target_id: id,
    before: { status: existing.status },
    after: { status: "new" },
  });
  return json({ entry: updated ? toVendorWaitlistAdminView(updated) : null });
}

export function registerVendorWaitlistRoutes(router: Router) {
  router.post("/api/vendors/waitlist", handleSubmit);
  router.get("/api/admin/vendor-waitlist", handleAdminList, true);
  router.post("/api/admin/vendor-waitlist/:id/decide", handleAdminDecide, true);
  router.post("/api/admin/vendor-waitlist/:id/reopen", handleAdminReopen, true);
}
