// The browse teaser's card: a real photo when there is one, the category
// glyph when there isn't. `hero_image_url` can point at a listing whose file
// no longer exists (a stale reference on an unclaimed/curated row) — that
// used to render the browser's broken-image glyph on an otherwise beige tile.
// The fix: an <img> load failure falls back to the same category glyph a
// missing hero already renders, same pattern as WishlistPicture.

import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VendorCard } from "@/pages/VendorBrowsePage";

function draw(over: Partial<React.ComponentProps<typeof VendorCard>> = {}) {
  return render(
    <MemoryRouter>
      <VendorCard
        id="v1"
        name="Test Vendor"
        city="Budapest"
        category="photography"
        categoryLabel="Photography"
        hero="/uploads/listings/v1/hero.jpg"
        verified={false}
        listingComplete={false}
        {...over}
      />
    </MemoryRouter>,
  );
}

// The card always carries one <svg> of its own — the ArrowUpRight
// hover-affordance in the corner, regardless of photo state — so "a glyph
// rendered" is asserted as a SECOND svg, not merely one.

describe("<VendorCard>", () => {
  it("shows the photo when a hero is set", () => {
    const { container } = draw();
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/uploads/listings/v1/hero.jpg");
    expect(container.querySelectorAll("svg").length).toBe(1);
  });

  it("falls back to the category glyph when there is no hero", () => {
    const { container } = draw({ hero: null });
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("svg").length).toBe(2);
  });

  it("falls back to the category glyph when the hero fails to load", () => {
    const { container } = draw();
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("svg").length).toBe(2);
  });
});
