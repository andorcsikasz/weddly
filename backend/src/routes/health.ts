// Health endpoints.
//
//   /api/health      Cheap liveness probe wired to Railway's healthcheck and
//                    UptimeRobot's keyword check (`"ok":true`). DB-only so it
//                    stays fast and doesn't flap on upstream issues.
//
//   /api/health/deep Per-component status: DB + Resend liveness + disk write
//                    on the uploads volume. NOT wired to Railway's healthcheck
//                    on purpose — a transient Resend blip should not restart
//                    the container. Hit it from external monitors that you
//                    want to alert at slower cadence (UptimeRobot, ~15min).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { json, type Router } from "../lib/http";
import { checkResendLiveness } from "../lib/mailer";

interface ComponentResult {
  ok: boolean;
  ms?: number;
  reason?: string;
  skipped?: boolean;
}

function checkDb(): ComponentResult {
  const start = performance.now();
  try {
    db.query("SELECT 1").get();
    return { ok: true, ms: Math.round(performance.now() - start) };
  } catch (e) {
    return {
      ok: false,
      ms: Math.round(performance.now() - start),
      reason: e instanceof Error ? e.message : "unknown",
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
    return {
      ok: false,
      ms: Math.round(performance.now() - start),
      reason: e instanceof Error ? e.message : "unknown",
    };
  }
}

export function registerHealthRoutes(router: Router) {
  router.get("/api/health", () => {
    const dbCheck = checkDb();
    return json({ ok: dbCheck.ok, db: dbCheck.ok, ts: now() }, { status: dbCheck.ok ? 200 : 503 });
  });

  router.get("/api/health/deep", async () => {
    const dbCheck = checkDb();
    const diskCheck = checkDisk();
    const resendCheck = await checkResendLiveness();

    const components = { db: dbCheck, disk: diskCheck, resend: resendCheck };
    // skipped components don't count against overall health (e.g. Resend in dev).
    const ok = Object.values(components).every((c) => c.ok || c.skipped);

    return json({ ok, ts: now(), components }, { status: ok ? 200 : 503 });
  });
}
