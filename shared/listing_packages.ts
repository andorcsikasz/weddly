// Vendor listing "packages" (árajánlat / csomag) — the optional price offers a
// claimed vendor can publish on their listing, up to MAX_LISTING_PACKAGES. Each
// package is a named tier with an optional free-text price, an optional
// description, and an optional attached PDF (a printable price list / quote).
//
// Why free-text price and not a number: vendors quote in wildly different shapes
// ("250 000 Ft-tól", "€900 / nap", "5 000 Ft/fő", "egyedi ajánlat"). A single
// string keeps every one of those expressible without a currency/parse layer,
// and the listing has no money-amount column to reuse anyway (pricing on the
// listing is the coarse 1..5 price_band). The PDF is where a vendor drops the
// exact, itemised numbers.
//
// The name is vendor-chosen, but we SUGGEST category-appropriate tier names so a
// photographer, a cake studio and a venue each get relevant starting points —
// see PACKAGE_NAME_SUGGESTIONS, keyed by the listing's SupplierCategory.

import type { SupplierCategory } from "./suppliers";

/** One published price offer on a claimed listing. `pdf_url` is a public
 *  `/uploads/...` URL (served like photos/videos); null when no document is
 *  attached. `pdf_name` is the original filename, shown as the download label. */
export interface ListingPackage {
  id: number;
  name: string;
  /** Free-text price (e.g. "250 000 Ft-tól", "€900 / nap"). Null = no price
   *  shown; the vendor may describe pricing in the PDF instead. */
  price_text: string | null;
  description: string | null;
  /** Public URL of the attached PDF, or null. */
  pdf_url: string | null;
  /** Original PDF filename for the download link label, or null. */
  pdf_name: string | null;
}

/** Package cap per listing — enforced server-side, mirrored in the editor UI.
 *  Matches the "max 3 offers" product requirement. */
export const MAX_LISTING_PACKAGES = 3;

/** Field length caps (server-validated, mirrored as `maxLength` in the editor). */
export const PACKAGE_NAME_MAX = 60;
export const PACKAGE_PRICE_MAX = 40;
export const PACKAGE_DESCRIPTION_MAX = 600;

/** Uploaded price-list PDF cap. Mirrors the budget-docs precedent (8 MB). */
export const PACKAGE_PDF_MAX_BYTES = 8 * 1024 * 1024;

/** Per-category suggested package/tier names, HU + EN. The vendor is free to
 *  rename, but these give a relevant starting point that reflects THEIR trade
 *  (the "kategóriánként megkülönböztetve" requirement). First entry doubles as
 *  the default name when the vendor adds a package without typing one. */
export const PACKAGE_NAME_SUGGESTIONS: Record<SupplierCategory, { hu: string[]; en: string[] }> = {
  wedding_planner: {
    hu: ["Teljes körű szervezés", "Részleges szervezés", "Napi koordináció"],
    en: ["Full planning", "Partial planning", "Day-of coordination"],
  },
  venue: {
    hu: ["Hétköznapi bérlés", "Hétvégi csomag", "Exkluzív teljes nap"],
    en: ["Weekday hire", "Weekend package", "Exclusive full day"],
  },
  accommodation: {
    hu: ["Nászéjszaka", "Vendégszoba-blokk", "Teljes ház"],
    en: ["Wedding night", "Guest room block", "Whole venue stay"],
  },
  tent_pavilion: {
    hu: ["Alap sátor", "Sátor dekorral", "Prémium pavilon"],
    en: ["Basic tent", "Tent with décor", "Premium pavilion"],
  },
  catering: {
    hu: ["Ültetett menü", "Svédasztal", "Prémium menüsor"],
    en: ["Plated menu", "Buffet", "Premium menu"],
  },
  cake_dessert: {
    hu: ["Kóstoló", "Esküvői torta", "Teljes desszertasztal"],
    en: ["Cake tasting", "Wedding cake", "Full dessert table"],
  },
  bar_drinks: {
    hu: ["Alap italcsomag", "Koktélbár", "Prémium nyitott bár"],
    en: ["Basic drinks", "Cocktail bar", "Premium open bar"],
  },
  pizza: {
    hu: ["Pizzakocsi 2 óra", "Korlátlan pizza", "Prémium olasz válogatás"],
    en: ["Pizza van, 2 hours", "Unlimited pizza", "Premium Italian selection"],
  },
  decor_floral: {
    hu: ["Menyasszonyi csokor", "Ceremónia dekor", "Teljes helyszíndekor"],
    en: ["Bridal bouquet", "Ceremony décor", "Full venue décor"],
  },
  lighting: {
    hu: ["Hangulatvilágítás", "Táncparkett + LED", "Teljes fényinstalláció"],
    en: ["Ambient lighting", "Dancefloor + LED", "Full lighting design"],
  },
  music_dj: {
    hu: ["4 órás DJ", "Egész estés DJ", "DJ + élő zene"],
    en: ["4-hour DJ set", "Full-evening DJ", "DJ + live music"],
  },
  sound_tech: {
    hu: ["Ceremónia hangosítás", "Alap hangrendszer", "Teljes színpadtechnika"],
    en: ["Ceremony sound", "Basic PA system", "Full stage tech"],
  },
  photo_video: {
    hu: ["Félnapos csomag", "Egész napos csomag", "Fotó + videó prémium"],
    en: ["Half-day package", "Full-day package", "Photo + video premium"],
  },
  entertainment: {
    hu: ["Ceremónia élőzene", "Sztárfellépő", "Interaktív műsor"],
    en: ["Ceremony live act", "Headline act", "Interactive show"],
  },
  attire: {
    hu: ["Ruhabérlés", "Egyedi ruha", "Teljes stíluscsomag"],
    en: ["Dress rental", "Bespoke dress", "Full styling package"],
  },
  hair_makeup: {
    hu: ["Menyasszonyi smink", "Haj + smink", "Menyasszony + kíséret"],
    en: ["Bridal makeup", "Hair + makeup", "Bride + party"],
  },
  nails: {
    hu: ["Alap manikűr", "Géllakk", "Menyasszonyi körömszett"],
    en: ["Basic manicure", "Gel polish", "Bridal nail set"],
  },
  rings: {
    hu: ["Jegygyűrűpár", "Egyedi gyűrű", "Prémium kollekció"],
    en: ["Wedding band pair", "Bespoke ring", "Premium collection"],
  },
  stationery: {
    hu: ["Meghívó szett", "Teljes papírdekor", "Egyedi arculat"],
    en: ["Invitation set", "Full paper suite", "Bespoke identity"],
  },
  invitation_graphics: {
    hu: ["Meghívó grafika", "Teljes grafikai csomag", "Egyedi esküvői arculat"],
    en: ["Invitation design", "Full graphics suite", "Bespoke wedding identity"],
  },
  wedding_website: {
    hu: ["Alap weboldal", "Weboldal + RSVP", "Prémium csomag"],
    en: ["Basic website", "Website + RSVP", "Premium package"],
  },
  transport: {
    hu: ["Menyasszonyi autó", "Vendégbusz", "Teljes flotta"],
    en: ["Bridal car", "Guest shuttle", "Full fleet"],
  },
  other: {
    hu: ["Alap csomag", "Bővített csomag", "Prémium csomag"],
    en: ["Basic package", "Extended package", "Premium package"],
  },
};

/** Suggested tier names for a category in the given locale. Falls back to the
 *  `other` set for any unmapped category, and to HU only for non-EN locales. */
export function packageNameSuggestions(category: SupplierCategory, locale: string): string[] {
  const entry = PACKAGE_NAME_SUGGESTIONS[category] ?? PACKAGE_NAME_SUGGESTIONS.other;
  return locale === "en" ? entry.en : entry.hu;
}
