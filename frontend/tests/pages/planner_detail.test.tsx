// Full-page planner profile (/app/planners/:plannerUserId). Registered planner
// ACCOUNTS get the same editorial detail page vendors have (name, about, styles,
// references) fed by the couple-scoped directory-detail endpoint, with the
// "Felkérés" consent CTA. Guards that the page fetches + renders the planner's
// fields and that the CTA posts an invite and flips to the "invited" state.

import type { PlannerDirectoryDetail } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlannerDetailPage from "@/pages/PlannerDetailPage";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

type Method = "GET" | "POST" | "DELETE";
type Call = { url: string; method: Method };

const realFetch = globalThis.fetch;
const calls: Call[] = [];
let detail: PlannerDirectoryDetail;
let reviewsPayload: {
  items: unknown[];
  can_review: boolean;
  already_reviewed: boolean;
  nextCursor: null;
};

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
    calls.push({ url, method });
    if (url.includes("/reviews")) return jsonResponse(200, reviewsPayload);
    if (url.includes("/api/couples/planner-directory/")) return jsonResponse(200, detail);
    if (url.includes("/api/couples/planner-invite")) return jsonResponse(200, { ok: true });
    return jsonResponse(200, {});
  }) as typeof fetch;
}

async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/app/planners/5"]}>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>
            <ConfirmDialogProvider>
              <Routes>
                <Route path="/app/planners/:plannerUserId" element={children} />
              </Routes>
            </ConfirmDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  calls.length = 0;
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* happy-dom without storage — ignore */
  }
  detail = {
    planner_user_id: 5,
    business_name: "Andruskó Evelin EV",
    full_name: "Andruskó Evelin",
    city: "Budapest",
    country: "HU",
    bio: "Destination wedding planner with direct contact.",
    website: "https://evelin.example",
    styles: ["classic", "outdoor", "elegant"],
    km_radius: 150,
    weddings_per_year: 20,
    avatar_url: null,
    verified: true,
    // No Weddly Points tier badge on this fixture: `tier` is null below the
    // rung that earns one, which is where a planner with no points sits.
    tier: null,
    // Business name, city, bio and styles are all filled in below, so the
    // badge this fixture stands for is the solid one.
    profile_complete: true,
    link_status: "none",
    availability: "Free dates for 2027 Q3.",
    reference_links: ["https://www.instagram.com/evelineskuvoszervezes"],
    portfolio: [
      {
        id: 1,
        title: "Villa wedding",
        description: "",
        image_url: null,
        sort_order: 0,
        created_at: 0,
      },
    ],
    phone: "+36 30 123 4567",
    email: "evelin@example.com",
    address: "Budapest, Fő utca 1.",
    packages: [],
    unavailable_dates: [],
    next_available: null,
    wedding_date: null,
    rating: null,
    reviews_count: 0,
    reviews_summary: {
      avg_rating: null,
      reviews_count: 0,
      histogram: [0, 0, 0, 0, 0],
      top_tags: [],
    },
  };
  reviewsPayload = { items: [], can_review: false, already_reviewed: false, nextCursor: null };
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("PlannerDetailPage", () => {
  it("renders the planner profile like a vendor detail page", async () => {
    render(
      <Providers>
        <PlannerDetailPage />
      </Providers>,
    );
    await flush();

    // It fetched the couple-scoped planner detail by id.
    expect(calls.some((c) => c.url.includes("/api/couples/planner-directory/5"))).toBe(true);

    // Name (as an h1), about, availability, a style tag, and the reference link.
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Andruskó Evelin EV");
    expect(
      screen.getByText("Destination wedding planner with direct contact."),
    ).toBeInTheDocument();
    expect(screen.getByText("Free dates for 2027 Q3.")).toBeInTheDocument();
    expect(screen.getByText("Classic")).toBeInTheDocument(); // style_classic
    expect(
      screen.getAllByText("https://www.instagram.com/evelineskuvoszervezes").length,
    ).toBeGreaterThan(0);
    // The old raw-key bug must be gone.
    expect(screen.queryByText("common.close")).not.toBeInTheDocument();
  });

  it("shows the star rating and the reviews a planner has collected", async () => {
    // Three published reviews is the cold-start floor, so this is the first
    // state in which an average may be shown at all.
    detail.rating = 4.3;
    detail.reviews_count = 3;
    detail.reviews_summary = {
      avg_rating: 4.3,
      reviews_count: 3,
      histogram: [0, 0, 1, 0, 2],
      top_tags: [],
    };
    reviewsPayload = {
      items: [
        {
          id: 11,
          supplier_id: "planner:5",
          rating: 5,
          body: "She kept the whole day calm.",
          tags: [],
          amount_paid: null,
          amount_currency: null,
          amount_note: null,
          author: { display_name: "Mia & Lucas" },
          editorial: false,
          verified: true,
          published: true,
          own: false,
          created_at: 1_760_000_000_000,
        },
      ],
      can_review: false,
      already_reviewed: false,
      nextCursor: null,
    };

    render(
      <Providers>
        <PlannerDetailPage />
      </Providers>,
    );
    await flush();

    // It asked the planner-scoped review endpoint, not a supplier one.
    expect(calls.some((c) => c.url.includes("/api/planners/5/reviews"))).toBe(true);
    // The header average, and the review itself.
    expect(screen.getAllByText("4.3").length).toBeGreaterThan(0);
    expect(screen.getByText("She kept the whole day calm.")).toBeInTheDocument();
  });

  it("the Felkérés CTA posts an invite and flips to the invited state", async () => {
    render(
      <Providers>
        <PlannerDetailPage />
      </Providers>,
    );
    await flush();

    // "Invite" (planner_directory.connect) appears twice: header + sidebar.
    const inviteButtons = screen.getAllByRole("button", { name: "Invite" });
    expect(inviteButtons.length).toBeGreaterThan(0);
    fireEvent.click(inviteButtons[0]!);

    await waitFor(() =>
      expect(
        calls.some((c) => c.method === "POST" && c.url.includes("/api/couples/planner-invite")),
      ).toBe(true),
    );
    // After inviting, the CTA reflects the pending "Invite sent" state.
    await waitFor(() => expect(screen.getAllByText("Invite sent").length).toBeGreaterThan(0));
  });
});
