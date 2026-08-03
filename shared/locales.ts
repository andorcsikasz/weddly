// The set of UI locales the app ships, as ONE list both sides read.
//
// This used to be five hand-written `"hu" | "en"` unions (register, the
// locale switcher route, PATCH /api/users/me, the API client, the DB
// normaliser) and they had already drifted: Spanish shipped as a UI locale
// in July 2026, `users.locale` could hold it, `normaliseLocale` returned it
// and `User.locale` was typed for it, but every WRITE path still rejected
// anything but hu/en. So a vendor picking Español had the choice saved to
// localStorage and silently persisted as "en" — a fresh device dropped them
// back to English with nothing to explain it.
//
// Order is the order the language switchers cycle through.

export const UI_LOCALES = ["en", "hu", "es", "hr", "de"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

/** Boundary guard for any locale arriving from a client or the DB. */
export function isUiLocale(raw: unknown): raw is UiLocale {
  return typeof raw === "string" && (UI_LOCALES as readonly string[]).includes(raw);
}

/** The locales our hand-authored CONTENT tables carry a column for: country
 *  names, spoken-language names, month names. Distinct from `UiLocale`, which
 *  is what the INTERFACE is translated into — a locale can have a UI without
 *  anyone having written it a list of 195 country names. */
export type AuthoredLocale = "hu" | "en" | "es";

/** Read a hu/en/es-authored table in the closest thing to `locale` it has.
 *  Anything with no column of its own reads EN, which is the same fallback
 *  `t()` applies to a missing UI key — so a partially translated locale
 *  degrades one string at a time instead of rendering blanks. */
export function authoredLocale(locale: UiLocale): AuthoredLocale {
  return locale === "hu" || locale === "es" ? locale : "en";
}
