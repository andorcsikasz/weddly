// "Add to budget" for the chosen offer. What matters to the couple: the split is
// shown BEFORE anything is written, their own estimate for the same category is
// replaced by default (so it is not counted twice), optional extras are opt-in,
// and a frozen category or a different currency stops the action with a reason.
//
// `fetch` is stubbed per test rather than mocking the endpoints module: a module
// mock lives for the whole process and would leak into every other test file.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { OfferBudgetDialog } from "@/components/OfferBudgetDialog";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";
import { OFFER_SCHEMA, type VendorOffer } from "@shared/vendor_offers";

const realFetch = globalThis.fetch;

const OFFER: VendorOffer = {
  id: 7,
  supplier_id: null,
  vendor_name: "Teleki Kastély",
  category: "venue",
  currency: "HUF",
  quoted_at: "2026-11-28",
  valid_until: null,
  total: 0,
  status: "chosen",
  created_at: 0,
  payload: {
    schema: OFFER_SCHEMA,
    vendor_name: "Teleki Kastély",
    category: "venue",
    currency: "HUF",
    quoted_at: "2026-11-28",
    valid_until: null,
    event_date: null,
    guest_count: 90,
    stated_total: null,
    line_items: [
      { label: "Exclusive hire", amount: 700000, kind: "base", optional: false },
      { label: "Standard menu", amount: 17000, kind: "per_person", optional: false },
      { label: "Soft drinks, 6 h", amount: 6800, kind: "per_person", optional: true },
    ],
    deposit_amount: null,
    payment_terms: null,
    inclusions: [],
    exclusions: [],
    cancellation: null,
    notes: null,
  },
};

function couple(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    currency: "HUF",
    frozen_categories: [],
    guest_count_goal: { kind: "exact", exact: 80, min: null, max: null },
    target_guest_count: 80,
    planning_count: null,
    ...over,
  };
}

function line(id: number, category: string, label: string, planned: number) {
  return {
    id,
    couple_id: 1,
    category,
    label,
    planned_huf: planned,
    actual_huf: 0,
    paid_huf: 0,
    supplier_id: null,
    couple_supplier_id: null,
    listing_id: null,
    vendor_offer_id: null,
    notes: null,
    per_guest: false,
    icon: null,
    created_at: 0,
    updated_at: 0,
  };
}

type Posted = { path: string; body: Record<string, unknown> };

function stub(opts: { couple?: Record<string, unknown> } = {}) {
  const posted: Posted[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const ok = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/api/couples/current")) return ok({ couple: couple(opts.couple) });
    if (url.includes("/api/budget/lines")) {
      return ok({
        lines: [line(1, "venue", "Venue", 1_100_000), line(2, "decor_floral", "Flowers", 50_000)],
      });
    }
    if (url.includes("/api/budget/offer-lines/") && method === "POST") {
      posted.push({ path: url, body: JSON.parse(String(init?.body ?? "{}")) });
      return ok({ line_ids: [10, 11], retired_line_ids: [1], total: 0 }, 201);
    }
    return ok({});
  }) as unknown as typeof fetch;
  return posted;
}

function renderDialog(over: Partial<Parameters<typeof OfferBudgetDialog>[0]> = {}) {
  const onClose = mock(() => {});
  const onChanged = mock(() => {});
  render(
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>
          <OfferBudgetDialog
            open
            offer={OFFER}
            guests={90}
            onClose={onClose}
            onChanged={onChanged}
            {...over}
          />
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  return { onClose, onChanged };
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("<OfferBudgetDialog>", () => {
  it("shows the split by what each line buys, with the total, before writing anything", async () => {
    const posted = stub();
    renderDialog();
    expect(await screen.findByText("Exclusive hire")).toBeTruthy();
    expect(screen.getByText("Standard menu")).toBeTruthy();
    // hire + menu for 90 guests = 700,000 + 1,530,000
    expect(screen.getAllByText(/2[,\s. ]?230[,\s. ]?000/).length).toBeGreaterThan(0);
    expect(posted).toHaveLength(0);
  });

  it("replaces the couple's own estimate for the same category by default, not another category", async () => {
    stub();
    renderDialog();
    const estimate = await screen.findByRole("checkbox", { name: /Venue/ });
    expect((estimate as HTMLInputElement).checked).toBe(true);
    // The flowers estimate is a different category from anything in this offer.
    expect(screen.queryByText("Flowers")).toBeNull();
  });

  it("applies with the headcount, the budget baseline and the estimate it replaces", async () => {
    const posted = stub();
    const { onChanged, onClose } = renderDialog();
    await screen.findByRole("checkbox", { name: /Venue/ });
    fireEvent.click(screen.getByRole("button", { name: "Add to budget" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    const call = posted[0];
    expect(call?.path).toContain("/api/budget/offer-lines/7");
    expect(call?.body).toMatchObject({
      guests: 90,
      baseline: 80,
      include_optional: [],
      retire_line_ids: [1],
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("optional extras are opt-in and sent by index when ticked", async () => {
    const posted = stub();
    renderDialog();
    const extra = await screen.findByRole("checkbox", { name: /Soft drinks/ });
    expect((extra as HTMLInputElement).checked).toBe(false);
    fireEvent.click(extra);
    await screen.findAllByText("Soft drinks, 6 h");
    fireEvent.click(screen.getByRole("button", { name: "Add to budget" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body.include_optional).toEqual([2]);
  });

  it("a frozen category stops the action and says which one", async () => {
    stub({ couple: { frozen_categories: ["catering"] } });
    renderDialog();
    // Names the category the couple has to unfreeze.
    expect(await screen.findByText(/Catering is frozen on your budget/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Add to budget" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("a different currency stops the action", async () => {
    stub({ couple: { currency: "EUR" } });
    renderDialog();
    expect(await screen.findByText(/This offer is in HUF, your budget is in EUR/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Add to budget" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("offers Update and Remove once the offer is already in the budget", async () => {
    stub();
    renderDialog({ offer: { ...OFFER, budget_lines: 3 } });
    expect(await screen.findByRole("button", { name: "Update budget" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from budget" })).toBeTruthy();
  });
});
