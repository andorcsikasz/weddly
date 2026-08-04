// Invariants of the curated directory itself, rather than of any one endpoint.
//
// The list is hand-maintained data spread across several files
// (`suppliers_data.ts` plus the per-country splits), and every batch added to
// it is a few hundred literals written in one pass. The failures that costs are
// all SILENT: a duplicate id collides in the boot upsert and one business
// quietly overwrites another, a city that forgot its ", XX" suffix reads as
// Hungarian and disappears from its own country's catalogue, a relative or
// http:// gallery URL is fetched by the re-host sweep and dropped without
// anything to show for it. None of those raise anywhere, and each one is
// invisible until a couple in that country notices something missing.
//
// So these assertions are about the SHAPE of the data, not about any feature.
// The country-scoping behaviour they rest on is covered in
// `suppliers_country.e2e.test.ts`.

import "../setup";

import { describe, expect, test } from "bun:test";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { VENUE_STYLES } from "@shared/suppliers";

describe("curated directory integrity", () => {
  test("every id is unique", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const s of DIRECTORY) {
      if (seen.has(s.id)) dupes.push(s.id);
      seen.add(s.id);
    }
    expect(dupes).toEqual([]);
  });

  test("an id is a URL-safe slug", () => {
    // Ids are path segments: `/vendors/<id>` is the share link a vendor is
    // handed, and the claim-invite mail builds it by hand.
    const bad = DIRECTORY.filter((s) => !/^[a-z0-9][a-z0-9-]*$/.test(s.id)).map((s) => s.id);
    expect(bad).toEqual([]);
  });

  test("a country resolves from the entry, never by accident", () => {
    // `curatedCountry` falls back to "HU" for anything it cannot read, which is
    // right for the pre-international rows and wrong the moment a foreign batch
    // forgets its suffix. Assert the other way round: every entry whose city
    // carries a suffix resolves to THAT code.
    for (const s of DIRECTORY) {
      const suffix = s.city.match(/,\s*([A-Z]{2})$/)?.[1];
      if (suffix) expect(s.country).toBe(suffix);
      expect(s.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  test("a gallery seed is an absolute http(s) URL", () => {
    // The re-host sweeps hand these straight to `fetchRemoteImage`, whose SSRF
    // guard refuses any other scheme, and refuses it silently, on the one
    // attempt each row ever gets. Plain `http:` passes deliberately: the seed
    // is only ever fetched SERVER-side and what the browser is served is the
    // re-hosted copy, so a venue still on http is a fine source and dropping it
    // would cost that card its only photo. What this catches is a relative or
    // protocol-relative URL, which has no host to fetch from at all.
    const bad: string[] = [];
    for (const s of DIRECTORY) {
      for (const url of s.gallery_urls ?? []) {
        if (!/^https?:\/\/\w/.test(url)) bad.push(`${s.id}: ${url}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("a venue_style is one of the controlled values", () => {
    // Each value needs a `suppliers.venue_style.*` label in every locale file;
    // an invented one renders as a raw dotted path on the card.
    const allowed = new Set<string>(VENUE_STYLES);
    const bad = DIRECTORY.filter((s) => s.venue_style && !allowed.has(s.venue_style)).map(
      (s) => `${s.id}: ${s.venue_style}`,
    );
    expect(bad).toEqual([]);
  });

  test("a price band is 1-5 or absent, never zero", () => {
    // 0 is the sentinel the community read path normalises TO, so a literal 0
    // here would render as a band nobody chose.
    const bad = DIRECTORY.filter(
      (s) => s.price_band !== null && !(s.price_band >= 1 && s.price_band <= 5),
    ).map((s) => `${s.id}: ${s.price_band}`);
    expect(bad).toEqual([]);
  });

  test("a capacity range runs upwards", () => {
    const bad = DIRECTORY.filter(
      (s) => s.capacity_min !== null && s.capacity_max !== null && s.capacity_min > s.capacity_max,
    ).map((s) => `${s.id}: ${s.capacity_min}-${s.capacity_max}`);
    expect(bad).toEqual([]);
  });

  test("every entry has both descriptions filled", () => {
    // `pickListingBlurb` falls back to the other language when its winner is
    // empty, so one missing description is survivable and two are a blank card.
    const bad = DIRECTORY.filter((s) => !s.blurb_en.trim() && !s.blurb_hu.trim()).map((s) => s.id);
    expect(bad).toEqual([]);
  });

  test("the Polish batch is present and scoped to PL", () => {
    const pl = DIRECTORY.filter((s) => s.country === "PL");
    expect(pl.length).toBeGreaterThanOrEqual(200);
    for (const s of pl) {
      expect(s.city.endsWith(", PL")).toBe(true);
      expect(s.source).toBe("curated");
    }
  });
});
