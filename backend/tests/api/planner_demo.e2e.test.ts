// Planner-side demo: POST /api/demo/planner/start seeds a throwaway "Fairy
// Godmother Weddings" planner pre-loaded with a book of fairy-tale clients
// (Shrek & Fiona among them, plus a pending Belle & Adam invite), returns a
// planner session, and is reaped by purgeStalePlannerDemos WITHOUT consuming a
// real founding slot.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { purgeStaleDemoCouples } from "../../src/domain/demo_seed";
import { plannerFoundingSlotsUsed } from "../../src/domain/planner_billing";
import { purgeStalePlannerDemos } from "../../src/domain/planner_demo_seed";
import { req, wipeAll } from "../helpers";

interface StartRes {
  session: { token: string; user: { id: number; user_type: string; email: string } };
  seeded: Record<string, number>;
}
interface ClientsRes {
  clients: Array<{
    couple_id: number;
    display_name: string;
    confirmed_guests: number;
    task_summary: { total: number; done: number; overdue: number };
  }>;
}
interface InvitesRes {
  invites: Array<{ couple_id: number; display_name: string; status: string }>;
}

async function startPlannerDemo(): Promise<StartRes> {
  const r = await req<StartRes>("POST", "/api/demo/planner/start", {});
  expect(r.status).toBe(201);
  return r.data;
}

describe("planner demo", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("start seeds a premium planner session with the fairy-tale book of business", async () => {
    const { session, seeded } = await startPlannerDemo();

    expect(session.user.user_type).toBe("planner");
    expect(session.user.email).toMatch(/@demo\.weddly\.local$/);
    // 4 active clients + 1 pending invite.
    expect(seeded.clients_created).toBe(4);
    expect(seeded.pending_invites).toBe(1);
    expect(seeded.events_created).toBeGreaterThan(0);

    // The demo is entitled (premium tier, not read-only): a mutating request to
    // an edit surface is NOT blocked by the entitlement gate. Updating notes on
    // a client should succeed.
    const clients = await req<ClientsRes>("GET", "/api/planner/clients", undefined, {
      token: session.token,
    });
    expect(clients.status).toBe(200);
    expect(clients.data.clients.length).toBe(4);

    const shrek = clients.data.clients.find((c) => c.display_name === "Shrek & Fiona");
    expect(shrek).toBeDefined();
    if (!shrek) throw new Error("missing Shrek client");
    // Every active client has real rollup data.
    for (const c of clients.data.clients) {
      expect(c.confirmed_guests).toBeGreaterThan(0);
      expect(c.task_summary.total).toBeGreaterThan(0);
    }

    // Entitlement: a client-notes PATCH (an EDIT surface) is allowed.
    const patch = await req(
      "PATCH",
      `/api/planner/clients/${shrek.couple_id}/notes`,
      { notes: "Touched by the demo test." },
      { token: session.token },
    );
    expect(patch.status).toBe(200);
  });

  test("start does NOT consume a real founding slot", async () => {
    const before = plannerFoundingSlotsUsed();
    await startPlannerDemo();
    expect(plannerFoundingSlotsUsed()).toBe(before);
  });

  test("Belle & Adam surfaces as a pending, couple-initiated invite", async () => {
    const { session } = await startPlannerDemo();
    const invites = await req<InvitesRes>("GET", "/api/planner/invites", undefined, {
      token: session.token,
    });
    expect(invites.status).toBe(200);
    expect(invites.data.invites.length).toBe(1);
    expect(invites.data.invites[0]?.display_name).toBe("Belle & Adam");
    expect(invites.data.invites[0]?.status).toBe("pending");
  });

  test("Shrek & Fiona client is a demo couple and is enterable", async () => {
    const { session } = await startPlannerDemo();
    const clients = await req<ClientsRes>("GET", "/api/planner/clients", undefined, {
      token: session.token,
    });
    const shrek = clients.data.clients.find((c) => c.display_name === "Shrek & Fiona");
    if (!shrek) throw new Error("missing Shrek client");

    const row = db.prepare("SELECT is_demo FROM couples WHERE id = ?").get(shrek.couple_id) as {
      is_demo: number;
    };
    expect(row.is_demo).toBe(1);

    const enter = await req(
      "POST",
      `/api/planner/clients/${shrek.couple_id}/enter`,
      {},
      { token: session.token },
    );
    expect(enter.status).toBe(200);
  });

  test("purge (planners first, then couples) removes everything with no FK errors", async () => {
    const foundingBefore = plannerFoundingSlotsUsed();
    const { session } = await startPlannerDemo();
    const plannerId = session.user.id;

    // A demo planner user + its subscription + client links exist.
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM planner_clients WHERE planner_user_id = ?")
          .get(plannerId) as { n: number }
      ).n,
    ).toBe(5); // 4 active + 1 pending
    const demoCouples = (
      db.prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 1").get() as { n: number }
    ).n;
    expect(demoCouples).toBe(5);

    // Age everything past the TTL and sweep: planners BEFORE couples.
    db.prepare("UPDATE users SET created_at = 0 WHERE id = ?").run(plannerId);
    db.prepare("UPDATE couples SET created_at = 0 WHERE is_demo = 1").run();

    const plannersPurged = purgeStalePlannerDemos(0);
    const couplesPurged = purgeStaleDemoCouples(0);
    expect(plannersPurged).toBe(1);
    expect(couplesPurged).toBe(5);

    // Nothing left behind.
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = ?").get(plannerId) as { n: number })
        .n,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM planner_subscriptions WHERE user_id = ?")
          .get(plannerId) as { n: number }
      ).n,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM couples WHERE is_demo = 1").get() as { n: number }).n,
    ).toBe(0);
    // The demo never touched the real founding cohort.
    expect(plannerFoundingSlotsUsed()).toBe(foundingBefore);
  });
});
