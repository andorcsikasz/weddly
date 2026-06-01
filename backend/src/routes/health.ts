// Health endpoints.
//
//   /api/health      Cheap liveness probe wired to Railway's healthcheck and
//                    UptimeRobot's keyword check (`"ok":true`). DB-only so it
//                    stays fast and doesn't flap on upstream issues.
//
//   /api/health/deep Per-component status: DB + Resend liveness + disk write
//                    + free-space + memory + uptime. NOT wired to Railway's
//                    healthcheck on purpose — a transient Resend blip or a
//                    full disk should not restart the container (a restart
//                    can't fix either). Hit it from external monitors that
//                    you want to alert at slower cadence (UptimeRobot, ~15min).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { json, type Router } from "../lib/http";
import { log } from "../lib/logger";
import { checkResendLiveness } from "../lib/mailer";

interface ComponentResult {
  ok: boolean;
  ms?: number;
  reason?: string;
  skipped?: boolean;
  [k: string]: unknown;
}

// Page when the persistent volume crosses this — SQLite write failures on a
// full disk cascade into corrupt state, and Railway volume resizes need a
// human. 90% gives enough runway to react before writes start failing.
const DISK_USED_ALERT_PCT = 90;

function checkDb(): ComponentResult {
  const start = performance.now();
  try {
    db.query("SELECT 1").get();
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (e) {
    // Log the raw error server-side; never echo e.message to anonymous
    // callers — it can disclose table names or the DB file path.
    log.error("health.db_check_failed", e);
    return {
      ok: false,
      ms: Math.round(performance.now() - start),
      reason: "db check failed",
    };
  }
}

function checkDisk(): ComponentResult {
  const start = performance.now();
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(CONFIG.uploadsDir, ".healthcheck-"));
    const file = join(dir, "probe");
    writeFileSync(file, "ok");
    rmSync(dir, { recursive: true, force: true });
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (e) {
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    // Raw filesystem errors can echo the absolute uploads path; keep them
    // server-side only.
    log.error("health.disk_check_failed", e);
    return {
      ok: false,
      ms: Math.round(performance.now() - start),
      reason: "disk check failed",
    };
  }
}

// Informational. Free-space stats on the persistent volume so external monitors
// can graph capacity and page on their own thresholds. We never gate the
// overall /api/health/deep response on this: a 503 wouldn't help (a restart
// can't shrink data), and dev machines routinely run > the prod threshold,
// which would make the endpoint look broken locally. `near_full` is included
// as a substring-friendly flag for UptimeRobot-style keyword checks.
async function diskSpaceStats(): Promise<ComponentResult & { near_full?: boolean }> {
  const start = performance.now();
  try {
    const s = await statfs(CONFIG.uploadsDir);
    const totalBytes = s.bsize * s.blocks;
    const freeBytes = s.bsize * s.bavail;
    const usedBytes = totalBytes - freeBytes;
    const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    return {
      ok: true,
      ms: Math.round(performance.now() - start),
      free_mb: Math.round(freeBytes / (1024 * 1024)),
      total_mb: Math.round(totalBytes / (1024 * 1024)),
      percent_used: percentUsed,
      near_full: percentUsed >= DISK_USED_ALERT_PCT,
    };
  } catch (e) {
    log.error("health.disk_space_failed", e);
    return {
      ok: true,
      ms: Math.round(performance.now() - start),
      reason: "disk space unavailable",
    };
  }
}

// Informational. Surface heap and RSS so external monitors can graph memory
// growth and alert on leaks before Railway OOM-kills the container. Never
// marked not-ok — Railway's container limit is the real ceiling, and a 503
// here would just trigger a useless restart loop.
function memoryStats(): ComponentResult {
  const m = process.memoryUsage();
  return {
    ok: true,
    rss_mb: Math.round(m.rss / (1024 * 1024)),
    heap_used_mb: Math.round(m.heapUsed / (1024 * 1024)),
    heap_total_mb: Math.round(m.heapTotal / (1024 * 1024)),
  };
}

export function registerHealthRoutes(router: Router) {
  router.get("/api/health", () => {
    // DB-only liveness, no auth (Railway healthcheck + UptimeRobot keyword on
    // `"ok":true`). Deliberately does NOT surface mailer/email config posture
    // to anonymous callers — that's recon material with no monitoring value.
    const dbCheck = checkDb();
    return json({ ok: dbCheck.ok, db: dbCheck.ok, ts: now() }, { status: dbCheck.ok ? 200 : 503 });
  });

  router.get("/api/health/deep", async () => {
    const dbCheck = checkDb();
    const diskCheck = checkDisk();
    const resendCheck = await checkResendLiveness();
    const diskSpace = await diskSpaceStats();
    const memory = memoryStats();

    // Critical components gate the overall ok. Informational ones (memory,
    // disk_space) surface stats but never fail the endpoint.
    const critical = { db: dbCheck, disk: diskCheck, resend: resendCheck };
    const ok = Object.values(critical).every((c) => c.ok || c.skipped);

    return json(
      {
        ok,
        ts: now(),
        uptime_s: Math.round(process.uptime()),
        components: { ...critical, disk_space: diskSpace, memory },
      },
      { status: ok ? 200 : 503 },
    );
  });
}
