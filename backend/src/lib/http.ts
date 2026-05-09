// Tiny HTTP helpers + custom router. No framework — Bun's native runtime is fast enough.

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  /** Set by the auth middleware when the bearer token is valid. */
  userId: number | null;
  /** Remote IP after XFF / X-Real-IP handling. `null` if unknown. */
  clientIp: string | null;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  requireAuth: boolean;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, x-test-client-ip",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS,
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

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
