// The admin catalogue's filter bar: the gap chips.
//
// The no-email filter existed for months and nobody could find it, because it
// was one option inside a select labelled "Kapcsolat". These tests pin the two
// properties that fix it and are easy to break later: the chip is on screen
// carrying its own count before anything is clicked, and one tap sends
// `gaps=` to the server rather than silently filtering client-side.

import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/components/ui/AppProviders";
import { I18nProvider } from "@/lib/i18n";

const calls: Array<{ gaps?: string[]; contact?: string }> = [];

const ROWS = [
  {
    id: "a",
    community_id: null,
    source: "curated",
    name: "Nincs semmi Kft.",
    category: "venue",
    city: "Budapest",
    address: "",
    website: "",
    contact_email: null,
    contact_phone: null,
    price_band: null,
    status: "active",
    submitter_email: null,
    submitter_type: null,
    submitter_last_seen_at: null,
    created_at: null,
    hero_image_url: null,
    analytics: {
      views_total: 0,
      views_30d: 0,
      views_7d: 0,
      impressions_total: 0,
      impressions_30d: 0,
      website_clicks_total: 0,
      website_clicks_30d: 0,
      phone_clicks_total: 0,
      last_event_at: null,
    },
  },
];

mock.module("@/lib/endpoints", () => ({
  adminSupplierApi: {
    listDirectory: async (filters: { gaps?: string[]; contact?: string }) => {
      calls.push({ gaps: filters.gaps, contact: filters.contact });
      return {
        suppliers: ROWS,
        facets: {
          base_total: 1004,
          gaps: { no_email: 412, no_phone: 87, no_website: 6, no_hero: 233 },
        },
        filters,
      };
    },
  },
}));

const { SupplierDirectoryView } = await import("@/components/admin/SupplierDirectoryView");

function renderView() {
  return render(
    <I18nProvider>
      <AppProviders>
        <SupplierDirectoryView />
      </AppProviders>
    </I18nProvider>,
  );
}

describe("supplier catalogue filter bar", () => {
  it("shows the no-email chip with its count before anything is clicked", async () => {
    calls.length = 0;
    renderView();

    // The whole point: the number is on screen unprompted, so "how many
    // listings can no outbound flow reach" needs no clicking to answer.
    const chip = await screen.findByRole("button", { name: /no email/i });
    expect(chip.textContent).toContain("412");
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    // Every gap gets a chip, not just the one that had a home in the old select.
    for (const label of [/no phone/i, /no website/i, /no photo/i]) {
      expect(await screen.findByRole("button", { name: label })).toBeTruthy();
    }
  });

  it("toggling the chip asks the server for that gap, and untoggling clears it", async () => {
    calls.length = 0;
    renderView();
    const chip = await screen.findByRole("button", { name: /no email/i });

    chip.click();
    await waitFor(() => expect(calls.at(-1)?.gaps).toEqual(["no_email"]));
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));

    chip.click();
    await waitFor(() => expect(calls.at(-1)?.gaps).toBeUndefined());
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("false"));
  });

  it("keeps the counts stable while a gap is applied", async () => {
    calls.length = 0;
    renderView();
    const chip = await screen.findByRole("button", { name: /no email/i });
    chip.click();
    // The server measures facets before the gap toggles, so the chip must not
    // start reporting the size of its own result set.
    await waitFor(() => expect(chip.textContent).toContain("412"));
  });
});
