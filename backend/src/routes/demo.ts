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
import { vendorCurrencyForLocale } from "@shared/vendor_billing";
import { hashPassword } from "../auth/password";
import { issueSession } from "../auth/session";
import { db, now } from "../db";
import { addAuditLog } from "../lib/audit";
import { addCoupleMember, assignOrganiserCode, getCoupleById, toCouple } from "../domain/couples";
import { type DemoLocale, purgeStaleDemoCouples, seedShrekDemo } from "../domain/demo_seed";
import { purgeStalePlannerDemos, seedPlannerDemo } from "../domain/planner_demo_seed";
import {
  purgeStaleVendorDemos,
  seedVendorDemo,
  vendorDemoBusinessName,
  vendorDemoOwnerName,
} from "../domain/vendor_demo_seed";
import { uniqueCoupleSlug } from "../domain/slug";
import { createVendorAccount } from "../domain/vendor_accounts";
import { toUser, type UserRow } from "../domain/users";
import { type Ctx, json, readJson, type Router } from "../lib/http";
import { rateLimit } from "../lib/rate_limit";
import { log } from "../lib/logger";

/** Rate-limit per IP: capacity 3 with one refill every ~minute. A visitor
 *  who clicks the demo CTA twice in a row gets through; a script-kiddie
 *  spamming the endpoint to fill the DB hits 429 fast. */
const DEMO_BUCKET = { capacity: 3, refillRate: 1 / 60 };

/** Demo planner/vendor entitlement window, far enough out that
 *  computeEntitlement keeps the founding plan "entitled" for the whole 4h demo
 *  lifetime (and then some), so a visitor never hits the read-only gate. */
const DEMO_ENTITLEMENT_MS = 3650 * 24 * 60 * 60 * 1000; // ~10 years

/** Random opaque suffix so each demo account is a fresh users row — keeps
 *  the email column unique without leaking PII. */
function randomDemoEmail(): string {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `demo-${hex}@demo.weddly.local`;
}

/** Locale the demo dataset is seeded in. The SPA sends its active UI locale in
 *  the request body (`{ locale: "hu" | "en" }`) so the seeded content always
 *  matches the chrome around it; direct/legacy callers without a body fall
 *  back to the Accept-Language header, and everything else gets EN. */
async function demoLocale(ctx: Ctx): Promise<DemoLocale> {
  let fromBody: unknown;
  try {
    const body = await readJson<Record<string, unknown>>(ctx.req);
    fromBody = body?.locale;
  } catch {
    // No/invalid JSON body — fall through to the header.
  }
  if (fromBody === "hu" || fromBody === "en") return fromBody;
  const header = ctx.req.headers.get("accept-language") ?? "";
  return header.trim().toLowerCase().startsWith("hu") ? "hu" : "en";
}

async function handleStart(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "demo:start", DEMO_BUCKET);
  const locale = await demoLocale(ctx);

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
  const fullName = locale === "hu" ? "Demó vendég" : "Demo Guest";

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
  assignOrganiserCode(coupleId, ts);

  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );
  addCoupleMember(coupleId, userId, "owner");

  // Fill the workspace — guests, households, budget, seating, schedule, …
  const seeded = seedShrekDemo(coupleId, locale);

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

/** Planner-side demo: spin up a throwaway "Fairy Godmother Weddings" planner
 *  account pre-loaded with a book of fairy-tale clients (Shrek & Fiona among
 *  them, plus a pending Belle & Adam invite), return an auth session, and drop
 *  the visitor into /app/planner. Mirrors handleStart; reaped by the same
 *  sweeps. */
async function handleStartPlanner(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "demo:start", DEMO_BUCKET);
  const locale = await demoLocale(ctx);

  // Lazy housekeeping. ORDER MATTERS: reap stale demo planners BEFORE their
  // client couples (see purgeStalePlannerDemos' ordering note).
  try {
    const planners = purgeStalePlannerDemos();
    const couples = purgeStaleDemoCouples();
    if (planners > 0 || couples > 0) log.info("demo.purge", { planners, couples });
  } catch (e) {
    log.warn("demo.purge_failed", { error: String(e) });
  }

  const ts = now();
  const email = randomDemoEmail();
  // One hash reused for the planner + every throwaway client-couple owner —
  // none of them are ever logged into via the form.
  const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());

  // Demo planner user: premium tier, onboarding pre-completed so the dashboard
  // renders instead of bouncing to the onboarding wizard.
  const businessName = locale === "hu" ? "Tündérkeresztanya Esküvők" : "Fairy Godmother Weddings";
  const userResult = db
    .prepare(
      `INSERT INTO users
         (email, password_hash, full_name, status, role, verified_email, user_type,
          business_name, planner_plan, planner_max_clients, planner_onboarding_done,
          created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, 'planner',
               ?, 'premium', 10, 1, ?, ?)`,
    )
    .run(email, passwordHash, businessName, businessName, ts, ts);
  const userId = Number(userResult.lastInsertRowid);

  // Entitlement WITHOUT consuming a real founding slot: is_founding_member=0
  // keeps the demo out of plannerFoundingSlotsUsed(), while a far-future
  // founding_until makes computeEntitlement return entitled (not read-only).
  db.prepare(
    `INSERT INTO planner_subscriptions
       (user_id, subscription_status, trial_ends_at, founding_until,
        is_founding_member, currency, created_at, updated_at)
     VALUES (?, 'founding', NULL, ?, 0, 'HUF', ?, ?)`,
  ).run(userId, ts + DEMO_ENTITLEMENT_MS, ts, ts);

  const seeded = seedPlannerDemo(userId, { ownerPasswordHash: passwordHash, locale });

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "demo.start_planner",
    target_kind: "user",
    target_id: userId,
    note: `seeded planner demo (${JSON.stringify(seeded)})`,
  });

  const token = issueSession(userId);
  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
  const session: AuthSession = { token, user: toUser(userRow) };

  return json({ session, seeded }, { status: 201 });
}

/** Vendor-side demo: spin up a throwaway Shrek-themed cake studio ("Mézi
 *  Tortaműhely" / "Gingy's Wedding Cakes") pre-loaded with fairy-tale client
 *  inquiries, payment schedules and blocked dates, return an auth session, and
 *  drop the visitor into /vendor. Mirrors handleStartPlanner; reaped by the
 *  same sweeps. */
async function handleStartVendor(ctx: Ctx): Promise<Response> {
  rateLimit(ctx.clientIp, "demo:start", DEMO_BUCKET);
  const locale = await demoLocale(ctx);

  // Lazy housekeeping: vendors before couples so the seeded client couples'
  // bookings are already gone when the couples sweep runs (both orders work
  // since the deletes are explicit, but this keeps the sweeps symmetric with
  // the planner demo).
  try {
    const vendors = purgeStaleVendorDemos();
    const couples = purgeStaleDemoCouples();
    if (vendors > 0 || couples > 0) log.info("demo.purge", { vendors, couples });
  } catch (e) {
    log.warn("demo.purge_failed", { error: String(e) });
  }

  const ts = now();
  const email = randomDemoEmail();
  // One hash reused for the vendor + every throwaway client-couple owner;
  // none of them are ever logged into via the form.
  const passwordHash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());

  const userResult = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, locale, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'vendor', 1, ?, ?, ?)`,
    )
    .run(email, passwordHash, vendorDemoOwnerName(locale), locale, ts, ts);
  const userId = Number(userResult.lastInsertRowid);

  // onboarding_done defaults to 1 in createVendorAccount, so the demo lands on
  // the dashboard instead of bouncing into the onboarding wizard.
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: vendorDemoBusinessName(locale),
    contactEmail: email,
  });

  // Entitlement WITHOUT consuming a real founding slot: is_founding_member=0
  // keeps the demo out of vendorFoundingSlotsUsed(), while a far-future
  // founding_until makes computeEntitlement return entitled, so the listing
  // editor, availability and the PRO client/payment surfaces all stay live.
  const currency = vendorCurrencyForLocale(locale);
  db.prepare(
    `INSERT INTO vendor_subscriptions
       (vendor_account_id, subscription_status, trial_ends_at, founding_until,
        is_founding_member, currency, created_at, updated_at)
     VALUES (?, 'founding', NULL, ?, 0, ?, ?, ?)`,
  ).run(account.id, ts + DEMO_ENTITLEMENT_MS, currency, ts, ts);

  const seeded = seedVendorDemo(account.id, {
    ownerPasswordHash: passwordHash,
    contactEmail: email,
    locale,
    currency,
  });

  addAuditLog({
    actor_user_id: userId,
    couple_id: null,
    action: "demo.start_vendor",
    target_kind: "vendor_account",
    target_id: account.id,
    note: `seeded vendor demo (${JSON.stringify(seeded)})`,
  });

  const token = issueSession(userId);
  const userRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow;
  const session: AuthSession = { token, user: toUser(userRow) };

  return json({ session, seeded }, { status: 201 });
}

export function registerDemoRoutes(router: Router) {
  router.post("/api/demo/start", handleStart);
  router.post("/api/demo/planner/start", handleStartPlanner);
  router.post("/api/demo/vendor/start", handleStartVendor);
}

/** Boot-time best-effort purge. Called from server.ts so a long-quiet
 *  instance still tidies up stale demos even if no one clicks the CTA. */
export function runDemoBootSweep(): void {
  try {
    // Planners + vendors first, then their client couples (ordering note in
    // purgeStalePlannerDemos).
    const planners = purgeStalePlannerDemos();
    const vendors = purgeStaleVendorDemos();
    const purged = purgeStaleDemoCouples();
    if (planners > 0 || vendors > 0 || purged > 0) {
      log.info("demo.boot_sweep", { planners, vendors, couples: purged });
    }
  } catch (e) {
    log.warn("demo.boot_sweep_failed", { error: String(e) });
  }
}
