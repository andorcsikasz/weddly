// The anonymous vendor page's payload, built field by field.
//
// See `PublicVendorProfile` for why this is an allowlist rather than the detail
// with a few things blanked. Pure on purpose: it takes the detail the signed-in
// page already builds (so the upstream rules, like the imported-profile teaser
// that empties an unclaimed profile's photos and bio, keep applying) and copies
// out exactly what a stranger may see.

import type { PublicVendorProfile, SupplierDetail } from "../../../shared/suppliers";

export function toPublicVendorProfile(detail: SupplierDetail): PublicVendorProfile {
  return {
    id: detail.id,
    name: detail.name,
    company_name: detail.company_name ?? null,
    category: detail.category,
    city: detail.city,
    country: detail.country,
    blurb_hu: detail.blurb_hu,
    blurb_en: detail.blurb_en,
    gallery_urls: detail.gallery_urls ?? [],
    ...(detail.gallery_positions_y ? { gallery_positions_y: detail.gallery_positions_y } : {}),
    claimed: detail.vendor_account_id !== null,
    listing_complete: detail.listing_complete,
    reviews_summary: detail.reviews_summary,
  };
}
