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
import { ToastProvider } from "@/components/ui";
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
      {/* The wishlist block calls useToast when a guest marks a gift, so the
          provider is part of the component's real environment, not just this
          test's scaffolding. */}
      <ToastProvider>
        <I18nProvider>{node}</I18nProvider>
      </ToastProvider>
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

  it("renders the wishlist inside the 'for confirmed guests' band at the confirmed tier", () => {
    const view = filledView({
      wishlist: [
        {
          id: 1,
          title: "Espresso machine",
          description: null,
          kind: "gift",
          target_amount_minor: null,
          currency: null,
          url: null,
          image_url: null,
          image_kind: null,
          icon: null,
          interest_count: 0,
          pledged_amount_minor: 0,
          viewer_has_interest: false,
          viewer_pledged_amount_minor: null,
        },
      ],
    });
    renderView(<WeddingSiteView view={view} household={null} tier="confirmed" locale="hu" />);
    expect(screen.getByText("Espresso machine")).toBeInTheDocument();
  });

  // The hero renders through one of two branches and they colour the names
  // differently on purpose, so both get pinned. Sharing one assertion is what
  // let the on-photo branch ship silently past this file.
  it("renders the photo-less hero name with color:inherit so dark-bg styles stay legible", () => {
    // Without inline color:inherit the global `h1 { color: ink.900 }` wins and a
    // dark-background style (e.g. Black Tie) paints the names dark-on-dark.
    renderView(
      <WeddingSiteView
        view={filledView({ cover_image_url: null })}
        household={null}
        tier="public"
        locale="hu"
      />,
    );
    const h1 = screen.getByRole("heading", { name: "Mia & Lucas", level: 1 });
    expect(h1.style.color).toBe("inherit");
  });

  it("paints the hero name white when it sits directly on a cover photo", () => {
    // With a cover photo the names sit ON it, so the colour follows the photo
    // rather than the palette: a dark theme over a dark photo would otherwise be
    // unreadable. Tone sampling can't run in happy-dom, and its null result
    // deliberately takes the dark-photo branch, the one that pairs with a scrim.
    renderView(<WeddingSiteView view={filledView()} household={null} tier="public" locale="hu" />);
    const h1 = screen.getByRole("heading", { name: "Mia & Lucas", level: 1 });
    expect(h1.style.color).toBe("#ffffff");
  });

  it("applies the couple's cover focal point as object-position on the hero image", () => {
    const { container } = renderView(
      <WeddingSiteView
        view={filledView({ cover_position_x: 20, cover_position_y: 80 })}
        household={null}
        tier="public"
        locale="hu"
      />,
    );
    const img = container.querySelector(
      'img[src="https://example.test/cover.jpg"]',
    ) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.style.objectPosition).toBe("20% 80%");
  });

  it("defaults the hero focal point to centre when position is unset", () => {
    const { container } = renderView(
      <WeddingSiteView view={filledView()} household={null} tier="public" locale="hu" />,
    );
    const img = container.querySelector(
      'img[src="https://example.test/cover.jpg"]',
    ) as HTMLImageElement;
    expect(img.style.objectPosition).toBe("50% 50%");
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

  it("shows the gift-list ghost in the 'for confirmed guests' band when the wishlist is empty", () => {
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
    // The post-RSVP slot is now the wishlist: its empty ghost, not the old
    // free-form "add post-RSVP details" prompt.
    expect(screen.getByText(/állítsd össze az ajándéklistát/i)).toBeInTheDocument();
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

describe("WeddingSiteView — inline editing", () => {
  it("clicking the intro turns it into a field and commits the new text on blur", () => {
    const intro = mock((_v: string) => {});
    renderView(
      <WeddingSiteView
        view={filledView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
        inlineEdit={{ intro }}
      />,
    );
    // The rendered intro text is click-to-edit.
    fireEvent.click(screen.getByText(/köszönjük, hogy velünk/i));
    const field = screen.getByLabelText(/üdvözlő szöveg/i);
    fireEvent.change(field, { target: { value: "Új köszöntő szöveg" } });
    fireEvent.blur(field);
    expect(intro).toHaveBeenCalledWith("Új köszöntő szöveg");
  });

  it("editing the venue name commits name + city together (no city loss)", () => {
    const venue = mock((_n: string, _c: string) => {});
    renderView(
      <WeddingSiteView
        view={filledView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
        inlineEdit={{ venue }}
      />,
    );
    fireEvent.click(screen.getByText("Sári Udvar"));
    const input = screen.getByLabelText(/helyszín neve/i);
    fireEvent.change(input, { target: { value: "Achilles Park Győr" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(venue).toHaveBeenCalledWith("Achilles Park Győr", "Dunakiliti");
  });

  it("Escape cancels an inline edit without committing", () => {
    const intro = mock((_v: string) => {});
    renderView(
      <WeddingSiteView
        view={filledView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
        inlineEdit={{ intro }}
      />,
    );
    fireEvent.click(screen.getByText(/köszönjük, hogy velünk/i));
    const field = screen.getByLabelText(/üdvözlő szöveg/i);
    fireEvent.change(field, { target: { value: "elvetve" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(intro).not.toHaveBeenCalled();
    // Original text is back, no field.
    expect(screen.getByText(/köszönjük, hogy velünk/i)).toBeInTheDocument();
  });

  it("renders an empty intro as an inline placeholder (not a scroll ghost) when inline editing is on", () => {
    const intro = mock((_v: string) => {});
    const venue = mock((_n: string, _c: string) => {});
    renderView(
      <WeddingSiteView
        view={emptyView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
        inlineEdit={{ intro, venue }}
      />,
    );
    // The scroll-to-form welcome ghost is gone…
    expect(screen.queryByText(/írj köszöntőt a vendégeknek/i)).toBeNull();
    // …replaced by a click-to-edit placeholder that commits in place.
    fireEvent.click(screen.getByText(/írj egy köszöntőt/i));
    const field = screen.getByLabelText(/üdvözlő szöveg/i);
    fireEvent.change(field, { target: { value: "Sziasztok!" } });
    fireEvent.blur(field);
    expect(intro).toHaveBeenCalledWith("Sziasztok!");
  });

  it("renders an empty venue as inline placeholders committing name + city as a pair", () => {
    const venue = mock((_n: string, _c: string) => {});
    renderView(
      <WeddingSiteView
        view={emptyView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{}}
        inlineEdit={{ venue }}
      />,
    );
    // The scroll-to-form venue ghost is gone.
    expect(screen.queryByText("Add meg a helyszínt")).toBeNull();
    // The empty name placeholder is click-to-edit; committing pairs it with the
    // (still empty) city, exercising the splitVenue(null, null) path.
    fireEvent.click(screen.getByText("Helyszín neve"));
    const input = screen.getByLabelText("Helyszín neve");
    fireEvent.change(input, { target: { value: "Sári Udvar" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(venue).toHaveBeenCalledWith("Sári Udvar", "");
  });

  it("without an inlineEdit setter the section stays a scroll-to-field shortcut", () => {
    const onEditIntro = mock(() => {});
    renderView(
      <WeddingSiteView
        view={filledView()}
        household={null}
        tier="public"
        locale="hu"
        isPreview
        edit={{ onEditIntro }}
      />,
    );
    // No inline field; clicking the intro band fires the jump-to-field handler.
    fireEvent.click(screen.getByText(/köszönjük, hogy velünk/i));
    expect(screen.queryByLabelText(/üdvözlő szöveg/i)).toBeNull();
    expect(onEditIntro).toHaveBeenCalledTimes(1);
  });
});
