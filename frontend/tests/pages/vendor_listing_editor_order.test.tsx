// The vendor's listing editor is laid out in the SAME order as the page couples
// see (owner direction 2026-09-21: what a vendor inputs and what a couple reads
// follow one logic). This renders the real editor and pins that order, that the
// nav is the couple page's own component with the same section names, and that
// the setup checklist's anchors still land on a card.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import VendorListingPage from "@/pages/vendor/VendorListingPage";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

const realFetch = globalThis.fetch;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(category: string) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/vendor/listing/me")) {
      return json({
        listing: {
          id: "v9",
          name: "Great Tide",
          category,
          city: "Szeged",
          address: "Kárász u. 1",
          website: "",
          contact_email: "hello@greattide.example",
          contact_phone: "",
          blurb_hu: "",
          blurb_en: "",
          price_band: null,
          capacity_min: null,
          capacity_max: null,
          spoken_languages: [],
          hero_image_url: null,
          status: "active",
          name_changed_at: null,
          price_band_changed_at: null,
          currency_override: null,
          hide_contact_public: false,
        },
        account: { country: "HU" },
        currency: "HUF",
        billing: { entitled: true },
        photos: [],
        videos: [],
        packages: [],
      });
    }
    if (url.includes("/api/vendor/availability/me")) {
      return json({ blocked_days: [], next_available: null });
    }
    return json({});
  }) as typeof fetch;
}

async function flush(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderEditor(category = "photography") {
  installFetch(category);
  render(
    <MemoryRouter initialEntries={["/vendor/listing"]}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <VendorListingPage />
            </ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  await flush();
}

const idsInDomOrder = (ids: string[]) =>
  ids
    .map((id) => ({ id, el: document.getElementById(id) }))
    .filter((x) => x.el !== null)
    .sort((a, b) =>
      (a.el as HTMLElement).compareDocumentPosition(b.el as HTMLElement) &
      Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    )
    .map((x) => x.id);

beforeEach(() => {
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* happy-dom without storage, ignore */
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the vendor listing editor mirrors the couple's page", () => {
  it("lays the sections out in the couple page's order", async () => {
    await renderEditor();
    expect(
      idsInDomOrder([
        "vendor-section-pricing",
        "vendor-section-cover",
        "vendor-section-gallery",
        "vendor-section-packages",
        "vendor-section-description",
        "vendor-section-contact",
        "vendor-section-videos",
        "vendor-section-reviews",
        "vendor-section-availability",
      ]),
    ).toEqual([
      "vendor-section-pricing",
      "vendor-section-cover",
      "vendor-section-gallery",
      "vendor-section-packages",
      "vendor-section-description",
      "vendor-section-contact",
      "vendor-section-videos",
      "vendor-section-reviews",
      "vendor-section-availability",
    ]);
  });

  it("has the couple page's section nav, with the couple page's section names", async () => {
    await renderEditor();
    const nav = screen.getByRole("navigation", { name: "Page sections" });
    // Same words as the page couples read: About, Packages, Videos, Reviews.
    expect(
      within(nav)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      "Basics",
      "Gallery",
      "Packages",
      "About",
      "Contact",
      "Videos",
      "Reviews",
      "Availability",
    ]);
  });

  it("keeps every anchor the setup checklist links to", async () => {
    await renderEditor("venue");
    for (const key of [
      "cover",
      "gallery",
      "description",
      "contact",
      "pricing",
      "capacity",
      "packages",
    ]) {
      expect(document.getElementById(`vendor-section-${key}`)).not.toBeNull();
    }
  });

  it("puts the city with the facts under the name, and only the street with the contact", async () => {
    await renderEditor();
    const basics = document.getElementById("vendor-section-pricing") as HTMLElement;
    const contact = document.getElementById("vendor-section-contact") as HTMLElement;
    expect(basics.querySelector("#vendor-city")).not.toBeNull();
    expect(contact.querySelector("#vendor-city")).toBeNull();
    expect(contact.querySelector("#vendor-address")).not.toBeNull();
  });

  it("no longer offers the hide-contact switch: the public page has nothing left to hide", async () => {
    await renderEditor();
    expect(screen.queryByText(/hide contact details/i)).toBeNull();
    expect(document.getElementById("vendor-hide-contact-hint")).toBeNull();
  });

  it("links the reviews row to the reviews page", async () => {
    await renderEditor();
    const row = document.getElementById("vendor-section-reviews") as HTMLElement;
    expect(within(row).getByText("Manage reviews").closest("a")?.getAttribute("href")).toBe(
      "/vendor/reviews",
    );
  });
});
