// Public /vendors waitlist form (anon POST) + admin triage endpoints.
//
// Admin triage flow: every entry lands in `status='new'` (the "Beérkezett"
// inbox). One of three outcome buttons moves it out — accepted / under_review
// / rejected — each sending a template email via /decide. The admin can
// re-open a decided entry back to the inbox via /reopen.

import { storage } from "../lib/storage";
import { PRIVACY_VERSION, VENDOR_BETA_NOTICE_VERSION } from "@shared/legal";
import type { SupplierCategory } from "@shared/suppliers";
import type { VendorWaitlistOutcome } from "@shared/vendor_waitlist";
import { CONFIG } from "../config";
import { db } from "../db";
import { lookupCoupleByRefCode } from "../domain/referrals";
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
import { sendDecisionEmail, sendVendorActivationEmail } from "../domain/vendor_waitlist_emails";
import { createOnboardingToken } from "../domain/vendor_onboarding";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";
import { log } from "../lib/logger";
import { rateLimit } from "../lib/rate_limit";

const MAX_PRICE_LIST_BYTES = 10 * 1024 * 1024; // 10 MB
const PRICE_LIST_EXTS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const CATEGORY_LABEL_HU: Record<SupplierCategory, string> = {
  wedding_planner: "Esküvőszervező",
  venue: "Esküvői helyszín",
  accommodation: "Szállás",
  catering: "Catering",
  cake_dessert: "Torta & desszert",
  bar_drinks: "Bár & italok",
  pizza: "Pizza",
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
  invitation_graphics: "Meghívó / esküvői grafika",
  transport: "Transzfer",
  rings: "Karikagyűrűk",
  tent_pavilion: "Sátor & pavilon",
  wedding_website: "Esküvői honlap",
  other: "Egyéb",
};

const VALID_CATEGORIES: ReadonlySet<SupplierCategory> = new Set([
  "wedding_planner",
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

  const form = await ctx.req.formData().catch(() => {
    throw new HttpError(400, "Multipart form-data required");
  });

  if (trimStr(form.get("privacy_version")) !== PRIVACY_VERSION) {
    throw new HttpError(400, "Privacy policy version is out of date — please refresh the page");
  }
  if (trimStr(form.get("vendor_beta_notice_version")) !== VENDOR_BETA_NOTICE_VERSION) {
    throw new HttpError(400, "Beta notice version is out of date — please refresh the page");
  }

  const business_name = trimStr(form.get("business_name"));
  if (!business_name) throw new HttpError(400, "business_name required");
  if (business_name.length > 120) throw new HttpError(400, "business_name too long (max 120)");

  const email = trimStr(form.get("email")).toLowerCase();
  if (!email) throw new HttpError(400, "email required");
  if (email.length > 200) throw new HttpError(400, "email too long (max 200)");
  const at = email.indexOf("@");
  if (at < 1 || email.indexOf(".", at) === -1) {
    throw new HttpError(400, "email is not valid");
  }

  const category = trimStr(form.get("category"));
  if (!VALID_CATEGORIES.has(category as SupplierCategory)) {
    throw new HttpError(400, "Invalid category");
  }

  let location: string | null = null;
  const locRaw = trimStr(form.get("location"));
  if (locRaw) {
    if (locRaw.length > 500) throw new HttpError(400, "location too long (max 500)");
    location = locRaw;
  }

  let website: string | null = null;
  const siteRaw = trimStr(form.get("website"));
  if (siteRaw) {
    if (siteRaw.length > 300) throw new HttpError(400, "website too long (max 300)");
    const candidate =
      siteRaw.startsWith("http://") || siteRaw.startsWith("https://")
        ? siteRaw
        : `https://${siteRaw}`;
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

  let message: string | null = null;
  const msgRaw = trimStr(form.get("message"));
  if (msgRaw) {
    if (msgRaw.length > 1000) throw new HttpError(400, "message too long (max 1000)");
    message = msgRaw;
  }

  // portfolio_links is sent as repeated fields: portfolio_links[]=url1&…
  const portfolioLinks: string[] = [];
  const rawLinks = form.getAll("portfolio_links[]");
  if (rawLinks.length > 6) throw new HttpError(400, "portfolio_links too many (max 6)");
  for (const raw of rawLinks) {
    const link = trimStr(raw);
    if (!link) continue;
    portfolioLinks.push(normalisePortfolioUrl(link));
  }

  let instagramHandle: string | null = null;
  const igRaw = trimStr(form.get("instagram_handle"));
  if (igRaw) instagramHandle = normaliseInstagramHandle(igRaw);

  // Optional price list — PDF or common image types, max 10 MB.
  // We insert the row first to get its ID, then save the file and UPDATE.
  const priceListFile = form.get("price_list");
  let priceListPath: string | null = null;
  if (priceListFile instanceof File && priceListFile.size > 0) {
    if (priceListFile.size > MAX_PRICE_LIST_BYTES) {
      throw new HttpError(413, "price_list too large (max 10 MB)");
    }
    const ext = PRICE_LIST_EXTS[priceListFile.type];
    if (!ext) {
      throw new HttpError(415, "price_list must be a PDF or JPEG/PNG/WebP image");
    }
    // Placeholder path — will be finalized after insert (need the row id).
    priceListPath = `__pending__:${ext}`;
  }

  let travelRadiusKm: number | null = null;
  const travelRaw = trimStr(form.get("travel_radius_km"));
  if (travelRaw) {
    const parsed = Number.parseInt(travelRaw, 10);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 2000) travelRadiusKm = parsed;
  }

  const taxNumber = trimStr(form.get("tax_number")) || null;
  const registrationNumber = trimStr(form.get("registration_number")) || null;

  // Optional referral code — resolve to a couple id now so the reward can be
  // granted at activation time even if the code is later regenerated.
  const rawRefCode = trimStr(form.get("ref_code")).toUpperCase();
  const referrerCoupleId = rawRefCode ? (lookupCoupleByRefCode(rawRefCode)?.id ?? null) : null;

  const row = insertVendorWaitlist({
    business_name,
    email,
    category,
    location,
    website,
    message,
    portfolio_links: portfolioLinks,
    instagram_handle: instagramHandle,
    price_list_path: null, // written after insert once we have the id
    travel_radius_km: travelRadiusKm,
    tax_number: taxNumber,
    registration_number: registrationNumber,
  });

  // Stamp the referrer after the row is created so the id is available.
  if (referrerCoupleId) {
    db.prepare("UPDATE vendor_waitlist SET referred_by_couple_id = ? WHERE id = ?").run(
      referrerCoupleId,
      row.id,
    );
  }

  // Save the price list now that we have the row id.
  let finalRow = row;
  if (
    priceListFile instanceof File &&
    priceListFile.size > 0 &&
    priceListPath?.startsWith("__pending__:")
  ) {
    const ext = priceListPath.split(":")[1] ?? "pdf";
    // The stored `price_list_path` is the bare storage key (no `/uploads/`
    // prefix); priceListUrl() prepends `/uploads/` when serving it.
    const key = `vendor_waitlist/${row.id}/price_list.${ext}`;
    await storage.write(key, await priceListFile.arrayBuffer());
    db.prepare("UPDATE vendor_waitlist SET price_list_path = ? WHERE id = ?").run(key, row.id);
    const refreshed = getVendorWaitlistById(row.id);
    if (refreshed) finalRow = refreshed;
  }

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

  return json({ entry: toVendorWaitlistEntry(finalRow) }, { status: 201 });
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

  // Accepting a vendor mints a single-use onboarding token. The activation link
  // is the CTA *button* of a dedicated transactional `vendor_activation` mail
  // (not a plain-text line appended to an outreach reply with a homepage
  // button) — the admin's warm body rides along as the intro. Re-accepting
  // supersedes any prior pending token (one live link per vendor). Locale is
  // left null here; the activate page pins the vendor's own browser locale at
  // completion, which is what drives currency.
  //
  // `emailBodyToSend` is what we STORE on the row for the CRM record — it keeps
  // the activation URL visible to the admin. What we SEND is the branded
  // activation mail below, which renders that same URL as the button + a
  // clickable copy-paste fallback.
  let emailBodyToSend = emailBody;
  let activateUrl: string | null = null;
  if (outcome === "accepted") {
    const token = createOnboardingToken({
      waitlistId: existing.id,
      businessName: existing.business_name,
      email: existing.email,
      category: existing.category,
      locale: null,
    });
    activateUrl = `${CONFIG.frontendBaseUrl}/vendor/activate/${encodeURIComponent(token.token)}`;
    emailBodyToSend = `${emailBody}\n\nAktiválási link / Activation link:\n${activateUrl}`;
  }

  // Send first; if delivery fails we still record the attempt by stamping the
  // row, but propagate the error to the admin so they can re-try. Skipping
  // the send (no RESEND_API_KEY in dev/test) is a no-op and never throws.
  let sendError: string | null = null;
  try {
    if (outcome === "accepted" && activateUrl) {
      await sendVendorActivationEmail({
        to: existing.email,
        businessName: existing.business_name,
        activateUrl,
        introMessage: emailBody,
        subject,
      });
    } else {
      await sendDecisionEmail({
        to: existing.email,
        subject,
        body: emailBodyToSend,
        outcome: outcome as VendorWaitlistOutcome,
        full_name: existing.business_name,
      });
    }
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
      sent_body: emailBodyToSend,
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
