// One-time Stripe setup for VENDOR billing: creates the "Weddly Vendor" product
// and FOUR recurring Prices (monthly + annual, EUR/HUF), then prints the price
// ids to drop into the environment as STRIPE_PRICE_VENDOR_<CCY> (monthly) and
// STRIPE_PRICE_VENDOR_<CCY>_ANNUAL.
//
// Usage (test mode first!):
//   STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup_vendor.ts
//
// Re-running creates NEW prices each time: run once per Stripe account/mode and
// keep the printed ids. Amounts must match shared/vendor_billing.ts
// VENDOR_MONTHLY_PRICE / VENDOR_ANNUAL_PRICE (the annual price is exactly 25%
// off twelve months of the monthly price, never a separately-typed number).
//
// The annual price ids are OPTIONAL at the application level: leaving the
// *_ANNUAL env vars unset simply means the vendor billing page never offers
// the annual toggle, and the existing monthly-only launch is untouched.
//
// Currency note: Stripe expects the amount in each currency's minor unit.
//   EUR 10.00 -> 1000 (cents), EUR 90.00 -> 9000
//   HUF       -> Stripe treats HUF with 2 decimals BUT requires whole-forint
//                amounts, so 3 490 Ft -> 349000 (must be divisible by 100).

import Stripe from "stripe";
import { VENDOR_ANNUAL_PRICE, VENDOR_MONTHLY_PRICE } from "../../shared/vendor_billing";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is required. Run with: STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup_vendor.ts",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const live = key.startsWith("sk_live_");
console.log(`[stripe_setup_vendor] mode: ${live ? "LIVE" : "test"}`);

const product = await stripe.products.create({
  name: "Weddly Vendor",
  description: "Weddly vendor listing PRO, monthly subscription.",
});
console.log(`[stripe_setup_vendor] product: ${product.id}`);

const eur = await stripe.prices.create({
  product: product.id,
  currency: "eur",
  unit_amount: VENDOR_MONTHLY_PRICE.EUR * 100, // cents
  recurring: { interval: "month" },
  nickname: "Weddly Vendor PRO (EUR)",
});
const huf = await stripe.prices.create({
  product: product.id,
  currency: "huf",
  unit_amount: VENDOR_MONTHLY_PRICE.HUF * 100, // whole-forint, divisible by 100
  recurring: { interval: "month" },
  nickname: "Weddly Vendor PRO (HUF)",
});
const eurAnnual = await stripe.prices.create({
  product: product.id,
  currency: "eur",
  unit_amount: VENDOR_ANNUAL_PRICE.EUR * 100, // cents
  recurring: { interval: "year" },
  nickname: "Weddly Vendor PRO annual (EUR, -25%)",
});
const hufAnnual = await stripe.prices.create({
  product: product.id,
  currency: "huf",
  unit_amount: VENDOR_ANNUAL_PRICE.HUF * 100, // whole-forint, divisible by 100
  recurring: { interval: "year" },
  nickname: "Weddly Vendor PRO annual (HUF, -25%)",
});

console.log("\n[stripe_setup_vendor] Done. Set these env vars (Railway / backend/.env):\n");
console.log(`STRIPE_PRICE_VENDOR_EUR=${eur.id}`);
console.log(`STRIPE_PRICE_VENDOR_HUF=${huf.id}`);
console.log(`STRIPE_PRICE_VENDOR_EUR_ANNUAL=${eurAnnual.id}`);
console.log(`STRIPE_PRICE_VENDOR_HUF_ANNUAL=${hufAnnual.id}`);
console.log(
  "\nAlso create a SEPARATE webhook endpoint\n" +
    "(POST {FRONTEND_BASE_URL}/api/vendor/billing/webhook for events:\n" +
    "checkout.session.completed, customer.subscription.created/updated/deleted),\n" +
    "and set STRIPE_VENDOR_WEBHOOK_SECRET=whsec_... to its signing secret.",
);
