// The hero's big poster date must FOLLOW the couple's chosen date format --
// the /app/design picker visibly changes the site, not just the printables
// (regression: it used to render numeric_dot unconditionally).

import { beforeAll, expect, it } from "bun:test";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import { WeddingSiteView } from "@/components/WeddingSiteView";
import { DEFAULT_DESIGN, resolveDesign, toPublicDesign } from "@shared/design";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";

beforeAll(async () => {
  await _preloadHuForTests();
});

function view(dateFormat: string): PublicWeddingWebsiteView {
  return {
    couple_slug: "X",
    couple_display_name: "Mia & Lucas",
    bride_name: "Mia",
    groom_name: "Lucas",
    wedding_date: "2026-09-12",
    ceremony_kind: "both",
    venue_name: null,
    venue_city: null,
    cover_image_url: null,
    guest_page_intro: null,
    useful_info: null,
    location_lat: null,
    location_lng: null,
    location_radius_km: null,
    post_rsvp_content: null,
    schedule: [],
    wishlist: null,
    design: toPublicDesign(resolveDesign({ ...DEFAULT_DESIGN, dateFormat: dateFormat as never })),
    fetched_at: 0,
  };
}

const cases: [string, string][] = [
  ["numeric_dot", "2026 · 09 · 12"],
  ["numeric_md", "09 · 12"],
  ["slash", "2026/09/12"],
  ["roman", "12 · IX · MMXXVI"],
  ["long", "2026. szeptember 12."],
];

for (const [slug, expected] of cases) {
  it(`hero date follows ${slug}`, () => {
    const { unmount } = render(
      <I18nProvider>
        <MemoryRouter>
          <WeddingSiteView view={view(slug)} household={null} tier="public" locale="hu" />
        </MemoryRouter>
      </I18nProvider>,
    );
    expect(screen.getByText(expected)).toBeInTheDocument();
    unmount();
  });
}
