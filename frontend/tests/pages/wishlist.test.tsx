// WishlistEditorPage + GuestPortalView (wishlist deck) component tests.
//
// WishlistEditorPage: mount with a mocked fetch, assert the list renders, that
// adding/editing posts the right body (including currency → minor-unit
// conversion in both HU and EN locales), and that delete goes through the
// ConfirmDialog. GuestPortalView: assert the deck renders ONLY when a non-empty
// wishlist is passed, and that the group_gift toggle invokes its handler.
//
// Provider stack mirrors App.tsx:
//   MemoryRouter → I18nProvider → AppProviders (Toast + Confirm + Entry)
//   → AuthProvider → <page>

import type { Couple } from "@shared/types";
import type { WishlistEntry, WishlistItem } from "@shared/wishlist";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import WishlistEditorPage from "@/pages/WishlistEditorPage";
import { GuestPortalView } from "@/components/GuestPortalView";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider, _preloadHuForTests } from "@/lib/i18n";
import { AppProviders } from "@/components/ui/AppProviders";

// ── Fetch mock (handler registry) ──────────────────────────────────────────

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
const realFetch = globalThis.fetch;
const handlers: ((req: {
  url: string;
  method: Method;
  body: unknown;
}) => Response | null)[] = [];
const fetchCalls: { url: string; method: Method; body: unknown }[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function on(
  predicate: (req: { url: string; method: Method }) => boolean,
  responder: (req: { url: string; method: Method; body: unknown }) => Response,
) {
  handlers.push((req) => (predicate(req) ? responder(req) : null));
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = ((init?.method ?? "GET").toUpperCase() as Method) ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    fetchCalls.push({ url, method, body });
    for (const h of handlers) {
      const res = h({ url, method, body });
      if (res) return res;
    }
    return jsonResponse(200, {});
  }) as typeof fetch;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCouple(over: Partial<Couple> = {}): Couple {
  return {
    id: 1,
    partner_a_id: 1,
    partner_b_id: null,
    display_name: "Ada & Bence",
    bride_name: "Ada",
    groom_name: "Bence",
    slug: "ADABENCE",
    wedding_date_goal: { kind: "tbd" },
    wedding_date: null,
    previous_wedding_date: null,
    ceremony_kind: null,
    archived_at: null,
    guest_count_goal: { kind: "tbd" },
    target_guest_count: null,
    budget_goal: { kind: "tbd" },
    budget_ceiling_huf: null,
    currency: "HUF",
    planning_count: null,
    frozen_categories: [],
    location_lat: null,
    location_lng: null,
    location_radius_km: null,
    style_tags: [],
    status: "active",
    honeymoon_destination: null,
    honeymoon_start_date: null,
    honeymoon_end_date: null,
    rsvp_offers_accommodation: false,
    rsvp_collects_meal: true,
    is_demo: false,
    created_at: 0,
    onboarded_at: null,
    updated_at: 0,
    ...over,
  } as Couple;
}

function makeItem(over: Partial<WishlistItem> = {}): WishlistItem {
  return {
    id: 1,
    couple_id: 1,
    title: "Espresso machine",
    description: null,
    kind: "item",
    target_amount_minor: null,
    currency: null,
    url: null,
    image_url: null,
    interest_count: 0,
    pledged_amount_minor: 0,
    sort_order: 0,
    created_at: 0,
    updated_at: 100,
    ...over,
  };
}

function makeEntry(over: Partial<WishlistEntry> = {}): WishlistEntry {
  return {
    id: 1,
    title: "Group honeymoon fund",
    description: null,
    kind: "item",
    target_amount_minor: null,
    currency: null,
    url: null,
    image_url: null,
    interest_count: 0,
    pledged_amount_minor: 0,
    viewer_has_interest: false,
    viewer_pledged_amount_minor: null,
    ...over,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>
        <AppProviders>
          <AuthProvider>{children}</AuthProvider>
        </AppProviders>
      </I18nProvider>
    </MemoryRouter>
  );
}

async function renderPage(node: ReactNode) {
  const utils = render(<Providers>{node}</Providers>);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return utils;
}

function setLocale(loc: "hu" | "en") {
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", loc);
  } catch {
    // ignore
  }
}

beforeEach(() => {
  handlers.length = 0;
  fetchCalls.length = 0;
  setLocale("en");
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── WishlistEditorPage ───────────────────────────────────────────────────────

describe("WishlistEditorPage", () => {
  it("renders the couple's wishlist items", async () => {
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/couples/current"),
      () => jsonResponse(200, { couple: makeCouple() }),
    );
    on(
      ({ url, method }) => method === "GET" && url.endsWith("/api/wishlist"),
      () =>
        jsonResponse(200, {
          items: [
            makeItem({ id: 1, title: "Espresso machine" }),
            makeItem({ id: 2, title: "A weekend away", kind: "group_gift" }),
          ],
        }),
    );

    await renderPage(<WishlistEditorPage />);

    expect(await screen.findByText("Espresso machine")).toBeInTheDocument();
    expect(screen.getByText("A weekend away")).toBeInTheDocument();
  });

  it("adding an item POSTs the title + kind (EUR amount → minor units ×100)", async () => {
    setLocale("en");
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/couples/current"),
      () => jsonResponse(200, { couple: makeCouple({ currency: "EUR" }) }),
    );
    on(
      ({ url, method }) => method === "GET" && url.endsWith("/api/wishlist"),
      () => jsonResponse(200, { items: [] }),
    );
    let postBody: Record<string, unknown> | null = null;
    on(
      ({ url, method }) => method === "POST" && url.endsWith("/api/wishlist"),
      ({ body }) => {
        postBody = body as Record<string, unknown>;
        return jsonResponse(200, {
          item: makeItem({ id: 9, title: "A weekend away", kind: "group_gift" }),
        });
      },
    );

    await renderPage(<WishlistEditorPage />);

    await act(async () => {
      // Two "Add a wish" buttons render on the empty state (header + card) —
      // the header one is first.
      fireEvent.click(screen.getAllByRole("button", { name: /Add a wish/i })[0]!);
      await Promise.resolve();
    });

    fireEvent.change(screen.getByPlaceholderText(/A weekend away/i), {
      target: { value: "A weekend away" },
    });
    // Kind select → group_gift. Two comboboxes now render (kind + the per-item
    // currency selector); the kind select is the first.
    const kindSelect = screen.getAllByRole("combobox")[0]!;
    fireEvent.change(kindSelect, { target: { value: "group_gift" } });
    // Rough amount in whole EUR units → must serialize as ×100 minor units.
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "250" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      title: "A weekend away",
      kind: "group_gift",
      target_amount_minor: 25000,
    });
  });

  it("HU locale: HUF amount serializes as whole units (×1)", async () => {
    setLocale("hu");
    await _preloadHuForTests();
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/couples/current"),
      () => jsonResponse(200, { couple: makeCouple({ currency: "HUF" }) }),
    );
    on(
      ({ url, method }) => method === "GET" && url.endsWith("/api/wishlist"),
      () => jsonResponse(200, { items: [] }),
    );
    let postBody: Record<string, unknown> | null = null;
    on(
      ({ url, method }) => method === "POST" && url.endsWith("/api/wishlist"),
      ({ body }) => {
        postBody = body as Record<string, unknown>;
        return jsonResponse(200, { item: makeItem({ id: 3, title: "Kávégép" }) });
      },
    );

    await renderPage(<WishlistEditorPage />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Új kívánság/i })[0]!);
      await Promise.resolve();
    });

    // Title input via its HU placeholder.
    const titleInput = screen.getByPlaceholderText(/Egy hosszú hétvége/i);
    fireEvent.change(titleInput, { target: { value: "Kávégép" } });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "180000" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Mentés/i }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({ title: "Kávégép", target_amount_minor: 180000 });
  });

  it("entering a URL fetches its preview image and includes it in the POST", async () => {
    setLocale("en");
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/couples/current"),
      () => jsonResponse(200, { couple: makeCouple() }),
    );
    on(
      ({ url, method }) => method === "GET" && url.endsWith("/api/wishlist"),
      () => jsonResponse(200, { items: [] }),
    );
    let previewUrlParam: string | null = null;
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/wishlist/link-preview"),
      ({ url }) => {
        previewUrlParam = new URL(url, "http://x").searchParams.get("url");
        return jsonResponse(200, { image_url: "https://cdn.test/p.jpg", title: "Pretty thing" });
      },
    );
    let postBody: Record<string, unknown> | null = null;
    on(
      ({ url, method }) => method === "POST" && url.endsWith("/api/wishlist"),
      ({ body }) => {
        postBody = body as Record<string, unknown>;
        return jsonResponse(200, { item: makeItem({ id: 7, title: "Linked gift" }) });
      },
    );

    await renderPage(<WishlistEditorPage />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /Add a wish/i })[0]!);
      await Promise.resolve();
    });

    fireEvent.change(screen.getByPlaceholderText(/A weekend away/i), {
      target: { value: "Linked gift" },
    });
    const urlInput = screen.getByPlaceholderText("https://…");
    fireEvent.change(urlInput, { target: { value: "https://shop.test/p" } });
    await act(async () => {
      fireEvent.blur(urlInput);
      await Promise.resolve();
      await Promise.resolve();
    });

    // The preview was requested for the entered URL...
    await waitFor(() => expect(previewUrlParam).toBe("https://shop.test/p"));
    // ...and its image shows in the dialog.
    await waitFor(() =>
      expect(document.querySelector('img[src="https://cdn.test/p.jpg"]')).not.toBeNull(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      title: "Linked gift",
      url: "https://shop.test/p",
      image_url: "https://cdn.test/p.jpg",
    });
  });

  it("editing an existing item PATCHes with the If-Match header", async () => {
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/couples/current"),
      () => jsonResponse(200, { couple: makeCouple() }),
    );
    on(
      ({ url, method }) => method === "GET" && url.endsWith("/api/wishlist"),
      () =>
        jsonResponse(200, {
          items: [makeItem({ id: 7, title: "Espresso machine", updated_at: 4242 })],
        }),
    );
    on(
      ({ url, method }) => method === "PATCH" && url.includes("/api/wishlist/7"),
      () => jsonResponse(200, { item: makeItem({ id: 7, title: "Espresso machine v2" }) }),
    );

    await renderPage(<WishlistEditorPage />);

    const row = await screen.findByText("Espresso machine");
    await act(async () => {
      fireEvent.click(row);
      await Promise.resolve();
    });

    const titleInput = screen.getByDisplayValue("Espresso machine");
    fireEvent.change(titleInput, { target: { value: "Espresso machine v2" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const patch = fetchCalls.find((c) => c.method === "PATCH" && c.url.includes("/api/wishlist/7"));
    expect(patch).toBeTruthy();
  });

  it("deleting an item goes through the ConfirmDialog then DELETEs", async () => {
    on(
      ({ url, method }) => method === "GET" && url.includes("/api/couples/current"),
      () => jsonResponse(200, { couple: makeCouple() }),
    );
    on(
      ({ url, method }) => method === "GET" && url.endsWith("/api/wishlist"),
      () => jsonResponse(200, { items: [makeItem({ id: 5, title: "Espresso machine" })] }),
    );
    on(
      ({ url, method }) => method === "DELETE" && url.includes("/api/wishlist/5"),
      () => jsonResponse(200, { ok: true }),
    );

    await renderPage(<WishlistEditorPage />);

    await screen.findByText("Espresso machine");
    // The trash button shares the generic "Remove" aria-label.
    const removeBtn = screen.getByRole("button", { name: /^Remove$/i });
    await act(async () => {
      fireEvent.click(removeBtn);
      await Promise.resolve();
    });

    // ConfirmDialog appears — click its confirm action.
    const confirmBtn = await screen.findByRole("button", { name: /Yes, delete|Delete/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        fetchCalls.some((c) => c.method === "DELETE" && c.url.includes("/api/wishlist/5")),
      ).toBe(true),
    );
  });
});

// ── GuestPortalView wishlist deck ─────────────────────────────────────────────

const basePortalData = {
  couple_slug: "ADABENCE",
  couple_display_name: "Ada & Bence",
  cover_image_url: null,
  useful_info: null,
  guest_page_intro: null,
  wedding_date: null,
  ceremony_kind: null,
  location_lat: null,
  location_lng: null,
  location_radius_km: null,
  schedule: [],
  household_code: "",
  household_label: "",
  members: [],
  fetched_at: 0,
};

describe("GuestPortalView wishlist deck", () => {
  it("renders nothing when wishlist is absent / empty / null", () => {
    const { rerender, queryByText } = render(
      <Providers>
        <GuestPortalView data={{ ...basePortalData }} locale="en" />
      </Providers>,
    );
    expect(queryByText("Wishlist")).toBeNull();

    rerender(
      <Providers>
        <GuestPortalView data={{ ...basePortalData }} locale="en" wishlist={[]} />
      </Providers>,
    );
    expect(queryByText("Wishlist")).toBeNull();

    rerender(
      <Providers>
        <GuestPortalView data={{ ...basePortalData }} locale="en" wishlist={null} />
      </Providers>,
    );
    expect(queryByText("Wishlist")).toBeNull();
  });

  it("renders the deck when a non-empty wishlist is passed", () => {
    render(
      <Providers>
        <GuestPortalView
          data={{ ...basePortalData }}
          locale="en"
          wishlist={[makeEntry({ id: 1, title: "Espresso machine" })]}
        />
      </Providers>,
    );
    expect(screen.getByText("Wishlist")).toBeInTheDocument();
    expect(screen.getByText("Espresso machine")).toBeInTheDocument();
  });

  it("group_gift toggle invokes the handler with the item id", () => {
    const onToggle = mock((_id: number) => {});
    render(
      <Providers>
        <GuestPortalView
          data={{ ...basePortalData }}
          locale="en"
          wishlist={[
            makeEntry({ id: 42, title: "Honeymoon fund", kind: "group_gift", interest_count: 2 }),
          ]}
          onToggleWishlistInterest={onToggle}
        />
      </Providers>,
    );
    // Soft chip-in count line.
    expect(screen.getByText(/2 households are chipping in/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /I'd like to help/i });
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle.mock.calls[0]?.[0]).toBe(42);
  });
});
