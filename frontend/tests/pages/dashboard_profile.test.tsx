// Focused component tests for DashboardPage + ProfilePage. We mount each
// page wrapped in the same provider stack the app uses, mock globalThis.fetch
// per-test to control the data the pages load on mount, and assert on what
// the user sees (KPI tiles, banner content, button labels) and which API
// URLs get pinged when they interact.
//
// Notes on scope:
//   * UI-only — we don't assert on API response shapes (that's backend's
//     concern). We do assert which URLs got called so the wiring stays honest.
//   * Each test wires its own fetch mock so the suite stays parallel-safe.
//   * Lazy-hydrated payloads (DashboardPage fires `dietaryApi.summary()` +
//     `scheduleApi.list()` AFTER first paint) need a single waitFor on the
//     primary data so the lazy effect has time to settle before assertions.

import { resolveDesign } from "@shared/design";
import type { Couple, Guest, BudgetLine } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DashboardPage from "@/pages/DashboardPage";
import ProfilePage from "@/pages/ProfilePage";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import { AppProviders } from "@/components/ui/AppProviders";

// ── Shared fixture builders ───────────────────────────────────────────────

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: "anna@example.test",
    full_name: "Anna Kovács",
    status: "active",
    role: "user",
    is_admin: false,
    couple_id: 1,
    verified_email: true,
    created_at: Date.now() - 86_400_000,
    ...overrides,
  };
}

function makeCouple(overrides: Partial<Couple> = {}): Couple {
  // Wedding date defaults to ~120 days out so the day-of mode stays off and
  // the planning-mode KPI grid renders. Individual tests override as needed.
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return {
    id: 1,
    partner_a_id: 1,
    partner_b_id: 2,
    display_name: "Anna & Béla",
    bride_name: "Anna",
    groom_name: "Béla",
    slug: "ANNABELA",
    organiser_code: null,
    wedding_date_goal: {
      kind: "exact",
      exact_date: inDays(120),
      target_year: 2027,
      target_month: 6,
      target_season: null,
    },
    wedding_date: inDays(120),
    previous_wedding_date: null,
    ceremony_kind: "civil",
    archived_at: null,
    guest_count_goal: { kind: "exact", exact: 80, min: null, max: null },
    target_guest_count: 80,
    budget_goal: { kind: "exact", exact_huf: 5_000_000, min_huf: null, max_huf: null },
    budget_ceiling_huf: 5_000_000,
    currency: "HUF",
    planning_count: null,
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
    created_at: Date.now() - 86_400_000,
    onboarded_at: Date.now() - 86_400_000,
    updated_at: Date.now(),
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
    ...overrides,
  };
}

function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: 1,
    couple_id: 1,
    household_id: null,
    full_name: "Test Guest",
    email: "guest@example.test",
    phone: null,
    side: "bride",
    relation: "friend",
    plus_one: false,
    is_minor: false,
    age_band: null,
    rsvp_status: "yes",
    rsvp_responded_at: null,
    invite_code: "AAAA01",
    invited_at: null,
    invite_delivered_at: null,
    dietary: null,
    meal_choice: null,
    accommodation_needed: null,
    notes: null,
    group_tag: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  } as Guest;
}

function makeBudgetLine(overrides: Partial<BudgetLine> = {}): BudgetLine {
  return {
    id: 1,
    couple_id: 1,
    category: "venue",
    label: "Helyszín",
    planned_huf: 1_000_000,
    actual_huf: 500_000,
    paid_huf: 0,
    supplier_id: null,
    couple_supplier_id: null,
    listing_id: null,
    notes: null,
    per_guest: false,
    icon: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

// ── Fetch routing helpers ────────────────────────────────────────────────

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface FetchRoutes {
  user?: ReturnType<typeof makeUser>;
  couple?: Couple | null;
  guests?: Guest[];
  budgetLines?: BudgetLine[];
  seating?: { tables: unknown[]; assignments: unknown[]; conflicts: unknown[] };
  invite?: unknown | null;
  incomingInvites?: unknown[];
  // Profile-specific
  partner?: unknown | null;
  pause?: { couple_status: string; pause_request: unknown | null };
  activity?: unknown[];
  documents?: unknown[];
  myCouples?: { current_couple_id: number | null; couples: unknown[] };
  // Per-test overrides — runs FIRST, returns null to fall through.
  override?: (url: string, init?: RequestInit) => Response | null | Promise<Response | null>;
  /** Captures every URL that gets fetched, in order. */
  calls?: string[];
}

/** Build a fetch mock that routes by URL suffix. */
function buildFetch(routes: FetchRoutes): typeof fetch {
  const user = routes.user ?? makeUser();
  const couple = routes.couple === undefined ? makeCouple() : routes.couple;
  const guests = routes.guests ?? [];
  const lines = routes.budgetLines ?? [];
  const seating = routes.seating ?? { tables: [], assignments: [], conflicts: [] };
  const inviteRes = routes.invite === undefined ? null : routes.invite;
  const incoming = routes.incomingInvites ?? [];
  const partner = routes.partner === undefined ? null : routes.partner;
  const pause = routes.pause ?? { couple_status: "active", pause_request: null };
  const activity = routes.activity ?? [];
  const documents = routes.documents ?? [];
  const myCouples = routes.myCouples ?? { current_couple_id: couple?.id ?? null, couples: [] };

  const handler: Handler = async (url, init) => {
    routes.calls?.push(`${(init?.method ?? "GET").toUpperCase()} ${url}`);
    if (routes.override) {
      const r = await routes.override(url, init);
      if (r) return r;
    }
    if (url.endsWith("/api/auth/me")) return ok({ user });
    if (url.endsWith("/api/couples/current") && (init?.method ?? "GET") === "GET") {
      return ok({ couple });
    }
    if (url.endsWith("/api/couples/current") && init?.method === "PATCH") {
      return ok({ couple });
    }
    if (url.endsWith("/api/couples/current/archive")) return ok({ couple });
    if (url.endsWith("/api/couples/current/notify-date-change")) {
      return ok({ notified_count: guests.filter((g) => g.email).length, skipped_count: 0 });
    }
    if (url.endsWith("/api/couples/current/dismiss-date-change")) return ok({ ok: true });
    if (url.endsWith("/api/guests")) return ok({ guests });
    if (url.endsWith("/api/budget/lines") && (init?.method ?? "GET") === "GET") {
      return ok({ lines });
    }
    if (url.endsWith("/api/seating/plan")) return ok(seating);
    if (url.endsWith("/api/couples/invites/current")) return ok({ invite: inviteRes });
    if (url.endsWith("/api/invites/incoming")) return ok({ invites: incoming });
    if (url.endsWith("/api/guests/dietary-summary")) {
      return ok({
        counted_guests: 0,
        meal: { meat: 0, fish: 0, vegetarian: 0, vegan: 0, child: 0, none: 0, unspecified: 0 },
        allergies: {
          gluten: 0,
          milk_protein: 0,
          lactose: 0,
          nut: 0,
          egg: 0,
          fish_shellfish: 0,
          other_text_count: 0,
        },
      });
    }
    if (url.endsWith("/api/schedule")) return ok({ events: [] });
    // Profile
    if (url.endsWith("/api/couples/pause") && (init?.method ?? "GET") === "GET") return ok(pause);
    if (url.endsWith("/api/couples/pause") && init?.method === "POST") {
      return ok({ pause_request: { id: 99, scheduled_delete_at: Date.now() + 30 * 86_400_000 } });
    }
    if (url.endsWith("/api/couples/pause/cancel")) return ok({ ok: true });
    // The linked-planners panel fires on mount; without an explicit route the
    // tolerant `{}` default leaves `r.planners` undefined and the panel crashes
    // on `planners.length`, which then poisons every later test in the file.
    if (url.endsWith("/api/couples/planners")) return ok({ planners: [] });
    if (url.endsWith("/api/couples/partner")) return ok({ partner });
    if (url.endsWith("/api/couples/activity")) return ok({ entries: activity });
    if (url.endsWith("/api/exports") && (init?.method ?? "GET") === "GET") {
      return ok({ exports: documents });
    }
    if (url.endsWith("/api/couples/export")) return ok({ snapshot: "ok" });
    if (url.endsWith("/api/users/me/couples")) return ok(myCouples);
    if (url.endsWith("/api/users/me/leave-couple")) return ok({ ok: true });
    if (url.endsWith("/api/print/place-cards") || url.includes("/api/print/place-cards?")) {
      return new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), { status: 200 });
    }
    if (url.endsWith("/api/guests/csv")) {
      return new Response(new Blob(["full_name\n"], { type: "text/csv" }), { status: 200 });
    }
    // Tolerant default — many infra fetches (e.g. RSVP-offline poll, sentry)
    // we just don't care about. Return an empty 200 so the page keeps going.
    return ok({});
  };

  return mock(async (...args: Parameters<typeof fetch>) => {
    const [input, init] = args;
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    return handler(url, init as RequestInit | undefined);
  }) as unknown as typeof fetch;
}

// ── Provider stack ───────────────────────────────────────────────────────

function renderPage(page: "dashboard" | "profile", initialPath = "/app") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <I18nProvider>
        <AppProviders>
          <AuthProvider>{page === "dashboard" ? <DashboardPage /> : <ProfilePage />}</AuthProvider>
        </AppProviders>
      </I18nProvider>
    </MemoryRouter>,
  );
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  try {
    // Seed the bearer token so AuthProvider hydrates the user on mount.
    localStorage.setItem("weddly.token", "test-token");
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  globalThis.fetch = realFetch;
  try {
    localStorage.removeItem("weddly.token");
    localStorage.removeItem("weddly.locale");
  } catch {
    /* ignore */
  }
});

// ─────────────────────────────────────────────────────────────────────────
// DashboardPage
// ─────────────────────────────────────────────────────────────────────────

describe("<DashboardPage>", () => {
  it("renders the wedding-countdown KPI with a day count", async () => {
    globalThis.fetch = buildFetch({});
    renderPage("dashboard");

    // The "Days to go" label is the KPI tile heading; presence is enough.
    await waitFor(() => expect(screen.getByText(/days to go/i)).toBeInTheDocument());
  });

  it("shows the guest list KPI count derived from /api/guests", async () => {
    const guests = [
      makeGuest({ id: 1, rsvp_status: "yes" }),
      makeGuest({ id: 2, rsvp_status: "yes" }),
      makeGuest({ id: 3, rsvp_status: "pending" }),
    ];
    globalThis.fetch = buildFetch({ guests });
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/rsvps in/i)).toBeInTheDocument());
    // Target is 80, 2 are yes — "of 80 confirmed" sits under the headline.
    expect(screen.getByText(/of 80 confirmed/i)).toBeInTheDocument();
  });

  it("renders the budget spent vs cap KPI", async () => {
    const lines = [makeBudgetLine({ id: 1, planned_huf: 2_000_000, actual_huf: 1_250_000 })];
    globalThis.fetch = buildFetch({ budgetLines: lines });
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/^Spent$/i)).toBeInTheDocument());
    // The cap is rendered as a clickable inline edit button — "of" is the
    // unit connector text. Multiple "of" strings exist elsewhere (e.g. the
    // RSVP "of N confirmed" line) so we scope to the cap edit button by
    // aria-label.
    expect(screen.getByLabelText(/planned budget/i)).toBeInTheDocument();
  });

  it("renders the cost-per-guest KPI (roi tile) when not eloping", async () => {
    globalThis.fetch = buildFetch({});
    renderPage("dashboard");

    // The 4th KPI tile is the ROI tile when guest target > 10.
    await waitFor(() => expect(screen.getByText(/cost \/ guest/i)).toBeInTheDocument());
  });

  it("renders all expected setup-checklist items", async () => {
    globalThis.fetch = buildFetch({});
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/setup checklist/i)).toBeInTheDocument());

    // Spot-check several rows from the derived task list. Some labels also
    // get echoed in the "Next step: {label}" CTA at the top, so we use
    // getAllByText for the labels that the next-action button can mirror.
    expect(screen.getAllByText(/lock the wedding date/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/define the budget/i)).toBeInTheDocument();
    expect(screen.getByText(/estimate the guest count/i)).toBeInTheDocument();
    expect(screen.getAllByText(/add at least one guest/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/plan a budget line/i)).toBeInTheDocument();
    expect(screen.getByText(/add a seating table/i)).toBeInTheDocument();
    expect(screen.getByText(/seat all confirmed guests/i)).toBeInTheDocument();
  });

  it("marks completed checklist items with a checkmark icon", async () => {
    // partner_b_id present → task_invite_partner is done (checkmark renders).
    // The DOM check is structural — done rows get an inline <svg> inside the
    // round badge; undone rows render an empty badge.
    globalThis.fetch = buildFetch({});
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/setup checklist/i)).toBeInTheDocument());
    // "Lock the wedding date" is done (wedding_date_goal is exact). Find its
    // <li> and confirm an svg checkmark exists inside.
    const dateRow = screen.getByText(/lock the wedding date/i).closest("li");
    expect(dateRow).not.toBeNull();
    const svg = dateRow?.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("renders the quick-links row with at least 4 destination pills", async () => {
    globalThis.fetch = buildFetch({});
    renderPage("dashboard");

    const heading = await screen.findByText(/shortcuts/i);
    // Scope the link count to the quick-links section that follows the heading
    // so we don't accidentally match navigation links elsewhere on the page.
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    const links = section?.querySelectorAll("a[aria-label]");
    expect(links?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("shows the date-changed banner when previous_wedding_date is set", async () => {
    const couple = makeCouple({
      previous_wedding_date: "2027-05-01",
      wedding_date: "2027-06-12",
      wedding_date_goal: {
        kind: "exact",
        exact_date: "2027-06-12",
        target_year: 2027,
        target_month: 6,
        target_season: null,
      },
    });
    globalThis.fetch = buildFetch({ couple });
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/you rescheduled/i)).toBeInTheDocument());
  });

  it("Notify-guests button on the date-changed banner calls the notify-date-change endpoint", async () => {
    const calls: string[] = [];
    const couple = makeCouple({
      previous_wedding_date: "2027-05-01",
      wedding_date: "2027-06-12",
    });
    globalThis.fetch = buildFetch({
      couple,
      guests: [makeGuest({ id: 1, email: "g@x.test", rsvp_status: "yes" })],
      calls,
    });
    renderPage("dashboard");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /notify guests/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /notify guests/i }));

    // Confirm dialog pops up first — click Send to fire the fan-out.
    const sendBtn = await screen.findByRole("button", { name: /^send$/i });
    fireEvent.click(sendBtn);

    await waitFor(() =>
      expect(calls.some((c) => c.includes("/api/couples/current/notify-date-change"))).toBe(true),
    );
  });

  it("Dismiss button on the date-changed banner calls dismiss-date-change", async () => {
    const calls: string[] = [];
    const couple = makeCouple({
      previous_wedding_date: "2027-05-01",
      wedding_date: "2027-06-12",
    });
    globalThis.fetch = buildFetch({ couple, calls });
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/you rescheduled/i)).toBeInTheDocument());
    // The X button has a localized aria-label; we look it up via aria-label.
    const dismissBtn = screen.getByLabelText(/dismiss/i);
    fireEvent.click(dismissBtn);

    await waitFor(() =>
      expect(calls.some((c) => c.includes("/api/couples/current/dismiss-date-change"))).toBe(true),
    );
  });

  it("renders day-of mode jumbo when daysUntil <= 1", async () => {
    // Set wedding date to today so the dayOfMode branch engages.
    const today = new Date().toISOString().slice(0, 10);
    const couple = makeCouple({
      wedding_date: today,
      wedding_date_goal: {
        kind: "exact",
        exact_date: today,
        target_year: Number(today.slice(0, 4)),
        target_month: Number(today.slice(5, 7)),
        target_season: null,
      },
    });
    globalThis.fetch = buildFetch({ couple });
    renderPage("dashboard");

    // Day-of panel headline copy:
    await waitFor(() => expect(screen.getByText(/it's the big day/i)).toBeInTheDocument());
    // And the planning-mode KPI grid is swapped out for the jumbo today/tomorrow label.
    expect(screen.getByText(/^today$/i)).toBeInTheDocument();
  });

  it("Place-cards print button (day-of) calls /api/print/place-cards", async () => {
    const calls: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const couple = makeCouple({
      wedding_date: today,
      wedding_date_goal: {
        kind: "exact",
        exact_date: today,
        target_year: Number(today.slice(0, 4)),
        target_month: Number(today.slice(5, 7)),
        target_season: null,
      },
    });
    globalThis.fetch = buildFetch({ couple, calls });
    renderPage("dashboard");

    await waitFor(() =>
      expect(screen.getByText(/^place cards \(confirmed guests\)$/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText(/^place cards \(confirmed guests\)$/i));

    await waitFor(() => expect(calls.some((c) => c.includes("/api/print/place-cards"))).toBe(true));
  });

  // Regression (link-only invite): sending with an EMPTY email must NOT make
  // the invite-partner card vanish. The old visibility gate keyed off
  // `sentToEmail` (only set on the email path), so a link-only invite set
  // `invite` while that flag stayed null and the whole card disappeared before
  // the shareable-link block could render. The fix gates on a `justInvited`
  // session flag set on both paths.
  it("link-only Send invite keeps the card and reveals the shareable link", async () => {
    const calls: string[] = [];
    // No partner B and no invite in flight → the invite-partner card renders.
    const couple = makeCouple({ partner_b_id: null });
    globalThis.fetch = buildFetch({
      couple,
      invite: null,
      calls,
      // POST /api/couples/invites mints a link-only invite (no invited_email).
      override: (url, init) => {
        if (url.endsWith("/api/couples/invites") && init?.method === "POST") {
          return ok({
            invite: {
              id: 7,
              couple_id: 1,
              token: "TOK-LINKONLY",
              invited_email: null,
              invited_by_user_id: 1,
              consumed_at: null,
              expires_at: Date.now() + 7 * 86_400_000,
              created_at: Date.now(),
            },
          });
        }
        return null;
      },
    });
    renderPage("dashboard");

    // Card starts on its "Send invite" form.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /send invite/i })).toBeInTheDocument(),
    );

    // Send with the email field left empty → link-only path.
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    // The shareable-link block now renders (a "Copy link" button that only
    // exists inside the card), proving the card stayed visible, and the
    // email form is swapped out (no more "Send invite" button).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /send invite/i })).not.toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("POST") && c.endsWith("/api/couples/invites"))).toBe(
      true,
    );
  });

  it("email Send invite collapses the card into the slim 'sent to' pending banner", async () => {
    const couple = makeCouple({ partner_b_id: null });
    globalThis.fetch = buildFetch({
      couple,
      invite: null,
      override: (url, init) => {
        if (url.endsWith("/api/couples/invites") && init?.method === "POST") {
          return ok({
            invite: {
              id: 8,
              couple_id: 1,
              token: "TOK-EMAIL",
              invited_email: "partner@example.test",
              invited_by_user_id: 1,
              consumed_at: null,
              expires_at: Date.now() + 7 * 86_400_000,
              created_at: Date.now(),
            },
          });
        }
        return null;
      },
    });
    renderPage("dashboard");

    const emailInput = await screen.findByPlaceholderText(/partner@example/i);
    fireEvent.change(emailInput, { target: { value: "partner@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /send invite/i }));

    // The form collapses to the pending banner: "Sent to {email}" with a
    // waiting hint, and the email form is gone.
    await waitFor(() =>
      expect(screen.getByText(/sent to partner@example\.test/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/waiting for them to join/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send invite/i })).not.toBeInTheDocument();
  });

  // The pending banner must survive a reload (no session flag involved): a
  // pending email invite hydrated from the server keeps the card mounted.
  it("renders the pending banner on load when a sent email invite is hydrated", async () => {
    const couple = makeCouple({ partner_b_id: null });
    globalThis.fetch = buildFetch({
      couple,
      invite: {
        id: 9,
        couple_id: 1,
        token: "TOK-HYDRATED",
        invited_email: "future@example.test",
        invited_by_user_id: 1,
        consumed_at: null,
        expires_at: Date.now() + 7 * 86_400_000,
        created_at: Date.now(),
      },
    });
    renderPage("dashboard");

    await waitFor(() =>
      expect(screen.getByText(/sent to future@example\.test/i)).toBeInTheDocument(),
    );
    // It's the slim banner, not the full form.
    expect(screen.queryByRole("button", { name: /send invite/i })).not.toBeInTheDocument();
  });

  // Once the partner has actually joined (partner_b_id set), the invite
  // section is gone entirely: no card, no banner.
  it("drops the invite section once the partner has joined", async () => {
    globalThis.fetch = buildFetch({ couple: makeCouple({ partner_b_id: 2 }) });
    renderPage("dashboard");

    await waitFor(() => expect(screen.getByText(/setup checklist/i)).toBeInTheDocument());
    expect(document.getElementById("invite-partner")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ProfilePage
// ─────────────────────────────────────────────────────────────────────────

describe("<ProfilePage>", () => {
  it("renders the partner section with the partner card when one is linked", async () => {
    globalThis.fetch = buildFetch({
      partner: { full_name: "Béla Nagy", email: "bela@x.test", status: "joined" },
    });
    renderPage("profile");

    await waitFor(() => expect(screen.getByText(/your partner/i)).toBeInTheDocument());
    // Partner name appears in the card body — uniquely identifying the
    // partner row (vs the "in progress" pill text which is also re-used
    // elsewhere on the page for related lifecycle states).
    expect(screen.getByText(/béla nagy/i)).toBeInTheDocument();
  });

  it("renders the workspace switcher panel (always visible, even with 1 workspace)", async () => {
    globalThis.fetch = buildFetch({
      myCouples: {
        current_couple_id: 1,
        couples: [
          {
            couple_id: 1,
            display_name: "Anna & Béla",
            bride_name: "Anna",
            groom_name: "Béla",
            wedding_date: null,
            status: "active",
            role: "owner",
            joined_at: 0,
          },
          {
            couple_id: 2,
            display_name: "Brunch the day after",
            bride_name: "Anna",
            groom_name: "Béla",
            wedding_date: null,
            status: "active",
            role: "owner",
            joined_at: 1,
          },
        ],
      },
    });
    renderPage("profile");

    // "Event workspaces" heading + both workspace names must render.
    await waitFor(() => expect(screen.getByText(/event workspaces/i)).toBeInTheDocument());
    expect(screen.getByText(/brunch the day after/i)).toBeInTheDocument();
  });

  it("Pause workspace button opens the mini exit form, then the typed-phrase confirm", async () => {
    globalThis.fetch = buildFetch({});
    renderPage("profile");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /pause \+ delete in 30 days/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /pause \+ delete in 30 days/i }));

    // The exit form asks WHY before anything destructive is confirmed.
    await waitFor(() => expect(screen.getByText(/before you pause/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: /just taking a break/i }));
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    // Only now does the EntryDialog typed-phrase challenge open.
    await waitFor(() => expect(screen.getByText(/delete this workspace\?/i)).toBeInTheDocument());
  });

  it("Pause-confirm with correct phrase calls /api/couples/pause with the chosen reason", async () => {
    const calls: string[] = [];
    let sentReason: string | undefined;
    globalThis.fetch = buildFetch({
      calls,
      override: async (url, init) => {
        if (url.endsWith("/api/couples/pause") && init?.method === "POST") {
          sentReason = JSON.parse(String(init.body)).reason;
          return ok({
            pause_request: { id: 99, scheduled_delete_at: Date.now() + 30 * 86_400_000 },
          });
        }
        return null;
      },
    });
    renderPage("profile");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /pause \+ delete in 30 days/i }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /pause \+ delete in 30 days/i }));

    // Step 1: the mini exit form. Pick a reason and continue.
    await waitFor(() => expect(screen.getByText(/before you pause/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("radio", { name: /too expensive/i }));
    fireEvent.click(screen.getByRole("button", { name: /^continue$/i }));

    // Step 2: type the verify phrase (bride+groom uppercased = ANNABÉLA, the
    // accented É comes from Béla). The EntryDialog uses the phrase as the
    // placeholder; that's the most reliable selector here.
    const input = await screen.findByPlaceholderText("ANNABÉLA");
    fireEvent.change(input, { target: { value: "ANNABÉLA" } });
    fireEvent.click(screen.getByRole("button", { name: /delete account/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.startsWith("POST") && c.includes("/api/couples/pause"))).toBe(
        true,
      ),
    );
    // The canonical EN reason rides along on the request body.
    expect(sentReason).toBe("Too expensive");
  });

  it("Cancel-pause button appears when pause is active and calls pause/cancel", async () => {
    const calls: string[] = [];
    const scheduled = Date.now() + 25 * 86_400_000;
    globalThis.fetch = buildFetch({
      pause: {
        couple_status: "paused",
        pause_request: {
          id: 1,
          couple_id: 1,
          requested_by_user_id: 1,
          scheduled_delete_at: scheduled,
          status: "pending",
          reason: null,
          created_at: Date.now(),
          completed_at: null,
        },
      },
      calls,
    });
    renderPage("profile");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /cancel deletion/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel deletion/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.includes("/api/couples/pause/cancel"))).toBe(true),
    );
  });

  it("Data export (JSON) button calls /api/couples/export", async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetch({ calls });
    renderPage("profile");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download json/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /download json/i }));

    await waitFor(() => expect(calls.some((c) => c.includes("/api/couples/export"))).toBe(true));
  });

  it("Guest CSV export button calls /api/guests/csv", async () => {
    const calls: string[] = [];
    globalThis.fetch = buildFetch({ calls });
    renderPage("profile");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /download guest list/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /download guest list/i }));

    await waitFor(() => expect(calls.some((c) => c.includes("/api/guests/csv"))).toBe(true));
  });

  it("Leave workspace section renders 'owners can't leave' copy for partner_a (owner)", async () => {
    // Default user.id === couple.partner_a_id (both = 1) → owner branch
    globalThis.fetch = buildFetch({});
    renderPage("profile");

    await waitFor(() => expect(screen.getByText(/leave workspace/i)).toBeInTheDocument());
    // Owner copy: "...owners can't leave..."
    expect(screen.getByText(/owners can't leave/i)).toBeInTheDocument();
    // And no "Leave" button is rendered for the owner.
    expect(screen.queryByRole("button", { name: /^leave$/i })).not.toBeInTheDocument();
  });

  it("Leave workspace shows the Leave button for partner_b (non-owner)", async () => {
    // Sign in as partner_b (user.id = 2 ≠ couple.partner_a_id = 1).
    globalThis.fetch = buildFetch({
      user: makeUser({ id: 2, email: "bela@x.test", full_name: "Béla" }),
    });
    renderPage("profile");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^leave$/i })).toBeInTheDocument(),
    );
  });
});
