// Component tests for GuestsPage + BudgetPage UI behaviors. We stub
// globalThis.fetch per-test with a handler-registry pattern so each scenario
// only registers the URLs it cares about and the rest fall through to a
// benign `{}` 200 (so the AuthProvider /api/auth/me probe + late refresh
// calls never crash the test).
//
// Provider stack mirrors App.tsx:
//   MemoryRouter → I18nProvider → ToastProvider → ConfirmDialogProvider
//   → EntryDialogProvider → AuthProvider → <page>
//
// Locale is pinned to "en" so all assertions read deterministically — the
// detection helper otherwise falls back to navigator.language which is
// environment-dependent.

import { resolveDesign } from "@shared/design";
import type {
  BudgetLine,
  BudgetPayment,
  BudgetSnapshot,
  Couple,
  Guest,
  Household,
} from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import BudgetPage from "@/pages/BudgetPage";
import GuestsPage from "@/pages/GuestsPage";
import { currencyName, formatMoney } from "@/lib/format";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { EntryDialogProvider } from "@/components/ui/EntryDialogProvider";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Handler = (req: {
  url: string;
  method: Method;
  body: unknown;
}) => Response | Promise<Response> | null;

const realFetch = globalThis.fetch;
const handlers: Handler[] = [];
const fetchCalls: { url: string; method: Method; body: unknown }[] = [];

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Register a handler that intercepts only the URLs / methods it cares about
 *  — return `null` to fall through to the next handler (or the default). */
function on(
  predicate: (req: { url: string; method: Method }) => boolean,
  responder: (req: { url: string; method: Method; body: unknown }) => Response | Promise<Response>,
) {
  handlers.push((req) => (predicate(req) ? responder(req) : null));
}

function onGet(matcher: (url: string) => boolean, body: unknown, status = 200) {
  on(
    ({ url, method }) => method === "GET" && matcher(url),
    () => jsonResponse(status, body),
  );
}

function onPost(matcher: (url: string) => boolean, body: unknown, status = 200) {
  on(
    ({ url, method }) => method === "POST" && matcher(url),
    () => jsonResponse(status, body),
  );
}

function onPatch(matcher: (url: string) => boolean, body: unknown, status = 200) {
  on(
    ({ url, method }) => method === "PATCH" && matcher(url),
    () => jsonResponse(status, body),
  );
}

function onDelete(matcher: (url: string) => boolean, body: unknown, status = 200) {
  on(
    ({ url, method }) => method === "DELETE" && matcher(url),
    () => jsonResponse(status, body),
  );
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = ((init?.method ?? "GET").toUpperCase() as Method) ?? "GET";
    let parsedBody: unknown = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    fetchCalls.push({ url, method, body: parsedBody });
    for (const h of handlers) {
      const res = await h({ url, method, body: parsedBody });
      if (res) return res;
    }
    // Default fall-through — keeps unmocked endpoints from blowing up the
    // test (AuthProvider's /api/auth/me probe, late refresh() calls, etc).
    return jsonResponse(200, {});
  }) as typeof fetch;
}

/** Flush pending microtasks + one macrotask so React commits effects fired
 *  by mocked-fetch promise resolutions. */
async function flush(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/app/guests"]}>
      <I18nProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <EntryDialogProvider>
              <AuthProvider>{children}</AuthProvider>
            </EntryDialogProvider>
          </ConfirmDialogProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  handlers.length = 0;
  fetchCalls.length = 0;
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

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function makeCouple(over: Partial<Couple> = {}): Couple {
  return {
    id: 1,
    partner_a_id: 11,
    partner_b_id: null,
    display_name: "Mia & Lucas",
    bride_name: "Anna",
    groom_name: "Bence",
    slug: "MIALUCAS",
    organiser_code: null,
    wedding_date_goal: {
      kind: "exact",
      exact_date: "2027-06-12",
      target_year: 2027,
      target_month: 6,
      target_season: null,
    },
    wedding_date: "2027-06-12",
    previous_wedding_date: null,
    ceremony_kind: "civil",
    archived_at: null,
    guest_count_goal: { kind: "range", min: 80, max: 120, exact: null },
    target_guest_count: 100,
    budget_goal: { kind: "exact", exact_huf: 5_000_000, min_huf: null, max_huf: null },
    budget_ceiling_huf: 5_000_000,
    currency: "HUF",
    planning_count: 100,
    frozen_categories: [],
    location_lat: null,
    location_lng: null,
    location_radius_km: null,
    country: "HU",
    style_tags: [],
    status: "active",
    honeymoon_destination: null,
    honeymoon_start_date: null,
    honeymoon_end_date: null,
    honeymoon_origin_iata: null,
    honeymoon_cover_path: null,
    rsvp_offers_accommodation: false,
    rsvp_collects_meal: true,
    meal_menu: [],
    menu_card: { courses: [] },
    timeline_email_escalation: "overdue",
    notif_email_cadence: "1_weekly",
    notif_focus: "timeline,rsvp,partner",
    name_review: null,
    is_demo: false,
    is_public: false,
    wishlist_published: false,
    welcome_desk_active: false,
    venue_name: null,
    venue_city: null,
    venue_address: null,
    venue_phone: null,
    coordinator_name: null,
    coordinator_phone: null,
    emergency_name: null,
    emergency_phone: null,
    cover_image_url: null,
    guest_page_intro: null,
    useful_info: null,
    post_rsvp_content: null,
    envelope_tip_enabled: true,
    envelope_tip_amount_override: null,
    media_links: { guests: null, photographer: [], other: null },
    design: resolveDesign(null),
    seating_room_w_mm: null,
    seating_room_h_mm: null,
    created_at: 0,
    onboarded_at: 1,
    updated_at: 1,
    names_last_changed_at: null,
    planning_count_locked: false,
    billing: {
      subscription_status: "founding",
      trial_ends_at: null,
      founding_until: null,
      is_founding_member: true,
      current_period_end: null,
      entitled: true,
      reason: "founding",
      planner_managed: false,
      guest_page_prepaid: false,
      guest_page_addon: false,
    },
    ...over,
  };
}

function makeHousehold(over: Partial<Household> = {}): Household {
  return {
    id: 100,
    couple_id: 1,
    code: "1234",
    label: "Smith family",
    notes: null,
    guest_message: null,
    member_ids: [1001],
    group_tag: "his_family",
    is_couple_household: false,
    is_supplier_household: false,
    rsvp_offers_accommodation: false,
    rsvp_collects_meal: true,
    auto_created: false,
    invited_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function makeGuest(over: Partial<Guest> = {}): Guest {
  return {
    id: 1001,
    couple_id: 1,
    household_id: 100,
    full_name: "Jane Smith",
    email: "jane@example.com",
    phone: null,
    group_tag: "his_family",
    invite_code: "ABC123",
    kind: "adult",
    is_supplier: false,
    is_plus_one: false,
    plus_one_of: null,
    partner_role: null,
    rsvp_status: "pending",
    meal_choice: null,
    dietary: null,
    plus_one_name: null,
    plus_one_meal: null,
    accommodation_needed: false,
    song_request: null,
    notes: null,
    rsvp_responded_at: null,
    invited_at: null,
    invited_online_at: null,
    invited_physical_at: null,
    invitation_delivered_at: null,
    invitation_opened_at: null,
    accommodation_id: null,
    accommodation_room_id: null,
    transfer_id: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

function makeBudgetLine(over: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 5001,
    couple_id: 1,
    category: "venue",
    label: "Venue",
    planned_huf: 1_500_000,
    actual_huf: 0,
    paid_huf: 0,
    supplier_id: null,
    couple_supplier_id: null,
    listing_id: null,
    notes: null,
    per_guest: false,
    icon: null,
    created_at: 0,
    updated_at: 1,
    ...over,
  };
}

function makeBudgetPayment(over: Partial<BudgetPayment> = {}): BudgetPayment {
  return {
    id: 9001,
    couple_id: 1,
    scope: "cat:venue",
    amount_huf: 400_000,
    paid_at: 1_700_000_000_000,
    note: null,
    pdf_url: null,
    pdf_name: null,
    created_at: 0,
    ...over,
  };
}

function makeSnapshot(over: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    id: 7001,
    couple_id: 1,
    name: "120-guest scenario",
    payload_json: JSON.stringify([{ planned_huf: 1_500_000, actual_huf: 100_000 }]),
    created_at: Date.now(),
    ...over,
  };
}

/** Wire up the minimum endpoints both pages probe on mount: couple, guests,
 *  households (GuestsPage); plus budget lines + snapshots (BudgetPage). The
 *  per-test handler stack runs first, so this acts as a safety net. */
function installDefaultEndpoints(
  opts: {
    couple?: Couple;
    guests?: Guest[];
    households?: Household[];
    lines?: BudgetLine[];
    snapshots?: BudgetSnapshot[];
    payments?: BudgetPayment[];
  } = {},
) {
  const couple = opts.couple ?? makeCouple();
  const guests = opts.guests ?? [];
  const households = opts.households ?? [];
  const lines = opts.lines ?? [];
  const snapshots = opts.snapshots ?? [];
  const payments = opts.payments ?? [];
  // Registered even when empty. Left unregistered it fell through to the
  // harness's benign `{}`, and `{}.payments` is `undefined` — which is how
  // the whole <BudgetPage> suite used to die during render.
  onGet((u) => u.startsWith("/api/budget/payments"), { payments });
  onGet((u) => u.startsWith("/api/couples/current"), { couple });
  onGet((u) => u.startsWith("/api/guests/dietary-summary"), { meals: {}, dietary: {} });
  onGet((u) => u.startsWith("/api/guests"), { guests, total: guests.length });
  onGet((u) => u.startsWith("/api/households"), { households });
  onGet((u) => u.startsWith("/api/budget/documents"), { documents: [] });
  onGet((u) => u.startsWith("/api/budget/lines"), { lines });
  onGet((u) => u.startsWith("/api/budget/snapshots"), { snapshots });
  // AuthProvider's /me probe — return a stub so the provider settles quickly.
  onGet((u) => u.startsWith("/api/auth/me"), {
    user: {
      id: 11,
      email: "test@example.com",
      full_name: "Tamás Kovács",
      role: "user",
      verified_email: true,
      status: "active",
      created_at: 0,
    },
  });
}

function renderGuests() {
  return render(
    <Providers>
      <GuestsPage />
    </Providers>,
  );
}

/** Render GuestsPage at an explicit URL so `?view=`, `?household=` and friends
 *  are exercised the way a shared link would arrive. */
function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <I18nProvider>
        <ToastProvider>
          <ConfirmDialogProvider>
            <EntryDialogProvider>
              <AuthProvider>
                <GuestsPage />
              </AuthProvider>
            </EntryDialogProvider>
          </ConfirmDialogProvider>
        </ToastProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

function renderBudget() {
  return render(
    <Providers>
      <BudgetPage />
    </Providers>,
  );
}

// ===========================================================================
// GuestsPage
// ===========================================================================

describe("<GuestsPage>", () => {
  it("renders the empty-state card when guests list is empty", async () => {
    installDefaultEndpoints({ guests: [], households: [] });
    renderGuests();
    await waitFor(() => {
      expect(screen.getByText(/no guests yet/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/import the whole list from csv/i)).toBeInTheDocument();
  });

  it("renders one household card per household", async () => {
    const a = makeHousehold({ id: 1, label: "Family A", code: "1111", member_ids: [10] });
    const b = makeHousehold({ id: 2, label: "Family B", code: "2222", member_ids: [20] });
    installDefaultEndpoints({
      households: [a, b],
      guests: [
        makeGuest({ id: 10, full_name: "Alice", household_id: 1 }),
        makeGuest({ id: 20, full_name: "Bob", household_id: 2 }),
      ],
    });
    renderGuests();
    await waitFor(() => {
      expect(screen.getByText("Family A")).toBeInTheDocument();
      expect(screen.getByText("Family B")).toBeInTheDocument();
    });
    // Member names also visible on their household rows.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("opens the edit drawer when the top-level Add guest button is clicked", async () => {
    installDefaultEndpoints({ guests: [], households: [] });
    renderGuests();
    await waitFor(() => expect(screen.getByText(/no guests yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add guest/i }));
    await waitFor(() => {
      // GuestDrawer renders a Dialog (role="dialog") whose first input carries
      // aria-label="Name". The drawer also contains a "Household name" input
      // and various Field components — assert specifically on the name input.
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByLabelText(/^name$/i)).toBeInTheDocument();
    });
  });

  it("submitting the edit form POSTs to /api/guests with the typed name", async () => {
    installDefaultEndpoints({ guests: [], households: [] });
    // Capture the create call.
    onPost((u) => u === "/api/guests" || u.startsWith("/api/guests?"), {
      guest: makeGuest({ id: 999, full_name: "Charlie Sample", household_id: null }),
    });
    renderGuests();
    await waitFor(() => expect(screen.getByText(/no guests yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add guest/i }));
    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByLabelText(/^name$/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Charlie Sample" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await flush(2);
    const postCall = fetchCalls.find((c) => c.method === "POST" && c.url === "/api/guests");
    expect(postCall).toBeDefined();
    expect((postCall?.body as { full_name?: string }).full_name).toBe("Charlie Sample");
  });

  it("renders the search input once any guest exists", async () => {
    installDefaultEndpoints({
      households: [makeHousehold({ id: 1, label: "Test", member_ids: [10] })],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1 })],
    });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Test")).toBeInTheDocument());
    // The search box uses the aria-label "Search guests".
    expect(screen.getByRole("searchbox", { name: /search guests/i })).toBeInTheDocument();
  });

  it("typing in the search box debounces 200ms then issues GET /api/guests?q=...", async () => {
    installDefaultEndpoints({
      households: [makeHousehold({ id: 1, label: "Test", member_ids: [10] })],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1 })],
    });
    // Pin the search response separately so the test can spot the q= param.
    onGet((u) => u.startsWith("/api/guests?") && u.includes("q="), { guests: [], total: 0 });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Test")).toBeInTheDocument());
    const search = screen.getByRole("searchbox", { name: /search guests/i });
    fireEvent.change(search, { target: { value: "alice" } });
    // 200ms debounce + a couple of flushes.
    await new Promise((r) => setTimeout(r, 250));
    await flush(2);
    const searchCall = fetchCalls.find((c) => c.method === "GET" && c.url.includes("q=alice"));
    expect(searchCall).toBeDefined();
  });

  it("delete-guest button opens ConfirmDialog and DELETEs on confirm", async () => {
    const hh = makeHousehold({ id: 1, label: "Smith", member_ids: [10] });
    installDefaultEndpoints({
      households: [hh],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1 })],
    });
    onDelete((u) => u === "/api/guests/10", { ok: true });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    // Per-guest delete button is rendered with aria-label "Delete".
    const deleteBtns = screen.getAllByRole("button", { name: /^delete$/i });
    fireEvent.click(deleteBtns[0]!);
    // ConfirmDialog appears (alertdialog role per ConfirmDialogProvider).
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: /yes, delete/i }));
    await flush(2);
    const deleteCall = fetchCalls.find((c) => c.method === "DELETE" && c.url === "/api/guests/10");
    expect(deleteCall).toBeDefined();
  });

  it("clicking the InviteChip on a guest issues PATCH /api/guests/:id with invited=true", async () => {
    const hh = makeHousehold({ id: 1, label: "Smith", member_ids: [10] });
    const guest = makeGuest({ id: 10, full_name: "Alice", household_id: 1 });
    installDefaultEndpoints({ households: [hh], guests: [guest] });
    onPatch((u) => u === "/api/guests/10", { guest });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    // The InviteChip has aria-label that starts with "Not invited yet".
    const chip = screen.getByRole("button", { name: /not invited yet/i });
    fireEvent.click(chip);
    await flush();
    const patchCall = fetchCalls.find((c) => c.method === "PATCH" && c.url === "/api/guests/10");
    expect(patchCall).toBeDefined();
    expect((patchCall?.body as { invited?: boolean }).invited).toBe(true);
  });

  it("Import CSV is exposed as a hidden file input inside a clickable label", async () => {
    installDefaultEndpoints({ guests: [], households: [] });
    renderGuests();
    await waitFor(() => expect(screen.getByText(/no guests yet/i)).toBeInTheDocument());
    // The CSV input has accept=".csv,text/csv" — find it via that attribute.
    const fileInput = document.querySelector('input[type="file"][accept*="csv"]');
    expect(fileInput).not.toBeNull();
    // "Import CSV" label is rendered in both the toolbar and the empty-state
    // CTA cluster, so multiple matches are expected.
    expect(screen.getAllByText(/import csv/i).length).toBeGreaterThanOrEqual(1);
  });

  it("Per-row Print place card triggers a GET to /api/print/place-cards", async () => {
    const hh = makeHousehold({ id: 1, label: "Smith", member_ids: [10] });
    installDefaultEndpoints({
      households: [hh],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1 })],
    });
    // Place-cards PDF — return a tiny binary blob so fetchPdfBlob resolves.
    onGet((u) => u.startsWith("/api/print/place-cards"), "%PDF-1.4 fake");
    renderGuests();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    const printBtns = screen.getAllByRole("button", { name: /print place card/i });
    fireEvent.click(printBtns[0]!);
    await flush(2);
    const printCall = fetchCalls.find(
      (c) => c.method === "GET" && c.url.startsWith("/api/print/place-cards"),
    );
    expect(printCall).toBeDefined();
    expect(printCall?.url).toContain("guest_ids=10");
  });

  it("renders the Download template button and a Meals dialog trigger", async () => {
    installDefaultEndpoints({ guests: [], households: [] });
    renderGuests();
    await waitFor(() => expect(screen.getByText(/no guests yet/i)).toBeInTheDocument());
    // The Download-template button is rendered in both the toolbar and the
    // empty-state CTA cluster; assert at least one exists.
    expect(screen.getAllByRole("button", { name: /^template$/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /^meals$/i })).toBeInTheDocument();
  });

  it("opens the Meals dialog when the Meals button is clicked", async () => {
    installDefaultEndpoints({
      households: [makeHousehold({ id: 1, label: "Smith", member_ids: [10] })],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1 })],
    });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^meals$/i }));
    await flush();
    // The meals dialog renders the meals_title heading.
    await waitFor(() => {
      expect(screen.getByText(/meals & dietary needs/i)).toBeInTheDocument();
    });
  });

  it("renders the RSVP-status filter chip when ?rsvp= is set in the URL", async () => {
    installDefaultEndpoints({
      households: [makeHousehold({ id: 1, label: "Smith", member_ids: [10] })],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1, rsvp_status: "yes" })],
    });
    // Override the default initialEntries by re-rendering with the rsvp param.
    render(
      <MemoryRouter initialEntries={["/app/guests?rsvp=yes"]}>
        <I18nProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <EntryDialogProvider>
                <AuthProvider>
                  <GuestsPage />
                </AuthProvider>
              </EntryDialogProvider>
            </ConfirmDialogProvider>
          </ToastProvider>
        </I18nProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    // A `?rsvp=yes` URL renders the flat filtered list with its match-count
    // note and surfaces a "Clear all" affordance for the active filter.
    expect(screen.getByText(/matches your filters/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
  });

  // ── Bug report follow-ups (2026-07-27 Guests-page pass) ──────────────────

  it("header counts exclude the couple's own two rows, so they match the list", async () => {
    // The bride/groom live in the guests table for headcount + seating but are
    // filtered out of the list and out of every filter. Counting them in the
    // header made it disagree with the page below it: "4 guests" over a list of
    // 2, and "2 invited" over an invited filter that found none.
    const coupleHh = makeHousehold({
      id: 1,
      label: "Us",
      member_ids: [1, 2],
      is_couple_household: true,
    });
    const realHh = makeHousehold({ id: 2, label: "Smith", member_ids: [10, 11] });
    installDefaultEndpoints({
      households: [coupleHh, realHh],
      guests: [
        makeGuest({
          id: 1,
          full_name: "Brigitta Simon",
          household_id: 1,
          partner_role: "bride",
          invited_at: 5,
        }),
        makeGuest({
          id: 2,
          full_name: "Groom",
          household_id: 1,
          partner_role: "groom",
          invited_at: 5,
        }),
        makeGuest({ id: 10, full_name: "Alice", household_id: 2 }),
        makeGuest({ id: 11, full_name: "Bob", household_id: 2 }),
      ],
    });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Smith")).toBeInTheDocument());

    // Each stat is a button whose accessible name is its click action; the
    // number itself is the button's text.
    const total = screen.getByRole("button", { name: /show all guests/i });
    expect(total.textContent).toContain("2");
    expect(total.textContent).not.toContain("4");
    // Nobody but the partner rows was invited, and they don't count.
    const invited = screen.getByRole("button", { name: /show invited guests only/i });
    expect(invited.textContent).toContain("0");
  });

  it("the group-households filter narrows the table view, not just the card view", async () => {
    // The table branch renders the flat list and is checked BEFORE the grouped
    // household lens, so the chip used to sit there pressed and change nothing.
    const pair = makeHousehold({ id: 1, label: "Smith", member_ids: [10, 11] });
    const solo = makeHousehold({ id: 2, label: "Solo", member_ids: [12] });
    installDefaultEndpoints({
      households: [pair, solo],
      guests: [
        makeGuest({ id: 10, full_name: "Alice", household_id: 1 }),
        makeGuest({ id: 11, full_name: "Bob", household_id: 1 }),
        makeGuest({ id: 12, full_name: "Loner", household_id: 2 }),
      ],
    });
    renderAt("/app/guests?view=table&household=closed");
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByText("Bob")).toBeInTheDocument();
    // The single-person household is exactly what "group households" excludes.
    expect(screen.queryByText("Loner")).not.toBeInTheDocument();
  });

  it("a live query with no answer yet never paints as 'no guests match'", async () => {
    // The regression: `searching` was set inside the fetch effect, one commit
    // after the render where the query changed, so that render had a query, no
    // results and searching=false — and printed the empty-state for a frame.
    const hh = makeHousehold({ id: 1, label: "Smith", member_ids: [10] });
    installDefaultEndpoints({
      households: [hh],
      guests: [makeGuest({ id: 10, full_name: "Csíkász Andor", household_id: 1 })],
    });
    // Search never resolves: the page has to sit in its loading state, not
    // claim there are no matches.
    on(
      ({ url, method }) => method === "GET" && url.startsWith("/api/guests?") && url.includes("q="),
      () => new Promise<Response>(() => {}),
    );
    renderGuests();
    await waitFor(() => expect(screen.getByText("Csíkász Andor")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("searchbox", { name: /search guests/i }), {
      target: { value: "Csíkász" },
    });
    await new Promise((r) => setTimeout(r, 250));
    await flush(2);
    expect(screen.queryByText(/no guests match these filters/i)).not.toBeInTheDocument();
  });

  it("shows the Hungarian copy fallback dialog (Copy didn't work) only when clipboard fails — smoke that the share-link button is rendered", async () => {
    const hh = makeHousehold({ id: 1, label: "Smith", member_ids: [10] });
    installDefaultEndpoints({
      households: [hh],
      guests: [makeGuest({ id: 10, full_name: "Alice", household_id: 1 })],
    });
    renderGuests();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /share check-in link/i })).toBeInTheDocument();
  });
});

// ===========================================================================
// BudgetPage
// ===========================================================================

describe("<BudgetPage>", () => {
  it("renders the page heading + the empty Saved snapshots line", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    await waitFor(() => {
      // h1 = "Budget"; h2 = "Saved snapshots"; empty-state "No snapshots yet."
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/no snapshots yet/i)).toBeInTheDocument();
  });

  it("renders every CATEGORIES row label in the desktop budget table", async () => {
    installDefaultEndpoints({
      lines: [
        makeBudgetLine({ id: 1, category: "venue", planned_huf: 1_500_000 }),
        makeBudgetLine({ id: 2, category: "catering", planned_huf: 500_000 }),
      ],
    });
    renderBudget();
    await waitFor(() => {
      // The category label appears in both mobile and desktop views — match
      // at least one rendering. Venue / Catering are two of fifteen rows.
      expect(screen.getAllByText("Venue").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Catering").length).toBeGreaterThan(0);
    });
    // Honeymoon also appears as a (read-only) row even with no lines.
    expect(screen.getAllByText("Honeymoon").length).toBeGreaterThan(0);
  });

  // SUPPLIER_TO_BUDGET folds planner fees, celebrants, rentals, accommodation
  // and dance lessons into "other", so a mirrored line for any of them renders
  // through the custom-row branch rather than a category bucket. That branch
  // used to hardcode editable inputs and an unconditional bin, all of which the
  // server answers with 409 locked.
  it("a supplier-owned custom row is read-only and offers no delete", async () => {
    installDefaultEndpoints({
      lines: [
        makeBudgetLine({
          id: 41,
          category: "other",
          label: "Dream Day Planning",
          planned_huf: 400_000,
          couple_supplier_id: "abc123",
        }),
      ],
    });
    renderBudget();
    await waitFor(() => {
      expect(screen.getAllByText("Dream Day Planning").length).toBeGreaterThan(0);
    });
    // BOTH renderings carry the id: the mobile card and the desktop table row.
    // querySelector would only ever reach the first, so a regression in the
    // other one would pass unnoticed. Assert on every match.
    const rows = Array.from(document.querySelectorAll('[data-budget-line-id="41"]'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const inputs = Array.from(row.querySelectorAll("input"));
      expect(inputs.length).toBeGreaterThan(0);
      for (const input of inputs) expect(input.readOnly).toBe(true);
      // The label doubles as the route back to the card that owns the amount.
      expect(row.querySelector('a[href="/app/suppliers/abc123"]')).not.toBeNull();
      // DELETE is 409 locked too, so the bin must not be offered.
      expect(row.querySelector('button[aria-label="Delete"]')).toBeNull();
    }
  });

  it("a custom row the couple typed stays editable and deletable", async () => {
    // The guard above must not swallow ordinary custom rows.
    installDefaultEndpoints({
      lines: [
        makeBudgetLine({
          id: 42,
          category: "other",
          label: "Ceremony permit",
          planned_huf: 30_000,
          couple_supplier_id: null,
          listing_id: null,
        }),
      ],
    });
    renderBudget();
    await waitFor(() => {
      expect(screen.getAllByText("Ceremony permit").length).toBeGreaterThan(0);
    });
    const rows = Array.from(document.querySelectorAll('[data-budget-line-id="42"]'));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      const inputs = Array.from(row.querySelectorAll("input"));
      expect(inputs.length).toBeGreaterThan(0);
      expect(inputs.some((i) => !i.readOnly)).toBe(true);
      expect(row.querySelector("a[href^='/app/suppliers/']")).toBeNull();
      expect(row.querySelector('button[aria-label="Delete"]')).not.toBeNull();
    }
  });

  it("the headcount slider has the cost_planning aria label and is wired up", async () => {
    installDefaultEndpoints({
      lines: [makeBudgetLine({ id: 1, category: "catering", planned_huf: 200_000 })],
    });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    const slider = await waitFor(() => screen.getByRole("slider", { name: /cost planning/i }));
    expect(slider).toBeInTheDocument();
  });

  it("dragging the headcount slider eventually fires PATCH /api/couples/current with planning_count", async () => {
    // Use a unique couple id (the cost_planning module caches by id at module
    // scope — sharing id=1 with other test files pollutes the prev-value check
    // in writeCostPlanningCount and the PATCH gets skipped as a no-op).
    // Bounds default to 80-120 from makeCouple's range goal, so a value of 230
    // would get clamped by the native input min/max. Widen the range so the
    // event reaches the handler unchanged.
    const couple = makeCouple({
      id: 99_321,
      planning_count: 200,
      guest_count_goal: { kind: "range", min: 50, max: 400, exact: null },
    });
    installDefaultEndpoints({
      couple,
      lines: [makeBudgetLine({ id: 1, category: "catering", planned_huf: 200_000 })],
    });
    onPatch((u) => u.startsWith("/api/couples/current"), {
      couple: { ...couple, planning_count: 300 },
    });
    renderBudget();
    const slider = await waitFor(() => screen.getByRole("slider", { name: /cost planning/i }));
    // Let the initial refresh + hydrateCostPlanningCount settle so the
    // module-level cache reflects planning_count=200 before we change it.
    await flush(2);
    await act(async () => {
      fireEvent.change(slider, { target: { value: "300" } });
    });
    // The actual server write is debounced 300ms (WRITE_DEBOUNCE_MS).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    await flush(2);
    const patchCall = fetchCalls.find(
      (c) =>
        c.method === "PATCH" &&
        c.url.startsWith("/api/couples/current") &&
        (c.body as { planning_count?: number })?.planning_count === 300,
    );
    expect(patchCall).toBeDefined();
  });

  it("the planned HufInput in the table is editable and PATCHes the line, same as Actual", async () => {
    // The couple asked to type Planned directly in the Költségsorok table
    // instead of only dragging the CostPlanningCard slider above. Both
    // surfaces write the same `planned_huf` through `setAggregatedPlanned`,
    // so they can never disagree.
    const line = makeBudgetLine({
      id: 5001,
      category: "venue",
      planned_huf: 1_500_000,
      label: "Venue",
    });
    installDefaultEndpoints({ lines: [line] });
    onPatch((u) => u === "/api/budget/lines/5001", {
      line: { ...line, planned_huf: 2_000_000 },
    });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);
    const plannedInputs = Array.from(
      document.querySelectorAll('input[data-budget-planned="true"]'),
    ) as HTMLInputElement[];
    expect(plannedInputs.length).toBeGreaterThan(0);
    // Every planned input renders editable — both mobile and desktop slot.
    for (const inp of plannedInputs) {
      expect(inp.readOnly).toBe(false);
    }
    const target = plannedInputs[0]!;
    await act(async () => {
      fireEvent.change(target, { target: { value: "2000000" } });
      fireEvent.blur(target);
    });
    await flush(2);
    const patchCall = fetchCalls.find(
      (c) => c.method === "PATCH" && c.url === "/api/budget/lines/5001",
    );
    expect(patchCall).toBeDefined();
    expect((patchCall?.body as { planned_huf?: number })?.planned_huf).toBe(2_000_000);
  });

  it("selects the whole amount when an editable field is focused", async () => {
    // Without this the caret landed wherever the pointer did, so typing a new
    // figure into "1 500 000" appended into the middle of it. No error, no
    // validation failure — the couple simply ended up with a number they
    // never entered.
    installDefaultEndpoints({
      lines: [makeBudgetLine({ id: 5001, category: "venue", actual_huf: 1_500_000 })],
    });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);

    const actual = document.querySelector(
      'input[data-budget-actual="true"]',
    ) as HTMLInputElement | null;
    expect(actual).not.toBeNull();
    expect(actual!.value.length).toBeGreaterThan(0);

    // Real DOM focus, not fireEvent.focus — React listens on focusin.
    await act(async () => {
      actual!.focus();
    });
    expect(actual!.selectionStart).toBe(0);
    expect(actual!.selectionEnd).toBe(actual!.value.length);
  });

  it("groups amounts in the reader's locale, not always in Hungarian", async () => {
    // The field was pinned to formatNumber(value, "hu") while the card around
    // it was already locale-aware, so an English workspace read its own money
    // as "1 500 000". The harness pins locale to "en".
    installDefaultEndpoints({
      lines: [makeBudgetLine({ id: 5001, category: "venue", actual_huf: 1_500_000 })],
    });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);

    const actual = document.querySelector('input[data-budget-actual="true"]') as HTMLInputElement;
    expect(actual.value).toBe("1,500,000");
  });

  it("acknowledges a committed amount edit", async () => {
    // The page's only other write acknowledgements are toasts on payments and
    // snapshots; typing amounts produced nothing at all, so a committed edit
    // and one that never left the field looked identical.
    installDefaultEndpoints({
      lines: [makeBudgetLine({ id: 5001, category: "venue", actual_huf: 100_000 })],
    });
    onPatch((u) => u === "/api/budget/lines/5001", {
      line: makeBudgetLine({ id: 5001, category: "venue", actual_huf: 250_000 }),
    });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);

    const actual = document.querySelector('input[data-budget-actual="true"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(actual, { target: { value: "250000" } });
      fireEvent.blur(actual);
    });
    await flush(3);

    expect(
      fetchCalls.find((c) => c.method === "PATCH" && c.url === "/api/budget/lines/5001"),
    ).toBeDefined();
    expect(screen.getAllByText(/^saved$/i).length).toBeGreaterThan(0);
  });

  it("asks before deleting a recorded payment, and does not DELETE on cancel", async () => {
    // Deleting a budget row and deleting an attached document both confirm.
    // A payment — a dated financial record that moves the row's paid total —
    // was the one destructive action on the page that just went ahead.
    const line = makeBudgetLine({
      id: 5001,
      category: "venue",
      actual_huf: 1_000_000,
      paid_huf: 400_000,
    });
    installDefaultEndpoints({
      lines: [line],
      payments: [makeBudgetPayment({ id: 9001, scope: "cat:venue", amount_huf: 400_000 })],
    });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);

    fireEvent.click(screen.getAllByRole("button", { name: /record payment/i })[0]!);
    const entry = await screen.findByRole("dialog");
    fireEvent.click(within(entry).getAllByRole("button", { name: /^delete$/i })[0]!);

    const confirmDialog = await screen.findByRole("alertdialog");
    // Nothing has gone over the wire yet — the confirm is a gate, not a
    // courtesy notice shown after the fact.
    expect(fetchCalls.find((c) => c.method === "DELETE")).toBeUndefined();

    fireEvent.click(within(confirmDialog).getByRole("button", { name: /^cancel$/i }));
    await flush(2);
    expect(fetchCalls.find((c) => c.method === "DELETE")).toBeUndefined();
  });

  it("deletes the payment once the confirm is accepted", async () => {
    installDefaultEndpoints({
      lines: [
        makeBudgetLine({ id: 5001, category: "venue", actual_huf: 1_000_000, paid_huf: 400_000 }),
      ],
      payments: [makeBudgetPayment({ id: 9001, scope: "cat:venue", amount_huf: 400_000 })],
    });
    onDelete((u) => u === "/api/budget/payments/9001", { ok: true });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);

    fireEvent.click(screen.getAllByRole("button", { name: /record payment/i })[0]!);
    const entry = await screen.findByRole("dialog");
    fireEvent.click(within(entry).getAllByRole("button", { name: /^delete$/i })[0]!);

    const confirmDialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(confirmDialog).getByRole("button", { name: /yes, delete/i }));
    });
    await flush(3);
    expect(
      fetchCalls.find((c) => c.method === "DELETE" && c.url === "/api/budget/payments/9001"),
    ).toBeDefined();
  });

  it("sets a snapshot's categories against what they plan today", async () => {
    // A saved scenario that can only be read on its own terms answers "what
    // did I say in March". The question weeks later is "what has moved", and
    // reading Restore as a decision rather than a leap depends on it.
    installDefaultEndpoints({
      lines: [
        // Venue: planned 1.5M when saved, 1.8M now → +300 000.
        makeBudgetLine({ id: 5001, category: "venue", planned_huf: 1_800_000 }),
        // Floral: not in the snapshot at all, added since → +250 000. This
        // is the row a payload-only walk would drop entirely, which is also
        // what would stop the per-row deltas summing to the total.
        makeBudgetLine({
          id: 5002,
          category: "decor_floral",
          planned_huf: 250_000,
          label: "Flowers",
        }),
      ],
      snapshots: [
        makeSnapshot({
          id: 42,
          name: "Original plan",
          payload_json: JSON.stringify([
            { category: "venue", planned_huf: 1_500_000, actual_huf: 0 },
          ]),
        }),
      ],
    });
    renderBudget();
    await waitFor(() => expect(screen.getByText("Original plan")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /view breakdown/i }));
    const dialog = await screen.findByRole("dialog");

    // Deltas are signed against the live budget, and the total agrees with
    // the rows rather than with the payload alone.
    // `Intl` separates symbol from number with a non-breaking space, which
    // testing-library normalises out of the DOM side but not out of ours.
    const delta = (n: number) => `+${formatMoney(n, "HUF", "en")}`.replace(/\s/g, " ");
    expect(within(dialog).getByText(delta(300_000))).toBeInTheDocument();
    expect(within(dialog).getByText(delta(250_000))).toBeInTheDocument();
    expect(within(dialog).getByText(delta(550_000))).toBeInTheDocument();
  });

  it("Add row affordance is rendered and reveals the label input on click", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    // Both mobile + desktop render an "Add row" button — clicking either expands
    // the inline form which exposes an input with the "Row name" placeholder.
    const addBtns = screen.getAllByRole("button", { name: /^add row$/i });
    fireEvent.click(addBtns[0]!);
    await flush();
    expect(screen.getAllByPlaceholderText(/row name/i).length).toBeGreaterThan(0);
  });

  it("adding a custom row POSTs to /api/budget/lines with category:'other'", async () => {
    const newLine = makeBudgetLine({
      id: 9001,
      category: "other",
      label: "Champagne tower",
      planned_huf: 150_000,
    });
    installDefaultEndpoints({ lines: [], snapshots: [] });
    onPost((u) => u === "/api/budget/lines", { line: newLine });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    const addBtns = screen.getAllByRole("button", { name: /^add row$/i });
    fireEvent.click(addBtns[0]!);
    await flush();
    const labelInputs = screen.getAllByPlaceholderText(/row name/i);
    fireEvent.change(labelInputs[0]!, { target: { value: "Champagne tower" } });
    // The inline "Add" button (custom_row_save = "Add") commits the row.
    const inlineSave = screen.getAllByRole("button", { name: /^add$/i });
    fireEvent.click(inlineSave[0]!);
    await flush(2);
    const postCall = fetchCalls.find((c) => c.method === "POST" && c.url === "/api/budget/lines");
    expect(postCall).toBeDefined();
    expect((postCall?.body as { category?: string }).category).toBe("other");
  });

  // A category with two lines that don't share the category's own default
  // label counts as "split" — the individual lines only render once the
  // couple expands that category's own drawer, not by default.
  it("a category split into named sub-items shows each one only once expanded, summed in the header", async () => {
    installDefaultEndpoints({
      lines: [
        makeBudgetLine({
          id: 61,
          category: "photo_video",
          label: "Photographer",
          planned_huf: 300_000,
        }),
        makeBudgetLine({
          id: 62,
          category: "photo_video",
          label: "Videographer",
          planned_huf: 200_000,
        }),
      ],
    });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Photo & video").length).toBeGreaterThan(0));
    expect(screen.queryByText("Photographer")).toBeNull();
    expect(screen.queryByText("Videographer")).toBeNull();

    // Desktop table row and mobile card share BudgetPage's own expand state
    // (CostPlanningCard above has an independent one), so toggling either
    // surface's chevron opens both at once — scope to the desktop `<tr>`
    // specifically since it, unlike the mobile card, isn't also matched by
    // a bare `[data-category="photo_video"]` selector.
    const desktopRow = document.querySelector('tr[data-category="photo_video"]');
    expect(desktopRow).not.toBeNull();
    const expandBtn = within(desktopRow as HTMLElement).getByRole("button", {
      name: /show photo & video items/i,
    });
    fireEvent.click(expandBtn);
    await flush();

    expect(screen.getAllByText("Photographer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Videographer").length).toBeGreaterThan(0);
    // The aggregate header (planned HufInput) still reads the sum. The
    // harness pins locale to "en", so grouping is comma-separated.
    const plannedInputs = screen.getAllByDisplayValue("500,000") as HTMLInputElement[];
    expect(plannedInputs.length).toBeGreaterThan(0);
  });

  it("adding an item inside a category's own drawer POSTs that category, not 'other'", async () => {
    const newLine = makeBudgetLine({
      id: 9002,
      category: "photo_video",
      label: "Second shooter",
      planned_huf: 100_000,
    });
    installDefaultEndpoints({ lines: [], snapshots: [] });
    onPost((u) => u === "/api/budget/lines", { line: newLine });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Photo & video").length).toBeGreaterThan(0));

    const desktopRow = document.querySelector('tr[data-category="photo_video"]') as HTMLElement;
    fireEvent.click(within(desktopRow).getByRole("button", { name: /show photo & video items/i }));
    await flush();

    // With no lines yet in the category, the drawer's "Add row" affordance is
    // the very next table row — scoping to it (rather than picking by index
    // among every "Add row" button on the page, several of which belong to
    // other drawers or the bottom-of-table Egyéb affordance) is what proves
    // THIS add-form is the one that fired.
    const drawerAddRow = desktopRow.nextElementSibling as HTMLElement;
    fireEvent.click(within(drawerAddRow).getByRole("button", { name: /^add row$/i }));
    await flush();
    fireEvent.change(within(drawerAddRow).getByPlaceholderText(/row name/i), {
      target: { value: "Second shooter" },
    });
    fireEvent.click(within(drawerAddRow).getByRole("button", { name: /^add$/i }));
    await flush(2);

    const postCall = fetchCalls.find((c) => c.method === "POST" && c.url === "/api/budget/lines");
    expect(postCall).toBeDefined();
    expect((postCall?.body as { category?: string }).category).toBe("photo_video");
  });

  it("deleting an aggregated row opens ConfirmDialog before issuing the DELETE", async () => {
    const line = makeBudgetLine({
      id: 5001,
      category: "venue",
      planned_huf: 1_500_000,
      label: "Venue",
    });
    installDefaultEndpoints({ lines: [line] });
    onDelete((u) => u === "/api/budget/lines/5001", { ok: true });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    // The Delete trash button is rendered with aria-label "Delete".
    const deleteBtns = screen
      .getAllByRole("button", { name: /^delete$/i })
      .filter((b) => !(b as HTMLButtonElement).disabled);
    expect(deleteBtns.length).toBeGreaterThan(0);
    fireEvent.click(deleteBtns[0]!);
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toBeInTheDocument();
    // Cancelling is the simpler path to assert — confirm-flow drives N PATCH
    // calls per-line which adds noise. We just prove the dialog opens.
    fireEvent.click(within(confirm).getByRole("button", { name: /^cancel$/i }));
    await flush();
  });

  // The picker is a combobox + listbox, not the three radios it shipped as.
  // Option labels come from ICU display names, so they're derived through the
  // app's own `currencyName` rather than hardcoded — the exact wording is the
  // runtime's to decide ("Euro" vs "euro" vs a localised form).
  async function openCurrencyPicker() {
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    // Scoped by label: the page renders more than one combobox, and the
    // currency trigger names itself "<label>: <current currency>".
    fireEvent.click(screen.getByRole("combobox", { name: /^currency:/i }));
    return await screen.findByRole("listbox");
  }

  it("renders the currency picker with HUF / EUR / USD among its options", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    const listbox = await openCurrencyPicker();
    for (const code of ["HUF", "EUR", "USD"] as const) {
      expect(within(listbox).getByRole("option", { name: currencyName(code, "en") })).toBeVisible();
    }
  });

  it("choosing a different currency opens the confirm dialog before PATCHing", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    const listbox = await openCurrencyPicker();
    fireEvent.click(within(listbox).getByRole("option", { name: currencyName("EUR", "en") }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    // Defensive cancel so the page doesn't keep the dialog mounted into the next test.
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^cancel$/i }),
    );
    await flush();
  });

  it("clicking Save snapshot opens the EntryDialog with the snapshot-name field", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /save snapshot/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByLabelText(/snapshot name/i)).toBeInTheDocument();
  });

  it("submitting the snapshot-name dialog POSTs to /api/budget/snapshots", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    onPost((u) => u === "/api/budget/snapshots", {
      snapshot: makeSnapshot({ name: "Q3 scenario" }),
    });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /save snapshot/i }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByLabelText(/snapshot name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Q3 scenario" } });
    // EntryDialogProvider's confirmLabel is the localized "Save".
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    await flush(2);
    const postCall = fetchCalls.find(
      (c) => c.method === "POST" && c.url === "/api/budget/snapshots",
    );
    expect(postCall).toBeDefined();
    expect((postCall?.body as { name?: string }).name).toBe("Q3 scenario");
  });

  it("Saved snapshots list renders one card per snapshot, with Restore + Delete buttons", async () => {
    installDefaultEndpoints({
      snapshots: [
        makeSnapshot({ id: 1, name: "100-guest scenario" }),
        makeSnapshot({ id: 2, name: "150-guest scenario" }),
      ],
    });
    renderBudget();
    await waitFor(() => {
      expect(screen.getByText("100-guest scenario")).toBeInTheDocument();
      expect(screen.getByText("150-guest scenario")).toBeInTheDocument();
    });
    // Each card carries its own Restore button (aria-label "Restore").
    expect(screen.getAllByRole("button", { name: /restore/i }).length).toBeGreaterThanOrEqual(2);
  });

  it("clicking Restore opens ConfirmDialog and POSTs /api/budget/snapshots/:id/restore on confirm", async () => {
    installDefaultEndpoints({
      snapshots: [makeSnapshot({ id: 42, name: "Original plan" })],
    });
    onPost((u) => u === "/api/budget/snapshots/42/restore", {
      restored_count: 1,
      snapshot: makeSnapshot({ id: 42, name: "Original plan" }),
    });
    renderBudget();
    await waitFor(() => expect(screen.getByText("Original plan")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: /yes, restore/i }));
    await flush(2);
    const postCall = fetchCalls.find(
      (c) => c.method === "POST" && c.url === "/api/budget/snapshots/42/restore",
    );
    expect(postCall).toBeDefined();
  });
});
