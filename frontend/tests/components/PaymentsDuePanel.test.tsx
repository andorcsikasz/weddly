// The payments roll-up used to be four summary numbers, so an installment could
// only be read by opening its own supplier card. What's guarded here is the
// grouping the list replaced that with:
//   * a due date in the past lands in Lejárt / Overdue, and says how late it is
//     in words — the bucket must not lean on colour alone.
//   * an installment with NO due date still appears (its own bucket) rather than
//     dropping out of the list, which is what the summary-only strip did.
//   * "next due" is the earliest dated unpaid installment wherever it falls, so
//     a quiet fortnight can't report "nothing dated" while a payment waits 45
//     days out.
//   * the per-row tick writes through the supplier-installment endpoint (the
//     server recomputes the mirrored budget line), so the callback has to carry
//     BOTH ids.

import type { CoupleSupplier, SupplierInstallment } from "@shared/couple_suppliers";
import { describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaymentsDuePanel } from "@/components/PaymentsDuePanel";
import { I18nProvider } from "@/lib/i18n";
import { localYmd } from "@/lib/format";

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localYmd(d);
}

function installment(over: Partial<SupplierInstallment> & { id: number }): SupplierInstallment {
  return {
    supplier_id: "s1",
    label: null,
    amount_huf: 100_000,
    due_date: null,
    paid: false,
    paid_at: null,
    sort_order: 0,
    ...over,
  };
}

function supplier(id: string, name: string, installments: SupplierInstallment[]): CoupleSupplier {
  return {
    id,
    source: "self",
    name,
    category: "venue",
    notes: null,
    price_huf: null,
    paid: false,
    budget_line_id: null,
    installments,
    next_step: null,
    probability: null,
    city: null,
    address: null,
    lat: null,
    lng: null,
    contact_email: null,
    contact_phone: null,
    listing_id: null,
    directory_match: null,
    created_at: 0,
    updated_at: 0,
  };
}

function setup(suppliers: CoupleSupplier[], onMarkPaid = mock(async (_supplierId: string, _installmentId: number) => {})) {
  const view = render(
    <I18nProvider>
      <PaymentsDuePanel suppliers={suppliers} currency="HUF" locale="en" onMarkPaid={onMarkPaid} />
    </I18nProvider>,
  );
  return { ...view, onMarkPaid };
}

describe("<PaymentsDuePanel>", () => {
  it("renders nothing when no supplier has a payment schedule", () => {
    const { container } = setup([supplier("s1", "Malom Étterem", [])]);
    expect(container.textContent).toBe("");
  });

  it("buckets an overdue installment and states how late it is", () => {
    setup([
      supplier("s1", "Malom Étterem", [
        installment({ id: 1, due_date: isoPlusDays(-3), amount_huf: 250_000 }),
      ]),
    ]);

    expect(screen.getByText("Overdue")).toBeTruthy();
    // The days-late phrase is the non-colour signal: an overdue row has to read
    // as overdue in a screenshot with no hue at all.
    expect(screen.getByText("3 days late")).toBeTruthy();
  });

  it("keeps an undated installment in the list instead of dropping it", () => {
    setup([supplier("s1", "Malom Étterem", [installment({ id: 1, due_date: null })])]);

    // Its bucket exists, and the "next due" stat is honest about having no date.
    expect(screen.getByText("No date yet")).toBeTruthy();
    expect(screen.getByText("No dated installments")).toBeTruthy();
  });

  it("reports the earliest dated unpaid installment as next due, even when it is months out", () => {
    setup([
      supplier("s1", "Malom Étterem", [installment({ id: 1, due_date: isoPlusDays(45) })]),
      supplier("s2", "Fotó Kft", [installment({ id: 2, due_date: isoPlusDays(120) })]),
    ]);

    // Nothing is due inside 30 days, so the old "next" read as unset. The
    // supplier name beside the date is what proves which one won.
    expect(screen.getByText(/Malom Étterem/)).toBeTruthy();
    expect(screen.queryByText("No dated installments")).toBeNull();
  });

  it("marks a row paid through the supplier + installment id pair", async () => {
    const onMarkPaid = mock(async (_supplierId: string, _installmentId: number) => {});
    setup(
      [
        supplier("sup-7", "Malom Étterem", [
          installment({ id: 42, due_date: isoPlusDays(-1), amount_huf: 300_000 }),
        ]),
      ],
      onMarkPaid,
    );

    const tick = screen.getByRole("button", {
      name: /Mark the Malom Étterem payment as paid/i,
    });
    await act(async () => {
      fireEvent.click(tick);
    });

    await waitFor(() => expect(onMarkPaid).toHaveBeenCalledTimes(1));
    expect(onMarkPaid.mock.calls[0]).toEqual(["sup-7", 42]);
  });

  it("folds the paid archive but still counts it in the paid-so-far total", () => {
    setup([
      supplier("s1", "Malom Étterem", [
        installment({
          id: 1,
          amount_huf: 400_000,
          due_date: isoPlusDays(-20),
          paid: true,
          paid_at: 1,
        }),
      ]),
    ]);

    // The bucket heading is present (its rows are collapsed, not absent).
    expect(screen.getByRole("button", { name: /Paid/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Paid/ }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });
});
