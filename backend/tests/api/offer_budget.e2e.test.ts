// A chosen vendor offer written into the budget as a breakdown. The rules under
// test are the ones that keep the budget honest: only the chosen offer, replace
// (never stack), keep recorded money, retire only the estimate it replaces, and
// store per-guest categories at the budget's baseline headcount.

import "../setup";

import { describe, expect, test } from "bun:test";
import type { ApplyOfferToBudgetResult } from "@shared/offer_budget";
import type { BudgetLine, Currency } from "@shared/types";
import { OFFER_SCHEMA, type VendorOffer } from "@shared/vendor_offers";
import { db } from "../../src/db";
import { bootstrapCouple, req } from "../helpers";

async function currencyOf(token: string): Promise<Currency> {
  const r = await req<{ couple: { currency: Currency } }>(
    "GET",
    "/api/couples/current",
    undefined,
    {
      token,
    },
  );
  return r.data.couple.currency;
}

function body(currency: Currency, over: Record<string, unknown> = {}) {
  return {
    schema: OFFER_SCHEMA,
    vendor: { name: "Teleki Kastély", category: "venue" },
    currency,
    quoted_at: "2026-11-28",
    guest_count: 90,
    line_items: [
      { label: "Exclusive hire", amount: 700000, kind: "base" },
      { label: "Standard menu", amount: 17000, kind: "per_person" },
      { label: "10% service charge on food and drinks", amount: 153000, kind: "fee" },
      { label: "Soft drinks, 6 h", amount: 6800, kind: "per_person", optional: true },
    ],
    ...over,
  };
}

async function importOffer(
  token: string,
  currency: Currency,
  over: Record<string, unknown> = {},
  status?: string,
): Promise<VendorOffer> {
  const r = await req<{ offer: VendorOffer }>(
    "POST",
    "/api/vendor-offers",
    { offer: body(currency, over) },
    { token },
  );
  expect(r.status).toBe(201);
  if (status) {
    const p = await req("PATCH", `/api/vendor-offers/${r.data.offer.id}`, { status }, { token });
    expect(p.status).toBe(200);
  }
  return r.data.offer;
}

async function lines(token: string): Promise<BudgetLine[]> {
  const r = await req<{ lines: BudgetLine[] }>("GET", "/api/budget/lines", undefined, { token });
  return r.data.lines;
}

const apply = (token: string, id: number, b: Record<string, unknown>) =>
  req<ApplyOfferToBudgetResult & { code?: string }>("POST", `/api/budget/offer-lines/${id}`, b, {
    token,
  });

describe("offer to budget", () => {
  test("only the chosen offer can be added", async () => {
    const { token } = await bootstrapCouple("ob-chosen@weddly.test");
    const cur = await currencyOf(token);
    const o = await importOffer(token, cur);
    const r = await apply(token, o.id, { guests: 90, baseline: 90 });
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.data)).toContain("offer_not_chosen");
    expect((await lines(token)).filter((l) => l.vendor_offer_id)).toHaveLength(0);
  });

  test("writes the breakdown by what each line buys, per-guest ones at the baseline", async () => {
    const { token } = await bootstrapCouple("ob-split@weddly.test");
    const cur = await currencyOf(token);
    const o = await importOffer(token, cur, {}, "chosen");

    // Priced at 90 guests while the budget's baseline is 80.
    const r = await apply(token, o.id, { guests: 90, baseline: 80, include_optional: [3] });
    expect(r.status).toBe(201);
    // hire + menu + charge + drinks
    expect(r.data.total).toBe(700000 + 17000 * 90 + 153000 + 6800 * 90);

    const mine = (await lines(token)).filter((l) => l.vendor_offer_id === o.id);
    const by = (cat: string) => mine.filter((l) => l.category === cat);
    const sum = (ls: BudgetLine[]) => ls.reduce((s, l) => s + l.planned_huf, 0);

    // Venue is a flat category: stored as is.
    expect(sum(by("venue"))).toBe(700000);
    // Catering and drinks are per-guest: stored at baseline 80, so the slider at 90
    // (factor 90/80) shows the offer's own figure.
    const catering = 17000 * 90 + Math.round((153000 * (17000 * 90)) / (17000 * 90 + 6800 * 90));
    expect(Math.abs(Math.round((sum(by("catering")) * 90) / 80) - catering)).toBeLessThanOrEqual(2);
    expect(by("drinks").length).toBeGreaterThan(0);
    // Not locked: the couple can still tune it.
    for (const l of mine) {
      expect(l.couple_supplier_id).toBeNull();
      expect(l.listing_id).toBeNull();
    }
  });

  test("applying again replaces the lines instead of stacking a second set", async () => {
    const { token } = await bootstrapCouple("ob-replace@weddly.test");
    const cur = await currencyOf(token);
    const o = await importOffer(token, cur, {}, "chosen");
    await apply(token, o.id, { guests: 90, baseline: 90 });
    const first = (await lines(token)).filter((l) => l.vendor_offer_id === o.id).length;
    await apply(token, o.id, { guests: 90, baseline: 90, include_optional: [3] });
    const second = (await lines(token)).filter((l) => l.vendor_offer_id === o.id).length;
    expect(second).toBeGreaterThanOrEqual(first);
    // Same offer, same rows: the first set is gone, not duplicated.
    const labels = (await lines(token))
      .filter((l) => l.vendor_offer_id === o.id)
      .map((l) => l.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("the quote retires the estimate it replaces, and only a plain one in a touched category", async () => {
    const { token } = await bootstrapCouple("ob-retire@weddly.test");
    const cur = await currencyOf(token);
    const o = await importOffer(token, cur, {}, "chosen");

    const mk = async (category: string, planned: number, actual = 0) => {
      const r = await req<{ line: BudgetLine }>(
        "POST",
        "/api/budget/lines",
        { category, label: `Est ${category}`, planned_huf: planned, actual_huf: actual },
        { token },
      );
      return r.data.line.id;
    };
    const venueEstimate = await mk("venue", 1_100_000);
    const flowers = await mk("decor_floral", 50_000);
    const paidVenue = await mk("venue", 10_000, 10_000);

    // A different category: not this offer's to replace.
    const wrongCat = await apply(token, o.id, {
      guests: 90,
      baseline: 90,
      retire_line_ids: [flowers],
    });
    expect(wrongCat.status).toBe(409);
    // A line with money recorded is never replaceable.
    const paid = await apply(token, o.id, {
      guests: 90,
      baseline: 90,
      retire_line_ids: [paidVenue],
    });
    expect(paid.status).toBe(409);

    const ok = await apply(token, o.id, {
      guests: 90,
      baseline: 90,
      retire_line_ids: [venueEstimate],
    });
    expect(ok.status).toBe(201);
    expect(ok.data.retired_line_ids).toEqual([venueEstimate]);
    const ids = (await lines(token)).map((l) => l.id);
    expect(ids).not.toContain(venueEstimate);
    expect(ids).toContain(flowers);
    expect(ids).toContain(paidVenue);
  });

  test("recorded money survives: re-apply refuses, un-choosing detaches", async () => {
    const { token } = await bootstrapCouple("ob-money@weddly.test");
    const cur = await currencyOf(token);
    const o = await importOffer(token, cur, {}, "chosen");
    await apply(token, o.id, { guests: 90, baseline: 90 });

    const mine = (await lines(token)).filter((l) => l.vendor_offer_id === o.id);
    const venue = mine.find((l) => l.category === "venue");
    expect(venue).toBeDefined();
    const patch = await req(
      "PATCH",
      `/api/budget/lines/${venue?.id}`,
      { actual_huf: 300000, paid_huf: 100000 },
      { token },
    );
    expect(patch.status).toBe(200);

    const again = await apply(token, o.id, { guests: 90, baseline: 90 });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.data)).toContain("offer_lines_in_use");

    // Un-choosing removes the money-free lines and keeps the one with money.
    const un = await req<{ budget_lines_removed: number }>(
      "PATCH",
      `/api/vendor-offers/${o.id}`,
      { status: "shortlisted" },
      { token },
    );
    expect(un.data.budget_lines_removed).toBe(mine.length - 1);
    const after = await lines(token);
    const kept = after.find((l) => l.id === venue?.id);
    expect(kept).toBeDefined();
    expect(kept?.vendor_offer_id).toBeNull();
    expect(after.filter((l) => l.vendor_offer_id === o.id)).toHaveLength(0);
  });

  test("choosing a second offer in the category takes the first one's lines off", async () => {
    const { token } = await bootstrapCouple("ob-swap@weddly.test");
    const cur = await currencyOf(token);
    const first = await importOffer(token, cur, {}, "chosen");
    await apply(token, first.id, { guests: 90, baseline: 90 });
    const second = await importOffer(token, cur, {
      vendor: { name: "Other Hall", category: "venue" },
    });
    await req("PATCH", `/api/vendor-offers/${second.id}`, { status: "chosen" }, { token });
    expect((await lines(token)).filter((l) => l.vendor_offer_id === first.id)).toHaveLength(0);
  });

  test("a different currency and a frozen category are refused with a named code", async () => {
    const { token, coupleId } = await bootstrapCouple("ob-guard@weddly.test");
    const cur = await currencyOf(token);
    const other: Currency = cur === "HUF" ? "EUR" : "HUF";
    const foreign = await importOffer(token, other, {}, "chosen");
    const cm = await apply(token, foreign.id, { guests: 90, baseline: 90 });
    expect(cm.status).toBe(409);
    expect(JSON.stringify(cm.data)).toContain("currency_mismatch");

    const o = await importOffer(token, cur, { vendor: { name: "B", category: "venue" } }, "chosen");
    db.prepare("UPDATE couples SET frozen_categories_json = ? WHERE id = ?").run(
      JSON.stringify(["catering"]),
      coupleId,
    );
    const fr = await apply(token, o.id, { guests: 90, baseline: 90 });
    expect(fr.status).toBe(409);
    expect(JSON.stringify(fr.data)).toContain("frozen");
  });

  test("input is validated and another couple's offer is not reachable", async () => {
    const a = await bootstrapCouple("ob-a@weddly.test");
    const b = await bootstrapCouple("ob-b@weddly.test");
    const cur = await currencyOf(a.token);
    const o = await importOffer(a.token, cur, {}, "chosen");

    expect((await apply(a.token, o.id, { guests: 0, baseline: 90 })).status).toBe(400);
    expect(
      (await apply(a.token, o.id, { guests: 90, baseline: 90, include_optional: [0] })).status,
    ).toBe(400);
    expect(
      (await apply(a.token, o.id, { guests: 90, baseline: 90, categories: { "0": "nope" } }))
        .status,
    ).toBe(400);
    expect((await apply(b.token, o.id, { guests: 90, baseline: 90 })).status).toBe(404);
  });

  test("the list reports how many budget lines an offer owns; removing clears them", async () => {
    const { token } = await bootstrapCouple("ob-list@weddly.test");
    const cur = await currencyOf(token);
    const o = await importOffer(token, cur, {}, "chosen");
    await apply(token, o.id, { guests: 90, baseline: 90 });
    const list = await req<{ offers: VendorOffer[] }>("GET", "/api/vendor-offers", undefined, {
      token,
    });
    expect(list.data.offers.find((x) => x.id === o.id)?.budget_lines).toBeGreaterThan(0);

    const rm = await req<{ removed: number }>(
      "DELETE",
      `/api/budget/offer-lines/${o.id}`,
      undefined,
      {
        token,
      },
    );
    expect(rm.status).toBe(200);
    expect(rm.data.removed).toBeGreaterThan(0);
    expect((await lines(token)).filter((l) => l.vendor_offer_id === o.id)).toHaveLength(0);
  });
});
