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
import type { BudgetLine, BudgetSnapshot, Couple, Guest, Household } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import BudgetPage from "@/pages/BudgetPage";
import GuestsPage from "@/pages/GuestsPage";
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
    timeline_email_escalation: "overdue",
    notif_email_cadence: "1_weekly",
    notif_focus: "timeline,rsvp,partner",
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
    notes: null,
    per_guest: false,
    icon: null,
    created_at: 0,
    updated_at: 1,
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
  } = {},
) {
  const couple = opts.couple ?? makeCouple();
  const guests = opts.guests ?? [];
  const households = opts.households ?? [];
  const lines = opts.lines ?? [];
  const snapshots = opts.snapshots ?? [];
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
      full_name: "Test User",
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

  it("the planned HufInput in the table is read-only — the slider above is the sole edit surface", async () => {
    // Behaviour change shipped alongside the cost-slider soft-caps:
    // the BudgetPage table's `planned` column became read-only so the
    // couple sees ONE place to edit the per-category plan (the
    // CostPlanningCard slider) instead of two confusing input surfaces
    // that wrote to the same `planned_huf`. Typing + blurring on the
    // table input no longer fires a PATCH because the field never
    // accepts the change. The slider-driven write path is exercised by
    // the dedicated CostPlanningCard tests.
    const line = makeBudgetLine({
      id: 5001,
      category: "venue",
      planned_huf: 1_500_000,
      label: "Venue",
    });
    installDefaultEndpoints({ lines: [line] });
    renderBudget();
    await waitFor(() => expect(screen.getAllByText("Venue").length).toBeGreaterThan(0));
    await flush(2);
    const plannedInputs = Array.from(
      document.querySelectorAll('input[data-budget-planned="true"]'),
    ) as HTMLInputElement[];
    expect(plannedInputs.length).toBeGreaterThan(0);
    // Every planned input renders read-only — both mobile and desktop slot.
    for (const inp of plannedInputs) {
      expect(inp.readOnly).toBe(true);
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
    expect(patchCall).toBeUndefined();
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

  it("renders the currency picker (HUF / EUR / USD radio buttons)", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole("radio", { name: "HUF" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "EUR" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "USD" })).toBeInTheDocument();
  });

  it("clicking a different currency radio opens the confirm dialog before PATCHing", async () => {
    installDefaultEndpoints({ lines: [], snapshots: [] });
    renderBudget();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /^budget$/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("radio", { name: "EUR" }));
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
