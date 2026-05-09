// Sentry initialization. No-op when SENTRY_DSN is unset, so local dev and
// tests don't need any config. Import side-effect at the top of server.ts —
// must happen before route handlers register so the global error handler is
// in place from the first request.

import * as Sentry from "@sentry/bun";
import { log } from "./logger";

const DSN = process.env.SENTRY_DSN ?? "";
const RELEASE = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? undefined;
const ENVIRONMENT = process.env.NODE_ENV ?? "development";

let initialized = false;

export function initObservability() {
  if (initialized) return;
  initialized = true;
  if (!DSN) {
    log.info("sentry.disabled", { reason: "SENTRY_DSN unset" });
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: ENVIRONMENT,
    release: RELEASE,
    // Tracing/profiling are opt-in: keep them off for now to avoid a noisy
    // first impression in Sentry. Flip on via SENTRY_TRACES_SAMPLE_RATE if
    // you want spans later.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
  log.info("sentry.initialized", { environment: ENVIRONMENT, release: RELEASE });
}

export interface CaptureContext {
  requestId?: string;
  userId?: number | null;
  route?: string;
  method?: string;
  extra?: Record<string, unknown>;
}

export function captureException(err: unknown, ctx: CaptureContext = {}) {
  if (!initialized || !DSN) return;
  Sentry.withScope((scope) => {
    if (ctx.requestId) scope.setTag("request_id", ctx.requestId);
    if (ctx.route) scope.setTag("route", ctx.route);
    if (ctx.method) scope.setTag("method", ctx.method);
    if (ctx.userId != null) scope.setUser({ id: String(ctx.userId) });
    if (ctx.extra) scope.setContext("extra", ctx.extra);
    Sentry.captureException(err);
  });
}

// Process-level safety net for anything that escapes the per-request handler.
process.on("unhandledRejection", (reason) => {
  log.error("process.unhandled_rejection", reason);
  captureException(reason, { extra: { kind: "unhandledRejection" } });
});
process.on("uncaughtException", (err) => {
  log.error("process.uncaught_exception", err);
  captureException(err, { extra: { kind: "uncaughtException" } });
});

/**
 * Single chokepoint for fire-and-forget error reporting: structured log line
 * + Sentry capture in one call. Use this in `.catch((e) => …)` blocks so we
 * don't drift between logger-only and Sentry-only call sites.
 */
export function reportError(msg: string, err: unknown, fields?: Record<string, unknown>) {
  log.error(msg, err, fields);
  captureException(err, { extra: { msg, ...(fields ?? {}) } });
}
