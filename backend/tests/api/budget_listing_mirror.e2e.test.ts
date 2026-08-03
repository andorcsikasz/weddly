// A vendor booked out of the DIRECTORY has to show up on /app/budget.
//
// `couple_supplier_costs` used to be a parallel money store with no way out:
// the couple typed a price on the supplier card, the row landed, and /app/budget
// never heard about it, while the hand-typed "Csinálom magam" rows mirrored
// into `budget_lines` all along. This suite pins the mirror that closes that
// hole, and in particular the two rules that make it safe rather than merely
// present:
//
//   - the COMMITMENT GATE: a cost row is a price note on a candidate, and only
//     a `couple_picks` row turns it into money the couple is spending, so
//     comparing three venues can never treble the venue budget;
//   - the DOUBLE-COUNT GUARD: a vendor the couple also owns as a private
//     `couple_suppliers` row already has a mirrored line, and one booked vendor
//     is one budget line no matter how many tables know about them.
//
// Covers domain/listing_budget_mirror.ts and its callers in
// domain/supplier_costs.ts, domain/couple_picks.ts, domain/couple_suppliers.ts,
// plus the lock + snapshot-restore rules in routes/budget.ts.

import "../setup";

import { beforeAll, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { deleteCoupleSupplierCost } from "../../src/domain/supplier_costs";
import { bootstrapCouple, req, wipeAll } from "../helpers";

/** Every case bootstraps its own couple, and register hashes a password with
 *  argon2, comfortably a second on a loaded machine, and the default 5s budget
 *  is thin once a case also walks a pick / cost / budget round trip or two. The
 *  suite is I/O-bound against a local server, so a generous ceiling costs
 *  nothing when things are healthy and stops a busy laptop reading as a bug. */
const SLOW = 20_000;

interface LineDTO {
  id: number;
  category: string;
  label: string;
  planned_huf: number;
  actual_huf: number;
  paid_huf: number;
  couple_supplier_id: string | null;
  listing_id: string | null;
}
interface LinesResp {
  lines: LineDTO[];
}

/** A listing nobody else can collide with. Curated entries are materialised in
 *  the test DB at boot, so the ids and names here are deliberately unmistakable
 *  (same convention as couple_supplier_directory_bind.e2e.test.ts). */
function insertListing(id: string, name: string, category = "venue"): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings (id, source, category, name, city, status, created_at, updated_at)
     VALUES (?, 'community', ?, ?, 'Zebegény', 'active', ?, ?)`,
  ).run(id, category, name, ts, ts);
}

async function listLines(token: string): Promise<LineDTO[]> {
  const r = await req<LinesResp>("GET", "/api/budget/lines", undefined, { token });
  expect(r.status).toBe(200);
  return r.data.lines;
}

/** Only the lines this mirror owns. Everything else on the couple's budget is
 *  somebody else's business. */
async function mirroredLines(token: string): Promise<LineDTO[]> {
  return (await listLines(token)).filter((l) => l.listing_id !== null);
}

async function setCost(
  token: string,
  supplierId: string,
  planned: number,
  actual = 0,
): Promise<void> {
  const r = await req(
    "PUT",
    `/api/couples/supplier-costs/${supplierId}`,
    { planned_huf: planned, actual_huf: actual },
    { token },
  );
  expect(r.status).toBe(200);
}

async function pick(token: string, category: string, supplierId: string): Promise<void> {
  const r = await req("PUT", `/api/picks/${category}`, { supplier_id: supplierId }, { token });
  expect(r.status).toBe(200);
}

async function unpick(token: string, category: string): Promise<void> {
  const r = await req("DELETE", `/api/picks/${category}`, undefined, { token });
  expect(r.status).toBe(200);
}

describe("directory supplier → budget mirror", () => {
  beforeAll(() => {
    wipeAll();
  });

  test(
    "a priced supplier that is not the couple's pick earns no budget line",
    async () => {
      insertListing("bmirror-cand-a", "Zebegényi Próbahely A");
      insertListing("bmirror-cand-b", "Zebegényi Próbahely B");
      insertListing("bmirror-cand-c", "Zebegényi Próbahely C");
      const { token } = await bootstrapCouple("bmirror-nopick@weddly.test");

      // The compare-three-venues case: a cost row apiece, no decision yet.
      await setCost(token, "bmirror-cand-a", 1_200_000);
      await setCost(token, "bmirror-cand-b", 1_500_000);
      await setCost(token, "bmirror-cand-c", 900_000);

      expect(await mirroredLines(token)).toHaveLength(0);
    },
    SLOW,
  );

  test(
    "picking the priced supplier creates the line, with the pick's budget category, the listing's name and the amounts",
    async () => {
      insertListing("bmirror-photo", "Fényképész Próbaműhely", "photography");
      const { token } = await bootstrapCouple("bmirror-pick@weddly.test");

      await setCost(token, "bmirror-photo", 640_000, 250_000);
      expect(await mirroredLines(token)).toHaveLength(0);

      // `photography` maps onto the `photo_video` budget bucket, so this also
      // proves the category comes from the PICK through SUPPLIER_TO_BUDGET rather
      // than being copied across verbatim.
      await pick(token, "photography", "bmirror-photo");

      const lines = await mirroredLines(token);
      expect(lines).toHaveLength(1);
      const line = lines[0];
      expect(line?.listing_id).toBe("bmirror-photo");
      expect(line?.category).toBe("photo_video");
      expect(line?.label).toBe("Fényképész Próbaműhely");
      expect(line?.planned_huf).toBe(640_000);
      expect(line?.actual_huf).toBe(250_000);
      expect(line?.couple_supplier_id).toBeNull();
    },
    SLOW,
  );

  test(
    "a pick that resolves to no listing falls back to the bare supplier id as the label",
    async () => {
      const { token } = await bootstrapCouple("bmirror-noname@weddly.test");
      await setCost(token, "bmirror-vanished", 300_000);
      await pick(token, "florist", "bmirror-vanished");

      const lines = await mirroredLines(token);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.label).toBe("bmirror-vanished");
      expect(lines[0]?.category).toBe("decor_floral");
    },
    SLOW,
  );

  test(
    "un-picking removes the line and leaves the cost row alone",
    async () => {
      insertListing("bmirror-unpick", "Zebegényi Uncommit Kúria");
      const { token } = await bootstrapCouple("bmirror-unpick@weddly.test");

      await setCost(token, "bmirror-unpick", 2_000_000);
      await pick(token, "venue", "bmirror-unpick");
      expect(await mirroredLines(token)).toHaveLength(1);

      await unpick(token, "venue");
      expect(await mirroredLines(token)).toHaveLength(0);

      // The price note survives: withdrawing a commitment is not forgetting what
      // they quoted.
      const costs = await req<{ costs: { supplier_id: string; planned_huf: number }[] }>(
        "GET",
        "/api/couples/supplier-costs",
        undefined,
        { token },
      );
      expect(costs.data.costs.find((c) => c.supplier_id === "bmirror-unpick")?.planned_huf).toBe(
        2_000_000,
      );
    },
    SLOW,
  );

  test(
    "re-picking a different supplier in the same category removes the first line and creates the second",
    async () => {
      insertListing("bmirror-swap-1", "Zebegényi Első Kastély");
      insertListing("bmirror-swap-2", "Zebegényi Második Kastély");
      const { token } = await bootstrapCouple("bmirror-swap@weddly.test");

      await setCost(token, "bmirror-swap-1", 1_800_000);
      await setCost(token, "bmirror-swap-2", 2_400_000);
      await pick(token, "venue", "bmirror-swap-1");
      expect((await mirroredLines(token)).map((l) => l.listing_id)).toEqual(["bmirror-swap-1"]);

      // The UNIQUE(couple_id, category) replace has to be TWO budget edits: the
      // loser's line goes as the winner's arrives, or the couple pays for both.
      await pick(token, "venue", "bmirror-swap-2");
      const lines = await mirroredLines(token);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.listing_id).toBe("bmirror-swap-2");
      expect(lines[0]?.planned_huf).toBe(2_400_000);
    },
    SLOW,
  );

  test(
    "updating the cost updates the line in place",
    async () => {
      insertListing("bmirror-update", "Zebegényi Árváltó Kúria");
      const { token } = await bootstrapCouple("bmirror-update@weddly.test");

      await setCost(token, "bmirror-update", 1_000_000);
      await pick(token, "venue", "bmirror-update");
      const before = await mirroredLines(token);
      expect(before).toHaveLength(1);

      await setCost(token, "bmirror-update", 1_350_000, 400_000);
      const after = await mirroredLines(token);
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(before[0]?.id as number);
      expect(after[0]?.planned_huf).toBe(1_350_000);
      expect(after[0]?.actual_huf).toBe(400_000);
    },
    SLOW,
  );

  test(
    "zeroing the cost removes the line, and re-pricing brings it back",
    async () => {
      insertListing("bmirror-zero", "Zebegényi Nullás Kúria");
      const { token } = await bootstrapCouple("bmirror-zero@weddly.test");

      await setCost(token, "bmirror-zero", 500_000);
      await pick(token, "venue", "bmirror-zero");
      expect(await mirroredLines(token)).toHaveLength(1);

      // Clearing both figures is the couple's only way off /app/budget, since the
      // line itself is locked.
      await setCost(token, "bmirror-zero", 0, 0);
      expect(await mirroredLines(token)).toHaveLength(0);

      await setCost(token, "bmirror-zero", 750_000);
      expect(await mirroredLines(token)).toHaveLength(1);
    },
    SLOW,
  );

  test(
    "deleting the cost row removes the line",
    async () => {
      insertListing("bmirror-delcost", "Zebegényi Törölt Kúria");
      const { token, coupleId } = await bootstrapCouple("bmirror-delcost@weddly.test");

      await setCost(token, "bmirror-delcost", 850_000);
      await pick(token, "venue", "bmirror-delcost");
      expect(await mirroredLines(token)).toHaveLength(1);

      // No HTTP route deletes a cost row today (the card writes zeroes instead),
      // so the domain writer is exercised directly; it is the one every future
      // caller will go through.
      deleteCoupleSupplierCost(coupleId, "bmirror-delcost");
      expect(await mirroredLines(token)).toHaveLength(0);
    },
    SLOW,
  );

  test(
    "a vendor the couple also owns as a private row yields exactly one budget line",
    async () => {
      const { token } = await bootstrapCouple("bmirror-double@weddly.test");

      // The production path into this state: a couple adds a booked vendor by
      // hand, the business is new to Weddly so it gets LISTED, the private row is
      // bound to that listing and its price is mirrored into
      // `couple_supplier_costs`. Every ingredient the listing mirror needs is now
      // present, and the private row already owns a `couple_supplier_id` line.
      const created = await req<{ supplier: { id: string }; listing_id: string | null }>(
        "POST",
        "/api/couple-suppliers",
        {
          name: "Zebegényi Kettőzés Vendégház",
          category: "venue",
          city: "Zebegény",
          price_huf: 1_100_000,
        },
        { token },
      );
      expect(created.status).toBe(201);
      const privateId = created.data.supplier.id;
      const listingId = created.data.listing_id;
      expect(listingId).not.toBeNull();
      expect(
        (await listLines(token)).filter((l) => l.couple_supplier_id === privateId),
      ).toHaveLength(1);

      await pick(token, "venue", listingId as string);

      const forVendor = (await listLines(token)).filter(
        (l) => l.couple_supplier_id === privateId || l.listing_id === listingId,
      );
      expect(forVendor).toHaveLength(1);
      expect(forVendor[0]?.couple_supplier_id).toBe(privateId);
      expect(forVendor[0]?.listing_id).toBeNull();

      // Even a fresh price typed on the directory card can't mint a second line
      // while the private row stands for the same vendor.
      await setCost(token, listingId as string, 1_400_000);
      expect(await mirroredLines(token)).toHaveLength(0);

      // Delete the private row and the directory side is free to answer for
      // itself again: still exactly one line, now the mirrored one.
      const del = await req("DELETE", `/api/couple-suppliers/${privateId}`, undefined, { token });
      expect(del.status).toBe(200);
      const after = await listLines(token);
      expect(after).toHaveLength(1);
      expect(after[0]?.listing_id).toBe(listingId);
      expect(after[0]?.planned_huf).toBe(1_400_000);
    },
    SLOW,
  );

  test(
    "PATCH on a directory-owned line is refused as locked",
    async () => {
      insertListing("bmirror-patch", "Zebegényi Zárolt Kúria");
      const { token } = await bootstrapCouple("bmirror-patch@weddly.test");

      await setCost(token, "bmirror-patch", 950_000);
      await pick(token, "venue", "bmirror-patch");
      const line = (await mirroredLines(token))[0];

      const r = await req<{ detail: { code?: string } | null }>(
        "PATCH",
        `/api/budget/lines/${line?.id}`,
        { planned_huf: 1 },
        { token },
      );
      expect(r.status).toBe(409);
      expect(r.data.detail?.code).toBe("locked");

      // And the money is untouched.
      expect((await mirroredLines(token))[0]?.planned_huf).toBe(950_000);
    },
    SLOW,
  );

  test(
    "DELETE on a directory-owned line is refused as locked",
    async () => {
      insertListing("bmirror-delete", "Zebegényi Törölhetetlen Kúria");
      const { token } = await bootstrapCouple("bmirror-delete@weddly.test");

      await setCost(token, "bmirror-delete", 700_000);
      await pick(token, "venue", "bmirror-delete");
      const line = (await mirroredLines(token))[0];

      const r = await req<{ detail: { code?: string } | null }>(
        "DELETE",
        `/api/budget/lines/${line?.id}`,
        undefined,
        { token },
      );
      expect(r.status).toBe(409);
      expect(r.data.detail?.code).toBe("locked");
      expect(await mirroredLines(token)).toHaveLength(1);
    },
    SLOW,
  );

  test(
    "a snapshot restore neither doubles a live mirrored line nor resurrects a withdrawn one",
    async () => {
      insertListing("bmirror-snap", "Zebegényi Pillanatkép Kúria");
      const { token } = await bootstrapCouple("bmirror-snap@weddly.test");

      await setCost(token, "bmirror-snap", 1_650_000);
      await pick(token, "venue", "bmirror-snap");
      expect(await mirroredLines(token)).toHaveLength(1);

      const snap = await req<{ snapshot: { id: number } }>(
        "POST",
        "/api/budget/snapshots",
        { name: "Mirror snapshot" },
        { token },
      );
      expect(snap.status).toBe(201);
      const snapshotId = snap.data.snapshot.id;

      // Restore with the mirror still live: the line survives step 1 and is
      // skipped in step 2, so it stays at exactly one.
      const first = await req("POST", `/api/budget/snapshots/${snapshotId}/restore`, {}, { token });
      expect(first.status).toBe(200);
      expect(await mirroredLines(token)).toHaveLength(1);

      // Withdraw the commitment, then restore the stale snapshot: it must not
      // bring the vendor back.
      await unpick(token, "venue");
      expect(await mirroredLines(token)).toHaveLength(0);
      const second = await req(
        "POST",
        `/api/budget/snapshots/${snapshotId}/restore`,
        {},
        { token },
      );
      expect(second.status).toBe(200);
      expect(await mirroredLines(token)).toHaveLength(0);
    },
    SLOW,
  );

  test(
    "one couple's pick and price never touch another couple's budget",
    async () => {
      insertListing("bmirror-iso", "Zebegényi Elszigetelt Kúria");
      const a = await bootstrapCouple("bmirror-iso-a@weddly.test");
      const b = await bootstrapCouple("bmirror-iso-b@weddly.test");

      await setCost(b.token, "bmirror-iso", 1_900_000);
      await pick(b.token, "venue", "bmirror-iso");

      expect(await mirroredLines(b.token)).toHaveLength(1);
      expect(await mirroredLines(a.token)).toHaveLength(0);
      expect(await listLines(a.token)).toHaveLength(0);

      // And A picking the same listing gets their own line, not B's.
      await setCost(a.token, "bmirror-iso", 2_100_000);
      await pick(a.token, "venue", "bmirror-iso");
      const aLines = await mirroredLines(a.token);
      const bLines = await mirroredLines(b.token);
      expect(aLines).toHaveLength(1);
      expect(bLines).toHaveLength(1);
      expect(aLines[0]?.id).not.toBe(bLines[0]?.id as number);
      expect(aLines[0]?.planned_huf).toBe(2_100_000);
      expect(bLines[0]?.planned_huf).toBe(1_900_000);
    },
    SLOW,
  );
});
