// The vendor's printable review QR code (Hovercode dynamic code). Every path
// is `/me`: the listing comes from the session, never from the request.
//
//   GET  /api/vendor/review-qr/me           — { available, qr }
//   POST /api/vendor/review-qr/me           — make the code (once; again returns it)
//   GET  /api/vendor/review-qr/me.svg       — the code drawn here, for the page
//   GET  /api/vendor/review-qr/me/download  — redirect to Hovercode's print file
//                                             (?format=png|svg)

import { resolveVendorAccount } from "../domain/vendor_clients";
import {
  createVendorReviewQr,
  getVendorReviewQr,
  vendorReviewQrDownload,
  vendorReviewQrShortlink,
} from "../domain/vendor_review_qr";
import { type Ctx, HttpError, json, type Router } from "../lib/http";
import { generateQrSvg } from "../lib/qrcode";

async function handleGet(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  return json(await getVendorReviewQr(account.id));
}

async function handleCreate(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  return json(await createVendorReviewQr(account.id));
}

// Drawn from the short link on our side, so the page shows a same-origin image
// and no third-party SVG.
async function handleSvg(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const url = vendorReviewQrShortlink(account.id);
  if (!url) throw new HttpError(404, "No review QR code yet");
  return new Response(await generateQrSvg(url), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, max-age=300" },
  });
}

async function handleDownload(ctx: Ctx): Promise<Response> {
  const account = resolveVendorAccount(ctx);
  const format = ctx.url.searchParams.get("format") === "svg" ? "svg" : "png";
  return Response.redirect(await vendorReviewQrDownload(account.id, format), 302);
}

export function registerVendorReviewQrRoutes(router: Router) {
  router.get("/api/vendor/review-qr/me.svg", handleSvg, true);
  router.get("/api/vendor/review-qr/me/download", handleDownload, true);
  router.get("/api/vendor/review-qr/me", handleGet, true);
  router.post("/api/vendor/review-qr/me", handleCreate, true);
}
