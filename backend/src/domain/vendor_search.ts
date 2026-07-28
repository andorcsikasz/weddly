// Public typeahead behind the landing-page directory search. A visitor types
// one box; the answer can be a business, a town, or a kind of vendor.
//
// This module answers the first two. CATEGORIES are matched by the client:
// their names exist in three languages in the frontend locale tree and nowhere
// else, so shipping them here would mean a second copy that drifts. Instead we
// return the category census (which categories are browsable, and how big they
// are) and the client scores it with the same `searchScore` we use below —
// which is why both sides can merge into one ranked list of three.

import {
  cityDisplayName,
  foldForSearch,
  type PublicVendorSearchResult,
  type PublicVendorSuggestion,
  searchScore,
  type SupplierCategory,
  VENDOR_SEARCH_LIMIT,
  VENDOR_SEARCH_MIN_CHARS,
} from "@shared/suppliers";
import { listSearchCandidates } from "./listings";

/** A town with several listings is a better destination than one with a single
 *  entry, but the bonus is capped so popularity never beats a real name match.
 *  ln(count) tops out around 3 for a 20-listing city. */
function volumeBonus(count: number): number {
  return Math.min(6, Math.log(count + 1) * 2);
}

export function searchPublicVendors(rawQuery: string): PublicVendorSearchResult {
  const q = foldForSearch(rawQuery);
  const rows = listSearchCandidates();

  // The census is query-independent: every category with something browsable
  // behind it. Photographed only, matching what /vendors/browse will actually
  // render once the visitor lands there.
  const catCounts = new Map<SupplierCategory, number>();
  for (const r of rows) {
    if (!r.has_photo) continue;
    catCounts.set(r.category, (catCounts.get(r.category) ?? 0) + 1);
  }
  const categories = [...catCounts]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  if (q.length < VENDOR_SEARCH_MIN_CHARS) return { suggestions: [], categories };

  const suggestions: PublicVendorSuggestion[] = [];

  for (const r of rows) {
    const base = searchScore(r.name, q);
    if (base === 0) continue;
    // Registered vendors first among equals (they can actually answer), then
    // the ones the outside world rates well, then the ones we can show a photo
    // of. All three are tiny next to a match-quality tier.
    const bonus = (r.verified ? 4 : 0) + (r.google_rating ?? 0) * 0.6 + (r.has_photo ? 1 : 0);
    suggestions.push({
      kind: "vendor",
      score: base + bonus,
      label: r.name,
      id: r.id,
      category: r.category,
      city: cityDisplayName(r.city),
    });
  }

  // Cities are folded so "Wien, AT" and "Wien" are one place; the label keeps
  // the first spelling seen so accents survive the fold used for matching.
  const cities = new Map<string, { label: string; count: number }>();
  for (const r of rows) {
    if (!r.has_photo) continue;
    const label = cityDisplayName(r.city);
    if (label.length === 0) continue;
    // Some curated rows carry a whole street address in `city` ("Budapest Gaál
    // Mózes utca 5-7"). Offering that as a town is embarrassing and leads to a
    // filter matching exactly one listing, so anything with a house number or
    // the length of an address is dropped from the town list. It still reaches
    // the visitor through the vendor's own row.
    if (/\d/.test(label) || label.length > 40) continue;
    const key = foldForSearch(label);
    const entry = cities.get(key);
    if (entry) entry.count += 1;
    else cities.set(key, { label, count: 1 });
  }
  for (const { label, count } of cities.values()) {
    const base = searchScore(label, q);
    if (base === 0) continue;
    suggestions.push({
      kind: "city",
      score: base + volumeBonus(count),
      label,
      count,
    });
  }

  suggestions.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return { suggestions: suggestions.slice(0, VENDOR_SEARCH_LIMIT), categories };
}
