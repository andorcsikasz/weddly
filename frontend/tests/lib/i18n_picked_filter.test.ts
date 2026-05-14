// Regression guard for the supplier directory "picked" filter chip. The chip
// is the only entry point for the `?picked=1` URL filter, and its label is
// also its accessible name (no visible text beyond the count). Splitting the
// label into idle/active variants is a deliberate aria-pressed-aware contract;
// these tests pin that contract so a rename or accidental deletion is caught
// before it lands in i18n production.

import { describe, expect, it } from "bun:test";
import en from "@/locales/en";
import hu from "@/locales/hu";

describe("suppliers.picked_filter i18n contract", () => {
  it("exposes idle + active variants in both locales with the {n} placeholder", () => {
    for (const tree of [en, hu]) {
      expect(tree.suppliers.picked_filter_idle).toContain("{n}");
      expect(tree.suppliers.picked_filter_active).toContain("{n}");
    }
  });

  it("idle and active strings differ in each locale (otherwise the split is pointless)", () => {
    expect(en.suppliers.picked_filter_idle).not.toBe(en.suppliers.picked_filter_active);
    expect(hu.suppliers.picked_filter_idle).not.toBe(hu.suppliers.picked_filter_active);
  });

  it("does not still expose the pre-split `picked_filter` key", () => {
    // The chip used to be a non-clickable <span> with a single neutral label;
    // making it a button-with-pressed-state required two labels. If a stray
    // refactor reintroduces the old key, drift detection would silently
    // accept either spelling — pin the rename here.
    expect((en.suppliers as Record<string, unknown>).picked_filter).toBeUndefined();
    expect((hu.suppliers as Record<string, unknown>).picked_filter).toBeUndefined();
  });
});
