// A wish card shows a real picture or a mark somebody chose. The ladder is
// photo → the shop's own logo → the couple's icon, and each rung has to look
// like itself: these lock the framing, because the failure they replace is the
// silent one. A brand mark cropped to fill (the photo treatment) is a wall of
// colour with half a letter in it, and it renders with no error anywhere.
//
// The rung below them used to be hand-drawn line art picked from the title by
// keyword and hash — pretty, but a guess the couple could not overrule. Owner
// direction, 2026-08-03: never a drawn icon, always the real thing or one the
// couple picked.

import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import {
  defaultWishlistIcon,
  WISHLIST_ICON_CHOICES,
  WishlistPicture,
  type WishlistPictureSubject,
} from "@/components/WishlistPicture";
import { WISHLIST_ICON_SLUGS } from "@shared/wishlist";

function subject(over: Partial<WishlistPictureSubject> = {}): WishlistPictureSubject {
  return {
    title: "Espresso machine",
    kind: "gift",
    image_url: null,
    image_kind: null,
    icon: null,
    ...over,
  };
}

function draw(over: Partial<WishlistPictureSubject> = {}) {
  return render(<WishlistPicture item={subject(over)} />);
}

describe("<WishlistPicture>", () => {
  it("crops a product photo to fill the tile", () => {
    const { container } = draw({
      image_url: "/uploads/couples/1/wishlist/a.jpg",
      image_kind: "photo",
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/uploads/couples/1/wishlist/a.jpg");
    expect(img?.className).toContain("object-cover");
  });

  it("contains a shop's logo instead, on the paper ground", () => {
    // The whole reason `image_kind` exists. object-cover here would blow an
    // IKEA mark up until only a corner of it is on the card.
    const { container } = draw({
      image_url: "/uploads/couples/1/wishlist/b.png",
      image_kind: "logo",
    });
    const img = container.querySelector("img");
    expect(img?.className).toContain("object-contain");
    expect(img?.className).not.toContain("object-cover");
    // Padded, so the mark sits ON the tile rather than bleeding off it.
    expect(container.innerHTML).toContain("p-[16%]");
  });

  it("falls back to an icon, not a broken tile, when there is no picture", () => {
    const { container } = draw();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("draws the couple's chosen icon over the kind's default", () => {
    // Same tile, two different glyphs — the assertion is that the choice
    // reaches the drawing at all, which is what makes the picker real.
    const chosen = draw({ icon: "Plane" }).container.querySelector("svg")?.outerHTML;
    const fallback = draw().container.querySelector("svg")?.outerHTML;
    expect(chosen).toBeTruthy();
    expect(chosen).not.toBe(fallback);
  });

  it("gives a request a heart and a gift a parcel when nobody has chosen", () => {
    expect(defaultWishlistIcon("request")).toBe("Heart");
    expect(defaultWishlistIcon("gift")).toBe("Gift");
    const request = draw({ kind: "request" }).container.querySelector("svg")?.outerHTML;
    const gift = draw({ kind: "gift" }).container.querySelector("svg")?.outerHTML;
    expect(request).not.toBe(gift);
  });

  it("has a glyph for every slug the server accepts", () => {
    // An icon the API stores and the client cannot draw renders as nothing at
    // all, which is the one failure mode with no visible symptom in review.
    expect(WISHLIST_ICON_CHOICES.map((c) => c.slug)).toEqual([...WISHLIST_ICON_SLUGS]);
    for (const { slug, Icon } of WISHLIST_ICON_CHOICES) {
      expect(typeof Icon, slug).not.toBe("undefined");
    }
  });
});
