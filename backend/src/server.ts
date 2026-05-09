// Bun.serve() entry point. Wires every route module and starts the server.
// SPA static files are served from frontend/dist when SERVE_FRONTEND=1.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { extractToken, verifySessionToken } from "./auth/session";
import { CONFIG } from "./config";
import "./db"; // open DB + apply schema

import { corsPreflight, type Ctx, err as httpErr, HttpError, Router } from "./lib/http";
import { registerAuthRoutes } from "./routes/auth";
import { registerCoupleRoutes } from "./routes/couples";
import { registerHealthRoutes } from "./routes/health";

const router = new Router();
registerHealthRoutes(router);
registerAuthRoutes(router);
registerCoupleRoutes(router);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(self), microphone=(), camera=()",
};

const FRONTEND_DIST = join(import.meta.dir, "..", "..", "frontend", "dist");
const FRONTEND_INDEX = join(FRONTEND_DIST, "index.html");

function clientIpFrom(req: Request): string | null {
  // Test override first — keeps parallel test cases from sharing a rate-limit bucket.
  const testIp = req.headers.get("x-test-client-ip");
  if (testIp) return testIp;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

async function tryServeStatic(pathname: string): Promise<Response | null> {
  if (!CONFIG.serveFrontend) return null;
  if (pathname.startsWith("/api/")) return null;

  // Direct file hit (assets in frontend/dist/assets/, the OG image, robots.txt, …).
  const filePath = join(FRONTEND_DIST, decodeURIComponent(pathname));
  if (filePath.startsWith(FRONTEND_DIST) && existsSync(filePath)) {
    const f = Bun.file(filePath);
    if (await f.exists()) return new Response(f);
  }

  // SPA fallback for unknown routes — let React Router resolve client-side.
  if (existsSync(FRONTEND_INDEX)) {
    return new Response(Bun.file(FRONTEND_INDEX), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return null;
}

const server = Bun.serve({
  port: CONFIG.port,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return corsPreflight();

    const matched = router.match(req.method, url.pathname);
    if (!matched) {
      const fallback = await tryServeStatic(url.pathname);
      if (fallback) {
        // Apply security headers to static responses too.
        const headers = new Headers(fallback.headers);
        for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
        return new Response(fallback.body, { status: fallback.status, headers });
      }
      return httpErr(404, "Not found");
    }

    // Auth middleware: verify the bearer token if present, leave userId null otherwise.
    let userId: number | null = null;
    const token = extractToken(req);
    if (token) userId = verifySessionToken(token);

    if (matched.route.requireAuth && userId === null) {
      return httpErr(401, "Not authenticated");
    }

    const ctx: Ctx = {
      req,
      url,
      params: matched.params,
      userId,
      clientIp: clientIpFrom(req),
    };

    try {
      const res = await matched.route.handler(ctx);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      if (e instanceof HttpError) return httpErr(e.status, e.message, e.extra);
      console.error("[server] unhandled error", e);
      return httpErr(500, "Internal server error");
    }
  },
});

console.log(
  `[server] weddly api listening on :${server.port} ` +
    `(serveFrontend=${CONFIG.serveFrontend ? "on" : "off"}, ` +
    `email=${CONFIG.resendApiKey ? "on" : "off"})`,
);
