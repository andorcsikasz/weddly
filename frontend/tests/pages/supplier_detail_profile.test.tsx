// The supplier detail page as a business PROFILE (the booking-marketplace shape):
// a menu of packages with a "request a quote" button on every row, a sticky
// in-page section nav, one booking card, and the vendor's answer for the
// couple's own wedding date.
//
// What is pinned here is the wiring a screenshot cannot show: that a package row
// opens the composer PRE-WRITTEN for that package, that the section nav only
// lists sections the listing really has, and that the wedding-day verdict
// appears only when Weddly can honestly give one.

import type { ListingPackage } from "@shared/listing_packages";
import type { SupplierAvailability, SupplierDetail, SupplierReview } from "@shared/suppliers";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import SupplierDetailPage from "@/pages/SupplierDetailPage";
import VendorProfilePreviewPage from "@/pages/vendor/VendorProfilePreviewPage";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

const realFetch = globalThis.fetch;
const SUPPLIER_ID = "v77";

let detail: SupplierDetail;
let availability: SupplierAvailability;
let reviews: SupplierReview[];
let weddingDate: string | null;
let coupleId = 4000;
const calls: { url: string; method: string }[] = [];

// Far enough ahead that "the wedding is in the past" can never trip this.
const WEDDING = `${new Date().getFullYear() + 2}-06-12`;

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
    // The owner-only preview reads the vendor's own listing from their session.
    if (url.includes("/api/vendor/listing/me/preview")) return json(detail);
    if (url.includes("/api/vendor/listing/me")) {
      return json({ listing: { id: SUPPLIER_ID }, photos: [], videos: [], packages: [] });
    }
    if (url.includes("/api/picks")) return json({ picks: [] });
    if (url.includes("/api/saved-suppliers")) return json({ saved: [] });
    if (url.includes("/api/couples/current")) {
      return json({
        couple: {
          id: coupleId,
          wedding_date: weddingDate,
          currency: "EUR",
          target_guest_count: null,
          guest_count_goal: { kind: "exact", exact: 80, min: null, max: null },
        },
      });
    }
    if (url.includes("/reviews")) {
      return json({ items: reviews, can_review: false, already_reviewed: false, nextCursor: null });
    }
    if (url.includes("/comments")) return json({ items: [], nextCursor: null });
    if (url.includes("/availability")) return json(availability);
    if (url.includes(`/api/suppliers/${SUPPLIER_ID}`)) return json(detail);
    return json({});
  }) as typeof fetch;
}

async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={[`/app/suppliers/${SUPPLIER_ID}`]}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <Routes>
                <Route path="/app/suppliers/:supplier_id" element={children} />
              </Routes>
            </ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

async function renderPage() {
  render(
    <Providers>
      <SupplierDetailPage />
    </Providers>,
  );
  await flush();
}

function pkg(over: Partial<ListingPackage> & Pick<ListingPackage, "id" | "name">): ListingPackage {
  return {
    price_text: null,
    price_min: null,
    price_max: null,
    price_mode: null,
    description: null,
    pdf_url: null,
    pdf_name: null,
    ...over,
  };
}

function navLabels(): string[] {
  const nav = screen.getByRole("navigation", { name: "Page sections" });
  return within(nav)
    .getAllByRole("button")
    .map((b) => b.textContent ?? "");
}

beforeEach(() => {
  calls.length = 0;
  coupleId += 1;
  weddingDate = WEDDING;
  reviews = [];
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* happy-dom without storage, ignore */
  }
  detail = {
    id: SUPPLIER_ID,
    name: "Fényes Fotó",
    category: "photography",
    city: "Szeged",
    country: "HU",
    currency: "EUR",
    blurb_hu: "",
    blurb_en: "Documentary wedding photography.",
    website: "",
    contact_email: null,
    contact_phone: "+36 30 123 4567",
    address: "Kárász u. 1",
    capacity_min: null,
    capacity_max: null,
    venue_style: null,
    lat: null,
    lng: null,
    source: "claimed",
    submitter_type: "self",
    price_band: null,
    vendor_account_id: 9,
    hero_image_url: null,
    gallery_urls: [],
    has_contact_email: true,
    has_contact_phone: true,
    votes_score: 0,
    user_vote: 0,
    reviews_count: 0,
    listing_complete: true,
    bookable: true,
    videos: [],
    packages: [
      pkg({
        id: 11,
        name: "Full day",
        price_min: 1_200,
        price_max: 1_800,
        price_mode: "total",
        description: "Duration: 8 hours\nPhotographers: 2",
      }),
      pkg({ id: 12, name: "Ceremony only", price_min: 500, price_mode: "total" }),
    ],
    reviews_summary: {
      avg_rating: null,
      reviews_count: 0,
      histogram: [0, 0, 0, 0, 0],
      top_tags: [],
    },
  } as SupplierDetail;
  availability = {
    unavailable_dates: [],
    partial_dates: [],
    next_available: null,
    bookable: true,
    calendar_public: true,
    available_weekdays: null,
  };
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("SupplierDetailPage: packages are a menu of quote requests", () => {
  it("lists every package as a row with its guide price and a quote button", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { name: "Packages" })).toBeTruthy();
    expect(screen.getByText("Full day")).toBeTruthy();
    expect(screen.getByText("Ceremony only")).toBeTruthy();
    expect(screen.getAllByTestId("package-request")).toHaveLength(2);
    // The note that these are guidance, not a binding quote.
    expect(screen.getByText(/Guide prices\./)).toBeTruthy();
  });

  it("opens the composer pre-written for the package that was clicked", async () => {
    await renderPage();

    fireEvent.click(screen.getAllByTestId("package-request")[0] as HTMLElement);
    await flush(6);

    const subject = screen.getByDisplayValue(/^Quote request: Full day, wedding on /);
    expect(subject).toBeTruthy();
    // The body names the package and carries the couple's own headcount.
    expect(screen.getByDisplayValue(/interested in your "Full day" package/)).toBeTruthy();
    expect(screen.getByDisplayValue(/with 80 guests/)).toBeTruthy();
  });

  it("offers no quote button when the vendor has no deliverable mailbox", async () => {
    detail = { ...detail, has_contact_email: false };
    await renderPage();

    expect(screen.getByText("Full day")).toBeTruthy();
    expect(screen.queryByTestId("package-request")).toBeNull();
  });

  it("drops the packages section (and its nav tab) when the listing has none", async () => {
    detail = { ...detail, packages: [] };
    await renderPage();

    expect(screen.queryByText("Guide prices.", { exact: false })).toBeNull();
    expect(navLabels()).not.toContain("Packages");
  });
});

describe("SupplierDetailPage: the sticky section nav", () => {
  it("lists exactly the sections this listing has, in reading order", async () => {
    await renderPage();
    expect(navLabels()).toEqual([
      "Packages",
      "About",
      "Reviews",
      "Availability",
      "Questions & answers",
    ]);
  });

  it("adds Videos when there are some and drops Availability for a private calendar", async () => {
    detail = {
      ...detail,
      videos: [
        { id: 1, url: "https://youtu.be/abc", provider: "youtube" },
      ] as SupplierDetail["videos"],
    };
    availability = { ...availability, calendar_public: false };
    await renderPage();

    const labels = navLabels();
    expect(labels).toContain("Videos");
    expect(labels).not.toContain("Availability");
    // The section itself goes too, not just its tab.
    expect(document.getElementById("supplier-availability")).toBeNull();
  });

  it("has an anchor on the page for every tab it shows", async () => {
    await renderPage();
    for (const id of [
      "supplier-packages",
      "supplier-about",
      "supplier-reviews",
      "supplier-availability",
      "supplier-comments",
    ]) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });
});

describe("SupplierDetailPage: the wedding-day verdict", () => {
  it("says free when the vendor's calendar is open on the couple's date", async () => {
    await renderPage();

    const notes = screen.getAllByTestId("wedding-day-note");
    // Once in the header, once in the booking card.
    expect(notes).toHaveLength(2);
    for (const n of notes) expect(n.getAttribute("data-status")).toBe("free");
    expect(notes[0]?.textContent).toContain("Free on your wedding day");
  });

  it("says not available when that exact date is blocked", async () => {
    availability = { ...availability, unavailable_dates: [WEDDING] };
    await renderPage();

    const notes = screen.getAllByTestId("wedding-day-note");
    for (const n of notes) expect(n.getAttribute("data-status")).toBe("busy");
    expect(notes[0]?.textContent).toContain("Not available on your wedding day");
  });

  it("stays silent for a vendor Weddly cannot vouch for, rather than printing 'free'", async () => {
    detail = { ...detail, vendor_account_id: null, bookable: false };
    availability = { ...availability, bookable: false };
    await renderPage();
    expect(screen.queryByTestId("wedding-day-note")).toBeNull();
  });

  it("stays silent when the couple has not set a date", async () => {
    weddingDate = null;
    await renderPage();
    expect(screen.queryByTestId("wedding-day-note")).toBeNull();
  });

  it("falls back to the next free date when there is no wedding date to check", async () => {
    weddingDate = null;
    availability = { ...availability, next_available: "2027-03-05" };
    await renderPage();
    expect(screen.getByText(/Next available date:/)).toBeTruthy();
  });
});

describe("SupplierDetailPage: profile chrome keeps what the old page carried", () => {
  it("keeps the address, phone and the three actions in the one booking card", async () => {
    await renderPage();

    expect(screen.getAllByText(/Szeged · Kárász u\. 1/).length).toBeGreaterThan(0);
    expect(screen.getByText("+36 30 123 4567")).toBeTruthy();
    // The card's button, and its twin in the fixed mobile bar.
    expect(screen.getAllByText("Send inquiry")).toHaveLength(2);
    expect(screen.getByTestId("supplier-save-toggle")).toBeTruthy();
    expect(screen.getByTestId("supplier-pick-toggle")).toBeTruthy();
  });

  it("shows the latest written reviews in their own words under the summary", async () => {
    reviews = [
      {
        id: 1,
        supplier_id: SUPPLIER_ID,
        rating: 5,
        body: "They caught every tear.",
        tags: [],
        amount_paid: null,
        amount_currency: null,
        amount_note: null,
        published: true,
        editorial: false,
        verified: true,
        author: { display_name: "Anna & Bence" },
        created_at: Date.now(),
        updated_at: Date.now(),
      },
      {
        id: 2,
        supplier_id: SUPPLIER_ID,
        rating: 4,
        body: null,
        tags: [],
        amount_paid: null,
        amount_currency: null,
        amount_note: null,
        published: true,
        editorial: false,
        verified: false,
        author: { display_name: "Silent Sam" },
        created_at: Date.now(),
        updated_at: Date.now(),
      },
    ] as SupplierReview[];
    await renderPage();

    expect(screen.getByText("They caught every tear.")).toBeTruthy();
    expect(screen.getByText(/Anna & Bence/)).toBeTruthy();
    // A star rating with no words is not a snippet.
    expect(screen.queryByText(/Silent Sam/)).toBeNull();
  });
});

/** Where the router is, so a test can prove the page did not move it. */
function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

async function renderPreview() {
  render(
    <MemoryRouter initialEntries={["/vendor/listing/preview"]}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <Where />
              <Routes>
                <Route path="/vendor/listing/preview" element={<VendorProfilePreviewPage />} />
                <Route path="/vendor/listing" element={<div>EDITOR</div>} />
              </Routes>
            </ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  await flush(6);
}

describe("SupplierDetailPage: the vendor's own couple's-eye preview", () => {
  it("resolves the vendor's own listing and shows the same page couples get", async () => {
    await renderPreview();
    expect(screen.getByRole("heading", { level: 1, name: /Fényes Fotó/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Packages" })).toBeTruthy();
    expect(screen.getByText("Full day")).toBeTruthy();
    expect(navLabels()).toEqual([
      "Packages",
      "About",
      "Reviews",
      "Availability",
      "Questions & answers",
    ]);
    expect(screen.getByRole("note").textContent).toContain("saved version");
  });

  it("acts as nobody: every couple action is off", async () => {
    await renderPreview();
    for (const id of ["supplier-save-toggle", "supplier-pick-toggle"]) {
      expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByText("Send inquiry").closest("button") as HTMLButtonElement).disabled).toBe(
      true,
    );
    // No quote buttons on the package rows, and no fixed mobile action bar.
    expect(screen.queryByTestId("package-request")).toBeNull();
    expect(screen.queryByTestId("supplier-save-toggle-mobile")).toBeNull();
  });

  it("control: the same page for a couple DOES count a view and read the workspace", async () => {
    await renderPage();
    expect(calls.some((c) => c.url.includes("/api/suppliers/events"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/couples/current"))).toBe(true);
  });

  it("counts nothing and reads no couple workspace", async () => {
    await renderPreview();
    // A view event would inflate the vendor's own reach number; a couple fetch
    // is a call a vendor has no workspace for.
    expect(calls.some((c) => c.url.includes("/api/suppliers/events"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/api/couples/current"))).toBe(false);
  });

  it("reads the owner-only preview endpoint, never the public detail one", async () => {
    await renderPreview();
    expect(calls.some((c) => c.url.includes("/api/vendor/listing/me/preview"))).toBe(true);
    expect(calls.some((c) => c.url === `/api/suppliers/${SUPPLIER_ID}`)).toBe(false);
  });

  it("leaves the address bar alone instead of upgrading it to the couple's URL", async () => {
    await renderPreview();
    expect(screen.getByTestId("where").textContent).toBe("/vendor/listing/preview");
  });

  it("shows the website without the tracked redirect, so a look never counts as a click", async () => {
    detail = { ...detail, website: "https://fenyesfoto.example" };
    await renderPreview();
    expect(screen.getByText("Website")).toBeTruthy();
    expect(document.querySelector("a[href^='/r/supplier']")).toBeNull();
  });

  it("goes back to the editor, not the couple's directory", async () => {
    await renderPreview();
    fireEvent.click(screen.getByText("Back"));
    await flush();
    expect(screen.getByText("EDITOR")).toBeTruthy();
  });
});
