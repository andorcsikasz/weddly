// The anonymous vendor page as a teaser that leads into the app.
//
// It shows who the vendor is, their description, photos and reviews, and turns
// everything else into a locked placeholder with a sign-up CTA. What is pinned
// here is the wiring a screenshot cannot show: that every CTA goes to sign-up
// while remembering the vendor's page inside the app, that a signed-in visitor
// is sent straight to that page instead, and that the review link a vendor
// forwards to a past client still opens the composer with no account.

import type { PublicVendorPageData } from "@shared/suppliers";
import { vendorPublicId } from "@shared/vendor_slug";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import PublicVendorPage from "@/pages/PublicVendorPage";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

const realFetch = globalThis.fetch;
const VENDOR_ID = "v12";
const NAME = "Magyar Fotó";
const APP_PATH = `/app/suppliers/${vendorPublicId(VENDOR_ID, NAME)}`;
const STORAGE_KEY = "weddly.post_signup_destination";

let payload: PublicVendorPageData;
let signedIn: boolean;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/me")) {
      return signedIn
        ? json({ user: { id: 1, email: "couple@test.test", role: "couple", locale: "en" } })
        : new Response("{}", { status: 401 });
    }
    if (url.includes(`/api/public/vendors/${VENDOR_ID}`)) return json(payload);
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

/** Shows where a navigation landed, and the router state it carried. */
function Landing({ label }: { label: string }) {
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? "";
  return (
    <div>
      {label}
      <span data-testid="from">{from}</span>
    </div>
  );
}

function Providers({ children, entry }: { children: ReactNode; entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <Routes>
                <Route path="/suppliers/:supplier_id" element={children} />
                <Route path="/signup" element={<Landing label="SIGNUP PAGE" />} />
                <Route path="/login" element={<Landing label="LOGIN PAGE" />} />
                <Route path="/app/suppliers/:supplier_id" element={<Landing label="APP PAGE" />} />
              </Routes>
            </ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

async function renderPage(query = "") {
  render(
    <Providers entry={`/suppliers/${VENDOR_ID}${query}`}>
      <PublicVendorPage />
    </Providers>,
  );
  await flush();
}

beforeEach(() => {
  signedIn = false;
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
    if (signedIn) localStorage.setItem("weddly.token", "t");
  } catch {
    /* happy-dom without storage, ignore */
  }
  payload = {
    detail: {
      id: VENDOR_ID,
      name: NAME,
      company_name: null,
      category: "photography",
      city: "Budapest",
      country: "HU",
      blurb_hu: "",
      blurb_en: "Documentary wedding photography.",
      gallery_urls: ["/p1.jpg", "/p2.jpg", "/p3.jpg"],
      claimed: true,
      listing_complete: true,
      reviews_summary: {
        avg_rating: 4.8,
        reviews_count: 3,
        histogram: [0, 0, 0, 1, 2],
        top_tags: [],
      },
    },
    reviews: [
      {
        id: 1,
        supplier_id: VENDOR_ID,
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
    ],
  };
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("PublicVendorPage: what a stranger sees", () => {
  it("shows identity, description, photos and reviews", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: /Magyar Fotó/ })).toBeTruthy();
    expect(screen.getByText(/Budapest/)).toBeTruthy();
    expect(screen.getByText("Documentary wedding photography.")).toBeTruthy();
    expect(document.querySelectorAll("img").length).toBe(3);
    expect(screen.getByText("They caught every tear.")).toBeTruthy();
  });

  it("locks packages and availability + contact behind a CTA, in the in-app order", async () => {
    await renderPage();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    // Same order as the in-app page: packages, about, reviews (its own card
    // title), then availability and contact.
    const packages = headings.indexOf("Packages");
    const about = headings.indexOf("About");
    const details = headings.indexOf("Availability and contact");
    expect(packages).toBeGreaterThanOrEqual(0);
    expect(about).toBeGreaterThan(packages);
    expect(details).toBeGreaterThan(about);
    // One unlock CTA in each locked section.
    expect(screen.getAllByText("Sign up to see it")).toHaveLength(2);
  });

  it("carries no package, price, phone, address or website on the page", async () => {
    await renderPage();
    const text = document.body.textContent ?? "";
    expect(document.querySelector("a[href^='tel:']")).toBeNull();
    expect(document.querySelector("a[href^='/r/supplier']")).toBeNull();
    expect(document.querySelector("[data-testid='package-request']")).toBeNull();
    expect(text).not.toMatch(/\bFt\b|€/);
  });
});

describe("PublicVendorPage: every CTA leads to sign-up and back to the vendor", () => {
  it("the side card CTA goes to sign-up and remembers the vendor's page in the app", async () => {
    await renderPage();

    const cta = screen.getAllByText("Send an inquiry")[0] as HTMLElement;
    fireEvent.click(cta);
    await flush();

    expect(screen.getByText("SIGNUP PAGE")).toBeTruthy();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { path?: string };
    expect(stored.path).toBe(APP_PATH);
  });

  it("the locked-section CTA does the same", async () => {
    await renderPage();
    fireEvent.click(screen.getAllByText("Sign up to see it")[0] as HTMLElement);
    await flush();
    expect(screen.getByText("SIGNUP PAGE")).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toContain(APP_PATH);
  });

  it("an existing account goes to log-in, carrying the vendor's page as where to land", async () => {
    await renderPage();
    fireEvent.click(screen.getByText("I already have an account"));
    await flush();
    expect(screen.getByText("LOGIN PAGE")).toBeTruthy();
    expect(screen.getByTestId("from").textContent).toBe(APP_PATH);
  });
});

describe("PublicVendorPage: a signed-in visitor is sent to the real page", () => {
  it("swaps every sign-up CTA for a link into the app, and drops the log-in link", async () => {
    signedIn = true;
    localStorage.setItem("weddly.token", "t");
    await renderPage();

    expect(screen.queryByText("I already have an account")).toBeNull();
    expect(screen.queryByText("Send an inquiry")).toBeNull();
    const links = screen.getAllByText("Open the full profile");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link.getAttribute("href")).toBe(APP_PATH);
    // Nothing was remembered: they are already where they are going.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("PublicVendorPage: the review link a vendor forwards still works without an account", () => {
  it("?review=1 opens the reviews with the composer's email check", async () => {
    await renderPage("?review=1");
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Confirm your email with Google to leave a review/),
    ).toBeTruthy();
  });
});

describe("PublicVendorPage: the owner's claim link", () => {
  it("stays hidden on a claimed listing", async () => {
    await renderPage();
    expect(screen.queryByRole("button", { name: "Claim this profile" })).toBeNull();
  });

  it("is one quiet footer link on an unclaimed listing, with no banner around it", async () => {
    payload = { ...payload, detail: { ...payload.detail, claimed: false } };
    await renderPage();
    expect(screen.getByRole("button", { name: "Claim this profile" })).toBeTruthy();
    expect(screen.queryByText("Is this your business?")).toBeNull();
  });
});
