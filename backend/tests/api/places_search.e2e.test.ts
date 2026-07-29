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
//
// The header itself is asserted against the exported mapper rather than over
// HTTP: the route talks to the live geocoder, which no test should depend on.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req } from "../helpers";
import { acceptLanguage } from "../../src/routes/places";

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
