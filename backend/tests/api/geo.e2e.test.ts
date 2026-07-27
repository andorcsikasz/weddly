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

// City mode backs the vendor-onboarding city field, where the value the vendor
// picks becomes the string couples later filter the directory by. It must hand
// back one canonical row per town, with the town in `city` (not `address`).
describe("GET /api/geo/address-suggest?kind=city", () => {
  test("maps place features to city rows and dedups the same town", async () => {
    const r = await req<{ suggestions: AddressSuggestion[] }>(
      "GET",
      "/api/geo/address-suggest?q=Budapest&kind=city",
    );
    expect(r.status).toBe(200);

    const first = r.data.suggestions[0];
    expect(first?.city).toBe("Budapest");
    expect(first?.label).toBe("Budapest, Central Hungary, Hungary");
    expect(first?.country).toBe("HU");
    // A city row fills a city field and nothing else.
    expect(first?.address).toBeNull();
    expect(first?.postal_code).toBeNull();
    // Two fixtures are the same town from different extracts → one row.
    expect(r.data.suggestions.filter((s) => s.city === "Budapest")).toHaveLength(1);
    expect(r.data.suggestions.map((s) => s.city)).toEqual(["Budapest", "Szeged"]);
  });

  test("an unknown kind falls back to street-level suggestions", async () => {
    const r = await req<{ suggestions: AddressSuggestion[] }>(
      "GET",
      "/api/geo/address-suggest?q=Andr%C3%A1ssy%20%C3%BAt&kind=street",
    );
    expect(r.status).toBe(200);
    expect(r.data.suggestions[0]?.address).toBe("Andrássy út 60");
  });

  test("no match in city mode → empty list", async () => {
    const r = await req<{ suggestions: AddressSuggestion[] }>(
      "GET",
      "/api/geo/address-suggest?q=nomatch%20town&kind=city",
    );
    expect(r.status).toBe(200);
    expect(r.data.suggestions).toEqual([]);
  });
});
