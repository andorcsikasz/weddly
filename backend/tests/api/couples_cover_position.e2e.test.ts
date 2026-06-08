import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// Cover-photo focal point (object-position %). The couple drags the cover in
// the guest-page editor; the value persists on the couple and feeds the public
// guest page so the hero crop frames the chosen part.

interface CoupleResp {
  couple: { cover_position_x: number; cover_position_y: number };
}

describe("couple cover_position_x/y", () => {
  test("defaults to 50/50 (centred) on a fresh couple", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cover-pos-default@weddly.test");
    const r = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(r.status).toBe(200);
    expect(r.data.couple.cover_position_x).toBe(50);
    expect(r.data.couple.cover_position_y).toBe(50);
  });

  test("PATCH persists a focal point and GET reflects it", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cover-pos-set@weddly.test");
    const patch = await req<CoupleResp>(
      "PATCH",
      "/api/couples/current",
      { cover_position_x: 20, cover_position_y: 80 },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.cover_position_x).toBe(20);
    expect(patch.data.couple.cover_position_y).toBe(80);

    const get = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(get.data.couple.cover_position_x).toBe(20);
    expect(get.data.couple.cover_position_y).toBe(80);
  });

  test("rounds a fractional percentage to an integer", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cover-pos-round@weddly.test");
    const patch = await req<CoupleResp>(
      "PATCH",
      "/api/couples/current",
      { cover_position_x: 33.7, cover_position_y: 0 },
      { token },
    );
    expect(patch.status).toBe(200);
    expect(patch.data.couple.cover_position_x).toBe(34);
    expect(patch.data.couple.cover_position_y).toBe(0);
  });

  test("rejects an out-of-range percentage (>100) with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("cover-pos-range@weddly.test");
    const r = await req("PATCH", "/api/couples/current", { cover_position_x: 150 }, { token });
    expect(r.status).toBe(400);
  });
});
