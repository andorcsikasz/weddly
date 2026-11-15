import "../setup";

import { describe, expect, test } from "bun:test";
import type { User } from "@shared/types";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// `users.vendor_filters` is the account-level half of "the directory opens the way
// I left it". The page writes the whole set after each change; this suite pins
// the allowlist (nothing outside it is stored) and the opt-out (turning memory
// off clears what was kept, it does not just hide it).

describe("PUT /api/auth/vendor-filters", () => {
  test("a fresh account has chosen nothing", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vfilt-fresh@weddly.test");
    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.vendor_filters).toBeNull();
  });

  test("stores the set and echoes the user on the next /me", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vfilt-store@weddly.test");
    const r = await req<{ user: User }>(
      "PUT",
      "/api/auth/vendor-filters",
      {
        remember: true,
        filters: { group: "venue_stay", cat: "venue", city: "Székesfehérvár", sort: "price_asc" },
      },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.user.vendor_filters).toEqual({
      remember: true,
      filters: { group: "venue_stay", cat: "venue", city: "Székesfehérvár", sort: "price_asc" },
    });

    const me = await req<{ user: User }>("GET", "/api/auth/me", undefined, { token });
    expect(me.data.user.vendor_filters?.filters?.cat).toBe("venue");
  });

  test("drops keys outside the allowlist and markup-shaped values", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vfilt-allow@weddly.test");
    const r = await req<{ user: User }>(
      "PUT",
      "/api/auth/vendor-filters",
      {
        remember: true,
        filters: {
          cat: "venue",
          admin: "1",
          city: "<script>alert(1)</script>",
          sort: 42,
          guests: "",
        },
      },
      { token },
    );
    expect(r.status).toBe(200);
    expect(r.data.user.vendor_filters?.filters).toEqual({ cat: "venue" });
  });

  test("opting out clears what was remembered", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vfilt-optout@weddly.test");
    await req(
      "PUT",
      "/api/auth/vendor-filters",
      { remember: true, filters: { city: "Eger" } },
      { token },
    );
    const r = await req<{ user: User }>(
      "PUT",
      "/api/auth/vendor-filters",
      { remember: false, filters: { city: "Eger" } },
      { token },
    );
    expect(r.data.user.vendor_filters).toEqual({ remember: false, filters: null });
  });

  test("refuses a body without a real boolean `remember`", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("vfilt-bool@weddly.test");
    for (const body of [{}, { remember: "yes" }, { filters: { cat: "venue" } }]) {
      const r = await req("PUT", "/api/auth/vendor-filters", body, { token });
      expect(r.status).toBe(400);
    }
  });

  test("requires a session", async () => {
    const r = await req("PUT", "/api/auth/vendor-filters", { remember: true }, {});
    expect(r.status).toBe(401);
  });
});
