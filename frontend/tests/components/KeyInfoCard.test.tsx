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

const realFetch = globalThis.fetch;
let picks: CouplePick[] = [];
let suppliers: DirectorySupplier[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
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
  it("uses the picked directory venue (rich: coords + phone) over the free-text name", async () => {
    picks = [pick("venue", "v1"), pick("photo_video", "p1"), pick("music_dj", "d1")];
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
        category: "photo_video",
        contact_phone: "+36 20 111 2222",
      }),
      dir({ id: "d1", name: "DJ Max", category: "music_dj", contact_phone: null }),
    ];
    const { container } = render(
      <Providers>
        <KeyInfoCard couple={couple({ venue_name: "Sári Csárda", venue_city: "Dunakiliti" })} />
      </Providers>,
    );
    await flush();

    // The pick wins — free-text name is not shown.
    expect(screen.getByText("Aranybástya")).toBeInTheDocument();
    expect(screen.queryByText("Sári Csárda")).not.toBeInTheDocument();
    expect(screen.getByText("Budai Vár")).toBeInTheDocument();

    // Map link uses the exact coordinates.
    expect(
      container.querySelector(
        'a[href="https://www.google.com/maps/search/?api=1&query=47.5%2C19.04"]',
      ),
    ).toBeTruthy();
    // Venue phone → tel: with spaces stripped.
    expect(container.querySelector('a[href="tel:+3612008817"]')).toBeTruthy();

    // Contacts list: the two non-venue picks, venue excluded.
    expect(screen.getByText("Foto Studio")).toBeInTheDocument();
    expect(screen.getByText("DJ Max")).toBeInTheDocument();
    expect(container.querySelector('a[href="tel:+36201112222"]')).toBeTruthy();
    // "All vendors" jumps to the timeline contact panel.
    expect(container.querySelector('a[href="/app/timeline"]')).toBeTruthy();
  });

  it("falls back to the free-text venue name + a Maps search link when nothing is picked", async () => {
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
    const q = encodeURIComponent("Sári Csárda, Dunakiliti");
    expect(
      container.querySelector(`a[href="https://www.google.com/maps/search/?api=1&query=${q}"]`),
    ).toBeTruthy();
    // No phone available in the free-text path.
    expect(screen.queryByText("Call")).not.toBeInTheDocument();
    // No suppliers → the add-vendors CTA.
    expect(screen.getByText("Add vendors")).toBeInTheDocument();
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
