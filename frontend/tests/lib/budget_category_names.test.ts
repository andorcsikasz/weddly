// `BUDGET_CATEGORY_NAMES` is a static copy of every locale's `budget.cat`
// (the non-EN trees are lazy-loaded, so lib code cannot read them). This pins
// the copy to the source so a renamed category cannot silently turn its
// holder row back into a fake sub-item.

import { describe, expect, it } from "bun:test";
import { BUDGET_CATEGORY_NAMES } from "@/lib/budget";
import de from "@/locales/de";
import en from "@/locales/en";
import es from "@/locales/es";
import hr from "@/locales/hr";
import hu from "@/locales/hu";

const TREES = { en, hu, es, hr, de } as const;

describe("BUDGET_CATEGORY_NAMES", () => {
  for (const [locale, tree] of Object.entries(TREES)) {
    it(`covers every ${locale} category name`, () => {
      const cat = (tree as { budget?: { cat?: Record<string, string> } }).budget?.cat ?? {};
      for (const [slug, name] of Object.entries(cat)) {
        const names = BUDGET_CATEGORY_NAMES[slug as keyof typeof BUDGET_CATEGORY_NAMES];
        expect(names, `${locale}.budget.cat.${slug}`).toBeDefined();
        expect(names).toContain(name);
      }
    });
  }
});
