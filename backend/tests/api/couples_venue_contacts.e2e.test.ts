import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";

// The "Kulcsinfó" dashboard panel lets the couple enter their own venue address
// + phone and day-of coordinator / emergency contacts. These persist on the
// couple row via PATCH /api/couples/current (same endpoint as venue_name) and
// come back on the couple DTO. Empty string clears a field; over-length 400s.

interface CoupleResp {
  couple: {
    venue_address: string | null;
    venue_phone: string | null;
    coordinator_name: string | null;
    coordinator_phone: string | null;
    emergency_name: string | null;
    emergency_phone: string | null;
  };
}

describe("couple venue-contact fields (Kulcsinfó panel)", () => {
  test("PATCH persists all six fields and GET reflects them", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("kv-set@weddly.test");
    const body = {
      venue_address: "Fő út 1, Dunakiliti",
      venue_phone: "+36 30 111 2222",
      coordinator_name: "Anna Kovács",
      coordinator_phone: "+36 20 333 4444",
      emergency_name: "Béla Nagy",
      emergency_phone: "+36 70 555 6666",
    };
    const patch = await req<CoupleResp>("PATCH", "/api/couples/current", body, { token });
    expect(patch.status).toBe(200);
    expect(patch.data.couple.venue_address).toBe(body.venue_address);
    expect(patch.data.couple.venue_phone).toBe(body.venue_phone);
    expect(patch.data.couple.coordinator_name).toBe(body.coordinator_name);
    expect(patch.data.couple.coordinator_phone).toBe(body.coordinator_phone);
    expect(patch.data.couple.emergency_name).toBe(body.emergency_name);
    expect(patch.data.couple.emergency_phone).toBe(body.emergency_phone);

    const get = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(get.data.couple.venue_address).toBe(body.venue_address);
    expect(get.data.couple.emergency_phone).toBe(body.emergency_phone);
  });

  test("empty string clears a field back to null; whitespace is trimmed", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("kv-clear@weddly.test");
    await req("PATCH", "/api/couples/current", { venue_phone: "  +36 1 200 8817  " }, { token });
    const trimmed = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(trimmed.data.couple.venue_phone).toBe("+36 1 200 8817");

    const cleared = await req<CoupleResp>(
      "PATCH",
      "/api/couples/current",
      { venue_phone: "" },
      { token },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.couple.venue_phone).toBeNull();
  });

  test("an unrelated PATCH leaves the venue-contact fields untouched", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("kv-gate@weddly.test");
    await req("PATCH", "/api/couples/current", { coordinator_name: "Anna" }, { token });
    // Autosave of a different field must not wipe the coordinator.
    await req("PATCH", "/api/couples/current", { venue_name: "Sári Csárda" }, { token });
    const get = await req<CoupleResp>("GET", "/api/couples/current", undefined, { token });
    expect(get.data.couple.coordinator_name).toBe("Anna");
  });

  test("rejects an over-length address with 400", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("kv-long@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { venue_address: "x".repeat(301) },
      { token },
    );
    expect(r.status).toBe(400);
  });
});
