// Runtime launch controls for each independent Stripe money path. Environment
// configuration says whether a product CAN work; this persisted switch says
// whether an admin has deliberately allowed it to create new payments.

import {
  PAYMENT_LAUNCH_PRODUCTS,
  type PaymentLaunchProduct,
  type PaymentLaunchesResponse,
  type PaymentLaunchState,
} from "@shared/admin_financial_planner";
import { GUEST_PAGE_ADDON_PRICE, MONTHLY_PRICE } from "@shared/billing";
import { PLANNER_TIER_PRICE } from "@shared/planner_billing";
import { VENDOR_MONTHLY_PRICE } from "@shared/vendor_billing";
import { CONFIG, REQUIRE_PROD_HARDENING } from "../config";
import { db, now } from "../db";
import { HttpError } from "../lib/http";
import { stripe } from "./billing";

interface LaunchRow {
  product: PaymentLaunchProduct;
  enabled: number;
  version: number;
  updated_at: number | null;
  updated_by_user_id: number | null;
}

// Recurring checkout still lacks a product-specific, point-of-purchase terms
// acceptance ledger for couples, planners, and vendors. This is deliberately
// a code-owned gate rather than an environment flag: deployment configuration
// must not be able to assert that an unimplemented contract boundary exists.
// Remove this prerequisite only in the same change that implements and tests
// exact-version checkout acceptance for all three products.
const RECURRING_CHECKOUT_CONTRACT_READY = false;
const recurringContract: [string, string] = [
  "PAID_CHECKOUT_TERMS_ACCEPTANCE",
  RECURRING_CHECKOUT_CONTRACT_READY ? "implemented" : "",
];

function requiredConfig(product: PaymentLaunchProduct): Array<[name: string, value: string]> {
  const secret: [string, string] = ["STRIPE_SECRET_KEY", CONFIG.stripeSecretKey];
  const legalApproval: [string, string] = [
    "LEGAL_PAID_LAUNCH_APPROVED",
    CONFIG.legalPaidLaunchApproved ? "1" : "",
  ];
  switch (product) {
    case "couple_subscriptions":
      return [
        recurringContract,
        legalApproval,
        secret,
        ["STRIPE_WEBHOOK_SECRET", CONFIG.stripeWebhookSecret],
        ["STRIPE_PRICE_EUR", CONFIG.stripePriceEur],
        ["STRIPE_PRICE_HUF", CONFIG.stripePriceHuf],
      ];
    case "planner_subscriptions":
      return [
        recurringContract,
        legalApproval,
        secret,
        ["STRIPE_PLANNER_WEBHOOK_SECRET", CONFIG.stripePlannerWebhookSecret],
        ["STRIPE_PRICE_PLANNER_STARTER_EUR", CONFIG.stripePricePlanner.starter.EUR],
        ["STRIPE_PRICE_PLANNER_STARTER_HUF", CONFIG.stripePricePlanner.starter.HUF],
        ["STRIPE_PRICE_PLANNER_PRO_EUR", CONFIG.stripePricePlanner.pro.EUR],
        ["STRIPE_PRICE_PLANNER_PRO_HUF", CONFIG.stripePricePlanner.pro.HUF],
        ["STRIPE_PRICE_PLANNER_PREMIUM_EUR", CONFIG.stripePricePlanner.premium.EUR],
        ["STRIPE_PRICE_PLANNER_PREMIUM_HUF", CONFIG.stripePricePlanner.premium.HUF],
      ];
    case "vendor_billing":
      return [
        recurringContract,
        legalApproval,
        secret,
        ["STRIPE_VENDOR_WEBHOOK_SECRET", CONFIG.stripeVendorWebhookSecret],
        ["STRIPE_PRICE_VENDOR_EUR", CONFIG.stripePriceVendorEur],
        ["STRIPE_PRICE_VENDOR_HUF", CONFIG.stripePriceVendorHuf],
      ];
    case "film_checkout":
      // Film uses inline price_data but is fulfilled by the couple webhook.
      return [legalApproval, secret, ["STRIPE_WEBHOOK_SECRET", CONFIG.stripeWebhookSecret]];
    case "guest_page_addon":
      return [
        legalApproval,
        secret,
        ["STRIPE_WEBHOOK_SECRET", CONFIG.stripeWebhookSecret],
        ["STRIPE_GUEST_PAGE_ADDON_PRICE_EUR", CONFIG.stripeGuestPageAddonPriceEur],
        ["STRIPE_GUEST_PAGE_ADDON_PRICE_HUF", CONFIG.stripeGuestPageAddonPriceHuf],
      ];
  }
}

export function paymentLaunchReadiness(product: PaymentLaunchProduct): {
  ready: boolean;
  missing: string[];
} {
  const missing = requiredConfig(product)
    .filter(([, value]) => value.trim() === "")
    .map(([name]) => name);
  return { ready: missing.length === 0, missing };
}

type PriceExpectation = {
  id: string;
  label: string;
  currency: "eur" | "huf";
  unitAmount: number;
  recurring: boolean;
};

const minorAmount = (displayAmount: number) => Math.round(displayAmount * 100);

function expectedPrices(product: PaymentLaunchProduct): PriceExpectation[] {
  switch (product) {
    case "couple_subscriptions":
      return [
        {
          id: CONFIG.stripePriceEur,
          label: "couple EUR",
          currency: "eur",
          unitAmount: minorAmount(MONTHLY_PRICE.EUR),
          recurring: true,
        },
        {
          id: CONFIG.stripePriceHuf,
          label: "couple HUF",
          currency: "huf",
          unitAmount: minorAmount(MONTHLY_PRICE.HUF),
          recurring: true,
        },
      ];
    case "planner_subscriptions":
      return (["starter", "pro", "premium"] as const).flatMap((tier) => [
        {
          id: CONFIG.stripePricePlanner[tier].EUR,
          label: `planner ${tier} EUR`,
          currency: "eur" as const,
          unitAmount: minorAmount(PLANNER_TIER_PRICE[tier].EUR),
          recurring: true,
        },
        {
          id: CONFIG.stripePricePlanner[tier].HUF,
          label: `planner ${tier} HUF`,
          currency: "huf" as const,
          unitAmount: minorAmount(PLANNER_TIER_PRICE[tier].HUF),
          recurring: true,
        },
      ]);
    case "vendor_billing":
      return [
        {
          id: CONFIG.stripePriceVendorEur,
          label: "vendor EUR",
          currency: "eur",
          unitAmount: minorAmount(VENDOR_MONTHLY_PRICE.EUR),
          recurring: true,
        },
        {
          id: CONFIG.stripePriceVendorHuf,
          label: "vendor HUF",
          currency: "huf",
          unitAmount: minorAmount(VENDOR_MONTHLY_PRICE.HUF),
          recurring: true,
        },
      ];
    case "guest_page_addon":
      return [
        {
          id: CONFIG.stripeGuestPageAddonPriceEur,
          label: "guest-page add-on EUR",
          currency: "eur",
          unitAmount: minorAmount(GUEST_PAGE_ADDON_PRICE.EUR),
          recurring: false,
        },
        {
          id: CONFIG.stripeGuestPageAddonPriceHuf,
          label: "guest-page add-on HUF",
          currency: "huf",
          unitAmount: minorAmount(GUEST_PAGE_ADDON_PRICE.HUF),
          recurring: false,
        },
      ];
    case "film_checkout":
      return [];
  }
}

function launchValidationError(product: PaymentLaunchProduct, issue: string): never {
  throw new HttpError(409, "Stripe validation failed; payment option was not launched", {
    code: "payment_validation_failed",
    product,
    issue,
  });
}

/** Pure Stripe Price shape validator, exported so amount/mode/cadence safety is
 * covered without contacting Stripe in the test process. */
export function paymentPriceValidationIssues(
  expected: {
    currency: "eur" | "huf";
    unitAmount: number;
    recurring: boolean;
    live: boolean;
  },
  actual: {
    active: boolean;
    live: boolean;
    currency: string;
    unitAmount: number | null;
    type: string;
    interval: string | null;
    intervalCount: number | null;
    productActive: boolean;
  },
): string[] {
  const issues: string[] = [];
  if (!actual.active) issues.push("price inactive");
  if (actual.live !== expected.live) issues.push("mode mismatch");
  if (actual.currency !== expected.currency) issues.push(`currency must be ${expected.currency}`);
  if (actual.unitAmount !== expected.unitAmount)
    issues.push(`amount must be ${expected.unitAmount}`);
  if (expected.recurring && actual.interval !== "month") issues.push("price must recur monthly");
  if (expected.recurring && actual.intervalCount !== 1) {
    issues.push("price must recur every one month");
  }
  if (!expected.recurring && actual.type !== "one_time") issues.push("price must be one-time");
  if (!actual.productActive) issues.push("product inactive or deleted");
  return issues;
}

/** Live, read-only validation performed immediately before an OFF -> ON change.
 * Unit tests stay hermetic; deployed environments additionally require a live
 * key. This complements the fast status snapshot, which intentionally reports
 * only whether required configuration values are present. */
export async function validatePaymentLaunchActivation(
  product: PaymentLaunchProduct,
): Promise<void> {
  const configured = paymentLaunchReadiness(product);
  if (!configured.ready) {
    launchValidationError(product, `missing configuration: ${configured.missing.join(", ")}`);
  }
  const key = CONFIG.stripeSecretKey;
  const liveKey = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  const testKey = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!liveKey && !testKey) launchValidationError(product, "unrecognised Stripe key mode");
  if (REQUIRE_PROD_HARDENING && !liveKey) {
    launchValidationError(product, "deployed environments require a live Stripe key");
  }

  const webhookSecret =
    product === "planner_subscriptions"
      ? CONFIG.stripePlannerWebhookSecret
      : product === "vendor_billing"
        ? CONFIG.stripeVendorWebhookSecret
        : CONFIG.stripeWebhookSecret;
  if (!webhookSecret.startsWith("whsec_")) {
    launchValidationError(product, "webhook signing secret has an invalid format");
  }

  // API tests use deliberate fake price ids. The network integration path is
  // exercised manually by the read-only Stripe preflight; tests must remain
  // hermetic and never contact Stripe.
  if (process.env.NODE_ENV === "test") return;

  const client = stripe();
  try {
    const account = await client.accounts.retrieveCurrent();
    if (REQUIRE_PROD_HARDENING && account.charges_enabled !== true) {
      launchValidationError(product, "Stripe account charges are not enabled");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // Restricted keys may intentionally omit Account read access. Price reads
    // below still prove the key and the exact resources needed by checkout.
    if (expectedPrices(product).length === 0) {
      try {
        await client.prices.list({ limit: 1 });
      } catch {
        launchValidationError(
          product,
          `Stripe API is unreachable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  for (const expected of expectedPrices(product)) {
    try {
      const price = await client.prices.retrieve(expected.id, { expand: ["product"] });
      const productActive =
        typeof price.product === "string" ? true : !price.product.deleted && price.product.active;
      const issues = paymentPriceValidationIssues(
        {
          currency: expected.currency,
          unitAmount: expected.unitAmount,
          recurring: expected.recurring,
          live: liveKey,
        },
        {
          active: price.active,
          live: price.livemode,
          currency: price.currency,
          unitAmount: price.unit_amount,
          type: price.type,
          interval: price.recurring?.interval ?? null,
          intervalCount: price.recurring?.interval_count ?? null,
          productActive,
        },
      );
      if (issues.length > 0)
        launchValidationError(product, `${expected.label}: ${issues.join(", ")}`);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      launchValidationError(
        product,
        `${expected.label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function rowFor(product: PaymentLaunchProduct): LaunchRow {
  const row = db
    .prepare(
      `SELECT product, enabled, version, updated_at, updated_by_user_id
         FROM payment_launch_control WHERE product = ?`,
    )
    .get(product) as LaunchRow | undefined;
  // Defensive for databases restored from a partially-migrated snapshot.
  if (row) return row;
  db.prepare("INSERT OR IGNORE INTO payment_launch_control (product, enabled) VALUES (?, 0)").run(
    product,
  );
  return {
    product,
    enabled: 0,
    version: 0,
    updated_at: null,
    updated_by_user_id: null,
  };
}

export function paymentLaunchState(product: PaymentLaunchProduct): PaymentLaunchState {
  const row = rowFor(product);
  const readiness = paymentLaunchReadiness(product);
  return {
    product,
    enabled: row.enabled === 1,
    version: row.version,
    ...readiness,
    updated_at: row.updated_at,
    updated_by_user_id: row.updated_by_user_id,
  };
}

export function paymentLaunches(): PaymentLaunchesResponse {
  const entries = PAYMENT_LAUNCH_PRODUCTS.map(
    (product) => [product, paymentLaunchState(product)] as const,
  );
  return {
    generated_at: now(),
    products: Object.fromEntries(entries) as PaymentLaunchesResponse["products"],
  };
}

/** True only when both the operator switch and the complete static
 * configuration are present. Useful for public status payloads. */
export function paymentProductAvailable(product: PaymentLaunchProduct): boolean {
  const state = paymentLaunchState(product);
  return state.enabled && state.ready;
}

/** Fail closed before any Stripe customer/session/subscription can be created. */
export function requirePaymentLaunch(product: PaymentLaunchProduct): void {
  const state = paymentLaunchState(product);
  if (!state.enabled) {
    throw new HttpError(503, "This payment option has not launched yet", {
      code: "payment_not_launched",
      product,
    });
  }
  if (!state.ready) {
    throw new HttpError(503, "This payment option is not fully configured", {
      code: "payment_not_ready",
      product,
    });
  }
}

export function setPaymentLaunch(
  product: PaymentLaunchProduct,
  enabled: boolean,
  adminUserId: number,
  expectedVersion: number,
): PaymentLaunchState {
  const before = paymentLaunchState(product);
  if (before.version !== expectedVersion) {
    throw new HttpError(409, "Payment launch state changed; refresh and try again", {
      code: "payment_launch_conflict",
      product,
      current: before,
    });
  }
  // A current no-op is a successful idempotent request: there is no state
  // change to version or audit. The caller's version was still validated.
  if (before.enabled === enabled) return before;

  const readiness = paymentLaunchReadiness(product);
  if (enabled && !readiness.ready) {
    throw new HttpError(409, "Payment option is not ready to launch", {
      code: "payment_not_ready",
      product,
      missing: readiness.missing,
    });
  }

  const result = db
    .prepare(
      `UPDATE payment_launch_control
        SET enabled = ?, version = version + 1,
            updated_at = ?, updated_by_user_id = ?
      WHERE product = ? AND version = ?`,
    )
    .run(enabled ? 1 : 0, now(), adminUserId, product, expectedVersion);
  if (result.changes !== 1) {
    // The compare-and-swap is the final authority even if another database
    // connection changed the row between our read and write.
    throw new HttpError(409, "Payment launch state changed; refresh and try again", {
      code: "payment_launch_conflict",
      product,
      current: paymentLaunchState(product),
    });
  }
  return paymentLaunchState(product);
}

export function isPaymentLaunchProduct(value: unknown): value is PaymentLaunchProduct {
  return (
    typeof value === "string" && (PAYMENT_LAUNCH_PRODUCTS as readonly string[]).includes(value)
  );
}
