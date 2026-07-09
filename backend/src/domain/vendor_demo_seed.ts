// Vendor demo seeder. Builds a throwaway Shrek-themed cake studio, "Mézi
// Tortaműhely" / "Gingy's Wedding Cakes", so a prospective vendor visiting
// /vendors can tour the vendor workspace (dashboard, clients, listing editor,
// availability, payment tracking) with believable data in it.
//
// It lives in the same fairy-tale universe as the couple demo (Shrek & Fiona)
// and the planner demo (Fairy Godmother Weddings): the bakery's confirmed
// flagship client IS Shrek & Fiona's wedding, and the cancelled inquiry is
// Lord Farquaad's (the bride chose someone else).
//
// Entry points:
//   - vendorDemoBusinessName(locale), the display name routes/demo.ts stamps
//     on the vendor_accounts row before seeding.
//   - seedVendorDemo(vendorAccountId, opts), fills the workspace (listing,
//     client bookings, payment schedules, blocked dates).
//   - purgeStaleVendorDemos(), reaps demo vendors older than the demo TTL.
//
// Every client couple it creates is `is_demo = 1`, so the existing
// purgeStaleDemoCouples() sweep reaps those workspaces (and their bookings via
// ON DELETE CASCADE); purgeStaleVendorDemos only has to remove the vendor user
// + its vendor_* rows. The demo listing is a 'claimed' `v{N}` row, the public
// directory only serves curated + community entries, so the fake bakery never
// surfaces to real couples.

import type { Currency } from "@shared/types";
import { db, now } from "../db";
import { addCoupleMember, assignOrganiserCode } from "./couples";
import {
  DEMO_MAX_AGE_MS,
  type DemoLocale,
  insertDemoUsageSnapshot,
  type LText,
  pickL,
} from "./demo_seed";
import { addListingPackage, addListingPhoto, createVendorListing, patchListing } from "./listings";
import { uniqueCoupleSlug } from "./slug";

export interface VendorDemoResult {
  vendor_account_id: number;
  listing_id: string;
  clients_created: number;
  payments_created: number;
  blocked_dates: number;
}

/** Random opaque demo email, same shape + reaping predicate as the couple and
 *  planner demos (`%@demo.weddly.local`) so every sweep recognises the row. */
function randomDemoEmail(): string {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  return `demo-${hex}@demo.weddly.local`;
}

/** ISO date `days` from today, snapped FORWARD to the next Saturday so every
 *  seeded wedding lands on a plausible day (mirrors the planner demo seed). */
function saturdayFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((6 - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const BUSINESS_NAME: LText = { en: "Gingy's Wedding Cakes", hu: "Mézi Tortaműhely" };

/** Cover + gallery photos for the demo cake studio, so the demo listing looks
 *  like a real, finished card instead of an empty monogram. These are freely
 *  licensed wedding-cake photos on Wikimedia Commons — `upload.wikimedia.org`
 *  is already CSP-whitelisted (same as the blog covers), so they render on the
 *  card, the public detail gallery, and the editor preview with no bundling.
 *  Hotlinked rather than copied per demo: the demo purge drops the listing row,
 *  and external URLs leave nothing behind to clean up. `hero` is a wide shot for
 *  the 3:2/16:9 crop; `gallery` runs classic → modern → playful to show range. */
const DEMO_CAKE_MEDIA = {
  hero: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5d/Twenty_tier_Wedding_cake%281%29.JPG/1280px-Twenty_tier_Wedding_cake%281%29.JPG",
  gallery: [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Mazel_Tov%21_Wedding_cake_in_the_time_of_corona.jpg/1280px-Mazel_Tov%21_Wedding_cake_in_the_time_of_corona.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/8/89/Wedding_Cake_Framboises_-_Cake_Design.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Wedding_cake_dessert.jpg/1280px-Wedding_cake_dessert.jpg",
  ],
} as const;

/** Price offers (árajánlat) for the demo cake vendor — one per tier so the demo
 *  showcases the packages section on both the editor and the public card. Price
 *  is free-text (HU forint vs EUR); descriptions stay in the fairy-tale voice. */
const DEMO_CAKE_PACKAGES = [
  {
    name: { en: "Cake tasting", hu: "Kóstoló" },
    price: { hu: "12 000 Ft", en: "€30" },
    description: {
      en: "Five flavour samples for the couple, with a design consultation.",
      hu: "Öt ízminta a párnak, tervezési konzultációval.",
    },
  },
  {
    name: { en: "Wedding cake", hu: "Esküvői torta" },
    price: { hu: "95 000 Ft-tól", en: "from €250" },
    description: {
      en: "A three-tier gingerbread cake with bespoke decoration.",
      hu: "Háromemeletes mézeskalács-torta, egyedi díszítéssel.",
    },
  },
  {
    name: { en: "Full dessert table", hu: "Teljes desszertasztal" },
    price: { hu: "180 000 Ft-tól", en: "from €480" },
    description: {
      en: "Cake, pastries and gumdrops for up to 80 guests.",
      hu: "Torta, sütemények és cukorgombok akár 80 főre.",
    },
  },
] as const;

export function vendorDemoBusinessName(locale: DemoLocale): string {
  return pickL(BUSINESS_NAME, locale);
}

/** Owner display name for the throwaway vendor user. */
export function vendorDemoOwnerName(locale: DemoLocale): string {
  return pickL({ en: "Gingy", hu: "Mézi" }, locale);
}

// ── Client specs ─────────────────────────────────────────────────────────────

interface VdPayment {
  label: LText;
  /** [HUF, EUR] integer amounts; picked by the vendor's billing currency. */
  amount: [number, number];
  /** Days relative to the wedding (negative = before). null = no due date. */
  due_offset: number | null;
  paid: boolean;
}

interface VdClientSpec {
  slug_base: string;
  display_name: LText;
  bride_name: LText;
  groom_name: LText;
  /** Days from today to the wedding, snapped forward to a Saturday. */
  wedding_in_days: number;
  status: "requested" | "vendor_seen" | "confirmed" | "cancelled";
  /** Days ago the inquiry arrived, tunes the 30-day dashboard counter. */
  inquired_days_ago: number;
  notes: LText | null;
  stage: LText | null;
  contract_value: [number, number] | null;
  deposit_paid: [number, number] | null;
  vendor_notes: LText | null;
  payments: VdPayment[];
}

const CLIENTS: VdClientSpec[] = [
  {
    slug_base: "SHREKFIONA",
    display_name: "Shrek & Fiona",
    bride_name: "Fiona",
    groom_name: "Shrek",
    wedding_in_days: 45,
    status: "confirmed",
    inquired_days_ago: 20,
    notes: {
      en: "Swamp wedding, around 90 guests. Cake table under the willow.",
      hu: "Mocsári esküvő, kb. 90 vendég. Tortaasztal a fűzfa alatt.",
    },
    stage: { en: "Tasting done", hu: "Kóstoló megvolt" },
    contract_value: [420_000, 1_050],
    deposit_paid: [160_000, 400],
    vendor_notes: {
      en: "Onion-layer cake with swamp-green icing. Ogres have layers, so does the cake. Donkey wants a slice too.",
      hu: "Hagymarétegű torta mocsárzöld mázzal. Az ogréknak rétegei vannak, a tortának is. Szamár is kér egy szeletet.",
    },
    payments: [
      {
        label: { en: "Deposit", hu: "Foglaló" },
        amount: [160_000, 400],
        due_offset: null,
        paid: true,
      },
      {
        label: { en: "Tasting", hu: "Kóstoló" },
        amount: [20_000, 50],
        due_offset: null,
        paid: true,
      },
      {
        label: { en: "Final balance", hu: "Végszámla" },
        amount: [240_000, 600],
        due_offset: -7,
        paid: false,
      },
    ],
  },
  {
    slug_base: "DONKEYDRAGON",
    display_name: { en: "Donkey & Dragon", hu: "Szamár & Sárkány" },
    bride_name: { en: "Dragon", hu: "Sárkány" },
    groom_name: { en: "Donkey", hu: "Szamár" },
    wedding_in_days: 90,
    status: "confirmed",
    inquired_days_ago: 35,
    notes: {
      en: "Waffle tower instead of a classic cake. Venue: the dragon's keep.",
      hu: "Gofritorony a klasszikus torta helyett. Helyszín: a sárkány vára.",
    },
    stage: { en: "Contract signed", hu: "Szerződve" },
    contract_value: [280_000, 700],
    deposit_paid: [84_000, 210],
    vendor_notes: {
      en: "Extra-size slices for the bride. Fireproof cake stand ordered.",
      hu: "Extra méretű szeletek a menyasszonynak. Tűzálló tortaállvány megrendelve.",
    },
    payments: [
      {
        label: { en: "Deposit", hu: "Foglaló" },
        amount: [84_000, 210],
        due_offset: null,
        paid: true,
      },
      {
        label: { en: "Final balance", hu: "Végszámla" },
        amount: [196_000, 490],
        due_offset: -14,
        paid: false,
      },
    ],
  },
  {
    slug_base: "CINDERELLA",
    display_name: {
      en: "Cinderella & Prince Charming",
      hu: "Hamupipőke & Szőke Herceg",
    },
    bride_name: { en: "Cinderella", hu: "Hamupipőke" },
    groom_name: { en: "Prince Charming", hu: "Szőke Herceg" },
    wedding_in_days: 150,
    status: "requested",
    inquired_days_ago: 1,
    notes: {
      en: "Reception ends at midnight sharp. Glass-slipper themed cake topper.",
      hu: "A fogadás pontban éjfélkor zárul. Üvegcipős tortadísz.",
    },
    stage: null,
    contract_value: null,
    deposit_paid: null,
    vendor_notes: null,
    payments: [],
  },
  {
    slug_base: "SNOWWHITE",
    display_name: {
      en: "Snow White & Prince Florian",
      hu: "Hófehérke & Florian herceg",
    },
    bride_name: { en: "Snow White", hu: "Hófehérke" },
    groom_name: { en: "Prince Florian", hu: "Florian herceg" },
    wedding_in_days: 120,
    status: "vendor_seen",
    inquired_days_ago: 6,
    notes: {
      en: "Seven extra child portions. Strictly NO apple filling.",
      hu: "Hét extra gyerekadag. Almás töltelék szigorúan KIZÁRVA.",
    },
    stage: null,
    contract_value: null,
    deposit_paid: null,
    vendor_notes: null,
    payments: [],
  },
  {
    slug_base: "FARQUAAD",
    display_name: "Lord Farquaad & Fiona",
    bride_name: "Fiona",
    groom_name: "Lord Farquaad",
    wedding_in_days: 45,
    status: "cancelled",
    inquired_days_ago: 40,
    notes: {
      en: "Duloc cathedral, compensating-with-size cake requested.",
      hu: "Duloc katedrális, méretében kompenzáló tortát kért.",
    },
    stage: null,
    contract_value: [500_000, 1_250],
    deposit_paid: null,
    vendor_notes: {
      en: "The bride chose someone else. See the confirmed booking on the same date.",
      hu: "A menyasszony mást választott. Lásd a megerősített foglalást ugyanarra a napra.",
    },
    payments: [],
  },
];

const BLOCKED_DATES: Array<{ in_days: number; reason: LText }> = [
  { in_days: 30, reason: { en: "Duloc festival, closed", hu: "Duloc fesztivál, zárva" } },
  {
    in_days: 60,
    reason: {
      en: "Full-day delivery to Far Far Away",
      hu: "Egész napos kiszállás Túl az Óperenciára",
    },
  },
  { in_days: 75, reason: { en: "Oven maintenance", hu: "Kemence-karbantartás" } },
];

// ── Seeding ──────────────────────────────────────────────────────────────────

/** Insert the throwaway owner user + an empty `is_demo=1` couple row for one
 *  fairy-tale client, mirroring the planner demo seed. Returns the couple id. */
function createDemoClientCouple(
  spec: VdClientSpec,
  locale: DemoLocale,
  ownerPasswordHash: string,
): number {
  const ts = now();
  const userResult = db
    .prepare(
      `INSERT INTO users (email, password_hash, full_name, status, role, verified_email, created_at, updated_at)
       VALUES (?, ?, ?, 'active', 'owner', 1, ?, ?)`,
    )
    .run(randomDemoEmail(), ownerPasswordHash, pickL(spec.display_name, locale), ts, ts);
  const userId = Number(userResult.lastInsertRowid);

  const coupleResult = db
    .prepare(
      `INSERT INTO couples
         (partner_a_id, partner_b_id, display_name, bride_name, groom_name,
          wedding_date_kind, guest_count_kind, budget_kind,
          style_tags_json, currency, status, is_demo, demo_kind,
          created_at, updated_at, onboarded_at)
       VALUES (?, NULL, ?, ?, ?,
               'exact', 'exact', 'exact',
               '[]', 'HUF', 'active', 1, 'vendor_client',
               ?, ?, ?)`,
    )
    .run(
      userId,
      pickL(spec.display_name, locale),
      pickL(spec.bride_name, locale),
      pickL(spec.groom_name, locale),
      ts,
      ts,
      ts,
    );
  const coupleId = Number(coupleResult.lastInsertRowid);

  const slug = uniqueCoupleSlug(spec.slug_base, coupleId);
  db.prepare("UPDATE couples SET slug = ?, updated_at = ? WHERE id = ?").run(slug, ts, coupleId);
  assignOrganiserCode(coupleId, ts);
  db.prepare("UPDATE users SET couple_id = ?, role = 'owner', updated_at = ? WHERE id = ?").run(
    coupleId,
    ts,
    userId,
  );
  addCoupleMember(coupleId, userId, "owner");
  return coupleId;
}

/** Fill the demo vendor's workspace: the public listing card, a book of
 *  fairy-tale client inquiries with CRM fields + payment schedules, and a few
 *  blocked dates. The vendor user + account + subscription are created by the
 *  caller (routes/demo.ts) so the auth session and billing row are stamped
 *  before the workspace fills. `currency` follows the vendor's subscription so
 *  the seeded amounts match what the UI formats. */
export function seedVendorDemo(
  vendorAccountId: number,
  opts: {
    ownerPasswordHash: string;
    contactEmail: string;
    locale?: DemoLocale;
    currency: Currency;
  },
): VendorDemoResult {
  const locale: DemoLocale = opts.locale ?? "en";
  const huf = opts.currency === "HUF";
  const amt = (pair: [number, number]): number => (huf ? pair[0] : pair[1]);

  const result: VendorDemoResult = {
    vendor_account_id: vendorAccountId,
    listing_id: "",
    clients_created: 0,
    payments_created: 0,
    blocked_dates: 0,
  };

  const tx = db.transaction(() => {
    // 1. The public listing card, complete enough that the editor + preview
    //    have something to show (blurbs in BOTH languages, the editor exposes
    //    both fields), plus a cover photo + a small cake gallery so the demo
    //    card looks finished rather than an empty monogram (see DEMO_CAKE_MEDIA).
    const listing = createVendorListing({
      vendorAccountId,
      category: "cake_dessert",
      name: vendorDemoBusinessName(locale),
      city: pickL({ en: "Far Far Away", hu: "Túl az Óperencián" }, locale),
      contactEmail: opts.contactEmail,
    });
    patchListing(listing.id, {
      address: pickL({ en: "1 Drury Lane", hu: "Mézeskalács köz 1." }, locale),
      blurb_hu:
        "Mesebeli esküvői torták Túl az Óperencián legkedveltebb mézeskalács-cukrászától. Hagymarétegű torta ogréknak, gofritorony szamaraknak, cukorgomb minden emeleten.",
      blurb_en:
        "Fairy-tale wedding cakes from Far Far Away's favourite gingerbread baker. Onion-layer cakes for ogres, waffle towers for donkeys, gumdrop buttons on every tier.",
      price_band: 3,
      capacity_min: 20,
      capacity_max: 250,
    });
    result.listing_id = listing.id;

    // Cover photo (hero_image_url has no ListingPatch field, so it's stamped
    // with a direct UPDATE, mirroring the real hero-upload route) + a few
    // portfolio photos so the gallery on the public card + editor is populated.
    db.prepare("UPDATE listings SET hero_image_url = ?, updated_at = ? WHERE id = ?").run(
      DEMO_CAKE_MEDIA.hero,
      now(),
      listing.id,
    );
    for (const url of DEMO_CAKE_MEDIA.gallery) addListingPhoto(listing.id, url);

    // Price offers (árajánlat) so the packages section is populated in the demo.
    for (const p of DEMO_CAKE_PACKAGES) {
      addListingPackage(listing.id, {
        name: pickL(p.name, locale),
        price_text: huf ? p.price.hu : p.price.en,
        description: pickL(p.description, locale),
      });
    }

    // 2. Client inquiries, one is_demo couple + one booking each, with the
    //    CRM fields and payment schedules that light up the PRO surfaces.
    const insertBooking = db.prepare(
      `INSERT INTO supplier_bookings
         (supplier_id, couple_id, vendor_account_id, event_date, status, notes,
          contract_value, deposit_paid, stage, vendor_notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertPayment = db.prepare(
      `INSERT INTO vendor_client_payments
         (booking_id, vendor_account_id, label, amount, currency, due_date,
          paid, paid_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const spec of CLIENTS) {
      const coupleId = createDemoClientCouple(spec, locale, opts.ownerPasswordHash);
      const eventDate = saturdayFromNow(spec.wedding_in_days);
      // Back-date the inquiry so the "last 30 days" dashboard counter shows a
      // believable split instead of "everything arrived just now".
      const inquiredAt = now() - spec.inquired_days_ago * 24 * 60 * 60 * 1000;
      const bookingResult = insertBooking.run(
        listing.id,
        coupleId,
        vendorAccountId,
        eventDate,
        spec.status,
        spec.notes ? pickL(spec.notes, locale) : null,
        spec.contract_value ? amt(spec.contract_value) : null,
        spec.deposit_paid ? amt(spec.deposit_paid) : null,
        spec.stage ? pickL(spec.stage, locale) : null,
        spec.vendor_notes ? pickL(spec.vendor_notes, locale) : null,
        inquiredAt,
        inquiredAt,
      );
      const bookingId = Number(bookingResult.lastInsertRowid);
      result.clients_created += 1;

      for (const p of spec.payments) {
        const ts = now();
        insertPayment.run(
          bookingId,
          vendorAccountId,
          pickL(p.label, locale),
          amt(p.amount),
          opts.currency,
          p.due_offset === null ? null : addDaysIso(eventDate, p.due_offset),
          p.paid ? 1 : 0,
          p.paid ? inquiredAt : null,
          ts,
          ts,
        );
        result.payments_created += 1;
      }
    }

    // 3. Blocked dates for the availability surface.
    const insertBlocked = db.prepare(
      `INSERT INTO vendor_unavailable_dates
         (vendor_account_id, blocked_date, reason, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    for (const b of BLOCKED_DATES) {
      insertBlocked.run(vendorAccountId, isoDaysFromNow(b.in_days), pickL(b.reason, locale), now());
      result.blocked_dates += 1;
    }
  });

  tx();
  return result;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ── Reaping ─────────────────────────────────────────────────────────────────

/** Purge demo VENDOR accounts older than `maxAgeMs`. The client couples behind
 *  the seeded bookings are `is_demo=1` and reaped by purgeStaleDemoCouples;
 *  this only removes the vendor user + its vendor_* rows and the `v{N}`
 *  listing. Everything is deleted explicitly (even where an FK would cascade)
 *  so the function is order-independent w.r.t. the couples sweep, in
 *  particular, `listings.vendor_account_id` is ON DELETE SET NULL, so without
 *  the explicit DELETE the fake bakery card would linger as an orphan.
 *
 *  audit_log.actor_user_id has no ON DELETE clause, so its rows are deleted
 *  before the user row (demo vendors have no audit-retention claim, mirrors
 *  the couple + planner sweeps). */
export function purgeStaleVendorDemos(maxAgeMs: number = DEMO_MAX_AGE_MS): number {
  const cutoff = now() - maxAgeMs;
  const vendors = db
    .prepare(
      `SELECT u.id AS user_id, u.created_at AS created_at, va.id AS account_id
         FROM users u
         LEFT JOIN vendor_accounts va ON va.owner_user_id = u.id
        WHERE u.role = 'vendor' AND u.email LIKE '%@demo.weddly.local' AND u.created_at < ?`,
    )
    .all(cutoff) as { user_id: number; created_at: number; account_id: number | null }[];
  if (vendors.length === 0) return 0;

  let purged = 0;
  for (const v of vendors) {
    try {
      db.transaction(() => {
        // Snapshot the vendor demo's audit trail into demo_usage
        // (kind='vendor') before the rows are scrubbed, mirroring the
        // planner sweep, so the per-kind "demos served" count survives.
        const actions = (
          db.prepare("SELECT action FROM audit_log WHERE actor_user_id = ?").all(v.user_id) as {
            action: string;
          }[]
        ).map((r) => r.action);
        insertDemoUsageSnapshot({
          kind: "vendor",
          sourceId: v.user_id,
          slug: null,
          createdAt: v.created_at,
          actions,
        });

        if (v.account_id !== null) {
          db.prepare("DELETE FROM vendor_client_payments WHERE vendor_account_id = ?").run(
            v.account_id,
          );
          db.prepare("DELETE FROM supplier_bookings WHERE vendor_account_id = ?").run(v.account_id);
          db.prepare("DELETE FROM vendor_unavailable_dates WHERE vendor_account_id = ?").run(
            v.account_id,
          );
          db.prepare("DELETE FROM listings WHERE vendor_account_id = ?").run(v.account_id);
          db.prepare("DELETE FROM vendor_subscriptions WHERE vendor_account_id = ?").run(
            v.account_id,
          );
          db.prepare("DELETE FROM vendor_accounts WHERE id = ?").run(v.account_id);
        }
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(v.user_id);
        db.prepare("DELETE FROM audit_log WHERE actor_user_id = ?").run(v.user_id);
        db.prepare("DELETE FROM users WHERE id = ?").run(v.user_id);
      })();
      purged += 1;
    } catch {
      // Skip a row that fails; the next sweep retries.
    }
  }
  return purged;
}
