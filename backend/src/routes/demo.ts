// Public "try the demo" endpoint. Spins up a brand-new throwaway couple
// seeded with the Shrek & Fiona dataset, returns an auth session, and
// schedules lazy cleanup of older demos so the database doesn't grow
// unbounded.
//
// Why a real couple row instead of an in-memory mock: every /app/* surface
// reads from the same protected APIs, so the demo gets the actual product
// instead of a parallel "static" rendering. Visitors edit live data; the
// row is purged on the next demo-start sweep so the next session is fresh.

import type { AuthSession, User } from "@shared/types";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { addCoupleMember, getCoupleById, toCouple } from "../domain/couples";
import { purgeStaleDemoCouples, seedShrekDemo } from "../domain/demo_seed";
import { uniqueCoupleSlug } from "../domain/slug";
import { toUser, type UserRow } from "../domain/users";
import { type Ctx, json, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { log } from "../lib/logger";

/** Rate-limit per IP: capacity 3 with one refill every ~minute. A visitor
 *  who clicks the demo CTA twice in a row gets through; a script-kiddie
 *  spamming the endpoint to fill the DB hits 429 fast. */
const DEMO_BUCKET = { capacity: 3, refillRate: 1 / 60 };

/** Random opaque suffix so each demo account is a fresh users row — keeps
 *  the email column unique without leaking PII. */
function randomDemoEmail(): string {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `demo-${hex}@demo.weddly.local`;
}

async function handleStart(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "demo:start", DEMO_BUCKET);

  // Lazy housekeeping: any demo couple older than ~24h gets purged before we
  // create the next one. Failures here are non-fatal — we still want the
  // visitor to land in /app even if the sweep had a hiccup.
  try {
    const purged = purgeStaleDemoCouples();
    if (purged > 0) log.info("demo.purge", { purged });
  } catch (e) {
    log.warn("demo.purge_failed", { error: String(e) });
  }

  const ts = now();
  // Throwaway user — opaque random email + a random password (no one will
  // ever log in via the form). We still hash properly so the column shape
  // matches every other users row.
  const email = randomDemoEmail();
  const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
  const fullName = "Demo Guest";

  const userResult = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, ?, ?)`,
    )
    .run(email, passwordHash, fullName, ts, ts);
  const userId = Number(userResult.lastInsertRowid);

  // Empty couple row first. seedShrekDemo() fills in the wedding-date /
  // budget / guest count fields inside its transaction once the schema is
  // in shape to receive them.
  const coupleResult = db
    .prepare(
      `INSERT INTO couples
         (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
          wedding_date_kind, guest_count_kind, budget_kind,
          style_tags_json, currency, status, is_demo,
          created_at, updated_at, onboarded_at)
       VALUES (?, NULL, 'Shrek & Fiona', 'Fiona', 'Shrek',
               'exact', 'exact', 'exact',
               '["rustic","garden"]', 'HUF', 'active', 1,
               ?, ?, ?)`,
    )
    .run(userId, ts, ts, ts);
  const coupleId = Number(coupleResult.lastInsertRowid);

  // Public couple slug — keep "SHREKFIONA" if free, otherwise let
  // uniqueCoupleSlug append a numeric suffix.
  const slug = uniqueCoupleSlug("SHREKFIONA", coupleId);
  db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(slug, ts, coupleId);

  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );
  addCoupleMember(coupleId, userId, "owner");

  // Fill the workspace — guests, households, budget, seating, schedule, …
  const seeded = seedShrekDemo(coupleId);

  addAuditLog({
    actor_user_id: userId,
    couple_id: coupleId,
    action: "demo.start",
    target_kind: "couple",
    target_id: coupleId,
    note: `seeded demo workspace (${JSON.stringify(seeded)})`,
  });

  const token = issueSession(userId);
  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
  const session: AuthSession = { token, user: toUser(userRow) };

  // Hand the freshly-stamped couple back too so the SPA can skip the
  // /api/couples/current round-trip on first paint.
  const coupleRow = getCoupleById(coupleId);
  const couple = coupleRow ? toCouple(coupleRow) : null;

  return json({ session, couple, seeded }, { status: 201 });
}

export function registerDemoRoutes(router: Router) {
  router.post("/api/demo/start", handleStart);
}

/** Boot-time best-effort purge. Called from server.ts so a long-quiet
 *  instance still tidies up stale demos even if no one clicks the CTA. */
export function runDemoBootSweep(): void {
  try {
    const purged = purgeStaleDemoCouples();
    if (purged > 0) log.info("demo.boot_sweep", { purged });
  } catch (e) {
    log.warn("demo.boot_sweep_failed", { error: String(e) });
  }
}
