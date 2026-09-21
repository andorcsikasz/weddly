// The vendor photo viewer in its two shapes. `strip` (hero + thumbnail rail) is
// what the public page has always used and must not change; `mosaic` is the
// profile-page shape: 1 big tile beside 2 stacked ones, an "all photos" button
// and a lightbox that any tile opens at its own index.

import { beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { VendorGallery } from "@/components/VendorGallery";
import { I18nProvider } from "@/lib/i18n";

const photos = (n: number) => Array.from({ length: n }, (_, i) => `/p${i + 1}.jpg`);

function gallery(n: number, layout?: "strip" | "mosaic") {
  return render(
    <I18nProvider>
      <VendorGallery
        images={photos(n)}
        name="Fényes Fotó"
        layout={layout}
        emptyState={<div>no photos</div>}
      />
    </I18nProvider>,
  );
}

const tileImages = (container: HTMLElement) => container.querySelectorAll("img");

beforeEach(() => {
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    /* happy-dom without storage, ignore */
  }
});

describe("VendorGallery mosaic", () => {
  it("shows three tiles for a full portfolio and an all-photos button", () => {
    const { container } = gallery(6, "mosaic");
    expect(tileImages(container)).toHaveLength(3);
    const all = screen.getByText("All photos (6)");
    // More photos than tiles: the button is there on desktop too.
    expect(all.className).not.toContain("sm:hidden");
  });

  it("opens the lightbox at the tile that was clicked", () => {
    const { container } = gallery(6, "mosaic");
    expect(screen.queryByText(/ \/ 6$/)).toBeNull();

    fireEvent.click(tileImages(container)[1]?.closest("button") as HTMLElement);
    expect(screen.getByText("2 / 6")).toBeTruthy();
  });

  it("opens the lightbox at the first photo from the all-photos button", () => {
    gallery(6, "mosaic");
    fireEvent.click(screen.getByText("All photos (6)"));
    expect(screen.getByText("1 / 6")).toBeTruthy();
  });

  it("arrow keys walk the portfolio inside the lightbox", () => {
    gallery(4, "mosaic");
    fireEvent.click(screen.getByText("All photos (4)"));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("2 / 4")).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    // Wraps, so the arrows never dead-end.
    expect(screen.getByText("4 / 4")).toBeTruthy();
  });

  it("splits two photos and lets one run full width", () => {
    const two = gallery(2, "mosaic");
    expect(tileImages(two.container)).toHaveLength(2);
    two.unmount();

    const one = gallery(1, "mosaic");
    expect(tileImages(one.container)).toHaveLength(1);
    // Nothing else to see, so no all-photos button.
    expect(screen.queryByText(/All photos/)).toBeNull();
  });

  it("keeps the all-photos button phone-only while every photo is already on screen", () => {
    gallery(3, "mosaic");
    expect(screen.getByText("All photos (3)").className).toContain("sm:hidden");
  });

  it("falls back to the placeholder without photos", () => {
    gallery(0, "mosaic");
    expect(screen.getByText("no photos")).toBeTruthy();
  });
});

describe("VendorGallery strip (the public page's layout)", () => {
  it("is still a hero with a thumbnail rail, and no all-photos button", () => {
    const { container } = gallery(4);
    // One hero + four thumbnails.
    expect(tileImages(container)).toHaveLength(5);
    expect(screen.queryByText(/All photos/)).toBeNull();
    expect(screen.getByLabelText("Show photo 3")).toBeTruthy();
  });

  it("zooms into the lightbox from the hero", () => {
    gallery(4);
    fireEvent.click(screen.getByLabelText("View full size"));
    expect(screen.getByText("1 / 4")).toBeTruthy();
    // The photo's own arrow and the lightbox's share a label; the lightbox is last.
    fireEvent.click(screen.getAllByLabelText("Next photo").at(-1) as HTMLElement);
    expect(screen.getByText("2 / 4")).toBeTruthy();
  });
});
