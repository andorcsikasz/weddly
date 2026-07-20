// Reprice ONE currency's monthly Weddly Price without creating a new product.
//
// Stripe Prices are immutable: you cannot edit `unit_amount`. To change what a
// live checkout charges you mint a NEW Price on the SAME product and repoint the
// env var. This is the surgical tool for that — unlike stripe_setup.ts it does
// NOT create a second "Weddly" product or churn the other currencies' prices.
//
// The new amount is read from shared/billing.ts MONTHLY_PRICE, so bump that
// constant FIRST (it's the app's display/forecast figure) and this keeps Stripe
// in sync with it.
//
// Usage — TEST mode first, ALWAYS:
//   STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_HUF=price_currentId \
//     bun backend/scripts/stripe_reprice.ts huf
//
// It finds the product from the price you pass in STRIPE_PRICE_<CUR>, mints the
// new price, archives the old one (so no fresh checkout can pick it up), and
// prints the env line to set in Railway. Archiving does NOT change what current
// subscribers are billed — an existing subscription keeps its old price until
// you migrate it deliberately. So new signups get 2 490 Ft immediately; anyone
// already paying 1 990 Ft stays there unless separately moved.

import Stripe from "stripe";
import type { BillingCurrency } from "../../shared/currency";
import { MONTHLY_PRICE } from "../../shared/billing";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is required. Run with: STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_HUF=price_... bun backend/scripts/stripe_reprice.ts huf",
  );
  process.exit(1);
}

const arg = (process.argv[2] ?? "huf").toUpperCase();
if (!(arg in MONTHLY_PRICE)) {
  console.error(`Unknown currency "${arg}". Known: ${Object.keys(MONTHLY_PRICE).join(", ")}`);
  process.exit(1);
}
const currency = arg as BillingCurrency;

const currentPriceId = process.env[`STRIPE_PRICE_${currency}`];
if (!currentPriceId) {
  console.error(
    `STRIPE_PRICE_${currency} must point at the price you're replacing — it's how the script finds the product to reprice.`,
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const live = key.startsWith("sk_live_");
console.log(`[stripe_reprice] mode: ${live ? "LIVE" : "test"} · currency: ${currency}`);

const current = await stripe.prices.retrieve(currentPriceId);
const productId = typeof current.product === "string" ? current.product : current.product.id;
console.log(`[stripe_reprice] product: ${productId}`);
console.log(
  `[stripe_reprice] current: ${current.unit_amount} ${current.currency} (id ${current.id})`,
);

// Uniform × 100: EUR/USD to cents, HUF to the whole-forint amount Stripe wants
// (it treats HUF as 2-decimal but requires the value divisible by 100).
const unitAmount = MONTHLY_PRICE[currency] * 100;
const created = await stripe.prices.create({
  product: productId,
  currency: currency.toLowerCase(),
  unit_amount: unitAmount,
  recurring: { interval: "month" },
  nickname: `Weddly monthly (${currency})`,
});
console.log(
  `[stripe_reprice] new price: ${created.id} = ${unitAmount} ${currency.toLowerCase()} (${MONTHLY_PRICE[currency]} ${currency})`,
);

// Archive the old price so it can't back a new checkout. Existing subscriptions
// on it are untouched and keep billing until migrated.
await stripe.prices.update(currentPriceId, { active: false });
console.log(`[stripe_reprice] archived old price ${currentPriceId}`);

console.log("\n[stripe_reprice] Done. Set this in Railway (and backend/.env for local):\n");
console.log(`STRIPE_PRICE_${currency}=${created.id}`);
