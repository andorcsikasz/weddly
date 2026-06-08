// Focused tests for the shared <WeddingSiteView> — the single presentational
// component behind BOTH the live public wedding page (/w/:slug) and the
// couple's editor preview (/app/guest-page). The whole point of unifying them
// is that the editor preview is the SAME layout as what guests see, so these
// tests pin the two behaviours that diverge by mode:
//
//   - live mode: real content, a navigating RSVP <a>, no ghosts/edit affordances;
//   - preview mode: dashed "ghost" placeholders + click-to-edit on empty
//     sections, a "locked" eyebrow on the post-RSVP block, and an inert
//     (non-navigating) RSVP CTA so clicking it doesn't leave the editor.
//
// The component only needs the i18n provider + a Router (it renders <Link>).

import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { _preloadHuForTests, I18nProvider } from "@/lib/i18n";
import { WeddingSiteView } from "@/components/WeddingSiteView";
import { DEFAULT_DESIGN, toPublicDesign } from "@shared/design";
import type { PublicWeddingWebsiteView } from "@shared/wedding_website";

beforeAll(async () => {
  await _preloadHuForTests();
});

beforeEach(() => {
  // Translations come from the I18nProvider context (the `locale` prop only
  // drives date/money formatting), so pin HU here — these tests assert on HU
  // ghost copy. Mirrors the RsvpCheckinPage suite's setup.
  try {
    localStorage.setItem("weddly.locale", "hu");
    localStorage.setItem("weddly.currency", "HUF");
  } catch {
    // happy-dom always has localStorage; defensive only.
  }
});

/** A fully-populated public view — every optional section present so the live
 *  render exercises the real (non-ghost) branch of each block. */
function filledView(overrides: Partial<PublicWeddingWebsiteView> = {}): PublicWeddingWebsiteView {
  return {
    couple_slug: "MIALUCAS",
    couple_display_name: "Mia & Lucas",
    bride_name: "Mia",
    groom_name: "Lucas",
    wedding_date: "2026-09-12",
    ceremony_kind: "both",
    venue_name: "Sári Udvar",
    venue_city: "Dunakiliti",
    cover_image_url: "https://example.test/cover.jpg",
    guest_page_intro: "Köszönjük, hogy velünk ünnepeltek!",
    useful_info: "Parkolás: az udvarban.",
    location_lat: null,
    location_lng: null,
    location_radius_km: 5,
    post_rsvp_content: null,
    schedule: [
      {
        id: 1,
        label: "Ceremónia",
        starts_at_minutes: 16 * 60,
        duration_minutes: 30,
        location: "Kert",
        notes: null,
        is_key_moment: false,
      },
    ],
    wishlist: null,
    design: toPublicDesign(DEFAULT_DESIGN),
    fetched_at: 0,
    ...overrides,
  };
}

/** An empty view — every editor-owned field null + no schedule, so preview
 *  mode renders a ghost for each section. */
function emptyView(): PublicWeddingWebsiteView {
  return filledView({
    wedding_date: null,
    venue_name: null,
    venue_city: null,
    cover_image_url: null,
    guest_page_intro: null,
    useful_info: null,
    schedule: [],
  });
}

function renderView(node: React.ReactElement) {
  return render(
    <MemoryRouter>
      <I18nProvider>{node}</I18nProvider>
    </MemoryRouter>,
  );
}

describe("WeddingSiteView — live mode", () => {
  it("renders the couple, schedule and intro, with a navigating RSVP link", () => {
    renderView(
      <WeddingSiteView
        view={filledView()}
        household={null}
        tier="public"
        locale="hu"
        rsvpHref="/rsvp?couple=MIALUCAS"
      />,
    );

    expect(screen.getByRole("heading", { name: "Mia & Lucas", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Ceremónia")).toBeInTheDocument();
    expect(screen.getByText(/köszönjük, hogy velünk/i)).toBeInTheDocument();
    expect(screen.getByText("Sári Udvar")).toBeInTheDocument();

    // RSVP CTA is a real navigating link on the live page.
    const cta = screen.getByRole("link", { name: /RSVP/ });
    expect(cta.getAttribute("href")).toContain("/rsvp?couple=MIALUCAS");
  });

  it("shows no ghost placeholders or edit affordances in live mode", () => {
    renderView(<WeddingSiteView view={emptyView()} household={null} tier="public" locale="hu" />);
    // None of the ghost titles render when not in preview.
    expect(screen.queryByText("Borítókép")).toBeNull();
    expect(screen.queryByText(/írj köszöntőt/i)).toBeNull();
    // The "unlocks after RSVP" eyebrow is preview-only.
    expect(screen.queryByText(/visszajelzése után jelenik meg/i)).toBeNull();
  });
});

describe("WeddingSiteView — preview mode", () => {
  it("renders a ghost for every empty section plus the locked post-RSVP eyebrow", () => {
    renderView(
      <WeddingSiteView
        view={emptyView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
      />,
    );

    expect(screen.getByText("Borítókép")).toBeInTheDocument(); // cover ghost
    expect(screen.getByText(/írj köszöntőt a vendégeknek/i)).toBeInTheDocument(); // welcome ghost
    expect(screen.getByText(/add meg a nap menetét/i)).toBeInTheDocument(); // schedule ghost
    expect(screen.getByText(/add meg a hasznos tudnivalókat/i)).toBeInTheDocument(); // useful-info ghost
    expect(screen.getByText(/visszajelzése után jelenik meg/i)).toBeInTheDocument(); // locked eyebrow
  });

  it("renders the RSVP CTA as an inert (non-navigating) element in preview", () => {
    renderView(
      <WeddingSiteView
        view={emptyView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
      />,
    );
    // No navigating link in preview — the CTA is a decorative span.
    expect(screen.queryByRole("link", { name: /RSVP/ })).toBeNull();
  });

  it("clicking a ghost fires the matching edit callback", () => {
    const onEditIntro = mock(() => {});
    renderView(
      <WeddingSiteView
        view={emptyView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{ onEditIntro }}
      />,
    );
    // The welcome ghost is a role=button; click it and the callback fires.
    const welcome = screen.getByText(/írj köszöntőt a vendégeknek/i).closest('[role="button"]');
    expect(welcome).not.toBeNull();
    fireEvent.click(welcome as Element);
    expect(onEditIntro).toHaveBeenCalledTimes(1);
  });

  it("keeps real content (not a ghost) when a section is filled in preview", () => {
    renderView(
      <WeddingSiteView
        view={filledView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
      />,
    );
    expect(screen.getByText("Ceremónia")).toBeInTheDocument();
    expect(screen.queryByText(/add meg a nap menetét/i)).toBeNull(); // no schedule ghost
    expect(screen.getByText("Sári Udvar")).toBeInTheDocument();
    expect(screen.queryByText("Borítókép")).toBeNull(); // cover present, no ghost
  });
});
