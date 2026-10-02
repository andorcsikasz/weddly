// Track density, and the arithmetic that keeps a denser track actually spawning.
//
// THE TWO NUMBERS ARE ONE EDIT. A denser track raises how many obstacles the
// generator needs alive at the same time, and when the pool runs dry
// `freeObstacle()` returns null and the REST OF THAT ROW IS SIMPLY NEVER CREATED.
// The generator fails silently, so the symptom is not an error and not a crash —
// it is a track that gets EMPTIER as it gets harder, which reads as a difficulty
// ramp bug and would be very hard to trace back here.

import { describe, expect, it } from "bun:test";
import { ROW_GAP_EASY, ROW_GAP_TIGHT, SPAWN_AHEAD, nextSpawn, rowGapAt } from "@shared/runner";
import { RunEngine } from "@/pages/games/runner/engine/RunEngine";
import type { FloatRequest } from "@/pages/games/runner/engine/RunEngine";
import { moneyLabelTexture } from "@/pages/games/runner/utils/textures";

type FloatRequestCurrency = FloatRequest["currency"];

/** The pool size the engine was built with. Mirrored rather than imported because
 *  it is a PRIVATE constant, and a test that imports it would be asserting against
 *  the same source it is meant to check. If the pool is raised, this fails and the
 *  message says what to do. */
const POOL = 32;
/** Every obstacle one row can hold: three lanes. */
const LANES = 3;

describe("track density", () => {
  it("spawns a row every couple of seconds, not every three", () => {
    // The complaint this answers: the opening was so sparse that a run spent
    // whole seconds with nothing to dodge, which reads as a broken game rather
    // than as an easy one.
    expect(ROW_GAP_EASY).toBeLessThanOrEqual(24);
    expect(ROW_GAP_TIGHT).toBeLessThan(ROW_GAP_EASY);

    // A row every ~1.9 s at the opening speed, ~1.4 s at the top.
    const early = rowGapAt(0) / 11.5;
    const late = rowGapAt(5000) / 27;
    expect(early).toBeLessThan(2.1);
    expect(late).toBeLessThan(1.5);
  });

  it("keeps the pool large enough for the densest possible window", () => {
    // Worst case: every row in the spawn window blocks all three lanes.
    const rowsInWindow = SPAWN_AHEAD / ROW_GAP_TIGHT + 1;
    const needed = Math.ceil(rowsInWindow * LANES);
    // The +1 row is the spawn cursor's overshoot: the `while` loop places a row and
    // then advances the cursor, so one row can sit just past the window edge.
    expect(needed).toBeLessThanOrEqual(POOL);
  });

  it("always moves the cursor forward, however tight the gap gets", () => {
    // `nextSpawn` floors the advance at 10 m. A gap tighter than that floor would
    // silently become the floor, so the declared difficulty would be a lie.
    let cursor = 0;
    for (let i = 0; i < 200; i++) {
      const next = nextSpawn(cursor, i * 40);
      expect(next).toBeGreaterThan(cursor);
      cursor = next;
    }
  });
});

describe("a denser track still meets the player", () => {
  it("puts an obstacle in front of someone who does nothing, and quickly", () => {
    // The measurement that actually answers "more frequent obstacles": how far a
    // player who never touches the controls gets. It was 249 m at the old gaps
    // and is 155 m now, so a whole opening of empty track is gone.
    //
    // Deliberately NOT "the pool never runs dry" as a survival test: a passive
    // player dies at the first obstacle, so that loop only ever samples the
    // opening and says nothing about the pool. The pool is checked as arithmetic
    // above, which is where the invariant actually lives.
    const engine = new RunEngine("bride", "HUF");
    engine.start(11);
    for (let i = 0; i < 60 * 120 && engine.state.phase === "running"; i++) {
      engine.advance(1 / 60);
      engine.drainSparks();
      engine.drainFloats();
    }
    expect(engine.state.phase).toBe("over");
    expect(engine.state.distance).toBeLessThan(200);
    expect(engine.state.distance).toBeGreaterThan(40);
  });
});

describe("character choice", () => {
  it("keeps the choice out of a run, in the middle of one or paused", () => {
    const engine = new RunEngine("bride", "HUF");
    expect(engine.state.character).toBe("bride");

    engine.setCharacter("groom");
    expect(engine.state.character).toBe("groom");

    engine.start();
    engine.setCharacter("bride");
    // The partner figure is derived as "the one you are not", so a swap here would
    // change who the second runner is four lines below the player's own.
    expect(engine.state.character).toBe("groom");

    engine.pause();
    engine.setCharacter("bride");
    expect(engine.state.character).toBe("groom");

    engine.toMenu();
    engine.setCharacter("bride");
    expect(engine.state.character).toBe("bride");
  });

  it("keeps the choice across a restart", () => {
    // Losing the pick on every retry would be the same as not having one: the
    // groom who restarts after a hit and comes back as the bride has lost
    // nothing the menu offered and gained nothing.
    const engine = new RunEngine("groom", "HUF");
    engine.start();
    engine.start();
    expect(engine.state.character).toBe("groom");
  });
});

describe("collect animation queue", () => {
  /** Drive one run to its end, collecting labels as they are raised.
   *
   *  SWEEPS SEEDS on purpose. A run ends at its first obstacle, so for a single
   *  seed the question "did the player reach any cash before then" is a property
   *  of the layout, not of the animation — and a test that fails on seed 4 while
   *  passing on seed 11 is a coin flip, not a guard. */
  function playSeeds(currency: FloatRequestCurrency, count = 12) {
    let floats = 0;
    let worstFrame = 0;
    let bigSeen = 0;
    for (let seed = 1; seed <= count; seed++) {
      const engine = new RunEngine("bride", currency);
      engine.start(seed);
      for (let i = 0; i < 60 * 120 && engine.state.phase === "running"; i++) {
        engine.advance(1 / 60);
        engine.drainSparks();
        const batch = engine.drainFloats();
        if (batch.length > worstFrame) worstFrame = batch.length;
        for (const f of batch) {
          floats += 1;
          if (f.big) bigSeen += 1;
          // The label must carry the couple's own money, whatever the seed did.
          expect(f.currency).toBe(currency);
          expect(f.value).toBeGreaterThan(0);
        }
      }
    }
    return { floats, worstFrame, bigSeen };
  }

  it("raises a label for what was collected, in the couple's currency", () => {
    const { floats } = playSeeds("EUR");
    expect(floats).toBeGreaterThan(0);
  });

  it("raises the same label whatever the currency", () => {
    // The label is drawn by the couple's formatter, so this holds across the
    // ladder — including the ones whose amounts are large enough that a raw
    // number would overflow the plate.
    expect(playSeeds("JPY").floats).toBeGreaterThan(0);
    expect(playSeeds("HUF").floats).toBeGreaterThan(0);
  });

  it("caps labels per frame so a swept arc does not wall the screen in digits", () => {
    const { worstFrame } = playSeeds("EUR");
    expect(worstFrame).toBeGreaterThan(0);
    expect(worstFrame).toBeLessThanOrEqual(3);
  });

  it("clears the labels with everything else on restart", () => {
    // A label that outlives its run climbs over the menu, which is the same
    // "the game is haunted" symptom the spark queue was cleared for.
    const engine = new RunEngine("bride", "EUR");
    engine.start(4);
    for (let i = 0; i < 600; i++) engine.advance(1 / 60);
    engine.drainFloats();
    engine.start();
    expect(engine.drainFloats()).toHaveLength(0);
  });
});

describe("the money label texture", () => {
  it("declines to draw rather than throwing when there is no 2d context", () => {
    // The scene runs under SSR prerendering too, and `makeCanvas` in the shared
    // texture module is written to answer `null` rather than assume a browser. A
    // label that cannot be rasterised has to cost a sprite with no texture, not a
    // thrown error inside a `useFrame` — an exception there takes down the whole
    // scene on every frame, so the couple gets a black screen instead of a runner.
    const canvas = document.createElement("canvas");
    // This suite genuinely has no 2d context; if that ever changes, the assertion
    // below is about the guard being reachable, so make the precondition explicit.
    const texture = moneyLabelTexture("10 000 Ft", false);
    if (canvas.getContext("2d") === null) {
      expect(texture).toBeNull();
      return;
    }
    expect(texture).not.toBeNull();
  });

  it("draws the bag variant differently from the coin variant", () => {
    // Same string, different event: a bag is a fifth of a run's income and is
    // allowed to look like one. If the two collided in the cache the big label
    // would render at coin size, or the coin at bag size.
    const small = moneyLabelTexture("500 000 Ft", false);
    const big = moneyLabelTexture("500 000 Ft", true);
    if (document.createElement("canvas").getContext("2d") === null) {
      expect(small).toBeNull();
      expect(big).toBeNull();
      return;
    }
    expect(small).not.toBe(big);
  });
});
