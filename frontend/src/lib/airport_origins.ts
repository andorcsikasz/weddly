// Curated list of major hub airports a honeymooner might realistically depart
// from. Powers the origin selector autocomplete on /app/honeymoon — typing
// "Buda" surfaces "BUD — Budapest, Hungary", and HU-locale aliases like
// "Bécs" → VIE keep the matcher friendly without forcing English city names.
//
// Keep this list focused. It's not an exhaustive airport database — every
// extra entry is bundle bytes for an autocomplete most users only use once.
// Add a row only when a real honeymoon-departure use case shows up.

export interface AirportOrigin {
  iata: string;
  city: string;
  country: string;
  /** Optional non-English city names that should also match this airport
   *  (e.g. "Bécs" for Vienna, "München" for Munich). */
  aliases?: string[];
}

export const AIRPORT_ORIGINS: AirportOrigin[] = [
  // Central / Eastern Europe
  { iata: "BUD", city: "Budapest", country: "Hungary" },
  { iata: "VIE", city: "Vienna", country: "Austria", aliases: ["Bécs", "Wien"] },
  { iata: "PRG", city: "Prague", country: "Czechia", aliases: ["Praha", "Prága"] },
  { iata: "WAW", city: "Warsaw", country: "Poland", aliases: ["Warszawa", "Varsó"] },
  { iata: "KRK", city: "Kraków", country: "Poland", aliases: ["Krakkó"] },
  { iata: "BTS", city: "Bratislava", country: "Slovakia", aliases: ["Pozsony"] },
  { iata: "OTP", city: "Bucharest", country: "Romania", aliases: ["București", "Bukarest"] },
  { iata: "SOF", city: "Sofia", country: "Bulgaria", aliases: ["Szófia"] },
  { iata: "BEG", city: "Belgrade", country: "Serbia", aliases: ["Beograd", "Belgrád"] },
  { iata: "ZAG", city: "Zagreb", country: "Croatia", aliases: ["Zágráb"] },
  { iata: "LJU", city: "Ljubljana", country: "Slovenia" },

  // Western Europe
  { iata: "LHR", city: "London Heathrow", country: "United Kingdom", aliases: ["London"] },
  { iata: "LGW", city: "London Gatwick", country: "United Kingdom" },
  { iata: "STN", city: "London Stansted", country: "United Kingdom" },
  { iata: "MAN", city: "Manchester", country: "United Kingdom" },
  { iata: "EDI", city: "Edinburgh", country: "United Kingdom" },
  { iata: "DUB", city: "Dublin", country: "Ireland" },
  { iata: "CDG", city: "Paris Charles de Gaulle", country: "France", aliases: ["Paris", "Párizs"] },
  { iata: "ORY", city: "Paris Orly", country: "France" },
  { iata: "NCE", city: "Nice", country: "France", aliases: ["Nizza"] },
  { iata: "LYS", city: "Lyon", country: "France" },
  { iata: "MRS", city: "Marseille", country: "France" },
  { iata: "AMS", city: "Amsterdam", country: "Netherlands" },
  { iata: "BRU", city: "Brussels", country: "Belgium", aliases: ["Brüsszel"] },
  { iata: "LUX", city: "Luxembourg", country: "Luxembourg" },
  { iata: "FRA", city: "Frankfurt", country: "Germany" },
  { iata: "MUC", city: "Munich", country: "Germany", aliases: ["München"] },
  { iata: "BER", city: "Berlin", country: "Germany" },
  { iata: "HAM", city: "Hamburg", country: "Germany" },
  { iata: "DUS", city: "Düsseldorf", country: "Germany", aliases: ["Duesseldorf"] },
  { iata: "ZRH", city: "Zurich", country: "Switzerland", aliases: ["Zürich"] },
  { iata: "GVA", city: "Geneva", country: "Switzerland", aliases: ["Genève", "Genf"] },

  // Iberia + Mediterranean
  { iata: "MAD", city: "Madrid", country: "Spain" },
  { iata: "BCN", city: "Barcelona", country: "Spain" },
  { iata: "AGP", city: "Málaga", country: "Spain", aliases: ["Malaga"] },
  { iata: "PMI", city: "Palma de Mallorca", country: "Spain", aliases: ["Mallorca"] },
  { iata: "VLC", city: "Valencia", country: "Spain" },
  { iata: "SVQ", city: "Seville", country: "Spain", aliases: ["Sevilla"] },
  { iata: "LIS", city: "Lisbon", country: "Portugal", aliases: ["Lisboa", "Lisszabon"] },
  { iata: "OPO", city: "Porto", country: "Portugal" },
  { iata: "FCO", city: "Rome Fiumicino", country: "Italy", aliases: ["Rome", "Roma", "Róma"] },
  { iata: "MXP", city: "Milan Malpensa", country: "Italy", aliases: ["Milan", "Milano", "Milánó"] },
  { iata: "VCE", city: "Venice", country: "Italy", aliases: ["Venezia", "Velence"] },
  { iata: "NAP", city: "Naples", country: "Italy", aliases: ["Napoli", "Nápoly"] },
  { iata: "FLR", city: "Florence", country: "Italy", aliases: ["Firenze"] },
  { iata: "ATH", city: "Athens", country: "Greece", aliases: ["Athína", "Athén"] },

  // Nordics
  { iata: "CPH", city: "Copenhagen", country: "Denmark", aliases: ["København", "Koppenhága"] },
  { iata: "ARN", city: "Stockholm Arlanda", country: "Sweden", aliases: ["Stockholm"] },
  { iata: "OSL", city: "Oslo", country: "Norway" },
  { iata: "HEL", city: "Helsinki", country: "Finland" },
  { iata: "KEF", city: "Reykjavík", country: "Iceland", aliases: ["Reykjavik"] },

  // Turkey / Middle East
  { iata: "IST", city: "Istanbul", country: "Turkey", aliases: ["Isztambul"] },
  { iata: "SAW", city: "Istanbul Sabiha Gökçen", country: "Turkey" },
  { iata: "DXB", city: "Dubai", country: "United Arab Emirates" },
  { iata: "AUH", city: "Abu Dhabi", country: "United Arab Emirates" },
  { iata: "DOH", city: "Doha", country: "Qatar" },

  // North America
  { iata: "JFK", city: "New York JFK", country: "United States", aliases: ["New York"] },
  { iata: "EWR", city: "New York Newark", country: "United States" },
  { iata: "LAX", city: "Los Angeles", country: "United States" },
  { iata: "SFO", city: "San Francisco", country: "United States" },
  { iata: "ORD", city: "Chicago O'Hare", country: "United States", aliases: ["Chicago"] },
  { iata: "MIA", city: "Miami", country: "United States" },
  { iata: "BOS", city: "Boston", country: "United States" },
  { iata: "IAD", city: "Washington Dulles", country: "United States" },
  { iata: "YYZ", city: "Toronto", country: "Canada" },
  { iata: "YVR", city: "Vancouver", country: "Canada" },
  { iata: "YUL", city: "Montreal", country: "Canada" },

  // Asia / Pacific
  { iata: "NRT", city: "Tokyo Narita", country: "Japan", aliases: ["Tokyo", "Tokió"] },
  { iata: "HND", city: "Tokyo Haneda", country: "Japan" },
  { iata: "ICN", city: "Seoul Incheon", country: "South Korea", aliases: ["Seoul"] },
  { iata: "PEK", city: "Beijing", country: "China", aliases: ["Peking"] },
  { iata: "PVG", city: "Shanghai", country: "China", aliases: ["Sanghaj"] },
  { iata: "HKG", city: "Hong Kong", country: "Hong Kong" },
  { iata: "SIN", city: "Singapore", country: "Singapore", aliases: ["Szingapúr"] },
  { iata: "BKK", city: "Bangkok", country: "Thailand" },
  { iata: "DEL", city: "Delhi", country: "India", aliases: ["New Delhi"] },
  { iata: "BOM", city: "Mumbai", country: "India" },
  { iata: "SYD", city: "Sydney", country: "Australia" },
  { iata: "MEL", city: "Melbourne", country: "Australia" },
  { iata: "AKL", city: "Auckland", country: "New Zealand" },

  // South America
  { iata: "GRU", city: "São Paulo", country: "Brazil", aliases: ["Sao Paulo"] },
  { iata: "GIG", city: "Rio de Janeiro", country: "Brazil" },
  { iata: "EZE", city: "Buenos Aires", country: "Argentina" },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Score a candidate against the user's query. Higher = better match.
 *  Heuristic:
 *   - Exact IATA match: huge boost (typing "BUD" should jump BUD to the top)
 *   - City / alias `startsWith`: strong boost
 *   - City / alias contains: weak boost
 *   - Country `startsWith`: very weak boost (so typing "spain" surfaces
 *     Spanish hubs, but city matches always win)
 *  Returns 0 when nothing matches. */
function scoreAirport(query: string, a: AirportOrigin): number {
  const q = normalize(query);
  if (!q) return 0;
  if (a.iata.toLowerCase() === q) return 1000;
  if (a.iata.toLowerCase().startsWith(q)) return 600;
  const city = normalize(a.city);
  if (city === q) return 800;
  if (city.startsWith(q)) return 500;
  if (city.includes(q)) return 200;
  for (const alias of a.aliases ?? []) {
    const n = normalize(alias);
    if (n === q) return 700;
    if (n.startsWith(q)) return 450;
    if (n.includes(q)) return 180;
  }
  const country = normalize(a.country);
  if (country.startsWith(q)) return 80;
  if (country.includes(q)) return 30;
  return 0;
}

/** Top-N matches for the given free-text query. Sorted by score desc with
 *  ties broken on alphabetical city (so the order stays stable across
 *  keystrokes). Returns empty array when no candidate scores above 0. */
export function searchAirportOrigins(query: string, limit = 5): AirportOrigin[] {
  const scored: { a: AirportOrigin; s: number }[] = [];
  for (const a of AIRPORT_ORIGINS) {
    const s = scoreAirport(query, a);
    if (s > 0) scored.push({ a, s });
  }
  scored.sort((x, y) => y.s - x.s || x.a.city.localeCompare(y.a.city));
  return scored.slice(0, limit).map((r) => r.a);
}
