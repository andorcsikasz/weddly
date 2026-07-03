// Mint fresh HUF + EUR monthly Prices at the current shared/billing.ts
// MONTHLY_PRICE amounts on the EXISTING Weddly product. Run this whenever the
// price changes (Stripe Prices are immutable — a change always means a new
// Price id), then set the printed ids in Railway. Existing subscriptions stay
// on their old Price; only new checkouts pick these up.
//
// Usage (test first, then live):
//   STRIPE_SECRET_KEY=sk_... STRIPE_PRICE_HUF=price_... STRIPE_PRICE_EUR=price_... \
//     bun backend/scripts/stripe_new_prices.ts

import Stripe from "stripe";
import { MONTHLY_PRICE } from "../../shared/billing";

const key = process.env.STRIPE_SECRET_KEY;
const existing = {
  huf: process.env.STRIPE_PRICE_HUF,
  eur: process.env.STRIPE_PRICE_EUR,
};

if (!key) {
  console.error("STRIPE_SECRET_KEY is required.");
  process.exit(1);
}
if (!existing.huf || !existing.eur) {
  console.error("STRIPE_PRICE_HUF and STRIPE_PRICE_EUR are required (to look up the product).");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const live = key.startsWith("sk_live_");
console.log(`[stripe_new_prices] mode: ${live ? "LIVE" : "test"}`);
console.log(
  `[stripe_new_prices] amounts: ${MONTHLY_PRICE.HUF} Ft / ${MONTHLY_PRICE.EUR} EUR per month`,
);

async function mint(currency: "huf" | "eur", fromPriceId: string, unitAmount: number) {
  const from = await stripe.prices.retrieve(fromPriceId);
  const productId = typeof from.product === "string" ? from.product : from.product.id;
  const price = await stripe.prices.create({
    product: productId,
    currency,
    unit_amount: unitAmount,
    recurring: { interval: "month" },
    nickname: `Weddly monthly ${currency.toUpperCase()} ${currency === "huf" ? `${MONTHLY_PRICE.HUF} Ft` : `${MONTHLY_PRICE.EUR} EUR`}`,
  });
  return price.id;
}

const hufId = await mint("huf", existing.huf, MONTHLY_PRICE.HUF * 100); // whole-forint, x100
const eurId = await mint("eur", existing.eur, MONTHLY_PRICE.EUR * 100); // cents

console.log("\n[stripe_new_prices] Done. Update these env vars in Railway:\n");
console.log(`STRIPE_PRICE_HUF=${hufId}`);
console.log(`STRIPE_PRICE_EUR=${eurId}`);
