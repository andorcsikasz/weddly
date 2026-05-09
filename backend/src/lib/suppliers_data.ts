// Static curated suppliers directory. v1 is read-only — outbound contact only,
// no booking/messaging. Edit this file to add or remove entries until the v2
// marketplace lands and this becomes a `suppliers` DB table.

export type { DirectorySupplier, SupplierCategory } from "@shared/suppliers";
import type { DirectorySupplier } from "@shared/suppliers";

// Sample data — replace with real curated entries as the network grows.
export const DIRECTORY: DirectorySupplier[] = [
  {
    id: "barokk-villa",
    name: "Barokk Villa",
    category: "venue",
    city: "Budapest",
    blurb_hu: "Klasszikus villaesküvő a budai oldalon, kerttel és terasszal.",
    blurb_en: "Classic villa wedding venue on the Buda side with garden and terrace.",
    website: "https://example.com/barokk-villa",
    contact_email: "info@example.com",
    contact_phone: null,
  },
  {
    id: "savory-events",
    name: "Savory Events",
    category: "catering",
    city: "Budapest",
    blurb_hu: "Évszakhoz illő menük helyi alapanyagokból, vegán opciókkal.",
    blurb_en: "Seasonal menus from local sourcing, with strong vegan options.",
    website: "https://example.com/savory-events",
    contact_email: "hello@example.com",
    contact_phone: null,
  },
  {
    id: "luma-photo",
    name: "Luma Photo",
    category: "photo_video",
    city: "Pécs",
    blurb_hu: "Természetes fény, minimalista szerkesztés. Páros fotózás is.",
    blurb_en: "Natural light, minimalist editing. Engagement shoots available.",
    website: "https://example.com/luma-photo",
    contact_email: "studio@example.com",
    contact_phone: null,
  },
  {
    id: "violet-floral",
    name: "Violet Floral",
    category: "decor_floral",
    city: "Szeged",
    blurb_hu: "Romantikus kompozíciók, friss vágott virág, fenntartható alapanyag.",
    blurb_en: "Romantic compositions, fresh-cut blooms, sustainable sourcing.",
    website: "https://example.com/violet-floral",
    contact_email: "violet@example.com",
    contact_phone: null,
  },
  {
    id: "dj-eclectic",
    name: "DJ Eclectic",
    category: "music_dj",
    city: "Budapest",
    blurb_hu: "Magyar és nemzetközi tánczene; live MC opció.",
    blurb_en: "Hungarian + international dance sets; optional live MC.",
    website: "https://example.com/dj-eclectic",
    contact_email: "book@example.com",
    contact_phone: null,
  },
  {
    id: "fondant-bakery",
    name: "Fondant Bakery",
    category: "cake_dessert",
    city: "Debrecen",
    blurb_hu: "Egyedi tervezésű torták, candy bar, gluténmentes választék.",
    blurb_en: "Custom-designed cakes, candy bar, gluten-free options.",
    website: "https://example.com/fondant-bakery",
    contact_email: "orders@example.com",
    contact_phone: null,
  },
];
