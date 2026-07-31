// Subscription billing domain: Stripe client, founding-member eligibility, the
// trial/founding state transitions, and the entitlement guard used by write
// routes. Pure infra (the Stripe SDK) is wrapped here so routes stay thin.
//
// State machine + entitlement rules: shared/billing.ts.

import Stripe from "stripe";
import {
  type BillingReason,
  FOUNDING_CAP,
  FOUNDING_DURATION_MS,
  PAID_LAUNCH_DATE,
  partnerFreeWindowEnd,
  TRIAL_DURATION_MS,
} from "@shared/billing";
import type { Currency } from "@shared/types";
import { CONFIG, STRIPE_ENABLED } from "../config";
import { db, now } from "../db";
import { type Ctx, HttpError } from "../lib/http";
import {
  type CoupleRow,
  getCoupleById,
  getCoupleForUser,
  isBillingAnchor,
  toCoupleBilling,
} from "./couples";

// ── Stripe client ─────────────────────────────────────────────────────────
let _stripe: Stripe | null = null;
/** Lazily build the Stripe client. Throws 503 when billing isn't configured so
 *  callers surface "billing not set up yet" instead of a crash. */
export function stripe(): Stripe {
  if (!STRIPE_ENABLED) {
    throw new HttpError(503, "Billing is not configured", { code: "billing_disabled" });
  }
  if (!_stripe) {
    // Pin the API version so dashboard upgrades can't change webhook payloads
    // under us. `apiVersion` accepts the dated release string.
    _stripe = new Stripe(CONFIG.stripeSecretKey, { apiVersion: "2026-05-27.dahlia" });
  }
  return _stripe;
}

/** The recurring Price id to charge a couple, picked by its display currency.
 *  USD falls back to the EUR price (we only sell the plan in EUR/HUF for now). */
export function priceIdForCurrency(currency: Currency): string {
  const id = currency === "HUF" ? CONFIG.stripePriceHuf : CONFIG.stripePriceEur;
  if (!id) {
    throw new HttpError(503, "No Stripe price configured for this currency", {
      code: "billing_price_missing",
    });
  }
  return id;
}

/** The one-time Price id for the guest-page edit add-on, picked by the couple's
 *  currency (USD → EUR, like the subscription price). */
export function guestPageAddonPriceId(currency: Currency): string {
  const id =
    currency === "HUF" ? CONFIG.stripeGuestPageAddonPriceHuf : CONFIG.stripeGuestPageAddonPriceEur;
  if (!id) {
    throw new HttpError(503, "Guest-page add-on is not configured", {
      code: "addon_price_missing",
    });
  }
  return id;
}

// ── Founding-member eligibility ─────────────────────────────────────────────
/** Founding-cohort badges granted so far. The first-FOUNDING_CAP cap is filled
 *  in partner-join order: a couple consumes a slot only once BOTH partners have
 *  joined and it is granted the founding plan (see activatePartnerFreeWindow).
 *  The badge is permanent — an expired free window never frees the slot back
 *  up. Admin comps (`is_founding_member = 0`) and demo couples don't count. */
export function foundingSlotsUsed(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 0 AND is_founding_member = 1")
    .get() as { n: number };
  return row.n;
}

/** True while founding slots remain (fewer than FOUNDING_CAP granted). Whether
 *  a *specific* couple gets one is decided at partner-join time, first-come. */
export function isFoundingEligible(): boolean {
  return foundingSlotsUsed() < FOUNDING_CAP;
}

/** Count of real couples that currently hold a live founding membership. Used
 *  by the public "spots left" counter and the admin planner. */
export function activeFoundingCount(nowMs: number = Date.now()): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM couples
        WHERE is_demo = 0 AND is_founding_member = 1
          AND founding_until IS NOT NULL AND founding_until > ?`,
    )
    .get(nowMs) as { n: number };
  return row.n;
}

// ── Global enforcement switch ───────────────────────────────────────────────
/** Flip the global read-only paywall on or off. Off (default) defers the freeze
 *  so nobody is locked out; on makes lapsed couples read-only. Stamped with the
 *  admin who flipped it. The read side is `billingEnforcementOn()` in db.ts. */
export function setBillingEnforcement(on: boolean, adminUserId: number): void {
  db.prepare(
    `UPDATE billing_control
        SET enforcement_on = ?, enforced_at = ?, enforced_by_user_id = ?
      WHERE id = 1`,
  ).run(on ? 1 : 0, now(), adminUserId);
}

// ── State transitions ───────────────────────────────────────────────────────
/** Start the in-app trial. Called at onboarding for brand-new couples.
 *  The free window runs at least 14 days, but never ends before the public
 *  paid-launch date, so during the pre-launch period every solo workspace is
 *  free until then (the "free until Aug 1" promise on the nudge banner). After
 *  launch it degrades to the plain 14-day trial.
 *  Idempotent-ish: only writes when the couple is still in the default 'none'
 *  state so we never clobber a founding/active couple. */
export function startTrial(coupleId: number, nowMs: number = now()): void {
  const trialEnd = Math.max(nowMs + TRIAL_DURATION_MS, PAID_LAUNCH_DATE);
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'trialing', trial_ends_at = ?, updated_at = ?
      WHERE id = ? AND subscription_status = 'none'`,
  ).run(trialEnd, nowMs, coupleId);
}

/** Billing state for a brand-new couple at onboarding. A fresh couple has only
 *  partner A, so it always starts on the 14-day trial. The founding (free)
 *  plan is granted later — when partner B joins — and only while founding slots
 *  remain (see activatePartnerFreeWindow), so the first-FOUNDING_CAP cohort is
 *  counted by "both partners joined", not by couple-creation order. */
export function initBillingAtOnboarding(coupleId: number, nowMs: number = now()): void {
  startTrial(coupleId, nowMs);
}

/** Admin "free badge": comp a couple 18 months free regardless of the cap or
 *  partner state. Overwrites any current plan. NOT a first-200 founding member
 *  (`is_founding_member = 0`) so the admin list shows it as a plain comp
 *  ("Ingyenes"), distinct from the first-200 "free until wedding" cohort. */
export function grantFreeAccess(coupleId: number, nowMs: number = now()): void {
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'founding', is_founding_member = 0, founding_until = ?, updated_at = ?
      WHERE id = ?`,
  ).run(nowMs + FOUNDING_DURATION_MS, nowMs, coupleId);
}

/** Remove a comped free badge → no plan (workspace goes read-only until they
 *  subscribe). Used by the admin to revoke a manually-granted free badge. */
export function revokeFreeAccess(coupleId: number, nowMs: number = now()): void {
  db.prepare(
    `UPDATE couples
        SET subscription_status = 'none', is_founding_member = 0, founding_until = NULL, updated_at = ?
      WHERE id = ?`,
  ).run(nowMs, coupleId);
}

/** Parse a couple's stored wedding date (YYYY-MM-DD or null) to epoch ms, or
 *  null when unset/unparseable. */
function weddingMsOf(weddingDate: string | null): number | null {
  if (!weddingDate) return null;
  const ms = Date.parse(weddingDate);
  return Number.isNaN(ms) ? null : ms;
}

/** Grant the founding "free until your wedding day" plan when partner B joins.
 *  Inviting your partner is what unlocks the free platform — but only for the
 *  first FOUNDING_CAP couples to get BOTH partners in. Once the cohort is full
 *  this is a no-op and the couple stays on its trial → paid path. Also a no-op
 *  for demo couples, a couple already on a paid/founding plan, or a still-solo
 *  workspace. Returns whether founding was granted. */
/** Claim a Stripe webhook event id for processing. Returns true the first time
 *  an id is seen (caller should process the event) and false on every replay
 *  (caller should skip). Stripe delivers at-least-once and its dashboard resend
 *  + auto-retries WILL redeliver, so without this a stale subscription event
 *  re-applies old state — e.g. reviving a canceled couple. INSERT OR IGNORE +
 *  changes() makes the check-and-claim a single atomic step. The caller must
 *  only invoke this AFTER verifying the Stripe signature, so unsigned callers
 *  can't fill the ledger. */
export function claimStripeEvent(
  eventId: string,
  eventType: string,
  nowMs: number = now(),
): boolean {
  const r = db
    .prepare(
      "INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, received_at) VALUES (?, ?, ?)",
    )
    .run(eventId, eventType, nowMs);
  return r.changes > 0;
}

export function activatePartnerFreeWindow(coupleId: number, nowMs: number = now()): boolean {
  const couple = getCoupleById(coupleId);
  if (!couple || couple.is_demo) return false;
  // Founding is a per-OWNER property, earned once on the owner's FIRST workspace
  // (the billing anchor). NEVER mint a founding badge on a secondary event — it
  // would consume a FOUNDING_CAP slot per event and contradict the inheritance
  // verdict a secondary already rides via billingAnchorRow. A single-workspace
  // couple is its own anchor, so the common path is unaffected. Structural
  // guard: even a caller that hands us a secondary (e.g. a partner accepting an
  // invite that was created from a secondary workspace) can't grant here.
  if (!isBillingAnchor(couple)) return false;
  // Don't downgrade a paying subscriber or re-stamp an existing founder.
  if (["founding", "active", "past_due"].includes(couple.subscription_status)) return false;
  if (couple.partner_b_id == null) return false; // both partners required

  // The eligibility check (slots remaining) and the grant UPDATE must be
  // indivisible so the founding cohort can never overshoot FOUNDING_CAP. Bun's
  // event loop is single-threaded and bun:sqlite is synchronous, so today this
  // function already runs start-to-finish without interleaving — but wrapping
  // the count-read + write in one db.transaction() makes the atomicity explicit
  // and keeps it correct if a future refactor ever introduces an await between
  // the check and the write, or moves DB access off the main thread. The
  // eligibility re-check lives INSIDE the txn so it sees the latest committed
  // badge count, not a stale read from before the transaction opened.
  const grant = db.transaction(() => {
    if (!isFoundingEligible()) return false; // founding cohort full → stays on trial
    const until = partnerFreeWindowEnd(weddingMsOf(couple.wedding_date), nowMs);
    db.prepare(
      `UPDATE couples
          SET subscription_status = 'founding',
              is_founding_member = 1,
              founding_until = ?,
              updated_at = ?
        WHERE id = ?`,
    ).run(until, nowMs, coupleId);
    return true;
  });
  return grant();
}

/** Put an owner's founding verdict where the couple can actually use it: on the
 *  billing ANCHOR (their oldest workspace).
 *
 *  `activatePartnerFreeWindow` is the grant; this is the repair around it, and
 *  it exists because a badge can end up on the wrong workspace or on none at
 *  all while both partners are demonstrably in:
 *
 *   - **Stranded badge.** Before the anchor rule (2026-07-06) the grant landed
 *     on whatever workspace the invite happened to target. A badge sitting on a
 *     secondary delivers NOTHING — `toCoupleBilling` reads the anchor — while
 *     still consuming a FOUNDING_CAP slot. The couple sees "Próba" and pays
 *     after the trial, and the cohort is one seat smaller for everyone else.
 *   - **Anchor shift.** Pausing the first workspace (`status='deleting'`)
 *     promotes the next one to anchor, and the badge does not follow it.
 *   - **Partner arrived by propagation.** `propagatePartnerToOwnerWorkspaces`
 *     fills `partner_b_id` on the anchor but is deliberately billing-neutral,
 *     so an anchor can hold both partners and no verdict.
 *
 *  Moving a badge is slot-neutral (one owner holds at most one, and extras are
 *  cleared, which returns seats). Granting only happens when no badge exists
 *  anywhere in the owner's set, so this can never mint a second slot for the
 *  same owner. Idempotent: a healthy anchor returns "none" on every re-run. */
export function reconcileFoundingOnAnchor(
  ownerUserId: number,
  nowMs: number = now(),
): "moved" | "granted" | "none" {
  const owned = db
    .prepare(
      `SELECT c.*
         FROM couple_members cm
         JOIN couples c ON c.id = cm.couple_id
        WHERE cm.user_id = ? AND cm.role = 'owner' AND c.status != 'deleting'
        ORDER BY cm.created_at ASC, cm.couple_id ASC`,
    )
    .all(ownerUserId) as CoupleRow[];
  const anchor = owned[0];
  if (!anchor || anchor.is_demo) return "none";
  // Already settled: a founder, a subscriber, or someone mid-dunning. Never
  // touch a paying couple.
  if (["founding", "active", "past_due"].includes(anchor.subscription_status)) return "none";

  const stranded = owned.slice(1).filter((c) => c.is_founding_member === 1);
  if (stranded.length > 0) {
    const move = db.transaction(() => {
      for (const s of stranded) {
        db.prepare(
          `UPDATE couples
              SET is_founding_member = 0,
                  founding_until = NULL,
                  subscription_status = 'trialing',
                  updated_at = ?
            WHERE id = ?`,
        ).run(nowMs, s.id);
      }
      // The window is recomputed from the ANCHOR's own wedding date — the
      // secondary's date can be a different event (a civil ceremony weeks
      // earlier), and "free until your wedding day" means the wedding.
      db.prepare(
        `UPDATE couples
            SET subscription_status = 'founding',
                is_founding_member = 1,
                founding_until = ?,
                updated_at = ?
          WHERE id = ?`,
      ).run(partnerFreeWindowEnd(weddingMsOf(anchor.wedding_date), nowMs), nowMs, anchor.id);
    });
    move();
    return "moved";
  }

  // No badge anywhere in this owner's set: this is an ordinary first-time
  // grant, so it goes through the normal path — anchor guard, cohort cap and
  // all. A still-solo owner is refused there on `partner_b_id`.
  return activatePartnerFreeWindow(anchor.id, nowMs) ? "granted" : "none";
}

/** One-time-per-boot repair of the above across every owner. Idempotent and
 *  slot-safe (see `reconcileFoundingOnAnchor`), so it is fine on every reboot.
 *  Scoped to owners whose anchor is unsettled AND who have a partner somewhere,
 *  which is the only population that can be wrong. Returns counts for the log. */
export function backfillFoundingAnchor(nowMs: number = now()): {
  moved: number;
  granted: number;
} {
  const owners = db
    .prepare(
      `SELECT DISTINCT cm.user_id AS id
         FROM couple_members cm
         JOIN couples c ON c.id = cm.couple_id AND c.status != 'deleting' AND c.is_demo = 0
        WHERE cm.role = 'owner'
          AND EXISTS (
                SELECT 1 FROM couple_members mine
                  JOIN couples c2 ON c2.id = mine.couple_id AND c2.status != 'deleting'
                 WHERE mine.user_id = cm.user_id AND mine.role = 'owner'
                   AND (c2.partner_b_id IS NOT NULL OR c2.is_founding_member = 1))`,
    )
    .all() as { id: number }[];
  let moved = 0;
  let granted = 0;
  for (const o of owners) {
    const r = reconcileFoundingOnAnchor(o.id, nowMs);
    if (r === "moved") moved++;
    else if (r === "granted") granted++;
  }
  return { moved, granted };
}

/** Keep the founding cohort's "free until your wedding day" window pinned to
 *  the wedding date when the couple moves it. Only touches the first-200
 *  founding members (`founding` + `is_founding_member = 1`); admin comps
 *  (badge 0, fixed 18-month window) are left alone. No-op otherwise. */
export function refreshPartnerFreeWindow(coupleId: number, nowMs: number = now()): void {
  const couple = getCoupleById(coupleId);
  if (!couple || couple.is_demo) return;
  if (couple.subscription_status !== "founding" || !couple.is_founding_member) return;
  if (couple.partner_b_id == null) return;
  const until = partnerFreeWindowEnd(weddingMsOf(couple.wedding_date), nowMs);
  db.prepare("UPDATE couples SET founding_until = ?, updated_at = ? WHERE id = ?").run(
    until,
    nowMs,
    coupleId,
  );
}

// ── Stripe linkage lookups (used by the webhook) ────────────────────────────
export function getCoupleByStripeCustomer(customerId: string): CoupleRow | null {
  return (
    (db.prepare("SELECT * FROM couples WHERE stripe_customer_id = ?").get(customerId) as
      | CoupleRow
      | undefined) ?? null
  );
}

export function setStripeCustomerId(coupleId: number, customerId: string): void {
  db.prepare("UPDATE couples SET stripe_customer_id = ?, updated_at = ? WHERE id = ?").run(
    customerId,
    now(),
    coupleId,
  );
}

/** Apply a Stripe subscription's state to the couple. The webhook funnels
 *  every subscription lifecycle event through here. `status` is the Stripe
 *  status; we map the relevant ones onto our state machine. */
export function applySubscriptionState(
  coupleId: number,
  opts: {
    subscriptionId: string | null;
    stripeStatus: string;
    currentPeriodEnd: number | null; // epoch ms
  },
): void {
  let mapped: string;
  switch (opts.stripeStatus) {
    case "active":
    case "trialing": // Stripe-side trial → still a committed paying sub for us
      mapped = "active";
      break;
    case "past_due":
    case "unpaid":
      mapped = "past_due";
      break;
    case "canceled":
    case "incomplete_expired":
      mapped = "canceled";
      break;
    default:
      mapped = "past_due"; // incomplete / paused → treat as needs-attention
  }
  db.prepare(
    `UPDATE couples
        SET subscription_status = ?, stripe_subscription_id = ?, current_period_end = ?, updated_at = ?
      WHERE id = ?`,
  ).run(mapped, opts.subscriptionId, opts.currentPeriodEnd, now(), coupleId);
}

// ── Guest-page add-on (planner-managed couples) ─────────────────────────────
/** Mark the couple's 30% share as paid (the 70%-off add-on checkout completed).
 *  This is the precondition the planner needs before switching guest-page
 *  editing back on for the couple — it does NOT grant edit access by itself. */
export function markGuestPagePrepaid(coupleId: number, nowMs: number = now()): void {
  db.prepare("UPDATE couples SET guest_page_prepaid = 1, updated_at = ? WHERE id = ?").run(
    nowMs,
    coupleId,
  );
}

// ── Entitlement guard ───────────────────────────────────────────────────────
/** Throw 402 when the couple may not edit (trial/founding lapsed, no sub). Use
 *  on write endpoints that should be read-only once billing lapses. Returns the
 *  couple row so callers can keep using it. */
export function requireEntitledCouple(ctx: Ctx): CoupleRow {
  if (!ctx.userId) throw new HttpError(401, "Not authenticated");
  const couple = getCoupleForUser(ctx.userId);
  if (!couple) throw new HttpError(400, "No couple workspace yet");
  const billing = toCoupleBilling(couple);
  if (!billing.entitled) {
    throw new HttpError(402, "Subscription required", {
      code: "subscription_required",
      reason: billing.reason,
    });
  }
  return couple;
}

// Couple-workspace EDIT surfaces. A mutating request (POST/PUT/PATCH/DELETE) to
// any of these is refused with 402 once the couple's billing lapses, making the
// workspace read-only. Deliberately EXCLUDED so a read-only couple can still
// recover or wind down: auth/*, account/*, billing/*, couples/pause*,
// couples/invites*, couples/onboard, exports/* (read-only export is allowed),
// and every public/guest surface (rsvp/*, unsubscribe/*, suppliers/community).
export const EDIT_PREFIXES: readonly string[] = [
  "/api/budget",
  "/api/guests",
  "/api/guest-messages",
  "/api/households",
  "/api/seating",
  "/api/schedule",
  "/api/wishlist",
  "/api/received-gifts",
  "/api/planning",
  "/api/picks",
  "/api/saved-suppliers",
  "/api/couple-suppliers",
  "/api/couples/supplier-costs",
  "/api/accommodations",
  "/api/transfers",
  "/api/bookings",
  "/api/moodboard",
  "/api/couples/current",
];
export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// The subset of edit surfaces the guest-page (vendégoldal) add-on unlocks for a
// couple member of a planner-managed couple. The guest-page / website config
// (intro, cover, publish toggle, venue, wishlist publish) is edited through
// PATCH /api/couples/current and the cover upload at /api/couples/current/cover.
// EXACT paths only — NOT a prefix — so sibling sub-routes like
// /api/couples/current/archive (which starts the delete countdown) stay locked
// for a viewer-only member. PATCH /api/couples/current is additionally
// field-scoped to guest-page fields in handleUpdateCurrentCouple, so the add-on
// cannot reach currency / dates / budget / names on the couple record.
const GUEST_PAGE_ADDON_PATHS: ReadonlySet<string> = new Set([
  "/api/couples/current",
  "/api/couples/current/cover",
  // The two fixed-slot site photos are guest-page content, same as the cover.
  "/api/couples/current/site-photo/1",
  "/api/couples/current/site-photo/2",
]);

export function onAnyPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True when `userId` is a planner actively managing `coupleId` (an active
 *  planner_clients link). A managing planner is the editing party for a
 *  planner-managed couple, so their edits are never billing-blocked. */
export function isManagingPlanner(userId: number, coupleId: number): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM users u
            JOIN planner_clients pc
              ON pc.planner_user_id = u.id AND pc.couple_id = ? AND pc.status = 'active'
           WHERE u.id = ? AND u.user_type = 'planner'
           LIMIT 1`,
      )
      .get(coupleId, userId) != null
  );
}

/** Central read-only gate, called from the request pipeline. Returns the
 *  blocking billing reason when an edit should be refused, or null to proceed.
 *
 *  Planner-managed couples layer on top of the plain subscription gate:
 *   - The managing PLANNER always edits (their access rides the planner
 *     relationship, not the couple's consumer subscription).
 *   - A COUPLE MEMBER whose own free window has lapsed becomes viewer-only on a
 *     planner-managed couple — the planner does the editing — EXCEPT their own
 *     guest page once the 70%-off add-on is switched on.
 *  Demo couples and couples still in trial/founding/active proceed as before. */
export function entitlementBlock(
  method: string,
  pathname: string,
  userId: number | null,
): BillingReason | null {
  if (!userId || !MUTATING_METHODS.has(method)) return null;
  if (!onAnyPrefix(pathname, EDIT_PREFIXES)) return null;
  const couple = getCoupleForUser(userId);
  if (!couple) return null; // no workspace yet → nothing to gate

  // The managing planner is never blocked — they edit on the couple's behalf.
  if (isManagingPlanner(userId, couple.id)) return null;

  const billing = toCoupleBilling(couple);
  if (billing.entitled) return null;

  // Couple member, own free window lapsed. On a planner-managed couple this is
  // viewer mode: blocked everywhere except the guest page when the add-on is on.
  if (billing.planner_managed) {
    if (billing.guest_page_addon && GUEST_PAGE_ADDON_PATHS.has(pathname)) return null;
    return "planner_managed_viewer";
  }

  return billing.reason;
}
