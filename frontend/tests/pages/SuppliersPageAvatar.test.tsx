// The supplier directory's round avatar slot: a real photo when there is
// one, the monogram/category glyph when there isn't. `heroUrl` can point at a
// listing whose file no longer exists (a stale reference on an
// unclaimed/curated row) — that used to render the browser's broken-image
// glyph inside an otherwise clean round slot. Same fix and pattern as
// VendorCard on /suppliers/browse: an <img> load failure falls back to the
// icon/monogram instead of staying on the broken src.

import { describe, expect, it } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { Avatar } from "@/pages/SuppliersPage";

describe("<Avatar>", () => {
  it("shows the photo when a hero is set", () => {
    const { container } = render(
      <Avatar name="Test Vendor" heroUrl="/uploads/listings/v1/hero.jpg" />,
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/uploads/listings/v1/hero.jpg");
  });

  it("falls back to the monogram when there is no hero", () => {
    const { container } = render(<Avatar name="Test Vendor" heroUrl={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("T");
  });

  it("falls back to the monogram when the hero fails to load", () => {
    const { container } = render(
      <Avatar name="Test Vendor" heroUrl="/uploads/listings/v1/hero.jpg" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    if (img) fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("T");
  });
});
