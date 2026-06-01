// Focused depth coverage for the public RSVP state machine + the idempotency
// guards layered on top of /api/rsvp/checkin. The sibling file
// `guests_rsvp.e2e.test.ts` already covers the happy-path "does the route
// wire up" cases; this suite drills into the per-member status graph
// (pending → yes → no → yes → maybe), the plus-one materialization
// semantics on the legacy `/api/rsvp/:code` POST, the dual idempotency keys
// (header + content-hash), slug/code resolution edge cases, the
// guest-portal gate, the per-IP rate-limit shape, and the audit-log
// side-effect.
//
// All tests run against the real Bun server booted by `tests/setup.ts`. The
// shared `req()` helper rotates the client IP per call by default; tests that
// need a stable bucket pass an explicit `clientIp`.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail, bootstrapCouple } from "../helpers";
import { db } from "../../src/db";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

// ─── helpers ────────────────────────────────────────────────────────────────

async function getSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

interface HouseholdView {
  id: number;
  code: string;
  label: string;
  member_ids: number[];
}

async function listHouseholds(token: string): Promise<HouseholdView[]> {
  const list = await req<{ households: HouseholdView[] }>("GET", "/api/households", undefined, {
    token,
  });
  return list.data.households;
}

interface SeededHousehold {
  token: string;
  coupleId: number;
  slug: string;
  household: { id: number; code: string };
  members: { id: number; full_name: string }[];
}

/** Bootstrap a fresh couple + create one explicit household with N named
 *  members. Standard scaffolding for state-machine cases that need a known
 *  guest_id roster. */
async function seedHousehold(email: string, names: string[]): Promise<SeededHousehold> {
  const { token, coupleId } = await bootstrapCouple(email);
  const hh = await req<{ household: { id: number; code: string } }>(
    "POST",
    "/api/households",
    { label: "Test Party" },
    { token },
  );
  const members: { id: number; full_name: string }[] = [];
  for (const name of names) {
    const g = await req<{ guest: { id: number; full_name: string } }>(
      "POST",
      "/api/guests",
      { full_name: name, household_id: hh.data.household.id },
      { token },
    );
    expect(g.status).toBe(201);
    members.push(g.data.guest);
  }
  return {
    token,
    coupleId,
    slug: await getSlug(token),
    household: hh.data.household,
    members,
  };
}

interface CheckinResponse {
  rsvp: {
    members: {
      id: number;
      full_name: string;
      rsvp_status: string;
      meal_choice: string | null;
      dietary: string | null;
    }[];
    rsvp_offers_accommodation: boolean;
    rsvp_collects_meal: boolean;
  };
}

async function submit(
  seeded: SeededHousehold,
  members: {
    guest_id: number;
    rsvp_status: string;
    meal_choice?: string | null;
    dietary?: string | null;
  }[],
  added: { full_name: string; kind?: string; rsvp_status?: string }[] = [],
  idempotencyKey?: string,
): Promise<{ status: number; data: CheckinResponse }> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return req<CheckinResponse>(
    "POST",
    "/api/rsvp/checkin",
    {
      couple_slug: seeded.slug,
      household_code: seeded.household.code,
      members,
      added_members: added,
    },
    { headers },
  );
}

function getGuestStatus(id: number): string {
  const r = db.prepare("SELECT rsvp_status FROM guests WHERE id = ?").get(id) as
    | { rsvp_status: string }
    | undefined;
  return r?.rsvp_status ?? "<missing>";
}

function getGuestRow(id: number): {
  rsvp_status: string;
  rsvp_responded_at: number | null;
  updated_at: number;
  meal_choice: string | null;
  dietary: string | null;
  plus_one_name: string | null;
  group_tag: string;
} {
  return db
    .prepare(
      "SELECT rsvp_status, rsvp_responded_at, updated_at, meal_choice, dietary, plus_one_name, group_tag FROM guests WHERE id = ?",
    )
    .get(id) as ReturnType<typeof getGuestRow>;
}

function countHouseholdGuests(householdId: number): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM guests WHERE household_id = ?")
    .get(householdId) as { n: number };
  return r.n;
}

// ─── 1. per-member state transitions ────────────────────────────────────────

describe("rsvp state graph: per-member transitions", () => {
  test("pending → yes → no → yes → maybe advances rsvp_status on each POST", async () => {
    wipeAll();
    const seed = await seedHousehold("graph-trans@weddly.test", ["Anna"]);
    const id = seed.members[0]!.id;

    expect(getGuestStatus(id)).toBe("pending");

    // Each step uses a unique Idempotency-Key so the third "yes" isn't
    // dedup'd as a content-hash replay of the first "yes" submit.
    let step = 0;
    for (const next of ["yes", "no", "yes", "maybe"] as const) {
      step++;
      const r = await submit(seed, [{ guest_id: id, rsvp_status: next }], [], `trans-step-${step}`);
      expect(r.status).toBe(200);
      expect(getGuestStatus(id)).toBe(next);
    }
  });

  test("each transition stamps rsvp_responded_at + bumps updated_at forward", async () => {
    wipeAll();
    const seed = await seedHousehold("graph-ts@weddly.test", ["Anna"]);
    const id = seed.members[0]!.id;

    const initial = getGuestRow(id);
    expect(initial.rsvp_responded_at).toBeNull();

    const r1 = await submit(seed, [{ guest_id: id, rsvp_status: "yes" }]);
    expect(r1.status).toBe(200);
    const afterYes = getGuestRow(id);
    expect(afterYes.rsvp_responded_at).not.toBeNull();
    expect(afterYes.updated_at).toBeGreaterThanOrEqual(initial.updated_at);

    // Sleep a millisecond so monotonic ms timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await submit(seed, [{ guest_id: id, rsvp_status: "no" }]);
    expect(r2.status).toBe(200);
    const afterNo = getGuestRow(id);
    expect(afterNo.updated_at).toBeGreaterThan(afterYes.updated_at);
    expect(afterNo.rsvp_responded_at).not.toBeNull();
  });

  test("re-submitting the SAME status still bumps updated_at (no-op tolerance)", async () => {
    wipeAll();
    const seed = await seedHousehold("graph-noop@weddly.test", ["Anna"]);
    const id = seed.members[0]!.id;

    await submit(seed, [{ guest_id: id, rsvp_status: "yes" }], [], "graph-noop-1");
    const first = getGuestRow(id);
    await new Promise((r) => setTimeout(r, 5));
    // Different key so the idempotency cache doesn't replay.
    await submit(seed, [{ guest_id: id, rsvp_status: "yes" }], [], "graph-noop-2");
    const second = getGuestRow(id);
    expect(second.rsvp_status).toBe("yes");
    expect(second.updated_at).toBeGreaterThanOrEqual(first.updated_at);
    // rsvp_responded_at is always re-stamped on a submit even if no field
    // changed — applyMemberCheckin doesn't compare against the previous row.
    expect(second.rsvp_responded_at).not.toBeNull();
  });
});

// ─── 2. added-member lifecycle on a checkin ─────────────────────────────────

describe("rsvp state graph: added_members lifecycle", () => {
  test("added_members create new guest rows in the same household", async () => {
    wipeAll();
    const seed = await seedHousehold("add-create@weddly.test", ["Host"]);
    const before = countHouseholdGuests(seed.household.id);
    const r = await submit(
      seed,
      [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
      [
        { full_name: "PlusOne", kind: "adult", rsvp_status: "yes" },
        { full_name: "Kid", kind: "child", rsvp_status: "yes" },
      ],
    );
    expect(r.status).toBe(200);
    const after = countHouseholdGuests(seed.household.id);
    expect(after).toBe(before + 2);
    // The view also reflects the new members.
    expect(r.data.rsvp.members.length).toBe(after);
    const names = r.data.rsvp.members.map((m) => m.full_name).sort();
    expect(names).toContain("PlusOne");
    expect(names).toContain("Kid");
  });

  // behavior: persistAddedMembers hardcodes group_tag = 'other' on the INSERT
  // (see backend/src/routes/rsvp.ts line ~343). The added member does NOT
  // inherit the parent household's group_tag — a deliberate "we don't know
  // their relation to either side" default.
  test("added_members are always created with group_tag='other' (not inherited from household)", async () => {
    wipeAll();
    const seed = await seedHousehold("add-grouptag@weddly.test", ["Host"]);
    // Move the household into a non-default tag.
    await req(
      "PATCH",
      `/api/households/${seed.household.id}`,
      { group_tag: "her_family" },
      { token: seed.token },
    );
    await submit(
      seed,
      [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
      [{ full_name: "Newcomer", kind: "adult", rsvp_status: "yes" }],
    );
    const row = db
      .prepare("SELECT group_tag FROM guests WHERE full_name = ? AND household_id = ?")
      .get("Newcomer", seed.household.id) as { group_tag: string };
    expect(row.group_tag).toBe("other");
  });

  test("> 10 added_members → 400 (no rows inserted)", async () => {
    wipeAll();
    const seed = await seedHousehold("add-over10@weddly.test", ["Host"]);
    const before = countHouseholdGuests(seed.household.id);
    const big = Array.from({ length: 11 }, (_, i) => ({
      full_name: `Extra ${i}`,
      kind: "adult",
      rsvp_status: "yes",
    }));
    const r = await submit(seed, [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }], big);
    expect(r.status).toBe(400);
    expect(countHouseholdGuests(seed.household.id)).toBe(before);
  });

  test("empty members AND empty added_members → 400", async () => {
    wipeAll();
    const seed = await seedHousehold("add-emptyboth@weddly.test", ["Host"]);
    const r = await submit(seed, [], []);
    expect(r.status).toBe(400);
  });

  test("empty members but non-empty added_members succeeds (walk-in plus-one)", async () => {
    // The "nothing to submit" guard only fires when BOTH arrays are empty.
    // A guest who pulls up the form, doesn't change their own row, but adds
    // a +1 should still be accepted.
    wipeAll();
    const seed = await seedHousehold("add-onlyadded@weddly.test", ["Host"]);
    const before = countHouseholdGuests(seed.household.id);
    const r = await submit(seed, [], [{ full_name: "Walkin", kind: "adult", rsvp_status: "yes" }]);
    expect(r.status).toBe(200);
    expect(countHouseholdGuests(seed.household.id)).toBe(before + 1);
  });
});

// ─── 3. idempotency: header + content hash + collision ──────────────────────

describe("rsvp state graph: idempotency", () => {
  test("same Idempotency-Key replays the cached response (no double-write)", async () => {
    wipeAll();
    const seed = await seedHousehold("idem-replay@weddly.test", ["Host"]);
    const before = countHouseholdGuests(seed.household.id);
    const key = `idem-replay-${Date.now()}`;
    const body = {
      couple_slug: seed.slug,
      household_code: seed.household.code,
      members: [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
      added_members: [{ full_name: "Add-Once", kind: "adult", rsvp_status: "yes" }],
    };
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
    const r1 = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.text();

    const r2 = await fetch(`${BASE}/api/rsvp/checkin`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("idempotent-replay")).toBe("1");
    const b2 = await r2.text();
    expect(b2).toBe(b1);

    // Guest count unchanged: the second call was a pure cache replay.
    expect(countHouseholdGuests(seed.household.id)).toBe(before + 1);
  });

  test("no Idempotency-Key, identical body twice → content-hash replay (single insert)", async () => {
    wipeAll();
    const seed = await seedHousehold("idem-hash@weddly.test", ["Host"]);
    const before = countHouseholdGuests(seed.household.id);
    const body = JSON.stringify({
      couple_slug: seed.slug,
      household_code: seed.household.code,
      members: [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
      added_members: [{ full_name: "HashGuest", kind: "adult", rsvp_status: "yes" }],
    });
    const headers = { "Content-Type": "application/json" };
    const r1 = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(r1.status).toBe(200);
    const r2 = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("idempotent-replay")).toBe("1");
    expect(countHouseholdGuests(seed.household.id)).toBe(before + 1);
  });

  // behavior: the idempotency cache is keyed by `${household_id}:${header}`.
  // When the same header is reused with a DIFFERENT body, the server hits the
  // cache and serves the FIRST response back — first wins. The second body's
  // mutations never reach the DB. Documented here so a future refactor that
  // changes this (e.g. "differ → 409 conflict") trips this test loudly.
  test("same Idempotency-Key with different body → first wins (second body ignored)", async () => {
    wipeAll();
    const seed = await seedHousehold("idem-collide@weddly.test", ["Host"]);
    const id = seed.members[0]!.id;
    const key = `collide-${Date.now()}`;
    const headers = { "Content-Type": "application/json", "Idempotency-Key": key };
    const before = countHouseholdGuests(seed.household.id);

    const body1 = JSON.stringify({
      couple_slug: seed.slug,
      household_code: seed.household.code,
      members: [{ guest_id: id, rsvp_status: "yes" }],
    });
    const r1 = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body: body1 });
    expect(r1.status).toBe(200);
    expect(getGuestStatus(id)).toBe("yes");

    const body2 = JSON.stringify({
      couple_slug: seed.slug,
      household_code: seed.household.code,
      members: [{ guest_id: id, rsvp_status: "no" }],
      added_members: [{ full_name: "Ignored-Collision", kind: "adult", rsvp_status: "yes" }],
    });
    const r2 = await fetch(`${BASE}/api/rsvp/checkin`, { method: "POST", headers, body: body2 });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("idempotent-replay")).toBe("1");

    // First call won: status is still "yes", no added member was inserted.
    expect(getGuestStatus(id)).toBe("yes");
    expect(countHouseholdGuests(seed.household.id)).toBe(before);
  });

  test("two different Idempotency-Keys both succeed and the LATER call wins", async () => {
    wipeAll();
    const seed = await seedHousehold("idem-concurrent@weddly.test", ["Host"]);
    const id = seed.members[0]!.id;
    const r1 = await submit(seed, [{ guest_id: id, rsvp_status: "yes" }], [], "concurrent-A");
    expect(r1.status).toBe(200);
    expect(getGuestStatus(id)).toBe("yes");
    const r2 = await submit(seed, [{ guest_id: id, rsvp_status: "no" }], [], "concurrent-B");
    expect(r2.status).toBe(200);
    expect(getGuestStatus(id)).toBe("no");
  });
});

// ─── 4. slug + code resolution edge cases ───────────────────────────────────

describe("rsvp state graph: slug + code resolution", () => {
  test("slug lookup is case-insensitive (UPPER vs MiXeD)", async () => {
    wipeAll();
    const seed = await seedHousehold("res-slug@weddly.test", ["Anna"]);
    const code = seed.household.code;

    const upper = await req(
      "GET",
      `/api/rsvp/lookup?couple=${seed.slug.toUpperCase()}&code=${code}`,
    );
    const mixed = await req(
      "GET",
      // mix case randomly
      `/api/rsvp/lookup?couple=${seed.slug
        .split("")
        .map((c, i) => (i % 2 ? c.toLowerCase() : c.toUpperCase()))
        .join("")}&code=${code}`,
    );
    expect(upper.status).toBe(200);
    expect(mixed.status).toBe(200);
  });

  test("code lookup tolerates leading + trailing whitespace", async () => {
    wipeAll();
    const seed = await seedHousehold("res-codews@weddly.test", ["Anna"]);
    const padded = encodeURIComponent(`  ${seed.household.code}  `);
    const r = await req("GET", `/api/rsvp/lookup?couple=${seed.slug}&code=${padded}`);
    expect(r.status).toBe(200);
  });

  test("after regenerate-code the OLD code 404s on /api/rsvp/checkin", async () => {
    wipeAll();
    const seed = await seedHousehold("res-regen@weddly.test", ["Anna"]);
    const oldCode = seed.household.code;
    const regen = await req<{ household: { code: string } }>(
      "POST",
      `/api/households/${seed.household.id}/regenerate-code`,
      {},
      { token: seed.token },
    );
    expect(regen.status).toBe(200);
    expect(regen.data.household.code).not.toBe(oldCode);

    const stale = await req("POST", "/api/rsvp/checkin", {
      couple_slug: seed.slug,
      household_code: oldCode,
      members: [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
    });
    expect(stale.status).toBe(404);

    const fresh = await req("POST", "/api/rsvp/checkin", {
      couple_slug: seed.slug,
      household_code: regen.data.household.code,
      members: [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
    });
    expect(fresh.status).toBe(200);
  });

  test("guest_id from a foreign household → 400 (not 403)", async () => {
    wipeAll();
    const seed = await seedHousehold("res-foreign@weddly.test", ["A"]);
    const other = await req<{ household: { id: number; code: string } }>(
      "POST",
      "/api/households",
      { label: "Other" },
      { token: seed.token },
    );
    const otherGuest = await req<{ guest: { id: number } }>(
      "POST",
      "/api/guests",
      { full_name: "Outsider", household_id: other.data.household.id },
      { token: seed.token },
    );
    const r = await req("POST", "/api/rsvp/checkin", {
      couple_slug: seed.slug,
      household_code: seed.household.code,
      // checking in OUTSIDER against seed's household
      members: [{ guest_id: otherGuest.data.guest.id, rsvp_status: "yes" }],
    });
    expect(r.status).toBe(400);
  });
});

// ─── 5. per-member independence + per-field validation ──────────────────────

describe("rsvp state graph: independence + field validation", () => {
  test("4-person household: each member RSVPs differently, no aggregate rollup", async () => {
    wipeAll();
    const seed = await seedHousehold("indep-4@weddly.test", ["W", "X", "Y", "Z"]);
    const [w, x, y, z] = seed.members;
    const r = await submit(seed, [
      { guest_id: w!.id, rsvp_status: "yes" },
      { guest_id: x!.id, rsvp_status: "no" },
      { guest_id: y!.id, rsvp_status: "maybe" },
      // Z is intentionally omitted from the payload — should stay "pending".
    ]);
    expect(r.status).toBe(200);
    expect(getGuestStatus(w!.id)).toBe("yes");
    expect(getGuestStatus(x!.id)).toBe("no");
    expect(getGuestStatus(y!.id)).toBe("maybe");
    expect(getGuestStatus(z!.id)).toBe("pending");
  });

  test("invalid meal_choice silently falls back to null", async () => {
    wipeAll();
    const seed = await seedHousehold("val-meal@weddly.test", ["Anna"]);
    const id = seed.members[0]!.id;
    const r = await submit(seed, [{ guest_id: id, rsvp_status: "yes", meal_choice: "sushi" }]);
    expect(r.status).toBe(200);
    expect(getGuestRow(id).meal_choice).toBeNull();
  });

  test("dietary='' / whitespace stores null, not an empty string", async () => {
    wipeAll();
    const seed = await seedHousehold("val-diet@weddly.test", ["Anna"]);
    const id = seed.members[0]!.id;
    const r1 = await submit(
      seed,
      [{ guest_id: id, rsvp_status: "yes", dietary: "" }],
      [],
      "diet-empty",
    );
    expect(r1.status).toBe(200);
    expect(getGuestRow(id).dietary).toBeNull();

    const r2 = await submit(
      seed,
      [{ guest_id: id, rsvp_status: "yes", dietary: "   " }],
      [],
      "diet-ws",
    );
    expect(r2.status).toBe(200);
    expect(getGuestRow(id).dietary).toBeNull();
  });
});

// ─── 6. guest portal gate ───────────────────────────────────────────────────

describe("rsvp state graph: guest portal gate", () => {
  test("0 yes RSVPs → 403 not_rsvpd", async () => {
    wipeAll();
    const seed = await seedHousehold("portal-zero@weddly.test", ["Anna"]);
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      `/api/guest/portal?couple=${seed.slug}&code=${seed.household.code}`,
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_rsvpd");
  });

  test("0 yes + 1 maybe → still 403", async () => {
    wipeAll();
    const seed = await seedHousehold("portal-maybe@weddly.test", ["Anna"]);
    await submit(seed, [{ guest_id: seed.members[0]!.id, rsvp_status: "maybe" }]);
    const r = await req<{ detail?: { code?: string } }>(
      "GET",
      `/api/guest/portal?couple=${seed.slug}&code=${seed.household.code}`,
    );
    expect(r.status).toBe(403);
    expect(r.data.detail?.code).toBe("not_rsvpd");
  });

  test(">=1 yes → 200 and exposes schedule payload", async () => {
    wipeAll();
    const seed = await seedHousehold("portal-yes@weddly.test", ["Anna"]);
    // Seed a schedule event before opening the gate so the portal payload
    // includes it.
    const ev = await req(
      "POST",
      "/api/schedule",
      {
        label: "Ceremony",
        starts_at_minutes: 16 * 60,
        duration_minutes: 60,
      },
      { token: seed.token },
    );
    expect(ev.status).toBe(201);

    await submit(seed, [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }]);

    const r = await req<{
      portal: { schedule: { label: string }[]; couple_display_name: string };
    }>("GET", `/api/guest/portal?couple=${seed.slug}&code=${seed.household.code}`);
    expect(r.status).toBe(200);
    expect(r.data.portal.schedule.length).toBe(1);
    expect(r.data.portal.schedule[0]!.label).toBe("Ceremony");
    expect(r.data.portal.couple_display_name).toBe("Mia & Lucas");
  });
});

// ─── 7. rate-limit: per-IP per-bucket ───────────────────────────────────────

describe("rsvp state graph: rate-limit shape", () => {
  test("lookup bucket: 31st request from same IP returns 429; another IP still 200", async () => {
    wipeAll();
    const seed = await seedHousehold("rate-look@weddly.test", ["Anna"]);
    const hot = "10.55.55.55";
    let ok = 0;
    let throttled = 0;
    for (let i = 0; i < 35; i++) {
      const r = await req(
        "GET",
        `/api/rsvp/lookup?couple=${seed.slug}&code=${seed.household.code}`,
        undefined,
        { clientIp: hot },
      );
      if (r.status === 200) ok++;
      else if (r.status === 429) throttled++;
    }
    // Bucket capacity is 30 → ~30 successes, the rest 429.
    expect(ok).toBeGreaterThanOrEqual(29);
    expect(ok).toBeLessThanOrEqual(31);
    expect(throttled).toBeGreaterThan(0);

    // Another IP is unaffected by the hot bucket.
    const cold = await req(
      "GET",
      `/api/rsvp/lookup?couple=${seed.slug}&code=${seed.household.code}`,
      undefined,
      { clientIp: "10.55.55.56" },
    );
    expect(cold.status).toBe(200);
  });

  test("checkin uses an independent bucket from lookup (burning lookup doesn't block checkin)", async () => {
    // checkin's bucket key is `couple:<id>:hh:<id>` while lookup's is keyed
    // by client IP — different namespaces, so the two limits don't share
    // tokens. Burn the lookup bucket flat from one IP and confirm checkin
    // from the SAME IP still succeeds.
    wipeAll();
    const seed = await seedHousehold("rate-bucket@weddly.test", ["Anna"]);
    const ip = "10.66.66.66";
    for (let i = 0; i < 35; i++) {
      await req(
        "GET",
        `/api/rsvp/lookup?couple=${seed.slug}&code=${seed.household.code}`,
        undefined,
        { clientIp: ip },
      );
    }
    const r = await req(
      "POST",
      "/api/rsvp/checkin",
      {
        couple_slug: seed.slug,
        household_code: seed.household.code,
        members: [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
      },
      { clientIp: ip },
    );
    expect(r.status).toBe(200);
  });
});

// ─── 8. legacy /api/rsvp/:code per-guest path ───────────────────────────────

describe("rsvp state graph: legacy per-guest invite path", () => {
  test("GET /api/rsvp/:code (6-char) returns the household view shape", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-view@weddly.test");
    const g = await req<{ guest: { invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const r = await req<{
      rsvp: { members: { full_name: string }[]; household_code: string };
    }>("GET", `/api/rsvp/${g.data.guest.invite_code}`);
    expect(r.status).toBe(200);
    // Crockford 8-char post-May-2026; legacy 4-digit form preserved by OR.
    expect(r.data.rsvp.household_code).toMatch(/^([1-9]\d{3}|[0-9A-HJKMNP-TV-Z]{8})$/);
    expect(r.data.rsvp.members.length).toBe(1);
  });

  test("POST /api/rsvp/:code with plus_one_name materializes the +1 as a sibling row", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-plus@weddly.test");
    const g = await req<{ guest: { id: number; invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const r = await req<{ rsvp: { members: { id: number; full_name: string }[] } }>(
      "POST",
      `/api/rsvp/${g.data.guest.invite_code}`,
      {
        rsvp_status: "yes",
        meal_choice: "meat",
        plus_one_name: "Plus-Mark",
        plus_one_meal: "vegetarian",
      },
    );
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.length).toBe(2);
    const names = r.data.rsvp.members.map((m) => m.full_name).sort();
    expect(names).toEqual(["Anna", "Plus-Mark"]);
  });

  test("POST /api/rsvp/:code with whitespace-only plus_one_name does NOT materialize a sibling", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("legacy-plusws@weddly.test");
    const g = await req<{ guest: { id: number; invite_code: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Anna" },
      { token },
    );
    const r = await req<{ rsvp: { members: { full_name: string }[] } }>(
      "POST",
      `/api/rsvp/${g.data.guest.invite_code}`,
      { rsvp_status: "yes", plus_one_name: "   " },
    );
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.length).toBe(1);
    expect(r.data.rsvp.members[0]!.full_name).toBe("Anna");
  });
});

// ─── 9. PublicCheckinView shape: toggles + notes ────────────────────────────

describe("rsvp state graph: PublicCheckinView shape", () => {
  test("household.rsvp_offers_accommodation=true propagates to the view", async () => {
    wipeAll();
    const seed = await seedHousehold("view-accom@weddly.test", ["Anna"]);
    await req(
      "PATCH",
      `/api/households/${seed.household.id}`,
      { rsvp_offers_accommodation: true },
      { token: seed.token },
    );
    const r = await req<{
      rsvp: { rsvp_offers_accommodation: boolean; rsvp_collects_meal: boolean };
    }>("GET", `/api/rsvp/lookup?couple=${seed.slug}&code=${seed.household.code}`);
    expect(r.status).toBe(200);
    expect(r.data.rsvp.rsvp_offers_accommodation).toBe(true);
  });

  // behavior: rsvp_collects_meal is a UI hint surfaced as a boolean on the
  // payload — the route does NOT redact `meal_choice` from individual members
  // when the flag is false. Frontend honors the flag by hiding the meal-icon
  // row; the API is still consistent shape-wise so legacy clients don't
  // explode on a missing field.
  test("rsvp_collects_meal=false still includes guest_id + meal_choice fields in members payload", async () => {
    wipeAll();
    const seed = await seedHousehold("view-meal@weddly.test", ["Anna"]);
    await req(
      "PATCH",
      `/api/households/${seed.household.id}`,
      { rsvp_collects_meal: false },
      { token: seed.token },
    );
    // Set a meal so we can see whether it's surfaced.
    await submit(seed, [
      { guest_id: seed.members[0]!.id, rsvp_status: "yes", meal_choice: "meat" },
    ]);
    const r = await req<{
      rsvp: {
        rsvp_collects_meal: boolean;
        members: { id: number; meal_choice: string | null }[];
      };
    }>("GET", `/api/rsvp/lookup?couple=${seed.slug}&code=${seed.household.code}`);
    expect(r.status).toBe(200);
    expect(r.data.rsvp.rsvp_collects_meal).toBe(false);
    const m = r.data.rsvp.members[0]!;
    expect(m.id).toBe(seed.members[0]!.id);
    // Shape preserved — meal field is still present, value = what got saved.
    expect("meal_choice" in m).toBe(true);
    expect(m.meal_choice).toBe("meat");
  });

  test("household notes do NOT leak into PublicCheckinView (no notes field on the public shape)", async () => {
    wipeAll();
    const seed = await seedHousehold("view-notes@weddly.test", ["Anna"]);
    await req(
      "PATCH",
      `/api/households/${seed.household.id}`,
      { notes: "INTERNAL: VIP seating, no shellfish" },
      { token: seed.token },
    );
    const r = await req<{ rsvp: Record<string, unknown> }>(
      "GET",
      `/api/rsvp/lookup?couple=${seed.slug}&code=${seed.household.code}`,
    );
    expect(r.status).toBe(200);
    // Admin-only notes must not surface to the public RSVP form.
    expect("notes" in r.data.rsvp).toBe(false);
  });
});

// ─── 10. audit log side-effect ──────────────────────────────────────────────

describe("rsvp state graph: audit log", () => {
  test("each public RSVP submit writes one rsvp.submit row per member changed", async () => {
    wipeAll();
    const seed = await seedHousehold("audit-one@weddly.test", ["Anna", "Bence"]);
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'rsvp.submit'")
      .get(seed.coupleId) as { n: number };

    await submit(seed, [
      { guest_id: seed.members[0]!.id, rsvp_status: "yes" },
      { guest_id: seed.members[1]!.id, rsvp_status: "no" },
    ]);
    const after = db
      .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'rsvp.submit'")
      .get(seed.coupleId) as { n: number };
    expect(after.n).toBe(before.n + 2);
  });

  test("added_members each write an rsvp.add_member audit row", async () => {
    wipeAll();
    const seed = await seedHousehold("audit-add@weddly.test", ["Host"]);
    const before = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'rsvp.add_member'",
      )
      .get(seed.coupleId) as { n: number };
    await submit(
      seed,
      [{ guest_id: seed.members[0]!.id, rsvp_status: "yes" }],
      [
        { full_name: "Add1", kind: "adult", rsvp_status: "yes" },
        { full_name: "Add2", kind: "child", rsvp_status: "yes" },
      ],
    );
    const after = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE couple_id = ? AND action = 'rsvp.add_member'",
      )
      .get(seed.coupleId) as { n: number };
    expect(after.n).toBe(before.n + 2);
  });
});

// Avoid "imported but unused" for verifyUserEmail — the harness re-exports
// these together; some sibling test files use it directly and we want this
// import block kept stable across the cohort.
void verifyUserEmail;
