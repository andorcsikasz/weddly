// Email open-tracking endpoint.
//
//   GET /api/emails/track/open?t=<token>
//
// Returns a 1×1 transparent GIF and stamps `invitation_opened_at` on the
// matching guest row (once — subsequent loads are no-ops). The token is an
// HMAC-signed `guestId.coupleId` pair so it can't be forged. No auth cookie
// required — the image loads from within the email client.
//
// Caveats callers should know about:
//   • Apple Mail Privacy Protection pre-fetches every image in 2021+ clients,
//     so "opened" may fire as soon as Mail downloads the message, not when the
//     human reads it.
//   • Gmail and Outlook.com proxy images through their own CDNs, which means
//     the IP is always Google/Microsoft, not the guest's.
//   • Some clients (ProtonMail, plain-text-only configs) block remote images
//     entirely — the pixel never fires for those recipients.

import { createHmac, timingSafeEqual } from "node:crypto";
import { CONFIG } from "../config";
import { db, now } from "../db";
import {
  addOptOut,
  getSendById,
  markCampaignOpened,
  resolveInviteClaimToken,
  verifyCampaignOptOutToken,
  verifyCampaignPixelToken,
} from "../domain/vendor_campaign";
import {
  getOnboardingSendById,
  markOnboardingCampaignClicked,
  markOnboardingCampaignOpened,
  verifyOnboardingClickToken,
  verifyOnboardingOptOutToken,
  verifyOnboardingPixelToken,
} from "../domain/onboarding_campaign";
import {
  retireInvitedPlanner,
  verifyPlannerInviteOptOutToken,
} from "../domain/planner_invite_batch";
import {
  getInviteSendById,
  markInviteCampaignClicked,
  markInviteCampaignOpened,
  verifyInviteClickToken,
  verifyInviteOptOutToken,
  verifyInvitePixelToken,
} from "../domain/personal_invite_campaign";
import {
  getReviewSendById,
  markReviewCampaignClicked,
  markReviewCampaignOpened,
  verifyReviewClickToken,
  verifyReviewOptOutToken,
  verifyReviewPixelToken,
} from "../domain/vendor_review_campaign";
import { type Ctx, HttpError, type Router } from "../lib/http";

// 1×1 transparent GIF (43 bytes, canonical minimum).
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function sign(guestId: number, coupleId: number): string {
  return createHmac("sha256", CONFIG.jwtSecret)
    .update(`${guestId}.${coupleId}`)
    .digest("hex")
    .slice(0, 32);
}

export function makeOpenTrackingToken(guestId: number, coupleId: number): string {
  return `${guestId}.${coupleId}.${sign(guestId, coupleId)}`;
}

function verifyOpenTrackingToken(token: string): { guestId: number; coupleId: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [rawGuest, rawCouple, sig] = parts as [string, string, string];
  const guestId = parseInt(rawGuest, 10);
  const coupleId = parseInt(rawCouple, 10);
  if (!Number.isFinite(guestId) || !Number.isFinite(coupleId)) return null;
  const expected = sign(guestId, coupleId);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"))) return null;
  } catch {
    return null;
  }
  return { guestId, coupleId };
}

function pixelResponse(): Response {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

// ── Claim-invite campaign ───────────────────────────────────────────────────
// The click redirect is a far better engagement signal than the pixel above, so
// it is both the campaign's metric and the gate on whether a reminder goes out.
//
// It is not perfect, and the failure mode is worth knowing: corporate link
// scanners (Microsoft Defender Safe Links, Mimecast, Barracuda) fetch every URL
// in an inbound message, so a recipient on such a tenant can be stamped as
// "clicked" without ever seeing the mail, and loses their reminder. That is
// still strictly better than gating on opens, where Apple Mail Privacy
// Protection inflates a much larger share of consumer traffic. The cost of a
// false positive is one un-sent nudge, so it is not worth UA-sniffing for;
// if it ever needs tightening, the honest signal is the SPA's own
// `POST /api/vendor/claim/verify/:token`, which a scanner following a 302
// does not reach.

function handleInviteRedirect(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  if (!token || token.length < 16 || token.length > 128) {
    return Response.redirect(`${CONFIG.frontendBaseUrl}/vendors`, 302);
  }
  const live = resolveInviteClaimToken(token);
  // No live claim means the listing was claimed already (or is gone). Send them
  // to sign-in rather than a dead-end error: the most likely reader of a
  // second click is the vendor who just finished claiming.
  const dest = live
    ? `${CONFIG.frontendBaseUrl}/vendor/claim/verify/${encodeURIComponent(live)}`
    : `${CONFIG.frontendBaseUrl}/login`;
  return Response.redirect(dest, 302);
}

/** Address-level opt-out. Mirrors `email_prefs.ts`: the GET is one-click and
 *  renders a confirmation, the POST exists for the RFC 8058 bot and answers
 *  204 even on a bad token (never feed the bot a 4xx). */
function optOutEmailFromToken(token: string): string | null {
  const sendId = verifyCampaignOptOutToken(token);
  if (sendId == null) return null;
  return getSendById(sendId)?.email ?? null;
}

function handleCampaignOptOut(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = optOutEmailFromToken(token);
  if (email) addOptOut(email, "vendor_claim_campaign");
  return new Response(optOutHtml(email != null), {
    status: email ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleCampaignOptOutPost(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = optOutEmailFromToken(token);
  if (email) addOptOut(email, "vendor_claim_campaign");
  return new Response(null, { status: 204 });
}

// ── Review-invite campaign ──────────────────────────────────────────────────
// Same shape as the claim campaign above but against vendor_review_campaign_sends.
// The CTA token is a signed <sendId>.<hmac> (not a bearer credential), so the
// redirect just stamps the click and sends the vendor to their own public page.

function handleReviewRedirect(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const sendId = verifyReviewClickToken(token);
  const dest = sendId != null ? markReviewCampaignClicked(sendId) : null;
  // No live destination (unknown/forged token) → the public directory rather
  // than a dead end.
  return Response.redirect(dest ?? `${CONFIG.frontendBaseUrl}/vendors`, 302);
}

function reviewOptOutEmailFromToken(token: string): string | null {
  const sendId = verifyReviewOptOutToken(token);
  if (sendId == null) return null;
  return getReviewSendById(sendId)?.email ?? null;
}

function handleReviewOptOut(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = reviewOptOutEmailFromToken(token);
  if (email) addOptOut(email, "vendor_review_campaign");
  return new Response(optOutHtml(email != null), {
    status: email ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleReviewOptOutPost(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = reviewOptOutEmailFromToken(token);
  if (email) addOptOut(email, "vendor_review_campaign");
  return new Response(null, { status: 204 });
}

// ── Personal-invite campaign ────────────────────────────────────────────────
// Pixel + click redirect, same shape as the two vendor families. The redirect
// hands over to the same UTM'd register URL the mail used to link directly, so
// conversion attribution is untouched and the tracking is purely additive: if
// the stamp fails the recipient still lands where they were going.

function handlePersonalInviteRedirect(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const sendId = verifyInviteClickToken(token);
  const dest = sendId != null ? markInviteCampaignClicked(sendId) : null;
  return Response.redirect(dest ?? CONFIG.frontendBaseUrl, 302);
}

function inviteOptOutEmailFromToken(token: string): string | null {
  const sendId = verifyInviteOptOutToken(token);
  if (sendId == null) return null;
  return getInviteSendById(sendId)?.email ?? null;
}

function handleInviteOptOut(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = inviteOptOutEmailFromToken(token);
  if (email) addOptOut(email, "personal_invite");
  return new Response(optOutHtml(email != null), {
    status: email ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleInviteOptOutPost(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = inviteOptOutEmailFromToken(token);
  if (email) addOptOut(email, "personal_invite");
  return new Response(null, { status: 204 });
}

// ── Onboarding re-engagement campaign ───────────────────────────────────────
// Pixel + click redirect as above. The click token also carries WHICH wave was
// clicked, because the destination's `utm_content` differs between the initial
// nudge and the reminder and we would otherwise attribute every click to the
// first one.

function handleOnboardingRedirect(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const parsed = verifyOnboardingClickToken(token);
  const dest = parsed ? markOnboardingCampaignClicked(parsed.sendId, parsed.reminder) : null;
  // A dead token still belongs at the onboarding form: this audience has an
  // account and no workspace, which is exactly what that page is for.
  return Response.redirect(dest ?? `${CONFIG.frontendBaseUrl}/onboarding`, 302);
}

function onboardingOptOutEmailFromToken(token: string): string | null {
  const sendId = verifyOnboardingOptOutToken(token);
  if (sendId == null) return null;
  return getOnboardingSendById(sendId)?.email ?? null;
}

function handleOnboardingOptOut(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = onboardingOptOutEmailFromToken(token);
  if (email) addOptOut(email, "onboarding_campaign");
  return new Response(optOutHtml(email != null), {
    status: email ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handleOnboardingOptOutPost(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const email = onboardingOptOutEmailFromToken(token);
  if (email) addOptOut(email, "onboarding_campaign");
  return new Response(null, { status: 204 });
}

/** Static HTML, deliberately bilingual: this page is reached from a cold mail
 *  in either language and costs nothing to render both ways. No user input is
 *  interpolated, so there is nothing to escape. */
// ── Suggested-planner invites ───────────────────────────────────────────────
// No campaign row behind these, so the token signs the provisioned user id
// directly. Opting out is also an erasure here: the account only exists because
// we opened it for them, so `retireInvitedPlanner` scrubs it on the way out
// (unless they already activated it, in which case they own it and it stays).

function handlePlannerInviteOptOut(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const userId = verifyPlannerInviteOptOutToken(token);
  const email = userId != null ? retireInvitedPlanner(userId) : null;
  if (email) addOptOut(email, "planner_suggested_invite");
  return new Response(plannerOptOutHtml(email != null), {
    status: email ? 200 : 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function handlePlannerInviteOptOutPost(ctx: Ctx): Response {
  const token = (ctx.params as { token?: string }).token ?? "";
  const userId = verifyPlannerInviteOptOutToken(token);
  const email = userId != null ? retireInvitedPlanner(userId) : null;
  if (email) addOptOut(email, "planner_suggested_invite");
  return new Response(null, { status: 204 });
}

/** The claim-campaign confirmation talks about a listing staying up, which is
 *  wrong here: what we hold is an account we opened, and it is gone. */
function plannerOptOutHtml(success: boolean): string {
  const title = success ? "Rendben / Done" : "Érvénytelen link / Invalid link";
  const body = success
    ? `<p>Nem írunk többet erre a címre, és az előkészített szervezői fiókot is töröltük.</p>
       <p style="color:#7a7065;">We won't email this address again, and the planner account we had prepared is deleted.</p>`
    : `<p>Ez a link nem érvényes.</p>
       <p style="color:#7a7065;">This link is no longer valid. Reply to the email and a human will sort it out.</p>`;
  return optOutPage(title, body);
}

function optOutHtml(success: boolean): string {
  const title = success ? "Rendben / Done" : "Érvénytelen link / Invalid link";
  const body = success
    ? `<p>Nem írunk többet erre a címre. A hirdetés fent marad, de ha szeretnéd levetetni, válaszolj erre az emailre.</p>
       <p style="color:#7a7065;">We won't email this address again. Your listing stays up; reply to the email if you'd like it removed entirely.</p>`
    : `<p>Ez a link nem érvényes.</p>
       <p style="color:#7a7065;">This link is no longer valid. Reply to the email and a human will sort it out.</p>`;
  return optOutPage(title, body);
}

/** Shared chrome for every opt-out confirmation. Standalone HTML (no SPA, no
 *  JS): the recipient may open it from a mail client's in-app browser. */
function optOutPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="hu"><head><meta charset="utf-8" /><title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{margin:0;padding:32px 16px;background:#f4efe7;color:#1c1714;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  .card{max-width:560px;margin:0 auto;background:#fff;border:1px solid #eae4dc;border-radius:14px;padding:32px;}
  h1{font-family:Georgia,'Times New Roman',serif;font-size:22px;margin:0 0 18px 0;}
  p{font-size:15px;line-height:1.55;margin:0 0 12px 0;}
</style>
</head><body><div class="card"><h1>${title}</h1>${body}<p style="margin-top:24px;font-size:13px;color:#7a7065;">Weddly</p></div></body></html>`;
}

export function registerEmailTrackRoutes(router: Router): void {
  router.get("/api/emails/track/open", (ctx) => {
    const t = ctx.url.searchParams.get("t") ?? "";
    const parsed = verifyOpenTrackingToken(t);
    if (parsed) {
      const { guestId, coupleId } = parsed;
      db.prepare(
        `UPDATE guests
            SET invitation_opened_at = COALESCE(invitation_opened_at, ?)
          WHERE id = ? AND couple_id = ? AND invited_at IS NOT NULL`,
      ).run(now(), guestId, coupleId);
    }
    return pixelResponse();
  });

  router.get("/api/emails/track/campaign", (ctx) => {
    const sendId = verifyCampaignPixelToken(ctx.url.searchParams.get("t") ?? "");
    if (sendId != null) markCampaignOpened(sendId);
    return pixelResponse();
  });

  // Tracked one-click entry into the claim flow. `/r/` matches the existing
  // tracked-redirect convention (see the supplier website redirect).
  router.get("/r/vendor-invite/:token", handleInviteRedirect);

  router.get("/api/emails/optout/:token", handleCampaignOptOut);
  router.post("/api/emails/optout/:token", handleCampaignOptOutPost);
  // Pretty alias for the visible footer link, same reasoning as
  // /unsubscribe/:token: the router matches before the SPA fallback, so the
  // recipient gets the confirmation instead of the React 404.
  router.get("/email-optout/:token", handleCampaignOptOut);
  router.post("/email-optout/:token", handleCampaignOptOutPost);

  // Review-invite campaign: sibling pixel, click redirect and opt-out.
  router.get("/api/emails/track/review-campaign", (ctx) => {
    const sendId = verifyReviewPixelToken(ctx.url.searchParams.get("t") ?? "");
    if (sendId != null) markReviewCampaignOpened(sendId);
    return pixelResponse();
  });
  router.get("/r/vendor-review/:token", handleReviewRedirect);
  router.get("/api/emails/optout-review/:token", handleReviewOptOut);
  router.post("/api/emails/optout-review/:token", handleReviewOptOutPost);
  router.get("/review-optout/:token", handleReviewOptOut);
  router.post("/review-optout/:token", handleReviewOptOutPost);

  // Personal-invite campaign: pixel, click redirect, opt-out.
  router.get("/api/emails/track/invite-campaign", (ctx) => {
    const sendId = verifyInvitePixelToken(ctx.url.searchParams.get("t") ?? "");
    if (sendId != null) markInviteCampaignOpened(sendId);
    return pixelResponse();
  });
  router.get("/r/invite/:token", handlePersonalInviteRedirect);
  // Opt-out (List-Unsubscribe target + footer link).
  router.get("/api/emails/optout-invite/:token", handleInviteOptOut);
  router.post("/api/emails/optout-invite/:token", handleInviteOptOutPost);
  router.get("/invite-optout/:token", handleInviteOptOut);
  router.post("/invite-optout/:token", handleInviteOptOutPost);

  // Onboarding re-engagement campaign: pixel, click redirect, opt-out.
  router.get("/api/emails/track/onboarding-campaign", (ctx) => {
    const sendId = verifyOnboardingPixelToken(ctx.url.searchParams.get("t") ?? "");
    if (sendId != null) markOnboardingCampaignOpened(sendId);
    return pixelResponse();
  });
  router.get("/r/onboarding/:token", handleOnboardingRedirect);
  // Opt-out (List-Unsubscribe target + footer link).
  router.get("/api/emails/optout-onboarding/:token", handleOnboardingOptOut);
  router.post("/api/emails/optout-onboarding/:token", handleOnboardingOptOutPost);
  router.get("/onboarding-optout/:token", handleOnboardingOptOut);
  router.post("/onboarding-optout/:token", handleOnboardingOptOutPost);

  // Suggested-planner invite opt-out (List-Unsubscribe target + footer link).
  router.get("/api/emails/optout-planner/:token", handlePlannerInviteOptOut);
  router.post("/api/emails/optout-planner/:token", handlePlannerInviteOptOutPost);
  router.get("/planner-optout/:token", handlePlannerInviteOptOut);
  router.post("/planner-optout/:token", handlePlannerInviteOptOutPost);
}
