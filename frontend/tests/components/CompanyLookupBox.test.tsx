// Regression guard for the vendor/planner signup "Cégkereső" bug: the lookup
// box is rendered INSIDE the registration <form>, so it must not introduce a
// nested <form> and its search button must be type="button". A nested form or a
// submit-typed button makes "Keresés" submit/reload the whole page, wiping the
// wizard step and any held Google credential (auth reset on company search).

import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";

// Mock the availability fetch BEFORE the component module loads (dynamic import
// below) so the box actually renders instead of returning null under happy-dom.
mock.module("@/lib/endpoints", () => ({
  companyLookupApi: {
    availability: async () => ({
      country: "HU",
      available: true,
      source_name: "Test Registry",
      search_kinds: ["tax_number"],
    }),
    search: async () => ({ results: [] }),
    getCompany: async () => ({ company: {} }),
  },
}));

const { CompanyLookupBox } = await import("@/components/planner/CompanyLookupBox");

describe("CompanyLookupBox inside a form", () => {
  it("adds no nested form and its search button never submits the parent", async () => {
    let outerSubmits = 0;
    const { container } = render(
      <I18nProvider>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            outerSubmits++;
          }}
        >
          <CompanyLookupBox country="HU" onPick={() => {}} />
        </form>
      </I18nProvider>,
    );

    // Wait for availability to resolve and the box (with its search button) to render.
    const button = await screen.findByRole("button");

    // The box must not introduce its own <form> — only the outer harness form.
    expect(container.querySelectorAll("form").length).toBe(1);
    // The search trigger must be a plain button, not a submit.
    expect(button.getAttribute("type")).toBe("button");

    // Clicking it must never bubble into a parent-form submission.
    button.click();
    await waitFor(() => expect(outerSubmits).toBe(0));
  });
});
