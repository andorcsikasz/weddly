// Adding many vendors to the couple's list in one go.
//
// Two endpoints back the bulk "add to my list" flow:
//   - POST /api/picks/bulk          picks a set of suppliers, each as the primary of
//                                   its category or as an extra beside it;
//   - POST /api/couple-suppliers/bulk  turns a list of names into the couple's own
//                                   cards, linking any name Weddly already lists.
//
// The rules pinned here: a name already on Weddly links to that listing rather
// than making a second card; a repeat is answered once; venue keeps one place; and
// an unknown id is reported, not silently dropped.

import "../setup";

import { beforeAll, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const SLOW = 20_000;

interface BulkPickResult {
  supplier_id: string;
  category: string | null;
  status: string;
}
interface BulkOwnResult {
  name: string;
  status: "linked" | "created";
  supplier_id: string;
  label: string;
}

function insertListing(id: string, name: string, category: string): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings (id, source, category, name, city, status, created_at, updated_at)
     VALUES (?, 'community', ?, ?, 'Zebegény', 'active', ?, ?)`,
  ).run(id, category, name, ts, ts);
}

async function bulkPicks(token: string | null, supplierIds: unknown) {
  return req<{ results: BulkPickResult[] }>(
    "POST",
    "/api/picks/bulk",
    { supplier_ids: supplierIds },
    token ? { token } : {},
  );
}

async function bulkOwn(token: string, category: string, names: string[]) {
  return req<{ results: BulkOwnResult[] }>(
    "POST",
    "/api/couple-suppliers/bulk",
    { category, names },
    { token },
  );
}

describe("bulk add to the couple's list", () => {
  beforeAll(() => {
    wipeAll();
  });

  test(
    "the first supplier in a category becomes the primary, the rest join as extras",
    async () => {
      const { token } = await bootstrapCouple("bulk-picks-order@weddly.test");

      const r = await bulkPicks(token, ["eszter-anna-photography", "gyula-co", "purephoto"]);
      expect(r.status).toBe(200);
      expect(r.data.results.map((x) => x.status)).toEqual(["primary", "extra", "extra"]);

      const list = await req<{
        picks: { category: string; supplier_id: string }[];
        extras: { supplier_id: string }[];
      }>("GET", "/api/picks", undefined, { token });
      expect(list.data.picks.find((p) => p.category === "photography")?.supplier_id).toBe(
        "eszter-anna-photography",
      );
      expect(list.data.extras.map((e) => e.supplier_id).sort()).toEqual(["gyula-co", "purephoto"]);
    },
    SLOW,
  );

  test(
    "a supplier already in the list is reported as already, not added twice",
    async () => {
      const { token } = await bootstrapCouple("bulk-picks-dup@weddly.test");
      await bulkPicks(token, ["eszter-anna-photography", "gyula-co"]);

      const again = await bulkPicks(token, [
        "eszter-anna-photography",
        "gyula-co",
        "eszter-anna-photography",
      ]);
      expect(again.data.results.map((x) => x.status)).toEqual(["already", "already"]);
    },
    SLOW,
  );

  test(
    "a second venue is reported as venue_single, and an unknown id as unknown",
    async () => {
      const { token } = await bootstrapCouple("bulk-picks-venue@weddly.test");

      const r = await bulkPicks(token, [
        "normafa-rendezvenyhaz",
        "etyeki-kuria",
        "no-such-supplier-xyz",
      ]);
      expect(r.data.results.map((x) => x.status)).toEqual(["primary", "venue_single", "unknown"]);
    },
    SLOW,
  );

  test(
    "bulk picks refuse anonymous callers, non-arrays and oversized requests",
    async () => {
      const anon = await bulkPicks(null, ["eszter-anna-photography"]);
      expect(anon.status).toBe(401);

      const { token } = await bootstrapCouple("bulk-picks-bad@weddly.test");
      const notArray = await bulkPicks(token, "eszter-anna-photography");
      expect(notArray.status).toBe(400);

      const tooMany = await bulkPicks(
        token,
        Array.from({ length: 61 }, (_, i) => `bulk-x-${i}`),
      );
      expect(tooMany.status).toBe(400);
      expect(tooMany.data).toMatchObject({ detail: { code: "too_many" } });
    },
    SLOW,
  );

  test(
    "a name already on Weddly links to that listing, and a new name becomes the couple's own card",
    async () => {
      const { token } = await bootstrapCouple("bulk-own@weddly.test");

      const r = await bulkOwn(token, "photography", ["Eszter Anna Photography", "Anyu fotózik"]);
      expect(r.status).toBe(200);
      const [linked, created] = r.data.results;
      expect(linked).toMatchObject({ status: "linked", supplier_id: "eszter-anna-photography" });
      expect(created).toMatchObject({ name: "Anyu fotózik", status: "created" });
      expect(created?.supplier_id).toBeTruthy();
      // The name that linked did not also become a private card.
      const cards = db
        .prepare(
          "SELECT COUNT(*) AS n FROM couple_suppliers WHERE name = 'Eszter Anna Photography'",
        )
        .get() as { n: number };
      expect(cards.n).toBe(0);
    },
    SLOW,
  );

  test(
    "repeated names in one request are answered once",
    async () => {
      const { token } = await bootstrapCouple("bulk-own-dup@weddly.test");
      const r = await bulkOwn(token, "dj", ["Zenész Péter", "zenész péter", "  Zenész Péter  "]);
      expect(r.data.results).toHaveLength(1);
    },
    SLOW,
  );

  test(
    "bulk own names need a valid category and an array",
    async () => {
      const { token } = await bootstrapCouple("bulk-own-bad@weddly.test");
      const noCat = await req("POST", "/api/couple-suppliers/bulk", { names: ["x"] }, { token });
      expect(noCat.status).toBe(400);
      const notArray = await req(
        "POST",
        "/api/couple-suppliers/bulk",
        { category: "photography", names: "x" },
        { token },
      );
      expect(notArray.status).toBe(400);
    },
    SLOW,
  );
});
