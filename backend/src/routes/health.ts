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

/** Cheap, sync mailer config state — surfaces when the dispatcher will silently
 *  no-op (RESEND_API_KEY missing) or fall back to Resend's testing sender
 *  (which only delivers to the Resend account owner, not arbitrary recipients).
 *  Real liveness lives in `/api/health/deep` via `checkResendLiveness`. */
function mailerConfigState(): {
  configured: boolean;
  from_default: boolean;
  reason?: string;
} {
  const configured = !!CONFIG.resendApiKey;
  const from_default = CONFIG.emailFrom === "Weddly <onboarding@resend.dev>";
  if (!configured) {
    return { configured, from_default, reason: "RESEND_API_KEY unset — emails are stdout-only" };
  }
  if (from_default) {
    return {
      configured,
      from_default,
      reason: "EMAIL_FROM uses resend.dev — only delivers to the Resend account owner",
    };
  }
  return { configured, from_default };
}

export function registerHealthRoutes(router: Router) {
  router.get("/api/health", () => {
    const dbCheck = checkDb();
    const mailer = mailerConfigState();
    return json(
      { ok: dbCheck.ok, db: dbCheck.ok, mailer, ts: now() },
      { status: dbCheck.ok ? 200 : 503 },
    );
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
