// One-time Stripe setup for PLANNER billing: creates the "Weddly Planner" product
// and six recurring monthly Prices (3 tiers × EUR/HUF), then prints the price ids
// to drop into the environment as STRIPE_PRICE_PLANNER_<TIER>_<CCY>.
//
// Usage (test mode first!):
//   STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup_planner.ts
//
// Re-running creates NEW prices each time — run once per Stripe account/mode and
// keep the printed ids. Amounts must match shared/planner_billing.ts
// PLANNER_TIER_PRICE.
//
// Currency note: Stripe expects the amount in each currency's minor unit.
//   EUR 29.00 -> 2900 (cents)
//   HUF       -> Stripe treats HUF with 2 decimals BUT requires whole-forint
//                amounts, so 11 900 Ft -> 1190000 (must be divisible by 100).

import Stripe from "stripe";
import { PLANNER_TIER_PRICE } from "../../shared/planner_billing";
import type { PlannerPlan } from "../../shared/types";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is required. Run with: STRIPE_SECRET_KEY=sk_test_... bun backend/scripts/stripe_setup_planner.ts",
  );
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2026-05-27.dahlia" });
const live = key.startsWith("sk_live_");
console.log(`[stripe_setup_planner] mode: ${live ? "LIVE" : "test"}`);

const product = await stripe.products.create({
  name: "Weddly Planner",
  description: "Weddly planner workspace — monthly subscription (per tier).",
});
console.log(`[stripe_setup_planner] product: ${product.id}`);

const TIERS: PlannerPlan[] = ["starter", "pro", "premium"];
const envLines: string[] = [];

for (const tier of TIERS) {
  const eur = await stripe.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: PLANNER_TIER_PRICE[tier].EUR * 100, // cents
    recurring: { interval: "month" },
    nickname: `Weddly Planner ${tier} (EUR)`,
  });
  const huf = await stripe.prices.create({
    product: product.id,
    currency: "huf",
    unit_amount: PLANNER_TIER_PRICE[tier].HUF * 100, // whole-forint, divisible by 100
    recurring: { interval: "month" },
    nickname: `Weddly Planner ${tier} (HUF)`,
  });
  envLines.push(`STRIPE_PRICE_PLANNER_${tier.toUpperCase()}_EUR=${eur.id}`);
  envLines.push(`STRIPE_PRICE_PLANNER_${tier.toUpperCase()}_HUF=${huf.id}`);
}

console.log("\n[stripe_setup_planner] Done. Set these env vars (Railway / backend/.env):\n");
for (const line of envLines) console.log(line);
console.log(
  "\nAlso create a SEPARATE webhook endpoint\n" +
    "(POST {FRONTEND_BASE_URL}/api/planner/billing/webhook for events:\n" +
    "checkout.session.completed, customer.subscription.created/updated/deleted),\n" +
    "and set STRIPE_PLANNER_WEBHOOK_SECRET=whsec_... to its signing secret.",
);
