// Locks the cake & drinks calculator against the source spreadsheet (Esküvői
// süti és ital kalkulátor by Cilinderesek). With 70 guests, the default
// per-head portions, the 10% buffers and the sample HUF unit prices the sheet
// totals come out to: pastries 103 950, cake 84 000, drinks 312 620, grand
// 500 570. If a formula drifts (buffer applied to cake, wrong bottle divisor,
// etc.) these numbers move and the test fails.

import { describe, expect, it, mock } from "bun:test";
import { render } from "@testing-library/react";
import { CakeDrinksCalculator } from "@/components/CakeDrinksCalculator";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";

function renderCalc(currency: "HUF" | "EUR", guests: number | null) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <CakeDrinksCalculator
          open
          onClose={mock(() => {})}
          currency={currency}
          defaultGuests={guests}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

/** Digits only — strips locale grouping (space / NBSP / comma) and the decimal
 *  separators on quantity cells so assertions don't hinge on the active locale. */
function digits(node: ParentNode): string {
  return (node.textContent ?? "").replace(/[^\d]/g, "");
}

describe("<CakeDrinksCalculator>", () => {
  it("reproduces the spreadsheet totals for 70 guests on the HUF defaults", () => {
    renderCalc("HUF", 70);
    const text = digits(document.body);
    // Subtotals + grand total from the source sheet.
    expect(text).toContain("103950"); // pastries
    expect(text).toContain("84000"); // cake
    expect(text).toContain("312620"); // drinks
    expect(text).toContain("500570"); // grand total
  });

  it("falls back to the sample 70-guest count when none is provided", () => {
    renderCalc("HUF", null);
    expect(digits(document.body)).toContain("500570");
  });

  it("starts non-HUF couples with blank prices (no nonsense HUF magnitudes)", () => {
    const { container } = renderCalc("EUR", 70);
    // No seeded prices → every total is 0, so the big HUF figure must be absent.
    expect(digits(container)).not.toContain("500570");
  });
});
