// A category can hold more than one supplier: a primary pick plus extras (a
// second photographer, a back-up DJ). This suite pins the rules that keep that
// safe:
//
//   - an extra needs a primary beside it, and is never the primary itself;
//   - venue stays a single pick, because the wedding has one venue;
//   - an extra is a commitment, so it earns a budget line like the primary does;
//   - promoting an extra to primary, or removing the primary, never leaves an
//     extra with nothing beside it.
//
// Covers domain/couple_picks.ts, routes/couple_picks.ts and the extra branch of
// domain/listing_budget_mirror.ts.

import "../setup";

import { beforeAll, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const SLOW = 20_000;

interface PickDTO {
  category: string;
  supplier_id: string;
}
interface PicksResp {
  picks: PickDTO[];
  extras: PickDTO[];
}
interface LineDTO {
  category: string;
  listing_id: string | null;
}

function insertListing(id: string, name: string, category: string): void {
  const ts = now();
  db.prepare(
    `INSERT INTO listings (id, source, category, name, city, status, created_at, updated_at)
     VALUES (?, 'community', ?, ?, 'Zebegény', 'active', ?, ?)`,
  ).run(id, category, name, ts, ts);
}

async function picks(token: string): Promise<PicksResp> {
  const r = await req<PicksResp>("GET", "/api/picks", undefined, { token });
  expect(r.status).toBe(200);
  return r.data;
}

async function setPrimary(token: string, category: string, supplierId: string): Promise<void> {
  const r = await req("PUT", `/api/picks/${category}`, { supplier_id: supplierId }, { token });
  expect(r.status).toBe(200);
}

async function addExtra(token: string, category: string, supplierId: string) {
  return req<{ extra: PickDTO }>(
    "POST",
    `/api/picks/${category}/extras`,
    { supplier_id: supplierId },
    { token },
  );
}

async function removeExtra(token: string, category: string, supplierId: string) {
  return req(
    "DELETE",
    `/api/picks/${category}/extras/${encodeURIComponent(supplierId)}`,
    undefined,
    { token },
  );
}

async function setCost(token: string, supplierId: string, planned: number): Promise<void> {
  const r = await req(
    "PUT",
    `/api/couples/supplier-costs/${supplierId}`,
    { planned_huf: planned, actual_huf: 0 },
    { token },
  );
  expect(r.status).toBe(200);
}

async function mirroredLines(token: string): Promise<LineDTO[]> {
  const r = await req<{ lines: LineDTO[] }>("GET", "/api/budget/lines", undefined, { token });
  expect(r.status).toBe(200);
  return r.data.lines.filter((l) => l.listing_id !== null);
}

describe("category extras: a second supplier beside the primary", () => {
  beforeAll(() => {
    wipeAll();
  });

  test(
    "an extra needs a primary first, and is refused for the primary itself",
    async () => {
      insertListing("xtra-photo-a", "Extra Fotó A", "photography");
      insertListing("xtra-photo-b", "Extra Fotó B", "photography");
      const { token } = await bootstrapCouple("xtra-guard@weddly.test");

      const noPrimary = await addExtra(token, "photography", "xtra-photo-b");
      expect(noPrimary.status).toBe(409);
      expect(noPrimary.data).toMatchObject({ detail: { code: "no_primary_pick" } });

      await setPrimary(token, "photography", "xtra-photo-a");
      const same = await addExtra(token, "photography", "xtra-photo-a");
      expect(same.status).toBe(409);
      expect(same.data).toMatchObject({ detail: { code: "already_primary" } });
    },
    SLOW,
  );

  test(
    "a venue refuses extras: one venue holds the wedding",
    async () => {
      insertListing("xtra-venue-a", "Extra Kastély A", "venue");
      insertListing("xtra-venue-b", "Extra Kastély B", "venue");
      const { token } = await bootstrapCouple("xtra-venue@weddly.test");
      await setPrimary(token, "venue", "xtra-venue-a");

      const r = await addExtra(token, "venue", "xtra-venue-b");
      expect(r.status).toBe(400);
      expect(r.data).toMatchObject({ detail: { code: "venue_single_pick" } });
    },
    SLOW,
  );

  test(
    "a sentinel ('not needed', 'self-organised') is never an extra",
    async () => {
      insertListing("xtra-sent-a", "Extra Zenész A", "dj");
      const { token } = await bootstrapCouple("xtra-sentinel@weddly.test");
      await setPrimary(token, "dj", "xtra-sent-a");

      const r = await addExtra(token, "dj", "not-needed");
      expect(r.status).toBe(400);
    },
    SLOW,
  );

  test(
    "adding a second photographer lists it beside the primary and is idempotent",
    async () => {
      insertListing("xtra-list-a", "Extra Lista A", "photography");
      insertListing("xtra-list-b", "Extra Lista B", "photography");
      const { token } = await bootstrapCouple("xtra-list@weddly.test");
      await setPrimary(token, "photography", "xtra-list-a");

      const first = await addExtra(token, "photography", "xtra-list-b");
      expect(first.status).toBe(200);
      expect(first.data.extra).toMatchObject({
        category: "photography",
        supplier_id: "xtra-list-b",
      });
      // Adding the same extra twice is not a second row.
      expect((await addExtra(token, "photography", "xtra-list-b")).status).toBe(200);

      const body = await picks(token);
      expect(body.picks.find((p) => p.category === "photography")?.supplier_id).toBe("xtra-list-a");
      expect(body.extras.filter((e) => e.category === "photography")).toHaveLength(1);

      expect((await removeExtra(token, "photography", "xtra-list-b")).status).toBe(200);
      expect((await picks(token)).extras.filter((e) => e.category === "photography")).toHaveLength(
        0,
      );
    },
    SLOW,
  );

  test(
    "an extra commits money: its priced cost becomes a budget line until it is removed",
    async () => {
      insertListing("xtra-money-a", "Extra Pénz A", "photography");
      insertListing("xtra-money-b", "Extra Pénz B", "photography");
      const { token } = await bootstrapCouple("xtra-money@weddly.test");
      await setPrimary(token, "photography", "xtra-money-a");
      await setCost(token, "xtra-money-b", 300_000);
      expect(await mirroredLines(token)).toHaveLength(0);

      await addExtra(token, "photography", "xtra-money-b");
      const withExtra = await mirroredLines(token);
      expect(withExtra.map((l) => l.listing_id)).toContain("xtra-money-b");

      await removeExtra(token, "photography", "xtra-money-b");
      expect((await mirroredLines(token)).map((l) => l.listing_id)).not.toContain("xtra-money-b");
    },
    SLOW,
  );

  test(
    "replacing the primary with a supplier that is already an extra keeps them in one place",
    async () => {
      insertListing("xtra-swap-a", "Extra Csere A", "photography");
      insertListing("xtra-swap-b", "Extra Csere B", "photography");
      const { token } = await bootstrapCouple("xtra-swap@weddly.test");
      await setPrimary(token, "photography", "xtra-swap-a");
      await addExtra(token, "photography", "xtra-swap-b");

      await setPrimary(token, "photography", "xtra-swap-b");
      const body = await picks(token);
      expect(body.picks.find((p) => p.category === "photography")?.supplier_id).toBe("xtra-swap-b");
      expect(body.extras.some((e) => e.supplier_id === "xtra-swap-b")).toBe(false);
    },
    SLOW,
  );

  test(
    "removing the primary promotes the newest extra, so an extra never stands alone",
    async () => {
      insertListing("xtra-prom-a", "Extra Promóció A", "photography");
      insertListing("xtra-prom-b", "Extra Promóció B", "photography");
      insertListing("xtra-prom-c", "Extra Promóció C", "photography");
      const { token } = await bootstrapCouple("xtra-promote@weddly.test");
      await setPrimary(token, "photography", "xtra-prom-a");
      await addExtra(token, "photography", "xtra-prom-b");
      await addExtra(token, "photography", "xtra-prom-c");

      const r = await req("DELETE", "/api/picks/photography", undefined, { token });
      expect(r.status).toBe(200);
      const body = await picks(token);
      // The most recently added extra steps up; the other stays an extra.
      expect(body.picks.find((p) => p.category === "photography")?.supplier_id).toBe("xtra-prom-c");
      expect(body.extras.map((e) => e.supplier_id)).toEqual(["xtra-prom-b"]);
    },
    SLOW,
  );

  test(
    "a couple who never picked has no extras and an empty list",
    async () => {
      const { token } = await bootstrapCouple("xtra-empty@weddly.test");
      const body = await picks(token);
      expect(body.picks).toEqual([]);
      expect(body.extras).toEqual([]);
    },
    SLOW,
  );
});
