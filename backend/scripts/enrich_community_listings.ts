// One-off operator script: fill in two community listings an admin researched
// by hand, and give each one a card image + gallery.
//
//   bun backend/scripts/enrich_community_listings.ts [--dry]
//
// Both rows arrived through the couple-facing "recommend a supplier" modal,
// which collects nine fields — so they were live with no phone, no blurb, no
// coordinate and no picture. The facts below came from the businesses' own
// published material; the pictures are downloaded and re-hosted under our own
// `listings/<id>/…` key, because the CSP renders nothing from a foreign host.
//
// Safe to re-run: the edit is an idempotent overwrite, and the photo step is
// SKIPPED entirely for a listing that already has a hero or a gallery, so a
// second run can't stack duplicate thumbnails. Clear the photos in the admin
// card first if you want them re-fetched.
//
// This goes through the same domain calls the admin edit form uses, so the
// `listings` mirror stays in step and the audit log records the change.

import type { AdminSupplierEditInput } from "@shared/community_suppliers";
import {
  getCommunitySupplierById,
  updateCommunitySupplier,
} from "../src/domain/community_suppliers";
import {
  addListingPhoto,
  countListingPhotos,
  getListingById,
  setListingHeroImage,
} from "../src/domain/listings";
import { addAuditLog } from "../src/lib/audit";
import { fetchRemoteImage } from "../src/lib/remote_image";
import { storage } from "../src/lib/storage";

/** Audit actor. The edit was decided by the account behind ADMIN_EMAILS; the
 *  script is only the hand that typed it. */
const ADMIN_USER_ID = 1;

const DRY = process.argv.includes("--dry");

interface Job {
  id: number;
  patch: AdminSupplierEditInput;
  hero: string;
  gallery: string[];
}

const PM = "https://podere-mieli.it-tuscanyhotel.com/data/Imgs/1920x1080w";
const BK = "https://bolykipinceszet.hu/wp-content/uploads/2022/05";

const JOBS: Job[] = [
  {
    // Podere Mieli — Costalpino, near Siena. No website of its own, so the
    // og:image sweep could never have reached it; its only public presence is
    // a Facebook page. Capacity deliberately left NULL: the "16 guests" this
    // property publishes is BEDS, and the directory's capacity is the seated
    // dinner, so storing 16 there would read as a 16-person wedding limit.
    id: 9,
    patch: {
      city: "Siena, IT",
      address: "Strada Provinciale 73 BIS, 153, 53100 Costalpino, Siena",
      website: "https://www.facebook.com/PodereMieli/",
      contact_email: "libbyleshem@gmail.com",
      contact_phone: "+39 347 373 4267",
      blurb:
        "Podere Mieli is an intimate wedding venue set in the peaceful Tuscan countryside near Siena. Surrounded by greenery and authentic rural charm, the property offers a romantic setting for relaxed celebrations, outdoor ceremonies and memorable photographs. Independent guest accommodation for up to 16, private terraces, gardens, a garden kitchen and on-site parking let couples and their loved ones enjoy a private, unhurried wedding close to Siena's historic centre.",
      price_band: 2,
      lat: 43.28994,
      lng: 11.27664,
      venue_style: "estate",
      spoken_languages: ["it", "en", "fr", "he"],
    },
    hero: `${PM}/8642/864263/864263201/img-podere-mieli-costalpino-13.JPEG`,
    gallery: [
      `${PM}/8642/864262/864262814/img-podere-mieli-costalpino-1.JPEG`,
      `${PM}/8642/864263/864263369/img-podere-mieli-costalpino-8.JPEG`,
      `${PM}/8642/864263/864263282/img-podere-mieli-costalpino-6.JPEG`,
      `${PM}/8642/864263/864263159/img-podere-mieli-costalpino-4.JPEG`,
      `${PM}/8642/864262/864262781/img-podere-mieli-costalpino-3.JPEG`,
      `${PM}/8642/864262/864262700/img-podere-mieli-costalpino-2.JPEG`,
      `${PM}/8642/864263/864263249/img-podere-mieli-costalpino-5.JPEG`,
    ],
  },
  {
    // Bolyki Pincészet és Szőlőbirtok — Eger, a winery in a former stone
    // quarry. Capacity is the seated-dinner range across its five spaces
    // (smallest tasting room 24 → event hall 180); the 290 it publishes is a
    // standing reception, which the card doesn't model. Pictures come off the
    // venue's OWN wedding page, same source the curated gallery seed uses.
    id: 10,
    patch: {
      name: "Bolyki Pincészet és Szőlőbirtok",
      city: "Eger",
      address: "Bolyki-völgy, 3300 Eger",
      website: "https://bolykipinceszet.hu/",
      contact_email: "info@bolykipinceszet.hu",
      contact_phone: "+36 70 603 9474",
      blurb:
        "A Bolyki Pincészet egy egykori kőbányában kialakított, látványos esküvőhelyszín Egerben. A magasba szökő sziklafalak, a hangulatos pincék, a rendezett szabadtéri terek és a tágas rendezvényház drámai keretet adnak a szertartásnak és a vacsorának: ültetve 180, állófogadáson 290 vendégig. Az öt tér (Rendezvényház, Rendezvényterasz, Nagy tufapince, Lovagterem, Új kóstolóterem) szabadon kombinálható, a helyszín kizárólagosan bérelhető, a szervezésben koordinátor segít, a borsort és az itallapot pedig a birtok saját borai adják.",
      price_band: 3,
      lat: 47.879604,
      lng: 20.402847,
      capacity_min: 24,
      capacity_max: 180,
      venue_style: "estate",
    },
    hero: `${BK}/eskuvo-04.jpg`,
    gallery: [
      `${BK}/eskuvo-10.jpg`,
      `${BK}/DSC02899.jpg`,
      `${BK}/eskuvo-07.jpg`,
      `${BK}/eskuvo-01.jpg`,
      `${BK}/eskuvo-02.jpg`,
    ],
  },
];

async function attach(
  listingId: string,
  url: string,
  role: "hero" | "gallery",
  index: number,
): Promise<void> {
  const img = await fetchRemoteImage(url);
  if (!img) {
    console.log(`  MISS  ${role} ${url}`);
    return;
  }
  const ts = Date.now();
  const key =
    role === "hero"
      ? `listings/${listingId}/hero.${img.ext}`
      : `listings/${listingId}/gallery/admin-${ts}-${index}.${img.ext}`;
  await storage.write(key, img.bytes);
  const publicUrl = `/uploads/${key}?v=${ts}`;
  if (role === "hero") setListingHeroImage(listingId, publicUrl);
  else addListingPhoto(listingId, publicUrl);
  console.log(`  ok    ${role} ${img.width}x${img.height} -> ${publicUrl}`);
}

for (const job of JOBS) {
  const before = getCommunitySupplierById(job.id);
  if (!before) {
    console.log(`#${job.id}: no such community supplier, skipped`);
    continue;
  }
  console.log(`#${job.id} ${before.name}`);
  if (DRY) {
    console.log(
      `  dry-run: would write ${Object.keys(job.patch).length} fields + ${
        job.gallery.length + 1
      } photos`,
    );
    continue;
  }

  const written = updateCommunitySupplier(job.id, job.patch);
  addAuditLog({
    actor_user_id: ADMIN_USER_ID,
    couple_id: null,
    action: "supplier.community.edit",
    target_kind: "community_supplier",
    target_id: job.id,
    before: {
      name: before.name,
      city: before.city,
      address: before.address,
      website: before.website,
      contact_phone: before.contact_phone,
      blurb: before.blurb,
      price_band: before.price_band,
    },
    after: job.patch,
  });
  console.log(`  fields written: ${written}`);

  const listingId = `c${job.id}`;
  const listing = getListingById(listingId);
  if (listing?.hero_image_url || countListingPhotos(listingId) > 0) {
    console.log("  photos: already present, skipped");
    continue;
  }

  await attach(listingId, job.hero, "hero", 0);
  for (const [i, url] of job.gallery.entries()) {
    await attach(listingId, url, "gallery", i + 1);
    addAuditLog({
      actor_user_id: ADMIN_USER_ID,
      couple_id: null,
      action: "supplier.listing.photo.add",
      target_kind: "listing",
      target_id: null,
      after: { listing_id: listingId, role: "gallery", source_url: url },
    });
  }
}

console.log("done");
