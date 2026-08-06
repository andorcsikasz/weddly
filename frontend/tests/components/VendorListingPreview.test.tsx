// The couple's-eye preview beside the listing editor. Three rules are worth a
// test, because each one broke silently the last time it was wrong:
//
//   1. the capacity pill carries a drawn ICON, never an emoji — an emoji is a
//      different typeface picked by the OS and cannot take the pill's colour;
//   2. the verified check is ON the card, so the vendor watches their own badge
//      rather than reading a percentage about it somewhere else, and it is
//      OUTLINE until the checklist is finished;
//   3. a listing that arrives ALREADY complete does not celebrate. The
//      confetti + pop belong to the moment the badge fills, and replaying them
//      on every page load for work finished last week is a lie.

import { describe, expect, it, mock } from "bun:test";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";

const fireConfetti = mock(() => {});
mock.module("@/lib/confetti", () => ({ fireConfetti }));

const { default: VendorListingPreview } = await import("@/pages/vendor/VendorListingPreview");

function Providers({ children }: { children: ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

const BASE = {
  name: "Kúria Budán",
  heroUrl: null,
  city: "Budapest I.",
  priceBand: "2",
  capacityMin: "123",
  capacityMax: "155",
  blurb: "A quiet villa where the ceremony and the dinner share one garden.",
  complete: false,
};

/** Anything in the astral emoji planes, which is what the pill used to hold. */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe("VendorListingPreview", () => {
  it("draws the capacity as an icon, with no emoji anywhere on the card", () => {
    const { container } = render(<VendorListingPreview {...BASE} />, { wrapper: Providers });
    expect(container.textContent ?? "").not.toMatch(EMOJI);
    // The pill's own <svg>: lucide renders one per icon, and the badge lives in
    // the heading rather than the pill.
    const pill = screen.getByText(/123-155/).closest("p");
    expect(pill?.querySelector("svg")).not.toBeNull();
  });

  it("shows the verified check outlined while the listing is unfinished", () => {
    const { container } = render(<VendorListingPreview {...BASE} />, { wrapper: Providers });
    const badge = container.querySelector("h3 svg");
    expect(badge?.getAttribute("class")).toContain("fill-none");
    expect(badge?.getAttribute("class")).toContain("stroke-verified");
  });

  it("fills the check once the listing is complete", () => {
    const { container } = render(<VendorListingPreview {...BASE} complete />, {
      wrapper: Providers,
    });
    const badge = container.querySelector("h3 svg");
    expect(badge?.getAttribute("class")).toContain("fill-verified");
  });

  it("celebrates when the badge fills, and only then", () => {
    fireConfetti.mockClear();
    const { rerender } = render(<VendorListingPreview {...BASE} />, { wrapper: Providers });
    expect(fireConfetti).not.toHaveBeenCalled();

    rerender(<VendorListingPreview {...BASE} complete />);
    expect(fireConfetti).toHaveBeenCalledTimes(1);

    // An unrelated edit on an already-complete listing must not fire again.
    rerender(<VendorListingPreview {...BASE} complete city="Budapest II." />);
    expect(fireConfetti).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a listing that was already complete on arrival", () => {
    fireConfetti.mockClear();
    render(<VendorListingPreview {...BASE} complete />, { wrapper: Providers });
    expect(fireConfetti).not.toHaveBeenCalled();
  });
});
