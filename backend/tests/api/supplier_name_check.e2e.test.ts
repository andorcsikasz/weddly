// GET /api/suppliers/name-check — the live "are they already on Weddly?" lookup
// that the recommend-a-supplier form runs against the typed-in name. Public,
// searches the full directory (curated + active community + claimed vendors).

import "../setup";

import { describe, expect, test } from "bun:test";
import type { SupplierNameCheckResponse } from "@shared/community_suppliers";
import { req } from "../helpers";

describe("supplier name-check (already-listed lookup)", () => {
  test("matches a curated directory listing by name", async () => {
    const res = await req<SupplierNameCheckResponse>(
      "GET",
      `/api/suppliers/name-check?name=${encodeURIComponent("Normafa")}`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data.matches)).toBe(true);
    expect(res.data.matches.length).toBeGreaterThan(0);
    const hit = res.data.matches.find((m) => /normafa/i.test(m.name));
    expect(hit).toBeDefined();
    expect(hit?.id).toBeTruthy();
    expect(hit?.city).toBeTruthy();
    expect(hit?.category).toBeTruthy();
  });

  test("case-insensitive and substring both directions", async () => {
    const res = await req<SupplierNameCheckResponse>(
      "GET",
      `/api/suppliers/name-check?name=${encodeURIComponent("normafa rendezvényház budapest")}`,
    );
    expect(res.status).toBe(200);
    expect(res.data.matches.some((m) => /normafa/i.test(m.name))).toBe(true);
  });

  test("returns empty for a query shorter than 3 characters", async () => {
    const res = await req<SupplierNameCheckResponse>("GET", "/api/suppliers/name-check?name=No");
    expect(res.status).toBe(200);
    expect(res.data.matches).toEqual([]);
  });

  test("returns empty for an unknown supplier name", async () => {
    const res = await req<SupplierNameCheckResponse>(
      "GET",
      `/api/suppliers/name-check?name=${encodeURIComponent("Zzxqwerty Nonexistent Vendor 9182")}`,
    );
    expect(res.status).toBe(200);
    expect(res.data.matches).toEqual([]);
  });

  test("missing name param is treated as empty", async () => {
    const res = await req<SupplierNameCheckResponse>("GET", "/api/suppliers/name-check");
    expect(res.status).toBe(200);
    expect(res.data.matches).toEqual([]);
  });
});
