// Moving a guest off a household must not leave the old one behind as a
// 0-member orphan (it kept showing in the guest list, the household picker, and
// the check-in code space). Every guest-move path runs purgeHouseholdIfEmpty:
// if the move emptied the previous household, it is deleted in the same
// transaction. See routes/guests.ts (handleUpdate) + domain/household_cleanup.ts.
//
// Decision (2026-07): an emptied household is ALWAYS deleted, even when an
// invite was already sent to it; the moved guest carries its own
// guests.invited_at so no invite history is lost.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { listEmptyHouseholds, purgeEmptyHouseholds } from "../../src/domain/household_cleanup";
import { bootstrapCouple, req } from "../helpers";

interface GuestEnvelope {
  guest: { id: number; household_id: number | null; invited_at: number | null };
}
interface HouseholdsEnvelope {
  households: { id: number }[];
}

/** How many household rows carry this id (0 = gone). */
function householdExists(id: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM households WHERE id = ?").get(id) as { n: number })
    .n;
}
/** How many guests still belong to this household. */
function memberCount(id: number): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM guests WHERE household_id = ?").get(id) as { n: number }
  ).n;
}

async function newHousehold(
  token: string,
  label: string,
): Promise<{ guestId: number; hhId: number }> {
  const r = await req<GuestEnvelope>(
    "POST",
    "/api/guests",
    { full_name: `${label} A`, new_household_label: label },
    { token },
  );
  expect(r.status).toBe(201);
  expect(r.data.guest.household_id).not.toBeNull();
  return { guestId: r.data.guest.id, hhId: r.data.guest.household_id as number };
}

async function addMember(token: string, hhId: number, name: string): Promise<number> {
  const r = await req<GuestEnvelope>(
    "POST",
    "/api/guests",
    { full_name: name, household_id: hhId },
    { token },
  );
  expect(r.status).toBe(201);
  expect(r.data.guest.household_id).toBe(hhId);
  return r.data.guest.id;
}

describe("household orphan cleanup on guest move", () => {
  test("(a) moving the sole member of a household into an existing one deletes the emptied household", async () => {
    const { token } = await bootstrapCouple("hh-orphan-a@weddly.test");
    const solo = await newHousehold(token, "Solo");
    const target = await newHousehold(token, "Target");

    const moved = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${solo.guestId}`,
      { full_name: "Solo A", household_id: target.hhId },
      { token },
    );
    expect(moved.status).toBe(200);
    expect(moved.data.guest.household_id).toBe(target.hhId);

    // The emptied solo household is gone from the DB...
    expect(householdExists(solo.hhId)).toBe(0);
    expect(householdExists(target.hhId)).toBe(1);
    expect(memberCount(target.hhId)).toBe(2);

    // ...and from the household picker / list dropdown the frontend reads.
    const list = await req<HouseholdsEnvelope>("GET", "/api/households", undefined, { token });
    expect(list.data.households.some((h) => h.id === solo.hhId)).toBe(false);
    expect(list.data.households.some((h) => h.id === target.hhId)).toBe(true);
  });

  test("(b) moving one member out of a multi-member household keeps the household", async () => {
    const { token } = await bootstrapCouple("hh-orphan-b@weddly.test");
    const multi = await newHousehold(token, "Multi");
    const secondId = await addMember(token, multi.hhId, "Multi B");
    const target = await newHousehold(token, "Target");
    expect(memberCount(multi.hhId)).toBe(2);

    const moved = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${secondId}`,
      { full_name: "Multi B", household_id: target.hhId },
      { token },
    );
    expect(moved.status).toBe(200);
    expect(moved.data.guest.household_id).toBe(target.hhId);

    // Household survives with its remaining member; only the moved guest left.
    expect(householdExists(multi.hhId)).toBe(1);
    expect(memberCount(multi.hhId)).toBe(1);
  });

  test("(c) creating a new household during the move deletes an emptied old one but spares a still-populated one", async () => {
    const { token } = await bootstrapCouple("hh-orphan-c@weddly.test");

    // c1: sole member moved into a brand-new household -> old solo one deleted,
    // new one created and holding the guest.
    const solo = await newHousehold(token, "SoloC");
    const movedSolo = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${solo.guestId}`,
      { full_name: "SoloC A", household_id: null, new_household_label: "Fresh" },
      { token },
    );
    expect(movedSolo.status).toBe(200);
    const freshId = movedSolo.data.guest.household_id as number;
    expect(freshId).not.toBe(solo.hhId); // genuinely a new household
    expect(householdExists(solo.hhId)).toBe(0); // old solo one swept
    expect(householdExists(freshId)).toBe(1);
    expect(memberCount(freshId)).toBe(1);

    // c2: one member of a multi-member household moved into a new household ->
    // the multi-member source is NOT wrongly affected.
    const multi = await newHousehold(token, "MultiC");
    const secondId = await addMember(token, multi.hhId, "MultiC B");
    const movedOne = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${secondId}`,
      { full_name: "MultiC B", household_id: null, new_household_label: "Split" },
      { token },
    );
    expect(movedOne.status).toBe(200);
    expect(householdExists(multi.hhId)).toBe(1); // source untouched
    expect(memberCount(multi.hhId)).toBe(1);
  });

  test("an already-invited household is still deleted when emptied; the guest keeps its own invite stamp", async () => {
    const { token } = await bootstrapCouple("hh-orphan-invited@weddly.test");
    const solo = await newHousehold(token, "Invited");
    const target = await newHousehold(token, "Target");

    // Simulate an invite already sent: stamp both the household and its member.
    const stamp = now();
    db.prepare("UPDATE households SET invited_at = ? WHERE id = ?").run(stamp, solo.hhId);
    db.prepare("UPDATE guests SET invited_at = ? WHERE id = ?").run(stamp, solo.guestId);

    const moved = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${solo.guestId}`,
      { full_name: "Invited A", household_id: target.hhId },
      { token },
    );
    expect(moved.status).toBe(200);

    // "Mindig törölni": the emptied household goes regardless of invited_at...
    expect(householdExists(solo.hhId)).toBe(0);
    // ...and the guest still carries its own invite history to the new home.
    expect(moved.data.guest.invited_at).toBe(stamp);
  });

  test("cleanup-script helpers surface and remove pre-existing member-less households", async () => {
    // Back the one-time backfill script: a household with no members (here one
    // created straight from the household picker, never populated) is listed by
    // listEmptyHouseholds and removed by purgeEmptyHouseholds, while a populated
    // household is left alone.
    const { token } = await bootstrapCouple("hh-orphan-script@weddly.test");
    const populated = await newHousehold(token, "Keep");

    const created = await req<{ household: { id: number } }>(
      "POST",
      "/api/households",
      { label: "Empty orphan" },
      { token },
    );
    expect(created.status).toBe(201);
    const orphanId = created.data.household.id;
    expect(memberCount(orphanId)).toBe(0);

    const empties = listEmptyHouseholds();
    expect(empties.some((h) => h.id === orphanId)).toBe(true);
    expect(empties.some((h) => h.id === populated.hhId)).toBe(false);

    const removed = purgeEmptyHouseholds(empties.map((h) => h.id));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(householdExists(orphanId)).toBe(0);
    expect(householdExists(populated.hhId)).toBe(1); // populated one untouched
  });

  test("a plain edit that does not move the guest leaves the household intact", async () => {
    const { token } = await bootstrapCouple("hh-orphan-noop@weddly.test");
    const solo = await newHousehold(token, "Stable");

    const edited = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${solo.guestId}`,
      { full_name: "Renamed", notes: "still here" },
      { token },
    );
    expect(edited.status).toBe(200);
    expect(edited.data.guest.household_id).toBe(solo.hhId);
    expect(householdExists(solo.hhId)).toBe(1);
    expect(memberCount(solo.hhId)).toBe(1);
  });
});
