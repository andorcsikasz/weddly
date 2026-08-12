// Structured JSON logger. One line per event so log aggregators (Railway logs,
// Better Stack, Loki) can parse it. Don't pull in pino or winston — the surface
// area we need fits in 30 lines.
//
// Usage:
//   log.info("http.request", { method, path });
//   log.warn("rate_limit.exceeded", { ip, route });
//   log.error("mailer.send_failed", err, { to, template });
//
// In a request handler, prefer `ctx.log` (request-scoped, auto-includes
// requestId + userId). The top-level `log` here is for boot/cron paths
// that don't have a request context.

import { createHash } from "node:crypto";
import { redactTokensInPath } from "./log_redact";

export type Level = "debug" | "info" | "warn" | "error";

interface BaseLogger {
  debug: (msg: string, fields?: Record<string, unknown>) => void;
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, errOrFields?: unknown, fields?: Record<string, unknown>) => void;
  child: (fields: Record<string, unknown>) => BaseLogger;
}

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const ENV_LEVEL = (process.env.LOG_LEVEL as Level | undefined) ?? "info";
const MIN_RANK = LEVEL_RANK[ENV_LEVEL] ?? LEVEL_RANK.info;

function emit(level: Level, msg: string, fields: Record<string, unknown>) {
  if (LEVEL_RANK[level] < MIN_RANK) return;
  // Test-only mail capture deliberately exposes the generated message to the
  // assertions. Every real log path goes through recursive field scrubbing.
  const safeFields =
    msg === "mailer.dev_print" && process.env.NODE_ENV === "test"
      ? fields
      : redactLogFields(fields);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(safeFields as Record<string, unknown>),
  });
  // We deliberately use console here so this is the *only* place writing log
  // bytes — everything else goes through this module.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

const SECRET_KEY =
  /(?:password|passwd|token|secret|authorization|cookie|invite_code|household_code)/i;
const CONTENT_KEY = /^(?:body|text|html|content|upstream_response)$/i;
const EMAIL_KEY = /(?:^|_)(?:email|recipient|to|from|reply_to)(?:$|_)/i;
const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12)}`;
}

function scrubString(value: string): string {
  return redactTokensInPath(value).replace(EMAIL_IN_TEXT, (email) => fingerprint(email));
}

export function redactLogFields(value: unknown, key = "", depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (SECRET_KEY.test(key) || CONTENT_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (EMAIL_KEY.test(key) || EMAIL_IN_TEXT.test(value)) {
      EMAIL_IN_TEXT.lastIndex = 0;
      return EMAIL_KEY.test(key) ? fingerprint(value) : scrubString(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactLogFields(item, key, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redactLogFields(child, childKey, depth + 1),
      ]),
    );
  }
  return value;
}

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return { error: { name: e.name, message: e.message, stack: e.stack } };
  }
  return { error: { value: String(e) } };
}

export function makeLogger(base: Record<string, unknown> = {}): BaseLogger {
  return {
    debug: (msg, fields) => emit("debug", msg, { ...base, ...fields }),
    info: (msg, fields) => emit("info", msg, { ...base, ...fields }),
    warn: (msg, fields) => emit("warn", msg, { ...base, ...fields }),
    error: (msg, errOrFields, fields) => {
      // Allow log.error("msg", err) and log.error("msg", err, {ctx}).
      const isErr =
        errOrFields instanceof Error || typeof errOrFields !== "object" || errOrFields === null;
      const errPart = isErr && errOrFields !== undefined ? serializeError(errOrFields) : {};
      const restFields = isErr ? (fields ?? {}) : (errOrFields as Record<string, unknown>);
      emit("error", msg, { ...base, ...errPart, ...restFields });
    },
    child: (extra) => makeLogger({ ...base, ...extra }),
  };
}

export const log = makeLogger();
export type Logger = BaseLogger;
