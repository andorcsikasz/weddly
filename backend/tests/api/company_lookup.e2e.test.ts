import { beforeEach, describe, expect, test } from "bun:test";
import "../setup";
import type { CompanyLookupAvailability, CompanyLookupResult } from "@shared/company_lookup";
import { PRIVACY_VERSION } from "@shared/legal";
import { registerAndVerify, req, wipeAll } from "../helpers";

// The suite runs with COMPANY_LOOKUP_FAKE=1 (tests/setup.ts): every provider
// answers from src/lib/company_lookup/fake.ts fixtures, so these tests
// exercise the full route -> factory -> provider -> mapping pipeline without
// touching a real registry.

async function registerVerified(email: string): Promise<{ token: string }> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Lookup Person",
  });
  expect(reg.status).toBe(201);
  return { token: reg.data.token };
}

/** Register + waitlist-submit so the account is granted planner status. */
async function registerPlanner(email: string): Promise<{ token: string }> {
  const { token } = await registerVerified(email);
  const wl = await req(
    "POST",
    "/api/planners/waitlist",
    {
      full_name: "Planner Person",
      email,
      phone: "+36 1 234 5678",
      privacy_version: PRIVACY_VERSION,
    },
    { token },
  );
  expect(wl.status).toBe(201);
  return { token };
}

async function search(
  token: string,
  country: string,
  q: string,
): Promise<{ status: number; results: CompanyLookupResult[] }> {
  const r = await req<{ results: CompanyLookupResult[] }>(
    "GET",
    `/api/company-lookup/search?country=${country}&q=${encodeURIComponent(q)}`,
    undefined,
    { token },
  );
  return { status: r.status, results: r.data?.results ?? [] };
}

describe("company lookup: availability", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("is reachable anonymously (vendor signup runs pre-account)", async () => {
    const r = await req<CompanyLookupAvailability>(
      "GET",
      "/api/company-lookup/availability?country=FR",
    );
    expect(r.status).toBe(200);
    expect(r.data.available).toBe(true);
  });

  test("rejects a malformed country param", async () => {
    const { token } = await registerVerified("avail-bad@test.weddly");
    const r = await req("GET", "/api/company-lookup/availability?country=FRA", undefined, {
      token,
    });
    expect(r.status).toBe(400);
  });

  test("FR reports a free source with name + registry-number search", async () => {
    const { token } = await registerVerified("avail-fr@test.weddly");
    const r = await req<CompanyLookupAvailability>(
      "GET",
      "/api/company-lookup/availability?country=FR",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.available).toBe(true);
    expect(r.data.source_name).toContain("SIRENE");
    expect(r.data.search_kinds).toContain("name");
    expect(r.data.search_kinds).toContain("registry_number");
  });

  test("HU is tax-number only, BE is registry-number only (VIES-backed)", async () => {
    const { token } = await registerVerified("avail-hube@test.weddly");
    const hu = await req<CompanyLookupAvailability>(
      "GET",
      "/api/company-lookup/availability?country=HU",
      undefined,
      { token },
    );
    expect(hu.data.available).toBe(true);
    expect(hu.data.search_kinds).toEqual(["tax_number"]);
    const be = await req<CompanyLookupAvailability>(
      "GET",
      "/api/company-lookup/availability?country=BE",
      undefined,
      { token },
    );
    expect(be.data.available).toBe(true);
    expect(be.data.search_kinds).toEqual(["registry_number"]);
  });

  test("unsupported country (DE) reports manual entry", async () => {
    const { token } = await registerVerified("avail-de@test.weddly");
    const r = await req<CompanyLookupAvailability>(
      "GET",
      "/api/company-lookup/availability?country=DE",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.available).toBe(false);
    expect(r.data.source_name).toBeNull();
    expect(r.data.search_kinds).toEqual([]);
  });

  test("GR flips to manual entry when GEMI_API_KEY is unset", async () => {
    const { token } = await registerVerified("avail-gr@test.weddly");
    const withKey = await req<CompanyLookupAvailability>(
      "GET",
      "/api/company-lookup/availability?country=GR",
      undefined,
      { token },
    );
    expect(withKey.data.available).toBe(true);

    const prev = process.env.GEMI_API_KEY;
    process.env.GEMI_API_KEY = "";
    try {
      const withoutKey = await req<CompanyLookupAvailability>(
        "GET",
        "/api/company-lookup/availability?country=GR",
        undefined,
        { token },
      );
      expect(withoutKey.data.available).toBe(false);
    } finally {
      process.env.GEMI_API_KEY = prev;
    }
  });
});

describe("company lookup: search + getCompany", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("works anonymously (stingier rate bucket) and requires a query", async () => {
    const anon = await req<{ results: unknown[] }>(
      "GET",
      "/api/company-lookup/search?country=FR&q=fleur",
    );
    expect(anon.status).toBe(200);
    const { token } = await registerVerified("search-noq@test.weddly");
    const noq = await req("GET", "/api/company-lookup/search?country=FR&q=", undefined, { token });
    expect(noq.status).toBe(400);
  });

  test("search for a country without a provider is a 404", async () => {
    const { token } = await registerVerified("search-de@test.weddly");
    const r = await req("GET", "/api/company-lookup/search?country=DE&q=firma", undefined, {
      token,
    });
    expect(r.status).toBe(404);
  });

  test("FR: name search maps the official SIRENE record", async () => {
    const { token } = await registerVerified("search-fr@test.weddly");
    const { status, results } = await search(token, "FR", "fleur de sel");
    expect(status).toBe(200);
    expect(results.length).toBe(1);
    const c = results[0];
    expect(c?.name).toBe("FLEUR DE SEL EVENTS");
    expect(c?.registry_number).toBe("912345678");
    expect(c?.vat_number).toBe("FR32912345678");
    expect(c?.legal_form).toBe("SAS");
    expect(c?.city).toBe("LYON");
    expect(c?.postal_code).toBe("69001");
    expect(c?.address).toBe("4 RUE DES LILAS 69001 LYON");
    expect(c?.status).toBe("active");
    expect(c?.activity).toBe("82.30Z");
    expect(c?.country).toBe("FR");
  });

  test("FR: no match returns an empty list", async () => {
    const { token } = await registerVerified("search-fr-none@test.weddly");
    const { status, results } = await search(token, "FR", "nomatch xyz");
    expect(status).toBe(200);
    expect(results).toEqual([]);
  });

  test("FR: getCompany resolves a SIREN", async () => {
    const { token } = await registerVerified("get-fr@test.weddly");
    const r = await req<{ company: CompanyLookupResult }>(
      "GET",
      "/api/company-lookup/company/912345678?country=FR",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.company.name).toBe("FLEUR DE SEL EVENTS");
  });

  test("HU: tax-number search returns the VIES record (dashes tolerated)", async () => {
    const { token } = await registerVerified("search-hu@test.weddly");
    const { status, results } = await search(token, "HU", "12345678-1-02");
    expect(status).toBe(200);
    expect(results.length).toBe(1);
    const c = results[0];
    expect(c?.name).toBe("Virágos Kert Kft.");
    expect(c?.vat_number).toBe("HU12345678");
    expect(c?.address).toBe("1054 BUDAPEST SZABADSÁG TÉR 7.");
    expect(c?.status).toBe("active");
  });

  test("HU: a name query is a clean no-result (identifier-only source)", async () => {
    const { token } = await registerVerified("search-hu-name@test.weddly");
    const { status, results } = await search(token, "HU", "Virágos Kert Kft.");
    expect(status).toBe(200);
    expect(results).toEqual([]);
  });

  test("HU: an unknown tax number is a clean no-result", async () => {
    const { token } = await registerVerified("search-hu-none@test.weddly");
    const { status, results } = await search(token, "HU", "99999999");
    expect(status).toBe(200);
    expect(results).toEqual([]);
  });

  test("BE: enterprise-number search returns the VIES record", async () => {
    const { token } = await registerVerified("search-be@test.weddly");
    const { status, results } = await search(token, "BE", "0123.456.749");
    expect(status).toBe(200);
    expect(results.length).toBe(1);
    const c = results[0];
    expect(c?.name).toBe("Fleurs de Mariage SRL");
    expect(c?.registry_number).toBe("0123.456.749");
    expect(c?.vat_number).toBe("BE0123456749");
    // VIES multiline address collapses to one line.
    expect(c?.address).toBe("RUE DES FLEURS 12, 1000 BRUXELLES");
  });

  test("NL: KVK-number lookup returns the limited open-dataset fields", async () => {
    const { token } = await registerVerified("search-nl@test.weddly");
    const { status, results } = await search(token, "NL", "90001354");
    expect(status).toBe(200);
    expect(results.length).toBe(1);
    const c = results[0];
    expect(c?.name).toBeNull(); // anonymised dataset: no trade name
    expect(c?.address).toBeNull();
    expect(c?.registry_number).toBe("90001354");
    expect(c?.legal_form).toBe("BV");
    expect(c?.region).toBe("10xx");
    expect(c?.registration_date).toBe("2021-04-01");
    expect(c?.activity).toContain("82300");
    expect(c?.status).toBe("active");
  });

  test("NL: unknown KVK number is a clean no-result", async () => {
    const { token } = await registerVerified("search-nl-none@test.weddly");
    const { status, results } = await search(token, "NL", "12345678");
    expect(status).toBe(200);
    expect(results).toEqual([]);
  });

  test("GR: name search maps the GEMI record", async () => {
    const { token } = await registerVerified("search-gr@test.weddly");
    const { status, results } = await search(token, "GR", "wedding events");
    expect(status).toBe(200);
    expect(results.length).toBe(1);
    const c = results[0];
    expect(c?.name).toBe("ΓΑΜΗΛΙΕΣ ΕΚΔΗΛΩΣΕΙΣ ΙΚΕ");
    expect(c?.registry_number).toBe("123456789000");
    expect(c?.vat_number).toBe("EL998765432");
    expect(c?.city).toBe("ΑΘΗΝΑ");
    expect(c?.address).toBe("ΕΡΜΟΥ 15, 10563 ΑΘΗΝΑ");
    expect(c?.legal_form).toBe("ΙΚΕ");
  });

  test("GR: getCompany resolves an arGemi id", async () => {
    const { token } = await registerVerified("get-gr@test.weddly");
    const r = await req<{ company: CompanyLookupResult }>(
      "GET",
      "/api/company-lookup/company/123456789000?country=GR",
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.company.registry_number).toBe("123456789000");
  });
});

describe("planner profile: official identity fields", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("PATCH persists country + registry/VAT/legal form/address and GET returns them", async () => {
    const { token } = await registerPlanner("identity@test.weddly");
    const patch = await req<{ planner_country: string | null }>(
      "PATCH",
      "/api/planner/profile",
      {
        business_name: "Fleur de Sel Events",
        planner_country: "fr", // lower-case input normalises to FR
        planner_registry_number: "912345678",
        planner_vat_number: "FR32912345678",
        planner_legal_form: "SAS",
        planner_address: "4 RUE DES LILAS 69001 LYON",
      },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.planner_country).toBe("FR");

    const profile = await req<{
      planner_country: string | null;
      planner_registry_number: string | null;
      planner_vat_number: string | null;
      planner_legal_form: string | null;
      planner_address: string | null;
    }>("GET", "/api/planner/profile", undefined, { token });
    expect(profile.data.planner_country).toBe("FR");
    expect(profile.data.planner_registry_number).toBe("912345678");
    expect(profile.data.planner_vat_number).toBe("FR32912345678");
    expect(profile.data.planner_legal_form).toBe("SAS");
    expect(profile.data.planner_address).toBe("4 RUE DES LILAS 69001 LYON");
  });

  test("PATCH rejects a country code outside the canonical list", async () => {
    const { token } = await registerPlanner("identity-bad@test.weddly");
    const r = await req("PATCH", "/api/planner/profile", { planner_country: "XX" }, { token });
    expect(r.status).toBe(400);
  });

  test("clearing an identity field with an empty string empties it", async () => {
    const { token } = await registerPlanner("identity-clear@test.weddly");
    await req(
      "PATCH",
      "/api/planner/profile",
      { planner_vat_number: "HU12345678", planner_country: "HU" },
      { token },
    );
    // Same convention as the other string fields: "" clears, absent key
    // leaves the stored value untouched.
    const cleared = await req<{
      planner_vat_number: string | null;
      planner_country: string | null;
    }>("PATCH", "/api/planner/profile", { planner_vat_number: "" }, { token });
    expect(cleared.status).toBe(200);
    expect(cleared.data.planner_vat_number).toBeNull();
    expect(cleared.data.planner_country).toBe("HU"); // untouched field stays
  });
});
