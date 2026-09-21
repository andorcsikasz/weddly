// Public, unauthenticated vendor page — the shareable surface for people
// outside Weddly. Covers the aggregate endpoint `GET /api/public/vendors/:id`
// (no auth; an ALLOWLIST of identity, description, photos and published
// reviews, and nothing else: packages, prices, contact, address, availability
// and Q&A are behind the account) and the per-vendor SSR og:card meta that
// makes a shared link preview show the vendor name instead of the brand
// strapline.

import "../setup";

import { describe, expect, test, beforeEach } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import {
  addListingPackage,
  addListingPhoto,
  addListingVideo,
  createVendorListing,
} from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import {
  HU_HOST,
  lookupVendorPageMeta,
  renderIndexHtml,
  renderSitemapXml,
} from "../../src/lib/seo_ssr";
import { canonicalListingId, slugifyName, vendorPublicId } from "@shared/vendor_slug";

async function registerAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) {
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

const curatedSupplierId = (): string => {
  const first = DIRECTORY[0];
  if (!first) throw new Error("DIRECTORY is empty — no curated supplier to test against");
  return first.id;
};

beforeEach(() => {
  wipeAll();
});

interface PublicPayload {
  detail: Record<string, unknown> & {
    id: string;
    name: string;
    reviews_summary: { reviews_count: number };
  };
  reviews: Array<{ id: number; published?: boolean; rating: number }>;
}

/** The complete list of fields an anonymous visitor may receive on `detail`.
 *  Adding to it is a product decision, and this test is where it gets made:
 *  everything else about a vendor is behind the account. */
const PUBLIC_DETAIL_KEYS = [
  "blurb_en",
  "blurb_hu",
  "category",
  "city",
  "claimed",
  "company_name",
  "country",
  "gallery_urls",
  "id",
  "listing_complete",
  "name",
  "reviews_summary",
];

describe("GET /api/public/vendors/:id — no auth", () => {
  test("returns the profile + reviews with NO token, and nothing else", async () => {
    const sid = curatedSupplierId();
    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.id).toBe(sid);
    expect(Array.isArray(r.data.reviews)).toBe(true);
    // Q&A and availability are behind the account: the keys do not exist at all.
    expect(Object.keys(r.data).sort()).toEqual(["detail", "reviews"]);
  });

  test("never leaks the admin-only comments_count on the public detail", async () => {
    const sid = curatedSupplierId();
    // Seed an admin_internal comment so a count would be > 0 if it leaked.
    const adminToken = await registerAdmin();
    await req(
      "POST",
      `/api/suppliers/${encodeURIComponent(sid)}/comments`,
      { body: "internal triage note", visibility: "admin_internal" },
      { token: adminToken },
    );
    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.comments_count).toBeUndefined();
  });

  test("returns published reviews only — drafts stay hidden", async () => {
    const adminToken = await registerAdmin();
    const sid = curatedSupplierId();
    const now = Date.now();
    const adminUserId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("admin@test.test") as { id: number }
    ).id;
    const stmt = db.prepare(
      `INSERT INTO supplier_reviews
         (supplier_id, author_user_id, couple_id, rating, body, published, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    );
    stmt.run(sid, adminUserId, 5, "published one", 1, now, now);
    stmt.run(sid, adminUserId, 2, "draft one", 0, now, now);
    expect(adminToken).toBeTruthy();

    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.reviews.length).toBe(1);
    expect(r.data.reviews[0]?.rating).toBe(5);
  });

  test("carries no Q&A at all, whatever its visibility", async () => {
    const adminToken = await registerAdmin();
    const sid = curatedSupplierId();
    for (const visibility of ["admin_internal", "public", "vendor_only"] as const) {
      const c = await req(
        "POST",
        `/api/suppliers/${encodeURIComponent(sid)}/comments`,
        { body: `${visibility} note`, visibility },
        { token: adminToken },
      );
      expect(c.status).toBe(201);
    }

    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data).not.toHaveProperty("comments");
    expect(JSON.stringify(r.data)).not.toContain("public note");
  });

  test("unknown id → 404", async () => {
    const r = await req("GET", "/api/public/vendors/this-vendor-does-not-exist");
    expect(r.status).toBe(404);
  });

  test("a signed-in couple gets the SAME answer as a stranger: the session is not consulted", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const path = `/api/public/vendors/${encodeURIComponent(sid)}`;
    const anonymous = await req<PublicPayload>("GET", path);
    const signedIn = await req<PublicPayload>("GET", path, undefined, { token });
    expect(signedIn.status).toBe(200);
    // Nothing on this endpoint can be unlocked by a header; the rest of the
    // profile is on `/app/suppliers/:id`, which is where the page sends them.
    expect(JSON.stringify(signedIn.data)).toBe(JSON.stringify(anonymous.data));
  });
});

/** Seed a claimed vendor with EVERY gated field filled, so an absence in the
 *  public payload is the allowlist working rather than an unfurnished listing. */
const SECRETS = {
  phone: "06706361792",
  address: "Attila út 35",
  website: "https://greattide-secret.example",
  packageName: "SECRET-PACKAGE-NAME",
  packagePrice: "987654",
  videoId: "SECRETVIDEO1",
  email: "info@greattide.hu",
};

async function seedFullyFilledVendor(
  loginEmail: string,
): Promise<{ id: string; token: string; accountId: number }> {
  const reg = await registerAndVerify({
    email: loginEmail,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: "Great Tide",
    contactEmail: SECRETS.email,
    onboardingDone: false,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category: "photography",
    name: "Great Tide",
    city: "Budapest",
    contactEmail: SECRETS.email,
    address: SECRETS.address,
    contactPhone: SECRETS.phone,
    website: SECRETS.website,
  });
  initVendorBilling(account.id, "HUF");
  const id = `v${account.id}`;
  db.prepare(
    "UPDATE listings SET blurb_hu = ?, blurb_en = ?, price_band = 4, capacity_min = 40, capacity_max = 180, lat = 47.5, lng = 19.04 WHERE id = ?",
  ).run("Magyar leírás", "English description", id);
  addListingPhoto(id, "/uploads/listings/great-tide/one.jpg");
  addListingPackage(id, {
    name: SECRETS.packageName,
    price_text: null,
    price_min: Number(SECRETS.packagePrice),
    price_max: null,
    price_mode: "total",
    description: "Ten hours",
  });
  addListingVideo(id, "youtube", SECRETS.videoId, `https://youtu.be/${SECRETS.videoId}`);
  return { id, token: reg.data.token, accountId: account.id };
}

describe("the anonymous vendor page hands out identity, description, photos and reviews only", () => {
  test("a fully filled listing exposes exactly the allowlist", async () => {
    const { id } = await seedFullyFilledVendor("allowlist@weddly.test");
    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(id)}`);
    expect(r.status).toBe(200);
    expect(Object.keys(r.data.detail).sort()).toEqual(PUBLIC_DETAIL_KEYS);

    // What stays: who they are, what they say, what they shot, the verified check.
    expect(r.data.detail.name).toBe("Great Tide");
    expect(r.data.detail.city).toBe("Budapest");
    expect(r.data.detail.blurb_hu).toBe("Magyar leírás");
    expect(r.data.detail.blurb_en).toBe("English description");
    expect(r.data.detail.gallery_urls).toContain("/uploads/listings/great-tide/one.jpg");
    expect(r.data.detail.claimed).toBe(true);
  });

  test("no gated value appears anywhere in the body, signed in or not", async () => {
    const { id } = await seedFullyFilledVendor("nothing-leaks@weddly.test");
    const { token } = await bootstrapCouple("nothing-leaks-couple@test.test");
    const path = `/api/public/vendors/${encodeURIComponent(id)}`;

    for (const opts of [undefined, { token }]) {
      const r = await req<PublicPayload>("GET", path, undefined, opts);
      expect(r.status).toBe(200);
      const body = JSON.stringify(r.data);
      // Contact: the phone in full and in its old masked form, the address in
      // full and in its old masked form, the website, the mailbox.
      for (const secret of [
        SECRETS.phone,
        "06706",
        SECRETS.address,
        "Attila",
        SECRETS.website,
        SECRETS.email,
        // Packages, videos, coordinates.
        SECRETS.packageName,
        SECRETS.packagePrice,
        SECRETS.videoId,
        "47.5",
      ]) {
        expect(body).not.toContain(secret);
      }
      for (const key of [
        "contact_phone",
        "contact_phone_alt",
        "contact_email",
        "website",
        "address",
        "lat",
        "lng",
        "price_band",
        "capacity_min",
        "capacity_max",
        "spoken_languages",
        "venue_style",
        "packages",
        "videos",
        "currency",
        "bookable",
        "next_available",
        "vendor_account_id",
        "comments",
        "availability",
      ]) {
        expect(body).not.toContain(`"${key}"`);
      }
    }
  });

  test("hide_contact_public no longer changes anything here: there is nothing left to hide", async () => {
    const { id, token } = await seedFullyFilledVendor("hide-moot@weddly.test");
    const path = `/api/public/vendors/${encodeURIComponent(id)}`;
    const before = await req("GET", path);
    await req("PATCH", "/api/vendor/listing/me", { hide_contact_public: true }, { token });
    const after = await req("GET", path);
    expect(JSON.stringify(after.data)).toBe(JSON.stringify(before.data));
  });

  test("a non-boolean hide_contact_public is still rejected", async () => {
    const { token } = await seedFullyFilledVendor("hide-bad@weddly.test");
    const r = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { hide_contact_public: "yes" },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

// Pinned minimal SSR template — the renderer only cares about the SEO_HEAD
// markers + the <html lang> attr it rewrites.
const TEMPLATE = `<!doctype html>
<html lang="hu">
<head>
<!-- SEO_HEAD_START -->
<title>placeholder</title>
<!-- SEO_HEAD_END -->
</head>
<body><div id="root"></div></body>
</html>`;

/** Seed a claimed vendor (id `v{N}`) with no dedicated hero. Returns its `v{N}`
 *  id. Module scope so every describe block below can reach it. */
async function seedClaimedVendorNoHero(email: string, name: string): Promise<string> {
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: name,
    contactEmail: email,
    onboardingDone: false,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category: "photography",
    name,
    city: "Budapest",
    contactEmail: email,
  });
  initVendorBilling(account.id, "HUF");
  return `v${account.id}`;
}

describe("per-supplier SSR og:card meta (/suppliers/:id)", () => {
  test("lookupVendorPageMeta resolves a curated id but NOT /suppliers or /suppliers/signup", () => {
    const sid = curatedSupplierId();
    const name = DIRECTORY.find((d) => d.id === sid)?.name ?? "";
    const meta = lookupVendorPageMeta(`/suppliers/${sid}`);
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe(name);
    // The static routes must never resolve as a vendor id.
    expect(lookupVendorPageMeta("/suppliers")).toBeNull();
    expect(lookupVendorPageMeta("/suppliers/signup")).toBeNull();
    expect(lookupVendorPageMeta("/suppliers/this-id-does-not-exist")).toBeNull();
  });

  test("renderIndexHtml injects the vendor name + city into <title> and og:title", () => {
    const sid = curatedSupplierId();
    const base = DIRECTORY.find((d) => d.id === sid);
    const name = base?.name ?? "";
    const city = base?.city ?? "";
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: `/suppliers/${sid}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(html).toContain(`<title>${name} · ${city}</title>`);
    expect(html).toContain(`<meta property="og:title" content="${name} · ${city}" />`);
  });

  test("og:image falls back to the vendor's first gallery photo when there's no hero", async () => {
    const id = await seedClaimedVendorNoHero("gallery@weddly.test", "Nagy Gergely Videography");
    // Vendor uploaded portfolio photos but never set a dedicated hero.
    const photoUrl = `/uploads/listings/${id}/1.webp`;
    addListingPhoto(id, photoUrl);
    addListingPhoto(id, `/uploads/listings/${id}/2.webp`);

    const meta = lookupVendorPageMeta(`/suppliers/${id}`);
    expect(meta?.heroImageUrl).toBe(photoUrl); // first uploaded photo wins

    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: `/suppliers/${id}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    // The vendor's own photo becomes the share-card image (made absolute), NOT
    // the brand og.png.
    expect(html).toContain(`<meta property="og:image" content="https://${HU_HOST}${photoUrl}" />`);
    expect(html).not.toContain(`<meta property="og:image" content="https://${HU_HOST}/og.png" />`);
  });

  test("og:image falls back to the brand og.png when the vendor has no photos at all", async () => {
    const id = await seedClaimedVendorNoHero("nopics@weddly.test", "No Pics Studio");

    const meta = lookupVendorPageMeta(`/suppliers/${id}`);
    expect(meta?.heroImageUrl).toBeNull();

    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: `/suppliers/${id}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(html).toContain(`<meta property="og:image" content="https://${HU_HOST}/og.png" />`);
  });

  test("indexing requires at least three meaningful sentences and three distinct photos", async () => {
    const id = await seedClaimedVendorNoHero("seo-quality@weddly.test", "Quality Photo Studio");
    const threeSentences =
      "Természetes hangulatú esküvői fotókat készítünk Budapesten és környékén. " +
      "A párokat már a tervezés során személyes konzultációval és részletes idővonallal segítjük. " +
      "Az átadott válogatás gondosan szerkesztett, nagy felbontású képeket tartalmaz.";
    db.prepare("UPDATE listings SET blurb_hu = ?, blurb_en = ? WHERE id = ?").run(
      threeSentences,
      threeSentences,
      id,
    );
    addListingPhoto(id, `/uploads/listings/${id}/1.webp`);
    addListingPhoto(id, `/uploads/listings/${id}/2.webp`);
    const profileLoc = `<loc>https://${HU_HOST}/suppliers/${vendorPublicId(id, "Quality Photo Studio")}</loc>`;

    expect(lookupVendorPageMeta(`/suppliers/${id}`)?.indexable).toBe(false);
    expect(renderSitemapXml(null)).not.toContain(profileLoc);

    addListingPhoto(id, `/uploads/listings/${id}/3.webp`);
    expect(lookupVendorPageMeta(`/suppliers/${id}`)?.indexable).toBe(true);

    db.prepare("UPDATE listings SET blurb_hu = ?, blurb_en = ? WHERE id = ?").run(
      "Természetes hangulatú esküvői fotókat készítünk Budapesten és környékén. A teljes galériát gondosan szerkesztve adjuk át.",
      "Természetes hangulatú esküvői fotókat készítünk Budapesten és környékén. A teljes galériát gondosan szerkesztve adjuk át.",
      id,
    );
    expect(lookupVendorPageMeta(`/suppliers/${id}`)?.indexable).toBe(false);
  });
});

// Pretty, name-based public ids: /suppliers/magyar-foto-v12 instead of /suppliers/v12.
describe("vendor pretty public id (name-based slug)", () => {
  test("slugifyName folds Hungarian accents to a hyphenated ASCII slug", () => {
    expect(slugifyName("Magyar Fotó")).toBe("magyar-foto");
    expect(slugifyName("Fodor István Attila E.V.")).toBe("fodor-istvan-attila-e-v");
    expect(slugifyName("Zene & DJ")).toBe("zene-dj");
    expect(slugifyName("Őrült Ötletek Kft.")).toBe("orult-otletek-kft");
    expect(slugifyName("   ")).toBe(""); // nothing alphanumeric survives
  });

  test("vendorPublicId prefixes v/c ids, leaves curated slugs untouched; canonicalListingId reverses it", () => {
    expect(vendorPublicId("v12", "Magyar Fotó")).toBe("magyar-foto-v12");
    expect(vendorPublicId("c5", "Bloom Studio")).toBe("bloom-studio-c5");
    expect(vendorPublicId("v12", "   ")).toBe("v12"); // empty slug → bare id
    expect(vendorPublicId("aranybastya", "Aranybástya")).toBe("aranybastya"); // curated unchanged

    expect(canonicalListingId("magyar-foto-v12")).toBe("v12");
    expect(canonicalListingId("v12")).toBe("v12");
    expect(canonicalListingId("bloom-studio-c5")).toBe("c5");
    expect(canonicalListingId("aranybastya")).toBeNull();
  });

  test("lookupVendorPageMeta resolves BOTH the bare id and the pretty slug to the same vendor", async () => {
    const id = await seedClaimedVendorNoHero("pretty@weddly.test", "Magyar Fotó");
    const pretty = vendorPublicId(id, "Magyar Fotó"); // magyar-foto-vN

    const byBare = lookupVendorPageMeta(`/suppliers/${id}`);
    const byPretty = lookupVendorPageMeta(`/suppliers/${pretty}`);
    expect(byBare?.name).toBe("Magyar Fotó");
    expect(byPretty?.name).toBe("Magyar Fotó");
    // Both advertise the SAME pretty canonical id.
    expect(byBare?.publicId).toBe(pretty);
    expect(byPretty?.publicId).toBe(pretty);
    // A wrong/stale name in the slug still resolves (the trailing id wins).
    expect(lookupVendorPageMeta(`/suppliers/stale-name-${id}`)?.name).toBe("Magyar Fotó");
  });

  test("the vendor page canonical is the pretty URL, whether reached bare or pretty", async () => {
    const id = await seedClaimedVendorNoHero("canon@weddly.test", "Great Tide Kft.");
    const pretty = vendorPublicId(id, "Great Tide Kft."); // great-tide-kft-vN
    const expected = `<link rel="canonical" href="https://${HU_HOST}/suppliers/${pretty}" />`;

    for (const path of [`/suppliers/${id}`, `/suppliers/${pretty}`, `/suppliers/wrong-${id}`]) {
      const html = renderIndexHtml(TEMPLATE, {
        host: HU_HOST,
        pathname: path,
        isRsvp: false,
        acceptLanguage: "en-US,en;q=0.9",
      });
      expect(html).toContain(expected);
      expect(html).toContain(
        `<meta property="og:url" content="https://${HU_HOST}/suppliers/${pretty}" />`,
      );
    }
  });
});

// The SSR canonical above always pointed at the pretty URL, so the pretty URL is
// what gets crawled, shared and pasted into a client's inbox. The JSON behind it
// was answering a different question: `buildSupplierDetail` resolved the id
// correctly and then keyed every follow-up lookup on the RAW path segment, so
// the one link a vendor actually hands out served a hollow page: no packages,
// no Q&A, no rating summary, no availability, `bookable: false`.
describe("the pretty share URL serves the same page as the bare id", () => {
  test("photos, description and reviews all survive the pretty form", async () => {
    wipeAll();
    const id = await seedClaimedVendorNoHero("pretty@weddly.test", "Great Tide Kft.");
    const pretty = vendorPublicId(id, "Great Tide Kft.");
    expect(pretty).not.toBe(id);
    expect(canonicalListingId(pretty)).toBe(id);

    // Give the listing the things a claimed vendor shows anonymously, so an
    // empty answer is unambiguously wrong rather than merely unfurnished.
    addListingPhoto(id, "/uploads/listings/pretty/one.jpg");
    db.prepare("UPDATE listings SET blurb_en = ? WHERE id = ?").run("Ten hours of coverage", id);
    const vendorUserId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get("pretty@weddly.test") as {
        id: number;
      }
    ).id;
    const now = Date.now();
    db.prepare(
      `INSERT INTO supplier_reviews
         (supplier_id, author_user_id, couple_id, rating, body, published, created_at, updated_at)
       VALUES (?, ?, NULL, 5, 'lovely', 1, ?, ?)`,
    ).run(id, vendorUserId, now, now);

    type Detail = {
      detail: { id: string; blurb_en: string; gallery_urls: string[]; claimed: boolean };
      reviews: unknown[];
    };
    const bare = await req<Detail>("GET", `/api/public/vendors/${encodeURIComponent(id)}`);
    const viaPretty = await req<Detail>("GET", `/api/public/vendors/${encodeURIComponent(pretty)}`);

    expect(bare.status).toBe(200);
    expect(viaPretty.status).toBe(200);
    // Same listing, therefore the same payload. The pretty form is a spelling,
    // not a different vendor.
    expect(viaPretty.data.detail.id).toBe(bare.data.detail.id);
    expect(viaPretty.data.detail.blurb_en).toBe("Ten hours of coverage");
    expect(viaPretty.data.detail.gallery_urls).toEqual(bare.data.detail.gallery_urls);
    expect(viaPretty.data.detail.gallery_urls.length).toBeGreaterThan(0);
    expect(viaPretty.data.reviews.length).toBe(1);
    expect(bare.data.reviews.length).toBe(1);
    // `claimed` is the one that reads as "this business is gone" to a couple.
    expect(viaPretty.data.detail.claimed).toBe(true);
  }, 30000);
});
