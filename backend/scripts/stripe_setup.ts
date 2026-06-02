// One-time Stripe setup: creates the "Weddly" product and the two recurring
// monthly Prices (EUR + HUF) that the billing code charges, then prints the
// price ids to drop into the environment as STRIPE_PRICE_EUR / STRIPE_PRICE_HUF.
//
// Usage (test mode first!):
//   STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup.ts
//
// Re-running creates NEW prices each time — run once per Stripe account/mode and
// keep the printed ids. Amounts must match shared/billing.ts MONTHLY_PRICE.
//
// Currency note: Stripe expects the amount in each currency's minor unit.
//   EUR 5.00 -> 500 (cents)
//   HUF      -> Stripe treats HUF with 2 decimals BUT requires whole-forint
//               amounts, so 1 990 Ft -> 199000 (must be divisible by 100).

import Stripe from "stripe";
import { MONTHLY_PRICE } from "../../shared/billing";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is required. Run with: STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup.ts",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const live = key.startsWith("sk_live_");
console.log(`[stripe_setup] mode: ${live ? "LIVE" : "test"}`);

const product = await stripe.products.create({
  name: "Weddly",
  description: "Weddly wedding-planning workspace — monthly subscription.",
});
console.log(`[stripe_setup] product: ${product.id}`);

const eur = await stripe.prices.create({
  product: product.id,
  currency: "eur",
  unit_amount: MONTHLY_PRICE.EUR * 100, // cents
  recurring: { interval: "month" },
  nickname: "Weddly monthly (EUR)",
});

const huf = await stripe.prices.create({
  product: product.id,
  currency: "huf",
  unit_amount: MONTHLY_PRICE.HUF * 100, // whole-forint, divisible by 100
  recurring: { interval: "month" },
  nickname: "Weddly monthly (HUF)",
});

console.log("\n[stripe_setup] Done. Set these env vars (Railway / backend/.env):\n");
console.log(`STRIPE_PRICE_EUR=${eur.id}`);
console.log(`STRIPE_PRICE_HUF=${huf.id}`);
console.log(
  "\nAlso set STRIPE_SECRET_KEY and, after creating the webhook endpoint\n" +
    "(POST {FRONTEND_BASE_URL}/api/billing/webhook for events:\n" +
    "checkout.session.completed, customer.subscription.created/updated/deleted),\n" +
    "set STRIPE_WEBHOOK_SECRET=whsec_...",
);
