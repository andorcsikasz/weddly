// One business, one card. A couple can name a vendor from four different forms
// (the DIY modal, the guest-page venue picker, the planning pipeline, the
// "already booked" card) and all four POST here, so this is where "is this
// already on Weddly?" is answered for every one of them at once — including the
// fifth form somebody adds later, which is the whole reason the check lives on
// the server rather than in each page's own directory copy.
//
// Three behaviours, one column (`couple_suppliers.listing_id`):
//   - a name that IS listed is refused (409 already_listed) rather than becoming
//     a second, blank card beside the real listing;
//   - a row that already duplicates one can be BOUND to it (POST /adopt), which
//     moves the category pick to the listing and destroys nothing;
//   - a name that ISN'T listed and carries a location gets PUBLISHED to the
//     community directory, which is also what makes the vendor reachable by the
//     claim-invite campaign instead of living inside one workspace forever.
//
// Covers backend/src/routes/couple_suppliers.ts, domain/couple_suppliers.ts and
// domain/listings.ts:findDirectoryTwinByName.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req } from "../helpers";

interface SupplierDTO {
  id: string;
  name: string;
  category: string;
  city: string | null;
  price_huf: number | null;
  listing_id: string | null;
  directory_match: { id: string; name: string; category: string } | null;
}

interface ErrorBody {
  error: string;
  detail: { code?: string; existing?: { id: string; name: string } } | null;
}

/** A listing nobody else can collide with. Curated entries are materialised in
 *  the test DB at boot, so a plausible venue name might already be in there —
 *  these ids and names are deliberately unmistakable. */
function insertListing(
  id: string,
  name: string,
  category = "venue",
  status = "active",
  source = "community",
): void {
  const ts = Date.now();
  db.prepare(
    `INSERT INTO listings (id, source, category, name, city, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Zebegény', ?, ?, ?)`,
  ).run(id, source, category, name, status, ts, ts);
}

const TWIN_NAME = "Zebegényi Kőkastély Próbahely";

describe("couple supplier ↔ directory binding", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM listings WHERE id LIKE 'bindtest-%'").run();
  });

  describe("create refuses a business that is already listed", () => {
    test("an exact name in the same category is refused with the listing attached", async () => {
      insertListing("bindtest-1", TWIN_NAME);
      const { token } = await bootstrapCouple("bind-exact@weddly.test");

      const r = await req<ErrorBody>(
        "POST",
        "/api/couple-suppliers",
        { name: TWIN_NAME, category: "venue" },
        { token },
      );
      expect(r.status).toBe(409);
      expect(r.data.detail?.code).toBe("already_listed");
      expect(r.data.detail?.existing?.id).toBe("bindtest-1");
      expect(r.data.detail?.existing?.name).toBe(TWIN_NAME);
    });

    test("the same business typed without diacritics, case or legal form is still refused", async () => {
      insertListing("bindtest-2", TWIN_NAME);
      const { token } = await bootstrapCouple("bind-folded@weddly.test");

      const r = await req<ErrorBody>(
        "POST",
        "/api/couple-suppliers",
        { name: "zebegenyi kokastely probahely kft.", category: "venue" },
        { token },
      );
      expect(r.status).toBe(409);
      expect(r.data.detail?.existing?.id).toBe("bindtest-2");
    });

    test("a mis-categorised exact name is refused too — it is the same place, filed wrong", async () => {
      insertListing("bindtest-3", TWIN_NAME);
      const { token } = await bootstrapCouple("bind-miscat@weddly.test");

      const r = await req<ErrorBody>(
        "POST",
        "/api/couple-suppliers",
        { name: TWIN_NAME, category: "catering" },
        { token },
      );
      expect(r.status).toBe(409);
      expect(r.data.detail?.existing?.id).toBe("bindtest-3");
    });

    test("a listing that is not public does not block anything", async () => {
      insertListing("bindtest-4", TWIN_NAME, "venue", "pending");
      const { token } = await bootstrapCouple("bind-pending@weddly.test");

      const r = await req<{ supplier: SupplierDTO }>(
        "POST",
        "/api/couple-suppliers",
        { name: TWIN_NAME, category: "venue" },
        { token },
      );
      expect(r.status).toBe(201);
    });

    test("a private arrangement is never mistaken for a business", async () => {
      const { token } = await bootstrapCouple("bind-private@weddly.test");

      const r = await req<{ supplier: SupplierDTO }>(
        "POST",
        "/api/couple-suppliers",
        { name: "Anyu főztje", category: "catering" },
        { token },
      );
      expect(r.status).toBe(201);
      expect(r.data.supplier.listing_id).toBeNull();
      expect(r.data.supplier.directory_match).toBeNull();
    });

    test("a couple who says theirs is a different business gets through", async () => {
      // Folding drops the town, so two real businesses can share a name. What the
      // guard stops is the silent duplicate, not a couple who read the notice.
      insertListing("bindtest-8", TWIN_NAME);
      const { token } = await bootstrapCouple("bind-confirmed@weddly.test");

      const r = await req<{ supplier: SupplierDTO }>(
        "POST",
        "/api/couple-suppliers",
        { name: TWIN_NAME, category: "venue", confirm_not_listed: true },
        { token },
      );
      expect(r.status).toBe(201);
      expect(r.data.supplier.name).toBe(TWIN_NAME);
      expect(r.data.supplier.listing_id).toBeNull();
      // And the answer sticks: the card must not re-offer the same listing on
      // every load after they already said no.
      expect(r.data.supplier.directory_match).toBeNull();
    });
  });

  describe("a duplicate that already exists can be repaired", () => {
    /** A legacy row: created before anything checked the directory, so it sits
     *  beside the real listing. The guard can't produce one, hence the raw
     *  insert — this is exactly the state the repair path exists for. */
    async function legacyDuplicate(email: string): Promise<{
      token: string;
      coupleId: number;
      supplierId: string;
    }> {
      const { token, coupleId } = await bootstrapCouple(email);
      const ts = Date.now();
      const supplierId = `legacy${ts % 100000}`;
      db.prepare(
        `INSERT INTO couple_suppliers
           (id, couple_id, name, category, price_huf, paid, created_at, updated_at)
         VALUES (?, ?, ?, 'venue', 1500000, 0, ?, ?)`,
      ).run(supplierId, coupleId, TWIN_NAME, ts, ts);
      db.prepare(
        `INSERT INTO couple_picks (couple_id, category, supplier_id, picked_at)
         VALUES (?, 'venue', ?, ?)`,
      ).run(coupleId, supplierId, ts);
      return { token, coupleId, supplierId };
    }

    test("the list flags the row as a duplicate of the listing", async () => {
      insertListing("bindtest-5", TWIN_NAME);
      const { token, supplierId } = await legacyDuplicate("bind-flag@weddly.test");

      const r = await req<{ suppliers: SupplierDTO[] }>("GET", "/api/couple-suppliers", undefined, {
        token,
      });
      expect(r.status).toBe(200);
      const row = r.data.suppliers.find((s) => s.id === supplierId);
      expect(row?.directory_match?.id).toBe("bindtest-5");
      expect(row?.listing_id).toBeNull();
    });

    test("adopting binds the row, moves the pick, and destroys nothing", async () => {
      insertListing("bindtest-6", TWIN_NAME);
      const { token, coupleId, supplierId } = await legacyDuplicate("bind-adopt@weddly.test");

      const r = await req<{ supplier: SupplierDTO; listing_id: string }>(
        "POST",
        `/api/couple-suppliers/${supplierId}/adopt`,
        undefined,
        { token },
      );
      expect(r.status).toBe(200);
      expect(r.data.listing_id).toBe("bindtest-6");
      expect(r.data.supplier.listing_id).toBe("bindtest-6");
      // The question is settled, so the row stops asking it.
      expect(r.data.supplier.directory_match).toBeNull();

      // The pick is what turns the couple's bare name into the listing's photos,
      // address and reviews, so it has to follow the binding.
      const pick = db
        .prepare("SELECT supplier_id FROM couple_picks WHERE couple_id = ? AND category = 'venue'")
        .get(coupleId) as { supplier_id: string } | undefined;
      expect(pick?.supplier_id).toBe("bindtest-6");

      // The row itself survives — it holds the couple's price, notes and payment
      // schedule, and installments FK to it with nowhere else to go.
      const still = db
        .prepare("SELECT price_huf FROM couple_suppliers WHERE id = ?")
        .get(supplierId) as { price_huf: number } | undefined;
      expect(still?.price_huf).toBe(1_500_000);

      // The money also shows on the listing's own detail page.
      const cost = db
        .prepare(
          "SELECT planned_huf FROM couple_supplier_costs WHERE couple_id = ? AND supplier_id = ?",
        )
        .get(coupleId, "bindtest-6") as { planned_huf: number } | undefined;
      expect(cost?.planned_huf).toBe(1_500_000);
    });

    test("adopting twice is a no-op, not an error", async () => {
      insertListing("bindtest-7", TWIN_NAME);
      const { token, supplierId } = await legacyDuplicate("bind-twice@weddly.test");

      const first = await req("POST", `/api/couple-suppliers/${supplierId}/adopt`, undefined, {
        token,
      });
      expect(first.status).toBe(200);
      const second = await req<{ listing_id: string }>(
        "POST",
        `/api/couple-suppliers/${supplierId}/adopt`,
        undefined,
        { token },
      );
      expect(second.status).toBe(200);
      expect(second.data.listing_id).toBe("bindtest-7");
    });

    test("adopting a row that matches nothing is refused", async () => {
      const { token } = await bootstrapCouple("bind-nomatch@weddly.test");
      const created = await req<{ supplier: SupplierDTO }>(
        "POST",
        "/api/couple-suppliers",
        { name: "Béla bácsi a zenén", category: "dj" },
        { token },
      );
      expect(created.status).toBe(201);

      const r = await req(
        "POST",
        `/api/couple-suppliers/${created.data.supplier.id}/adopt`,
        undefined,
        { token },
      );
      expect(r.status).toBe(409);
    });
  });

  describe("a business Weddly does not list gets listed", () => {
    test("an entry with a location is published to the community directory and bound to it", async () => {
      const { token } = await bootstrapCouple("bind-publish@weddly.test");

      const r = await req<{ supplier: SupplierDTO; listing_id: string | null }>(
        "POST",
        "/api/couple-suppliers",
        {
          name: "Próbahely Rendezvénypajta",
          category: "venue",
          city: "Zebegény",
          address: "Dózsa György út 12",
          contact_email: "hello@probahely-pajta.test",
          contact_phone: "+36 30 000 1111",
        },
        { token },
      );
      expect(r.status).toBe(201);
      const listingId = r.data.listing_id;
      expect(listingId).toMatch(/^c\d+$/);
      expect(r.data.supplier.listing_id).toBe(listingId);

      // It lands in the ordinary community queue: the admin gate is what stands
      // between a logged-in couple and the public directory, and releasing it
      // from there is also what mails the vendor their claim link.
      const community = db
        .prepare("SELECT name, city, status, contact_email FROM community_suppliers WHERE id = ?")
        .get(Number((listingId ?? "c0").slice(1))) as
        | { name: string; city: string; status: string; contact_email: string | null }
        | undefined;
      expect(community?.name).toBe("Próbahely Rendezvénypajta");
      expect(community?.city).toBe("Zebegény");
      expect(community?.status).toBe("pending");
      expect(community?.contact_email).toBe("hello@probahely-pajta.test");

      // And the mirrored listings row exists, which is what the campaign reads.
      const listing = db.prepare("SELECT status FROM listings WHERE id = ?").get(listingId) as
        | { status: string }
        | undefined;
      expect(listing?.status).toBe("pending");
    });

    test("an entry with no location stays private — a card needs a place to be", async () => {
      const { token } = await bootstrapCouple("bind-nolocation@weddly.test");

      const r = await req<{ supplier: SupplierDTO; listing_id: string | null }>(
        "POST",
        "/api/couple-suppliers",
        { name: "Névtelen Próbaszolgáltató", category: "dj", price_huf: 200000 },
        { token },
      );
      expect(r.status).toBe(201);
      expect(r.data.listing_id).toBeNull();
      expect(r.data.supplier.listing_id).toBeNull();

      const count = db
        .prepare("SELECT COUNT(*) AS n FROM community_suppliers WHERE name = ?")
        .get("Névtelen Próbaszolgáltató") as { n: number };
      expect(count.n).toBe(0);
    });

    test("a published entry is not offered as its own duplicate", async () => {
      const { token } = await bootstrapCouple("bind-nodupe@weddly.test");
      const created = await req<{ supplier: SupplierDTO; listing_id: string | null }>(
        "POST",
        "/api/couple-suppliers",
        { name: "Kettős Próbahely", category: "florist", city: "Zebegény" },
        { token },
      );
      expect(created.status).toBe(201);
      expect(created.data.listing_id).not.toBeNull();
      expect(created.data.supplier.directory_match).toBeNull();
    });

    test("a second couple joins the queued listing instead of queuing another copy", async () => {
      // The create guard only sees LIVE listings, so a business still awaiting
      // moderation is invisible to it — without this the admin queue would fill
      // with one row per couple who booked the same new vendor.
      const name = "Sorban Álló Próbahely";
      const first = await bootstrapCouple("bind-queue-a@weddly.test");
      const a = await req<{ listing_id: string | null }>(
        "POST",
        "/api/couple-suppliers",
        { name, category: "venue", city: "Zebegény" },
        { token: first.token },
      );
      expect(a.status).toBe(201);
      expect(a.data.listing_id).not.toBeNull();

      const second = await bootstrapCouple("bind-queue-b@weddly.test");
      const b = await req<{ supplier: SupplierDTO; listing_id: string | null }>(
        "POST",
        "/api/couple-suppliers",
        { name, category: "venue", city: "Zebegény" },
        { token: second.token },
      );
      expect(b.status).toBe(201);
      expect(b.data.listing_id).toBe(a.data.listing_id);
      expect(b.data.supplier.listing_id).toBe(a.data.listing_id);

      const count = db
        .prepare("SELECT COUNT(*) AS n FROM community_suppliers WHERE name = ?")
        .get(name) as { n: number };
      expect(count.n).toBe(1);
    });
  });
});
