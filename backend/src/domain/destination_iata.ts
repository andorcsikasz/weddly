// Curated free-text → IATA lookup for the most common honeymoon destinations.
// The matcher is fuzzy: it lowercases, strips diacritics, and tries each
// comma-separated segment of the input against the table — Nominatim
// breadcrumbs like "Ronda, Málaga, Andalúzia, Spain" resolve to AGP via the
// "málaga" key. Missing entries return null; callers fall back to the
// SerpApi google-search resolver. Curated to favour the airport a typical
// honeymooner would actually fly into (e.g. Tuscany → FLR Florence, not the
// smaller GRS), not necessarily the closest one geographically.
//
// Keep entries lowercase and accent-free in the table; the normaliser does
// the same to the input before lookup.

const STATIC_IATA: Record<string, string> = {
  // East / Southeast Asia
  bali: "DPS",
  denpasar: "DPS",
  ubud: "DPS",
  seminyak: "DPS",
  lombok: "LOP",
  jakarta: "CGK",
  phuket: "HKT",
  krabi: "KBV",
  "koh samui": "USM",
  "ko samui": "USM",
  bangkok: "BKK",
  "chiang mai": "CNX",
  "siem reap": "REP",
  "ho chi minh": "SGN",
  hanoi: "HAN",
  tokyo: "NRT",
  kyoto: "KIX",
  osaka: "KIX",
  okinawa: "OKA",
  singapore: "SIN",
  "hong kong": "HKG",
  seoul: "ICN",
  taipei: "TPE",

  // Indian Ocean / Africa
  maldives: "MLE",
  male: "MLE",
  mauritius: "MRU",
  seychelles: "SEZ",
  mahe: "SEZ",
  zanzibar: "ZNZ",
  marrakech: "RAK",
  marrakesh: "RAK",
  fez: "FEZ",
  casablanca: "CMN",
  "cape town": "CPT",
  johannesburg: "JNB",
  "victoria falls": "VFA",
  nairobi: "NBO",
  cairo: "CAI",

  // Greek islands + Mediterranean Europe
  santorini: "JTR",
  thira: "JTR",
  mykonos: "JMK",
  crete: "HER",
  heraklion: "HER",
  chania: "CHQ",
  athens: "ATH",
  rhodes: "RHO",
  corfu: "CFU",
  kos: "KGS",
  zakynthos: "ZTH",

  // Italy
  rome: "FCO",
  roma: "FCO",
  venice: "VCE",
  venezia: "VCE",
  florence: "FLR",
  firenze: "FLR",
  tuscany: "FLR",
  toscana: "FLR",
  "cinque terre": "PSA",
  pisa: "PSA",
  naples: "NAP",
  napoli: "NAP",
  amalfi: "NAP",
  positano: "NAP",
  sorrento: "NAP",
  capri: "NAP",
  ischia: "NAP",
  sicily: "CTA",
  sicilia: "CTA",
  palermo: "PMO",
  catania: "CTA",
  taormina: "CTA",
  sardinia: "OLB",
  sardegna: "OLB",
  cagliari: "CAG",
  olbia: "OLB",
  costa_smeralda: "OLB",
  milan: "MXP",
  milano: "MXP",
  "lake como": "MXP",
  como: "MXP",
  bellagio: "MXP",
  bergamo: "BGY",
  verona: "VRN",
  bologna: "BLQ",
  turin: "TRN",
  torino: "TRN",

  // France
  paris: "CDG",
  nice: "NCE",
  cannes: "NCE",
  monaco: "NCE",
  "saint tropez": "NCE",
  "st tropez": "NCE",
  marseille: "MRS",
  provence: "MRS",
  avignon: "MRS",
  lyon: "LYS",
  bordeaux: "BOD",
  toulouse: "TLS",
  strasbourg: "SXB",
  loire: "TUF",
  normandy: "CDG",
  brittany: "RNS",

  // Spain
  barcelona: "BCN",
  madrid: "MAD",
  seville: "SVQ",
  sevilla: "SVQ",
  granada: "GRX",
  cordoba: "GRX",
  valencia: "VLC",
  malaga: "AGP",
  ronda: "AGP",
  marbella: "AGP",
  "costa del sol": "AGP",
  ibiza: "IBZ",
  mallorca: "PMI",
  palma: "PMI",
  menorca: "MAH",
  formentera: "IBZ",
  tenerife: "TFS",
  lanzarote: "ACE",
  fuerteventura: "FUE",
  "gran canaria": "LPA",
  "las palmas": "LPA",
  bilbao: "BIO",
  "san sebastian": "EAS",

  // Portugal
  lisbon: "LIS",
  lisboa: "LIS",
  porto: "OPO",
  algarve: "FAO",
  faro: "FAO",
  lagos: "FAO",
  madeira: "FNC",
  funchal: "FNC",
  azores: "PDL",
  "ponta delgada": "PDL",

  // UK / Ireland
  london: "LHR",
  edinburgh: "EDI",
  glasgow: "GLA",
  manchester: "MAN",
  liverpool: "LPL",
  dublin: "DUB",
  cork: "ORK",
  belfast: "BFS",

  // Central Europe
  amsterdam: "AMS",
  vienna: "VIE",
  becs: "VIE",
  wien: "VIE",
  prague: "PRG",
  praha: "PRG",
  budapest: "BUD",
  berlin: "BER",
  munich: "MUC",
  munchen: "MUC",
  hamburg: "HAM",
  frankfurt: "FRA",
  zurich: "ZRH",
  geneva: "GVA",
  genf: "GVA",
  interlaken: "ZRH",
  lucerne: "ZRH",
  luzern: "ZRH",
  brussels: "BRU",
  bruges: "BRU",
  brugge: "BRU",

  // Nordics
  copenhagen: "CPH",
  stockholm: "ARN",
  oslo: "OSL",
  bergen: "BGO",
  helsinki: "HEL",
  reykjavik: "KEF",
  iceland: "KEF",
  izland: "KEF",
  "tromso": "TOS",

  // Balkans / Turkey / Cyprus
  istanbul: "IST",
  antalya: "AYT",
  bodrum: "BJV",
  cappadocia: "ASR",
  kayseri: "ASR",
  dubrovnik: "DBV",
  split: "SPU",
  hvar: "SPU",
  zagreb: "ZAG",
  kotor: "TIV",
  tivat: "TIV",
  ljubljana: "LJU",
  bled: "LJU",
  malta: "MLA",
  cyprus: "LCA",
  ciprus: "LCA",
  larnaca: "LCA",
  paphos: "PFO",
  sofia: "SOF",
  bucharest: "OTP",
  warsaw: "WAW",
  krakow: "KRK",

  // Middle East
  dubai: "DXB",
  "abu dhabi": "AUH",
  doha: "DOH",
  muscat: "MCT",
  "tel aviv": "TLV",
  petra: "AMM",
  amman: "AMM",

  // North America
  "new york": "JFK",
  "los angeles": "LAX",
  "san francisco": "SFO",
  miami: "MIA",
  chicago: "ORD",
  "las vegas": "LAS",
  boston: "BOS",
  seattle: "SEA",
  toronto: "YYZ",
  vancouver: "YVR",
  montreal: "YUL",
  hawaii: "HNL",
  honolulu: "HNL",
  maui: "OGG",
  kauai: "LIH",
  "big island": "KOA",

  // Mexico / Caribbean / Central America
  cancun: "CUN",
  tulum: "CUN",
  "playa del carmen": "CUN",
  "riviera maya": "CUN",
  cozumel: "CZM",
  "cabo san lucas": "SJD",
  "los cabos": "SJD",
  "puerto vallarta": "PVR",
  "mexico city": "MEX",
  "punta cana": "PUJ",
  "santo domingo": "SDQ",
  aruba: "AUA",
  curacao: "CUR",
  jamaica: "MBJ",
  "montego bay": "MBJ",
  kingston: "KIN",
  negril: "MBJ",
  bahamas: "NAS",
  nassau: "NAS",
  barbados: "BGI",
  "saint lucia": "UVF",
  "st lucia": "UVF",
  "st. lucia": "UVF",
  antigua: "ANU",
  "turks and caicos": "PLS",
  providenciales: "PLS",
  havana: "HAV",
  varadero: "VRA",
  cuba: "HAV",
  belize: "BZE",
  "costa rica": "SJO",
  "san jose": "SJO",

  // South America
  "rio de janeiro": "GIG",
  "sao paulo": "GRU",
  "buenos aires": "EZE",
  patagonia: "FTE",
  "machu picchu": "CUZ",
  cusco: "CUZ",
  lima: "LIM",
  galapagos: "GPS",
  santiago: "SCL",
  cartagena: "CTG",

  // Pacific / Oceania
  "bora bora": "BOB",
  tahiti: "PPT",
  papeete: "PPT",
  fiji: "NAN",
  nadi: "NAN",
  sydney: "SYD",
  melbourne: "MEL",
  cairns: "CNS",
  perth: "PER",
  auckland: "AKL",
  queenstown: "ZQN",
  wellington: "WLG",
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,'"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Look up a free-text destination against the curated table. Tries the
 *  full string first, then each comma-separated segment in order
 *  (Nominatim breadcrumbs like "Ronda, Málaga, Spain" hit on "málaga").
 *  Returns null when no segment matches — caller can fall back to a
 *  network resolver. */
export function lookupDestinationIata(destination: string): string | null {
  const full = normalize(destination);
  if (!full) return null;
  const fullHit = STATIC_IATA[full];
  if (fullHit) return fullHit;
  for (const raw of destination.split(",")) {
    const seg = normalize(raw);
    if (!seg) continue;
    const segHit = STATIC_IATA[seg];
    if (segHit) return segHit;
  }
  return null;
}
