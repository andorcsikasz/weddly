// Hungarian "metro area" groups for booking.com-style nearby-cities search.
//
// When a couple types "Budapest" into the supplier-search bar, they expect
// to see suppliers in the wider agglomeration (Vasad, Érd, Monor, Vác,
// Alcsútdoboz, …) — not just the literal city of Budapest. This module
// owns that mapping AND the approximate driving distances used to render
// a small "~45 km" hint on cards that are nearby but not in the typed
// city.
//
// Three consumers in SuppliersPage:
//   1. `metroKeysForCity(s.city)` is appended to the search haystack, so
//      a query like "budapest" matches every supplier whose city belongs
//      to the Budapest group.
//   2. `metroKeysForQuery(query)` adds the reverse direction: typing a
//      non-anchor town ("Zsámbék") also expands to the metro key
//      ("budapest") so the supplier filter catches the whole group.
//   3. `distanceContextForQuery(query, s.city)` returns `{ fromLabel, km }`
//      for ANY known query town — Haversine between the two coordinate
//      pairs. Lets the card show "~45 km" from the actual typed city,
//      not just the metro's anchor.
//
// We picked manual coords + Haversine over the alternatives:
//   - Postal-code prefix: HU prefixes don't cleanly map to wedding-
//     relevant metros (county capitals share prefixes with villages
//     50+ km away).
//   - Anchor-bridge approximation (`|km_a - km_b|`): wildly wrong for
//     cities on opposite sides of the anchor (Vác north / Pázmánd
//     south-west, both ~45 km from Bp but ~80 km apart).
//
// Coordinates are rounded to 2 decimals (~1 km precision) — they're a
// UX hint, not a routing engine. The Haversine result is rounded to a
// 5 km bucket for display so couples don't read "47 km" as a promise.
//
// Haversine is crow-flies, so it under-reports drive time across natural
// barriers — Siófok ↔ Tihany reads ~5 km here but is ~30 km by road (no
// Balaton bridge), and Danube-bend crossings are similar. The 5-km bucket
// + the "~" prefix in the UI already disclaim this; flagged here so future
// regional fudge factors have a home.

/** Diacritic-folded lower-case form — matches the same normalization
 *  used in SuppliersPage so haystack assembly stays consistent. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

interface MetroCity {
  /** Canonical-case display name. */
  city: string;
  /** Latitude in WGS84, rounded to ~1 km precision. */
  lat: number;
  /** Longitude in WGS84, rounded to ~1 km precision. */
  lng: number;
}

interface MetroGroup {
  /** Lower-case tag used in the search haystack (e.g. "budapest"). */
  key: string;
  /** Canonical-case city name used as the reference point for the
   *  "Near {town} — showing the {anchor} area" banner. */
  anchor: string;
  /** Every town in this metro (including the anchor). */
  cities: MetroCity[];
}

const METRO_AREAS_HU: MetroGroup[] = [
  {
    key: "budapest",
    anchor: "Budapest",
    cities: [
      { city: "Budapest", lat: 47.5, lng: 19.04 },
      // West / Buda hills
      { city: "Budaörs", lat: 47.46, lng: 18.96 },
      { city: "Budakeszi", lat: 47.51, lng: 18.93 },
      { city: "Páty", lat: 47.52, lng: 18.83 },
      { city: "Solymár", lat: 47.59, lng: 18.96 },
      { city: "Törökbálint", lat: 47.43, lng: 18.92 },
      { city: "Diósd", lat: 47.41, lng: 18.95 },
      { city: "Biatorbágy", lat: 47.47, lng: 18.82 },
      { city: "Érd", lat: 47.39, lng: 18.92 },
      { city: "Pilisborosjenő", lat: 47.61, lng: 18.97 },
      { city: "Telki", lat: 47.55, lng: 18.84 },
      { city: "Pilisvörösvár", lat: 47.62, lng: 18.92 },
      { city: "Herceghalom", lat: 47.5, lng: 18.74 },
      { city: "Tárnok", lat: 47.36, lng: 18.85 },
      { city: "Százhalombatta", lat: 47.32, lng: 18.93 },
      { city: "Sóskút", lat: 47.38, lng: 18.82 },
      { city: "Zsámbék", lat: 47.55, lng: 18.71 },
      { city: "Perbál", lat: 47.59, lng: 18.79 },
      { city: "Piliscsaba", lat: 47.63, lng: 18.85 },
      { city: "Tinnye", lat: 47.62, lng: 18.79 },
      { city: "Tök", lat: 47.59, lng: 18.77 },
      { city: "Pilisszentkereszt", lat: 47.69, lng: 18.91 },
      { city: "Pilisszántó", lat: 47.66, lng: 18.9 },
      { city: "Mány", lat: 47.52, lng: 18.65 },
      // North (Danube bend)
      { city: "Dunakeszi", lat: 47.63, lng: 19.14 },
      { city: "Fót", lat: 47.62, lng: 19.19 },
      { city: "Pomáz", lat: 47.65, lng: 19.03 },
      { city: "Csömör", lat: 47.55, lng: 19.24 },
      { city: "Kistarcsa", lat: 47.54, lng: 19.26 },
      { city: "Kerepes", lat: 47.56, lng: 19.27 },
      { city: "Nagytarcsa", lat: 47.52, lng: 19.27 },
      { city: "Szentendre", lat: 47.66, lng: 19.08 },
      { city: "Göd", lat: 47.69, lng: 19.13 },
      { city: "Sződliget", lat: 47.73, lng: 19.14 },
      { city: "Sződ", lat: 47.71, lng: 19.16 },
      { city: "Csomád", lat: 47.65, lng: 19.21 },
      { city: "Mogyoród", lat: 47.59, lng: 19.24 },
      { city: "Vácrátót", lat: 47.71, lng: 19.23 },
      { city: "Veresegyház", lat: 47.65, lng: 19.27 },
      { city: "Gödöllő", lat: 47.59, lng: 19.36 },
      { city: "Leányfalu", lat: 47.71, lng: 19.07 },
      { city: "Bag", lat: 47.66, lng: 19.48 },
      { city: "Tahitótfalu", lat: 47.76, lng: 19.1 },
      { city: "Vác", lat: 47.78, lng: 19.13 },
      { city: "Galgamácsa", lat: 47.69, lng: 19.36 },
      { city: "Aszód", lat: 47.65, lng: 19.48 },
      { city: "Visegrád", lat: 47.79, lng: 18.97 },
      { city: "Dorog", lat: 47.72, lng: 18.73 },
      { city: "Esztergom", lat: 47.79, lng: 18.74 },
      // East (Pest county)
      { city: "Vecsés", lat: 47.41, lng: 19.27 },
      { city: "Gyál", lat: 47.39, lng: 19.22 },
      { city: "Pécel", lat: 47.49, lng: 19.36 },
      { city: "Maglód", lat: 47.45, lng: 19.39 },
      { city: "Üllő", lat: 47.39, lng: 19.36 },
      { city: "Mende", lat: 47.43, lng: 19.44 },
      { city: "Isaszeg", lat: 47.53, lng: 19.41 },
      { city: "Péteri", lat: 47.4, lng: 19.46 },
      { city: "Tura", lat: 47.61, lng: 19.6 },
      { city: "Zsámbok", lat: 47.55, lng: 19.62 },
      { city: "Dány", lat: 47.51, lng: 19.55 },
      { city: "Valkó", lat: 47.55, lng: 19.51 },
      { city: "Gomba", lat: 47.39, lng: 19.51 },
      { city: "Monor", lat: 47.35, lng: 19.45 },
      { city: "Vasad", lat: 47.3, lng: 19.48 },
      { city: "Pilis", lat: 47.3, lng: 19.55 },
      { city: "Albertirsa", lat: 47.24, lng: 19.62 },
      { city: "Cegléd", lat: 47.18, lng: 19.8 },
      // South (csepel + délpest)
      { city: "Szigetszentmiklós", lat: 47.34, lng: 19.04 },
      { city: "Halásztelek", lat: 47.37, lng: 18.96 },
      { city: "Dunaharaszti", lat: 47.36, lng: 19.1 },
      { city: "Tököl", lat: 47.32, lng: 18.97 },
      { city: "Taksony", lat: 47.32, lng: 19.09 },
      { city: "Dunavarsány", lat: 47.3, lng: 19.04 },
      // West-southwest (Fejér county border, still <60km from Bp)
      { city: "Etyek", lat: 47.45, lng: 18.65 },
      { city: "Martonvásár", lat: 47.32, lng: 18.78 },
      { city: "Tordas", lat: 47.32, lng: 18.74 },
      { city: "Bicske", lat: 47.49, lng: 18.63 },
      { city: "Felcsút", lat: 47.45, lng: 18.59 },
      { city: "Alcsútdoboz", lat: 47.42, lng: 18.6 },
      { city: "Velence", lat: 47.24, lng: 18.65 },
      { city: "Gárdony", lat: 47.21, lng: 18.62 },
      { city: "Sukoró", lat: 47.24, lng: 18.61 },
      { city: "Pákozd", lat: 47.22, lng: 18.56 },
      { city: "Agárd", lat: 47.2, lng: 18.59 },
      { city: "Pázmánd", lat: 47.28, lng: 18.7 },
      { city: "Lovasberény", lat: 47.3, lng: 18.55 },
      { city: "Csákvár", lat: 47.4, lng: 18.46 },
      { city: "Tatabánya", lat: 47.57, lng: 18.4 },
      { city: "Tata", lat: 47.65, lng: 18.32 },
    ],
  },

  {
    key: "balaton",
    anchor: "Balatonfüred",
    cities: [
      { city: "Balatonfüred", lat: 46.96, lng: 17.88 },
      { city: "Tihany", lat: 46.91, lng: 17.89 },
      { city: "Csopak", lat: 47.0, lng: 17.95 },
      { city: "Balatonalmádi", lat: 47.03, lng: 18.01 },
      { city: "Balatonkenese", lat: 47.04, lng: 18.1 },
      { city: "Veszprém", lat: 47.1, lng: 17.91 },
      // South shore (across the lake)
      { city: "Siófok", lat: 46.91, lng: 18.05 },
      { city: "Zamárdi", lat: 46.88, lng: 17.96 },
      { city: "Balatonföldvár", lat: 46.84, lng: 17.88 },
      { city: "Balatonszárszó", lat: 46.82, lng: 17.83 },
      { city: "Balatonszemes", lat: 46.81, lng: 17.79 },
      { city: "Balatonlelle", lat: 46.78, lng: 17.69 },
      { city: "Balatonboglár", lat: 46.77, lng: 17.66 },
      { city: "Fonyód", lat: 46.75, lng: 17.55 },
      { city: "Balatonfenyves", lat: 46.72, lng: 17.47 },
      { city: "Balatonberény", lat: 46.71, lng: 17.34 },
      // West Balaton
      { city: "Tapolca", lat: 46.88, lng: 17.43 },
      { city: "Nagyvázsony", lat: 46.98, lng: 17.69 },
      { city: "Gyenesdiás", lat: 46.79, lng: 17.3 },
      { city: "Cserszegtomaj", lat: 46.79, lng: 17.23 },
      { city: "Keszthely", lat: 46.77, lng: 17.24 },
      { city: "Hévíz", lat: 46.79, lng: 17.19 },
    ],
  },

  {
    key: "debrecen",
    anchor: "Debrecen",
    cities: [
      { city: "Debrecen", lat: 47.53, lng: 21.63 },
      { city: "Hajdúböszörmény", lat: 47.67, lng: 21.51 },
      { city: "Balmazújváros", lat: 47.61, lng: 21.34 },
      { city: "Hajdúszoboszló", lat: 47.45, lng: 21.4 },
      { city: "Hajdúnánás", lat: 47.85, lng: 21.43 },
      { city: "Hortobágy", lat: 47.58, lng: 21.15 },
      { city: "Berettyóújfalu", lat: 47.22, lng: 21.55 },
    ],
  },

  {
    key: "szeged",
    anchor: "Szeged",
    cities: [
      { city: "Szeged", lat: 46.25, lng: 20.15 },
      { city: "Hódmezővásárhely", lat: 46.42, lng: 20.33 },
      { city: "Mórahalom", lat: 46.22, lng: 19.88 },
      { city: "Makó", lat: 46.22, lng: 20.48 },
      { city: "Kistelek", lat: 46.47, lng: 19.97 },
      { city: "Szentes", lat: 46.65, lng: 20.27 },
    ],
  },

  {
    key: "pecs",
    anchor: "Pécs",
    cities: [
      { city: "Pécs", lat: 46.07, lng: 18.23 },
      { city: "Komló", lat: 46.2, lng: 18.27 },
      { city: "Siklós", lat: 45.85, lng: 18.3 },
      { city: "Harkány", lat: 45.86, lng: 18.23 },
      { city: "Villány", lat: 45.87, lng: 18.45 },
      { city: "Szigetvár", lat: 46.05, lng: 17.81 },
      { city: "Mohács", lat: 45.99, lng: 18.68 },
    ],
  },

  {
    key: "gyor",
    anchor: "Győr",
    cities: [
      { city: "Győr", lat: 47.69, lng: 17.63 },
      { city: "Pannonhalma", lat: 47.55, lng: 17.76 },
      { city: "Csorna", lat: 47.62, lng: 17.25 },
      { city: "Mosonmagyaróvár", lat: 47.87, lng: 17.27 },
      { city: "Sopron", lat: 47.69, lng: 16.59 },
      { city: "Fertőd", lat: 47.62, lng: 16.86 },
    ],
  },

  {
    key: "miskolc",
    anchor: "Miskolc",
    cities: [
      { city: "Miskolc", lat: 48.1, lng: 20.78 },
      { city: "Tiszaújváros", lat: 47.93, lng: 21.04 },
      { city: "Mezőkövesd", lat: 47.82, lng: 20.58 },
      { city: "Kazincbarcika", lat: 48.25, lng: 20.62 },
      { city: "Eger", lat: 47.9, lng: 20.37 },
      { city: "Sárospatak", lat: 48.32, lng: 21.57 },
      { city: "Tokaj", lat: 48.12, lng: 21.41 },
    ],
  },

  {
    key: "szekesfehervar",
    anchor: "Székesfehérvár",
    cities: [
      { city: "Székesfehérvár", lat: 47.19, lng: 18.42 },
      { city: "Mór", lat: 47.38, lng: 18.2 },
      { city: "Dunaújváros", lat: 46.96, lng: 18.94 },
      { city: "Lajoskomárom", lat: 46.84, lng: 18.34 },
    ],
  },

  {
    key: "kecskemet",
    anchor: "Kecskemét",
    cities: [
      { city: "Kecskemét", lat: 46.91, lng: 19.69 },
      { city: "Lajosmizse", lat: 47.02, lng: 19.56 },
      { city: "Nagykőrös", lat: 47.04, lng: 19.78 },
      { city: "Kiskunfélegyháza", lat: 46.71, lng: 19.85 },
    ],
  },

  {
    key: "szolnok",
    anchor: "Szolnok",
    cities: [
      { city: "Szolnok", lat: 47.18, lng: 20.2 },
      { city: "Jászberény", lat: 47.5, lng: 19.91 },
      { city: "Mezőtúr", lat: 47.0, lng: 20.63 },
      { city: "Karcag", lat: 47.32, lng: 20.93 },
      { city: "Tiszafüred", lat: 47.62, lng: 20.76 },
    ],
  },

  {
    key: "nyiregyhaza",
    anchor: "Nyíregyháza",
    cities: [
      { city: "Nyíregyháza", lat: 47.96, lng: 21.72 },
      { city: "Kisvárda", lat: 48.22, lng: 22.08 },
      { city: "Mátészalka", lat: 47.95, lng: 22.32 },
      { city: "Vásárosnamény", lat: 48.13, lng: 22.31 },
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

/** city (normalized) → full record (canonical name + coords + group).
 *  Used by `distanceContextForQuery` for fast O(1) lookup of both the
 *  query side and supplier side, and by `nearbyExpansionLabel` /
 *  `metroKeysForQuery` for "what group does this town belong to?". */
const CITY_TO_RECORD: Map<string, MetroCity & { groupKey: string }> = (() => {
  const m = new Map<string, MetroCity & { groupKey: string }>();
  for (const g of METRO_AREAS_HU) {
    for (const c of g.cities) {
      const norm = normalize(c.city);
      // First group wins on collisions — same convention as CITY_TO_KEYS.
      if (!m.has(norm)) {
        m.set(norm, { ...c, groupKey: g.key });
      }
    }
  }
  return m;
})();

/** anchor name (normalized) → group. Used internally to detect when a
 *  query exactly matches an anchor (which suppresses the "showing X area"
 *  banner — the user already typed the area name). */
const ANCHOR_TO_GROUP: Map<string, MetroGroup> = (() => {
  const m = new Map<string, MetroGroup>();
  for (const g of METRO_AREAS_HU) m.set(normalize(g.anchor), g);
  return m;
})();

/** Earth radius in km, used by the inline Haversine. The frontend has
 *  no shared geo lib (backend keeps `lib/geo.ts` server-side), so we
 *  copy the formula — 7 lines, no dependency. */
const EARTH_RADIUS_KM = 6371;

function haversineKm(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Find the metro group whose anchor OR any of its towns matches the
 *  user's free-text query. Match precedence:
 *    1. Exact match on anchor name (e.g. "budapest" → Budapest group)
 *    2. Exact match on any non-anchor city (e.g. "zsambek" → Bp group)
 *    3. Prefix match on anchor for queries ≥ 4 chars ("buda" → Bp)
 *
 *  Returns null when no town in the dictionary matches. */
function findMatchingGroup(normalizedQuery: string): MetroGroup | null {
  if (!normalizedQuery) return null;

  const anchorHit = ANCHOR_TO_GROUP.get(normalizedQuery);
  if (anchorHit) return anchorHit;

  for (const g of METRO_AREAS_HU) {
    for (const c of g.cities) {
      if (normalize(c.city) === normalizedQuery) return g;
    }
  }

  if (normalizedQuery.length >= 4) {
    for (const g of METRO_AREAS_HU) {
      if (normalize(g.anchor).startsWith(normalizedQuery)) return g;
    }
  }

  return null;
}

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

/** If the user's free-text query resolves to a known metro (either by
 *  typing the anchor — "Budapest" — or any town within it — "Zsámbék",
 *  "Vasad", "Alcsútdoboz"), return that group's tag(s) so the supplier
 *  filter can match on the metro key rather than the literal town name. */
export function metroKeysForQuery(normalizedQuery: string): string[] {
  const g = findMatchingGroup(normalizedQuery);
  return g ? [g.key] : [];
}

/** When the typed query is a known town, compute approximate Haversine
 *  km between that town and the supplier's city. Returns the canonical
 *  query-town label and a 5-km-rounded distance, or null when:
 *  - the query isn't a known town (e.g. supplier name / blurb word),
 *  - the supplier's city is unknown to the dictionary,
 *  - both are in different metro groups (avoids "300 km" surprises if
 *    a Pécs supplier somehow slips into a Budapest result set),
 *  - distance rounds to 0 (the supplier is in the queried town itself
 *    — the address already says so, no badge needed). */
export function distanceContextForQuery(
  normalizedQuery: string,
  supplierCity: string | null | undefined,
): { fromLabel: string; km: number } | null {
  if (!normalizedQuery || !supplierCity) return null;

  const queryRec = CITY_TO_RECORD.get(normalizedQuery);
  // Allow anchor prefix-match too — "buda" → Budapest.
  const fallbackAnchorGroup =
    !queryRec && normalizedQuery.length >= 4
      ? METRO_AREAS_HU.find((g) => normalize(g.anchor).startsWith(normalizedQuery))
      : null;
  const fallbackAnchorCity = fallbackAnchorGroup
    ? fallbackAnchorGroup.cities.find(
        (c) => normalize(c.city) === normalize(fallbackAnchorGroup.anchor),
      )
    : null;
  const queryCoords = queryRec
    ? { city: queryRec.city, lat: queryRec.lat, lng: queryRec.lng, groupKey: queryRec.groupKey }
    : fallbackAnchorGroup && fallbackAnchorCity
      ? {
          city: fallbackAnchorGroup.anchor,
          lat: fallbackAnchorCity.lat,
          lng: fallbackAnchorCity.lng,
          groupKey: fallbackAnchorGroup.key,
        }
      : null;
  if (!queryCoords) return null;

  const supplierRec = CITY_TO_RECORD.get(normalize(supplierCity));
  if (!supplierRec) return null;

  // Same-metro guard. Two cities in different groups (Pécs supplier
  // surfacing for a Pázmánd query through some other match path)
  // shouldn't show a 300 km hint — that reads as a system error,
  // not a useful distance.
  if (queryCoords.groupKey !== supplierRec.groupKey) return null;

  const rawKm = haversineKm(queryCoords.lat, queryCoords.lng, supplierRec.lat, supplierRec.lng);
  // Round to 5 km buckets so the badge reads as an estimate, not a
  // routing-grade number. Min 5 km — anything below is "same town"
  // from the couple's perspective (and the supplier's address already
  // confirms it).
  const km = Math.round(rawKm / 5) * 5;
  if (km < 5) return null;

  return { fromLabel: queryCoords.city, km };
}

/** When the query resolved via metro expansion (user typed a town that
 *  isn't an anchor — "Zsámbék" → Bp metro), return the anchor label so
 *  the page can show a "showing $anchor area" banner above the results.
 *  Returns null when the query matches the anchor directly (no banner
 *  needed — the user typed exactly what they meant). */
export function nearbyExpansionLabel(normalizedQuery: string): string | null {
  if (!normalizedQuery) return null;
  if (ANCHOR_TO_GROUP.has(normalizedQuery)) return null;
  if (
    normalizedQuery.length >= 4 &&
    METRO_AREAS_HU.some((g) => normalize(g.anchor).startsWith(normalizedQuery))
  ) {
    return null;
  }
  const group = findMatchingGroup(normalizedQuery);
  return group ? group.anchor : null;
}
