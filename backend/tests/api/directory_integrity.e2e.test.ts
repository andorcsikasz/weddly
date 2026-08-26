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
import { DIRECTORY, hasWeddingRelevantProvenance } from "../../src/domain/suppliers_data";
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

  test("the Hungarian directory has a quality-checked scale batch", () => {
    const hungarian = DIRECTORY.filter((supplier) => supplier.country === "HU");
    const scale = hungarian.filter((supplier) => supplier.id.startsWith("hu-scale-"));
    const sentenceCount = (value: string) =>
      Math.max(value.trim() ? 1 : 0, value.match(/[.!?](?=\s|$)/g)?.length ?? 0);

    expect(hungarian.length).toBeGreaterThanOrEqual(1_290);
    expect(scale).toHaveLength(467);
    for (const supplier of hungarian) {
      const huSentences = sentenceCount(supplier.blurb_hu);
      const enSentences = sentenceCount(supplier.blurb_en);
      expect(huSentences).toBeGreaterThanOrEqual(3);
      expect(huSentences).toBeLessThanOrEqual(6);
      expect(enSentences).toBeGreaterThanOrEqual(3);
      expect(enSentences).toBeLessThanOrEqual(6);
    }
    for (const supplier of scale) {
      expect(sentenceCount(supplier.blurb_hu)).toBeGreaterThanOrEqual(4);
      expect(sentenceCount(supplier.blurb_hu)).toBeLessThanOrEqual(6);
      expect(sentenceCount(supplier.blurb_en)).toBeGreaterThanOrEqual(4);
      expect(sentenceCount(supplier.blurb_en)).toBeLessThanOrEqual(6);
      expect(supplier.city.trim()).not.toBe("");
      expect(supplier.lat).not.toBeNull();
      expect(supplier.lng).not.toBeNull();
      expect(supplier.website).toMatch(/^https?:\/\//);
      expect(supplier.contact_email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(supplier.contact_phone?.replace(/\D/g, "").length).toBeGreaterThanOrEqual(7);
      expect(supplier.gallery_urls?.length).toBeGreaterThanOrEqual(2);
      expect(supplier.gallery_urls?.length).toBeLessThanOrEqual(6);
      for (const image of supplier.gallery_urls ?? []) expect(image).toMatch(/^https?:\/\//);
    }
  });

  test("the Croatian scale batch only lists vendors with explicit wedding evidence", () => {
    const hrScale = DIRECTORY.filter((s) => s.id.startsWith("hr-scale-"));
    expect(hrScale.length).toBeGreaterThanOrEqual(50);
    expect(DIRECTORY.some((s) => s.name === "GATE FILM")).toBe(false);
    for (const supplier of hrScale) {
      expect(hasWeddingRelevantProvenance(supplier)).toBe(true);
      expect(supplier.country).toBe("HR");
      expect(supplier.city.endsWith(", HR")).toBe(true);
      expect(supplier.address?.trim()).not.toBe("");
      expect(supplier.website).toMatch(/^https?:\/\//);
      expect(supplier.contact_email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(supplier.contact_phone?.replace(/\D/g, "").length).toBeGreaterThanOrEqual(8);
      expect(supplier.blurb_hu.trim()).not.toBe("");
      expect(supplier.blurb_en.trim()).not.toBe("");
      expect(supplier.gallery_urls?.[0]).toMatch(/^https?:\/\//);
    }
  });

  test("the Spanish scale batch only lists wedding-marketplace vendors", () => {
    const esScale = DIRECTORY.filter((s) => s.id.startsWith("es-scale-"));
    expect(esScale).toHaveLength(424);
    expect(
      DIRECTORY.some((s) => s.website === "https://administradoresdefincasvalencia.net/"),
    ).toBe(false);
    for (const supplier of esScale) {
      expect(hasWeddingRelevantProvenance(supplier)).toBe(true);
      expect(supplier.country).toBe("ES");
      expect(supplier.city.endsWith(", ES")).toBe(true);
      expect(supplier.address?.trim()).not.toBe("");
      expect(supplier.website).toMatch(/^https?:\/\//);
      expect(supplier.contact_email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(supplier.contact_phone?.replace(/\D/g, "").length).toBeGreaterThanOrEqual(9);
      expect(supplier.blurb_hu.trim()).not.toBe("");
      expect(supplier.blurb_en.trim()).not.toBe("");
      expect(supplier.gallery_urls?.[0]).toMatch(/^https?:\/\//);
    }
  });

  test("the Polish batch is present and scoped to PL", () => {
    const pl = DIRECTORY.filter((s) => s.country === "PL");
    expect(pl.length).toBeGreaterThanOrEqual(200);
    for (const s of pl) {
      expect(s.city.endsWith(", PL")).toBe(true);
      expect(s.source).toBe("curated");
    }
  });

  test("the Austrian open-web batch is present, complete and scoped to AT", () => {
    const ids = [
      "schloss-hof-estate",
      "burg-forchtenstein-wedding",
      "villa-bergzauber-rossleithen",
      "beim-boeckhiasl",
      "weingarten-resort-unterlamm",
      "schloss-an-der-eisenstrasse",
      "wallhof-schwertberg",
      "fuerstbergergut",
      "rooftop-7301",
      "schloss-gurhof",
    ];
    for (const id of ids) {
      const venue = DIRECTORY.find((s) => s.id === id);
      expect(venue).toBeDefined();
      expect(venue?.country).toBe("AT");
      expect(venue?.category).toBe("venue");
      expect(venue?.website).toMatch(/^https:\/\//);
      expect(venue?.contact_email).toMatch(/@/);
      expect(venue?.blurb_hu.trim()).not.toBe("");
      expect(venue?.blurb_en.trim()).not.toBe("");
      expect(venue?.gallery_urls?.length).toBeGreaterThanOrEqual(3);
      expect(venue?.lat).not.toBeNull();
      expect(venue?.lng).not.toBeNull();
    }
  });

  test("the Teleki–Tisza castle profile is contact-complete and gallery-rich", () => {
    const venue = DIRECTORY.find((supplier) => supplier.id === "teleki-tisza-kastely-nagykovacsi");
    expect(venue).toBeDefined();
    expect(venue?.name).toBe("Teleki–Tisza-kastély Nagykovácsi");
    expect(venue?.address).toBe("2094 Nagykovácsi, Kossuth Lajos utca 2.");
    expect(venue?.capacity_min).toBe(30);
    expect(venue?.capacity_max).toBe(140);
    expect(venue?.website).toContain("scoutevent.hu/teleki-tisza-kastely/");
    expect(venue?.contact_email).toBe("eskuvo@scoutevent.hu");
    expect(venue?.contact_phone).toBe("+36 20 290 4021");
    expect(venue?.contact_phone_alt).toBe("+36 20 380 0806");
    expect(venue?.gallery_urls).toHaveLength(10);
    expect(venue?.blurb_hu).toContain("170 m²-es");
    expect(venue?.blurb_en).toContain("170 m²");
    expect(venue?.blurb_hu).toContain("vezeték nélküli mikrofon");
    expect(venue?.blurb_en).toContain("wireless microphone");
  });

  test("the 2026 Austrian and Slovak expansion is contact-complete and has image seeds", () => {
    const expansion = DIRECTORY.filter(
      (supplier) => supplier.id.startsWith("at26-") || supplier.id.startsWith("sk26-"),
    );
    expect(expansion).toHaveLength(364);
    expect(expansion.filter((supplier) => supplier.country === "AT")).toHaveLength(221);
    expect(expansion.filter((supplier) => supplier.country === "SK")).toHaveLength(143);

    for (const supplier of expansion) {
      const expectedCountry = supplier.id.startsWith("at26-") ? "AT" : "SK";
      expect(supplier.country).toBe(expectedCountry);
      expect(supplier.city.endsWith(`, ${expectedCountry}`)).toBe(true);
      expect(supplier.address?.trim()).not.toBe("");
      expect(supplier.address).toMatch(/\d{4,5}/);
      expect(supplier.website).toMatch(/^https?:\/\//);
      expect(supplier.contact_email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(supplier.contact_phone?.replace(/\D/g, "").length).toBeGreaterThanOrEqual(7);
      expect(supplier.blurb_hu.trim()).not.toBe("");
      expect(supplier.blurb_en.trim()).not.toBe("");
      expect(supplier.gallery_urls?.[0]).toMatch(/^https?:\/\//);
    }
  });

  test("the GA4-prioritised European expansion covers every zero-supply market", () => {
    const expansion = DIRECTORY.filter((supplier) => supplier.id.startsWith("ga4eu26-"));
    const expectedMinimums: Record<string, number> = {
      IE: 5,
      NL: 20,
      GB: 13,
      DE: 18,
      SE: 13,
      CH: 12,
      BE: 18,
      CZ: 5,
    };
    expect(expansion).toHaveLength(104);
    for (const [country, minimum] of Object.entries(expectedMinimums)) {
      expect(
        expansion.filter((supplier) => supplier.country === country).length,
      ).toBeGreaterThanOrEqual(minimum);
    }
    for (const supplier of expansion) {
      expect(supplier.city.endsWith(`, ${supplier.country}`)).toBe(true);
      expect(supplier.address?.trim()).not.toBe("");
      // http(s), not https-only: a handful of real venues in this batch (e.g.
      // n1-bsc.de, oneplus.be, wikevent.se) genuinely have no TLS certificate,
      // confirmed by hand, and dropping them would put DE/BE/SE back under
      // their zero-supply-market minimum. Same "seed is server-fetched, never
      // hotlinked" reasoning as the gallery-seed test above.
      expect(supplier.website).toMatch(/^https?:\/\//);
      expect(supplier.contact_email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
      expect(supplier.contact_phone?.replace(/\D/g, "").length).toBeGreaterThanOrEqual(7);
      expect(supplier.gallery_urls?.[0]).toMatch(/^https?:\/\//);
      expect(supplier.lat).not.toBeNull();
      expect(supplier.lng).not.toBeNull();
    }
  });

  test("the Czech, German, French and Italian directories each have 250 rich vendors", () => {
    const expectedAdded: Record<string, number> = { CZ: 245, DE: 232, FR: 220, IT: 210 };
    const expansion = DIRECTORY.filter((supplier) => supplier.id.startsWith("eu26-"));
    expect(expansion).toHaveLength(907);

    for (const [country, added] of Object.entries(expectedAdded)) {
      const countryDirectory = DIRECTORY.filter((supplier) => supplier.country === country);
      const countryExpansion = expansion.filter((supplier) => supplier.country === country);
      expect(countryDirectory).toHaveLength(250);
      expect(countryExpansion).toHaveLength(added);

      for (const supplier of countryExpansion) {
        expect(supplier.city.endsWith(`, ${country}`)).toBe(true);
        expect(supplier.address || (supplier.lat !== null && supplier.lng !== null)).toBeTruthy();
        expect(supplier.website).toMatch(/^https?:\/\//);
        expect(supplier.contact_email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
        expect(supplier.contact_phone?.replace(/\D/g, "").length).toBeGreaterThanOrEqual(7);
        expect(supplier.blurb_hu.trim()).not.toBe("");
        expect(supplier.blurb_en.trim()).not.toBe("");
        expect(supplier.gallery_urls?.length).toBeGreaterThanOrEqual(1);
        for (const image of supplier.gallery_urls ?? []) {
          expect(image).toMatch(/^https?:\/\//);
          expect(image).not.toMatch(/\.svg(?:[?#]|$)/i);
        }
      }
    }
  });

  test("the curated directory contains at least 2,000 vendors", () => {
    expect(DIRECTORY.length).toBeGreaterThanOrEqual(2_000);
  });
});
