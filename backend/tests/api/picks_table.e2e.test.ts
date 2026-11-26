// The picks as a comparison table: GET /api/picks/table.
//
// What is pinned here:
//   - the table is the couple's own, and needs a signed-in couple;
//   - a venue answers only what it has said. A venue with no profile shows no
//     answers and no price, rather than a "no" to every facility;
//   - a venue's answers come from its profile, and the primary and extras are
//     told apart;
//   - a "do it myself" card shows the couple's own note, and the note wins over
//     nothing but never invents a price.

import "../setup";

import { beforeAll, describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { addVenuePricingRule, saveVenueProfile } from "../../src/domain/venue_profile";
import { bootstrapCouple, req, wipeAll } from "../helpers";

const SLOW = 20_000;

interface TableRow {
  supplier_id: string;
  role: "primary" | "extra";
  category: string;
  name: string;
  price: { kind: string } | null;
  planned: number | null;
  venue: {
    has_profile: boolean;
    facilities: string[];
    catering: string[];
    max_seated: number | null;
  } | null;
}
interface TableResp {
  currency: string;
  rows: TableRow[];
}

async function table(token: string | null) {
  return req<TableResp>("GET", "/api/picks/table", undefined, token ? { token } : {});
}

describe("picks table", () => {
  beforeAll(() => {
    wipeAll();
  });

  test(
    "the table needs a signed-in couple",
    async () => {
      const anon = await table(null);
      expect(anon.status).toBe(401);
    },
    SLOW,
  );

  test(
    "a venue with no answers shows no answers and no price, not a no",
    async () => {
      const { token } = await bootstrapCouple("table-empty-venue@weddly.test");
      await req("PUT", "/api/picks/venue", { supplier_id: "normafa-rendezvenyhaz" }, { token });

      const r = await table(token);
      expect(r.status).toBe(200);
      const row = r.data.rows.find((x) => x.supplier_id === "normafa-rendezvenyhaz");
      expect(row?.role).toBe("primary");
      expect(row?.venue?.has_profile).toBe(false);
      expect(row?.venue?.facilities).toEqual([]);
      expect(row?.price?.kind).toBe("no_rules");
    },
    SLOW,
  );

  test(
    "a venue's answers come from its profile",
    async () => {
      saveVenueProfile("etyeki-kuria", {
        facilities: ["parking", "accommodation"],
        catering: ["included"],
        drinks: ["byo_drinks"],
        max_seated: 120,
        accommodation_capacity: 30,
      });
      const { token } = await bootstrapCouple("table-answers@weddly.test");
      await req("PUT", "/api/picks/venue", { supplier_id: "etyeki-kuria" }, { token });

      const r = await table(token);
      const row = r.data.rows.find((x) => x.supplier_id === "etyeki-kuria");
      expect(row?.role).toBe("primary");
      expect(row?.venue).toMatchObject({
        has_profile: true,
        facilities: ["parking", "accommodation"],
        catering: ["included"],
        max_seated: 120,
      });
    },
    SLOW,
  );

  test(
    "a do-it-yourself card carries the couple's own note and no venue answers",
    async () => {
      const { token } = await bootstrapCouple("table-own-card@weddly.test");
      const created = await req<{ supplier: { id: string } }>(
        "POST",
        "/api/couple-suppliers",
        { name: "Anyu tortája", category: "cake_dessert", price_huf: 45000 },
        { token },
      );
      expect(created.status).toBe(201);
      const id = created.data.supplier.id;
      await req("PUT", "/api/picks/cake_dessert", { supplier_id: id }, { token });

      const r = await table(token);
      const row = r.data.rows.find((x) => x.supplier_id === id);
      expect(row).toMatchObject({
        name: "Anyu tortája",
        category: "cake_dessert",
        venue: null,
        price: null,
      });
      // The card's own price stands in as the planned note when nothing else is set.
      expect(row?.planned).toBe(45000);
    },
    SLOW,
  );

  test(
    "a venue's breakdown lists what the price covers, yes or ask, with amounts",
    async () => {
      addVenuePricingRule("etyeki-kuria", {
        name: "Egész év",
        start_month: 1,
        end_month: 12,
        days: ["weekday", "friday", "saturday", "sunday", "holiday"],
        min_guests: null,
        max_guests: null,
        min_spend: null,
        available: true,
        items: [
          {
            key: "catering",
            label: null,
            mode: "fixed",
            amount: 17000,
            quantity: null,
            optional: false,
          },
          {
            key: "accommodation",
            label: null,
            mode: "included",
            amount: null,
            quantity: null,
            optional: false,
          },
          {
            key: "drinks",
            label: null,
            mode: "on_request",
            amount: null,
            quantity: null,
            optional: false,
          },
        ],
      });
      const { token } = await bootstrapCouple("table-breakdown@weddly.test");
      await req("PUT", "/api/picks/venue", { supplier_id: "etyeki-kuria" }, { token });

      const r = await table(token);
      const row = (
        r.data as unknown as {
          rows: {
            supplier_id: string;
            breakdown: { item: string; provided: string; amount: number | null }[] | null;
            price: { kind: string } | null;
          }[];
        }
      ).rows.find((x) => x.supplier_id === "etyeki-kuria");
      expect(row?.price?.kind).toBe("priced");
      const byItem = Object.fromEntries((row?.breakdown ?? []).map((l) => [l.item, l]));
      expect(byItem.catering).toMatchObject({ provided: "yes", amount: 17000 });
      expect(byItem.accommodation).toMatchObject({ provided: "yes" });
      expect(byItem.drinks).toMatchObject({ provided: "ask" });
    },
    SLOW,
  );

  test(
    "a photographer's breakdown is its packages, with their price and description",
    async () => {
      const ts = now();
      db.prepare(
        `INSERT INTO listing_packages (listing_id, name, price_text, price_min, price_max, price_mode, description, created_at, updated_at)
         VALUES ('eszter-anna-photography', 'Esküvői nap', NULL, 150000, NULL, 'total', '300 fotó, 8 óra', ?, ?)`,
      ).run(ts, ts);
      const { token } = await bootstrapCouple("table-packages@weddly.test");
      await req(
        "PUT",
        "/api/picks/photography",
        { supplier_id: "eszter-anna-photography" },
        { token },
      );

      const r = await table(token);
      const row = (
        r.data as unknown as {
          rows: {
            supplier_id: string;
            breakdown:
              | {
                  label: string;
                  amount: number | null;
                  description: string | null;
                  per: string | null;
                }[]
              | null;
          }[];
        }
      ).rows.find((x) => x.supplier_id === "eszter-anna-photography");
      expect(row?.breakdown?.[0]).toMatchObject({
        label: "Esküvői nap",
        amount: 150000,
        description: "300 fotó, 8 óra",
        per: "total",
      });
    },
    SLOW,
  );
});
