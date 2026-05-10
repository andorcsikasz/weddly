// Tiny HTTP helpers + custom router. No framework — Bun's native runtime is fast enough.

import { CONFIG } from "../config";
import type { Logger } from "./logger";

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Set by the auth middleware when the bearer token is valid. */
  userId: number | null;
  /** Remote IP after XFF / X-Real-IP handling. `null` if unknown. */
  clientIp: string | null;
  /** Per-request UUID — propagated to logs and Sentry tags. */
  requestId: string;
  /** Request-scoped logger; auto-includes requestId / userId / route. */
  log: Logger;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  requireAuth: boolean;
}

// CORS allowlist: prod locks to FRONTEND_BASE_URL; dev permits localhost on
// any port so Vite (5173) → API (8787) keeps working. Tests run same-origin.
const CORS_ALLOWED_ORIGINS = new Set<string>([
  CONFIG.frontendBaseUrl,
  // Common dev ports, only honoured when NODE_ENV !== production.
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const IS_PROD = process.env.NODE_ENV === "production";

function corsHeaders(origin: string | null): Record<string, string> {
  const allow =
    origin &&
    (CORS_ALLOWED_ORIGINS.has(origin) || (!IS_PROD && origin.startsWith("http://localhost")))
      ? origin
      : CONFIG.frontendBaseUrl;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-test-client-ip",
    Vary: "Origin",
  };
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  // Origin is unknown at json() call time (it's the request header). The server
  // wrapper applies CORS based on the actual request — json() just emits the body.
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

export function err(status: number, message: string, extra?: unknown): Response {
  return json({ error: message, detail: extra }, { status });
}

export class HttpError extends Error {
  status: number;
  extra?: unknown;
  constructor(status: number, message: string, extra?: unknown) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function compilePath(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, k) => {
    keys.push(k);
    return "([^/]+)";
  });
  return { pattern: new RegExp(`^${src}$`), keys };
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler, requireAuth = false) {
    const { pattern, keys } = compilePath(path);
    this.routes.push({ method, pattern, keys, handler, requireAuth });
  }
  get(path: string, handler: Handler, requireAuth = false) {
    this.add("GET", path, handler, requireAuth);
  }
  post(path: string, handler: Handler, requireAuth = false) {
    this.add("POST", path, handler, requireAuth);
  }
  put(path: string, handler: Handler, requireAuth = false) {
    this.add("PUT", path, handler, requireAuth);
  }
  patch(path: string, handler: Handler, requireAuth = false) {
    this.add("PATCH", path, handler, requireAuth);
  }
  delete(path: string, handler: Handler, requireAuth = false) {
    this.add("DELETE", path, handler, requireAuth);
  }

  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.pattern);
      if (m) {
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => {
          params[k] = decodeURIComponent(m[i + 1] ?? "");
        });
        return { route: r, params };
      }
    }
    return null;
  }
}

export async function readJson<T = unknown>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

export function requireAuth(ctx: Ctx): number {
  if (!ctx.userId) throw new HttpError(401, "Not authenticated");
  return ctx.userId;
}

/** requireAuth + a `verified_email = 1` gate. Throws 403 with `extra.code =
 *  "email_unverified"` so the frontend can detect and show the verify-gate
 *  screen instead of a generic error. Use on any endpoint that should be
 *  unreachable until the user has clicked the verify link — currently
 *  onboarding + partner-invite creation. The user-id lookup is one extra row
 *  read per request, which is fine at our volume. */
export function requireVerifiedAuth(
  ctx: Ctx,
  lookupUser: (id: number) => { verified_email: number } | null,
): number {
  const userId = requireAuth(ctx);
  const row = lookupUser(userId);
  if (!row) throw new HttpError(404, "User not found");
  if (!row.verified_email) {
    throw new HttpError(403, "Email not verified", { code: "email_unverified" });
  }
  return userId;
}

export function corsPreflight(req: Request): Response {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export { corsHeaders };
