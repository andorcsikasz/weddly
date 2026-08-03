// Bun.serve() entry point. Wires every route module and starts the server.
// SPA static files are served from frontend/dist when SERVE_FRONTEND=1.

import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { extractToken, verifySessionToken } from "./auth/session";
import { CONFIG } from "./config";
import { db } from "./db"; // open DB + apply schema
import "./init_households"; // idempotent backfill: couple slugs + households
import { initObservability, captureException } from "./lib/observability";

initObservability();

import {
  corsHeaders,
  corsPreflight,
  type Ctx,
  err as httpErr,
  HttpError,
  Router,
} from "./lib/http";
import { maybeCompress, negotiateEncoding } from "./lib/compression";
import { redactTokensInPath } from "./lib/log_redact";
import { log, makeLogger } from "./lib/logger";
import { GA4_CSP_HASHES, GTM_INLINE_CSP_HASH, localeForHost, renderIndexHtml } from "./lib/seo_ssr";
import { backfillFoundingAnchor, entitlementBlock } from "./domain/billing";
import { plannerEntitlementBlock } from "./domain/planner_billing";
import { vendorEntitlementBlock } from "./domain/vendor_billing";
import { ensureGeoDb } from "./lib/geoip";
import { storage, keyFromUploadUrl } from "./lib/storage";
import { assertEmailIntegrityAtBoot } from "./domain/emails/integrity_check";
import { startEmailWorker } from "./domain/emails/worker";
import { startPurgeWorker } from "./domain/purge";
import { startBackupWorker } from "./domain/backup";
import { startGoogleCalendarWorker } from "./domain/google_calendar_worker";
import { backfillVendorPoints } from "./domain/vendor_points";
import { startVendorPointsWorker } from "./domain/vendor_points_worker";
import { backfillPlannerPoints } from "./domain/planner_points";
import { startPlannerPointsWorker } from "./domain/planner_points_worker";
import { startWishlistImageBackfill } from "./domain/wishlist_image_backfill";
import { startListingImageBackfill } from "./domain/listing_image_backfill";
import { startListingGalleryBackfill } from "./domain/listing_gallery_backfill";
import { registerAccommodationRoutes } from "./routes/accommodations";
import { registerAdminAnalyticsRoutes } from "./routes/admin_analytics";
import { registerAdminEmailListRoutes } from "./routes/admin_email_list";
import { registerAdminEmailPreviewRoutes } from "./routes/admin_email_preview";
import { registerAdminFinancialPlannerRoutes } from "./routes/admin_financial_planner";
import { registerAdminPlannerRoutes } from "./routes/admin_planners";
import { registerAdminSupplierRoutes } from "./routes/admin_suppliers";
import { registerAdminReviewRoutes } from "./routes/admin_reviews";
import { registerAdminUserRoutes } from "./routes/admin_users";
import { registerAdminCampaignScheduleRoutes } from "./routes/admin_campaign_schedules";
import { registerAdminOnboardingCampaignRoutes } from "./routes/admin_onboarding_campaign";
import { registerAdminPersonalInviteCampaignRoutes } from "./routes/admin_personal_invite_campaign";
import { registerAdminVendorCampaignRoutes } from "./routes/admin_vendor_campaign";
import { registerAdminVendorReviewCampaignRoutes } from "./routes/admin_vendor_review_campaign";
import { registerAdminVendorRoutes } from "./routes/admin_vendors";
import { registerVendorWaitlistRoutes } from "./routes/vendor_waitlist";
import { registerPlannerWaitlistRoutes } from "./routes/planner_waitlist";
import { registerPlannerRoutes } from "./routes/planner";
import { registerPlannerEventsRoutes } from "./routes/planner_events";
import { registerPlannerPointsRoutes } from "./routes/planner_points";
import { registerPlannerActivationRoutes } from "./routes/planner_activation";
import { registerAuthRoutes } from "./routes/auth";
import { registerAuthAppleRoutes } from "./routes/auth_apple";
import { registerAuthGoogleRoutes } from "./routes/auth_google";
import { registerBillingRoutes } from "./routes/billing";
import { registerReferralRoutes } from "./routes/referrals";
import { registerBlogRoutes, seedBlogPostsIfEmpty } from "./routes/blog";
import { registerBudgetRoutes } from "./routes/budget";
import { registerBudgetDocumentRoutes } from "./routes/budget_documents";
import { registerBudgetPaymentRoutes } from "./routes/budget_payments";
import { registerCommunitySupplierRoutes } from "./routes/community_suppliers";
import { registerVerifiedVisitorRoutes } from "./routes/verified_visitors";
import { registerCompanyLookupRoutes } from "./routes/company_lookup";
import { registerTranslateRoutes } from "./routes/translate";
import { registerGeoRoutes } from "./routes/geo";
import { registerIncomeRoutes } from "./routes/income";
import { registerCouplePauseRoutes } from "./routes/couple_pause";
import { registerCoupleRoutes } from "./routes/couples";
import { registerCouplePickRoutes } from "./routes/couple_picks";
import { registerSavedSupplierRoutes } from "./routes/saved_suppliers";
import { registerCoupleSupplierRoutes } from "./routes/couple_suppliers";
import { registerDemoRoutes, runDemoBootSweep } from "./routes/demo";
import { registerDocumentArchiveRoutes } from "./routes/document_archive";
import { registerEmailChangeRoutes } from "./routes/email_change";
import { registerEmailPrefsRoutes } from "./routes/email_prefs";
import { registerEmailTrackRoutes } from "./routes/email_track";
import { registerCoupleCardsRoutes } from "./routes/couple_cards";
import { registerEmailVerifyRoutes } from "./routes/email_verify";
import { registerExportRoutes } from "./routes/export";
import { registerFeedbackRoutes } from "./routes/feedback";
import { registerGoogleCalendarRoutes } from "./routes/google_calendar";
import { registerVendorGoogleCalendarRoutes } from "./routes/vendor_google_calendar";
import { registerGrowthRoutes } from "./routes/growth";
import { registerGuestMessagesRoutes } from "./routes/guest_messages";
import { registerGuestRoutes } from "./routes/guests";
import { registerVendorClaimRoutes } from "./routes/vendor_claim";
import { registerVendorOnboardingRoutes } from "./routes/vendor_onboarding";
import { registerVendorRegisterRoutes } from "./routes/vendor_register";
import { registerVendorListingRoutes } from "./routes/vendor_listing";
import { registerVendorAccountRoutes } from "./routes/vendor_account";
import { registerVendorAvailabilityRoutes } from "./routes/vendor_availability";
import { registerVendorClientsRoutes } from "./routes/vendor_clients";
import { registerAiAssistRoutes } from "./routes/ai_assist";
import { registerBookingMessageRoutes } from "./routes/booking_messages";
import { registerBookingQuoteRoutes } from "./routes/booking_quotes";
import { registerDateHoldRoutes } from "./routes/date_holds";
import { backfillLegacyBookingNotes } from "./domain/booking_messages";
import { backfillNameReview, nameReviewBlock } from "./domain/name_review";
import { registerVendorPointsRoutes } from "./routes/vendor_points";
import { registerVendorStatsRoutes } from "./routes/vendor_stats";
import { registerVendorRevenueRoutes } from "./routes/vendor_revenue";
import { registerVendorTaskRoutes } from "./routes/vendor_tasks";
import { registerVendorAutomationRoutes } from "./routes/vendor_automations";
import { startVendorAutomationWorker } from "./domain/vendor_automations";
import { registerPlannerBillingRoutes } from "./routes/planner_billing";
import { registerVendorBillingRoutes } from "./routes/vendor_billing";
import { registerHealthRoutes } from "./routes/health";
import { registerHoneymoonRoutes } from "./routes/honeymoon";
import { registerHouseholdRoutes } from "./routes/households";
import { registerMoodboardRoutes } from "./routes/moodboard";
import { registerNewsletterRoutes } from "./routes/newsletter";
import { registerNotificationRoutes } from "./routes/notifications";
import { registerPasswordResetRoutes } from "./routes/password_reset";
import { registerPlacesRoutes } from "./routes/places";
import { registerPlanningRoutes } from "./routes/planning";
import { registerPrintRoutes } from "./routes/print";
import { registerPublicStatsRoutes } from "./routes/public_stats";
import { registerPublicWeddingRoutes } from "./routes/public_wedding";
import { registerPhotoRoutes } from "./routes/photos";
import { registerRsvpRoutes } from "./routes/rsvp";
import { registerScheduleRoutes } from "./routes/schedule";
import { registerSeatingRoutes } from "./routes/seating";
import { registerSeoRoutes } from "./routes/seo";
import { registerTransferRoutes } from "./routes/transfers";
import { registerSupplierCostRoutes } from "./routes/supplier_costs";
import { registerSupplierReviewRoutes } from "./routes/supplier_reviews";
import { registerSupplierCommentRoutes } from "./routes/supplier_comments";
import { registerSupplierBookingRoutes } from "./routes/supplier_bookings";
import { registerOutreachRoutes } from "./routes/outreach";
import { registerSupplierRoutes } from "./routes/suppliers";
import { registerSupplierTaxonomyRoutes } from "./routes/supplier_taxonomy";
import { retireLegacyTaxonomy, seedSupplierTaxonomy } from "./domain/supplier_taxonomy";
import { backfillListings } from "./domain/listings";
import { backfillPartnerPropagation, reconcileWishlistSectionFlag } from "./domain/couples";
import { seedDoNotContact } from "./domain/emails/optouts";
import { ensureDefaultSchedules } from "./domain/campaign_schedules";
import { reconcileOrphanCouples } from "./domain/orphan_reconcile";
import {
  backfillPlannerProfilesFromWaitlist,
  backfillWaitlistPlannerConversions,
} from "./domain/planner_conversion";
import { registerUserCoupleRoutes } from "./routes/user_couple";
import { registerUserProfileRoutes } from "./routes/user_profile";
import { backfillIncomeIntoReceivedGifts } from "./domain/received_gifts";
import { registerReceivedGiftsRoutes } from "./routes/received_gifts";
import { registerWishlistRoutes } from "./routes/wishlist";

seedSupplierTaxonomy();
retireLegacyTaxonomy();
// First-boot seed of the public blog. Idempotent — short-circuits when
// the table already has rows so subsequent reboots don't touch DB state.
seedBlogPostsIfEmpty();
// Boot-time mirror of suppliers_data.ts + community_suppliers into the
// unified `listings` table. Idempotent; content_hash short-circuit means
// unchanged rows are no-ops on every subsequent boot.
{
  const counts = backfillListings();
  log.info("listings.backfill", counts);
}
// Suppress every address that has asked us in writing never to be contacted
// again (domain/emails/optouts.ts). Idempotent INSERT OR IGNORE, so it runs on
// every boot and needs no SQL against the production volume.
seedDoNotContact();
// Seed the standing campaign plan (one schedule per campaign family) so the
// console has something to show and the first sweep can compose the first
// round. Idempotent; an operator's tuned interval / cap is never overwritten.
{
  const created = ensureDefaultSchedules();
  if (created > 0) log.info("campaign_schedules.seeded", { created });
}
// Mirror each couple's invited partner across all of that owner's event-
// workspaces (membership only, billing-neutral, idempotent). Fixes existing
// couples whose partner only ever joined their first event so every workspace
// under one account carries the pair. New joins/creates keep it in sync inline.
{
  const owners = backfillPartnerPropagation();
  log.info("partners.backfill", { owners });
}
// Split the legacy supplier_bookings.notes blob into real message rows so the
// new thread opens with the conversation that already happened rather than
// blank. Skips any booking that already has a message, which is what makes it
// idempotent and safe against an inquiry landing between deploy and boot.
backfillLegacyBookingNotes();
// Fold the budget page's old money-in table into the wishlist's received-gifts
// ledger, which is the single source of truth for "what came in" now. Without
// this, every cash gift a couple logged on the budget page vanishes from the
// page that reports it. Idempotent via the UNIQUE income_id index, so this is
// safe on every boot and empties out after the first pass.
{
  const { carried } = backfillIncomeIntoReceivedGifts();
  if (carried > 0) log.info("received_gifts.income_carryover", { carried });
}
// The gift list is one switch now (couples.wishlist_published), so retire the
// second one: any couple still carrying the "wishlist" slug in their design's
// hidden-sections list has it stripped and their publish flag pinned to the
// state their guests already see (off). Idempotent, no-op after the first pass.
{
  const reconciled = reconcileWishlistSectionFlag();
  if (reconciled > 0) log.info("wishlist.section_flag_reconcile", { reconciled });
}
// Notice which workspaces are named after nobody ("x & y", "NŐ & FÉRFI",
// "Bridee & Groomy") and start their three-day clock. Idempotent: an already
// flagged couple keeps its original timestamp, and one that has since been
// fixed is un-flagged here, so the cohort only ever shrinks on its own.
{
  const { flagged, cleared } = backfillNameReview();
  if (flagged > 0 || cleared > 0) log.info("name_review.backfill", { flagged, cleared });
}
// Put every founding verdict on the workspace that can actually spend it. Runs
// AFTER partners.backfill so an anchor that just gained its partner_b_id is
// eligible on this same pass. Heals badges stranded on a secondary by the
// pre-anchor grant (2026-07-06) or by an anchor shift, and grants to anchors
// that hold both partners but no verdict. Slot-neutral and idempotent.
{
  const { moved, granted } = backfillFoundingAnchor();
  if (moved > 0 || granted > 0) log.info("founding.anchor_backfill", { moved, granted });
}
// Reconcile orphaned workspaces: a couple with no member resolvable to a live
// user (e.g. a hard-deleted owner, or a pre-fix non-atomic create that half-
// committed) is unrecoverable, so purge it. Runs AFTER partners.backfill so a
// couple whose owner still exists has its membership healed first and is not
// mistaken for an orphan.
{
  const reconciled = reconcileOrphanCouples();
  if (reconciled > 0) log.info("couples.orphan_reconcile", { reconciled });
}
// Heal accepted planner applicants who landed on a plain couple account instead
// of a planner (the "Regisztrációra vár" mis-route). Account only, idempotent,
// billing-neutral to couple data. New approvals go through the gated
// provision/convert path in admin_planners.ts.
{
  const converted = backfillWaitlistPlannerConversions();
  log.info("planner.convert_backfill", { converted });
  // Heal already-planner accounts whose public profile stayed blank (seeded
  // before profile-seeding existed) so their directory card shows the info they
  // gave on their application (company, city, styles, website).
  const seeded = backfillPlannerProfilesFromWaitlist();
  log.info("planner.profile_backfill", { seeded });
}

const router = new Router();
registerHealthRoutes(router);
registerAuthRoutes(router);
registerAuthGoogleRoutes(router);
registerAuthAppleRoutes(router);
registerPasswordResetRoutes(router);
registerEmailVerifyRoutes(router);
registerEmailChangeRoutes(router);
registerEmailPrefsRoutes(router);
registerEmailTrackRoutes(router);
registerCoupleRoutes(router);
registerCouplePauseRoutes(router);
registerBillingRoutes(router);
registerReferralRoutes(router);
registerExportRoutes(router);
registerDocumentArchiveRoutes(router);
registerGuestRoutes(router);
registerGuestMessagesRoutes(router);
registerHouseholdRoutes(router);
registerBlogRoutes(router);
registerBudgetRoutes(router);
registerBudgetDocumentRoutes(router);
registerBudgetPaymentRoutes(router);
registerIncomeRoutes(router);
registerHoneymoonRoutes(router);
registerMoodboardRoutes(router);
registerNewsletterRoutes(router);
registerNotificationRoutes(router);
registerPlacesRoutes(router);
registerPlanningRoutes(router);
registerPhotoRoutes(router);
registerRsvpRoutes(router);
registerPublicStatsRoutes(router);
registerPublicWeddingRoutes(router);
registerScheduleRoutes(router);
registerWishlistRoutes(router);
registerReceivedGiftsRoutes(router);
registerSeatingRoutes(router);
registerAccommodationRoutes(router);
registerTransferRoutes(router);
registerPrintRoutes(router);
registerSupplierRoutes(router);
registerSupplierTaxonomyRoutes(router);
registerSupplierCostRoutes(router);
registerSupplierReviewRoutes(router);
registerSupplierCommentRoutes(router);
registerSupplierBookingRoutes(router);
registerCommunitySupplierRoutes(router);
registerVerifiedVisitorRoutes(router);
registerCoupleSupplierRoutes(router);
registerCouplePickRoutes(router);
registerSavedSupplierRoutes(router);
registerCompanyLookupRoutes(router);
registerTranslateRoutes(router);
registerGeoRoutes(router);
registerOutreachRoutes(router);
registerAdminSupplierRoutes(router);
registerAdminReviewRoutes(router);
registerAdminUserRoutes(router);
registerAdminVendorRoutes(router);
registerAdminVendorCampaignRoutes(router);
registerAdminVendorReviewCampaignRoutes(router);
registerAdminPersonalInviteCampaignRoutes(router);
registerAdminOnboardingCampaignRoutes(router);
registerAdminCampaignScheduleRoutes(router);
registerAdminPlannerRoutes(router);
registerAdminAnalyticsRoutes(router);
registerAdminEmailListRoutes(router);
registerAdminEmailPreviewRoutes(router);
registerAdminFinancialPlannerRoutes(router);
registerVendorWaitlistRoutes(router);
registerPlannerWaitlistRoutes(router);
registerPlannerRoutes(router);
registerPlannerEventsRoutes(router);
registerPlannerPointsRoutes(router);
registerPlannerActivationRoutes(router);
registerUserCoupleRoutes(router);
registerUserProfileRoutes(router);
registerFeedbackRoutes(router);
registerCoupleCardsRoutes(router);
registerGoogleCalendarRoutes(router);
registerVendorGoogleCalendarRoutes(router);
registerGrowthRoutes(router);
registerVendorClaimRoutes(router);
registerVendorOnboardingRoutes(router);
registerVendorRegisterRoutes(router);
registerVendorListingRoutes(router);
registerVendorAccountRoutes(router);
registerVendorAvailabilityRoutes(router);
registerVendorClientsRoutes(router);
registerAiAssistRoutes(router);
registerBookingMessageRoutes(router);
registerBookingQuoteRoutes(router);
registerDateHoldRoutes(router);
registerVendorStatsRoutes(router);
registerVendorRevenueRoutes(router);
registerVendorPointsRoutes(router);
registerVendorTaskRoutes(router);
registerVendorAutomationRoutes(router);
registerVendorBillingRoutes(router);
registerPlannerBillingRoutes(router);
registerSeoRoutes(router);
registerDemoRoutes(router);

const IS_PROD = process.env.NODE_ENV === "production";

// CSP: Vite emits hashed assets so `'self'` covers our JS/CSS. Plausible script
// is loaded from plausible.io; Sentry browser SDK posts to *.sentry.io. The
// landing pulls Inter from rsms.me + Cormorant Garamond from fonts.googleapis.com,
// so those origins are whitelisted for fonts and stylesheets.
const CSP = [
  "default-src 'self'",
  // Google Identity Services script (https://accounts.google.com/gsi/client)
  // is loaded from the login/register pages to render the "Continue with
  // Google" button. The GSI client also pulls a second script from
  // gstatic.com, so both origins need to be whitelisted.
  // www.googletagmanager.com serves gtm.js and (when GA4 is wired up inside
  // the GTM container) the gtag/js library it injects. Activated only when
  // GTM_CONTAINER_ID is set; the origins stay whitelisted regardless so the
  // header is identical across deploys.
  // Sign in with Apple JS (https://appleid.cdn-apple.com/appleauth/static/jsapi/
  // appleid/1/<locale>/appleid.auth.js) renders the "Continue with Apple"
  // button + drives the popup, so its CDN origin needs script + style here.
  // GTM_INLINE_CSP_HASH allow-lists the one inline GTM bootstrap snippet (the
  // dataLayer `gtm.js` push) without opening the policy to 'unsafe-inline'.
  // Harmless when GTM is disabled — it just allow-lists a script that never
  // appears in the page.
  // Cookiebot consent manager loads uc.js from consent.cookiebot.com and the
  // banner UI from consentcdn.cookiebot.com; without both the cookie banner
  // (and therefore every consent-gated analytics script) silently fails to
  // load. Microsoft Clarity loads its tag from www.clarity.ms.
  // Usercentrics Web CMP loads its loader/UI from web.cmp.usercentrics.eu and
  // pulls config/assets from *.usercentrics.eu; it runs alongside Cookiebot
  // during the trial evaluation.
  `script-src 'self' ${GTM_INLINE_CSP_HASH}${GA4_CSP_HASHES ? " " + GA4_CSP_HASHES : ""} https://plausible.io https://accounts.google.com https://apis.google.com https://www.gstatic.com https://www.googletagmanager.com https://appleid.cdn-apple.com https://consent.cookiebot.com https://consentcdn.cookiebot.com https://www.clarity.ms https://web.cmp.usercentrics.eu https://*.usercentrics.eu`,
  "style-src 'self' 'unsafe-inline' https://rsms.me https://fonts.googleapis.com https://accounts.google.com https://appleid.cdn-apple.com",
  // Tile servers for the supplier map (Leaflet on /app/suppliers). The
  // tile.openstreetmap.org subdomain pool serves the raster tiles.
  // *.basemaps.cartocdn.com serves the CARTO Voyager basemap used by the guest
  // page's venue map (components/VenueMap.tsx): a softer, warmer style than
  // raw OSM, keyless, free at this volume.
  // *.pinimg.com hosts the Pinterest pin thumbnails rendered by /app/moodboard —
  // the URLs come from the backend's RSS proxy, so only image origins need
  // whitelisting (no Pinterest script/iframe).
  // GA4 (via GTM) falls back to image-pixel beacons in some browsers and the
  // googletagmanager origin serves a 1x1 too, so both need img-src.
  // commons.wikimedia.org + upload.wikimedia.org host the freely-licensed
  // venue photos embedded in blog posts (img blocks). commons.* serves the
  // Special:FilePath redirect; upload.* is the redirect target the browser
  // actually fetches the bytes from, so both origins must be whitelisted.
  // images.unsplash.com hosts the default cover photos referenced from
  // DEFAULT_PHOTO_BY_SLUG in BlogCoverArt — without this the SVG <image>
  // tag is blocked and every default blog cover falls back to the paper
  // composition.
  // img.youtube.com + i.ytimg.com host the vendor video-reel poster thumbnails
  // (hqdefault.jpg) shown before the click-to-play iframe on supplier detail
  // pages; img.youtube.com 302s to i.ytimg.com, so both origins are needed.
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.basemaps.cartocdn.com https://*.pinimg.com https://*.googleusercontent.com https://www.googletagmanager.com https://*.google-analytics.com https://commons.wikimedia.org https://upload.wikimedia.org https://images.unsplash.com https://imgsct.cookiebot.com https://*.clarity.ms https://c.bing.com https://*.usercentrics.eu https://img.youtube.com https://i.ytimg.com",
  "font-src 'self' data: https://rsms.me https://fonts.gstatic.com",
  // GA4 sends its `collect` hits via fetch/sendBeacon to *.google-analytics.com
  // (incl. region1.google-analytics.com) and *.analytics.google.com; gtm.js may
  // also XHR the container config from googletagmanager.com.
  // appleid.apple.com is the authorization origin the Sign in with Apple JS
  // XHRs against while it runs the popup handshake.
  // Cookiebot XHRs the consent state from consentcdn.cookiebot.com; Microsoft
  // Clarity beacons session data to *.clarity.ms and syncs the MUID via
  // c.bing.com.
  // Usercentrics fetches its settings + records consent against *.usercentrics.eu
  // and its consent runtime endpoints on *.service.consent.dev.
  "connect-src 'self' https://plausible.io https://*.sentry.io https://rsms.me https://accounts.google.com https://www.googletagmanager.com https://*.google-analytics.com https://*.analytics.google.com https://appleid.apple.com https://consentcdn.cookiebot.com https://*.clarity.ms https://c.bing.com https://*.usercentrics.eu https://*.service.consent.dev",
  // OSM's /export/embed.html is iframed by the honeymoon map modal.
  // `blob:` is for the /app/seating PDF preview modal — the generated chart
  // is handed to <iframe src="blob:..."> so the browser's native PDF viewer
  // renders it inline. Without blob: in frame-src the iframe loads blank.
  // accounts.google.com renders the GSI one-tap / button iframe.
  // appleid.apple.com renders the Sign in with Apple popup/iframe.
  // youtube-nocookie.com (privacy-mode) + youtube.com host the vendor
  // reference-video embeds on supplier detail pages; the nocookie host serves
  // the iframe but redirects some players through www.youtube.com, so both are
  // whitelisted.
  "frame-src https://www.openstreetmap.org https://accounts.google.com https://appleid.apple.com https://consentcdn.cookiebot.com https://*.usercentrics.eu https://www.youtube-nocookie.com https://www.youtube.com blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // No plugins/<object>/<embed>. default-src 'self' already covers the fallback;
  // this is the explicit, standard hardening directive.
  "object-src 'none'",
].join("; ");

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // identity-credentials-get is the Permissions-Policy feature gate FedCM
  // checks before letting the Google One Tap prompt issue a credential.
  // Without it Chrome 117+ silently rejects gsi.prompt() with a CORS-ish
  // console error and the One Tap dialog never appears.
  "Permissions-Policy":
    "geolocation=(self), microphone=(), camera=(), identity-credentials-get=(self)",
  "Content-Security-Policy": CSP,
  ...(IS_PROD ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};

const FRONTEND_DIST = join(import.meta.dir, "..", "..", "frontend", "dist");
const FRONTEND_INDEX = join(FRONTEND_DIST, "index.html");

function clientIpFrom(req: Request): string | null {
  // Test override: parallel test cases (and the load harness) need a unique IP
  // per simulated user so they don't fight over one 5-token auth bucket.
  // NEVER honoured in production — otherwise any client could rotate this
  // header per request and bypass every per-IP auth rate limit.
  if (!IS_PROD) {
    const testIp = req.headers.get("x-test-client-ip");
    if (testIp) return testIp;
  }
  // Trust only the hop appended by our own edge proxy, never the leftmost
  // X-Forwarded-For entry. XFF is client-appendable: a request arriving with
  // `X-Forwarded-For: <spoofed>` is rewritten by Railway's edge to
  // `<spoofed>, <real-client>`, so the LAST entry is the address the trusted
  // proxy actually saw. Taking `split(",")[0]` would let a client rotate the
  // header per request and mint a fresh rate-limit bucket every time,
  // defeating per-IP brute-force throttling. Prefer X-Real-IP (proxy-set,
  // not appendable) and fall back to the rightmost XFF hop.
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",");
    return hops[hops.length - 1]?.trim() ?? null;
  }
  return null;
}

// Memoised index.html sources, one per SEO locale. The Vite build emits
// `index.html` (HU body, written by frontend/scripts/prerender.ts) and
// `index.en.html` (EN body). Each variant already has the locale's landing
// copy baked into `<div id="root">` so crawlers and the pre-hydration paint
// see real content; the per-request renderer (renderIndexHtml) then splices
// a host-aware <head> block on top with the right canonical, hreflang, and
// og tags.
const indexHtmlSources: Partial<Record<"hu" | "en", string>> = {};
const FRONTEND_INDEX_EN = join(FRONTEND_DIST, "index.en.html");
async function loadIndexHtmlSource(locale: "hu" | "en"): Promise<string> {
  const cached = indexHtmlSources[locale];
  if (cached !== undefined) return cached;
  const path =
    locale === "en" && existsSync(FRONTEND_INDEX_EN) ? FRONTEND_INDEX_EN : FRONTEND_INDEX;
  const text = await Bun.file(path).text();
  indexHtmlSources[locale] = text;
  return text;
}

function isRsvpRoute(pathname: string): boolean {
  return pathname === "/rsvp" || pathname.startsWith("/rsvp/");
}

/** Strip capability tokens that travel in the URL path before the path is
 *  written to request logs or attached to Sentry. An un-consumed token in a log
 *  line (forwarded to a third-party log service) is a replayable credential —
 *  this covers email verify/change, photo-album links, planner activation,
 *  couple + vendor invites, listing claim, and opt-out generically. Route shape
 *  is preserved. Password reset is unaffected — its token rides in the JSON
 *  body, which is never logged. See lib/log_redact.ts. */
const redactPath = redactTokensInPath;

/** decodeURIComponent that returns null on malformed percent-encoding (e.g.
 *  `%ZZ`) instead of throwing a URIError. This path runs OUTSIDE the request
 *  try/catch, so an uncaught throw here would emit a 500 with none of the
 *  security headers / request id every other response carries. */
function safeDecodeURIComponent(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Boundary check that resolved `child` stays within `base`, treated as a
 *  directory. The trailing separator stops sibling-directory confusion:
 *  `/data/uploads-secret` must NOT pass a `/data/uploads` prefix test. */
function isInsideDir(child: string, base: string): boolean {
  const withSep = base.endsWith(sep) ? base : base + sep;
  return child === base || child.startsWith(withSep);
}

async function tryServeStatic(req: Request, pathname: string): Promise<Response | null> {
  if (pathname.startsWith("/api/")) return null;

  // User-uploaded files (vendor hero images, couple photos, blog covers, …).
  // Served BEFORE the SPA/SERVE_FRONTEND guard because uploads are addressed
  // by a stable `/uploads/<key>` URL whether they live on the persistent
  // /data volume (disk driver) or in Cloudflare R2 (r2 driver) — see
  // `lib/storage.ts`. Traversal guard: decode BEFORE the `..` check so
  // percent-encoded traversal (`%2e%2e`) can't slip past it, then hand the
  // canonical key to the storage backend. Query strings (the `?v=<timestamp>`
  // cache-bust suffix) are already stripped by keyFromUploadUrl.
  if (pathname.startsWith("/uploads/")) {
    const cleanPath = pathname.split("?")[0] ?? pathname;
    const rel = cleanPath.slice("/uploads/".length);
    const decodedRel = rel ? safeDecodeURIComponent(rel) : null;
    if (!decodedRel || decodedRel.includes("..")) return null;
    // Private financial documents (invoices/receipts) are NOT public-by-URL like
    // photos/moodboard images. They are couple-scoped behind the authenticated
    // /api/budget/documents/:id/download route; refuse them here so an old
    // public URL (or an id-enumeration probe) can't read another couple's files.
    // Message attachments are the same case: a quote or a contract a vendor
    // sent one couple, readable only through /api/booking-messages/attachments.
    // A waitlist price list is the same case again, and was the sharpest of the
    // three: it is a business's confidential commercial terms, it is only ever
    // shown on /app/admin/vendor-waitlist, and its key is built from a
    // SEQUENTIAL row id (`vendor_waitlist/<id>/price_list.<ext>`), so before
    // this line every applicant's pricing could be walked one integer at a time
    // by a stranger with no account. It streams from
    // /api/admin/vendor-waitlist/:id/price-list instead.
    //
    // This list is a DENYLIST, so a new private upload category is public until
    // someone remembers to add it here. Adding a `storage.write` key that a
    // stranger should not be able to guess means adding its prefix in the same
    // commit. Guarded by uploads_private_prefixes.e2e.test.ts.
    if (
      decodedRel.includes("/budget-docs/") ||
      decodedRel.includes("/budget-payments/") ||
      decodedRel.includes("/booking-messages/") ||
      decodedRel.startsWith("vendor_waitlist/")
    )
      return null;
    const key = keyFromUploadUrl(decodedRel);
    if (!key) return null;
    return storage.serve(key);
  }

  if (!CONFIG.serveFrontend) return null;

  const host = req.headers.get("host");

  // /robots.txt and /sitemap.xml are served by registerSeoRoutes (above the
  // SPA fallback in route order), so we don't try to short-circuit them here.

  // Direct file hit (assets in frontend/dist/assets/, OG images, the favicon, …).
  // Vite emits content-hashed filenames into /assets/, so those URLs are
  // immutable for the lifetime of the build — cache them aggressively. Other
  // top-level statics (favicon, og.png, logo.png) can change without a URL
  // change, so they get a short cache instead.
  const decodedPathname = safeDecodeURIComponent(pathname);
  if (decodedPathname === null) return null;
  const filePath = join(FRONTEND_DIST, decodedPathname);
  if (isInsideDir(filePath, FRONTEND_DIST) && existsSync(filePath)) {
    const f = Bun.file(filePath);
    if (await f.exists()) {
      const isHashedAsset = pathname.startsWith("/assets/");
      const cacheHeader = isHashedAsset
        ? "public, max-age=31536000, immutable"
        : "public, max-age=300";
      // Prefer a precompressed sibling (frontend/scripts/precompress.ts emits
      // `<name>.br` / `<name>.gz` for text assets at build time) so we never
      // brotli a megabyte bundle per request. Serving the sibling means we
      // must set the ORIGINAL file's Content-Type by hand (Bun would infer
      // `application/octet-stream` from the `.br`/`.gz` extension) plus the
      // Content-Encoding so the browser decodes it.
      const enc = negotiateEncoding(req.headers.get("accept-encoding"));
      if (enc) {
        const sibling = `${filePath}.${enc === "br" ? "br" : "gz"}`;
        if (existsSync(sibling)) {
          const sf = Bun.file(sibling);
          if (await sf.exists()) {
            return new Response(sf, {
              headers: {
                "Cache-Control": cacheHeader,
                "Content-Type": f.type || "application/octet-stream",
                "Content-Encoding": enc,
                Vary: "Accept-Encoding",
              },
            });
          }
        }
      }
      return new Response(f, { headers: { "Cache-Control": cacheHeader } });
    }
  }

  // SPA fallback for unknown routes — let React Router resolve client-side.
  // The HTML must NOT be cached by browsers/CDNs: every deploy ships a new
  // index.html (with refreshed asset hashes and any pre-hydration SSR body
  // changes), and stale HTML means users see old chunks 404 and old SSR
  // flashes long after the fix has shipped.
  if (existsSync(FRONTEND_INDEX)) {
    // EN is the default for every production request — the visitor's
    // Accept-Language header is intentionally NOT forwarded to the SSR
    // renderer, so an HU navigator still gets the EN SSR. The client
    // re-renders HU on hydration only when the user has explicitly
    // picked HU via the locale switcher (saved to localStorage). The
    // renderer's HU branch is still exercised by tests + internal
    // callers that pass `acceptLanguage` explicitly.
    const locale = localeForHost(host, null);
    const template = await loadIndexHtmlSource(locale);
    const html = renderIndexHtml(template, {
      host,
      pathname,
      isRsvp: isRsvpRoute(pathname),
      acceptLanguage: null,
    });
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  }
  return null;
}

// Domains we redirect to the canonical apex host. June 2026 cutover moved the
// apex from weddly.hu to tryweddly.com: weddly.hu (+ www), weddly.xyz (+ www),
// and www.tryweddly.com all bounce to the bare tryweddly.com apex so every
// public URL (canonical, sitemap, OG, email link) resolves to one host. The
// redirect runs ahead of every other handler so even an /api/* call is bounced
// — third-party integrations have to update their base URL.
const LEGACY_HOSTS = new Set([
  "weddly.hu",
  "www.weddly.hu",
  "weddly.xyz",
  "www.weddly.xyz",
  "www.tryweddly.com",
]);
const CANONICAL_HOST = "tryweddly.com";

// 301 strips POST bodies (most clients downgrade to GET). 308 preserves the
// method + body, which matters for `/api/*` POSTs from third-party
// integrations that may still hit the legacy host while their config drifts.
// For browser-facing GET/HEAD navigations we keep 301 so the browser caches
// the redirect aggressively (308's cache semantics are weaker in practice).
const PRESERVE_METHOD = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const start = performance.now();

  // Legacy-host redirect — runs before CORS preflight handling so even an
  // OPTIONS probe gets bounced. Preserves the path + query so a guest
  // arriving at https://weddly.xyz/rsvp/ABC1234 ends up at the .hu mirror.
  // Use `url.hostname` rather than the raw `Host` header so a `:port`
  // suffix (e.g. on a non-standard reverse-proxy setup) doesn't sneak
  // past the allowlist. URL.hostname is always lowercased + port-free.
  if (LEGACY_HOSTS.has(url.hostname.toLowerCase())) {
    const target = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
    const status = PRESERVE_METHOD.has(req.method) ? 308 : 301;
    return new Response(null, {
      status,
      headers: { Location: target, "Cache-Control": "public, max-age=3600" },
    });
  }

  // Singular-typo redirect — /planner → /planners (permanent, browser-cached).
  if (url.pathname === "/planner") {
    return new Response(null, {
      status: 301,
      headers: { Location: `/planners${url.search}`, "Cache-Control": "public, max-age=3600" },
    });
  }

  if (req.method === "OPTIONS") return corsPreflight(req);

  const cors = corsHeaders(req.headers.get("origin"));

  const matched = router.match(req.method, url.pathname);
  if (!matched) {
    const fallback = await tryServeStatic(req, url.pathname);
    if (fallback) {
      const headers = new Headers(fallback.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      headers.set("x-request-id", requestId);
      return new Response(fallback.body, { status: fallback.status, headers });
    }
    const r = httpErr(404, "Not found");
    const headers = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("x-request-id", requestId);
    return new Response(r.body, { status: r.status, headers });
  }

  // Auth middleware: verify the bearer token if present, leave userId null otherwise.
  let userId: number | null = null;
  const token = extractToken(req);
  if (token) userId = verifySessionToken(token);

  if (matched.route.requireAuth && userId === null) {
    const r = httpErr(401, "Not authenticated");
    const headers = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("x-request-id", requestId);
    return new Response(r.body, { status: r.status, headers });
  }

  // Billing read-only gate: a couple whose trial/founding window has lapsed
  // (and who isn't subscribed) may view + export but not edit the workspace.
  // Mutating requests to the edit surfaces get 402 with the billing reason so
  // the frontend can show the "subscription needed" prompt.
  const blockReason =
    entitlementBlock(req.method, url.pathname, userId) ??
    vendorEntitlementBlock(req.method, url.pathname, userId) ??
    plannerEntitlementBlock(req.method, url.pathname, userId);
  if (blockReason) {
    const r = httpErr(402, "Subscription required", {
      code: "subscription_required",
      reason: blockReason,
    });
    const headers = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("x-request-id", requestId);
    return new Response(r.body, { status: r.status, headers });
  }

  // Real-name gate: a workspace whose partner names are placeholders was given
  // three days' notice and did nothing, so the same edit surfaces go read-only.
  // 409 rather than 402: this is not about money, and the frontend routes the
  // two to completely different screens. PATCH /api/couples/current stays open,
  // which is the whole point: the fix is one field away.
  const nameBlock = nameReviewBlock(req.method, url.pathname, userId);
  if (nameBlock) {
    const r = httpErr(409, "Confirm the names on your workspace", {
      code: "name_review_required",
      fields: nameBlock.fields,
      deadline: nameBlock.deadline,
    });
    const headers = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("x-request-id", requestId);
    return new Response(r.body, { status: r.status, headers });
  }

  const safeRoute = redactPath(url.pathname);
  const reqLog = makeLogger({
    requestId,
    method: req.method,
    route: safeRoute,
    ...(userId != null ? { userId } : {}),
  });

  const ctx: Ctx = {
    req,
    url,
    params: matched.params,
    userId,
    clientIp: clientIpFrom(req),
    requestId,
    log: reqLog,
  };

  try {
    const res = await matched.route.handler(ctx);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("x-request-id", requestId);
    reqLog.info("http.request", {
      status: res.status,
      latency_ms: Math.round(performance.now() - start),
    });
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    const isHttpErr = e instanceof HttpError;
    const r = isHttpErr
      ? httpErr(e.status, e.message, e.extra)
      : httpErr(500, "Internal server error");
    const headers = new Headers(r.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set("x-request-id", requestId);
    const latency_ms = Math.round(performance.now() - start);
    if (isHttpErr) {
      reqLog.warn("http.handled_error", { status: e.status, message: e.message, latency_ms });
    } else {
      reqLog.error("http.unhandled", e, { latency_ms });
      captureException(e, {
        requestId,
        userId,
        route: safeRoute,
        method: req.method,
      });
    }
    return new Response(r.body, { status: r.status, headers });
  }
}

const server = Bun.serve({
  port: CONFIG.port,
  // Hard ceiling on the request body the runtime will buffer. Per-handler
  // length caps (4 MB cover images, 1 MB CSV import, small JSON bodies) only
  // fire AFTER formData()/json()/text() has materialized the whole body, so
  // without this a client could push ~128 MB (Bun's default) per request and
  // exhaust memory on the single instance. 8 MB clears the largest legitimate
  // upload (a 4 MB image plus multipart overhead) with headroom.
  maxRequestBodySize: 8 * 1024 * 1024,
  async fetch(req) {
    inflightRequests++;
    try {
      return await serveOne(req);
    } finally {
      inflightRequests--;
    }
  },
});

// Counts requests currently inside serveOne. The SIGTERM drain below waits on
// this so a redeploy never cuts a response off mid-write.
let inflightRequests = 0;

async function serveOne(req: Request): Promise<Response> {
  let res: Response;
  try {
    res = await handleRequest(req);
  } catch (e) {
    // Last-resort guard: a throw from OUTSIDE handleRequest's own try/catch
    // (e.g. the static/SSR fallback path, which runs before the handler try)
    // would otherwise surface as Bun's default 500 with none of our security
    // headers or request id. Emit a sanitized 500 instead.
    captureException(e, { route: new URL(req.url).pathname, method: req.method });
    res = httpErr(500, "Internal server error");
  }
  // Compress dynamic text responses (SSR HTML, JSON, sitemap/robots/llms).
  // Static assets are served from precompressed siblings inside
  // handleRequest and already carry Content-Encoding, so this is a no-op
  // for them. See lib/compression.ts.
  res = await maybeCompress(req, res);
  // Belt-and-suspenders: guarantee the baseline security headers on EVERY
  // response. The success + static branches in handleRequest already set them;
  // the error branches (401/402/404/500) only set CORS, and the redirect/
  // fallback paths set nothing — this closes that gap in one place.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

// Graceful shutdown. Railway sends SIGTERM on every redeploy/restart and keeps
// the old container alive alongside the new one for 20s (overlapSeconds in
// railway.json). Without a handler Bun dies instantly and any in-flight
// request surfaces as a 502 at the edge. Here we stop accepting new
// connections, let in-flight requests drain (10s cap, well inside the 20s
// overlap), then close SQLite cleanly so the WAL is checkpointed.
if (process.env.NODE_ENV !== "test") {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info("server.shutdown.begin", { signal, inflight: inflightRequests });
    server.stop(); // refuse new connections; in-flight requests keep running
    const deadline = Date.now() + 10_000;
    while (inflightRequests > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (inflightRequests > 0) {
      log.warn("server.shutdown.drain_timeout", { inflight: inflightRequests });
    }
    db.close();
    log.info("server.shutdown.done", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

// Pause-to-delete sweep — only in real environments. Tests drive it directly.
if (process.env.NODE_ENV !== "test") {
  startPurgeWorker();
  startEmailWorker();
  // Periodic SQLite → R2 disaster-recovery backups. No-op unless R2 is
  // configured and R2_BACKUP_INTERVAL_HOURS > 0.
  startBackupWorker();
  // Reconcile couples' Google Calendars whose events changed. No-op unless the
  // Google Calendar integration is configured (GOOGLE_CALENDAR_ENABLED).
  startGoogleCalendarWorker();
  // Drain vendor domain events into the Weddly Points ledger, then replay what
  // existing reviews / bookings / profiles would have earned. The backfill is
  // idempotent (dedupe_key), so booting twice awards nothing twice.
  startVendorPointsWorker();
  backfillVendorPoints();
  // Vendor automations: acknowledge new inquiries, remind about unanswered ones,
  // queue post-wedding review requests for the vendor to approve. Every send is
  // behind a dedupe reservation, so a boot in the middle of a sweep re-sends
  // nothing, and an account with nothing armed costs one indexed query.
  startVendorAutomationWorker();
  // Same pair for the planner ledger: drain the planner outbox, then replay what
  // existing profiles / reviews / client links / accepted invitations would have
  // earned. Idempotent through dedupe_key, so booting twice awards nothing twice.
  startPlannerPointsWorker();
  backfillPlannerPoints();
  // Tidy any abandoned demo couples left over from a previous boot — keeps
  // the table sparse even when /api/demo/start hasn't been hit in days.
  runDemoBootSweep();
  // One-time sweep: resolve og:image thumbnails for wishlist rows that have a
  // link but no image (created before link-preview shipped). Non-blocking and
  // self-limiting — each row is attempted exactly once. See the module header.
  startWishlistImageBackfill();
  // One-time sweep: auto-fill supplier listing heroes from each venue's own
  // website (og:image). Curated venues ship without a photo; this gives their
  // card a real image instead of the icon placeholder. Non-blocking and
  // self-limiting — each row is attempted exactly once. See the module header.
  startListingImageBackfill();
  // One-time sweep: re-host curated venues' seed portfolio galleries locally.
  // The seed `gallery_urls` hotlink each venue's own website, which our CSP
  // img-src blocks in the browser (broken thumbnails); this downloads them once
  // and serves CSP-safe local copies on the detail page. Non-blocking and
  // self-limiting — each row is attempted exactly once. See the module header.
  startListingGalleryBackfill();
  // Boot-time guard against re-introducing the legacy `sendEmail` direct-call
  // pattern. The May 2026 "phishy email" bug lived for months because nothing
  // flagged it; this scan emits a `mailer.integrity.violation` warning at boot
  // when anything outside the central dispatcher imports sendEmail.
  assertEmailIntegrityAtBoot(join(import.meta.dir, "..", ".."));
  // Load (or download, if a MaxMind key is set) the GeoLite2 country DB used to
  // tag signups with a country. Fire-and-forget: a download can take a moment
  // and must never block the listener; signups before it finishes just get a
  // null country. Absent file + no key = country lookup stays disabled.
  void ensureGeoDb();
}

log.info("server.listening", {
  port: server.port,
  serveFrontend: CONFIG.serveFrontend,
  email: !!CONFIG.resendApiKey,
  adminEmailsCount: CONFIG.adminEmails.length,
});
if (CONFIG.adminEmails.length === 0) {
  log.warn("config.no_admin_emails", {
    note: "ADMIN_EMAILS env var is empty — /app/admin/* will be unreachable.",
  });
}
if (!CONFIG.resendApiKey) {
  log.warn("config.no_resend_key", {
    note: "RESEND_API_KEY is unset — every email is logged to stdout instead of delivered. Verify-email, password reset, RSVP notifications, and lifecycle reminders all silently no-op.",
  });
}
// The default-EMAIL_FROM warning is gone — `config.ts` now hard-fails on
// boot if production is left with the resend.dev fallback. In dev the
// fallback is fine, and the boot-time log already reports `email:` health.
