// The supplier detail page's two bookmark-ish affordances, and the fact that
// they are NOT the same thing.
//
// The directory grid carries a deliberate two-glyph vocabulary: a blush HEART
// is the shortlist (`saved_suppliers`, as many per category as you like) and a
// sage BOOKMARK is the pick (`couple_picks`, exactly one per category, "this is
// our photographer"). The detail page used to draw its Save button in the
// PICKED treatment (sage border + BookmarkCheck) and offered no pick control at
// all, so a couple who landed here from search read one glyph as two meanings
// and could not set the pick on the page they were actually standing on.
//
// These tests pin the glyph + colour family of each control and the endpoint
// each one writes to, because that pairing is the whole contract.

import type { SupplierAvailability, SupplierDetail } from "@shared/suppliers";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import SupplierDetailPage from "@/pages/SupplierDetailPage";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Call = { url: string; method: Method };

const realFetch = globalThis.fetch;
const calls: Call[] = [];

const SUPPLIER_ID = "v42";
const CATEGORY = "photography";

// A fresh couple id per test keeps the module-level caches in
// `lib/supplier_saved` + `lib/supplier_selection` from leaking one test's
// shortlist into the next (both hydrate once per couple id per process).
let coupleIdSeq = 900;
let coupleId = coupleIdSeq;

let detail: SupplierDetail;
let availability: SupplierAvailability;
/** Server-side pick map, keyed by category: the `couple_picks` UNIQUE rule. */
let picks: Record<string, string>;
let saved: string[];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase() as Method;
    calls.push({ url, method });

    if (url.includes("/api/picks")) {
      const category = url.split("/api/picks/")[1];
      if (method === "PUT" && category) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { supplier_id?: string };
        // One pick per category: the PUT replaces whoever held it.
        picks[decodeURIComponent(category)] = body.supplier_id ?? "";
        return jsonResponse(200, { pick: { category, supplier_id: body.supplier_id } });
      }
      if (method === "DELETE" && category) {
        delete picks[decodeURIComponent(category)];
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, {
        picks: Object.entries(picks).map(([category, supplier_id]) => ({
          category,
          supplier_id,
          picked_by_user_id: 1,
          picked_at: 0,
        })),
      });
    }
    if (url.includes("/api/saved-suppliers")) {
      const id = url.split("/api/saved-suppliers/")[1];
      if (method === "PUT" && id) {
        saved = [...new Set([...saved, decodeURIComponent(id)])];
        return jsonResponse(200, { ok: true });
      }
      if (method === "DELETE" && id) {
        saved = saved.filter((s) => s !== decodeURIComponent(id));
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, {
        saved: saved.map((supplier_id) => ({
          supplier_id,
          saved_by_user_id: 1,
          saved_at: 0,
        })),
      });
    }
    if (url.includes("/api/couples/current")) {
      return jsonResponse(200, {
        couple: {
          id: coupleId,
          wedding_date: null,
          currency: "EUR",
          // Not decoration: the compose dialog mail-merges the headcount into
          // the template body, so a couple stub without this field crashes the
          // modal the Send inquiry button opens.
          guest_count_goal: { kind: "range", exact: null, min: 85, max: 105 },
        },
      });
    }
    if (url.includes("/reviews")) {
      return jsonResponse(200, {
        items: [],
        can_review: false,
        already_reviewed: false,
        nextCursor: null,
      });
    }
    if (url.includes("/comments")) return jsonResponse(200, { items: [], nextCursor: null });
    if (url.includes("/availability")) return jsonResponse(200, availability);
    if (url.includes(`/api/suppliers/${SUPPLIER_ID}`)) return jsonResponse(200, detail);
    return jsonResponse(200, {});
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

/** The lucide glyph inside a control, as its class string (`lucide-heart`,
 *  `lucide-bookmark-check`, …). That name IS the vocabulary under test. */
function glyphOf(testId: string): string {
  const svg = screen.getByTestId(testId).querySelector("svg");
  return svg?.getAttribute("class") ?? "";
}

function classesOf(testId: string): string {
  return screen.getByTestId(testId).getAttribute("class") ?? "";
}

beforeEach(() => {
  calls.length = 0;
  coupleId = ++coupleIdSeq;
  picks = {};
  saved = [];
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* happy-dom without storage, ignore */
  }
  detail = {
    id: SUPPLIER_ID,
    name: "Magyar Fotó",
    category: CATEGORY,
    city: "Budapest",
    country: "HU",
    currency: "HUF",
    blurb_hu: "",
    blurb_en: "Documentary wedding photography.",
    website: "https://magyarfoto.example",
    contact_email: null,
    contact_phone: null,
    address: null,
    capacity_min: null,
    capacity_max: null,
    venue_style: null,
    lat: null,
    lng: null,
    source: "claimed",
    submitter_type: "self",
    price_band: 3,
    vendor_account_id: 7,
    hero_image_url: null,
    gallery_urls: [],
    has_contact_email: true,
    has_contact_phone: false,
    votes_score: 0,
    user_vote: 0,
    reviews_count: 0,
    listing_complete: true,
    bookable: true,
    videos: [],
    packages: [],
    reviews_summary: {
      avg_rating: null,
      reviews_count: 0,
      histogram: [0, 0, 0, 0, 0],
      top_tags: [],
    },
  };
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

describe("SupplierDetailPage: save is a blush heart", () => {
  it("renders the shortlist control as a Heart in the blush family, never the picked sage bookmark", async () => {
    await renderPage();

    expect(glyphOf("supplier-save-toggle")).toContain("lucide-heart");
    // The regression: the save button used to wear the PICKED treatment.
    const cls = classesOf("supplier-save-toggle");
    expect(cls).toContain("blush");
    expect(cls).not.toContain("sage");
    expect(glyphOf("supplier-save-toggle")).not.toContain("bookmark");
    // Mobile sticky bar says the same thing.
    expect(glyphOf("supplier-save-toggle-mobile")).toContain("lucide-heart");
    expect(classesOf("supplier-save-toggle-mobile")).not.toContain("sage");
  });

  it("saving fills the heart in blush and writes to the shortlist endpoint", async () => {
    await renderPage();

    expect(glyphOf("supplier-save-toggle")).not.toContain("fill-blush-500");
    expect(screen.getByTestId("supplier-save-toggle")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("supplier-save-toggle"));
    await flush();

    expect(
      calls.some(
        (c) => c.method === "PUT" && c.url.includes(`/api/saved-suppliers/${SUPPLIER_ID}`),
      ),
    ).toBe(true);
    // It must NOT have touched the pick: hearting is not committing.
    expect(calls.some((c) => c.url.includes("/api/picks/"))).toBe(false);

    await waitFor(() => expect(glyphOf("supplier-save-toggle")).toContain("fill-blush-500"));
    expect(classesOf("supplier-save-toggle")).toContain("bg-blush-50");
    expect(classesOf("supplier-save-toggle")).not.toContain("sage");
    expect(screen.getByTestId("supplier-save-toggle")).toHaveAttribute("aria-pressed", "true");
    // The mobile twin follows the same state off the same store.
    expect(glyphOf("supplier-save-toggle-mobile")).toContain("fill-blush-500");
  });
});

describe("SupplierDetailPage: pick is a sage bookmark", () => {
  it("renders a pick control at all, as a Bookmark in the sage family", async () => {
    await renderPage();

    const pick = screen.getByTestId("supplier-pick-toggle");
    expect(pick).toBeInTheDocument();
    expect(glyphOf("supplier-pick-toggle")).toContain("lucide-bookmark");
    const cls = classesOf("supplier-pick-toggle");
    expect(cls).toContain("sage");
    expect(cls).not.toContain("blush");
    expect(pick).toHaveAttribute("aria-pressed", "false");
    // And on the mobile bar, where the page's only persistent CTA row lives.
    expect(glyphOf("supplier-pick-toggle-mobile")).toContain("lucide-bookmark");
  });

  it("picking writes the ONE-per-category pick and flips to the sage BookmarkCheck", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("supplier-pick-toggle"));
    await flush();

    // The same endpoint the grid writes, `PUT /api/picks/:category`, keyed on
    // the category, which is what makes it one pick per category.
    expect(calls.some((c) => c.method === "PUT" && c.url.includes(`/api/picks/${CATEGORY}`))).toBe(
      true,
    );
    expect(picks[CATEGORY]).toBe(SUPPLIER_ID);
    // Picking is not saving: the shortlist was left alone.
    expect(calls.some((c) => c.url.includes("/api/saved-suppliers/"))).toBe(false);

    await waitFor(() => expect(glyphOf("supplier-pick-toggle")).toContain("lucide-bookmark-check"));
    expect(glyphOf("supplier-pick-toggle")).toContain("fill-sage-200");
    expect(classesOf("supplier-pick-toggle")).toContain("bg-sage-50");
    expect(screen.getByTestId("supplier-pick-toggle")).toHaveAttribute("aria-pressed", "true");
    expect(glyphOf("supplier-pick-toggle-mobile")).toContain("lucide-bookmark-check");
  });

  it("takes the category over from whoever held it, and un-picking clears it", async () => {
    // Another supplier is this category's pick when the page opens.
    picks[CATEGORY] = "aranybastya";
    await renderPage();

    expect(screen.getByTestId("supplier-pick-toggle")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("supplier-pick-toggle"));
    await flush();
    // One row per category, so the write REPLACES rather than adding a second.
    expect(picks[CATEGORY]).toBe(SUPPLIER_ID);
    await waitFor(() => expect(glyphOf("supplier-pick-toggle")).toContain("lucide-bookmark-check"));

    fireEvent.click(screen.getByTestId("supplier-pick-toggle"));
    await flush();
    expect(
      calls.some((c) => c.method === "DELETE" && c.url.includes(`/api/picks/${CATEGORY}`)),
    ).toBe(true);
    expect(picks[CATEGORY]).toBeUndefined();
    await waitFor(() =>
      expect(glyphOf("supplier-pick-toggle")).not.toContain("lucide-bookmark-check"),
    );
  });

  it("the two controls are independent: one supplier can be both saved and picked", async () => {
    await renderPage();

    fireEvent.click(screen.getByTestId("supplier-save-toggle"));
    fireEvent.click(screen.getByTestId("supplier-pick-toggle"));
    await flush();

    await waitFor(() => {
      expect(glyphOf("supplier-save-toggle")).toContain("fill-blush-500");
      expect(glyphOf("supplier-pick-toggle")).toContain("lucide-bookmark-check");
    });
    expect(saved).toContain(SUPPLIER_ID);
    expect(picks[CATEGORY]).toBe(SUPPLIER_ID);
  });
});

// The page's PRIMARY action, and the one the two above are secondary to.
//
// `contact_email` is null on this fixture because it is null on the real
// payload: a vendor's mailbox is never handed to a user (owner rule,
// 2026-07-31). The page nonetheless gated Send inquiry on the truthiness of
// that value, so from the day the address was withdrawn the CTA was disabled on
// every listing in the directory, on desktop and in the mobile sticky bar, and
// Messages ▸ Outreach was the only surviving way to write to a vendor. Nothing
// errored: the button simply stopped answering.
describe("SupplierDetailPage: send inquiry is offered whenever the channel is deliverable", () => {
  beforeEach(() => {
    coupleId = ++coupleIdSeq;
    installFetch();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function inquiryButtons(): HTMLButtonElement[] {
    return screen.getAllByRole("button", { name: /send inquiry/i }) as HTMLButtonElement[];
  }

  it("is enabled on has_contact_email, which is all the payload ever says", async () => {
    await renderPage();
    const buttons = inquiryButtons();
    // Desktop row + mobile sticky bar. Both render always; CSS picks.
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.disabled).toBe(false);
  });

  it("opens the composer rather than doing nothing", async () => {
    await renderPage();
    fireEvent.click(inquiryButtons()[0] as HTMLButtonElement);
    await flush();
    // The composer's own fields are the proof it mounted; a dead button leaves
    // the page exactly as it was. (The dialog TITLE is also "Send inquiry", so
    // matching on that text would match the buttons too.)
    await waitFor(() => {
      expect(document.getElementById("outreach-subject")).toBeTruthy();
      expect(document.getElementById("outreach-body")).toBeTruthy();
    });
  });

  it("stays disabled when there is no mailbox to deliver to", async () => {
    detail = { ...detail, has_contact_email: false };
    await renderPage();
    for (const b of inquiryButtons()) expect(b.disabled).toBe(true);
  });
});

// The in-app URL used to sit on a bare `v{N}`/`c{N}` id forever — the public
// `/suppliers/:id` page and the Share button already upgrade to a name-based
// slug (`vendorPublicId`), but a couple who copied THIS page's own address
// bar, or opened it from an internal link that still pointed at the bare id,
// handed out an opaque link. The page now self-heals the address bar to the
// pretty id once the listing loads, the same slug Share already produces —
// and does it WITHOUT a second `/api/suppliers/:id` round trip, since the
// route param change is recognised as the same canonical listing already in
// state (`canonicalListingId`). That second point matters beyond performance:
// a naive re-fetch on the rewritten URL is a real regression trap; the
// page's own effect could easily race back to the bare id or crash the panel
// if the destination ever answered inconsistently.
describe("SupplierDetailPage: address bar personalizes to the vendor name", () => {
  const PRETTY_ID = `magyar-foto-${SUPPLIER_ID}`;

  function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-probe">{location.pathname}</div>;
  }

  async function renderWithLocationProbe() {
    render(
      <MemoryRouter initialEntries={[`/app/suppliers/${SUPPLIER_ID}`]}>
        <I18nProvider>
          <AuthProvider>
            <ToastProvider>
              <ConfirmDialogProvider>
                <LocationProbe />
                <Routes>
                  <Route path="/app/suppliers/:supplier_id" element={<SupplierDetailPage />} />
                </Routes>
              </ConfirmDialogProvider>
            </ToastProvider>
          </AuthProvider>
        </I18nProvider>
      </MemoryRouter>,
    );
    await flush();
  }

  it("replaces a bare v{N}/c{N} id with the pretty slug, and settles there with one fetch", async () => {
    installFetch();
    await renderWithLocationProbe();

    await waitFor(() =>
      expect(screen.getByTestId("location-probe").textContent).toBe(`/app/suppliers/${PRETTY_ID}`),
    );
    const detailCalls = calls.filter(
      (c) => c.method === "GET" && /\/api\/suppliers\/[^/?]+(?:\?|$)/.test(c.url),
    );
    expect(detailCalls).toHaveLength(1);

    // Settles: once the address bar carries the pretty id, re-rendering must
    // not trigger a further navigation (no redirect loop) or a second fetch.
    await flush(4);
    expect(screen.getByTestId("location-probe").textContent).toBe(`/app/suppliers/${PRETTY_ID}`);
    const detailCallsAfterSettle = calls.filter(
      (c) => c.method === "GET" && /\/api\/suppliers\/[^/?]+(?:\?|$)/.test(c.url),
    );
    expect(detailCallsAfterSettle).toHaveLength(1);
  });
});
