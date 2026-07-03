// Address autocomplete contract, shared by the backend geocoder proxy
// (backend/src/lib/address_suggest.ts) and the frontend typeahead
// (components/AddressAutocomplete.tsx). Suggestions come from the free
// Photon geocoder over OpenStreetMap data (no API key, no paid tier),
// proxied through the backend so the browser never talks to the upstream
// and the per-IP rate limit is ours.

/** One suggestion row. Every field except `label` is nullable: the geocoder
 *  returns only what OSM knows, and the mapper never invents missing parts. */
export interface AddressSuggestion {
  /** Full display line for the dropdown row, e.g.
   *  "Andrássy út 60, 1062 Budapest, Hungary". */
  label: string;
  /** Street-level line (street + house number, or the place/POI name). */
  address: string | null;
  city: string | null;
  postal_code: string | null;
  /** ISO 3166-1 alpha-2, uppercase, when the geocoder knows it. */
  country: string | null;
  lat: number | null;
  lng: number | null;
}
