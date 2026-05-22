// Hungarian "metro area" groups for booking.com-style nearby-cities search.
//
// When a couple types "Budapest" into the supplier-search bar, they expect
// to see suppliers in the wider agglomeration (Vasad, Érd, Monor, Vác,
// Alcsútdoboz, …) — not just the literal city of Budapest. This module
// owns that mapping AND the approximate km distances used to render a
// "+45 km" badge on cards that are nearby but not in the typed city.
//
// Two consumers in SuppliersPage:
//   1. `metroKeysForCity(s.city)` is appended to the search haystack, so
//      a query like "budapest" matches every supplier whose city belongs
//      to the Budapest group.
//   2. `distanceContextForQuery(query, s.city)` returns
//      `{ anchorLabel, km }` when the query maps to a known anchor city
//      (Budapest, Pécs, Debrecen, …) and the supplier is in the same
//      metro but a different town. The card shows a small "+45 km"
//      badge so couples see at a glance which results require travel.
//
// We picked a hand-curated dictionary over the two alternatives:
//   - Haversine: only ~45 curated venues have lat/lng + zero community
//     submissions have them, so distance filtering would silently drop
//     most of the directory.
//   - Postal-code prefix: HU prefixes don't cleanly map to wedding-
//     relevant metros (county capitals share their prefix with villages
//     50+ km away).
//
// Maintenance: add cities to an existing group as the directory grows;
// add a new top-level entry when a new region builds supplier density.
// `km` values are approximate driving distances (road, not crow-flies)
// and are deliberately rounded to 5 km — they're a UX hint, not a
// routing engine.

/** Diacritic-folded lower-case form — matches the same normalization
 *  used in SuppliersPage so haystack assembly stays consistent. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

interface MetroGroup {
  /** Lower-case tag used in the search haystack (e.g. "budapest"). */
  key: string;
  /** Canonical-case city name used as the reference point for distances
   *  and as the tooltip/badge label (e.g. "Budapest"). The anchor itself
   *  is part of `cities` with km = 0. */
  anchor: string;
  /** Every town in this metro and its approximate driving km from the
   *  anchor. The anchor MUST appear here with km = 0. */
  cities: Array<{ city: string; km: number }>;
}

const METRO_AREAS_HU: MetroGroup[] = [
  {
    key: "budapest",
    anchor: "Budapest",
    cities: [
      { city: "Budapest", km: 0 },
      // West / Buda hills
      { city: "Budaörs", km: 10 },
      { city: "Budakeszi", km: 15 },
      { city: "Solymár", km: 15 },
      { city: "Törökbálint", km: 15 },
      { city: "Diósd", km: 18 },
      { city: "Érd", km: 20 },
      { city: "Pilisborosjenő", km: 20 },
      { city: "Telki", km: 22 },
      { city: "Pilisvörösvár", km: 22 },
      { city: "Tárnok", km: 25 },
      { city: "Százhalombatta", km: 25 },
      { city: "Sóskút", km: 25 },
      // North (Danube bend)
      { city: "Dunakeszi", km: 18 },
      { city: "Fót", km: 20 },
      { city: "Pomáz", km: 20 },
      { city: "Csömör", km: 22 },
      { city: "Szentendre", km: 22 },
      { city: "Mogyoród", km: 25 },
      { city: "Veresegyház", km: 30 },
      { city: "Gödöllő", km: 30 },
      { city: "Leányfalu", km: 30 },
      { city: "Tahitótfalu", km: 35 },
      { city: "Vác", km: 35 },
      { city: "Visegrád", km: 40 },
      { city: "Esztergom", km: 50 },
      // East (Pest county)
      { city: "Vecsés", km: 18 },
      { city: "Gyál", km: 20 },
      { city: "Pécel", km: 22 },
      { city: "Maglód", km: 25 },
      { city: "Üllő", km: 30 },
      { city: "Isaszeg", km: 30 },
      { city: "Péteri", km: 32 },
      { city: "Monor", km: 35 },
      { city: "Vasad", km: 40 },
      // South (csepel + délpest)
      { city: "Szigetszentmiklós", km: 20 },
      { city: "Halásztelek", km: 22 },
      { city: "Dunaharaszti", km: 22 },
      { city: "Tököl", km: 28 },
      { city: "Taksony", km: 28 },
      { city: "Dunavarsány", km: 30 },
      // West-southwest (Fejér county border, still <60km from Bp)
      { city: "Etyek", km: 30 },
      { city: "Bicske", km: 35 },
      { city: "Felcsút", km: 40 },
      { city: "Alcsútdoboz", km: 45 },
      { city: "Tatabánya", km: 60 },
    ],
  },

  {
    key: "balaton",
    anchor: "Balatonfüred",
    cities: [
      { city: "Balatonfüred", km: 0 },
      { city: "Tihany", km: 12 },
      { city: "Csopak", km: 8 },
      { city: "Balatonalmádi", km: 12 },
      { city: "Balatonkenese", km: 20 },
      { city: "Veszprém", km: 15 },
      // South shore (across the lake)
      { city: "Siófok", km: 35 },
      { city: "Zamárdi", km: 40 },
      { city: "Balatonföldvár", km: 45 },
      { city: "Balatonszárszó", km: 50 },
      { city: "Balatonszemes", km: 55 },
      { city: "Balatonlelle", km: 60 },
      { city: "Balatonboglár", km: 65 },
      { city: "Fonyód", km: 70 },
      { city: "Balatonfenyves", km: 75 },
      { city: "Balatonberény", km: 80 },
      // West Balaton
      { city: "Tapolca", km: 30 },
      { city: "Nagyvázsony", km: 25 },
      { city: "Gyenesdiás", km: 45 },
      { city: "Cserszegtomaj", km: 50 },
      { city: "Keszthely", km: 50 },
      { city: "Hévíz", km: 55 },
    ],
  },

  {
    key: "debrecen",
    anchor: "Debrecen",
    cities: [
      { city: "Debrecen", km: 0 },
      { city: "Hajdúböszörmény", km: 20 },
      { city: "Balmazújváros", km: 25 },
      { city: "Hajdúszoboszló", km: 25 },
      { city: "Hajdúnánás", km: 35 },
      { city: "Hortobágy", km: 40 },
      { city: "Berettyóújfalu", km: 45 },
    ],
  },

  {
    key: "szeged",
    anchor: "Szeged",
    cities: [
      { city: "Szeged", km: 0 },
      { city: "Hódmezővásárhely", km: 25 },
      { city: "Mórahalom", km: 25 },
      { city: "Makó", km: 30 },
      { city: "Kistelek", km: 30 },
      { city: "Szentes", km: 50 },
    ],
  },

  {
    key: "pecs",
    anchor: "Pécs",
    cities: [
      { city: "Pécs", km: 0 },
      { city: "Komló", km: 25 },
      { city: "Siklós", km: 30 },
      { city: "Harkány", km: 35 },
      { city: "Villány", km: 35 },
      { city: "Szigetvár", km: 35 },
      { city: "Mohács", km: 50 },
    ],
  },

  {
    key: "gyor",
    anchor: "Győr",
    cities: [
      { city: "Győr", km: 0 },
      { city: "Pannonhalma", km: 20 },
      { city: "Csorna", km: 35 },
      { city: "Mosonmagyaróvár", km: 40 },
      { city: "Sopron", km: 80 },
      { city: "Fertőd", km: 75 },
    ],
  },

  {
    key: "miskolc",
    anchor: "Miskolc",
    cities: [
      { city: "Miskolc", km: 0 },
      { city: "Tiszaújváros", km: 30 },
      { city: "Mezőkövesd", km: 35 },
      { city: "Kazincbarcika", km: 25 },
      { city: "Eger", km: 60 },
      { city: "Sárospatak", km: 70 },
      { city: "Tokaj", km: 50 },
    ],
  },

  {
    key: "szekesfehervar",
    anchor: "Székesfehérvár",
    cities: [
      { city: "Székesfehérvár", km: 0 },
      { city: "Mór", km: 30 },
      { city: "Dunaújváros", km: 50 },
      { city: "Lajoskomárom", km: 45 },
    ],
  },

  {
    key: "kecskemet",
    anchor: "Kecskemét",
    cities: [
      { city: "Kecskemét", km: 0 },
      { city: "Lajosmizse", km: 20 },
      { city: "Nagykőrös", km: 20 },
      { city: "Kiskunfélegyháza", km: 30 },
    ],
  },

  {
    key: "szolnok",
    anchor: "Szolnok",
    cities: [
      { city: "Szolnok", km: 0 },
      { city: "Jászberény", km: 30 },
      { city: "Mezőtúr", km: 50 },
      { city: "Karcag", km: 55 },
      { city: "Tiszafüred", km: 70 },
    ],
  },

  {
    key: "nyiregyhaza",
    anchor: "Nyíregyháza",
    cities: [
      { city: "Nyíregyháza", km: 0 },
      { city: "Kisvárda", km: 50 },
      { city: "Mátészalka", km: 55 },
      { city: "Vásárosnamény", km: 70 },
    ],
  },
];

/** city (normalized) → list of metro keys it belongs to. Multi-group
 *  cities (border towns) are stored under each group they're in. */
const CITY_TO_KEYS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const g of METRO_AREAS_HU) {
    for (const c of g.cities) {
      const norm = normalize(c.city);
      const list = m.get(norm) ?? [];
      list.push(g.key);
      m.set(norm, list);
    }
  }
  return m;
})();

/** anchor name (normalized) → group. Used by `distanceContextForQuery`
 *  to detect when the user's query is "this is the city I'm searching
 *  from" rather than just text inside a blurb. */
const ANCHOR_TO_GROUP: Map<string, MetroGroup> = (() => {
  const m = new Map<string, MetroGroup>();
  for (const g of METRO_AREAS_HU) m.set(normalize(g.anchor), g);
  return m;
})();

/** Space-separated list of metro keys (or "" if the city isn't in any
 *  group). Designed to be concatenated into a normalized search haystack
 *  so that `hay.includes("budapest")` matches every Bp-metro supplier,
 *  not just the literal city of Budapest. The output is already
 *  normalized — append it directly, no further folding needed. */
export function metroKeysForCity(city: string | null | undefined): string {
  if (!city) return "";
  const list = CITY_TO_KEYS.get(normalize(city));
  return list ? list.join(" ") : "";
}

/** When the user's free-text query maps to a known anchor city (Budapest,
 *  Pécs, Balatonfüred, …), this returns the canonical anchor label and
 *  the approximate km from that anchor to the given supplier city. Cards
 *  use this to render a "+45 km" hint so couples notice which results
 *  are nearby-but-not-in-town.
 *
 *  Returns `null` in three cases:
 *  - the query is empty,
 *  - the query doesn't match any anchor (e.g. user typed a supplier name
 *    or a region key like "balaton"),
 *  - the supplier is the anchor itself (km = 0 → no badge worth showing),
 *  - the supplier is in a different metro group from the anchor.
 *
 *  The query is matched against the anchor name (folded) as an exact match
 *  OR a "starts with" prefix of length ≥ 4 — so "buda" → Budapest works
 *  but a 2-char fragment like "bu" doesn't accidentally anchor. */
export function distanceContextForQuery(
  normalizedQuery: string,
  supplierCity: string | null | undefined,
): { anchorLabel: string; km: number } | null {
  if (!normalizedQuery || !supplierCity) return null;

  // Find the anchor whose normalized name matches the query.
  let matchedGroup: MetroGroup | null = null;
  for (const [anchorNorm, g] of ANCHOR_TO_GROUP) {
    if (anchorNorm === normalizedQuery) {
      matchedGroup = g;
      break;
    }
    if (normalizedQuery.length >= 4 && anchorNorm.startsWith(normalizedQuery)) {
      matchedGroup = g;
      // keep looping — exact match wins over prefix
    }
  }
  if (!matchedGroup) return null;

  const supplierNorm = normalize(supplierCity);
  const entry = matchedGroup.cities.find((c) => normalize(c.city) === supplierNorm);
  if (!entry || entry.km <= 0) return null;

  return { anchorLabel: matchedGroup.anchor, km: entry.km };
}
