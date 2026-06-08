import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// The guest-page editor lets the couple set the hero date in place (click the
// date → date sheet → save). That sends a `wedding_date` scalar to
// PATCH /api/couples/current, which the backend folds into an `exact` goal.
// The load-bearing safety property: an autosave that touches an UNRELATED
// field (cover, venue, …) must NOT reset the date — the date branch is gated
// on the field being present. These tests pin both.

interface CoupleResp {
  couple: { wedding_date: string | null };
}

describe("couple wedding_date via guest-page editor PATCH", () => {
  test("PATCH wedding_date persists as an exact date and GET reflects it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wd-set@weddly.test");
    const patch = await req<CoupleResp>(
      "PATCH",
      "/api/couples/current",
      { wedding_date: "2027-05-15" },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.wedding_date).toBe("2027-05-15");

    const get = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(get.data.couple.wedding_date).toBe("2027-05-15");
  });

  test("a PATCH that omits wedding_date leaves the date untouched (no silent reset)", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wd-gate@weddly.test");
    // bootstrapCouple onboards with 2026-09-12.
    const before = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(before.data.couple.wedding_date).toBe("2026-09-12");

    // An unrelated field update (what the editor autosave sends when only the
    // venue changed) must not disturb the date.
    const patch = await req<CoupleResp>(
      "PATCH",
      "/api/couples/current",
      { venue_name: "Sári Udvar" },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.wedding_date).toBe("2026-09-12");
  });

  test("PATCH wedding_date: null clears it to TBD", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wd-clear@weddly.test");
    const patch = await req<CoupleResp>(
      "PATCH",
      "/api/couples/current",
      { wedding_date: null },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.wedding_date).toBeNull();
  });

  test("rejects a malformed date with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("wd-bad@weddly.test");
    const r = await req("PATCH", "/api/couples/current", { wedding_date: "not-a-date" }, { token });
    expect(r.status).toBe(400);
  });
});
