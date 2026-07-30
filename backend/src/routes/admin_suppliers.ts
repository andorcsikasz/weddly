// Admin moderation for community-submitted suppliers. Gate every handler
// with requireAdmin() — that checks auth + ADMIN_EMAILS allowlist.

import {
  approveSupplier,
  createVerificationToken,
  deleteCommunitySupplier,
  deleteCommunitySuppliersBySubmitter,
  dismissReportsForSupplier,
  getCommunitySupplierById,
  getCommunitySupplierWithEmail,
  listAllForAdmin,
  listOpenReportsForSupplier,
  openReportCountsForAll,
  setStatus,
  toAdminView,
  updateAdminNotes,
} from "../domain/community_suppliers";
import { CONFIG } from "../config";
import { clearCuratedOverride, setCuratedOverride } from "../domain/curated_overrides";
import { sendKind } from "../domain/emails";
import { purgeOneUser } from "../domain/purge";
import { enrichSupplier } from "../domain/supplier_enrich";
import { fetchAndStoreListingHero } from "../domain/listing_image_backfill";
import { getListingById } from "../domain/listings";
import {
  listDirectoryForAdmin,
  listDirectoryWithFacets,
  parseDirectoryFilters,
} from "../domain/supplier_views";
import { DIRECTORY } from "../domain/suppliers_data";
import { requireAdmin } from "../domain/users";
import { addAuditLog } from "../lib/audit";
import { type Ctx, HttpError, json, readJson, type Router } from "../lib/http";

interface HideBody {
  reason?: unknown;
}

interface NotesBody {
  notes?: unknown;
}

function parseId(ctx: Ctx): number {
  const id = Number(ctx.params.id);
  if (!Number.isFinite(id) || id <= 0) throw new HttpError(400, "Invalid id");
  return id;
}

function handleList(ctx: Ctx): Response {
  requireAdmin(ctx);
  const counts = openReportCountsForAll();
  return json({
    suppliers: listAllForAdmin().map((row) => toAdminView(row, counts.get(row.id) ?? 0)),
  });
}

function handleListReports(ctx: Ctx): Response {
  requireAdmin(ctx);
  const id = parseId(ctx);
  if (!getCommunitySupplierById(id)) throw new HttpError(404, "Supplier not found");
  return json({ reports: listOpenReportsForSupplier(id) });
}

function handleDismissReports(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);
  if (!getCommunitySupplierById(id)) throw new HttpError(404, "Supplier not found");
  const dismissed = dismissReportsForSupplier(id, admin.id);
  if (dismissed > 0) {
    addAuditLog({
      actor_user_id: admin.id,
      couple_id: null,
      action: "supplier.community.reports.dismiss",
      target_kind: "community_supplier",
      target_id: id,
      after: { dismissed },
    });
  }
  return json({ ok: true, dismissed });
}

async function handleHide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  const body = await readJson<HideBody>(ctx.req).catch(() => ({}) as HideBody);
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

  setStatus(id, "hidden", admin.id, reason);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.hide",
    target_kind: "community_supplier",
    target_id: id,
    before: { status: before.status },
    after: { status: "hidden", hide_reason: reason },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");

  // Notify the submitter only when this hide is a moderation rejection
  // (`awaiting_review` → `hidden`). Hiding an already-active listing for
  // spam reports is a different flow — the recipient shouldn't be
  // congratulated with a rejection mail. Skipped when no contact email
  // was provided.
  if (before.status === "awaiting_review" && after.contact_email) {
    void sendKind(
      "community_supplier_rejected",
      { supplierName: after.name, reason },
      { user: null, guest: { email: after.contact_email, full_name: after.name } },
    );
  }

  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

async function handleEnrich(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  // Admin-triggered: force overwrite. The auto-enrich on submit only fills
  // blanks, but moderators hitting this button explicitly want to refresh
  // the row — usually because the first pass scraped junk.
  const filled = await enrichSupplier(id, { force: true });

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.enrich",
    target_kind: "community_supplier",
    target_id: id,
    after: { fields_filled: filled },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0), fields_filled: filled });
}

async function handleRefetchHero(ctx: Ctx): Promise<Response> {
  // Manual override for the hero auto-fill (domain/listing_image_backfill): pull
  // the og:image from the listing's own website again, NOW. Accepts any listing
  // id (curated slug, `c<id>`, `v<id>`) — not just numeric community ids — so
  // moderators can fix a curated venue whose card shows a junk image or none.
  // skipQualityGate: the admin explicitly asked, so accept even a small image.
  const admin = requireAdmin(ctx);
  const id = ctx.params.id?.trim();
  if (!id) throw new HttpError(400, "Invalid id");

  const listing = getListingById(id);
  if (!listing) throw new HttpError(404, "Listing not found");
  if (!listing.website || !listing.website.trim()) {
    throw new HttpError(409, "Listing has no website to fetch a hero from", {
      code: "no_website",
    });
  }

  const stored = await fetchAndStoreListingHero(id, listing.website, { skipQualityGate: true });
  const after = getListingById(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.listing.refetch_hero",
    target_kind: "listing",
    target_id: null,
    before: { listing_id: id, hero_image_url: listing.hero_image_url },
    after: { stored, hero_image_url: after?.hero_image_url ?? null },
  });

  return json({ ok: stored, hero_image_url: after?.hero_image_url ?? null });
}

function handleApprove(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");
  // Two valid entry points to approval:
  //  - awaiting_review: vendor has clicked the verify link, now admin signs off
  //  - pending + no contact_email: nothing to verify, admin can publish direct
  // A `pending` row WITH a contact_email is an error — admin should click
  // "Send verify" first so the vendor proves they own the inbox before we
  // publish their business in the directory.
  const directApprovableNoEmail =
    before.status === "pending" && !getCommunitySupplierWithEmail(id)?.contact_email;
  if (before.status !== "awaiting_review" && !directApprovableNoEmail) {
    if (before.status === "pending") {
      throw new HttpError(
        409,
        "This listing has a contact email — click 'Send verify' first so the vendor confirms ownership before we publish.",
        { code: "send_verify_first" },
      );
    }
    throw new HttpError(
      409,
      `Cannot approve from status="${before.status}" — only "awaiting_review" rows are approvable.`,
    );
  }

  approveSupplier(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.approve",
    target_kind: "community_supplier",
    target_id: id,
    before: { status: before.status },
    after: { status: "active" },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");

  // Close the verify → moderation → live loop. The recipient last heard from
  // us when they clicked the verify link; without this, they have no signal
  // that moderation actually approved them. Fire-and-forget, guest target.
  if (after.contact_email) {
    void sendKind(
      "community_supplier_published",
      {
        supplierName: after.name,
        listingUrl: CONFIG.frontendBaseUrl,
      },
      { user: null, guest: { email: after.contact_email, full_name: after.name } },
    );
  }

  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

async function handleSendVerify(ctx: Ctx): Promise<Response> {
  // Admin-gated verify-mail kickoff. Submission alone no longer sends the
  // verify mail — any logged-in couple could otherwise blast verification
  // mail at any business's contact_email by submitting them to the
  // directory. Admin reviews the row first and explicitly releases the mail.
  //
  // Stays at status='pending' (vendor still has to click) but issues a
  // fresh token + fires the cold-mail. Idempotent re-clicks generate a new
  // token (the old one stays valid until its own expiry; consumeVerification
  // is single-use, so the first click wins regardless).
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const supplier = getCommunitySupplierWithEmail(id);
  if (!supplier) throw new HttpError(404, "Supplier not found");
  if (!supplier.contact_email) {
    throw new HttpError(409, "Listing has no contact email — approve directly instead", {
      code: "no_contact_email",
    });
  }
  if (supplier.status !== "pending") {
    throw new HttpError(
      409,
      `Cannot send verify from status="${supplier.status}" — only 'pending' rows are eligible.`,
      { code: "invalid_status_for_send_verify" },
    );
  }

  const token = createVerificationToken(id);
  void sendKind(
    "community_supplier_verify",
    {
      supplierName: supplier.name,
      verifyUrl: `${CONFIG.frontendBaseUrl}/verify-supplier/${token.token}`,
    },
    {
      user: null,
      guest: { email: supplier.contact_email, full_name: supplier.name },
      submitterUserId: supplier.submitter_user_id,
    },
  );

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.send_verify",
    target_kind: "community_supplier",
    target_id: id,
    after: { to_email: supplier.contact_email },
  });

  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(supplier, counts.get(id) ?? 0) });
}

async function handleUnhide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  setStatus(id, "active", null, null);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.unhide",
    target_kind: "community_supplier",
    target_id: id,
    before: { status: before.status, hide_reason: before.hide_reason },
    after: { status: "active" },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

async function handleUpdateNotes(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  const body = await readJson<NotesBody>(ctx.req).catch(() => ({}) as NotesBody);
  if (typeof body.notes !== "string") {
    throw new HttpError(400, "notes must be a string");
  }

  updateAdminNotes(id, body.notes);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.notes.update",
    target_kind: "community_supplier",
    target_id: id,
    before: { admin_notes_length: before.admin_notes?.length ?? 0 },
    after: { admin_notes_length: body.notes.length },
  });

  const after = getCommunitySupplierWithEmail(id);
  if (!after) throw new HttpError(500, "Failed to read updated supplier");
  const counts = openReportCountsForAll();
  return json({ supplier: toAdminView(after, counts.get(id) ?? 0) });
}

function handleDelete(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  deleteCommunitySupplier(id);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.delete",
    target_kind: "community_supplier",
    target_id: id,
    before,
  });

  return json({ ok: true });
}

/** Purge the ENTIRE submitter account behind a community supplier — the user
 *  row + everything it owns (couple, guests, bookings…), via the same
 *  admin-initiated purge the users admin uses. Far more destructive than
 *  deleting the single listing (which `handleDelete` does); the community
 *  supplier row itself vanishes with the cascade. */
function handlePurgeSubmitter(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const id = parseId(ctx);

  const before = getCommunitySupplierById(id);
  if (!before) throw new HttpError(404, "Supplier not found");

  const submitterId = before.submitter_user_id;
  // Guard: never let an admin nuke their own account through this button.
  if (submitterId === admin.id) {
    throw new HttpError(409, "Refusing to purge your own account", { code: "cannot_purge_self" });
  }

  // The account purge scrubs the users row in place (no DELETE), so the
  // community_suppliers ON DELETE CASCADE never fires — remove the submitter's
  // listings explicitly first so nothing orphans.
  const removedSuppliers = deleteCommunitySuppliersBySubmitter(submitterId);
  purgeOneUser(submitterId, { adminInitiated: true });

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.community.purge_submitter",
    target_kind: "user",
    target_id: submitterId,
    before: { supplier_id: id, supplier_name: before.name },
    after: { removed_suppliers: removedSuppliers },
  });

  return json({ ok: true });
}

// ── Curated moderation: hide / restore / delete code-resident entries ──────

/** Resolve + validate a curated slug from the path. 404 if it isn't a real
 *  curated entry so we never write an override for a bogus id. */
function parseCuratedSlug(ctx: Ctx): string {
  const slug = ctx.params.slug?.trim();
  if (!slug) throw new HttpError(400, "Invalid slug");
  if (!DIRECTORY.some((s) => s.id === slug)) throw new HttpError(404, "Curated supplier not found");
  return slug;
}

async function handleCuratedHide(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const slug = parseCuratedSlug(ctx);

  const body = await readJson<HideBody>(ctx.req).catch(() => ({}) as HideBody);
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

  setCuratedOverride(slug, "hidden", admin.id, reason);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.curated.hide",
    target_kind: "curated_supplier",
    target_id: null,
    after: { supplier_id: slug, hide_reason: reason },
  });

  return json({ ok: true, status: "hidden" });
}

function handleCuratedUnhide(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const slug = parseCuratedSlug(ctx);

  clearCuratedOverride(slug);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.curated.unhide",
    target_kind: "curated_supplier",
    target_id: null,
    after: { supplier_id: slug, status: "active" },
  });

  return json({ ok: true, status: "active" });
}

async function handleCuratedDelete(ctx: Ctx): Promise<Response> {
  const admin = requireAdmin(ctx);
  const slug = parseCuratedSlug(ctx);

  const body = await readJson<HideBody>(ctx.req).catch(() => ({}) as HideBody);
  const reason =
    typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;

  setCuratedOverride(slug, "deleted", admin.id, reason);

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.curated.delete",
    target_kind: "curated_supplier",
    target_id: null,
    after: { supplier_id: slug, hide_reason: reason },
  });

  return json({ ok: true });
}

// ── Directory view: full curated + community list with visit analytics ─────

function handleDirectory(ctx: Ctx): Response {
  requireAdmin(ctx);
  const filters = parseDirectoryFilters(ctx.url.searchParams);
  // Facets ride along with the rows rather than sitting behind their own
  // endpoint: they are counted from the same in-memory catalogue this call
  // already builds, so a second request would rebuild all 1000 rows to learn
  // four numbers, and the two answers could disagree mid-edit.
  const { rows, facets } = listDirectoryWithFacets(filters);
  return json({ suppliers: rows, facets, filters });
}

/** RFC 4180 CSV cell: wrap in quotes and double internal quotes whenever the
 *  value contains a comma, quote, or line break. Bare numbers/empties pass
 *  through unquoted to keep the file diff-friendly. */
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.length === 0) return "";
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoDate(unixMs: number | null): string {
  if (unixMs === null || !Number.isFinite(unixMs)) return "";
  return new Date(unixMs).toISOString();
}

function handleDirectoryCsv(ctx: Ctx): Response {
  const admin = requireAdmin(ctx);
  const filters = parseDirectoryFilters(ctx.url.searchParams);
  const rows = listDirectoryForAdmin(filters);

  const headers = [
    "id",
    "source",
    "status",
    "category",
    "name",
    "city",
    "address",
    "website",
    "contact_email",
    "contact_phone",
    "price_band",
    "submitter_type",
    "submitter_email",
    "submitter_last_seen_at",
    "created_at",
    "views_total",
    "views_30d",
    "views_7d",
    "website_clicks_total",
    "website_clicks_30d",
    "phone_clicks_total",
    "last_event_at",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.id),
        csvCell(r.source),
        csvCell(r.status),
        csvCell(r.category),
        csvCell(r.name),
        csvCell(r.city),
        csvCell(r.address),
        csvCell(r.website),
        csvCell(r.contact_email),
        csvCell(r.contact_phone),
        csvCell(r.price_band),
        csvCell(r.submitter_type ?? (r.source === "curated" ? "admin" : "")),
        csvCell(r.submitter_email),
        csvCell(isoDate(r.submitter_last_seen_at)),
        csvCell(isoDate(r.created_at)),
        csvCell(r.analytics.views_total),
        csvCell(r.analytics.views_30d),
        csvCell(r.analytics.views_7d),
        csvCell(r.analytics.website_clicks_total),
        csvCell(r.analytics.website_clicks_30d),
        csvCell(r.analytics.phone_clicks_total),
        csvCell(isoDate(r.analytics.last_event_at)),
      ].join(","),
    );
  }
  // UTF-8 BOM + CRLF so Excel opens Hungarian accents correctly. Same trick
  // the guest CSV export uses (routes/guests.ts).
  const csv = `﻿${lines.join("\r\n")}\r\n`;
  const body = new TextEncoder().encode(csv);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `weddly-suppliers-${stamp}.csv`;

  addAuditLog({
    actor_user_id: admin.id,
    couple_id: null,
    action: "supplier.directory.csv_export",
    target_kind: "supplier_directory",
    target_id: null,
    after: { count: rows.length, filters },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function registerAdminSupplierRoutes(router: Router) {
  router.get("/api/admin/suppliers", handleList, true);
  router.get("/api/admin/suppliers/directory", handleDirectory, true);
  router.get("/api/admin/suppliers/directory.csv", handleDirectoryCsv, true);
  // Curated moderation (code-resident entries, keyed by slug). Registered
  // before the numeric `:id` routes so the 3-segment `curated/:slug/...` paths
  // are unambiguous.
  router.post("/api/admin/suppliers/curated/:slug/hide", handleCuratedHide, true);
  router.post("/api/admin/suppliers/curated/:slug/unhide", handleCuratedUnhide, true);
  router.delete("/api/admin/suppliers/curated/:slug", handleCuratedDelete, true);
  router.get("/api/admin/suppliers/:id/reports", handleListReports, true);
  router.post("/api/admin/suppliers/:id/approve", handleApprove, true);
  router.post("/api/admin/suppliers/:id/send-verify", handleSendVerify, true);
  router.post("/api/admin/suppliers/:id/enrich", handleEnrich, true);
  router.post("/api/admin/suppliers/:id/refetch-hero", handleRefetchHero, true);
  router.post("/api/admin/suppliers/:id/hide", handleHide, true);
  router.post("/api/admin/suppliers/:id/unhide", handleUnhide, true);
  router.post("/api/admin/suppliers/:id/reports/dismiss", handleDismissReports, true);
  router.patch("/api/admin/suppliers/:id/notes", handleUpdateNotes, true);
  router.post("/api/admin/suppliers/:id/purge-submitter", handlePurgeSubmitter, true);
  router.delete("/api/admin/suppliers/:id", handleDelete, true);
}
