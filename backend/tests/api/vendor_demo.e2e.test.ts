// Vendor-side demo: POST /api/demo/vendor/start seeds a throwaway Shrek-themed
// cake studio ("Gingy's Wedding Cakes" / "Mézi Tortaműhely") with fairy-tale
// client inquiries, payment schedules and blocked dates, returns a vendor
// session, and is reaped by purgeStaleVendorDemos WITHOUT consuming a real
// founding slot.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { purgeStaleDemoCouples } from "../../src/domain/demo_seed";
import { vendorFoundingSlotsUsed } from "../../src/domain/vendor_billing";
import { purgeStaleVendorDemos } from "../../src/domain/vendor_demo_seed";
import { req, wipeAll } from "../helpers";

interface StartRes {
  session: { token: string; user: { id: number; role: string; email: string } };
  seeded: Record<string, number> & { listing_id?: string };
}
interface ClientsRes {
  clients: Array<{
    id: number;
    couple_display_name: string;
    event_date: string;
    status: string;
    stage: string | null;
  }>;
}
interface StatsRes {
  inquiries_total: number;
  inquiries_30d: number;
  by_status: Record<string, number>;
  upcoming: Array<{ couple_display_name: string; event_date: string }>;
  blocked_dates_count: number;
  listing_completeness: number;
  revenue_tracked: number;
  currency: string;
  billing: { subscription_status: string; entitled: boolean; is_founding_member: boolean };
}
interface ListingRes {
  listing: { id: string; name: string; city: string; category: string; status: string };
  account: { display_name: string; onboarding_done: boolean };
}

async function startVendorDemo(locale?: "hu" | "en"): Promise<StartRes> {
  const r = await req<StartRes>("POST", "/api/demo/vendor/start", locale ? { locale } : {});
  expect(r.status).toBe(201);
  return r.data;
}

describe("vendor demo", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("start seeds an entitled vendor session with the fairy-tale bakery", async () => {
    const { session, seeded } = await startVendorDemo();

    expect(session.user.role).toBe("vendor");
    expect(session.user.email).toMatch(/@demo\.weddly\.local$/);
    expect(seeded.clients_created).toBe(5);
    expect(seeded.payments_created).toBe(5);
    expect(seeded.blocked_dates).toBe(3);

    // The listing exists, is owned by the demo account, and the shell/editor
    // can read it. Default (no locale in body) is EN.
    const listing = await req<ListingRes>("GET", "/api/vendor/listing/me", undefined, {
      token: session.token,
    });
    expect(listing.status).toBe(200);
    expect(listing.data.listing.id).toMatch(/^v\d+$/);
    expect(listing.data.listing.name).toBe("Gingy's Wedding Cakes");
    expect(listing.data.listing.category).toBe("cake_dessert");
    expect(listing.data.account.onboarding_done).toBe(true);

    // Entitlement: a listing PATCH (an EDIT surface behind
    // vendorEntitlementBlock) is allowed, the demo is never read-only.
    const patch = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { city: "Duloc" },
      { token: session.token },
    );
    expect(patch.status).toBe(200);
  });

  test("demo listing never surfaces in the public directory", async () => {
    const { seeded } = await startVendorDemo();
    const list = await req<{ suppliers: Array<{ id: string; name: string }> }>(
      "GET",
      "/api/suppliers",
    );
    expect(list.status).toBe(200);
    expect(list.data.suppliers.some((s) => s.id === seeded.listing_id)).toBe(false);
    expect(list.data.suppliers.some((s) => s.name === "Gingy's Wedding Cakes")).toBe(false);
  });

  test("dashboard stats reflect the seeded book of business", async () => {
    const { session } = await startVendorDemo();
    const stats = await req<StatsRes>("GET", "/api/vendor/stats", undefined, {
      token: session.token,
    });
    expect(stats.status).toBe(200);
    expect(stats.data.inquiries_total).toBe(5);
    // Shrek (-20d), Cinderella (-1d), Snow White (-6d) are inside the window;
    // Donkey (-35d) and Farquaad (-40d) are not.
    expect(stats.data.inquiries_30d).toBe(3);
    expect(stats.data.by_status).toEqual({
      confirmed: 2,
      requested: 1,
      vendor_seen: 1,
      cancelled: 1,
    });
    // Two confirmed future weddings: Shrek & Fiona, then Donkey & Dragon.
    expect(stats.data.upcoming.map((u) => u.couple_display_name)).toEqual([
      "Shrek & Fiona",
      "Donkey & Dragon",
    ]);
    expect(stats.data.blocked_dates_count).toBe(3);
    // Blurbs + contact + price band + capacity + hero cover photo are all
    // seeded, so the demo card scores a full, finished-looking listing.
    expect(stats.data.listing_completeness).toBe(100);
    // EN demo bills in EUR: recorded deposits 400 (Shrek) + 210 (Donkey).
    expect(stats.data.currency).toBe("EUR");
    expect(stats.data.revenue_tracked).toBe(610);
    expect(stats.data.billing.entitled).toBe(true);
    expect(stats.data.billing.subscription_status).toBe("founding");
    // The badge is NOT granted, the demo must not look like (or consume) a
    // real founding membership.
    expect(stats.data.billing.is_founding_member).toBe(false);
  });

  test("clients carry CRM fields and payment schedules", async () => {
    const { session } = await startVendorDemo();
    const clients = await req<ClientsRes>("GET", "/api/vendor/clients", undefined, {
      token: session.token,
    });
    expect(clients.status).toBe(200);
    expect(clients.data.clients.length).toBe(5);

    const shrek = clients.data.clients.find((c) => c.couple_display_name === "Shrek & Fiona");
    expect(shrek).toBeDefined();
    if (!shrek) throw new Error("missing Shrek booking");
    expect(shrek.status).toBe("confirmed");
    expect(shrek.stage).toBe("Tasting done");

    const detail = await req<{ payments: Array<{ label: string; paid: boolean }> }>(
      "GET",
      `/api/vendor/clients/${shrek.id}`,
      undefined,
      { token: session.token },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.payments.length).toBe(3);
    expect(detail.data.payments.filter((p) => p.paid).length).toBe(2);
  });

  test("start does NOT consume a real founding slot", async () => {
    const before = vendorFoundingSlotsUsed();
    await startVendorDemo();
    expect(vendorFoundingSlotsUsed()).toBe(before);
  });

  test("purge (vendors first, then couples) removes everything with no FK errors", async () => {
    const foundingBefore = vendorFoundingSlotsUsed();
    const { session } = await startVendorDemo();
    const vendorUserId = session.user.id;

    const demoCouples = (
      db.prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 1").get() as { n: number }
    ).n;
    expect(demoCouples).toBe(5);

    // Age everything past the TTL and sweep: vendors BEFORE couples.
    db.prepare("UPDATE users SET created_at = 0 WHERE id = ?").run(vendorUserId);
    db.prepare("UPDATE couples SET created_at = 0 WHERE is_demo = 1").run();

    const vendorsPurged = purgeStaleVendorDemos(0);
    const couplesPurged = purgeStaleDemoCouples(0);
    expect(vendorsPurged).toBe(1);
    expect(couplesPurged).toBe(5);

    // Nothing left behind: user, account, subscription, listing, bookings,
    // payments, blocked dates.
    const count = (sql: string, ...params: (number | string)[]) =>
      (db.prepare(sql).get(...params) as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM users WHERE id = ?", vendorUserId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM vendor_accounts")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM vendor_subscriptions")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM listings WHERE source = 'claimed'")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM supplier_bookings")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM vendor_client_payments")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM vendor_unavailable_dates")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 1")).toBe(0);
    // The demo never touched the real founding cohort.
    expect(vendorFoundingSlotsUsed()).toBe(foundingBefore);
  });

  test("locale=hu seeds a fully Hungarian bakery billed in HUF", async () => {
    const { session } = await startVendorDemo("hu");

    const listing = await req<ListingRes>("GET", "/api/vendor/listing/me", undefined, {
      token: session.token,
    });
    expect(listing.data.listing.name).toBe("Mézi Tortaműhely");
    expect(listing.data.listing.city).toBe("Túl az Óperencián");
    expect(listing.data.account.display_name).toBe("Mézi Tortaműhely");

    const clients = await req<ClientsRes>("GET", "/api/vendor/clients", undefined, {
      token: session.token,
    });
    const names = clients.data.clients.map((c) => c.couple_display_name);
    expect(names).toContain("Szamár & Sárkány");
    expect(names).toContain("Hamupipőke & Szőke Herceg");
    expect(names).not.toContain("Donkey & Dragon");

    const stats = await req<StatsRes>("GET", "/api/vendor/stats", undefined, {
      token: session.token,
    });
    expect(stats.data.currency).toBe("HUF");
    // HUF deposits: 160 000 (Shrek) + 84 000 (Szamár).
    expect(stats.data.revenue_tracked).toBe(244_000);
  });
});
