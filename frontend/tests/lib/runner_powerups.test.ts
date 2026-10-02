// Power-ups, streaks, the countdown and the charging limousine.
//
// Each test places the one entity it is about by hand, right in front of the
// runner, rather than hunting a seed that happens to spawn it: the spawned track
// starts LEAD_IN metres out, so for the first second nothing the generator made
// can reach the player and the hand-placed entity is the only thing in play.

import { describe, expect, it } from "bun:test";
import {
  CHARGE_SPEED,
  CHARGE_TRIGGER,
  OBSTACLE_COST,
  OBSTACLE_IDS,
  hitCost,
  POWERUP_SECONDS,
  RUN_ECONOMY,
  isStreakStep,
  streakBonus,
} from "@shared/runner";
import { RunEngine } from "@/pages/games/runner/engine/RunEngine";

const FRAME = 1 / 60;

function fresh(seed = 1) {
  const engine = new RunEngine("bride", "EUR");
  engine.start(seed);
  return engine;
}

/** Put a coin in a lane, `ahead` metres out, at chest height. */
function placeCoin(engine: RunEngine, x: number, ahead: number) {
  const slot = engine.cash.find((c) => !c.active);
  if (!slot) throw new Error("cash pool exhausted in a test");
  slot.tier = "coin";
  slot.x = x;
  slot.y = 0.9;
  slot.z = -ahead;
  slot.active = true;
  return slot;
}

describe("double cash", () => {
  it("pays every pickup twice while it lasts, and once after", () => {
    const engine = fresh();
    engine.state.doubler = POWERUP_SECONDS.double;
    placeCoin(engine, 0, 0.1);
    engine.advance(FRAME);
    expect(engine.state.cash).toBe(RUN_ECONOMY.EUR.coin * 2);

    engine.state.doubler = 0;
    placeCoin(engine, 0, 0.1);
    engine.advance(FRAME);
    expect(engine.state.cash).toBe(RUN_ECONOMY.EUR.coin * 3);
  });
});

describe("magnet", () => {
  it("pulls a coin in from another lane", () => {
    const engine = fresh();
    engine.state.magnet = POWERUP_SECONDS.magnet;
    const coin = placeCoin(engine, 1.7, 6);
    for (let i = 0; i < 60 && coin.active; i++) engine.advance(FRAME);
    expect(coin.active).toBe(false);
    expect(engine.state.cash).toBeGreaterThan(0);
  });

  it("leaves a coin in another lane alone without it", () => {
    const engine = fresh();
    const coin = placeCoin(engine, 1.7, 6);
    for (let i = 0; i < 60; i++) engine.advance(FRAME);
    expect(engine.state.cash).toBe(0);
    // Ran past the runner untouched, still in its own lane.
    expect(coin.x).toBe(1.7);
  });
});

describe("shield", () => {
  it("takes a hit whole: no heart, no bill, and it is gone afterwards", () => {
    const engine = fresh();
    engine.state.shield = POWERUP_SECONDS.shield;
    const slot = engine.obstacles.find((o) => !o.active)!;
    slot.id = "dj_booth";
    slot.lane = 1;
    slot.x = 0;
    slot.z = -0.2;
    slot.spent = false;
    slot.charge = false;
    slot.charging = false;
    slot.active = true;
    engine.advance(FRAME);
    const events = engine.drainEvents();
    expect(engine.state.hearts).toBe(3);
    expect(engine.state.hits).toBe(0);
    expect(engine.state.shield).toBe(0);
    expect(events.some((e) => e.type === "shield_break")).toBe(true);
    expect(events.some((e) => e.type === "expense")).toBe(false);
  });
});

describe("streak", () => {
  it("pays a bonus on the step, into raw cash, and breaks on a hit", () => {
    const engine = fresh();
    for (let i = 0; i < 10; i++) {
      placeCoin(engine, 0, 0.1);
      engine.advance(FRAME);
    }
    expect(engine.state.combo).toBe(10);
    expect(isStreakStep(10)).toBe(true);
    expect(engine.state.cash).toBe(RUN_ECONOMY.EUR.coin * 10 + streakBonus(10, "EUR"));
    expect(engine.drainEvents().some((e) => e.type === "streak" && e.count === 10)).toBe(true);
    expect(engine.state.bestCombo).toBe(10);
    expect(engine.summary().bestCombo).toBe(10);
  });

  it("lapses when nothing is collected for a while", () => {
    const engine = fresh();
    placeCoin(engine, 0, 0.1);
    engine.advance(FRAME);
    expect(engine.state.combo).toBe(1);
    for (let i = 0; i < 60 * 3; i++) {
      engine.state.invuln = 10;
      engine.advance(FRAME);
    }
    expect(engine.state.combo).toBe(0);
    expect(engine.state.bestCombo).toBe(1);
  });
});

describe("countdown", () => {
  it("holds the runner on the line, refuses input, then lets go", () => {
    const engine = new RunEngine("bride", "EUR");
    engine.start(3, 3);
    expect(engine.moveLane(1)).toBe(false);
    expect(engine.jump()).toBe(false);
    for (let i = 0; i < 60 * 2.9; i++) engine.advance(FRAME);
    expect(engine.state.distance).toBe(0);
    const beeps = engine.drainEvents().filter((e) => e.type === "countdown");
    expect(beeps.map((e) => (e.type === "countdown" ? e.n : -1))).toEqual([2, 1]);

    for (let i = 0; i < 30; i++) engine.advance(FRAME);
    expect(engine.state.countdown).toBe(0);
    expect(engine.state.distance).toBeGreaterThan(0);
    expect(engine.moveLane(1)).toBe(true);
  });

  it("lays the opening track out under the countdown, not at go", () => {
    const engine = new RunEngine("bride", "EUR");
    engine.start(3, 3);
    expect(engine.obstacles.some((o) => o.active) || engine.cash.some((c) => c.active)).toBe(true);
  });
});

describe("charging obstacle", () => {
  it("is parked until the trigger distance, then closes faster than the track", () => {
    const engine = fresh();
    const slot = engine.obstacles.find((o) => !o.active)!;
    slot.id = "limousine";
    slot.lane = 2;
    slot.x = 1.7;
    slot.z = -(CHARGE_TRIGGER + 6);
    slot.spent = false;
    slot.charge = true;
    slot.charging = false;
    slot.active = true;

    engine.advance(FRAME);
    expect(slot.charging).toBe(false);

    for (let i = 0; i < 60 && !slot.charging; i++) engine.advance(FRAME);
    expect(slot.charging).toBe(true);
    expect(engine.drainEvents().some((e) => e.type === "charge")).toBe(true);

    const before = slot.z;
    const ran = engine.state.distance;
    engine.advance(FRAME);
    const travelled = engine.state.distance - ran;
    expect(slot.z - before).toBeCloseTo(travelled + CHARGE_SPEED * FRAME, 3);
  });
});

describe("hit pricing", () => {
  it("prices a hit by its vendor and the couple's own budget, and the toast gets it", () => {
    const engine = new RunEngine("bride", "HUF");
    engine.setBudget(8_000_000);
    engine.start(1);
    const slot = engine.obstacles.find((o) => !o.active)!;
    Object.assign(slot, {
      id: "cake_trolley",
      lane: 1,
      x: 0,
      z: -0.2,
      spent: false,
      charge: false,
      charging: false,
      active: true,
    });
    engine.advance(FRAME);
    const expected = hitCost("cake_trolley", "HUF", 8_000_000);
    // 8 M × 3% × half the line = 120 000 Ft: the example the owner asked for.
    expect(expected).toBe(120_000);
    expect(engine.state.expenses).toBe(expected);
    expect(engine.state.lastHit).toEqual({ id: "cake_trolley", amount: expected, n: 1 });
    expect(engine.summary().expenses).toBe(expected);
  });

  it("charges a catering trolley far more than a nail polish bottle", () => {
    expect(hitCost("catering_trolley", "EUR", 25_000)).toBeGreaterThan(
      hitCost("nail_polish", "EUR", 25_000),
    );
  });

  it("keeps every hit inside a playable band, however big or small the budget", () => {
    const flat = RUN_ECONOMY.HUF.expensePerHit;
    for (const budget of [null, 1, 500_000_000]) {
      for (const id of ["nail_polish", "catering_trolley"] as const) {
        const cost = hitCost(id, "HUF", budget);
        expect(cost).toBeGreaterThanOrEqual(flat * 0.25 * 0.95);
        expect(cost).toBeLessThanOrEqual(flat * 3 * 1.05);
      }
    }
  });

  it("names a real directory category for every obstacle", () => {
    for (const id of OBSTACLE_IDS) expect(OBSTACLE_COST[id].category.length).toBeGreaterThan(0);
  });

  it("ignores a budget change mid-run", () => {
    const engine = new RunEngine("bride", "EUR");
    engine.setBudget(20_000);
    engine.start(1);
    engine.setBudget(1_000_000);
    expect(engine.budget).toBe(20_000);
  });
});

describe("balloon flight", () => {
  it("lifts the runner over every obstacle, lays a sky trail, and lands safely", () => {
    const engine = new RunEngine("bride", "EUR");
    engine.start(2);
    engine.state.fly = 6;
    for (let i = 0; i < 60; i++) engine.advance(FRAME);
    expect(engine.state.y).toBeGreaterThan(2.5);
    expect(engine.jump()).toBe(false);
    // A wall right on top of the runner does nothing while airborne on balloons.
    const slot = engine.obstacles.find((o) => !o.active)!;
    Object.assign(slot, {
      id: "dj_booth",
      lane: 1,
      x: 0,
      z: -0.2,
      spent: false,
      charge: false,
      charging: false,
      active: true,
    });
    engine.advance(FRAME);
    expect(engine.state.hits).toBe(0);
    expect(engine.cash.some((c) => c.active && c.y > 3)).toBe(true);
    for (let i = 0; i < 60 * 7; i++) {
      engine.advance(FRAME);
      if (engine.state.fly === 0 && engine.state.invuln > 0)
        engine.state.invuln = Math.max(engine.state.invuln, 0.5);
    }
    expect(engine.state.fly).toBe(0);
    expect(engine.state.y).toBeLessThan(0.05);
  });
});

describe("gift box", () => {
  it("opens into a surprise and reports it for the toast", () => {
    const engine = new RunEngine("bride", "EUR");
    engine.start(4);
    const p = engine.powerups.find((x) => !x.active)!;
    Object.assign(p, { kind: "gift", x: 0, y: 0.95, z: -0.1, active: true });
    engine.advance(FRAME);
    expect(engine.state.lastGift?.n).toBe(1);
    expect(engine.drainEvents().some((e) => e.type === "gift")).toBe(true);
  });
});
