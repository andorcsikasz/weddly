// Deterministic upstream fixtures for the E2E suite (COMPANY_LOOKUP_FAKE=1,
// pinned in backend/tests/setup.ts). Shapes mirror the real registry payloads
// the providers parse, so the mapping code runs unmodified in tests.
// Queries containing "nomatch" return the registry's empty answer.

interface FakeAnswer {
  status: number;
  body: unknown;
}

const FR_COMPANY = {
  siren: "912345678",
  nom_complet: "FLEUR DE SEL EVENTS",
  nom_raison_sociale: "FLEUR DE SEL EVENTS",
  nature_juridique: "5710",
  etat_administratif: "A",
  activite_principale: "82.30Z",
  date_creation: "2019-03-01",
  tva: ["FR32912345678"],
  siege: {
    siret: "91234567800019",
    adresse: "4 RUE DES LILAS 69001 LYON",
    code_postal: "69001",
    libelle_commune: "LYON",
    etat_administratif: "A",
  },
};

const NL_COMPANY = {
  kvkNummer: "90001354",
  datumAanvang: "20210401",
  actief: "J",
  rechtsvormCode: "BV",
  postcodeRegio: "10",
  activiteiten: [{ sbiCode: "82300", omschrijving: "Organiseren van congressen en beurzen" }],
  lidstaat: "NL",
};

const GR_COMPANY = {
  arGemi: "123456789000",
  afm: "998765432",
  coNameEl: "ΓΑΜΗΛΙΕΣ ΕΚΔΗΛΩΣΕΙΣ ΙΚΕ",
  coNamesEn: "WEDDING EVENTS PC",
  city: "ΑΘΗΝΑ",
  street: "ΕΡΜΟΥ",
  streetNumber: "15",
  zipCode: "10563",
  legalType: { name: "ΙΚΕ" },
  status: { name: "Ενεργή", isActive: true },
  incorporationDate: "2020-06-15",
  activities: [{ code: "82.30", descr: "Οργάνωση συνεδρίων και εμπορικών εκθέσεων" }],
};

// VIES fixtures keyed by `${countryCode}${vatNumber}`.
const VIES_VALID: Record<string, { name: string; address: string }> = {
  HU12345678: { name: "Virágos Kert Kft.", address: "1054 BUDAPEST SZABADSÁG TÉR 7." },
  BE0123456749: { name: "Fleurs de Mariage SRL", address: "RUE DES FLEURS 12\n1000 BRUXELLES" },
};

export function fakeLookupResponse(url: string, requestBody?: string): FakeAnswer | null {
  const u = new URL(url);

  if (u.hostname === "recherche-entreprises.api.gouv.fr") {
    const q = (u.searchParams.get("q") ?? "").toLowerCase();
    if (q.includes("nomatch")) {
      return { status: 200, body: { results: [], total_results: 0, page: 1, per_page: 8 } };
    }
    return { status: 200, body: { results: [FR_COMPANY], total_results: 1, page: 1, per_page: 8 } };
  }

  if (u.hostname === "opendata.kvk.nl") {
    const kvk = u.pathname.split("/").pop() ?? "";
    if (kvk === NL_COMPANY.kvkNummer) return { status: 200, body: NL_COMPANY };
    return { status: 404, body: { fout: "niet gevonden" } };
  }

  if (u.hostname === "ec.europa.eu") {
    let payload: { countryCode?: string; vatNumber?: string } = {};
    try {
      payload = JSON.parse(requestBody ?? "{}");
    } catch {
      /* malformed body behaves like an invalid number */
    }
    const hit = VIES_VALID[`${payload.countryCode ?? ""}${payload.vatNumber ?? ""}`];
    if (hit) {
      return {
        status: 200,
        body: {
          countryCode: payload.countryCode,
          vatNumber: payload.vatNumber,
          valid: true,
          name: hit.name,
          address: hit.address,
        },
      };
    }
    return {
      status: 200,
      body: { countryCode: payload.countryCode, vatNumber: payload.vatNumber, valid: false },
    };
  }

  if (u.hostname === "opendata-api.businessportal.gr") {
    if (u.pathname.endsWith(`/companies/${GR_COMPANY.arGemi}`)) {
      return { status: 200, body: GR_COMPANY };
    }
    if (u.pathname.endsWith("/companies")) {
      const name = (u.searchParams.get("name") ?? "").toLowerCase();
      if (name.includes("nomatch")) return { status: 200, body: [] };
      return { status: 200, body: [GR_COMPANY] };
    }
    return { status: 404, body: null };
  }

  // Unknown host in fake mode = a provider fetched something the fixtures
  // don't model; surface it as an upstream failure so the test fails loudly.
  return null;
}
