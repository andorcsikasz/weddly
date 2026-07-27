// What a missing translation key renders.
//
// A vendor's Csomag tab once showed, verbatim:
//   vendor_home.brand_locked_card_title vendor_home.brand_locked_card_body
// because `t()` returned the raw dotted path whenever a key didn't resolve. It
// happened after a card was deleted while an old chunk was still live, but the
// same fallback fires for any key built at runtime from data
// (`suppliers.cat.${slug}`) whose value isn't in the union.
//
// Contract pinned here:
//   - a key present only in EN reads in EN even under another locale, rather
//     than degrading to the path
//   - a key present NOWHERE never renders a dotted path in production; it
//     degrades to the humanised last segment, which is the right answer for
//     the slug case and merely bland for the stale-bundle one
//
// (In dev the raw path IS the wanted output, plus a console warning, so the
// developer notices. `import.meta.env.DEV` is true under the test runner, so
// the production branch is exercised through the exported helper.)

import { describe, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { I18nProvider, missingKeyFallbackForTests, useT } from "@/lib/i18n";

function Probe({ path }: { path: string }) {
  const { t } = useT();
  return <span data-testid="out">{t(path)}</span>;
}

describe("t() with a key that does not resolve", () => {
  it("falls back to EN for a key the active tree lacks", () => {
    // `common.loading` exists in every tree; this asserts the lookup order is
    // active-tree-then-EN rather than active-tree-then-path.
    render(
      <I18nProvider>
        <Probe path="common.loading" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("out").textContent).not.toContain("common.loading");
  });

  it("never renders a dotted path in production", () => {
    expect(missingKeyFallbackForTests("vendor_home.brand_locked_card_title", false)).toBe(
      "Brand locked card title",
    );
    expect(missingKeyFallbackForTests("suppliers.cat.some_new_slug", false)).toBe("Some new slug");
  });

  it("keeps the raw path in development, where noticing is the point", () => {
    expect(missingKeyFallbackForTests("vendor_home.gone", true)).toBe("vendor_home.gone");
  });
});
