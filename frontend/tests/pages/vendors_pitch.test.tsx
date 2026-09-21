// The /suppliers pitch below the hero: three product blocks, a rail of the
// trades the directory covers, and a FAQ.
//
// What is pinned is what a screenshot cannot show: that every trade a vendor
// can register under is reachable from the page exactly once (photo card or
// chip, never both, never a second hand-kept list), that the planner category
// is NOT offered because that door leads to /planners, that the FAQ is real
// <details> that starts closed, and that the quote picture's total is the sum
// of its own lines.

import { SUPPLIER_GROUPS, isVendorSelfServeBlocked } from "@shared/suppliers";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import de from "@/locales/de";
import en from "@/locales/en";
import es from "@/locales/es";
import hr from "@/locales/hr";
import hu from "@/locales/hu";
import VendorsPage from "@/pages/VendorsPage";

const realFetch = globalThis.fetch;
// Built from its code point so the source file itself stays free of the character.
const EM_DASH = String.fromCharCode(0x2014);

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/suppliers"]}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  try {
    localStorage.setItem("weddly.locale", "en");
  } catch {
    // happy-dom without storage: EN is the default anyway.
  }
  // Nothing on this page needs the API; anything that asks gets an empty 200.
  globalThis.fetch = (async () =>
    new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

async function renderPage() {
  render(
    <Providers>
      <VendorsPage />
    </Providers>,
  );
  await waitFor(() => expect(screen.getByText(en.vendors.pitch_manage_title)).toBeTruthy());
}

describe("/suppliers pitch", () => {
  it("shows the three blocks in the order a vendor's week runs", async () => {
    await renderPage();
    const titles = [
      en.vendors.pitch_manage_title,
      en.vendors.pitch_grow_title,
      en.vendors.pitch_book_title,
    ];
    const nodes = titles.map((t) => screen.getByText(t));
    for (let i = 1; i < nodes.length; i++) {
      const prev = nodes[i - 1] as HTMLElement;
      const next = nodes[i] as HTMLElement;
      // DOCUMENT_POSITION_FOLLOWING: `next` comes after `prev`.
      expect(prev.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("makes every registrable trade reachable once, and never offers the planner", async () => {
    await renderPage();
    const linked = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      .filter((h) => h.startsWith("/suppliers/browse?category="))
      .map((h) => h.split("=")[1]);

    const expected = SUPPLIER_GROUPS.flatMap((g) => g.categories).filter(
      (c) => !isVendorSelfServeBlocked(c),
    );

    expect([...linked].sort()).toEqual([...expected].sort());
    expect(linked).not.toContain("wedding_planner");
    expect(new Set(linked).size).toBe(linked.length);
  });

  it("renders the FAQ as closed <details> with all six answers in the DOM", async () => {
    await renderPage();
    const items = Array.from(document.querySelectorAll("details"));
    expect(items).toHaveLength(6);
    for (const d of items) expect(d.open).toBe(false);
    expect(screen.getByText(en.vendors.pitch_faq_2_q)).toBeTruthy();
    expect(screen.getByText(en.vendors.pitch_faq_2_a)).toBeTruthy();
  });

  it("totals the sample quote from its own lines", async () => {
    await renderPage();
    // EN reader: euro. 1,800 + 250 + 150. Formatted by Intl, not by hand.
    expect(screen.getByText("€1,800")).toBeTruthy();
    // Twice: the quote card's own total, and the accepted-quote chip on the
    // hero. Both derive from the same sample, so they cannot disagree.
    expect(screen.getAllByText("€2,200")).toHaveLength(2);
  });

  it("keeps a numeric claim, a price and a plan off the page", async () => {
    await renderPage();
    // The page's own rule (VendorsPage header, rule 3): no counts, no offer.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\b\d[\d,.]*\s?\+\s/); // "500+ vendors"
    expect(text).not.toMatch(/\bfree\b/i);
    expect(text).not.toMatch(/spots left/i);
  });
});

describe("pitch copy", () => {
  const trees = { en, hu, es, hr, de } as const;

  it("uses no em dash in any language (owner rule: it reads as machine-written)", () => {
    for (const [locale, tree] of Object.entries(trees)) {
      const vendors = tree.vendors as Record<string, string>;
      for (const [key, value] of Object.entries(vendors)) {
        if (!key.startsWith("pitch_")) continue;
        expect(value, `${locale}.vendors.${key}`).not.toContain(EM_DASH);
      }
    }
  });

  it("says nothing is free and quotes no cost in any language", () => {
    const banned = /\b(free|ingyen|gratis|besplatno|kostenlos|umsonst)\b/i;
    for (const [locale, tree] of Object.entries(trees)) {
      const vendors = tree.vendors as Record<string, string>;
      for (const [key, value] of Object.entries(vendors)) {
        if (!key.startsWith("pitch_")) continue;
        expect(value, `${locale}.vendors.${key}`).not.toMatch(banned);
      }
    }
  });
});
