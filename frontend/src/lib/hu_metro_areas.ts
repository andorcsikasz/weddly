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
      { city: "Páty", km: 15 },
      { city: "Solymár", km: 15 },
      { city: "Törökbálint", km: 15 },
      { city: "Diósd", km: 18 },
      { city: "Biatorbágy", km: 20 },
      { city: "Érd", km: 20 },
      { city: "Pilisborosjenő", km: 20 },
      { city: "Telki", km: 22 },
      { city: "Pilisvörösvár", km: 22 },
      { city: "Herceghalom", km: 22 },
      { city: "Tárnok", km: 25 },
      { city: "Százhalombatta", km: 25 },
      { city: "Sóskút", km: 25 },
      { city: "Zsámbék", km: 25 },
      { city: "Perbál", km: 25 },
      { city: "Piliscsaba", km: 25 },
      { city: "Tinnye", km: 25 },
      { city: "Tök", km: 28 },
      { city: "Pilisszentkereszt", km: 28 },
      { city: "Pilisszántó", km: 28 },
      { city: "Mány", km: 30 },
      // North (Danube bend)
      { city: "Dunakeszi", km: 18 },
      { city: "Fót", km: 20 },
      { city: "Pomáz", km: 20 },
      { city: "Csömör", km: 22 },
      { city: "Kistarcsa", km: 22 },
      { city: "Kerepes", km: 22 },
      { city: "Nagytarcsa", km: 22 },
      { city: "Szentendre", km: 22 },
      { city: "Göd", km: 25 },
      { city: "Sződliget", km: 25 },
      { city: "Sződ", km: 25 },
      { city: "Csomád", km: 25 },
      { city: "Mogyoród", km: 25 },
      { city: "Vácrátót", km: 30 },
      { city: "Veresegyház", km: 30 },
      { city: "Gödöllő", km: 30 },
      { city: "Leányfalu", km: 30 },
      { city: "Bag", km: 35 },
      { city: "Tahitótfalu", km: 35 },
      { city: "Vác", km: 35 },
      { city: "Galgamácsa", km: 40 },
      { city: "Aszód", km: 40 },
      { city: "Visegrád", km: 40 },
      { city: "Dorog", km: 40 },
      { city: "Esztergom", km: 50 },
      // East (Pest county)
      { city: "Vecsés", km: 18 },
      { city: "Gyál", km: 20 },
      { city: "Pécel", km: 22 },
      { city: "Maglód", km: 25 },
      { city: "Üllő", km: 30 },
      { city: "Mende", km: 30 },
      { city: "Isaszeg", km: 30 },
      { city: "Péteri", km: 32 },
      { city: "Tura", km: 45 },
      { city: "Zsámbok", km: 45 },
      { city: "Dány", km: 40 },
      { city: "Valkó", km: 40 },
      { city: "Gomba", km: 40 },
      { city: "Monor", km: 35 },
      { city: "Vasad", km: 40 },
      { city: "Pilis", km: 40 },
      { city: "Albertirsa", km: 50 },
      { city: "Cegléd", km: 60 },
      // South (csepel + délpest)
      { city: "Szigetszentmiklós", km: 20 },
      { city: "Halásztelek", km: 22 },
      { city: "Dunaharaszti", km: 22 },
      { city: "Tököl", km: 28 },
      { city: "Taksony", km: 28 },
      { city: "Dunavarsány", km: 30 },
      // West-southwest (Fejér county border, still <60km from Bp)
      { city: "Etyek", km: 30 },
      { city: "Martonvásár", km: 30 },
      { city: "Tordas", km: 35 },
      { city: "Bicske", km: 35 },
      { city: "Felcsút", km: 40 },
      { city: "Alcsútdoboz", km: 45 },
      { city: "Velence", km: 45 },
      { city: "Gárdony", km: 45 },
      { city: "Sukoró", km: 45 },
      { city: "Pákozd", km: 50 },
      { city: "Agárd", km: 50 },
      { city: "Pázmánd", km: 45 },
      { city: "Lovasberény", km: 50 },
      { city: "Csákvár", km: 50 },
      { city: "Tatabánya", km: 60 },
      { city: "Tata", km: 65 },
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

/** Find the metro group whose anchor OR any of its towns matches the
 *  user's free-text query. Match precedence:
 *    1. Exact match on anchor name (e.g. "budapest" → Budapest group)
 *    2. Exact match on any non-anchor city (e.g. "zsambek" → Bp group)
 *    3. Prefix match on anchor for queries ≥ 4 chars ("buda" → Bp)
 *
 *  Returns null when no town in the dictionary matches. The function is
 *  internal — exposed indirectly via `metroKeysForQuery` and
 *  `distanceContextForQuery`. */
function findMatchingGroup(normalizedQuery: string): MetroGroup | null {
  if (!normalizedQuery) return null;

  // 1. Exact anchor name match
  const anchorHit = ANCHOR_TO_GROUP.get(normalizedQuery);
  if (anchorHit) return anchorHit;

  // 2. Exact city-name match anywhere in any group. First hit wins —
  //    a city in multiple groups (rare; e.g. border town) uses the
  //    first group it was declared in.
  for (const g of METRO_AREAS_HU) {
    for (const c of g.cities) {
      if (normalize(c.city) === normalizedQuery) return g;
    }
  }

  // 3. Prefix match on anchor name (≥ 4 chars so "bu" doesn't match Bp)
  if (normalizedQuery.length >= 4) {
    for (const g of METRO_AREAS_HU) {
      if (normalize(g.anchor).startsWith(normalizedQuery)) return g;
    }
  }

  return null;
}

/** If the user's free-text query resolves to a known metro (either by
 *  typing the anchor — "Budapest" — or any town within it — "Zsámbék",
 *  "Vasad", "Alcsútdoboz"), return that group's tag(s) so the supplier
 *  filter can match on the metro key rather than the literal town name.
 *
 *  Used in conjunction with `metroKeysForCity(s.city)`, which writes the
 *  same tag into each supplier's haystack — so a query "Zsámbék" expands
 *  to "budapest", which is present on every Bp-metro supplier. */
export function metroKeysForQuery(normalizedQuery: string): string[] {
  const g = findMatchingGroup(normalizedQuery);
  return g ? [g.key] : [];
}

/** When the user's free-text query maps to a known anchor city (Budapest,
 *  Pécs, Balatonfüred, …), this returns the canonical anchor label and
 *  the approximate km from that anchor to the given supplier city. Cards
 *  use this to render a "+45 km" hint so couples notice which results
 *  are nearby-but-not-in-town.
 *
 *  Returns `null` when:
 *  - the query is empty,
 *  - the query doesn't match any anchor (e.g. user typed a supplier name,
 *    a non-anchor town like "Zsámbék", or a region key like "balaton"),
 *  - the supplier is the anchor itself (km = 0 → no badge worth showing),
 *  - the supplier is in a different metro group from the anchor.
 *
 *  Non-anchor city queries don't surface a distance because the badge
 *  would need to read "+X km from Zsámbék" — but we only store km from
 *  the group's anchor, so the reference would be wrong. The banner
 *  above the result list (rendered by SuppliersPage when expansion
 *  triggered) provides the "showing $anchor area" context instead. */
export function distanceContextForQuery(
  normalizedQuery: string,
  supplierCity: string | null | undefined,
): { anchorLabel: string; km: number } | null {
  if (!normalizedQuery || !supplierCity) return null;

  // Distance badge only fires for anchor-name queries — see jsdoc above.
  const anchorHit = ANCHOR_TO_GROUP.get(normalizedQuery);
  const prefixHit =
    !anchorHit && normalizedQuery.length >= 4
      ? METRO_AREAS_HU.find((g) => normalize(g.anchor).startsWith(normalizedQuery))
      : null;
  const group = anchorHit ?? prefixHit;
  if (!group) return null;

  const supplierNorm = normalize(supplierCity);
  const entry = group.cities.find((c) => normalize(c.city) === supplierNorm);
  if (!entry || entry.km <= 0) return null;

  return { anchorLabel: group.anchor, km: entry.km };
}

/** When the query resolved via metro expansion (user typed a town that
 *  isn't an anchor — "Zsámbék" → Bp metro), return the anchor label so
 *  the page can show a "showing $anchor area" banner above the results.
 *  Returns null when the query matches the anchor directly (no banner
 *  needed — the user typed exactly what they meant). */
export function nearbyExpansionLabel(normalizedQuery: string): string | null {
  if (!normalizedQuery) return null;
  // Direct anchor hit → no banner needed
  if (ANCHOR_TO_GROUP.has(normalizedQuery)) return null;
  // Prefix hit on an anchor name → also "direct enough", no banner
  if (
    normalizedQuery.length >= 4 &&
    METRO_AREAS_HU.some((g) => normalize(g.anchor).startsWith(normalizedQuery))
  ) {
    return null;
  }
  // Non-anchor city match → show banner
  const group = findMatchingGroup(normalizedQuery);
  return group ? group.anchor : null;
}
