// Vendor offers: import (validated), history per vendor, one chosen per
// category, couple scoping, and the pure maths the comparison relies on.

import "../setup";

import { describe, expect, test } from "bun:test";
import {
  OFFER_SCHEMA,
  type VendorOffer,
  offerFreshness,
  offerMismatch,
  offerTotalAt,
  parseVendorOffer,
} from "@shared/vendor_offers";
import { bootstrapCouple, req } from "../helpers";

const offerBody = (over: Record<string, unknown> = {}) => ({
  schema: OFFER_SCHEMA,
  vendor: { name: "Malom Catering", category: "catering" },
  currency: "EUR",
  quoted_at: "2026-11-10",
  valid_until: "2026-12-10",
  guest_count: 80,
  stated_total: null,
  line_items: [
    { label: "Menu", amount: 60, kind: "per_person" },
    { label: "Service", amount: 800, kind: "fee" },
    { label: "Late snack", amount: 10, kind: "per_person", optional: true },
  ],
  ...over,
});

describe("offer maths", () => {
  test("per-guest lines scale, optional extras stay out, discounts subtract", () => {
    const r = parseVendorOffer(
      `Here you go:\n\`\`\`json\n${JSON.stringify(
        offerBody({
          line_items: [
            { label: "Menu", amount: 60, kind: "per_person" },
            { label: "Service", amount: 800, kind: "fee" },
            { label: "Early bird", amount: 200, kind: "discount" },
            { label: "Snack", amount: 10, kind: "per_person", optional: true },
          ],
        }),
      )}\n\`\`\``,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(offerTotalAt(r.offer, 80)).toBe(60 * 80 + 800 - 200);
    expect(offerTotalAt(r.offer, 100)).toBe(60 * 100 + 800 - 200);
  });

  test("a printed total that disagrees with its lines is flagged", () => {
    const r = parseVendorOffer(JSON.stringify(offerBody({ stated_total: 9999 })));
    expect(r.ok && offerMismatch(r.offer)?.stated).toBe(9999);
  });

  test("per_person without a headcount and junk money are refused with paths", () => {
    const r = parseVendorOffer(
      JSON.stringify(
        offerBody({
          guest_count: null,
          line_items: [{ label: "x", amount: "€60", kind: "per_person" }],
        }),
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("line_items[0].amount");
  });

  test("freshness: expiry beats age", () => {
    const o = { quoted_at: "2026-11-10", valid_until: "2026-11-12" };
    expect(offerFreshness(o, "2026-11-11").state).toBe("fresh");
    expect(offerFreshness(o, "2026-11-13").state).toBe("expired");
    expect(offerFreshness({ quoted_at: "2026-09-01", valid_until: null }, "2026-11-15").state).toBe(
      "stale",
    );
  });
});

describe("vendor offers API", () => {
  test("import, re-quote keeps history, choose one per category, scoped to the couple", async () => {
    const a = await bootstrapCouple("offers-a@weddly.test");
    const b = await bootstrapCouple("offers-b@weddly.test");

    const bad = await req(
      "POST",
      "/api/vendor-offers",
      { offer: { schema: "nope" } },
      { token: a.token },
    );
    expect(bad.status).toBe(400);

    const one = await req<{ offer: VendorOffer }>(
      "POST",
      "/api/vendor-offers",
      { offer: offerBody() },
      { token: a.token },
    );
    expect(one.status).toBe(201);
    expect(one.data.offer.total).toBe(60 * 80 + 800);
    expect(one.data.offer.quoted_at).toBe("2026-11-10");

    const two = await req<{ offer: VendorOffer }>(
      "POST",
      "/api/vendor-offers",
      {
        offer: offerBody({
          vendor: { name: "Other Catering", category: "catering" },
          quoted_at: "2026-11-12",
        }),
      },
      { token: a.token },
    );
    const list = await req<{ offers: VendorOffer[] }>("GET", "/api/vendor-offers", undefined, {
      token: a.token,
    });
    expect(list.data.offers.map((o) => o.id)).toEqual([two.data.offer.id, one.data.offer.id]);

    await req(
      "PATCH",
      `/api/vendor-offers/${one.data.offer.id}`,
      { status: "chosen" },
      { token: a.token },
    );
    await req(
      "PATCH",
      `/api/vendor-offers/${two.data.offer.id}`,
      { status: "chosen" },
      { token: a.token },
    );
    const after = await req<{ offers: VendorOffer[] }>("GET", "/api/vendor-offers", undefined, {
      token: a.token,
    });
    const byId = new Map(after.data.offers.map((o) => [o.id, o.status]));
    expect(byId.get(two.data.offer.id)).toBe("chosen");
    expect(byId.get(one.data.offer.id)).toBe("shortlisted");

    const other = await req<{ offers: VendorOffer[] }>("GET", "/api/vendor-offers", undefined, {
      token: b.token,
    });
    expect(other.data.offers).toHaveLength(0);
    const steal = await req("DELETE", `/api/vendor-offers/${one.data.offer.id}`, undefined, {
      token: b.token,
    });
    expect(steal.status).toBe(404);
    const del = await req("DELETE", `/api/vendor-offers/${one.data.offer.id}`, undefined, {
      token: a.token,
    });
    expect(del.status).toBe(200);
  }, 60_000);
});
