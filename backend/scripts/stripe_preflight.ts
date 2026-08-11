// Read-only Stripe go-live preflight. It validates the account, every configured
// Price, and the three webhook endpoints without creating customers or charges.
// Secret values are never printed.
//
// Usage:
//   STRIPE_PREFLIGHT_MODE=test bun run preflight:stripe
//   STRIPE_PREFLIGHT_MODE=live bun run preflight:stripe

import Stripe from "stripe";
import { GUEST_PAGE_ADDON_PRICE, MONTHLY_PRICE } from "../../shared/billing";
import { PLANNER_TIER_PRICE } from "../../shared/planner_billing";
import type { PlannerPlan } from "../../shared/types";
import { VENDOR_MONTHLY_PRICE } from "../../shared/vendor_billing";

type PreflightMode = "test" | "live";
type PriceSpec = {
  label: string;
  env: string;
  id: string;
  currency: "eur" | "huf";
  unitAmount: number;
  recurring: boolean;
};

const failures: string[] = [];
const warnings: string[] = [];
const ok = (message: string) => console.log(`  OK  ${message}`);
const fail = (message: string) => {
  failures.push(message);
  console.error(`  FAIL  ${message}`);
};
const warn = (message: string) => {
  warnings.push(message);
  console.warn(`  WARN  ${message}`);
};

const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const requestedMode = process.env.STRIPE_PREFLIGHT_MODE;
if (requestedMode !== "test" && requestedMode !== "live") {
  console.error("Set STRIPE_PREFLIGHT_MODE=test or STRIPE_PREFLIGHT_MODE=live");
  process.exit(1);
}
const mode: PreflightMode = requestedMode;
const keyIsLive = key.startsWith("sk_live_") || key.startsWith("rk_live_");
const keyIsTest = key.startsWith("sk_test_") || key.startsWith("rk_test_");
if (!key) fail("STRIPE_SECRET_KEY is missing");
else if (!keyIsLive && !keyIsTest) fail("STRIPE_SECRET_KEY has an unrecognised mode prefix");
else if ((mode === "live") !== keyIsLive) fail(`Stripe key does not match requested ${mode} mode`);
else ok(`Stripe key mode is ${mode}`);

const env = (name: string) => (process.env[name] ?? "").trim();
const cents = (displayAmount: number) => Math.round(displayAmount * 100);
const specs: PriceSpec[] = [
  {
    label: "Couple subscription EUR",
    env: "STRIPE_PRICE_EUR",
    id: env("STRIPE_PRICE_EUR"),
    currency: "eur",
    unitAmount: cents(MONTHLY_PRICE.EUR),
    recurring: true,
  },
  {
    label: "Couple subscription HUF",
    env: "STRIPE_PRICE_HUF",
    id: env("STRIPE_PRICE_HUF"),
    currency: "huf",
    unitAmount: cents(MONTHLY_PRICE.HUF),
    recurring: true,
  },
  {
    label: "Vendor subscription EUR",
    env: "STRIPE_PRICE_VENDOR_EUR",
    id: env("STRIPE_PRICE_VENDOR_EUR"),
    currency: "eur",
    unitAmount: cents(VENDOR_MONTHLY_PRICE.EUR),
    recurring: true,
  },
  {
    label: "Vendor subscription HUF",
    env: "STRIPE_PRICE_VENDOR_HUF",
    id: env("STRIPE_PRICE_VENDOR_HUF"),
    currency: "huf",
    unitAmount: cents(VENDOR_MONTHLY_PRICE.HUF),
    recurring: true,
  },
  {
    label: "Guest-page add-on EUR",
    env: "STRIPE_GUEST_PAGE_ADDON_PRICE_EUR",
    id: env("STRIPE_GUEST_PAGE_ADDON_PRICE_EUR"),
    currency: "eur",
    unitAmount: cents(GUEST_PAGE_ADDON_PRICE.EUR),
    recurring: false,
  },
  {
    label: "Guest-page add-on HUF",
    env: "STRIPE_GUEST_PAGE_ADDON_PRICE_HUF",
    id: env("STRIPE_GUEST_PAGE_ADDON_PRICE_HUF"),
    currency: "huf",
    unitAmount: cents(GUEST_PAGE_ADDON_PRICE.HUF),
    recurring: false,
  },
];

for (const tier of ["starter", "pro", "premium"] as const satisfies readonly PlannerPlan[]) {
  for (const currency of ["EUR", "HUF"] as const) {
    const envName = `STRIPE_PRICE_PLANNER_${tier.toUpperCase()}_${currency}`;
    specs.push({
      label: `Planner ${tier} ${currency}`,
      env: envName,
      id: env(envName),
      currency: currency.toLowerCase() as "eur" | "huf",
      unitAmount: cents(PLANNER_TIER_PRICE[tier][currency]),
      recurring: true,
    });
  }
}

const webhookSpecs = [
  {
    label: "Couple / film / add-on webhook",
    secretEnv: "STRIPE_WEBHOOK_SECRET",
    path: "/api/billing/webhook",
  },
  {
    label: "Planner webhook",
    secretEnv: "STRIPE_PLANNER_WEBHOOK_SECRET",
    path: "/api/planner/billing/webhook",
  },
  {
    label: "Vendor webhook",
    secretEnv: "STRIPE_VENDOR_WEBHOOK_SECRET",
    path: "/api/vendor/billing/webhook",
  },
] as const;

console.log(`Stripe preflight (${mode})`);
for (const spec of specs) {
  if (!spec.id) fail(`${spec.label}: ${spec.env} is missing`);
}
for (const spec of webhookSpecs) {
  const secret = env(spec.secretEnv);
  if (!secret) fail(`${spec.label}: ${spec.secretEnv} is missing`);
  else if (!secret.startsWith("whsec_"))
    fail(`${spec.label}: ${spec.secretEnv} is not a signing secret`);
  else ok(`${spec.label}: signing secret is present`);
}

if (key && (keyIsLive || keyIsTest)) {
  const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });

  console.log("\nAccount");
  try {
    const account = await stripe.accounts.retrieveCurrent();
    ok(`API connection (${account.id})`);
    if (mode === "live" && account.charges_enabled !== true)
      fail("Account charges are not enabled");
    else if (account.charges_enabled === true) ok("Account charges are enabled");
    if (mode === "live" && account.payouts_enabled !== true)
      warn("Account payouts are not enabled");
    else if (account.payouts_enabled === true) ok("Account payouts are enabled");
  } catch (error) {
    fail(`Account API check failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\nPrices");
  for (const spec of specs) {
    if (!spec.id) continue;
    try {
      const price = await stripe.prices.retrieve(spec.id, { expand: ["product"] });
      const issues: string[] = [];
      if (!price.active) issues.push("inactive");
      if (price.livemode !== keyIsLive) issues.push("mode mismatch");
      if (price.currency !== spec.currency)
        issues.push(`currency ${price.currency}, expected ${spec.currency}`);
      if (price.unit_amount !== spec.unitAmount) {
        issues.push(`amount ${price.unit_amount ?? "null"}, expected ${spec.unitAmount}`);
      }
      if (spec.recurring && price.recurring?.interval !== "month")
        issues.push("not monthly recurring");
      if (spec.recurring && price.recurring?.interval_count !== 1)
        issues.push("recurring interval count is not 1");
      if (!spec.recurring && price.type !== "one_time") issues.push("not one-time");
      if (typeof price.product !== "string" && price.product.deleted)
        issues.push("product deleted");
      if (typeof price.product !== "string" && !price.product.deleted && !price.product.active) {
        issues.push("product inactive");
      }
      if (issues.length > 0) fail(`${spec.label}: ${issues.join(", ")}`);
      else ok(`${spec.label} (${spec.id})`);
    } catch (error) {
      fail(`${spec.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log("\nWebhooks");
  const baseUrl = env("FRONTEND_BASE_URL").replace(/\/$/, "");
  if (!baseUrl.startsWith("https://") && mode === "live") {
    fail("FRONTEND_BASE_URL must be an https:// URL for live preflight");
  } else if (!baseUrl) {
    fail("FRONTEND_BASE_URL is missing");
  }
  if (baseUrl) {
    try {
      const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
      for (const spec of webhookSpecs) {
        const url = `${baseUrl}${spec.path}`;
        const endpoint = endpoints.data.find(
          (item) => item.url === url && item.status === "enabled",
        );
        if (!endpoint) fail(`${spec.label}: no enabled Stripe endpoint at ${url}`);
        else {
          const events = endpoint.enabled_events;
          const acceptsRequired =
            events.includes("*") ||
            [
              "checkout.session.completed",
              "customer.subscription.created",
              "customer.subscription.updated",
              "customer.subscription.deleted",
            ].every((event) =>
              events.includes(event as Stripe.WebhookEndpointCreateParams.EnabledEvent),
            );
          if (!acceptsRequired)
            fail(`${spec.label}: required checkout/subscription events are missing`);
          else ok(`${spec.label}: endpoint and required events are enabled`);
        }
      }
      warn(
        "Stripe cannot reveal signing secrets; send one signed test event to each endpoint before launch",
      );
    } catch (error) {
      fail(
        `Webhook endpoint check failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

console.log(`\nResult: ${failures.length} failure(s), ${warnings.length} warning(s)`);
if (failures.length > 0) process.exit(1);
