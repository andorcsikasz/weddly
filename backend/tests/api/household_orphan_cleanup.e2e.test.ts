// Emptying a household must not leave it behind as a 0-member orphan (it kept
// showing in the guest list, the household picker, the invite-batch report, and
// the check-in code space). A household is emptied two ways and BOTH run
// purgeHouseholdIfEmpty in the same transaction as the write that emptied it:
//   - moving the last member out (routes/guests.ts handleUpdate)
//   - deleting the last member (routes/guests.ts handleDelete, which also
//     cascade-deletes the guest's materialized +1s, so it sweeps every
//     household the cascade touched, not just the host's)
// See domain/household_cleanup.ts for the shared rule.
//
// Decision (2026-07): an emptied household is ALWAYS deleted, even when an
// invite was already sent to it; the moved guest carries its own
// guests.invited_at so no invite history is lost.

import "../setup";

import { describe, expect, test } from "bun:test";
import { db, now } from "../../src/db";
import { listEmptyHouseholds, purgeEmptyHouseholds } from "../../src/domain/household_cleanup";
import { bootstrapCouple, registerAndVerify, req } from "../helpers";

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

describe("household orphan cleanup on guest delete", () => {
  test("(a) deleting one member of a multi-member household keeps the household", async () => {
    const { token } = await bootstrapCouple("hh-del-a@weddly.test");
    const multi = await newHousehold(token, "MultiDel");
    const secondId = await addMember(token, multi.hhId, "MultiDel B");
    expect(memberCount(multi.hhId)).toBe(2);

    const del = await req("DELETE", `/api/guests/${secondId}`, undefined, { token });
    expect(del.status).toBe(200);

    // One member left, so the household is still a household.
    expect(householdExists(multi.hhId)).toBe(1);
    expect(memberCount(multi.hhId)).toBe(1);
    const list = await req<HouseholdsEnvelope>("GET", "/api/households", undefined, { token });
    expect(list.data.households.some((h) => h.id === multi.hhId)).toBe(true);
  });

  test("(b) deleting the last remaining member deletes the household", async () => {
    const { token } = await bootstrapCouple("hh-del-b@weddly.test");
    const multi = await newHousehold(token, "Emptying");
    const secondId = await addMember(token, multi.hhId, "Emptying B");

    expect((await req("DELETE", `/api/guests/${secondId}`, undefined, { token })).status).toBe(200);
    expect(householdExists(multi.hhId)).toBe(1); // still one member

    expect((await req("DELETE", `/api/guests/${multi.guestId}`, undefined, { token })).status).toBe(
      200,
    );

    // The last delete emptied it, so the household went with it...
    expect(householdExists(multi.hhId)).toBe(0);
    // ...and it is gone from the picker / list the frontend reads too.
    const list = await req<HouseholdsEnvelope>("GET", "/api/households", undefined, { token });
    expect(list.data.households.some((h) => h.id === multi.hhId)).toBe(false);
  });

  test("(c) the deleted household's check-in code is freed for reuse", async () => {
    const { token, coupleId } = await bootstrapCouple("hh-del-c@weddly.test");
    const solo = await newHousehold(token, "CodeHolder");
    const code = (
      db.prepare("SELECT code FROM households WHERE id = ?").get(solo.hhId) as { code: string }
    ).code;

    expect((await req("DELETE", `/api/guests/${solo.guestId}`, undefined, { token })).status).toBe(
      200,
    );
    expect(householdExists(solo.hhId)).toBe(0);
    // Nothing squats the code any more...
    const holders = db
      .prepare("SELECT id FROM households WHERE couple_id = ? AND code = ?")
      .all(coupleId, code);
    expect(holders).toEqual([]);

    // ...so UNIQUE(couple_id, code) lets a new household take it. Before the
    // fix the orphan row held this slot forever.
    const reuser = await newHousehold(token, "CodeReuser");
    expect(() =>
      db.prepare("UPDATE households SET code = ? WHERE id = ?").run(code, reuser.hhId),
    ).not.toThrow();
    expect(
      (db.prepare("SELECT code FROM households WHERE id = ?").get(reuser.hhId) as { code: string })
        .code,
    ).toBe(code);
  });

  test("(d) deleting a host cascades its +1 and removes the household they shared", async () => {
    const { token } = await bootstrapCouple("hh-del-d@weddly.test");
    const solo = await newHousehold(token, "HostHH");

    const plus = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "HostHH Plus", plus_one_of: solo.guestId },
      { token },
    );
    expect(plus.status).toBe(201);
    // A "+1" inherits its host's household at creation.
    expect(plus.data.guest.household_id).toBe(solo.hhId);
    expect(memberCount(solo.hhId)).toBe(2);

    // Deleting the host takes the +1 with it, so the count reaches zero and the
    // household must go. The purge has to run AFTER the cascade delete, or it
    // would still see the +1 and spare the row.
    expect((await req("DELETE", `/api/guests/${solo.guestId}`, undefined, { token })).status).toBe(
      200,
    );
    expect(db.prepare("SELECT id FROM guests WHERE id = ?").get(plus.data.guest.id)).toBeNull();
    expect(householdExists(solo.hhId)).toBe(0);
  });

  test("a +1 moved to its own household empties BOTH when the host is deleted", async () => {
    // A +1 inherits the host's household but can be moved away afterwards, so
    // the delete collects every household the cascade touches, not just the
    // host's own.
    const { token } = await bootstrapCouple("hh-del-split@weddly.test");
    const host = await newHousehold(token, "SplitHost");

    const plus = await req<GuestEnvelope>(
      "POST",
      "/api/guests",
      { full_name: "Split Plus", plus_one_of: host.guestId },
      { token },
    );
    expect(plus.status).toBe(201);
    const plusId = plus.data.guest.id;

    const moved = await req<GuestEnvelope>(
      "PATCH",
      `/api/guests/${plusId}`,
      { full_name: "Split Plus", household_id: null, new_household_label: "PlusOwn" },
      { token },
    );
    expect(moved.status).toBe(200);
    const plusHhId = moved.data.guest.household_id as number;
    expect(plusHhId).not.toBe(host.hhId);
    expect(memberCount(host.hhId)).toBe(1);
    expect(memberCount(plusHhId)).toBe(1);

    expect((await req("DELETE", `/api/guests/${host.guestId}`, undefined, { token })).status).toBe(
      200,
    );
    expect(householdExists(host.hhId)).toBe(0);
    expect(householdExists(plusHhId)).toBe(0);
  });

  test("(e) the couple's own household survives a delete while a partner remains", async () => {
    // purgeHouseholdIfEmpty carries no is_couple_household exemption and this
    // change does not add one: the host household stands here because the other
    // partner is still in it, which is the same rule every other household gets.
    // bootstrapCouple onboards with a single display_name, which seeds no
    // partner_role rows; the split names are what materialise the host pair.
    const reg = await registerAndVerify({
      email: "hh-del-e@weddly.test",
      password: "supersafe123",
      full_name: "Owner",
    });
    expect(reg.status).toBe(201);
    const token = reg.data.token;
    const ob = await req<{ couple: { id: number } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "Mia",
        groom_name: "Lucas",
        wedding_date: "2026-09-12",
        target_guest_count: 80,
        budget_ceiling_huf: 5_000_000,
        style_tags: [],
      },
      { token },
    );
    expect(ob.status).toBe(201);
    const coupleId = ob.data.couple.id;

    const partners = db
      .prepare(
        "SELECT id, household_id FROM guests WHERE couple_id = ? AND partner_role IS NOT NULL ORDER BY id",
      )
      .all(coupleId) as { id: number; household_id: number | null }[];
    expect(partners.length).toBe(2);
    const hostHhId = partners[0]?.household_id as number;
    expect(partners[1]?.household_id).toBe(hostHhId);

    const before = await req<{ households: { id: number; is_couple_household: boolean }[] }>(
      "GET",
      "/api/households",
      undefined,
      { token },
    );
    expect(before.data.households.find((h) => h.id === hostHhId)?.is_couple_household).toBe(true);

    expect(
      (await req("DELETE", `/api/guests/${partners[0]?.id}`, undefined, { token })).status,
    ).toBe(200);

    expect(householdExists(hostHhId)).toBe(1);
    expect(memberCount(hostHhId)).toBe(1);
    const after = await req<{ households: { id: number; is_couple_household: boolean }[] }>(
      "GET",
      "/api/households",
      undefined,
      { token },
    );
    expect(after.data.households.find((h) => h.id === hostHhId)?.is_couple_household).toBe(true);
  });

  test("the guest.delete audit entry records enough to answer a support question", async () => {
    const { token, coupleId } = await bootstrapCouple("hh-del-audit@weddly.test");
    const solo = await newHousehold(token, "Audited");
    expect(
      (
        await req(
          "PATCH",
          `/api/guests/${solo.guestId}`,
          { full_name: "Audited A", email: "audited@weddly.test", rsvp_status: "yes" },
          { token },
        )
      ).status,
    ).toBe(200);

    expect((await req("DELETE", `/api/guests/${solo.guestId}`, undefined, { token })).status).toBe(
      200,
    );

    const entry = db
      .prepare(
        "SELECT before_json FROM audit_log WHERE couple_id = ? AND action = 'guest.delete' AND target_id = ? ORDER BY id DESC LIMIT 1",
      )
      .get(coupleId, solo.guestId) as { before_json: string | null } | undefined;
    expect(entry).toBeTruthy();
    const before = JSON.parse(entry?.before_json ?? "{}") as Record<string, unknown>;
    expect(before.full_name).toBe("Audited A");
    expect(before.household_id).toBe(solo.hhId);
    expect(before.email).toBe("audited@weddly.test");
    expect(before.rsvp_status).toBe("yes");
  });
});
