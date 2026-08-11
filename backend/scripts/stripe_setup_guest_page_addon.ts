// One-time Stripe setup for the planner-managed guest-page editing add-on.
// Creates one product and two one-time prices, then prints the Railway env vars.
//
// Usage (test mode first):
//   STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup_guest_page_addon.ts

import Stripe from "stripe";
import { GUEST_PAGE_ADDON_PRICE } from "../../shared/billing";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
console.log(
  `[stripe_setup_guest_page_addon] mode: ${key.startsWith("sk_live_") ? "LIVE" : "test"}`,
);

const product = await stripe.products.create({
  name: "Weddly Guest Page Unlock",
  description: "One-time guest-page editing unlock for a planner-managed couple.",
});

const eur = await stripe.prices.create({
  product: product.id,
  currency: "eur",
  unit_amount: Math.round(GUEST_PAGE_ADDON_PRICE.EUR * 100),
  nickname: "Weddly guest-page unlock (EUR)",
});
const huf = await stripe.prices.create({
  product: product.id,
  currency: "huf",
  unit_amount: GUEST_PAGE_ADDON_PRICE.HUF * 100,
  nickname: "Weddly guest-page unlock (HUF)",
});

console.log("\n[stripe_setup_guest_page_addon] Done. Set these env vars:\n");
console.log(`STRIPE_GUEST_PAGE_ADDON_PRICE_EUR=${eur.id}`);
console.log(`STRIPE_GUEST_PAGE_ADDON_PRICE_HUF=${huf.id}`);
console.log(
  "\nFulfilment uses POST {FRONTEND_BASE_URL}/api/billing/webhook. " +
    "Keep STRIPE_WEBHOOK_SECRET configured for that endpoint.",
);
