// Cheap liveness probe. UptimeRobot is configured to keyword-match `"ok":true`.

import { db, now } from "../db";
import { json, type Router } from "../lib/http";

export function registerHealthRoutes(router: Router) {
  router.get("/api/health", () => {
    let dbOk = false;
    try {
      db.query("SELECT 1").get();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return json({ ok: dbOk, db: dbOk, ts: now() }, { status: dbOk ? 200 : 503 });
  });
}
