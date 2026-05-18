// Bun.serve() entry point. Wires every route module and starts the server.
// SPA static files are served from frontend/dist when SERVE_FRONTEND=1.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { extractToken, verifySessionToken } from "./auth/session";
import { CONFIG } from "./config";
import "./db"; // open DB + apply schema
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
import { log, makeLogger } from "./lib/logger";
import { localeForHost, renderIndexHtml } from "./lib/seo_ssr";
import { startEmailWorker } from "./domain/emails/worker";
import { startPurgeWorker } from "./domain/purge";
import { registerAccommodationRoutes } from "./routes/accommodations";
import { registerAdminAnalyticsRoutes } from "./routes/admin_analytics";
import { registerAdminSupplierRoutes } from "./routes/admin_suppliers";
import { registerAdminUserRoutes } from "./routes/admin_users";
import { registerVendorWaitlistRoutes } from "./routes/vendor_waitlist";
import { registerAuthRoutes } from "./routes/auth";
import { registerAuthGoogleRoutes } from "./routes/auth_google";
import { registerBudgetRoutes } from "./routes/budget";
import { registerCommunitySupplierRoutes } from "./routes/community_suppliers";
import { registerCouplePauseRoutes } from "./routes/couple_pause";
import { registerCoupleRoutes } from "./routes/couples";
import { registerCouplePickRoutes } from "./routes/couple_picks";
import { registerCoupleSupplierRoutes } from "./routes/couple_suppliers";
import { registerDocumentArchiveRoutes } from "./routes/document_archive";
import { registerEmailChangeRoutes } from "./routes/email_change";
import { registerEmailPrefsRoutes } from "./routes/email_prefs";
import { registerEmailVerifyRoutes } from "./routes/email_verify";
import { registerExportRoutes } from "./routes/export";
import { registerFeedbackRoutes } from "./routes/feedback";
import { registerGuestRoutes } from "./routes/guests";
import { registerHealthRoutes } from "./routes/health";
import { registerHoneymoonRoutes } from "./routes/honeymoon";
import { registerHouseholdRoutes } from "./routes/households";
import { registerMoodboardRoutes } from "./routes/moodboard";
import { registerPasswordResetRoutes } from "./routes/password_reset";
import { registerPlacesRoutes } from "./routes/places";
import { registerPlanningRoutes } from "./routes/planning";
import { registerPrintRoutes } from "./routes/print";
import { registerGuestPortalRoutes } from "./routes/guest_portal";
import { registerRsvpRoutes } from "./routes/rsvp";
import { registerScheduleRoutes } from "./routes/schedule";
import { registerSeatingRoutes } from "./routes/seating";
import { registerSeoRoutes } from "./routes/seo";
import { registerTransferRoutes } from "./routes/transfers";
import { registerSupplierCostRoutes } from "./routes/supplier_costs";
import { registerSupplierRoutes } from "./routes/suppliers";
import { registerSupplierTaxonomyRoutes } from "./routes/supplier_taxonomy";
import { seedSupplierTaxonomy } from "./domain/supplier_taxonomy";
import { registerUserCoupleRoutes } from "./routes/user_couple";

seedSupplierTaxonomy();

const router = new Router();
registerHealthRoutes(router);
registerAuthRoutes(router);
registerAuthGoogleRoutes(router);
registerPasswordResetRoutes(router);
registerEmailVerifyRoutes(router);
registerEmailChangeRoutes(router);
registerEmailPrefsRoutes(router);
registerCoupleRoutes(router);
registerCouplePauseRoutes(router);
registerExportRoutes(router);
registerDocumentArchiveRoutes(router);
registerGuestRoutes(router);
registerHouseholdRoutes(router);
registerBudgetRoutes(router);
registerHoneymoonRoutes(router);
registerMoodboardRoutes(router);
registerPlacesRoutes(router);
registerPlanningRoutes(router);
registerRsvpRoutes(router);
registerGuestPortalRoutes(router);
registerScheduleRoutes(router);
registerSeatingRoutes(router);
registerAccommodationRoutes(router);
registerTransferRoutes(router);
registerPrintRoutes(router);
registerSupplierRoutes(router);
registerSupplierTaxonomyRoutes(router);
registerSupplierCostRoutes(router);
registerCommunitySupplierRoutes(router);
registerCoupleSupplierRoutes(router);
registerCouplePickRoutes(router);
registerAdminSupplierRoutes(router);
registerAdminUserRoutes(router);
registerAdminAnalyticsRoutes(router);
registerVendorWaitlistRoutes(router);
registerUserCoupleRoutes(router);
registerFeedbackRoutes(router);
registerSeoRoutes(router);

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
  "script-src 'self' https://plausible.io https://accounts.google.com https://apis.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://rsms.me https://fonts.googleapis.com https://accounts.google.com",
  // Tile servers for the supplier map (Leaflet on /app/suppliers). The
  // tile.openstreetmap.org subdomain pool serves the raster tiles.
  // *.pinimg.com hosts the Pinterest pin thumbnails rendered by /app/moodboard —
  // the URLs come from the backend's RSS proxy, so only image origins need
  // whitelisting (no Pinterest script/iframe).
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.pinimg.com https://*.googleusercontent.com",
  "font-src 'self' data: https://rsms.me https://fonts.gstatic.com",
  "connect-src 'self' https://plausible.io https://*.sentry.io https://rsms.me https://accounts.google.com",
  // OSM's /export/embed.html is iframed by the honeymoon map modal.
  // `blob:` is for the /app/seating PDF preview modal — the generated chart
  // is handed to <iframe src="blob:..."> so the browser's native PDF viewer
  // renders it inline. Without blob: in frame-src the iframe loads blank.
  // accounts.google.com renders the GSI one-tap / button iframe.
  "frame-src https://www.openstreetmap.org https://accounts.google.com blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
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
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
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

async function tryServeStatic(req: Request, pathname: string): Promise<Response | null> {
  if (!CONFIG.serveFrontend) return null;
  if (pathname.startsWith("/api/")) return null;

  const host = req.headers.get("host");

  // /robots.txt and /sitemap.xml are served by registerSeoRoutes (above the
  // SPA fallback in route order), so we don't try to short-circuit them here.

  // Direct file hit (assets in frontend/dist/assets/, OG images, the favicon, …).
  const filePath = join(FRONTEND_DIST, decodeURIComponent(pathname));
  if (filePath.startsWith(FRONTEND_DIST) && existsSync(filePath)) {
    const f = Bun.file(filePath);
    if (await f.exists()) return new Response(f);
  }

  // SPA fallback for unknown routes — let React Router resolve client-side.
  if (existsSync(FRONTEND_INDEX)) {
    const locale = localeForHost(host);
    const template = await loadIndexHtmlSource(locale);
    const html = renderIndexHtml(template, {
      host,
      pathname,
      isRsvp: isRsvpRoute(pathname),
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return null;
}

const server = Bun.serve({
  port: CONFIG.port,
  async fetch(req) {
    const url = new URL(req.url);
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const start = performance.now();

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

    const reqLog = makeLogger({
      requestId,
      method: req.method,
      route: url.pathname,
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
          route: url.pathname,
          method: req.method,
        });
      }
      return new Response(r.body, { status: r.status, headers });
    }
  },
});

// Pause-to-delete sweep — only in real environments. Tests drive it directly.
if (process.env.NODE_ENV !== "test") {
  startPurgeWorker();
  startEmailWorker();
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
