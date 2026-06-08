// SeatingPage + SchedulePage component tests. These pages are heavy on
// drag/drop + canvas math; what we exercise here is everything that's
// reliably testable in happy-dom — buttons, dialogs, fetch shapes, the
// ConfirmDialog flow, the conflict-warning inline message, and the wand
// suggestion list. True pointer drag-drop and pinch-zoom are skipped (see
// `it.skip` calls with a // skip: comment near the bottom of each describe).
//
// Provider stack mirrors `SubmitSupplierModal.test.tsx`: I18nProvider so
// `useT()` resolves real labels, MemoryRouter so any internal <Link> works,
// AuthProvider so an existing user is in context, and the AppProviders
// bundle (Toast + Confirm + Entry) so the dialog hooks have a home.
//
// fetch is replaced globally per-test. The seating page hits three
// endpoints on mount (plan, guests, couple); the schedule page hits one
// (schedule). The mock router below dispatches on method + URL substring
// and returns a JSON response.

import type { Couple, Guest, SeatAssignment, SeatingTable } from "@shared/types";
import type { ScheduleEvent } from "@shared/schedule";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import SchedulePage from "@/pages/SchedulePage";
import SeatingPage from "@/pages/SeatingPage";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { AppProviders } from "@/components/ui/AppProviders";

// ─── Test data factories ──────────────────────────────────────────────────

function makeCouple(overrides: Partial<Couple> = {}): Couple {
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
    ...overrides,
  } as Couple;
}

function makeTable(overrides: Partial<SeatingTable> = {}): SeatingTable {
  return {
    id: 1,
    couple_id: 1,
    label: "Table 1",
    shape: "round",
    seats: 8,
    x_mm: 5000,
    y_mm: 3000,
    width_mm: 1500,
    length_mm: 1500,
    is_kids_table: false,
    rotation_deg: 0,
    disabled_seats: [],
    baby_seats: [],
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

let nextGuestId = 1;
function makeGuest(name: string, overrides: Partial<Guest> = {}): Guest {
  const id = nextGuestId++;
  return {
    id,
    couple_id: 1,
    household_id: id,
    full_name: name,
    email: null,
    phone: null,
    group_tag: "shared_friends",
    invite_code: `INV${id}`,
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
    invitation_delivered_at: null,
    accommodation_id: null,
    transfer_id: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: 1,
    couple_id: 1,
    label: "Ceremony",
    starts_at_minutes: 15 * 60,
    duration_minutes: 30,
    location: "Main hall",
    notes: null,
    responsible: null,
    couple_supplier_id: null,
    sort_order: 0,
    is_key_moment: false,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

// ─── Fetch mock ───────────────────────────────────────────────────────────
// Routes are matched on `${METHOD} ${pathPrefix}`. The most-specific
// patterns are kept first; the fallback returns 404 so we don't silently
// pass requests through to the real backend (which isn't running).

type RouteHandler = (url: string, init: RequestInit | undefined) => unknown | Promise<unknown>;

interface RoutingFetchMock {
  fetch: typeof fetch;
  calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }>;
  set: (key: string, handler: RouteHandler | unknown) => void;
}

function installFetchMock(initial: Record<string, RouteHandler | unknown> = {}): RoutingFetchMock {
  const routes = new Map<string, RouteHandler | unknown>(Object.entries(initial));
  const calls: RoutingFetchMock["calls"] = [];

  const set = (key: string, handler: RouteHandler | unknown) => {
    routes.set(key, handler);
  };

  const resolve = (key: string): RouteHandler | unknown | undefined => {
    if (routes.has(key)) return routes.get(key);
    // Allow prefix matching: e.g. "PATCH /api/seating/tables/" matches "PATCH /api/seating/tables/7".
    for (const [k, v] of routes) {
      if (k.endsWith("/") && key.startsWith(k)) return v;
      if (k.endsWith("*") && key.startsWith(k.slice(0, -1))) return v;
    }
    return undefined;
  };

  // Loosely typed to avoid the React 19 `typeof fetch` adding a non-standard
  // `preconnect` member; bun:test only cares about call/return shape.
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const headers: Record<string, string> = {};
    if (init?.headers) {
      // happy-dom passes Headers as a plain Record in most cases.
      const raw = init.headers as Record<string, string>;
      for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = String(v);
    }
    calls.push({ method, url, body, headers });

    const key = `${method} ${url}`;
    const handler = resolve(key) ?? resolve(`${method} ${url.split("?")[0]}`);
    if (handler === undefined) {
      return new Response(JSON.stringify({ error: `unmocked ${key}` }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    const payload =
      typeof handler === "function" ? await (handler as RouteHandler)(url, init) : handler;
    if (payload instanceof Response) return payload;
    return new Response(JSON.stringify(payload ?? {}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return { fetch: impl, calls, set };
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  nextGuestId = 1;
  try {
    // Pretend we're logged in so AuthProvider doesn't bounce.
    localStorage.setItem("weddly.token", "test-token");
  } catch {
    // localStorage may be unavailable in some runners
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  try {
    localStorage.removeItem("weddly.token");
  } catch {
    // ignore
  }
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <MemoryRouter>
        <AuthProvider>
          <AppProviders>{children}</AppProviders>
        </AuthProvider>
      </MemoryRouter>
    </I18nProvider>
  );
}

// Render helper that also waits for the page's initial loaders to settle —
// every page kicks off fetches in a useEffect, and assertions made before
// those resolve fight stale loading states.
async function renderPage(node: ReactNode) {
  const utils = render(<Providers>{node}</Providers>);
  // Yield twice to let React flush the mount-time effects + their promises.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

// ─── SeatingPage tests ────────────────────────────────────────────────────

describe("<SeatingPage>", () => {
  function defaultSeatingRoutes(
    opts: {
      tables?: SeatingTable[];
      assignments?: SeatAssignment[];
      guests?: Guest[];
      couple?: Couple;
    } = {},
  ) {
    return {
      "GET /api/auth/me": { user: { id: 1, email: "a@b.com", role: "owner", status: "active" } },
      "GET /api/seating/plan": {
        tables: opts.tables ?? [],
        assignments: opts.assignments ?? [],
        conflicts: [],
      },
      "GET /api/guests": { guests: opts.guests ?? [] },
      "GET /api/couples/current": { couple: opts.couple ?? makeCouple() },
    };
  }

  it("renders the empty-tables card when no tables exist", async () => {
    // Seed at least one guest so the empty-state body shows the "Add one to
    // get started." copy. Without guests the empty-tables card shows the
    // upstream "go add guests first" guidance instead.
    const mockFetch = installFetchMock(defaultSeatingRoutes({ guests: [makeGuest("Alice Solo")] }));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // "No tables yet" → render the stationery empty card.
    expect(await screen.findByText("No tables yet")).toBeInTheDocument();
    expect(screen.getByText("Add one to get started.")).toBeInTheDocument();
    // Empty-state CTA uses a distinct label from the toolbar button to avoid
    // duplicate accessible names when both render simultaneously.
    expect(screen.getByRole("button", { name: "Add your first table" })).toBeInTheDocument();
  });

  it("clicking 'Add table' fires POST /api/seating/tables with shape, seats, and position", async () => {
    let posted: { url: string; body: unknown } | null = null;
    const mockFetch = installFetchMock({
      ...defaultSeatingRoutes(),
      "POST /api/seating/tables": ((url: string, init: RequestInit | undefined) => {
        posted = { url, body: init?.body ? JSON.parse(init.body as string) : null };
        return { table: makeTable({ id: 99, label: "Table 1" }) };
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Exact-match the toolbar button; the empty-state CTA has a different
    // label ("Add your first table") to keep accessible names distinct.
    const addButton = screen.getByRole("button", { name: "Add table" });
    await act(async () => {
      fireEvent.click(addButton);
      await Promise.resolve();
    });

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted!.body).toMatchObject({
      shape: "round",
      seats: 8,
    });
    expect(posted!.body).toHaveProperty("x_mm");
    expect(posted!.body).toHaveProperty("y_mm");
    expect(posted!.body).toHaveProperty("width_mm");
    expect(posted!.body).toHaveProperty("length_mm");
  });

  it("renders existing tables with their labels", async () => {
    const tables = [
      makeTable({ id: 1, label: "Head Table", shape: "head" }),
      makeTable({ id: 2, label: "Garden Round" }),
    ];
    const mockFetch = installFetchMock(defaultSeatingRoutes({ tables }));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Each table renders both in the floor-plan map AND as a TableCard.
    // findAllByText copes with that duplication without forcing us to query
    // by region selector.
    const headHits = await screen.findAllByText("Head Table");
    expect(headHits.length).toBeGreaterThan(0);
    const gardenHits = await screen.findAllByText("Garden Round");
    expect(gardenHits.length).toBeGreaterThan(0);
  });

  it("clicking a table card selects it (TableEditor swaps in the per-table controls)", async () => {
    const tables = [makeTable({ id: 1, label: "Solo Table" })];
    const mockFetch = installFetchMock(defaultSeatingRoutes({ tables }));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // The "empty editor" hint is rendered until a table is selected.
    expect(screen.getByText("Pick a table on the map to edit its details.")).toBeInTheDocument();

    // Find the TableCard's role=button container by walking up from the h3
    // label (the same element exists as SVG <text> inside SeatingMap, which
    // wouldn't have a role="button" parent).
    const labelEls = await screen.findAllByText("Solo Table");
    const cardLabel = labelEls.find((el) => el.tagName === "H3");
    expect(cardLabel).toBeTruthy();
    const card = cardLabel!.closest("[role='button']") as HTMLElement | null;
    expect(card).toBeTruthy();

    await act(async () => {
      fireEvent.click(card!);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Once selected, the per-table editor renders its action row — the
    // "Delete table" button is unique to that surface.
    const deleteBtn = await waitFor(() => screen.getByRole("button", { name: /Delete table/i }));
    expect(deleteBtn).toBeInTheDocument();
  });

  it("delete confirm flow calls DELETE /api/seating/tables/:id with If-Match-less DELETE", async () => {
    let deleted: string | null = null;
    const tables = [makeTable({ id: 7, label: "Doomed" })];
    const mockFetch = installFetchMock({
      ...defaultSeatingRoutes({ tables }),
      "DELETE /api/seating/tables/7": ((url: string) => {
        deleted = url;
        return { ok: true };
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Find the TableCard (NOT the SeatingMap SVG group, which also matches
    // role="button"). The TableCard's h3 uses `font-serif text-xl` — we walk
    // up from that to the role=button ancestor.
    const labelEls = await screen.findAllByText("Doomed");
    const cardLabel = labelEls.find((el) => el.tagName === "H3");
    expect(cardLabel).toBeTruthy();
    const card = cardLabel!.closest("[role='button']") as HTMLElement | null;
    expect(card).toBeTruthy();

    await act(async () => {
      fireEvent.click(card!);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Delete button lives inside TableEditor (aria-label "Delete table").
    const deleteButton = await waitFor(() => screen.getByRole("button", { name: /Delete table/i }));
    await act(async () => {
      fireEvent.click(deleteButton);
      await Promise.resolve();
    });

    // ConfirmDialog mounts with the label as the body. The page's confirm
    // call passes confirmLabel: t("common.confirm_delete") which resolves
    // to "Yes, delete" in the en locale.
    const confirmBtn = await screen.findByRole("button", { name: /Yes, delete/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
      await Promise.resolve();
    });

    await waitFor(() => expect(deleted).toBe("/api/seating/tables/7"));
  });

  it("unassigned panel lists guests that aren't seated", async () => {
    const guests = [makeGuest("Alice Solo"), makeGuest("Bob Solo")];
    const tables = [makeTable({ id: 1, label: "T1" })];
    const mockFetch = installFetchMock(defaultSeatingRoutes({ tables, guests }));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Panel header is unique even though the guests appear in multiple panes
    // (the partner-name fallback labels — Bride / Groom — also appear here).
    expect(await screen.findByText("Unassigned guests")).toBeInTheDocument();
    expect(screen.getByText("Alice Solo")).toBeInTheDocument();
    expect(screen.getByText("Bob Solo")).toBeInTheDocument();
  });

  it("PDF export A4 triggers fetch to /api/print/seating/a4", async () => {
    const calls: string[] = [];
    const tables = [makeTable({ id: 1 })];
    const mockFetch = installFetchMock({
      ...defaultSeatingRoutes({ tables }),
      "GET /api/print/seating/a4*": ((url: string) => {
        calls.push(url);
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Export is a single Print button that opens a paper-size menu; pick A4.
    const printTrigger = await screen.findByRole("button", { name: /^print$/i });
    fireEvent.click(printTrigger);
    const a4Item = await screen.findByRole("menuitem", { name: /^a4$/i });
    await act(async () => {
      fireEvent.click(a4Item);
      // PDF fetch + preview dialog setup take an extra microtask.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContain("/api/print/seating/a4");
  });

  it("PDF export A3 triggers fetch to /api/print/seating/a3", async () => {
    const calls: string[] = [];
    const tables = [makeTable({ id: 1 })];
    const mockFetch = installFetchMock({
      ...defaultSeatingRoutes({ tables }),
      "GET /api/print/seating/a3*": ((url: string) => {
        calls.push(url);
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        });
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Export is a single Print button that opens a paper-size menu; pick A3.
    const printTrigger = await screen.findByRole("button", { name: /^print$/i });
    fireEvent.click(printTrigger);
    const a3Item = await screen.findByRole("menuitem", { name: /^a3$/i });
    await act(async () => {
      fireEvent.click(a3Item);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls[0]).toContain("/api/print/seating/a3");
  });

  it("tap-mode toggle button reflects aria-pressed state", async () => {
    const tables = [makeTable({ id: 1 })];
    const mockFetch = installFetchMock(defaultSeatingRoutes({ tables }));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    // Page renders "Tap mode" (label when off) on a fine pointer device.
    const toggle = await screen.findByRole("button", { name: /Tap mode/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });

    // After toggling, the label flips to "Exit tap mode" and aria-pressed is true.
    const flipped = await screen.findByRole("button", { name: /Exit tap mode/i });
    expect(flipped).toHaveAttribute("aria-pressed", "true");
  });

  it("shortcuts dialog opens when the help button is clicked", async () => {
    const mockFetch = installFetchMock(defaultSeatingRoutes());
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SeatingPage />);

    const helpButton = screen.getByRole("button", { name: /Keyboard shortcuts/i });
    await act(async () => {
      fireEvent.click(helpButton);
      await Promise.resolve();
    });

    // Dialog mounts with role="alertdialog" and the heading text — query by
    // heading role is uniquely the dialog's title (the trigger uses
    // aria-label only, no visible text).
    const heading = await screen.findByRole("heading", { name: /Keyboard shortcuts/i });
    expect(heading).toBeInTheDocument();
  });

  // skip: Tap-mode seat-place requires a TableCard render with seats AND a
  // ring-buffer-friendly tap sequence. The DOM is testable, but the chain
  // of state updates (selectedGuestId → handleTapSeat → requestAssign →
  // assignGuest → POST /api/seating/assign) yields too many React batches
  // for happy-dom's microtask flush to settle deterministically without
  // wall-clock waits that flake on CI. Covered by the dedicated
  // backend seating route tests instead.
  it.skip("clicking a seat in tap-mode after selecting a guest POSTs /api/seating/assign", () => {
    // skip: see comment above. Tested at the API + page-integration level.
  });

  // skip: same reason as the assign test — unassign flows through the
  // same multi-batch state machine and happy-dom can't pin down the
  // POST timing without sleeping.
  it.skip("clicking 'unassign' on a seated guest POSTs /api/seating/unassign", () => {
    // skip: covered by backend route tests; the page wiring is the same
    // shape as the assign path above.
  });

  // skip: editing dimensions in the TableEditor wires through a
  // `defaultValue`-driven uncontrolled input that commits on blur. Forcing
  // a blur in happy-dom doesn't trigger the SuffixedInput's onCommit
  // reliably (focus management on happy-dom diverges from JSDOM/real DOM).
  // The PATCH endpoint shape is covered separately by domain tests.
  it.skip("editing dimensions in TableEditor PATCHes /api/seating/tables/:id with If-Match", () => {
    // skip: see comment above. The seating route tests cover the same
    // request shape (PATCH + If-Match: updated_at) directly.
  });
});

// ─── SchedulePage tests ───────────────────────────────────────────────────

describe("<SchedulePage>", () => {
  function defaultScheduleRoutes(events: ScheduleEvent[] = []) {
    return {
      "GET /api/auth/me": { user: { id: 1, email: "a@b.com", role: "owner", status: "active" } },
      "GET /api/schedule": { events },
    };
  }

  it("renders the empty-state when no events exist", async () => {
    const mockFetch = installFetchMock(defaultScheduleRoutes());
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    expect(await screen.findByText("No schedule yet")).toBeInTheDocument();
    expect(screen.getByText(/Add events, or generate a proposal/)).toBeInTheDocument();
  });

  it("'New event' button opens the create dialog with empty label + 15:00 default", async () => {
    const mockFetch = installFetchMock(defaultScheduleRoutes());
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    // The header has a "New event" button; the empty card has a "Suggest
    // timeline" button. We want the former.
    const addButton = screen.getByRole("button", { name: /New event/i });
    await act(async () => {
      fireEvent.click(addButton);
      await Promise.resolve();
    });

    // Dialog renders an h2 with "New event" — heading role is the safest
    // way to find it without snagging the toolbar button.
    const heading = await screen.findByRole("heading", { name: /New event/i });
    expect(heading).toBeInTheDocument();

    // Time defaults to 15:00 per the dialog source.
    const timeInput = screen.getByDisplayValue("15:00");
    expect(timeInput).toBeInTheDocument();
  });

  it("submit calls POST /api/schedule with HH:MM converted to starts_at_minutes", async () => {
    let createBody: unknown = null;
    const mockFetch = installFetchMock({
      ...defaultScheduleRoutes(),
      "POST /api/schedule": ((_url: string, init: RequestInit | undefined) => {
        createBody = init?.body ? JSON.parse(init.body as string) : null;
        return {
          event: makeEvent({ id: 42, label: "Toast", starts_at_minutes: 16 * 60 + 30 }),
        };
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /New event/i }));
      await Promise.resolve();
    });

    // Fill the form — label + time. Duration / location are optional.
    const labelInput = screen.getByPlaceholderText(/Civil ceremony/i);
    const timeInput = screen.getByDisplayValue("15:00");
    fireEvent.change(labelInput, { target: { value: "Toast" } });
    fireEvent.change(timeInput, { target: { value: "16:30" } });

    const submit = screen.getByRole("button", { name: /^Save$/ });
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({
      label: "Toast",
      starts_at_minutes: 16 * 60 + 30,
    });
  });

  it("existing events render in starts_at_minutes order", async () => {
    const events = [
      makeEvent({ id: 1, label: "Dance", starts_at_minutes: 21 * 60 }),
      makeEvent({ id: 2, label: "Brunch", starts_at_minutes: 11 * 60 }),
      makeEvent({ id: 3, label: "Ceremony", starts_at_minutes: 15 * 60 }),
    ];
    const mockFetch = installFetchMock(defaultScheduleRoutes(events));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    // The page exposes each event row as a button with aria-label "Edit
    // event" — the user-visible label sits inside that button. Reading the
    // textContent in DOM order gives us the rendered ordering.
    const rows = await screen.findAllByRole("button", { name: /Edit event/i });
    const labels = rows.map((b) => b.textContent ?? "");
    const brunchIdx = labels.findIndex((s) => s.includes("Brunch"));
    const ceremonyIdx = labels.findIndex((s) => s.includes("Ceremony"));
    const danceIdx = labels.findIndex((s) => s.includes("Dance"));
    expect(brunchIdx).toBeGreaterThanOrEqual(0);
    expect(brunchIdx).toBeLessThan(ceremonyIdx);
    expect(ceremonyIdx).toBeLessThan(danceIdx);
  });

  it("clicking an event opens the edit dialog with the event's label populated", async () => {
    const events = [makeEvent({ id: 5, label: "First Dance", starts_at_minutes: 21 * 60 })];
    const mockFetch = installFetchMock(defaultScheduleRoutes(events));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    const editButton = (await screen.findAllByRole("button", { name: /Edit event/i }))[0];
    await act(async () => {
      fireEvent.click(editButton!);
      await Promise.resolve();
    });

    // Dialog heading switches to "Edit event" — also the row's button label.
    const headings = await screen.findAllByRole("heading", { name: /Edit event/i });
    expect(headings.length).toBeGreaterThan(0);
    // The label input is now populated with the existing event's label.
    expect(screen.getByDisplayValue("First Dance")).toBeInTheDocument();
    // And the time input shows 21:00 (`starts_at_minutes` 21*60).
    expect(screen.getByDisplayValue("21:00")).toBeInTheDocument();
  });

  it("editing an event PATCHes /api/schedule/:id with If-Match header", async () => {
    let patched: { url: string; body: unknown; headers: Record<string, string> } | null = null;
    const events = [
      makeEvent({ id: 9, label: "Cake", starts_at_minutes: 19 * 60, updated_at: 1234567 }),
    ];
    const mockFetch = installFetchMock({
      ...defaultScheduleRoutes(events),
      "PATCH /api/schedule/9": ((url: string, init: RequestInit | undefined) => {
        patched = {
          url,
          body: init?.body ? JSON.parse(init.body as string) : null,
          headers: Object.fromEntries(
            Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [
              k.toLowerCase(),
              String(v),
            ]),
          ),
        };
        return { event: makeEvent({ id: 9, label: "Cake (revised)", updated_at: 999 }) };
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    const editButton = (await screen.findAllByRole("button", { name: /Edit event/i }))[0];
    await act(async () => {
      fireEvent.click(editButton!);
      await Promise.resolve();
    });

    const labelInput = await screen.findByDisplayValue("Cake");
    fireEvent.change(labelInput, { target: { value: "Cake (revised)" } });

    const submit = screen.getByRole("button", { name: /^Save$/ });
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched!.url).toBe("/api/schedule/9");
    expect(patched!.body).toMatchObject({ label: "Cake (revised)" });
    expect(patched!.headers["if-match"]).toBe("1234567");
  });

  it("delete event opens ConfirmDialog and confirming calls DELETE /api/schedule/:id", async () => {
    let deletedUrl: string | null = null;
    const events = [makeEvent({ id: 12, label: "Cleanup", starts_at_minutes: 23 * 60 })];
    const mockFetch = installFetchMock({
      ...defaultScheduleRoutes(events),
      "DELETE /api/schedule/12": ((url: string) => {
        deletedUrl = url;
        return { ok: true };
      }) as RouteHandler,
    });
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    // The row's delete button has aria-label "Delete event".
    const deleteButton = (await screen.findAllByRole("button", { name: /Delete event/i }))[0];
    await act(async () => {
      fireEvent.click(deleteButton!);
      await Promise.resolve();
    });

    // ConfirmDialog: title "Delete this event?", primary "Yes, delete"
    // (page uses common.confirm_delete which maps to that string in en).
    expect(await screen.findByText("Delete this event?")).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: /Yes, delete/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
      await Promise.resolve();
    });

    await waitFor(() => expect(deletedUrl).toBe("/api/schedule/12"));
  });

  it("time-conflict warning renders inline when submit collides with an existing event", async () => {
    const events = [
      makeEvent({
        id: 1,
        label: "Ceremony",
        starts_at_minutes: 15 * 60,
        duration_minutes: 60,
      }),
    ];
    const mockFetch = installFetchMock(defaultScheduleRoutes(events));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /New event/i }));
      await Promise.resolve();
    });

    // Default time in the create dialog is 15:00 — which sits inside the
    // existing ceremony's 15:00..16:00 window. Set a label and submit;
    // the page should reject the save with the inline conflict message.
    const labelInput = screen.getByPlaceholderText(/Civil ceremony/i);
    fireEvent.change(labelInput, { target: { value: "Speech" } });

    const submit = screen.getByRole("button", { name: /^Save$/ });
    await act(async () => {
      fireEvent.click(submit);
      await Promise.resolve();
    });

    // `schedule.time_conflict` interpolates the label, so the rendered
    // string contains "Ceremony" — matching on the surrounding "Already
    // booked" phrase is locale-stable.
    expect(await screen.findByText(/Already booked/i)).toBeInTheDocument();
  });

  it("'Suggest timeline' (wand) opens the wand dialog from the header", async () => {
    const mockFetch = installFetchMock(defaultScheduleRoutes());
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    // Two buttons share this label in the empty state — the header button
    // and the one inside the empty card. Both should open the same dialog;
    // clicking the first match works.
    const wandTriggers = await screen.findAllByRole("button", { name: /Suggest timeline/i });
    await act(async () => {
      fireEvent.click(wandTriggers[0]!);
      await Promise.resolve();
    });

    // Dialog title is "Suggest a timeline" — a longer string that doesn't
    // collide with the trigger label.
    expect(await screen.findByRole("heading", { name: /Suggest a timeline/i })).toBeInTheDocument();
  });

  it("wand dialog flags items that overlap existing events with a conflict badge", async () => {
    // Seed an event that covers 15:00 — the canonical template includes a
    // milestone right at the start of the window, so it'll collide.
    const events = [
      makeEvent({
        id: 1,
        label: "Ceremony",
        starts_at_minutes: 15 * 60,
        duration_minutes: 60,
      }),
    ];
    const mockFetch = installFetchMock(defaultScheduleRoutes(events));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    const wandButton = (await screen.findAllByRole("button", { name: /Suggest timeline/i }))[0];
    await act(async () => {
      fireEvent.click(wandButton!);
      await Promise.resolve();
    });

    // The proposal list shows "Conflicts with existing event" pills next to
    // items that collide. Default window is 15:00 → 23:00, so the
    // 15:00 ceremony will trip at least one entry.
    const conflictPills = await screen.findAllByText(/Conflicts with existing event/i);
    expect(conflictPills.length).toBeGreaterThan(0);
  });

  it("dialog stacking: opening delete-confirm on an event keeps the row's event button mounted", async () => {
    // The schedule page doesn't open the edit drawer before the confirm,
    // so this is the closest mirror of the "nested dialog" requirement:
    // the delete-confirm dialog should mount WITHOUT blowing away the row
    // it was launched from. Both the row buttons + the confirm dialog
    // are present at the same time.
    const events = [makeEvent({ id: 4, label: "Cocktails", starts_at_minutes: 18 * 60 })];
    const mockFetch = installFetchMock(defaultScheduleRoutes(events));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    const deleteButton = (await screen.findAllByRole("button", { name: /Delete event/i }))[0];
    await act(async () => {
      fireEvent.click(deleteButton!);
      await Promise.resolve();
    });

    // Confirm dialog title is visible.
    expect(await screen.findByText("Delete this event?")).toBeInTheDocument();
    // The original Cocktails row is still mounted in the page body.
    expect(screen.getByText("Cocktails")).toBeInTheDocument();
  });

  it("cancelling the delete confirm dismisses the dialog and leaves the row in place", async () => {
    const events = [makeEvent({ id: 4, label: "Pre-dinner", starts_at_minutes: 17 * 60 })];
    const mockFetch = installFetchMock(defaultScheduleRoutes(events));
    globalThis.fetch = mockFetch.fetch;

    await renderPage(<SchedulePage />);

    const deleteButton = (await screen.findAllByRole("button", { name: /Delete event/i }))[0];
    await act(async () => {
      fireEvent.click(deleteButton!);
      await Promise.resolve();
    });

    const confirmTitle = await screen.findByText("Delete this event?");
    const dialog = confirmTitle.closest("[role='alertdialog']") as HTMLElement | null;
    expect(dialog).toBeTruthy();
    const cancel = within(dialog!).getByRole("button", { name: /^Cancel$/ });

    await act(async () => {
      fireEvent.click(cancel);
      await Promise.resolve();
    });

    expect(screen.queryByText("Delete this event?")).not.toBeInTheDocument();
    // Row still present afterwards.
    expect(screen.getByText("Pre-dinner")).toBeInTheDocument();
  });

  // skip: SchedulePage does not currently expose a per-row "duplicate"
  // affordance. The backend route `POST /api/schedule/:id/duplicate` exists
  // (see backend/src/routes/schedule.ts) but the frontend dialog flow only
  // surfaces edit + delete on each row. Re-enable once a UI button lands.
  it.skip("duplicate event row button POSTs /api/schedule/:id/duplicate", () => {
    // skip: see comment above. No duplicate button is rendered in the
    // current SchedulePage.
  });
});
