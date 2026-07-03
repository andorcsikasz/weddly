// Couple-side demo locale coverage: POST /api/demo/start seeds the Shrek &
// Fiona workspace in the language the visitor's UI runs in ({ locale } in the
// body, Accept-Language as fallback, EN default). The core demo lifecycle
// tests (seeding counts, purge sweep, demo_usage snapshot) still live in the
// legacy monolith backend/tests/e2e.test.ts.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { req, wipeAll } from "../helpers";

interface StartRes {
  session: { token: string; user: { id: number; full_name: string } };
  couple: { id: number; is_demo: boolean } | null;
  seeded: Record<string, number>;
}

describe("demo locale", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("locale=hu seeds a fully Hungarian workspace", async () => {
    const res = await req<StartRes>("POST", "/api/demo/start", { locale: "hu" });
    expect(res.status).toBe(201);
    expect(res.data.session.user.full_name).toBe("Demó vendég");

    const guests = await req<{ guests: Array<{ full_name: string; notes: string | null }> }>(
      "GET",
      "/api/guests",
      undefined,
      { token: res.data.session.token },
    );
    expect(guests.status).toBe(200);
    const names = guests.data.guests.map((g) => g.full_name);
    expect(names).toContain("Szamár");
    expect(names).toContain("Csizmás Kandúr");
    expect(names).toContain("Mézeskalács Ember");
    expect(names).not.toContain("Donkey");

    const budget = await req<{ lines: Array<{ label: string }> }>(
      "GET",
      "/api/budget/lines",
      undefined,
      { token: res.data.session.token },
    );
    expect(budget.status).toBe(200);
    const labels = budget.data.lines.map((l) => l.label);
    expect(labels).toContain("Mocsári tisztás + kis rendezvénysátor");
    expect(labels).not.toContain("Swamp clearing + small marquee");
  });

  test("no locale in the body defaults to English", async () => {
    const res = await req<StartRes>("POST", "/api/demo/start", {});
    expect(res.status).toBe(201);
    expect(res.data.session.user.full_name).toBe("Demo Guest");

    const guests = await req<{ guests: Array<{ full_name: string }> }>(
      "GET",
      "/api/guests",
      undefined,
      { token: res.data.session.token },
    );
    const names = guests.data.guests.map((g) => g.full_name);
    expect(names).toContain("Donkey");
    expect(names).not.toContain("Szamár");
  });
});
