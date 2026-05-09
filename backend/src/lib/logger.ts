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
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  // We deliberately use console here so this is the *only* place writing log
  // bytes — everything else goes through this module.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
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
