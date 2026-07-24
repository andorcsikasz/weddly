// Regression: extending PriceBand to 5 broke the modal because the price-band
// picker was rendering `"$".repeat(4 - band)` — band=5 → repeat(-1) → RangeError,
// which bubbled up to the page-level ErrorBoundary on `/app/suppliers`. The fix
// is `"$".repeat(band)`; this test catches the regression by walking the
// recommend-a-supplier wizard to the final (Pitch) step where the bands live.

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { SubmitSupplierModal } from "@/components/SubmitSupplierModal";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/ToastProvider";

function renderModal(open: boolean, extra: Record<string, unknown> = {}) {
  return render(
    <I18nProvider>
      <ToastProvider>
        <SubmitSupplierModal
          open={open}
          onClose={mock(() => {})}
          onSubmitted={mock(() => {})}
          {...extra}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

describe("<SubmitSupplierModal>", () => {
  it("renders all 5 price-band buttons without RangeError on the final step", () => {
    // initialCategory + initialName pre-fill step 0 (Who) so we can walk the
    // wizard Who → Where → Reach → Pitch to the price-band picker.
    renderModal(true, { initialCategory: "photography", initialName: "Test Vendor" });
    // Step 0 (Who) → Step 1 (Where)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Step 1 (Where, address optional) → Step 2 (Reach)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Step 2 (Reach): email is required now, so fill it before advancing.
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "hello@test.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Step 3 (Pitch): the five-position dollar scale — band=5 renders five signs.
    expect(screen.getByRole("radio", { name: /\$\$\$\$\$/ })).toBeInTheDocument();
  });

  it("does not throw while the modal is closed (children still get evaluated)", () => {
    // The JSX inside <Dialog> is evaluated even when `open={false}` — that's
    // why the original bug crashed the suppliers page on first load.
    expect(() => renderModal(false)).not.toThrow();
  });
});
