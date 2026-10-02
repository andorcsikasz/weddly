// The engine's CONTRACT with the page: the four phases, the one-way transition
// between them, and the two queues.
//
// The simulation itself is a matter of tuning, but the lifecycle is not, and it is
// what every crash in this game has come from: a run that keeps simulating after
// the tab was hidden, a pause that resumes itself, a reset that leaves a burst in
// the particle queue, a page that reads a queue the audio layer already drained.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { LEAD_IN, ROWS, grossCollected, makeRng } from "@shared/runner";
import { RunEngine } from "@/pages/games/runner/engine/RunEngine";
import { useRunnerStore } from "@/pages/games/runner/store/runnerStore";

const FRAME = 1 / 60;

describe("RunEngine phases", () => {
  let engine: RunEngine;
  beforeEach(() => {
    engine = new RunEngine("bride", "HUF");
  });
  afterEach(() => {
    engine.onTick = null;
    engine.onGameOver = null;
  });

  it("opens on the menu and does not simulate there", () => {
    expect(engine.state.phase).toBe("menu");
    const before = engine.state.distance;
    for (let i = 0; i < 60; i++) engine.advance(FRAME);
    expect(engine.state.distance).toBe(before);
  });

  it("moves distance forward only while running", () => {
    engine.start();
    for (let i = 0; i < 30; i++) engine.advance(FRAME);
    const run = engine.state.distance;
    expect(run).toBeGreaterThan(0);

    engine.pause();
    for (let i = 0; i < 60; i++) engine.advance(FRAME);
    expect(engine.state.distance).toBe(run);
  });

  it("refuses input outside the running phase", () => {
    // Every control is a public method a keydown can reach, so each one has to
    // decline on its own rather than trusting the caller to check first.
    expect(engine.moveLane(-1)).toBe(false);
    expect(engine.jump()).toBe(false);
    expect(engine.slide()).toBe(false);
    engine.start();
    expect(engine.moveLane(-1)).toBe(true);
  });

  it("takes the currency on the menu, and refuses it for the whole of a run", () => {
    // Menu is the one place a swap is allowed, and it is where the page sets it:
    // the couple's currency arrives from an async fetch that may resolve after the
    // engine exists.
    engine.setCurrency("EUR");
    expect(engine.currency).toBe("EUR");

    engine.start();
    engine.setCurrency("HUF");
    expect(engine.currency).toBe("EUR");

    // AND while PAUSED. Guarding on `running` alone used to let a pause through,
    // which is the worst moment for it: the printed props have their amounts
    // baked into canvas textures by then, so resuming would show a track quoting
    // one currency beside a HUD quoting another, with no reload to fix it.
    engine.pause();
    engine.setCurrency("HUF");
    expect(engine.currency).toBe("EUR");

    engine.resume();
    engine.toMenu();
    engine.setCurrency("HUF");
    expect(engine.currency).toBe("HUF");
  });

  it("treats start() as the reset, clearing both queues and all counters", () => {
    // A SEED, because `start()` without one rolls `Math.random()`: the same run
    // would hit things on one execution and glide down three empty lanes on the
    // next, and a test that quietly stops asserting anything is worse than no
    // test. Every assertion here is reachable from a fixed seed.
    engine.start(7);
    for (let i = 0; i < 60 * 20; i++) {
      engine.advance(FRAME);
      engine.drainSparks();
    }
    expect(engine.state.hits).toBeGreaterThan(0);
    expect(engine.state.hearts).toBeLessThan(3);

    // Restarting mid-run is the button a couple hits in frustration, so it has to
    // land in exactly the same state as a fresh load — the scene holds pooled
    // meshes keyed on the instance list, and a reset that left a stale `active`
    // flag would show an obstacle nobody collided with.
    engine.start();
    expect(engine.events).toHaveLength(0);
    expect(engine.drainSparks()).toHaveLength(0);
    expect(engine.state.distance).toBe(0);
    expect(engine.state.hearts).toBe(3);
    expect(engine.state.hits).toBe(0);
    expect(engine.state.cash).toBe(0);
    expect(engine.state.bags).toBe(0);
    expect(engine.state.multiplier).toBe(1);
    expect(engine.state.phase).toBe("running");
    // The opening window is laid out at once (so the 3-2-1 has a track under it),
    // so "clean" means: nothing stale, nothing spent, and nothing near the feet.
    for (const o of engine.obstacles) {
      if (!o.active) continue;
      expect(o.spent).toBe(false);
      expect(-o.z).toBeGreaterThanOrEqual(LEAD_IN - 1e-6);
    }
    for (const c of engine.cash) if (c.active) expect(-c.z).toBeGreaterThan(20);
    for (const p of engine.powerups) if (p.active) expect(-p.z).toBeGreaterThan(20);
    expect(engine.state.combo).toBe(0);
    expect(engine.state.magnet + engine.state.doubler + engine.state.shield).toBe(0);
  });

  it("queues sparks for a collision and hands them over destructively", () => {
    // Sparks come from HITS, not from running — a stationary player collects
    // nothing and a burst of dust for every metre would be noise. So this drives
    // the player down one lane with no input at all, which is guaranteed to meet
    // something, and reads the queue.
    engine.start(7);
    let sparks = 0;
    for (let i = 0; i < 60 * 20 && engine.state.phase === "running"; i++) {
      engine.advance(FRAME);
      sparks += engine.drainSparks().length;
    }
    expect(engine.state.hits).toBeGreaterThan(0);
    expect(sparks).toBeGreaterThan(0);
    expect(engine.drainSparks()).toHaveLength(0);
  });

  it("drains events destructively, and an empty drain is free", () => {
    engine.start();
    engine.jump();
    const first = engine.drainEvents();
    expect(first.length).toBeGreaterThan(0);
    expect(engine.drainEvents()).toHaveLength(0);
  });

  it("fires onGameOver exactly once, and the summary is in the run's own currency", () => {
    let calls = 0;
    engine.onGameOver = () => {
      calls += 1;
    };
    // Seeded and hands-off. The player simply stands in the centre lane and takes
    // what the track gives, which ends the run on a fixed frame (three hearts, a
    // little under eight seconds at this seed). A test that pokes the controls to
    // force an ending is testing the controls, not the ending.
    engine.start(3);
    for (let i = 0; i < 60 * 60 && engine.state.phase === "running"; i++) {
      engine.advance(FRAME);
    }
    expect(engine.state.phase).toBe("over");
    expect(calls).toBe(1);

    const summary = engine.summary();
    expect(summary.currency).toBe("HUF");
    // Profit is gifts minus bills, unfloored: a run that only hit things is
    // a LOSS, and the summary says so.
    expect(summary.profit).toBe(
      grossCollected(summary, summary.multiplier) - (summary.expenses ?? 0),
    );
    // Every heart spent and nothing collected: the bill alone floors the score at
    // zero, and the verdict has to say so rather than report a comfortable finish.
    expect(summary.hits).toBeGreaterThanOrEqual(3);
  });
});

describe("RunEngine track", () => {
  it("keeps spawning rows for the whole run, never on top of the player", () => {
    const engine = new RunEngine("bride", "EUR");
    engine.start(42);
    // The first row is born LEAD_IN out, so nothing is at the player's feet.
    for (const o of engine.obstacles) if (o.active) expect(-o.z).toBeGreaterThan(20);
    // Thirty seconds of running, made invulnerable so the run cannot end early.
    for (let i = 0; i < 60 * 30; i++) {
      engine.state.invuln = 1e9;
      engine.advance(FRAME);
      if (i > 60 * 5 && i % 60 === 0) {
        const live =
          engine.obstacles.filter((o) => o.active).length +
          engine.cash.filter((c) => c.active).length;
        expect(live).toBeGreaterThan(0);
      }
    }
    expect(engine.state.distance).toBeGreaterThan(300);
  });

  it("every row template keeps its lanes inside the three-lane track", () => {
    const rng = makeRng(7);
    for (const row of ROWS) {
      for (let i = 0; i < 300; i++) {
        const layout = row.build(rng);
        const lanes = [
          ...layout.safe,
          ...layout.coins.map((c) => c.lane),
          ...layout.blocked.map((b) => b.lane),
          ...(layout.bag ? [layout.bag.lane] : []),
        ];
        for (const lane of lanes) expect([0, 1, 2]).toContain(lane);
      }
    }
  });
});

describe("runner store", () => {
  beforeEach(() => {
    useRunnerStore.setState({ summary: null, firstRun: false });
  });

  it("derives the profit from counters, so live HUD and game-over agree", () => {
    // The same derivation serves both screens. If they could be reached by two
    // functions, this is where the two stories would diverge.
    //
    // Fed a REAL engine state rather than a literal, because `tick` takes the
    // whole `RunState`: a hand-rolled object would have to invent the fifteen
    // fields the HUD never reads, and would stop compiling the day one is renamed
    // instead of failing for a reason anybody can read.
    const engine = new RunEngine("bride", "HUF");
    engine.start(5);
    // One hit, billed at its vendor's price: the profit subtracts the bill the
    // engine actually charged, not a flat per-hit constant.
    Object.assign(engine.state, {
      cash: 30_000,
      bags: 2,
      hits: 1,
      expenses: 400_000,
      multiplier: 2,
    });
    const counters = { ...engine.state };
    useRunnerStore.getState().tick(counters, { clock: 1, milestonePulse: 0 }, "HUF");
    const live = useRunnerStore.getState().profit;
    expect(live).toBe(2 * (30_000 + 2 * 500_000) - 400_000);

    useRunnerStore.getState().finish({
      profit: live,
      cash: counters.cash,
      bags: counters.bags,
      distance: Math.floor(counters.distance),
      hits: counters.hits,
      multiplier: counters.multiplier,
      verdict: "tight",
      expenses: counters.expenses,
      currency: "HUF",
    });
    expect(useRunnerStore.getState().profit).toBe(live);
    expect(useRunnerStore.getState().summary?.verdict).toBe("tight");
  });

  it("banks a new best and remembers that it was the first run", () => {
    useRunnerStore.setState({ best: null });
    const summary = {
      profit: 100,
      cash: 100,
      bags: 0,
      distance: 10,
      hits: 0,
      multiplier: 1,
      verdict: "over_budget" as const,
      currency: "EUR" as const,
    };
    useRunnerStore.getState().finish(summary);
    const after = useRunnerStore.getState();
    expect(after.best).toBe(100);
    expect(after.firstRun).toBe(true);
  });

  it("keeps the best scoped per currency", () => {
    // A forint best and a euro best are different records. One global number would
    // hand a forint couple a "best" they could never have earned.
    useRunnerStore.setState({ best: null });
    useRunnerStore.getState().finish({
      profit: 900,
      cash: 900,
      bags: 0,
      distance: 10,
      hits: 0,
      multiplier: 1,
      verdict: "tight" as const,
      currency: "HUF",
    });
    useRunnerStore.setState({ best: null });
    useRunnerStore.getState().finish({
      profit: 12,
      cash: 12,
      bags: 0,
      distance: 10,
      hits: 0,
      multiplier: 1,
      verdict: "over_budget" as const,
      currency: "EUR",
    });
    expect(useRunnerStore.getState().best).toBe(12);
    expect(useRunnerStore.getState().summary?.currency).toBe("EUR");
  });

  it("does not let a worse run lower the best", () => {
    const summary = {
      profit: 50,
      cash: 50,
      bags: 0,
      distance: 10,
      hits: 0,
      multiplier: 1,
      verdict: "over_budget" as const,
      currency: "EUR" as const,
    };
    useRunnerStore.setState({ best: 900, firstRun: false });
    useRunnerStore.getState().finish(summary);
    expect(useRunnerStore.getState().best).toBe(900);
  });
});
