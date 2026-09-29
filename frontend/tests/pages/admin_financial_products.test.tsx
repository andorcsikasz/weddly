import { describe, expect, it } from "bun:test";
import { render, screen, within } from "@testing-library/react";
import type {
  AdminFinancialPlannerOverview,
  RecurringProductOverview,
} from "@shared/admin_financial_planner";
import { ProductsCard } from "@/pages/AdminFinancialPlannerPage";

const t = (key: string) => key;

const recurring: RecurringProductOverview = {
  counts: {},
  total: 0,
  paying: 0,
  annual: 0,
  mrr_by_currency: [],
  mrr_eur: 0,
  founding_active: 0,
  founding_spots_left: 0,
  founding_value_eur: 0,
  founding_expiry: [],
  trialing: 0,
  list_price_eur: 10,
};

function overview(): AdminFinancialPlannerOverview {
  return {
    mrr_eur_total: 70,
    total_couples: 40,
    paying_subscribers: 10,
    trialing: 5,
    founding_active: 3,
    founding_value_eur: 21,
    founding_spots_left: 150,
    founding_expiry: [],
    products: {
      vendors: {
        ...recurring,
        total: 12,
        paying: 4,
        mrr_eur: 40,
        founding_active: 6,
        founding_value_eur: 60,
        founding_expiry: [{ month: "2027-03", count: 6 }],
        early_active: 2,
        lead_window: 1,
        lead_credits_owed: 3,
        billing_scheduled: 1,
        billing_scheduled_mrr_eur: 10,
      },
      planners: {
        ...recurring,
        paying: 2,
        mrr_eur: 58,
        paying_by_tier: { starter: 0, pro: 2, premium: 0 },
      },
      camera: {
        sold: 9,
        sold_last_30d: 2,
        revenue_eur: 71,
        revenue_last_30d_eur: 16,
        owed: 4,
        albums_total: 30,
        uploads_total: 1200,
      },
      guest_page_addon: {
        sold: 1,
        sold_last_30d: 0,
        revenue_eur: 2,
        revenue_last_30d_eur: 0,
        owed: 1,
      },
      total_mrr_eur: 168,
      one_off_last_30d_eur: 16,
      total_founding_value_eur: 81,
      vat_embedded_eur: 39,
    },
  } as unknown as AdminFinancialPlannerOverview;
}

describe("ProductsCard", () => {
  it("shows every product with what it earns and what it owes", () => {
    render(<ProductsCard data={overview()} t={t as never} locale="en" />);
    for (const key of [
      "admin.fin_prod_couples",
      "admin.fin_prod_vendors",
      "admin.fin_prod_planners",
      "admin.fin_prod_camera",
      "admin.fin_prod_addon",
    ]) {
      const card = screen.getByRole("heading", { name: key }).parentElement as HTMLElement;
      expect(within(card).getByText("admin.fin_prod_earns")).toBeTruthy();
      expect(within(card).getByText("admin.fin_prod_owes")).toBeTruthy();
    }
    const vendors = screen.getByRole("heading", { name: "admin.fin_prod_vendors" })
      .parentElement as HTMLElement;
    const credits = within(vendors).getByText("admin.fin_prod_lead_credits").parentElement;
    expect(credits?.textContent).toContain("3");
    // The headline MRR is the all-subscriptions total, not the couple figure.
    expect(screen.getByText("€168")).toBeTruthy();
  });
});
