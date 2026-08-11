import { afterEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type {
  PaymentLaunchesResponse,
  PaymentLaunchProduct,
  PaymentLaunchState,
} from "@shared/admin_financial_planner";
import { ApiError } from "@/lib/api";
import { adminFinancialPlannerApi } from "@/lib/endpoints";
import { isPaymentLaunchConflict, PaymentLaunchesCard } from "@/pages/AdminFinancialPlannerPage";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const LABELS: Record<string, string> = {
  "admin.fin_launch_title": "Payment product launches",
  "admin.fin_launch_note": "Independent checkout switches",
  "admin.fin_launch_paywall_separate": "New sessions only; global paywall is separate.",
  "admin.fin_launch_loading": "Loading payment launch states",
  "admin.fin_launch_retry": "Retry",
  "admin.fin_launch_refresh": "Refresh states",
  "admin.fin_launch_load_error_title": "Launch states could not be loaded",
  "admin.fin_launch_load_error_body": "Current server state is required.",
  "admin.fin_launch_state_live": "Live",
  "admin.fin_launch_state_blocked": "Launch requested · blocked",
  "admin.fin_launch_state_off": "Off",
  "admin.fin_launch_ready": "Configuration ready",
  "admin.fin_launch_not_ready": "Configuration incomplete",
  "admin.fin_launch_missing": "Missing:",
  "admin.fin_launch_enable": "Launch",
  "admin.fin_launch_disable": "Pause new payments",
  "admin.fin_launch_fix_config": "Fix configuration first",
  "admin.fin_launch_updating": "Updating…",
  "admin.fin_launch_product_couple_subscriptions": "Couple subscriptions",
  "admin.fin_launch_product_couple_subscriptions_note": "Couple note",
  "admin.fin_launch_product_planner_subscriptions": "Planner subscriptions",
  "admin.fin_launch_product_planner_subscriptions_note": "Planner note",
  "admin.fin_launch_product_vendor_billing": "Vendor billing",
  "admin.fin_launch_product_vendor_billing_note": "Vendor note",
  "admin.fin_launch_product_film_checkout": "Wedding film checkout",
  "admin.fin_launch_product_film_checkout_note": "Film note",
  "admin.fin_launch_product_guest_page_addon": "Guest-page add-on",
  "admin.fin_launch_product_guest_page_addon_note": "Add-on note",
  "admin.fin_launch_smoke_title": "Pre-launch smoke test",
  "admin.fin_launch_smoke_warning": "Presence is not verification.",
  "admin.fin_launch_smoke_account": "Use a non-admin account.",
  "admin.fin_launch_smoke_checkout": "Complete Checkout.",
  "admin.fin_launch_smoke_webhook": "Confirm webhook fulfillment.",
  "admin.fin_launch_smoke_manage": "Test portal or refund policy.",
  "admin.fin_launch_smoke_pause": "Pause and verify boundaries.",
};

const t = (key: string, vars?: Record<string, string | number>) => {
  if (key === "admin.fin_launch_live_count") return `${vars?.live} / ${vars?.total} live`;
  if (key === "admin.fin_launch_last_changed") return `Last changed ${vars?.date}`;
  if (key === "admin.fin_launch_revision") return `Revision ${vars?.version}`;
  return LABELS[key] ?? key;
};

function state(
  product: PaymentLaunchProduct,
  enabled: boolean,
  ready: boolean,
  missing: string[] = [],
): PaymentLaunchState {
  return {
    product,
    version: enabled ? 2 : 0,
    enabled,
    ready,
    missing,
    updated_at: null,
    updated_by_user_id: null,
  };
}

function snapshot(): PaymentLaunchesResponse {
  return {
    generated_at: 1,
    products: {
      couple_subscriptions: state("couple_subscriptions", true, true),
      planner_subscriptions: state("planner_subscriptions", false, false, [
        "STRIPE_PLANNER_PRICE_STARTER_EUR",
      ]),
      vendor_billing: state("vendor_billing", true, false, ["STRIPE_VENDOR_WEBHOOK_SECRET"]),
      film_checkout: state("film_checkout", false, true),
      guest_page_addon: state("guest_page_addon", false, true),
    },
  };
}

function renderCard(overrides: Partial<Parameters<typeof PaymentLaunchesCard>[0]> = {}) {
  const props: Parameters<typeof PaymentLaunchesCard>[0] = {
    snapshot: snapshot(),
    loading: false,
    failed: false,
    busyProduct: null,
    onRetry: () => {},
    onToggle: () => {},
    t,
    locale: "en",
    ...overrides,
  };
  return render(<PaymentLaunchesCard {...props} />);
}

describe("PaymentLaunchesCard", () => {
  it("shows effective live state and does not count blocked launch intent as live", () => {
    renderCard();

    expect(screen.getByText("1 / 5 live")).toBeInTheDocument();
    expect(screen.getByText("Launch requested · blocked")).toBeInTheDocument();
    expect(screen.getByText("STRIPE_VENDOR_WEBHOOK_SECRET")).toBeInTheDocument();
    expect(screen.getByText("Pre-launch smoke test")).toBeInTheDocument();
  });

  it("blocks an unready launch but keeps a ready product actionable", () => {
    const onToggle = mock(() => {});
    renderCard({ onToggle });

    const plannerRow = screen.getByRole("heading", { name: "Planner subscriptions" }).parentElement
      ?.parentElement?.parentElement;
    expect(plannerRow).toBeTruthy();
    expect(within(plannerRow as HTMLElement).getByRole("button")).toBeDisabled();

    const filmRow = screen.getByRole("heading", { name: "Wedding film checkout" }).parentElement
      ?.parentElement?.parentElement;
    const filmButton = within(filmRow as HTMLElement).getByRole("button", { name: "Launch" });
    fireEvent.click(filmButton);
    expect(onToggle).toHaveBeenCalledWith("film_checkout", true);
  });

  it("renders a safe error state and retries without exposing product controls", () => {
    const onRetry = mock(() => {});
    renderCard({ snapshot: null, loading: false, failed: true, onRetry });

    expect(screen.getByText("Launch states could not be loaded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Launch" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("sends the last-read revision with a launch change", async () => {
    let body: unknown;
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(snapshot()), { status: 200 });
    }) as unknown as typeof fetch;

    await adminFinancialPlannerApi.setPaymentLaunch("film_checkout", true, 7);

    expect(body).toEqual({ product: "film_checkout", enabled: true, expected_version: 7 });
  });

  it("recognizes only the structured stale-write conflict", () => {
    expect(
      isPaymentLaunchConflict(
        new ApiError(409, "client_error", "stale", { code: "payment_launch_conflict" }),
      ),
    ).toBe(true);
    expect(
      isPaymentLaunchConflict(
        new ApiError(409, "client_error", "not ready", { code: "payment_not_ready" }),
      ),
    ).toBe(false);
  });
});
