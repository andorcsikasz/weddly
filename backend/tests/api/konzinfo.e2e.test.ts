import "../setup";

import { describe, expect, test } from "bun:test";
import { matchKonzinfoCountry } from "@shared/konzinfo";
import type { KonzinfoInfo } from "@shared/konzinfo";
import { _clearKonzinfoCacheForTests, parseKonzinfoStatus } from "../../src/domain/konzinfo";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// ─── Destination → official country resolution (pure, no network) ──────────

describe("konzinfo — destination matcher", () => {
  test("the five headline honeymoon destinations resolve to the right country page", () => {
    const cases: Array<[string, string, string]> = [
      ["Maldív-szigetek", "Maldív-szigetek", "maldiv-szigetek"],
      ["Bali", "Indonézia", "indonezia"],
      ["Thaiföld", "Thaiföld", "thaifold"],
      ["Mauritius", "Mauritius", "mauritius"],
      ["Seychelle-szigetek", "Seychelle-szigetek", "seychelle-szigetek"],
    ];
    for (const [destination, country_hu, slug] of cases) {
      const m = matchKonzinfoCountry(destination);
      expect(m?.country_hu).toBe(country_hu);
      expect(m?.slug).toBe(slug);
      expect(m?.konzinfo_url).toBe(
        `https://konzinfo.mfa.gov.hu/utazasi-tanacsok-orszagonkent/${slug}`,
      );
    }
  });

  test("Nominatim-style breadcrumbs (city, region, country) still resolve", () => {
    expect(matchKonzinfoCountry("Denpasar, Bali, Indonesia")?.slug).toBe("indonezia");
    expect(matchKonzinfoCountry("Phuket, Thailand")?.slug).toBe("thaifold");
    expect(matchKonzinfoCountry("Zanzibar, Tanzania")?.country_hu).toBe("Tanzánia");
    expect(matchKonzinfoCountry("Bora Bora, French Polynesia")?.country_hu).toBe(
      "Franciaország tengeren túli területei",
    );
  });

  test("an unmappable destination returns null", () => {
    expect(matchKonzinfoCountry("Balaton, Magyarország")).toBeNull();
    expect(matchKonzinfoCountry("")).toBeNull();
    expect(matchKonzinfoCountry(null)).toBeNull();
  });
});

// ─── Live-status HTML parser (deterministic, against a saved snapshot) ──────

describe("konzinfo — live status parser", () => {
  // Mirrors the real Konzinfo country-page markup: the rating lives in the
  // <meta name="description"> summary, and the dates in label/value pairs in
  // adjacent elements.
  const SAMPLE = `
    <meta name="description" content="Szingapúr biztonsági besorolását tekintve a zöld, (IV.) kategóriába tartozik." />
    <div class="field__label">Utolsó módosítás dátuma</div>
    <div class="field__item">2026.05.27.</div>
    <div class="field"><div class="field__label">Mai napon is érvényes</div>
    <div class="field__item">2026.06.08.</div></div>
    <div class="field__label">Biztonsági besorolás utolsó módosítása 2022.03.21.</div>
  `;

  test("extracts the dates and a concise security rating", () => {
    const s = parseKonzinfoStatus(SAMPLE);
    expect(s.last_modified).toBe("2026.05.27");
    expect(s.valid_today).toBe("2026.06.08");
    expect(s.safety_modified).toBe("2022.03.21");
    expect(s.safety_category).toBe("Zöld (IV.)");
  });

  test("distils a two-tier rating to a compact form", () => {
    const s = parseKonzinfoStatus(
      '<meta name="description" content="Thaiföld biztonsági besorolása a IV-es és III-as biztonsági besorolási kategória." />',
    );
    expect(s.safety_category).toBe("IV–III. kategória");
  });

  test("missing fields degrade to null, never throw", () => {
    const s = parseKonzinfoStatus("<p>no consular fields here</p>");
    expect(s).toEqual({
      last_modified: null,
      valid_today: null,
      safety_category: null,
      safety_modified: null,
    });
  });
});

// ─── Endpoint ──────────────────────────────────────────────────────────────

describe("konzinfo — /api/honeymoon/konzinfo", () => {
  test("requires auth", async () => {
    wipeAll();
    const res = await req("GET", "/api/honeymoon/konzinfo");
    expect(res.status).toBe(401);
  });

  test("resolves the official country page for a matched destination", async () => {
    wipeAll();
    _clearKonzinfoCacheForTests();
    const { token } = await bootstrapCouple("honeymooner@weddly.test");
    // Override query keeps the assertion independent of any stored destination.
    const res = await req<KonzinfoInfo>(
      "GET",
      "/api/honeymoon/konzinfo?destination=Bali",
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.matched?.country_hu).toBe("Indonézia");
    expect(res.data.matched?.konzinfo_url).toContain("/indonezia");
    // The country index is ALWAYS present — the universal fallback link.
    expect(res.data.index_url).toBe("https://konzinfo.mfa.gov.hu/utazasi-tanacsok-orszagonkent");
    // Live status is best-effort: an object when the foreign host is reachable,
    // null when its TLS chain can't be built (CI). Both are acceptable.
    expect(res.data.status === null || typeof res.data.status === "object").toBe(true);
  });

  test("an unmatched destination still returns the fallback index link", async () => {
    wipeAll();
    _clearKonzinfoCacheForTests();
    const { token } = await bootstrapCouple("homebody@weddly.test");
    const res = await req<KonzinfoInfo>(
      "GET",
      "/api/honeymoon/konzinfo?destination=Balaton",
      undefined,
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.matched).toBeNull();
    expect(res.data.status).toBeNull();
    expect(res.data.index_url).toBe("https://konzinfo.mfa.gov.hu/utazasi-tanacsok-orszagonkent");
  });
});
