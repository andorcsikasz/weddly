// One-off: create a new HUF Price at 990 on the existing Weddly product.
// Usage:
//   STRIPE_SECRET_KEY=sk_... STRIPE_PRICE_HUF=price_... bun backend/scripts/stripe_new_price_huf.ts
//
// The script looks up the product from the current STRIPE_PRICE_HUF, then
// creates a new 990 Ft monthly price on it. Prints the new price id to set
// as STRIPE_PRICE_HUF in Railway.

import Stripe from "stripe";
import { MONTHLY_PRICE } from "../../shared/billing";

const key = process.env.STRIPE_SECRET_KEY;
const existingPriceId = process.env.STRIPE_PRICE_HUF;

if (!key) {
  console.error("STRIPE_SECRET_KEY is required.");
  process.exit(1);
}
if (!existingPriceId) {
  console.error("STRIPE_PRICE_HUF is required (to look up the product id).");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const live = key.startsWith("sk_live_");
console.log(`[stripe_new_price_huf] mode: ${live ? "LIVE" : "test"}`);
console.log(`[stripe_new_price_huf] new HUF amount: ${MONTHLY_PRICE.HUF} Ft`);

const existing = await stripe.prices.retrieve(existingPriceId);
const productId = typeof existing.product === "string" ? existing.product : existing.product.id;
console.log(`[stripe_new_price_huf] product: ${productId}`);

const newPrice = await stripe.prices.create({
  product: productId,
  currency: "huf",
  unit_amount: MONTHLY_PRICE.HUF * 100,
  recurring: { interval: "month" },
  nickname: `Weddly monthly HUF ${MONTHLY_PRICE.HUF} Ft (early-access until Aug 15)`,
});

console.log("\n[stripe_new_price_huf] Done. Update this env var in Railway:\n");
console.log(`STRIPE_PRICE_HUF=${newPrice.id}`);
