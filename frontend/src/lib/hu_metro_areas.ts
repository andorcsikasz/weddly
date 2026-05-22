// Hungarian "metro area" groups for booking.com-style nearby-cities search.
//
// When a couple types "Budapest" into the supplier-search bar, they expect
// to see suppliers in the wider agglomeration (Vasad, Érd, Monor, Vác,
// Alcsútdoboz, …) — not just the literal city of Budapest. This module
// owns that mapping.
//
// How it's wired: SuppliersPage augments the search-haystack for each
// supplier with the metro keys its city belongs to. When the query
// matches the metro key (e.g. "budapest"), every supplier whose city is
// in that group passes the filter — without changing the rest of the
// substring-search behaviour.
//
// We picked a hand-curated dictionary over the two alternatives:
//   - Haversine: only ~45 curated venues have lat/lng; community
//     submissions have none, so distance filtering would silently
//     exclude most of the directory.
//   - Postal-code prefix: HU prefixes don't cleanly map to
//     wedding-relevant metros (county capitals share their prefix with
//     villages 50+ km away).
//
// Maintenance: add cities to an existing group as the directory grows;
// add a new top-level key when a new region builds supplier density.
// A city may belong to multiple groups (border towns near two hubs) —
// the union is what the search expands to.

/** Diacritic-folded lower-case form — matches the same normalization
 *  used in SuppliersPage so haystack assembly stays consistent. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

const METRO_AREAS_HU_RAW: Record<string, string[]> = {
  // Budapest + agglomeráció. The anchor a user is most likely to type
  // in the search bar; intentionally generous so wedding venues 30–50 km
  // outside the Bp ring road still surface.
  budapest: [
    "Budapest",
    // West / Buda hills
    "Érd",
    "Százhalombatta",
    "Tárnok",
    "Sóskút",
    "Budakeszi",
    "Budaörs",
    "Törökbálint",
    "Diósd",
    "Solymár",
    "Pilisvörösvár",
    "Pilisborosjenő",
    "Telki",
    // North (Danube bend)
    "Szentendre",
    "Pomáz",
    "Leányfalu",
    "Tahitótfalu",
    "Visegrád",
    "Esztergom",
    "Dunakeszi",
    "Fót",
    "Csömör",
    "Mogyoród",
    "Veresegyház",
    "Vác",
    "Gödöllő",
    "Isaszeg",
    // East (Pest county)
    "Pécel",
    "Maglód",
    "Vecsés",
    "Gyál",
    "Üllő",
    "Monor",
    "Vasad",
    "Péteri",
    // South (csepel + délpest)
    "Szigetszentmiklós",
    "Tököl",
    "Halásztelek",
    "Dunavarsány",
    "Dunaharaszti",
    "Taksony",
    // West-southwest (Fejér county border, still <60km from Bp)
    "Alcsútdoboz",
    "Bicske",
    "Felcsút",
    "Etyek",
    "Tatabánya",
  ],

  // Balaton — both shores + Veszprém / Tapolca hinterland.
  balaton: [
    "Balatonfüred",
    "Balatonalmádi",
    "Balatonkenese",
    "Csopak",
    "Tihany",
    "Siófok",
    "Zamárdi",
    "Balatonföldvár",
    "Balatonszárszó",
    "Balatonszemes",
    "Balatonlelle",
    "Balatonboglár",
    "Fonyód",
    "Balatonfenyves",
    "Balatonberény",
    "Keszthely",
    "Hévíz",
    "Gyenesdiás",
    "Cserszegtomaj",
    "Tapolca",
    "Veszprém",
    "Nagyvázsony",
  ],

  // Debrecen + Hajdú-Bihar.
  debrecen: [
    "Debrecen",
    "Hajdúböszörmény",
    "Hajdúszoboszló",
    "Hajdúnánás",
    "Balmazújváros",
    "Berettyóújfalu",
    "Hortobágy",
  ],

  // Szeged + Csongrád.
  szeged: ["Szeged", "Hódmezővásárhely", "Makó", "Mórahalom", "Kistelek", "Szentes"],

  // Pécs + Baranya / Villány wine region (popular destination weddings).
  pecs: ["Pécs", "Komló", "Mohács", "Szigetvár", "Siklós", "Villány", "Harkány"],

  // Győr + Sopron + Mosonmagyaróvár (north-west Hungary).
  gyor: ["Győr", "Mosonmagyaróvár", "Csorna", "Sopron", "Pannonhalma", "Fertőd"],

  // Miskolc + Eger + Bükk / Tokaj.
  miskolc: [
    "Miskolc",
    "Eger",
    "Tiszaújváros",
    "Mezőkövesd",
    "Kazincbarcika",
    "Sárospatak",
    "Tokaj",
  ],

  // Székesfehérvár + Dunaújváros.
  szekesfehervar: ["Székesfehérvár", "Mór", "Dunaújváros", "Lajoskomárom"],

  // Kecskemét + Bács-Kiskun.
  kecskemet: ["Kecskemét", "Nagykőrös", "Kiskunfélegyháza", "Lajosmizse"],

  // Szolnok + Jászság / Tiszafüred.
  szolnok: ["Szolnok", "Jászberény", "Tiszafüred", "Karcag", "Mezőtúr"],

  // Nyíregyháza + Szabolcs-Szatmár.
  nyiregyhaza: ["Nyíregyháza", "Mátészalka", "Vásárosnamény", "Kisvárda"],
};

/** Normalized lookup: city name (folded) → array of metro keys it belongs
 *  to. A single city may be in multiple groups (e.g. a border town near
 *  two hubs) — we store the union, and the haystack appends every key. */
const CITY_TO_GROUPS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [key, cities] of Object.entries(METRO_AREAS_HU_RAW)) {
    for (const city of cities) {
      const norm = normalize(city);
      const list = m.get(norm) ?? [];
      list.push(key);
      m.set(norm, list);
    }
  }
  return m;
})();

/** Space-separated list of metro keys (or "" if the city isn't in any
 *  group). Designed to be concatenated into a normalized search haystack
 *  so that `hay.includes("budapest")` matches every Bp-metro supplier,
 *  not just the literal city of Budapest. The output is already
 *  normalized — append it directly, no further folding needed. */
export function metroKeysForCity(city: string | null | undefined): string {
  if (!city) return "";
  const list = CITY_TO_GROUPS.get(normalize(city));
  return list ? list.join(" ") : "";
}
