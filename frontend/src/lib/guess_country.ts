// Best-effort guess at which countries the person in front of the screen is
// likely to pick, so a country list opens on them instead of on Afghanistan.
// Everything here is read from the browser: the server's IP lookup needs a
// MaxMind key that production does not have, and a guess only ORDERS the
// list, so being wrong costs nothing.
//
// Order of trust: the time zone says where the device IS; a language tag's
// region says where its owner is FROM (an "en-US" browser in Budapest is
// common, a "Europe/Budapest" clock in Ohio is not); the UI locale is last.

import { COUNTRIES } from "@shared/country_list";

/** IANA zone → ISO country, for the markets Weddly serves and their
 *  neighbours. A zone missing here simply contributes no guess. */
const ZONE_COUNTRY: Record<string, string> = {
  "Europe/Budapest": "HU",
  "Europe/Vienna": "AT",
  "Europe/Bratislava": "SK",
  "Europe/Prague": "CZ",
  "Europe/Warsaw": "PL",
  "Europe/Bucharest": "RO",
  "Europe/Belgrade": "RS",
  "Europe/Zagreb": "HR",
  "Europe/Ljubljana": "SI",
  "Europe/Sarajevo": "BA",
  "Europe/Podgorica": "ME",
  "Europe/Skopje": "MK",
  "Europe/Tirane": "AL",
  "Europe/Sofia": "BG",
  "Europe/Athens": "GR",
  "Europe/Istanbul": "TR",
  "Europe/Kiev": "UA",
  "Europe/Kyiv": "UA",
  "Europe/Chisinau": "MD",
  "Europe/Berlin": "DE",
  "Europe/Busingen": "DE",
  "Europe/Zurich": "CH",
  "Europe/Vaduz": "LI",
  "Europe/Paris": "FR",
  "Europe/Monaco": "MC",
  "Europe/Brussels": "BE",
  "Europe/Amsterdam": "NL",
  "Europe/Luxembourg": "LU",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Madrid": "ES",
  "Atlantic/Canary": "ES",
  "Europe/Lisbon": "PT",
  "Atlantic/Madeira": "PT",
  "Atlantic/Azores": "PT",
  "Europe/Rome": "IT",
  "Europe/Malta": "MT",
  "Europe/San_Marino": "SM",
  "Europe/Vatican": "VA",
  "Europe/Andorra": "AD",
  "Europe/Copenhagen": "DK",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Helsinki": "FI",
  "Atlantic/Reykjavik": "IS",
  "Europe/Tallinn": "EE",
  "Europe/Riga": "LV",
  "Europe/Vilnius": "LT",
  "Asia/Nicosia": "CY",
  "Europe/Nicosia": "CY",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Phoenix": "US",
  "America/Los_Angeles": "US",
  "America/Anchorage": "US",
  "Pacific/Honolulu": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Mexico_City": "MX",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
  "Australia/Brisbane": "AU",
  "Australia/Perth": "AU",
  "Pacific/Auckland": "NZ",
  "Asia/Dubai": "AE",
};

/** UI locale → the country that language most likely points at. */
const LOCALE_COUNTRY: Record<string, string> = {
  hu: "HU",
  hr: "HR",
  de: "DE",
  es: "ES",
};

const KNOWN = new Set(COUNTRIES.map((c) => c.code));

/** Up to a few ISO codes, most likely first, all present in COUNTRIES. */
export function guessCountries(uiLocale?: string): string[] {
  const out: string[] = [];
  const add = (code: string | undefined) => {
    const c = code?.toUpperCase();
    if (c && KNOWN.has(c) && !out.includes(c)) out.push(c);
  };
  try {
    add(ZONE_COUNTRY[Intl.DateTimeFormat().resolvedOptions().timeZone]);
  } catch {
    // No Intl time zone (very old engines): fall through to the languages.
  }
  const langs =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  for (const tag of langs) {
    if (!tag) continue;
    try {
      add(new Intl.Locale(tag).region);
    } catch {
      // Malformed tag: skip it.
    }
  }
  if (uiLocale) add(LOCALE_COUNTRY[uiLocale]);
  return out.slice(0, 3);
}
