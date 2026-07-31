// Public, unauthenticated vendor page — the shareable surface for people
// outside Weddly. Covers the aggregate endpoint `GET /api/public/vendors/:id`
// (no auth, curated public subset: published reviews only, public Q&A only,
// no admin-only comments_count) and the per-vendor SSR og:card meta that makes
// a shared link preview show the vendor name instead of the brand strapline.

import "../setup";

import { describe, expect, test, beforeEach } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { addListingPhoto, createVendorListing } from "../../src/domain/listings";
import { DIRECTORY } from "../../src/domain/suppliers_data";
import { createVendorAccount } from "../../src/domain/vendor_accounts";
import { initVendorBilling } from "../../src/domain/vendor_billing";
import { maskPhoneForAnonymous } from "../../src/domain/phone_mask";
import { maskAddressForPublic } from "../../src/domain/contact_mask";
import { HU_HOST, lookupVendorPageMeta, renderIndexHtml } from "../../src/lib/seo_ssr";
import { canonicalListingId, slugifyName, vendorPublicId } from "@shared/vendor_slug";

async function registerAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
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
  detail: {
    id: string;
    name: string;
    comments_count?: number;
    bookable: boolean;
    reviews_summary: { reviews_count: number };
  };
  reviews: Array<{ id: number; published?: boolean; rating: number }>;
  comments: Array<{ id: number; visibility: string; body: string }>;
  availability: {
    unavailable_dates: string[];
    partial_dates: string[];
    next_available: string | null;
    bookable: boolean;
  };
}

describe("GET /api/public/vendors/:id — no auth", () => {
  test("returns detail + reviews + comments + availability with NO token", async () => {
    const sid = curatedSupplierId();
    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.id).toBe(sid);
    expect(Array.isArray(r.data.reviews)).toBe(true);
    expect(Array.isArray(r.data.comments)).toBe(true);
    expect(r.data.availability.unavailable_dates).toEqual([]);
    expect(typeof r.data.availability.bookable).toBe("boolean");
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

    const r = await req<PublicPayload>("GET", `/api/public/vendors/${encodeURIComponent(sid)}`);
    expect(r.status).toBe(200);
    expect(r.data.reviews.length).toBe(1);
    expect(r.data.reviews[0]?.rating).toBe(5);
  });

  test("returns the public Q&A tier only — admin_internal + vendor_only hidden", async () => {
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
    expect(r.data.comments.length).toBe(1);
    expect(r.data.comments[0]?.visibility).toBe("public");
  });

  test("unknown id → 404", async () => {
    const r = await req("GET", "/api/public/vendors/this-vendor-does-not-exist");
    expect(r.status).toBe(404);
  });

  test("a signed-in couple can also read it (token is optional, not required)", async () => {
    const { token } = await bootstrapCouple("couple@test.test");
    const sid = curatedSupplierId();
    const r = await req<PublicPayload>(
      "GET",
      `/api/public/vendors/${encodeURIComponent(sid)}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.detail.comments_count).toBeUndefined();
  });
});

/** Seed a claimed vendor carrying a phone number, so the public detail has a
 *  `contact_phone` to gate. Returns its `v{N}` id. */
async function seedVendorWithPhone(email: string, name: string, phone: string): Promise<string> {
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
    contactPhone: phone,
  });
  initVendorBilling(account.id, "HUF");
  return `v${account.id}`;
}

describe("public vendor phone is gated behind registration", () => {
  const PHONE = "06706361792";

  test("an anonymous visitor gets only the first five digits", async () => {
    const id = await seedVendorWithPhone("phone-anon@weddly.test", "Great Tide", PHONE);
    const r = await req<{ detail: { contact_phone: string | null } }>(
      "GET",
      `/api/public/vendors/${encodeURIComponent(id)}`,
    );
    expect(r.status).toBe(200);
    expect(r.data.detail.contact_phone).toBe("06706******");
    // The hidden digits never leave the server.
    expect(r.data.detail.contact_phone).not.toContain("361792");
  });

  test("a signed-in user gets the full number (token reveals it)", async () => {
    const id = await seedVendorWithPhone("phone-auth@weddly.test", "Great Tide", PHONE);
    const { token } = await bootstrapCouple("phone-couple@test.test");
    const r = await req<{ detail: { contact_phone: string | null } }>(
      "GET",
      `/api/public/vendors/${encodeURIComponent(id)}`,
      undefined,
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.detail.contact_phone).toBe(PHONE);
  });
});

// A business that publishes two lines (venue desk + events) carries the second
// one in `contact_phone_alt`. It is a public DTO field, so it has to be gated
// exactly like the primary — an unmasked second number would hand anonymous
// visitors the digits the first one is deliberately hiding.
describe("a second published phone is gated like the first", () => {
  // Curated entry from suppliers_data.ts, the only listing shape that carries
  // an alt number today. Deterministic: it ships in code, not in a fixture.
  const CURATED_ID = "finca-monasterio";
  const EVENTS = "+34 654 373 549";
  const HOTEL = "+34 856 626 777";

  test("an anonymous visitor gets both numbers masked", async () => {
    const r = await req<{
      detail: { contact_phone: string | null; contact_phone_alt?: string | null };
    }>("GET", `/api/public/vendors/${CURATED_ID}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.contact_phone).toBe(maskPhoneForAnonymous(EVENTS));
    expect(r.data.detail.contact_phone_alt).toBe(maskPhoneForAnonymous(HOTEL));
    // The masked tails never leave the server.
    expect(r.data.detail.contact_phone_alt).not.toContain("626 777");
  });

  test("a signed-in user gets both in full", async () => {
    const { token } = await bootstrapCouple("alt-phone-couple@test.test");
    const r = await req<{
      detail: { contact_phone: string | null; contact_phone_alt?: string | null };
    }>("GET", `/api/public/vendors/${CURATED_ID}`, undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.detail.contact_phone).toBe(EVENTS);
    expect(r.data.detail.contact_phone_alt).toBe(HOTEL);
  });
});

describe("maskPhoneForAnonymous", () => {
  test("keeps the first five digits, masks the rest", () => {
    expect(maskPhoneForAnonymous("06706361792")).toBe("06706******");
  });

  test("counts digits not characters, preserving separators", () => {
    expect(maskPhoneForAnonymous("+36 70 636 1792")).toBe("+36 70 6** ****");
  });

  test("a number with five or fewer digits is left whole", () => {
    expect(maskPhoneForAnonymous("12345")).toBe("12345");
    expect(maskPhoneForAnonymous("112")).toBe("112");
  });
});

/** Seed a claimed vendor carrying a full address + contact email + phone, so
 *  the public detail has every gated field. Returns its `v{N}` id and the
 *  owner's session token (the toggle is edited through /api/vendor/listing/me).
 *  The public contact email is set independently of the login email so the
 *  masking assertion reads a predictable value. */
async function seedVendorWithContact(opts: {
  loginEmail: string;
  name: string;
  contactEmail: string;
  address: string;
  phone: string;
}): Promise<{ id: string; token: string }> {
  const reg = await registerAndVerify({
    email: opts.loginEmail,
    password: "supersafe123",
    full_name: "Vendor Owner",
  });
  const userId = reg.data.user.id;
  db.prepare("UPDATE users SET role = 'vendor', couple_id = NULL WHERE id = ?").run(userId);
  const account = createVendorAccount({
    ownerUserId: userId,
    displayName: opts.name,
    contactEmail: opts.contactEmail,
    onboardingDone: false,
  });
  createVendorListing({
    vendorAccountId: account.id,
    category: "photography",
    name: opts.name,
    city: "Budapest",
    contactEmail: opts.contactEmail,
    address: opts.address,
    contactPhone: opts.phone,
  });
  initVendorBilling(account.id, "HUF");
  return { id: `v${account.id}`, token: reg.data.token };
}

interface ContactDetail {
  detail: { address: string | null; contact_email: string | null; contact_phone: string | null };
}

describe("what an anonymous visitor may read off a vendor page", () => {
  const CONTACT_EMAIL = "info@greattide.hu";
  const ADDRESS = "Attila út 35";
  const PHONE = "06706361792";

  test("PATCH /api/vendor/listing/me toggles hide_contact_public", async () => {
    const { token } = await seedVendorWithContact({
      loginEmail: "hide-toggle@weddly.test",
      name: "Great Tide",
      contactEmail: CONTACT_EMAIL,
      address: ADDRESS,
      phone: PHONE,
    });
    const before = await req<{ listing: { hide_contact_public: boolean } }>(
      "GET",
      "/api/vendor/listing/me",
      undefined,
      { token },
    );
    expect(before.data.listing.hide_contact_public).toBe(false);

    const patched = await req<{ listing: { hide_contact_public: boolean } }>(
      "PATCH",
      "/api/vendor/listing/me",
      { hide_contact_public: true },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.listing.hide_contact_public).toBe(true);
  });

  test("a non-boolean hide_contact_public is rejected", async () => {
    const { token } = await seedVendorWithContact({
      loginEmail: "hide-bad@weddly.test",
      name: "Great Tide",
      contactEmail: CONTACT_EMAIL,
      address: ADDRESS,
      phone: PHONE,
    });
    const r = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { hide_contact_public: "yes" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("off by default: the address stays public, the email + phone do not", async () => {
    const { id } = await seedVendorWithContact({
      loginEmail: "hide-off@weddly.test",
      name: "Great Tide",
      contactEmail: CONTACT_EMAIL,
      address: ADDRESS,
      phone: PHONE,
    });
    const r = await req<ContactDetail>("GET", `/api/public/vendors/${encodeURIComponent(id)}`);
    expect(r.status).toBe(200);
    // The address is what puts a venue on the map and is a published business
    // fact, so it stays under the vendor's own switch.
    expect(r.data.detail.address).toBe(ADDRESS);
    // The phone is masked for an anonymous visitor whatever the vendor chose.
    // The email is not masked, it is ABSENT: a teaser was still a published
    // domain plus a two-letter head, on the page a crawler reads most easily.
    expect(r.data.detail.contact_email).toBeNull();
    expect(r.data.detail.contact_phone).toBe("06706******");
  });

  test("enabled: the address tail is masked too", async () => {
    const { id, token } = await seedVendorWithContact({
      loginEmail: "hide-on@weddly.test",
      name: "Great Tide",
      contactEmail: CONTACT_EMAIL,
      address: ADDRESS,
      phone: PHONE,
    });
    await req("PATCH", "/api/vendor/listing/me", { hide_contact_public: true }, { token });

    const r = await req<ContactDetail>("GET", `/api/public/vendors/${encodeURIComponent(id)}`);
    expect(r.status).toBe(200);
    expect(r.data.detail.address).toBe("Attila út •••");
    expect(r.data.detail.contact_email).toBeNull();
    expect(r.data.detail.contact_phone).toBe("06706******");
    // The hidden characters never leave the server.
    expect(r.data.detail.address).not.toContain("35");
  });

  test("enabled: a signed-in couple gets the full address + phone, and still no email", async () => {
    const { id, token } = await seedVendorWithContact({
      loginEmail: "hide-reveal@weddly.test",
      name: "Great Tide",
      contactEmail: CONTACT_EMAIL,
      address: ADDRESS,
      phone: PHONE,
    });
    await req("PATCH", "/api/vendor/listing/me", { hide_contact_public: true }, { token });
    const { token: coupleToken } = await bootstrapCouple("hide-couple@test.test");

    const r = await req<ContactDetail>(
      "GET",
      `/api/public/vendors/${encodeURIComponent(id)}`,
      undefined,
      { token: coupleToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.detail.address).toBe(ADDRESS);
    expect(r.data.detail.contact_phone).toBe(PHONE);
    // Signing in reveals the address and the phone. It does NOT reveal the
    // mailbox: that is withheld from every viewer, on every surface, so an
    // account is not a key to the address book (owner rule, 2026-07-31).
    expect(r.data.detail.contact_email).toBeNull();
    expect(JSON.stringify(r.data)).not.toContain(CONTACT_EMAIL);
  });
});

describe("contact_mask helpers", () => {
  test("maskAddressForPublic hides the last token, keeping the street", () => {
    expect(maskAddressForPublic("Attila út 35")).toBe("Attila út •••");
    expect(maskAddressForPublic("Váci utca 12/B")).toBe("Váci utca •••");
  });

  test("maskAddressForPublic tail-masks a single-token address", () => {
    expect(maskAddressForPublic("Főutca")).toBe("Fő•••");
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

describe("per-vendor SSR og:card meta (/vendors/:id)", () => {
  test("lookupVendorPageMeta resolves a curated id but NOT /vendors or /vendors/signup", () => {
    const sid = curatedSupplierId();
    const name = DIRECTORY.find((d) => d.id === sid)?.name ?? "";
    const meta = lookupVendorPageMeta(`/vendors/${sid}`);
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe(name);
    // The static routes must never resolve as a vendor id.
    expect(lookupVendorPageMeta("/vendors")).toBeNull();
    expect(lookupVendorPageMeta("/vendors/signup")).toBeNull();
    expect(lookupVendorPageMeta("/vendors/this-id-does-not-exist")).toBeNull();
  });

  test("renderIndexHtml injects the vendor name + city into <title> and og:title", () => {
    const sid = curatedSupplierId();
    const base = DIRECTORY.find((d) => d.id === sid);
    const name = base?.name ?? "";
    const city = base?.city ?? "";
    const html = renderIndexHtml(TEMPLATE, {
      host: "tryweddly.com",
      pathname: `/vendors/${sid}`,
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

    const meta = lookupVendorPageMeta(`/vendors/${id}`);
    expect(meta?.heroImageUrl).toBe(photoUrl); // first uploaded photo wins

    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: `/vendors/${id}`,
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

    const meta = lookupVendorPageMeta(`/vendors/${id}`);
    expect(meta?.heroImageUrl).toBeNull();

    const html = renderIndexHtml(TEMPLATE, {
      host: HU_HOST,
      pathname: `/vendors/${id}`,
      isRsvp: false,
      acceptLanguage: "en-US,en;q=0.9",
    });
    expect(html).toContain(`<meta property="og:image" content="https://${HU_HOST}/og.png" />`);
  });
});

// Pretty, name-based public ids: /vendors/magyar-foto-v12 instead of /vendors/v12.
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

    const byBare = lookupVendorPageMeta(`/vendors/${id}`);
    const byPretty = lookupVendorPageMeta(`/vendors/${pretty}`);
    expect(byBare?.name).toBe("Magyar Fotó");
    expect(byPretty?.name).toBe("Magyar Fotó");
    // Both advertise the SAME pretty canonical id.
    expect(byBare?.publicId).toBe(pretty);
    expect(byPretty?.publicId).toBe(pretty);
    // A wrong/stale name in the slug still resolves (the trailing id wins).
    expect(lookupVendorPageMeta(`/vendors/stale-name-${id}`)?.name).toBe("Magyar Fotó");
  });

  test("the vendor page canonical is the pretty URL, whether reached bare or pretty", async () => {
    const id = await seedClaimedVendorNoHero("canon@weddly.test", "Great Tide Kft.");
    const pretty = vendorPublicId(id, "Great Tide Kft."); // great-tide-kft-vN
    const expected = `<link rel="canonical" href="https://${HU_HOST}/vendors/${pretty}" />`;

    for (const path of [`/vendors/${id}`, `/vendors/${pretty}`, `/vendors/wrong-${id}`]) {
      const html = renderIndexHtml(TEMPLATE, {
        host: HU_HOST,
        pathname: path,
        isRsvp: false,
        acceptLanguage: "en-US,en;q=0.9",
      });
      expect(html).toContain(expected);
      expect(html).toContain(
        `<meta property="og:url" content="https://${HU_HOST}/vendors/${pretty}" />`,
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
  test("packages, reviews, availability and bookable all survive the pretty form", async () => {
    wipeAll();
    const id = await seedClaimedVendorNoHero("pretty@weddly.test", "Great Tide Kft.");
    const pretty = vendorPublicId(id, "Great Tide Kft.");
    expect(pretty).not.toBe(id);
    expect(canonicalListingId(pretty)).toBe(id);

    // Give the listing the things a claimed vendor has, so an empty answer is
    // unambiguously wrong rather than merely unfurnished.
    const vendorLogin = await req<{ token: string }>("POST", "/api/auth/login", {
      email: "pretty@weddly.test",
      password: "supersafe123",
    });
    const pkg = await req(
      "POST",
      "/api/vendor/listing/me/packages",
      { name: "Full day", price_text: "450 000 Ft", description: "Ten hours of coverage" },
      { token: vendorLogin.data.token },
    );
    expect(pkg.status).toBe(201);

    type Detail = {
      detail: { id: string; bookable: boolean; packages: unknown[] };
      availability: { bookable: boolean };
    };
    const bare = await req<Detail>("GET", `/api/public/vendors/${encodeURIComponent(id)}`);
    const viaPretty = await req<Detail>("GET", `/api/public/vendors/${encodeURIComponent(pretty)}`);

    expect(bare.status).toBe(200);
    expect(viaPretty.status).toBe(200);
    // Same listing, therefore the same payload. The pretty form is a spelling,
    // not a different vendor.
    expect(viaPretty.data.detail.id).toBe(bare.data.detail.id);
    expect(viaPretty.data.detail.packages.length).toBe(bare.data.detail.packages.length);
    expect(viaPretty.data.detail.packages.length).toBeGreaterThan(0);
    // `bookable` is the one that reads as "this business is gone" to a couple.
    expect(viaPretty.data.detail.bookable).toBe(bare.data.detail.bookable);
    expect(viaPretty.data.detail.bookable).toBe(true);
    expect(viaPretty.data.availability.bookable).toBe(true);
  }, 30000);
});
