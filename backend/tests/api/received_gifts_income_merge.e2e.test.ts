// The budget page and the wishlist used to track money-in twice: `couple_income`
// behind the budget's "Befolyt pénz" grid, `received_gifts` behind the wishlist's
// "Beérkezett ajándékok" grid. Neither knew about the other, so a couple with a
// 20M cash gift logged on the wishlist read "Összesen befolyt: 0 Ft" on the page
// whose whole job is reporting it.
//
// The received-gifts ledger is the single source of truth now. This covers the
// two halves that can silently corrupt money: the one-time carry-over of the old
// rows (idempotent, unit-converting) and the shared summary the budget renders.

import "../setup";

import { describe, expect, test } from "bun:test";
import { type ReceivedGift, summarizeReceivedGifts } from "@shared/received_gifts";
import { db } from "../../src/db";
import { backfillIncomeIntoReceivedGifts } from "../../src/domain/received_gifts";
import { bootstrapCouple, req, wipeAll } from "../helpers";

/** Force the workspace currency — the carry-over's unit conversion keys on it. */
function setCurrency(coupleId: number, currency: string): void {
  db.prepare("UPDATE couples SET currency = ? WHERE id = ?").run(currency, coupleId);
}

/** Insert straight into the retired table: there is no longer a UI that writes
 *  it, but live workspaces carry rows that have to arrive in the new ledger. */
function seedIncome(coupleId: number, label: string, amountWhole: number, notes = "x"): number {
  const ts = Date.now();
  const r = db
    .prepare(
      `INSERT INTO couple_income (couple_id, label, amount_huf, received_on, notes, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(coupleId, label, amountWhole, notes, ts, ts);
  return Number(r.lastInsertRowid);
}

async function listGifts(token: string): Promise<ReceivedGift[]> {
  const r = await req<{ items: ReceivedGift[] }>("GET", "/api/received-gifts", undefined, {
    token,
  });
  expect(r.status).toBe(200);
  return r.data.items;
}

describe("received gifts: carry-over from the retired income ledger", () => {
  test("a HUF workspace's rows arrive as money gifts, whole units unchanged", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rg-carry-huf@weddly.test");
    setCurrency(coupleId, "HUF");
    seedIncome(coupleId, "Kovács család", 50_000, "borítékban");

    expect(backfillIncomeIntoReceivedGifts().carried).toBe(1);

    const gifts = await listGifts(token);
    expect(gifts).toHaveLength(1);
    expect(gifts[0]!.title).toBe("Kovács család");
    expect(gifts[0]!.note).toBe("borítékban");
    expect(gifts[0]!.category).toBe("money");
    // HUF is a zero-decimal currency: whole forint IS the minor unit.
    expect(gifts[0]!.amount_minor).toBe(50_000);
    expect(summarizeReceivedGifts(gifts, "HUF").money_total).toBe(50_000);
  });

  test("a EUR workspace's rows are converted to minor units, not copied", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rg-carry-eur@weddly.test");
    setCurrency(coupleId, "EUR");
    seedIncome(coupleId, "Anna & Bálint", 250);

    expect(backfillIncomeIntoReceivedGifts().carried).toBe(1);

    const gifts = await listGifts(token);
    // The whole point: `amount_huf` is WHOLE units, `amount_minor` is hundredths.
    // A straight copy would report €2.50 for a €250 gift.
    expect(gifts[0]!.amount_minor).toBe(25_000);
    // And the figure the budget page renders survives the round trip intact.
    expect(summarizeReceivedGifts(gifts, "EUR").money_total).toBe(250);
  });

  test("running it again carries nothing and duplicates nothing", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rg-carry-idem@weddly.test");
    setCurrency(coupleId, "HUF");
    seedIncome(coupleId, "Nagy család", 30_000);

    expect(backfillIncomeIntoReceivedGifts().carried).toBe(1);
    // The boot hook fires on every start, so a second pass must be a no-op.
    expect(backfillIncomeIntoReceivedGifts().carried).toBe(0);
    expect(backfillIncomeIntoReceivedGifts().carried).toBe(0);
    expect(await listGifts(token)).toHaveLength(1);
  });

  test("carried rows land after what the couple already typed", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("rg-carry-order@weddly.test");
    setCurrency(coupleId, "HUF");
    const own = await req<{ item: ReceivedGift }>(
      "POST",
      "/api/received-gifts",
      { title: "Mosógép", category: "gift", sort_order: 0 },
      { token },
    );
    expect(own.status).toBe(201);
    seedIncome(coupleId, "Sógorék", 20_000);

    backfillIncomeIntoReceivedGifts();

    const gifts = await listGifts(token);
    expect(gifts.map((g) => g.title)).toEqual(["Mosógép", "Sógorék"]);
  });

  test("one couple's income never lands in another couple's ledger", async () => {
    wipeAll();
    const a = await bootstrapCouple("rg-carry-a@weddly.test");
    const b = await bootstrapCouple("rg-carry-b@weddly.test");
    seedIncome(a.coupleId, "A oldal", 10_000);

    backfillIncomeIntoReceivedGifts();

    expect(await listGifts(a.token)).toHaveLength(1);
    expect(await listGifts(b.token)).toHaveLength(0);
  });
});

describe("received gifts: the summary the budget page renders", () => {
  const row = (
    category: ReceivedGift["category"],
    amount_minor: number | null,
  ): Pick<ReceivedGift, "category" | "amount_minor"> => ({ category, amount_minor });

  test("only money rows are valued; everything else is counted", () => {
    const s = summarizeReceivedGifts(
      [
        row("money", 50_000),
        row("money", 25_000),
        row("gift", null), // a blender
        row("experience", null),
        row("voucher", null),
      ],
      "HUF",
    );
    expect(s.money_total).toBe(75_000);
    expect(s.money_count).toBe(2);
    // A physical gift must never reduce what the couple still has to pay.
    expect(s.other_count).toBe(3);
  });

  test("a ledger of presents and no cash reports zero, not empty", () => {
    const s = summarizeReceivedGifts([row("gift", null), row("gift", null)], "EUR");
    expect(s.money_total).toBe(0);
    expect(s.money_count).toBe(0);
    expect(s.other_count).toBe(2);
  });

  test("the same stored amount means different money per currency", () => {
    const rows = [row("money", 10_000)];
    expect(summarizeReceivedGifts(rows, "HUF").money_total).toBe(10_000);
    expect(summarizeReceivedGifts(rows, "EUR").money_total).toBe(100);
    // JPY is zero-decimal like HUF — a hardcoded /100 would divide it wrongly.
    expect(summarizeReceivedGifts(rows, "JPY").money_total).toBe(10_000);
  });

  test("a legacy money row with no amount is counted, never guessed at", () => {
    const s = summarizeReceivedGifts([row("money", null), row("money", 0)], "HUF");
    expect(s.money_total).toBe(0);
    expect(s.money_count).toBe(0);
    expect(s.other_count).toBe(2);
  });

  test("an empty ledger is zero across the board", () => {
    expect(summarizeReceivedGifts([], "EUR")).toEqual({
      money_total: 0,
      money_count: 0,
      other_count: 0,
    });
  });
});
