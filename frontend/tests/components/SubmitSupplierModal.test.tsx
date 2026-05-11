// Regression: extending PriceBand to 5 broke the modal because the price-band
// picker was rendering `"○".repeat(4 - band)` — band=5 → repeat(-1) → RangeError,
// which bubbled up to the page-level ErrorBoundary on `/app/suppliers`. The fix
// is `Math.max(0, 5 - band)`; this test catches the regression.

import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import { SubmitSupplierModal } from "@/components/SubmitSupplierModal";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/ToastProvider";

function renderModal(open: boolean) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <SubmitSupplierModal open={open} onClose={mock(() => {})} onSubmitted={mock(() => {})} />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("<SubmitSupplierModal>", () => {
  it("renders all 5 price-band buttons without RangeError when open", () => {
    expect(() => renderModal(true)).not.toThrow();
    // Buttons use a five-dot scale: ●○○○○ through ●●●●●. Sanity-check that the
    // last button (band=5) shows five filled dots.
    const fivePack = screen.getByRole("radio", { name: "●●●●●" });
    expect(fivePack).toBeInTheDocument();
  });

  it("does not throw while the modal is closed (children still get evaluated)", () => {
    // The JSX inside <Dialog> is evaluated even when `open={false}` — that's
    // why the original bug crashed the suppliers page on first load.
    expect(() => renderModal(false)).not.toThrow();
  });
});
