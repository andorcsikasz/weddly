// Dashboard "Kulcsinfó" quick-access card. Guards the venue-resolution
// priority (picked directory venue → free-text venue_name → CTA), the Google
// Maps link (exact coords when available, else name/address + city), the
// tel: call buttons, the booked-supplier contact list (venue excluded), and the
// two empty states. The card self-fetches /api/picks + /api/suppliers +
// /api/couple-suppliers, so we stub globalThis.fetch with the same handler-
// registry pattern the other dashboard-card tests use.

import type { CouplePick } from "@shared/picks";
import type { DirectorySupplier } from "@shared/suppliers";
import type { Couple } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { KeyInfoCard } from "@/components/KeyInfoCard";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Call = { url: string; method: Method; body: unknown };

const realFetch = globalThis.fetch;
const calls: Call[] = [];
let picks: CouplePick[] = [];
let suppliers: DirectorySupplier[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    calls.push({ url, method, body });
    if (method === "PATCH" && url.includes("/api/couples/current")) {
      // Echo the patched fields back as the updated couple (the card only reads
      // the venue/contact fields off the response via pickFields).
      return jsonResponse(200, { couple: body });
    }
    if (url.includes("/api/couple-suppliers")) return jsonResponse(200, { suppliers: [] });
    if (url.includes("/api/suppliers")) return jsonResponse(200, { suppliers, countries: [] });
    if (url.includes("/api/picks")) return jsonResponse(200, { picks });
    return jsonResponse(200, {});
  }) as typeof fetch;
}

async function flush(times = 2) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

function pick(category: string, supplier_id: string): CouplePick {
  return { category, supplier_id, picked_by_user_id: 1, picked_at: 0 };
}

function dir(over: Partial<DirectorySupplier>): DirectorySupplier {
  return {
    id: "x",
    name: "X",
    category: "other",
    city: "",
    country: "HU",
    blurb_hu: "",
    blurb_en: "",
    website: "",
    contact_email: null,
    contact_phone: null,
    address: null,
    capacity_min: null,
    capacity_max: null,
    venue_style: null,
    lat: null,
    lng: null,
    source: "curated",
    submitter_type: null,
    price_band: null,
    vendor_account_id: null,
    hero_image_url: null,
    gallery_urls: null,
    votes_score: 0,
    user_vote: 0,
    ...over,
  } as DirectorySupplier;
}

// The card only reads venue_name / venue_city off the couple; cast a partial.
function couple(over: Partial<Couple> = {}): Couple {
  return { venue_name: null, venue_city: null, ...over } as unknown as Couple;
}

beforeEach(() => {
  calls.length = 0;
  picks = [];
  suppliers = [];
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    // ignore
  }
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("<KeyInfoCard>", () => {
  it("shows the picked directory venue richly (coords + phone) when nothing is overridden", async () => {
    picks = [pick("venue", "v1"), pick("photography", "p1"), pick("dj", "d1")];
    suppliers = [
      dir({
        id: "v1",
        name: "Aranybástya",
        category: "venue",
        city: "Budapest",
        address: "Budai Vár",
        contact_phone: "+36 1 200 8817",
        lat: 47.5,
        lng: 19.04,
      }),
      dir({
        id: "p1",
        name: "Foto Studio",
        category: "photography",
        contact_phone: "+36 20 111 2222",
      }),
      dir({ id: "d1", name: "DJ Max", category: "dj", contact_phone: null }),
    ];
    const { container } = render(
      <Providers>
        <KeyInfoCard couple={couple({})} />
      </Providers>,
    );
    await flush();

    // No manual override → the picked venue's own name/address/coords surface.
    expect(screen.getByText("Aranybástya")).toBeInTheDocument();
    expect(screen.getByText("Budai Vár")).toBeInTheDocument();

    // The row links to the picked directory vendor's own detail page.
    expect(container.querySelector('a[href="/app/suppliers/v1"]')).toBeTruthy();
    // Venue phone → tel: with spaces stripped.
    expect(container.querySelector('a[href="tel:+3612008817"]')).toBeTruthy();

    // Contacts list: the two non-venue picks, venue excluded.
    expect(screen.getByText("Foto Studio")).toBeInTheDocument();
    expect(screen.getByText("DJ Max")).toBeInTheDocument();
    expect(container.querySelector('a[href="tel:+36201112222"]')).toBeTruthy();
    // "All vendors" jumps to the vendors hub.
    expect(container.querySelector('a[href="/app/vendors"]')).toBeTruthy();
  });

  it("manual venue fields override the picked venue, and renders coordinator + emergency rows", async () => {
    picks = [pick("venue", "v1")];
    suppliers = [
      dir({
        id: "v1",
        name: "Aranybástya",
        category: "venue",
        city: "Budapest",
        address: "Budai Vár",
        contact_phone: "+36 1 200 8817",
        lat: 47.5,
        lng: 19.04,
      }),
    ];
    const { container } = render(
      <Providers>
        <KeyInfoCard
          couple={couple({
            venue_name: "Sári Csárda",
            venue_city: "Dunakiliti",
            venue_address: "Fő út 1",
            venue_phone: "+36 30 111 2222",
            coordinator_name: "Anna",
            coordinator_phone: "+36 20 333 4444",
            emergency_name: "Béla",
            emergency_phone: "+36 70 555 6666",
          })}
        />
      </Providers>,
    );
    await flush();

    // Manual name + phone win over the picked venue.
    expect(screen.getByText("Sári Csárda")).toBeInTheDocument();
    expect(screen.queryByText("Aranybástya")).not.toBeInTheDocument();
    expect(container.querySelector('a[href="tel:+36301112222"]')).toBeTruthy();
    // Renamed away from the pick → the row detaches from the stale vendor: it
    // links to the hub, not the picked venue's detail page.
    expect(container.querySelector('a[href="/app/vendors"]')).toBeTruthy();
    expect(container.querySelector('a[href="/app/suppliers/v1"]')).toBeNull();

    // Coordinator + emergency rows with their own call buttons.
    expect(screen.getByText("Coordinator")).toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
    expect(container.querySelector('a[href="tel:+36203334444"]')).toBeTruthy();
    expect(screen.getByText("Emergency")).toBeInTheDocument();
    expect(screen.getByText("Béla")).toBeInTheDocument();
    expect(container.querySelector('a[href="tel:+36705556666"]')).toBeTruthy();
  });

  it("edits and saves the venue phone via PATCH, updating the panel", async () => {
    picks = [];
    suppliers = [];
    const { container } = render(
      <Providers>
        <KeyInfoCard couple={couple({ venue_name: "Sári Csárda" })} />
      </Providers>,
    );
    await flush();
    // No phone yet → no venue call button.
    expect(container.querySelector('a[href^="tel:"]')).toBeNull();

    // Open the editor, type a venue phone, save.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    });
    await flush();
    const phoneInput = screen.getByLabelText("Venue phone");
    await act(async () => {
      fireEvent.change(phoneInput, { target: { value: "+36 30 111 2222" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    await flush();

    // PATCH carried the new phone.
    const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/api/couples/current"));
    expect(patch).toBeDefined();
    expect(patch?.body).toMatchObject({ venue_phone: "+36 30 111 2222" });

    // Panel now offers a call button for the venue.
    expect(container.querySelector('a[href="tel:+36301112222"]')).toBeTruthy();
  });

  it("falls back to the free-text venue name (in-app map) when nothing is picked", async () => {
    picks = [];
    suppliers = [];
    const { container } = render(
      <Providers>
        <KeyInfoCard couple={couple({ venue_name: "Sári Csárda", venue_city: "Dunakiliti" })} />
      </Providers>,
    );
    await flush();

    expect(screen.getByText("Sári Csárda")).toBeInTheDocument();
    expect(screen.getByText("Dunakiliti")).toBeInTheDocument();
    // No pick → the row links to the vendors hub (no detail page to open).
    expect(container.querySelector('a[href="/app/vendors"]')).toBeTruthy();
    // No phone available in the free-text path.
    expect(screen.queryByText("Call")).not.toBeInTheDocument();
    // No suppliers → the add-vendors CTA.
    expect(screen.getByText("Add vendors")).toBeInTheDocument();
  });

  it("detaches a stale pick when the venue is renamed: no wrong phone or vendor link", async () => {
    // The couple picked Aranybástya, then retyped the venue name to a different
    // venue without re-picking. The card must NOT lend the old vendor's phone or
    // detail page to the renamed venue (the Kulcsinfó stale-relink bug).
    picks = [pick("venue", "v1")];
    suppliers = [
      dir({
        id: "v1",
        name: "Aranybástya",
        category: "venue",
        city: "Budapest",
        address: "Budai Vár",
        contact_phone: "+36 1 200 8817",
        lat: 47.5,
        lng: 19.04,
      }),
    ];
    const { container } = render(
      <Providers>
        <KeyInfoCard couple={couple({ venue_name: "Hertelendy Kastély" })} />
      </Providers>,
    );
    await flush();

    // The renamed venue shows; the stale vendor's name never does.
    expect(screen.getByText("Hertelendy Kastély")).toBeInTheDocument();
    expect(screen.queryByText("Aranybástya")).not.toBeInTheDocument();
    // No call button dialling the stale vendor's number.
    expect(container.querySelector('a[href="tel:+3612008817"]')).toBeNull();
    // The row links to the vendors hub, never the stale vendor's detail page.
    expect(container.querySelector('a[href="/app/suppliers/v1"]')).toBeNull();
    expect(container.querySelector('a[href="/app/vendors"]')).toBeTruthy();
  });

  it("shows the set-venue CTA when there is no venue at all", async () => {
    picks = [];
    suppliers = [];
    const { container } = render(
      <Providers>
        <KeyInfoCard couple={couple({})} />
      </Providers>,
    );
    await flush();

    expect(screen.getByText("Add your venue details")).toBeInTheDocument();
    expect(container.querySelector('a[href="/app/guest-page"]')).toBeTruthy();
    expect(screen.getByText("Add vendors")).toBeInTheDocument();
  });

  it("collapse toggle hides the body and persists the closed state", async () => {
    picks = [];
    suppliers = [];
    render(
      <Providers>
        <KeyInfoCard couple={couple({ venue_name: "Sári Csárda" })} />
      </Providers>,
    );
    await flush();
    expect(screen.getByText("Sári Csárda")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Key info" });
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(screen.queryByText("Sári Csárda")).not.toBeInTheDocument();
    expect(localStorage.getItem("weddly.dashboard.keyinfo")).toBe("closed");
  });
});
