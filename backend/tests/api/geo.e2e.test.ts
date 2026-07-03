// Address autocomplete proxy (GET /api/geo/address-suggest). Runs against
// the ADDRESS_SUGGEST_FAKE fixtures pinned in tests/setup.ts, so the Photon
// mapper executes unmodified without touching the real geocoder. Verifies:
//   - anonymous access (the vendor signup form runs pre-account)
//   - fixture queries map to the shared AddressSuggestion shape, capped at 5
//   - "nomatch" queries return the upstream's empty answer
//   - sub-minimum queries answer locally with [] (typing is not an error)
//   - oversize queries → 400

import "../setup";

import { describe, expect, test } from "bun:test";
import type { AddressSuggestion } from "@shared/geo";
import { req } from "../helpers";

describe("GET /api/geo/address-suggest", () => {
  test("maps fixture features to suggestions, anonymously", async () => {
    const r = await req<{ suggestions: AddressSuggestion[] }>(
      "GET",
      "/api/geo/address-suggest?q=Andr%C3%A1ssy%20%C3%BAt",
    );
    expect(r.status).toBe(200);
    expect(r.data.suggestions.length).toBeGreaterThan(0);
    expect(r.data.suggestions.length).toBeLessThanOrEqual(5);

    const first = r.data.suggestions[0];
    expect(first?.label).toBe("Andrássy út 60, 1062 Budapest, Hungary");
    expect(first?.address).toBe("Andrássy út 60");
    expect(first?.city).toBe("Budapest");
    expect(first?.postal_code).toBe("1062");
    expect(first?.country).toBe("HU");
    expect(first?.lat).toBeCloseTo(47.5063);
    expect(first?.lng).toBeCloseTo(19.0653);

    // POI-style fixture (no street, only a name) still maps via the fallback.
    const poi = r.data.suggestions.find((s) => s.city === "Lyon");
    expect(poi?.address).toBe("Place Bellecour");
  });

  test("no upstream match → empty list, not an error", async () => {
    const r = await req<{ suggestions: AddressSuggestion[] }>(
      "GET",
      "/api/geo/address-suggest?q=nomatch%20street",
    );
    expect(r.status).toBe(200);
    expect(r.data.suggestions).toEqual([]);
  });

  test("queries under 3 chars answer locally with []", async () => {
    const r = await req<{ suggestions: AddressSuggestion[] }>(
      "GET",
      "/api/geo/address-suggest?q=an",
    );
    expect(r.status).toBe(200);
    expect(r.data.suggestions).toEqual([]);
  });

  test("oversize query → 400", async () => {
    const q = encodeURIComponent("x".repeat(201));
    const r = await req("GET", `/api/geo/address-suggest?q=${q}`);
    expect(r.status).toBe(400);
  });
});
