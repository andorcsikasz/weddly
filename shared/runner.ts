/**
 * "Weddly: Run for the Wedding" — the pure game domain.
 *
 * Sibling module to `shared/quiz.ts` and `shared/markets.ts` under the same
 * "Wēddly Games" umbrella, with the same rule that makes those two safe: EVERY
 * piece of game state that can be derived is derived, and everything in here
 * is a pure function of its arguments with no clock and no database of its own.
 * The engine (`frontend/src/pages/games/runner/engine/RunEngine.ts`) owns the
 * mutable arrays and calls into these; a test can import this file alone and
 * simulate a whole run with no WebGL context in sight.
 *
 * The design rules worth not re-deriving:
 *
 * - THE WORLD NEVER MOVES, THE RUNNER ALWAYS FORWARD. The player is pinned at
 *   z = 0 and obstacles/collectibles travel toward +z. Every distance here is
 *   therefore a *spawn* distance (how far ahead of the player something was
 *   born) and a *travelled* distance, never a position. That is what lets the
 *   camera stay still, the environment stream with a modulo, and the collision
 *   test be a one-dimensional z overlap plus the player's own lane.
 *
 * - DIFFICULTY IS A FUNCTION OF DISTANCE, NOT OF TIME. `runnerSpeedAt` /
 *   `rowGapAt` are pure and monotonic: the same distance always produces the
 *   same speed, so a run is reproducible from its seed. A wave the player
 *   reaches after a stumble is the same wave they would have reached at full
 *   speed, which is what makes the multiplier milestones feel like progress
 *   rather than like an apology for dying.
 *
 * - A ROW IS THE ATOM. Not "spawn obstacles", but "place this template at this
 *   spawn distance". Every template is authored so that exactly one of three
 *   answers (change lane / jump / slide) threads it, and the cash inside a row
 *   is always on the safe path through it. That is the whole tutorial: the
 *   first rows are single-lane and generous, and the three-verb grammar is
 *   taught by the track itself rather than by a modal.
 *
 * - THE FIRST ~25 SECONDS ARE DELIBERATELY BORING. `EASY_UNTIL_DISTANCE` is
 *   where the ramp starts and it is deliberately longer than a player expects:
 *   the game has to be legible before it is hard, and a runner that opens at
 *   full difficulty is a runner nobody finishes.
 *
 * - MONEY IS THE SCORE AND A HIT IS A BILL, AND IT IS THE COUPLE'S OWN
 *   CURRENCY. `RUN_ECONOMY` has a row per currency rather than a scale factor
 *   off an EUR base: a picked round number ("10 000") and a computed one
 *   ("9 736") are different numbers to the person reading the leaderboard, and
 *   the RATIOS between the tiers are what make a score legible. What is
 *   invariant is the shape, and the `runner_economy` test pins it in all twelve
 *   currencies so a new row cannot quietly unbalance the game.
 *
 * - MONEY IS THE SCORE AND A HIT IS A BILL. `RUN_ECONOMY.expensePerHit` is
 *   subtracted from the profit, which is what makes the game-over verdict funny
 *   instead of just numeric: three lifetimes is three chance hits at an
 *   invoice.
 */

import type { Currency } from "./currency";

/** Three lanes, always. Index 0 is the couple's left as they run. */
export const LANE_COUNT = 3 as const;
/** Lane 1 is the centre. */
export const CENTER_LANE = 1 as const;

export type LaneIndex = 0 | 1 | 2;
export type Lanes = readonly LaneIndex[];

/** Which of the three verbs a row is asking for. */
export type ObstacleGate = "jump" | "slide" | "lane";

/**
 * Every wedding-cost obstacle in the game. The `gate` is the WHOLE design of
 * the obstacle: it is the answer the row is asking for, and it is also the
 * collision volume's shape, so the two can never disagree about what clears an
 * object. `footprint` is the lane fraction a blocker takes (a limousine is
 * wider than a florist cart, so clipping its shoulder is survivable).
 */
export interface ObstacleSpec {
  readonly id: ObstacleId;
  readonly gate: ObstacleGate;
  /** Half-extent of the collision box, world units (1 unit ≈ 1 metre). */
  readonly half: { x: number; y: number; z: number };
  /** Bottom of the collision box above the path. A `jump` gate starts at 0. */
  readonly base: number;
  /** How wide the blocker reads in its lane, 0..1 of the lane width. */
  readonly footprint: number;
  /** Rough weight in the row-picker — a limousine is a bigger commitment than
   *  a receipt, and the track should feel like it is escalating. */
  readonly weight: number;
}

export type ObstacleId =
  | "photographer"
  | "videographer"
  | "florist_cart"
  | "dj_booth"
  | "catering_trolley"
  | "cake_trolley"
  | "champagne_tower"
  | "giant_receipt"
  | "limousine"
  | "dress_rack"
  | "makeup_station"
  | "photo_booth"
  | "decor_arch"
  | "chair_stack"
  | "service_fee_sign"
  | "planner_clipboard"
  | "confetti_cannon"
  | "flower_wall"
  | "last_minute_bill";

/**
 * The obstacle catalogue. Collision boxes are authored against
 * `constants/tuning.ts`'s player hitbox (1.7 standing / 0.8 sliding, ±0.4
 * wide, ±0.34 deep), so:
 *   - `jump` gates top out at 0.72 — below the sliding ceiling's 0.8, which
 *     means a player who jumps a moment early still clears them, and one who
 *     misreads them as a slide does not.
 *   - `slide` gates start at 1.02 — above the standing head at 1.7? No: below
 *     it, so standing is always a hit, and above the slide's 0.8 with 0.22 of
 *     air to spare.
 *   - `lane` gates are full height, so no jump or slide threads them. They are
 *     the only rows that force a decision rather than a reflex.
 */
export const OBSTACLES: Readonly<Record<ObstacleId, ObstacleSpec>> = {
  photographer: {
    id: "photographer",
    gate: "jump",
    half: { x: 0.4, y: 0.36, z: 0.4 },
    base: 0,
    footprint: 0.8,
    weight: 1,
  },
  videographer: {
    id: "videographer",
    gate: "slide",
    half: { x: 0.44, y: 0.72, z: 0.42 },
    base: 1.02,
    footprint: 0.85,
    weight: 1.1,
  },
  dj_booth: {
    id: "dj_booth",
    gate: "lane",
    half: { x: 0.52, y: 1.1, z: 0.44 },
    base: 0,
    footprint: 1,
    weight: 1.35,
  },
  florist_cart: {
    id: "florist_cart",
    gate: "jump",
    half: { x: 0.46, y: 0.34, z: 0.5 },
    base: 0,
    footprint: 0.9,
    weight: 1,
  },
  catering_trolley: {
    id: "catering_trolley",
    gate: "slide",
    half: { x: 0.46, y: 0.7, z: 0.46 },
    base: 1.05,
    footprint: 0.9,
    weight: 1.1,
  },
  cake_trolley: {
    id: "cake_trolley",
    gate: "jump",
    half: { x: 0.42, y: 0.4, z: 0.44 },
    base: 0,
    footprint: 0.82,
    weight: 1.2,
  },
  champagne_tower: {
    id: "champagne_tower",
    gate: "slide",
    half: { x: 0.4, y: 0.66, z: 0.4 },
    base: 1.0,
    footprint: 0.8,
    weight: 1,
  },
  giant_receipt: {
    id: "giant_receipt",
    gate: "lane",
    half: { x: 0.42, y: 1.1, z: 0.2 },
    base: 0,
    footprint: 0.78,
    weight: 0.9,
  },
  limousine: {
    id: "limousine",
    gate: "lane",
    half: { x: 0.55, y: 0.75, z: 1.5 },
    base: 0,
    footprint: 1.08,
    weight: 1.6,
  },
  dress_rack: {
    id: "dress_rack",
    gate: "lane",
    half: { x: 0.5, y: 1.2, z: 0.3 },
    base: 0,
    footprint: 0.95,
    weight: 1.2,
  },
  makeup_station: {
    id: "makeup_station",
    gate: "lane",
    half: { x: 0.46, y: 1.05, z: 0.36 },
    base: 0,
    footprint: 0.9,
    weight: 1.1,
  },
  photo_booth: {
    id: "photo_booth",
    gate: "lane",
    half: { x: 0.5, y: 1.15, z: 0.42 },
    base: 0,
    footprint: 0.95,
    weight: 1.3,
  },
  decor_arch: {
    id: "decor_arch",
    gate: "lane",
    half: { x: 0.52, y: 1.25, z: 0.18 },
    base: 0,
    footprint: 1,
    weight: 1.4,
  },
  chair_stack: {
    id: "chair_stack",
    gate: "jump",
    half: { x: 0.44, y: 0.35, z: 0.44 },
    base: 0,
    footprint: 0.86,
    weight: 0.9,
  },
  service_fee_sign: {
    id: "service_fee_sign",
    gate: "lane",
    half: { x: 0.48, y: 1.3, z: 0.16 },
    base: 0,
    footprint: 0.92,
    weight: 1.3,
  },
  planner_clipboard: {
    id: "planner_clipboard",
    gate: "slide",
    half: { x: 0.42, y: 0.6, z: 0.34 },
    base: 1.0,
    footprint: 0.8,
    weight: 0.8,
  },
  confetti_cannon: {
    id: "confetti_cannon",
    gate: "jump",
    half: { x: 0.38, y: 0.34, z: 0.36 },
    base: 0,
    footprint: 0.74,
    weight: 1,
  },
  flower_wall: {
    id: "flower_wall",
    gate: "lane",
    half: { x: 0.54, y: 1.15, z: 0.22 },
    base: 0,
    footprint: 1,
    weight: 1.5,
  },
  last_minute_bill: {
    id: "last_minute_bill",
    gate: "lane",
    half: { x: 0.5, y: 1.35, z: 0.14 },
    base: 0,
    footprint: 0.94,
    weight: 1.5,
  },
};

/** Every obstacle id, in catalogue order. */
export const OBSTACLE_IDS = Object.keys(OBSTACLES) as readonly ObstacleId[];

const byWeight = (id: ObstacleId) => OBSTACLES[id].weight;

/** `jump`-gated ids — what the row-picker draws from for a low row. */
const JUMP_IDS = OBSTACLE_IDS.filter((id) => OBSTACLES[id].gate === "jump");
/** `slide`-gated ids. */
const SLIDE_IDS = OBSTACLE_IDS.filter((id) => OBSTACLES[id].gate === "slide");
/** `lane`-gated ids — full-height, so only a lane change threads them. */
const LANE_IDS = OBSTACLE_IDS.filter((id) => OBSTACLES[id].gate === "lane");

export const OBSTACLES_BY_GATE = {
  jump: JUMP_IDS,
  slide: SLIDE_IDS,
  lane: LANE_IDS,
} as const;

/** Which obstacles a row of a given verb is allowed to use. */
export type ObstacleTier = "early" | "mid" | "late";

/**
 * A row template: the authored answer to one decision, plus the cash sitting
 * on the safe path through it. `blocked` lists the lanes carrying a cost;
 * `safe` is the lane the cash arc runs down. `verb` is what the row is teaching
 * — a row with a `jump` verb ALWAYS puts at least one `jump`-gated obstacle
 * somewhere on the path so the answer is never ambiguous.
 */
export interface RowTemplate {
  readonly id: RowId;
  /** The verb this row teaches, or `null` for a pure cash row. */
  readonly verb: ObstacleGate | null;
  /** First spawn distance (metres) at which this row may be drawn. */
  readonly from: number;
  /** Relative draw weight. */
  readonly weight: number;
  build(rng: Rng): RowLayout;
}

export type RowId =
  | "open_cash"
  | "single_jump"
  | "single_slide"
  | "single_lane"
  | "double_low"
  | "double_high"
  | "gate_pair"
  | "gate_lane"
  | "full_low"
  | "full_high"
  | "cash_arc"
  | "bag_alley"
  | "stagger";

export interface RowLayout {
  readonly blocked: readonly { lane: LaneIndex; id: ObstacleId }[];
  /** Lanes that are clear. Empty means the row is a pure cash reward. */
  readonly safe: Lanes;
  /** Cash placed along the safe path, in metres above the path. */
  readonly coins: readonly { lane: LaneIndex; height: number }[];
  /** A tote bag on the safe path, or none. */
  readonly bag: { lane: LaneIndex; height: number } | null;
}

/** Mulberry32 — tiny, fast, seedable. The whole run's shape is a function of
 *  one 32-bit seed, so a test can replay a failure exactly. */
export interface Rng {
  (): number;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, items: readonly T[]): T => {
  const chosen = items[Math.floor(rng() * items.length)];
  if (chosen === undefined) throw new Error("runner: pick() from an empty list");
  return chosen;
};

/** Weighted pick that degrades gracefully on a zero/negative weight. */
function pickWeighted(rng: Rng, items: readonly ObstacleId[]): ObstacleId {
  let total = 0;
  for (const id of items) total += byWeight(id);
  let roll = rng() * total;
  for (const id of items) {
    roll -= byWeight(id);
    if (roll <= 0) return id;
  }
  const last = items[items.length - 1];
  if (last === undefined) throw new Error("runner: pickWeighted() from an empty list");
  return last;
}

/** The two lanes either side of `lane`, in a stable order. */
function sidesOf(lane: LaneIndex): [LaneIndex, LaneIndex] {
  const left = ((lane + 2) % 3) as LaneIndex;
  const right = ((lane + 1) % 3) as LaneIndex;
  return [left, right];
}

/** A short arc of coins over `lane` — rewards the jump it usually sits on. */
function arcOver(lane: LaneIndex, count: number, peak: number): RowLayout["coins"] {
  const out: { lane: LaneIndex; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 1 : i / (count - 1);
    out.push({ lane, height: Number((peak * Math.sin(t * Math.PI)).toFixed(3)) });
  }
  return out;
}

/** A flat line of coins down `lane` — rewards a slide or a lane change. */
function lineDown(lane: LaneIndex, count: number, height: number): RowLayout["coins"] {
  return Array.from({ length: count }, () => ({ lane, height }));
}

/** The lanes a row leaves open. Single source so `safe` can never disagree
 *  with `blocked` — the two are the same decision written twice, and the
 *  cash is placed on whichever this returns. */
function clearLanes(...blocked: readonly LaneIndex[]): Lanes {
  return ([0, 1, 2] as const).filter((l) => !blocked.includes(l));
}

const OTHER = (rng: Rng, lane: LaneIndex): LaneIndex => pick(rng, sidesOf(lane));

/** A random lane. The `noUncheckedIndexedAccess` dance here is deliberate and
 *  is the reason every lane cast in this file goes through ONE function: an
 *  unrounded `rng() * 3` would happily return 2.999999 and index off the end
 *  of a three-lane game. */
const ANY_LANE = (rng: Rng): LaneIndex => {
  const n = Math.floor(rng() * 3);
  return (n < 0 ? 0 : n > 2 ? 2 : n) as LaneIndex;
};

/**
 * The row catalogue. Read the `from` column as the ramp: nothing that needs
 * two verbs appears before the player has met both, and nothing needs two
 * until 260 m — past the 25-second easy window, which is roughly where a
 * competent first run reaches.
 */
export const ROWS: readonly RowTemplate[] = [
  {
    id: "open_cash",
    verb: null,
    from: 0,
    weight: 1.4,
    build: (rng) => {
      const lane = ANY_LANE(rng);
      return { blocked: [], safe: [0, 1, 2], coins: lineDown(lane, 4, 0.9), bag: null };
    },
  },
  {
    id: "cash_arc",
    verb: null,
    from: 0,
    weight: 1.1,
    build: (rng) => {
      const lane = ANY_LANE(rng);
      return {
        blocked: [],
        safe: [0, 1, 2],
        coins: arcOver(lane, 5, 1.05),
        bag: rng() < 0.12 ? { lane, height: 1.15 } : null,
      };
    },
  },
  {
    id: "single_jump",
    verb: "jump",
    from: 0,
    weight: 1.6,
    build: (rng) => {
      // Usually straight ahead in the lane the player is most likely running
      // (the centre), sometimes in a flank — the row still has exactly one
      // answer either way, because a `jump` gate can only be jumped.
      const blockedLane = rng() < 0.62 ? CENTER_LANE : ANY_LANE(rng);
      const clear = OTHER(rng, blockedLane);
      return {
        blocked: [{ lane: blockedLane, id: pickWeighted(rng, JUMP_IDS) }],
        safe: clearLanes(blockedLane),
        // The coin sits on the arc the player is already passing through after
        // the jump, at a height they collect without aiming for it. Reward for
        // the correct verb, never a second thing to solve at the same time.
        coins: [{ lane: clear, height: 0.95 }],
        bag: null,
      };
    },
  },
  {
    id: "single_slide",
    verb: "slide",
    from: 0,
    weight: 1.4,
    build: (rng) => {
      const blockedLane = rng() < 0.62 ? CENTER_LANE : ANY_LANE(rng);
      const clear = OTHER(rng, blockedLane);
      return {
        blocked: [{ lane: blockedLane, id: pickWeighted(rng, SLIDE_IDS) }],
        safe: clearLanes(blockedLane),
        coins: [{ lane: clear, height: 0.42 }],
        bag: null,
      };
    },
  },
  {
    id: "single_lane",
    verb: "lane",
    from: 90,
    weight: 1.3,
    build: (rng) => {
      const lane = ANY_LANE(rng);
      const blockedLane = lane === CENTER_LANE ? pick(rng, sidesOf(CENTER_LANE)) : lane;
      const clear = (2 - blockedLane) as LaneIndex;
      return {
        blocked: [{ lane: blockedLane, id: pickWeighted(rng, LANE_IDS) }],
        safe: [clear],
        coins: lineDown(clear, 3, 0.85),
        bag: null,
      };
    },
  },
  {
    id: "double_low",
    verb: "jump",
    from: 150,
    weight: 1,
    build: (rng) => {
      const lane = ANY_LANE(rng);
      const [left, right] = sidesOf(lane);
      return {
        blocked: [
          { lane: left, id: pickWeighted(rng, JUMP_IDS) },
          { lane: right, id: pickWeighted(rng, JUMP_IDS) },
        ],
        safe: [lane],
        coins: arcOver(lane, 5, 1.1),
        bag: rng() < 0.1 ? { lane, height: 1.2 } : null,
      };
    },
  },
  {
    id: "double_high",
    verb: "slide",
    from: 150,
    weight: 1,
    build: (rng) => {
      const lane = ANY_LANE(rng);
      const [left, right] = sidesOf(lane);
      return {
        blocked: [
          { lane: left, id: pickWeighted(rng, SLIDE_IDS) },
          { lane: right, id: pickWeighted(rng, SLIDE_IDS) },
        ],
        safe: [lane],
        coins: lineDown(lane, 4, 0.44),
        bag: null,
      };
    },
  },
  {
    id: "gate_pair",
    verb: "lane",
    from: 260,
    weight: 1.2,
    build: (rng) => {
      // Two full-height blockers, one lane open. The clearest possible "you
      // must move" — introduced once `single_lane` is routine.
      const clear = ANY_LANE(rng);
      const [left, right] = sidesOf(clear);
      return {
        blocked: [
          { lane: left, id: pickWeighted(rng, LANE_IDS) },
          { lane: right, id: pickWeighted(rng, LANE_IDS) },
        ],
        safe: [clear],
        coins: lineDown(clear, 4, 0.9),
        bag: rng() < 0.16 ? { lane: clear, height: 1.0 } : null,
      };
    },
  },
  {
    id: "gate_lane",
    verb: "lane",
    from: 420,
    weight: 1,
    build: (rng) => {
      const clear = ANY_LANE(rng);
      const [left, right] = sidesOf(clear);
      return {
        // A wide blocker and a narrow one side by side — the asymmetry is the
        // point. `single_lane` teaches "move"; this teaches "the expensive one
        // takes two lanes of attention".
        blocked: [
          { lane: left, id: pickWeighted(rng, LANE_IDS) },
          { lane: right, id: pickWeighted(rng, LANE_IDS) },
        ],
        safe: [clear],
        coins: arcOver(clear, 5, 1.15),
        bag: rng() < 0.2 ? { lane: clear, height: 1.2 } : null,
      };
    },
  },
  {
    id: "full_low",
    verb: "jump",
    from: 520,
    weight: 0.9,
    build: (rng) => ({
      // All three lanes blocked by low costs: no lane change threads this, only
      // a jump does. The first row where the two answers are not interchangeable.
      blocked: [
        { lane: 0, id: pickWeighted(rng, JUMP_IDS) },
        { lane: 1, id: pickWeighted(rng, JUMP_IDS) },
        { lane: 2, id: pickWeighted(rng, JUMP_IDS) },
      ],
      safe: [1],
      coins: arcOver(1, 6, 1.25),
      bag: rng() < 0.14 ? { lane: 1, height: 1.3 } : null,
    }),
  },
  {
    id: "full_high",
    verb: "slide",
    from: 640,
    weight: 0.85,
    build: (rng) => ({
      blocked: [
        { lane: 0, id: pickWeighted(rng, SLIDE_IDS) },
        { lane: 1, id: pickWeighted(rng, SLIDE_IDS) },
        { lane: 2, id: pickWeighted(rng, SLIDE_IDS) },
      ],
      safe: [1],
      coins: lineDown(1, 5, 0.4),
      bag: rng() < 0.12 ? { lane: 1, height: 0.4 } : null,
    }),
  },
  {
    id: "bag_alley",
    verb: "lane",
    from: 700,
    weight: 0.75,
    build: (rng) => {
      const clear = ANY_LANE(rng);
      const [left, right] = sidesOf(clear);
      return {
        blocked: [
          { lane: left, id: pickWeighted(rng, LANE_IDS) },
          { lane: right, id: pickWeighted(rng, LANE_IDS) },
        ],
        safe: [clear],
        // No coins at all. A row that is only a bag teaches the player that the
        // big prize sometimes costs a detour — which is the actual joke.
        coins: [],
        bag: { lane: clear, height: 1.0 },
      };
    },
  },
  {
    id: "stagger",
    verb: "jump",
    from: 900,
    weight: 0.8,
    build: (rng) => {
      // The mixed row: a `slide` cost in one flank and a `jump` cost in the
      // lane next to it, with the coin trail threading both heights. The player
      // who has internalised the two reflexes gets both; the player who has
      // only been guessing stops and reads the track. Gated at 900 m because
      // it is the first row that can be *unreadable*, not merely hard.
      const jumpLane = CENTER_LANE;
      const slideLane = OTHER(rng, jumpLane);
      const clear = (3 - jumpLane - slideLane) as LaneIndex;
      return {
        blocked: [
          { lane: slideLane, id: pickWeighted(rng, SLIDE_IDS) },
          { lane: jumpLane, id: pickWeighted(rng, JUMP_IDS) },
        ],
        safe: [clear],
        coins: [
          { lane: clear, height: 0.44 },
          { lane: clear, height: 1.05 },
        ],
        bag: null,
      };
    },
  },
] as const;

/** Distance at which the ramp starts. Roughly the first 25 seconds. */
export const EASY_UNTIL_DISTANCE = 220;

/** Metres of spawn window ahead of the player. Rows are born here and arrive
 *  after `SPAWN_AHEAD / speed` seconds, which is the player's reaction budget:
 *  never less than ~1.6 s even at top speed. */
export const SPAWN_AHEAD = 82;
/** Rows are retired this far behind the camera. */
export const DESPAWN_BEHIND = 16;

/** Starting and top forward speed, world units (= metres) per second. */
export const SPEED_START = 11.5;
export const SPEED_MAX = 27;
/** Speed gained per metre travelled. */
export const SPEED_PER_METRE = 0.0042;

/** Metres between consecutive rows: 34 early (a row every ~3 s), 15 late. */
export const ROW_GAP_EASY = 34;
export const ROW_GAP_TIGHT = 15;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** How far along the ramp a distance is, in 0..1. The ramp starts AFTER
 *  `EASY_UNTIL_DISTANCE`, so the opening is flat rather than merely gentle. */
export function rampAt(distance: number): number {
  return clamp01((distance - EASY_UNTIL_DISTANCE) / 1400);
}

/** Forward speed at a travelled distance. Monotonic and pure — the same
 *  distance always gives the same speed, which is what makes a seeded run
 *  replayable and the milestones meaningful. */
export function runnerSpeedAt(distance: number): number {
  return SPEED_START + (SPEED_MAX - SPEED_START) * rampAt(distance);
}

/** Metres of clear track between one row and the next. Tightens with the ramp. */
export function rowGapAt(distance: number): number {
  const t = rampAt(distance);
  // A touch of easing so the first tightening is noticeable but the last few
  // rows do not arrive as a cliff.
  const eased = t * t * (3 - 2 * t);
  return ROW_GAP_EASY + (ROW_GAP_TIGHT - ROW_GAP_EASY) * eased;
}

/** A guaranteed-clear run-in: the first rows are spaced out and the player is
 *  never asked for anything in the first `LEAD_IN` metres. */
export const LEAD_IN = 46;

/** A score multiplier milestone: metres travelled at which `multiplier` starts. */
export interface Milestone {
  readonly at: number;
  readonly multiplier: number;
}

/** The ladder. Every step is a felt reward, and the gaps grow because the
 *  score per metre is rising with the speed at the same time. */
export const MILESTONES: readonly Milestone[] = [
  { at: 0, multiplier: 1 },
  { at: 260, multiplier: 2 },
  { at: 620, multiplier: 3 },
  { at: 1150, multiplier: 4 },
  { at: 1900, multiplier: 5 },
  { at: 2900, multiplier: 6 },
  { at: 4200, multiplier: 7 },
  { at: 5900, multiplier: 8 },
];

/** The multiplier in force at a travelled distance. Derived, never stored, so a
 *  mid-run difficulty change can never disagree with the number on the HUD. */
export function multiplierAt(distance: number): number {
  let value = 1;
  for (const step of MILESTONES) if (distance >= step.at) value = step.multiplier;
  return value;
}

/** The next milestone ahead of `distance`, or null at the top of the ladder. */
export function nextMilestoneAt(distance: number): Milestone | null {
  for (const step of MILESTONES) if (distance < step.at) return step;
  return null;
}

/* ── Collectibles ───────────────────────────────────────────────────────── */

/** Cash tiers. The VALUE is currency-dependent and lives in `RUN_ECONOMY`
 *  below; a tier here is only its identity and how often it is drawn. What is
 *  fixed is that every value is Wedding Profit BEFORE the multiplier, so the
 *  same coin is worth more later in a run — which is what makes the speed ramp
 *  feel like a reward rather than a punishment. */
export interface CashTier {
  readonly id: CashId;
  /** Spawn weight in a cash arc. */
  readonly weight: number;
}

export type CashId = "coin" | "bundle" | "envelope";

export const CASH_TIERS: readonly CashTier[] = [
  { id: "coin", weight: 5 },
  { id: "bundle", weight: 2.4 },
  { id: "envelope", weight: 1 },
];

export const CASH_BY_ID: Readonly<Record<CashId, CashTier>> = {
  coin: CASH_TIERS[0] as CashTier,
  bundle: CASH_TIERS[1] as CashTier,
  envelope: CASH_TIERS[2] as CashTier,
};

/** Tote bags are rarer than they look: `BAG_CHANCE` is the per-coin chance of
 *  upgrading that coin to a bag, applied only to a row that has declared a bag
 *  slot, so the rarity is a property of the track rather than of luck. */
export const BAG_CHANCE = 0.55;

/** How many hearts a run starts with. Three, and every one of them is a
 *  wedding cost — see `RUN_ECONOMY.expensePerHit`. */
export const START_HEARTS = 3;

/** Seconds of invulnerability after a hit, so one obstacle cannot take two
 *  hearts and a long limousine cannot be hit twice for the same invoice. */
export const INVULN_SECONDS = 1.15;

/** The slowing-down-on-a-hit feedback. Short, so it reads as a stumble rather
 *  than as a penalty you have to wait out. */
export const HIT_SLOWMO = 0.55;
export const HIT_SLOWMO_FACTOR = 0.42;

/* ── Economy ────────────────────────────────────────────────────────────── */

/**
 * Every money figure the game can show, for ONE currency, in whole units.
 *
 * The game runs in the couple's own currency, so this table has a row for every
 * currency `CURRENCIES` lists and the score is the number that couple would
 * recognise: a HUF run reads "10 000" per coin, a EUR run "10". Deriving one
 * from the other at runtime (a scale factor off an EUR base) is exactly the
 * mistake the repo rule about money warns about — a picked round number and a
 * computed one are not the same thing once a locale groups it differently, and
 * the ratios between the tiers are what make the score legible, not the value
 * of any single row.
 *
 * What IS invariant across currencies, and what `runner_economy` asserts, is the
 * shape: coin : bundle : envelope : bag : expense = 1 : 2 : 5 : 50 : 40, and
 * `tight` at 40× a full coin arc. That is what keeps "I hit three things" from
 * meaning something different in Zagreb and in Budapest.
 */
export interface CurrencyEconomy {
  /** Raw cash in one coin / bundle / envelope, before the multiplier. */
  readonly coin: number;
  readonly bundle: number;
  readonly envelope: number;
  /** One Weddly tote bag, before the multiplier. */
  readonly bag: number;
  /** What one collision costs the wedding. The number that turns the game from
   *  a score chase into a joke: the leaderboard is a budget, and the hearts are
   *  the budget's slack. */
  readonly expensePerHit: number;
  /** Below `tight` a run reads as "over budget", below `comfortable` as
   *  "tight", at or above it as "under budget". */
  readonly tight: number;
  readonly comfortable: number;
}

const ECONOMY_SHAPE = {
  coin: 10,
  bundle: 20,
  envelope: 50,
  bag: 500,
  expensePerHit: 400,
  tight: 15_000,
  comfortable: 60_000,
} as const satisfies CurrencyEconomy;

/** The per-currency economy. Adding a currency to `CURRENCIES` means adding
 *  exactly one row here, and the compile error that follows is the point. */
export const RUN_ECONOMY: Readonly<Record<Currency, CurrencyEconomy>> = {
  EUR: ECONOMY_SHAPE,
  HUF: {
    coin: 10_000,
    bundle: 20_000,
    envelope: 50_000,
    bag: 500_000,
    expensePerHit: 400_000,
    tight: 15_000_000,
    comfortable: 60_000_000,
  },
  USD: ECONOMY_SHAPE,
  GBP: ECONOMY_SHAPE,
  CHF: ECONOMY_SHAPE,
  PLN: {
    coin: 100,
    bundle: 200,
    envelope: 500,
    bag: 5_000,
    expensePerHit: 4_000,
    tight: 150_000,
    comfortable: 600_000,
  },
  CZK: {
    coin: 500,
    bundle: 1_000,
    envelope: 2_500,
    bag: 25_000,
    expensePerHit: 20_000,
    tight: 750_000,
    comfortable: 3_000_000,
  },
  SEK: {
    coin: 100,
    bundle: 200,
    envelope: 500,
    bag: 5_000,
    expensePerHit: 4_000,
    tight: 150_000,
    comfortable: 600_000,
  },
  NOK: {
    coin: 100,
    bundle: 200,
    envelope: 500,
    bag: 5_000,
    expensePerHit: 4_000,
    tight: 150_000,
    comfortable: 600_000,
  },
  DKK: {
    coin: 100,
    bundle: 200,
    envelope: 500,
    bag: 5_000,
    expensePerHit: 4_000,
    tight: 150_000,
    comfortable: 600_000,
  },
  RON: {
    coin: 100,
    bundle: 200,
    envelope: 500,
    bag: 5_000,
    expensePerHit: 4_000,
    tight: 150_000,
    comfortable: 600_000,
  },
  JPY: {
    coin: 1_000,
    bundle: 2_000,
    envelope: 5_000,
    bag: 50_000,
    expensePerHit: 40_000,
    tight: 1_500_000,
    comfortable: 6_000_000,
  },
};

/** The economy for one currency. Every money path goes through here rather
 *  than reading a module constant, so "the score is in the couple's currency"
 *  is a single lookup and cannot be half-applied. */
export function economyFor(currency: Currency): CurrencyEconomy {
  return RUN_ECONOMY[currency];
}

export interface RunEconomy {
  /** Raw cash picked up, before any multiplier, in `currency` units. */
  readonly cash: number;
  readonly bags: number;
  /** Total hits taken this run. */
  readonly hits: number;
  /** Which currency `cash` is denominated in. Carried on the figure itself
   *  rather than passed alongside it, so a summary can never be rendered with
   *  the wrong symbol. */
  readonly currency: Currency;
}

/** The bill so far. Derived from `hits` and the couple's own expense per hit
 *  rather than accumulated by the engine, which is why the engine has no way
 *  to disagree with the number the game-over card prints. */
export function expensesFor(e: Pick<RunEconomy, "hits" | "currency">): number {
  return e.hits * economyFor(e.currency).expensePerHit;
}

/** The score multiplier applied to a raw cash figure. The one place a
 *  collected amount becomes a profit contribution, so a change to the
 *  multiplier can never be applied twice or not at all. */
export function cashValue(rawCash: number, multiplier: number): number {
  return rawCash * multiplier;
}

/** Bags for a bag count, with the multiplier applied. */
export function bagValue(bags: number, multiplier: number, currency: Currency): number {
  return bags * economyFor(currency).bag * multiplier;
}

/**
 * THE SCORE. Gross income minus the bill, floored at zero so the leaderboard
 * can never be improved by hitting things. A run that collects 400 000 and
 * takes three hits has made 200 000 — which is the joke: the vendors are
 * expensive too.
 */
export function weddingProfit(e: RunEconomy, multiplier: number): number {
  const gross = grossCollected(e, multiplier);
  return Math.max(0, gross - expensesFor(e));
}

/** Total collected before the bill — what the HUD calls "cash collected". */
export function grossCollected(e: RunEconomy, multiplier: number): number {
  return cashValue(e.cash, multiplier) + bagValue(e.bags, multiplier, e.currency);
}

/** Raw cash carried by a single collectible of a tier, in `currency` units. */
export function coinValue(id: CashId, currency: Currency): number {
  return economyFor(currency)[id];
}

/** One collection, whatever tier it was: the amount a pickup event carries.
 *  A `bag` slot collects a TOTE, not an envelope, which is why a bag row pays
 *  `bag` and every other slot pays its own tier. */
export function pickupValue(tier: CashId | "bag", currency: Currency): number {
  return tier === "bag" ? economyFor(currency).bag : economyFor(currency)[tier];
}

/* ── Verdict copy ───────────────────────────────────────────────────────── */

/** Which financial outcome a run achieved. Derived from the profit alone, so
 *  the verdict can never contradict the number above it. */
export type Verdict = "under_budget" | "tight" | "over_budget" | "bankrupt";

/**
 * Profit thresholds in the couple's own currency. `tight` is the band a first
 * run lands in and is deliberately wide — it is the band that says "you did
 * fine, which nobody ever does at a wedding".
 */
export function verdictThresholds(currency: Currency): { tight: number; comfortable: number } {
  const row = economyFor(currency);
  return { tight: row.tight, comfortable: row.comfortable };
}

export function verdictFor(profit: number, currency: Currency): Verdict {
  if (profit <= 0) return "bankrupt";
  const band = economyFor(currency);
  if (profit < band.tight) return "over_budget";
  if (profit < band.comfortable) return "tight";
  return "under_budget";
}

/** The i18n key suffix for a verdict's headline and its second line. */
export const VERDICT_I18N: Readonly<Record<Verdict, { title: string; body: string }>> = {
  under_budget: { title: "runner.verdict_under_title", body: "runner.verdict_under_body" },
  tight: { title: "runner.verdict_tight_title", body: "runner.verdict_tight_body" },
  over_budget: { title: "runner.verdict_over_title", body: "runner.verdict_over_body" },
  bankrupt: { title: "runner.verdict_bankrupt_title", body: "runner.verdict_bankrupt_body" },
};

/* ── Player physics ─────────────────────────────────────────────────────── */

/** Lane centres in world x. 1.7 m apart: wide enough that a lane change reads
 *  as a move and narrow enough that three of them fit a garden path without
 *  looking like a motorway. */
export const LANE_WIDTH = 1.7;

export function laneX(lane: LaneIndex): number {
  return (lane - CENTER_LANE) * LANE_WIDTH;
}

/** Standing / sliding hitbox half-heights. The sliding box is what a
 *  `slide`-gated obstacle is authored against. */
export const PLAYER = {
  standHalfY: 0.85,
  slideHalfY: 0.4,
  halfX: 0.4,
  halfZ: 0.34,
  /** Forgiveness applied to BOTH sides of every overlap test, in metres. It is
   *  the difference between a runner people enjoy and a runner they quit: a
   *  glancing blow on a limousine mirror reads as a hit to a physics test and
   *  as a near miss to a person. */
  forgive: 0.11,
} as const;

/** Jump arc. Apex ≈ 1.0 m clears every `jump` gate (0.72) with margin, and the
 *  0.6 s hang time at top speed is ~13 m of track — short enough that the jump
 *  feels snappy rather than floaty. */
export const JUMP = {
  velocity: 6.7,
  gravity: 22,
} as const;

/** Apex height in metres, DERIVED from `JUMP` rather than written down again.
 *  The rig normalises the player's height by this to build its tuck, so a second
 *  number here would be a second answer to "how high does the jump go" — and the
 *  two would drift the first time somebody tuned the gravity for feel. */
export const JUMP_APEX = (JUMP.velocity * JUMP.velocity) / (2 * JUMP.gravity);

/** Slide length and the grace window after it ends during which a new slide is
 *  refused, so a panic-tap cannot chain into a permanent prone state. */
export const SLIDE = {
  seconds: 0.62,
  cooldown: 0.16,
} as const;

/** Seconds a lane change takes to visually settle. Snappy, but not instant —
 *  an instant lane change reads as teleporting, which is exactly the wrong
 *  feeling in a game about momentum. */
export const LANE_SETTLE = 0.13;

/** How a row's spawn is turned into concrete entities. Kept here so the row
 *  catalogue and the placement rules cannot drift: the pattern builder knows
 *  nothing about lanes-in-world-units, and the engine knows nothing about
 *  patterns. */
export interface SpawnedRow {
  readonly template: RowId;
  /** Metres AHEAD of the player at which the row was born. */
  readonly spawn: number;
  readonly layout: RowLayout;
}

/**
 * Weighted pick over the rows that have UNLOCKED at `distance`, with the
 * weights re-normalised so unlocking a new row dilutes the old ones instead of
 * adding to them. A run's shape is therefore a pure function of its seed and
 * the distance it has reached — replayable, testable, and impossible for the
 * track to quietly get denser than the difficulty curve says it is.
 */
export function pickRow(rng: Rng, distance: number): RowTemplate {
  const unlocked = ROWS.filter((row) => distance >= row.from);
  const pool: readonly RowTemplate[] = unlocked.length > 0 ? unlocked : [ROWS[0] as RowTemplate];
  let total = 0;
  for (const row of pool) total += row.weight;
  let roll = rng() * total;
  for (const row of pool) {
    roll -= row.weight;
    if (roll <= 0) return row;
  }
  return pool[pool.length - 1] as RowTemplate;
}

/**
 * The next spawn, given where the last one landed. `gapOverride` is what the
 * engine uses to slip in the deliberate breathing room after a milestone or a
 * multi-row sequence; it is a parameter rather than a hidden rule so the whole
 * placement policy is legible in one function.
 */
export function nextSpawn(previousSpawn: number, distance: number, gapOverride?: number): number {
  if (previousSpawn <= 0) return LEAD_IN;
  const gap = gapOverride ?? rowGapAt(distance);
  // Always at least a little further on, so a pathological gap can never make
  // the generator retry the same distance forever.
  return previousSpawn + Math.max(10, gap);
}

/** Cash tier for the nth coin in an arc: the first and last of a run are
 *  small change and the middle is where the money is, so a committed line
 *  through an arc is worth more than tapping its edges. */
export function cashTierFor(rng: Rng, index: number, total: number): CashId {
  const edge = total <= 1 ? 0 : Math.min(index, total - 1 - index);
  const bias = edge === 0 ? 0 : 1;
  let total2 = 0;
  for (const tier of CASH_TIERS)
    total2 += tier.weight * (tier.id === "coin" ? 1 : 0.35 + bias * 0.65);
  let roll = rng() * total2;
  for (const tier of CASH_TIERS) {
    roll -= tier.weight * (tier.id === "coin" ? 1 : 0.35 + bias * 0.65);
    if (roll <= 0) return tier.id;
  }
  return "coin";
}
