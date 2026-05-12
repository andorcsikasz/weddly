// Single typed fetch wrapper. Components never touch fetch directly — they go
// through `endpoints.ts`, which calls this.

const TOKEN_KEY = "weddly.token";

/** Default request timeout in ms — slow networks fail loudly here rather
 *  than leaving a spinner up forever. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Browser event name dispatched on a 401 so AuthProvider (or the
 *  SessionExpiredDialog handler) can open the re-login modal without the
 *  fetch caller needing to know about React state. */
export const SESSION_EXPIRED_EVENT = "weddly:session-expired";

/** Code surfaced on the typed ApiError. Network-layer codes never come from
 *  the server — they're synthesized here so callers can branch on
 *  resilience signals without sniffing `instanceof TypeError`. */
export type ApiErrorCode =
  | "network_error"
  | "timeout"
  | "aborted"
  | "session_expired"
  | "server_error"
  | "client_error";

export class ApiError extends Error {
  status: number;
  /** Stable code for branching — independent of localised `message`. */
  code: ApiErrorCode;
  detail: unknown;
  constructor(status: number, code: ApiErrorCode, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
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

/** Lightweight online/offline awareness. Components can subscribe via the
 *  `useOnlineStatus` hook (see below). The default is `true` on SSR so
 *  hydration mismatch noise stays quiet. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export interface ApiFetchOptions {
  token?: string | null;
  headers?: Record<string, string>;
  /** Caller-controlled AbortSignal — combined with the internal timeout. */
  signal?: AbortSignal;
  /** Override the default 20s timeout. Pass 0 to disable. */
  timeoutMs?: number;
  /** Retry transient failures (network_error, timeout, 5xx). Defaults to
   *  `true` for GET, `false` for other methods. POST/PATCH/PUT/DELETE
   *  callers must opt in explicitly because not every mutation is safe to
   *  re-issue — set this only when the endpoint is idempotent (uses an
   *  Idempotency-Key, an If-Match etag guard, or is a pure overwrite). */
  retry?: boolean;
}

/** Backoff between retry attempts. Two short delays — enough to ride out a
 *  ~1s blip without making a flaky endpoint feel slow. Jitter is applied
 *  on top to avoid thundering-herd retries from synchronised clients. */
const RETRY_BACKOFF_MS = [250, 1000] as const;

export async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = opts.token ?? getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.headers) {
    for (const [k, v] of Object.entries(opts.headers)) headers[k] = v;
  }

  const retryEnabled = opts.retry ?? method.toUpperCase() === "GET";
  const maxAttempts = retryEnabled ? RETRY_BACKOFF_MS.length + 1 : 1;
  let lastTransientError: ApiError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const base = RETRY_BACKOFF_MS[attempt - 1] ?? 1000;
      const jitter = Math.random() * 0.4 * base;
      await new Promise((r) => setTimeout(r, base + jitter));
    }

    // Build an internal AbortController so we always own the timeout. If the
    // caller passed their own signal, mirror its abort into ours so either
    // source kills the request. Re-armed per attempt — a previous timeout
    // must not poison the next try.
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : null;

    let externalAbortHandler: (() => void) | null = null;
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort();
      } else {
        externalAbortHandler = () => controller.abort();
        opts.signal.addEventListener("abort", externalAbortHandler);
      }
    }

    let res: Response;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (externalAbortHandler && opts.signal) {
        opts.signal.removeEventListener("abort", externalAbortHandler);
      }
      // External abort takes priority over an internal timeout race — if the
      // caller cancelled, never retry.
      if (opts.signal?.aborted) {
        throw new ApiError(0, "aborted", "Request aborted");
      }
      if (timedOut) {
        lastTransientError = new ApiError(0, "timeout", "Request timed out");
      } else {
        // TypeError("Failed to fetch") in Chrome/Firefox, "Network request
        // failed" in Safari, "NetworkError when attempting to fetch
        // resource." in some older Firefox builds — all map to the same
        // condition.
        lastTransientError = new ApiError(0, "network_error", "Network unavailable");
      }
      continue;
    }
    if (timer) clearTimeout(timer);
    if (externalAbortHandler && opts.signal) {
      opts.signal.removeEventListener("abort", externalAbortHandler);
    }

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
        // Surface as a typed event so AuthProvider can pop the
        // SessionExpiredDialog. We deliberately do NOT call setToken(null)
        // here — clearing the token mid-render would yank the user back to
        // /login and lose whatever they had typed. The dialog handler decides
        // whether to clear after the user reacts.
        if (typeof window !== "undefined") {
          try {
            window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
          } catch {
            /* CustomEvent may not exist on some odd embeds */
          }
        }
        // 401 is not transient — never retry.
        throw new ApiError(401, "session_expired", msg, errBody.detail);
      }
      if (res.status >= 500) {
        lastTransientError = new ApiError(res.status, "server_error", msg, errBody.detail);
        continue;
      }
      // 4xx — caller's request was rejected; retry would just re-fail.
      throw new ApiError(res.status, "client_error", msg, errBody.detail);
    }

    return data as T;
  }

  throw lastTransientError ?? new ApiError(0, "network_error", "Network unavailable");
}
