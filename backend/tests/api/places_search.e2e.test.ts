// GET /api/places/search: the Nominatim proxy behind the honeymoon
// destination picker and the venue-name / pin fields.
//
// Contract covered here:
//   - The upstream `accept-language` follows the CALLER'S locale, because OSM
//     place names are translated: an EN interface typing "croatia" must be
//     offered "Croatia", not "Horvátország" (what the old hardcoded "hu,en"
//     returned). EN is the fallback for an absent or unknown `lang`, matching
//     the product-wide default.
//   - Sub-minimum queries are answered locally with [] so a `lang` roundtrip
//     never spends a Nominatim call.
//   - The length cap clears a stored destination. Picking a suggestion saves
//     Nominatim's own `display_name`, and the honeymoon map hands that same
//     string back to be geocoded, so a cap below the field's own maxLength
//     rejects our own data (see MAX_QUERY_CHARS).
//
// The header itself is asserted against the exported mapper rather than over
// HTTP: the route talks to the live geocoder, which no test should depend on.
// The over-cap case is asserted over HTTP because it is refused before the
// fetch; an under-cap one would go upstream, so it is asserted on the constant.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";
import { MAX_QUERY_CHARS, acceptLanguage } from "../../src/routes/places";

/** The longest destination a couple can save (the input's own maxLength, and
 *  the width of a Nominatim breadcrumb we may be asked to re-geocode). */
const DESTINATION_MAX_CHARS = 200;

describe("places search language", () => {
  test("accept-language follows the UI locale, EN by default", () => {
    expect(acceptLanguage("en")).toBe("en");
    expect(acceptLanguage("hu")).toBe("hu,en");
    expect(acceptLanguage("es")).toBe("es,en");
    // Unknown / absent locale reads English, never Hungarian.
    expect(acceptLanguage(null)).toBe("en");
    expect(acceptLanguage("de")).toBe("en");
    expect(acceptLanguage("")).toBe("en");
  });

  test("a lang param on a short query stays local (no upstream call)", async () => {
    const { token } = await bootstrapCouple("places-lang@weddly.test");
    const r = await req<{ places: unknown[] }>("GET", "/api/places/search?q=b&lang=en", undefined, {
      token,
    });
    expect(r.status).toBe(200);
    expect(r.data.places).toEqual([]);
  });
});

describe("places search query length", () => {
  test("the cap admits any destination the picker can store", () => {
    // A saved destination IS a Nominatim breadcrumb ("Chiesa di San Girolamo dei
    // Croati, Via Tomacelli, …, Olaszország" is 137 chars), and the honeymoon map
    // geocodes it back to place its pin. Cap below the field and the map fails on
    // exactly the specific places it is most wanted for.
    expect(MAX_QUERY_CHARS).toBeGreaterThanOrEqual(DESTINATION_MAX_CHARS);
  });

  test("over the cap is refused before any upstream call", async () => {
    const { token } = await bootstrapCouple("places-length@weddly.test");
    const r = await req(
      "GET",
      `/api/places/search?q=${"x".repeat(MAX_QUERY_CHARS + 1)}`,
      undefined,
      {
        token,
      },
    );
    expect(r.status).toBe(400);
  });
});
