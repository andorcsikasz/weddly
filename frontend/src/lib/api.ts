// Single typed fetch wrapper. Components never touch fetch directly — they go
// through `endpoints.ts`, which calls this.

const TOKEN_KEY = "weddly.token";

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // localStorage may be blocked in some embeds — fail soft.
  }
}

export async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { token?: string | null; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = opts.token ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headers[k] = v;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response (e.g. HTML 502) — treat as raw error message.
    }
  }

  if (!res.ok) {
    const errBody = (data ?? {}) as { error?: string; detail?: unknown };
    const msg = errBody.error ?? `Request failed (${res.status})`;
    if (res.status === 401) {
      // Stale token — clear it so the auth provider re-renders to /login.
      setToken(null);
    }
    throw new ApiError(res.status, msg, errBody.detail);
  }

  return data as T;
}
