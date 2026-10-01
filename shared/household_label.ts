// The name a household gets when nobody typed one. A household is a party of
// people, so labelling it with one guest's bare name ("Andor Csíkász") read as
// a person, not a group, and the moment a partner or child joined it the label
// was simply wrong. "Andor Csíkász's family" stays true as the party grows.
//
// The full name is kept rather than guessing a surname: couples type names in
// either order (Hungarian puts the family name first), and a wrong guess would
// be worse than the extra word.

import type { UiLocale } from "./locales";

export function familyHouseholdLabel(name: string, locale: UiLocale): string {
  const n = name.trim();
  if (!n) return n;
  switch (locale) {
    case "hu":
      return `${n} családja`;
    case "es":
      return `Familia de ${n}`;
    case "de":
      return `Familie von ${n}`;
    case "hr":
      return `Obitelj ${n}`;
    default:
      return `${n}'s family`;
  }
}
