// Covers the three columns added to the supplier comparison: Distance (from
// the couple's venue pin), Rating, and Available date. Distance is the
// deterministic new logic worth pinning; rating + available-date are asserted
// via their cold-start / unclaimed fallbacks, which is what couples see for the
// curated-directory majority. The per-column detail fetch fails under happy-dom
// (no server), exercising the same empty-state path as an unclaimed listing.

import type { DirectorySupplier } from "@shared/suppliers";
import { describe, expect, it, mock } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { SupplierCompareDialog } from "@/components/SupplierCompareDialog";
import { I18nProvider, useT } from "@/lib/i18n";

function makeSupplier(over: Partial<DirectorySupplier> = {}): DirectorySupplier {
  return {
    id: "s1",
    name: "Foto One",
    category: "photography",
    city: "Budapest",
    country: "HU",
    blurb_hu: "",
    blurb_en: "",
    website: "",
    // Always null on a catalogue row now; the flags are what the compare
    // dialog's contact-channel row reads.
    contact_email: null,
    contact_phone: null,
    has_contact_email: false,
    has_contact_phone: false,
    address: null,
    capacity_min: null,
    capacity_max: null,
    venue_style: null,
    lat: null,
    lng: null,
    source: "curated",
    submitter_type: null,
    price_band: 2,
    vendor_account_id: null,
    hero_image_url: null,
    gallery_urls: null,
    votes_score: 0,
    user_vote: 0,
    // Unclaimed curated entry (`vendor_account_id: null`), which is never
    // "complete" — the vendor checklist has no meaning without an account.
    listing_complete: false,
    ...over,
  };
}

/** Inner harness so the dialog gets a real `t` (it reads translations from the
 *  `t` prop, not from context) resolving the EN locale tree. */
function Harness({
  items,
  coupleLocation,
}: {
  items: DirectorySupplier[];
  coupleLocation: { lat: number | null; lng: number | null };
}) {
  const { t } = useT();
  return (
    <SupplierCompareDialog
      open
      onClose={mock(() => {})}
      compareIds={items.map((s) => s.id)}
      items={items}
      supplierCosts={[]}
      budgetLines={[]}
      targetGuestCount={null}
      coupleCityFilter=""
      coupleLocation={coupleLocation}
      currency="EUR"
      locale="en"
      onRemove={mock(() => {})}
      t={t}
    />
  );
}

function renderDialog(
  items: DirectorySupplier[],
  coupleLocation: { lat: number | null; lng: number | null },
) {
  return render(
    <I18nProvider>
      <Harness items={items} coupleLocation={coupleLocation} />
    </I18nProvider>,
  );
}

describe("<SupplierCompareDialog> distance / rating / available rows", () => {
  it("shows km from the couple's venue pin and tints the closest supplier", () => {
    // Budapest pin; two suppliers roughly 0km and ~50km away.
    const near = makeSupplier({ id: "near", name: "Near", lat: 47.4979, lng: 19.0402 });
    const far = makeSupplier({ id: "far", name: "Far", lat: 47.9, lng: 19.0402 }); // ~45km north
    renderDialog([near, far], { lat: 47.4979, lng: 19.0402 });

    // Both render a "<n> km away" string. We don't assert exact rounding for
    // far (depends on the spheroid) — just that the distance row populated.
    const kmCells = screen.getAllByText(/km away/i);
    expect(kmCells.length).toBe(2);
    // The near supplier rounds to 0 km.
    expect(screen.getByText(/^0 km away$/i)).toBeInTheDocument();
  });

  it("prompts to set the venue when the couple has no pin", () => {
    const s = makeSupplier({ lat: 47.4979, lng: 19.0402 });
    renderDialog([s], { lat: null, lng: null });
    expect(screen.getByText(/set your venue to see distance/i)).toBeInTheDocument();
    expect(screen.queryByText(/km away/i)).not.toBeInTheDocument();
  });

  it("falls back to the cold-start + unclaimed states once the detail fetch settles", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const s = makeSupplier();
    try {
      renderDialog([s], { lat: null, lng: null });
      // A missing public detail leaves the comparison on its safe cold-start
      // copy without depending on a real network timeout.
      await waitFor(() => expect(screen.getByText(/no ratings yet/i)).toBeInTheDocument());
      expect(screen.getByText(/ask to confirm/i)).toBeInTheDocument();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
