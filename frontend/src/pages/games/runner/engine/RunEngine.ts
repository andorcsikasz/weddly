/**
 * The simulation. No React, no three.js, no DOM.
 *
 * Everything that decides a run lives here: the player's lane/jump/slide state,
 * the spawn cursor, the pooled obstacle and collectible arrays, collision, and
 * the score. The renderer reads `engine.state` every frame and drains
 * `engine.events`; it never writes back. That one-way rule is what keeps the
 * game fair (the difficulty curve cannot be altered by frame rate or by which
 * device you are on) and it is what lets the whole thing be unit-tested without
 * a WebGL context.
 *
 * COORDINATES. The runner is pinned at world z = 0 forever. Everything else
 * travels toward +z at the run speed, so an obstacle's `z` runs from a large
 * negative spawn value up past the camera. "Distance ahead of the player" is
 * therefore just `-z`, and no entity ever needs to be told the player's
 * position.
 *
 * FIXED STEP. `advance()` accumulates real time and steps the sim at a fixed
 * 1/120 s, capped at a dozen substeps so a background tab cannot come back and
 * tunnel the player through a limousine. A variable step would make collision
 * reliability a function of the monitor's refresh rate, which is exactly the
 * kind of bug that only reproduces on someone else's laptop.
 */

import {
  BAG_CHANCE,
  DESPAWN_BEHIND,
  economyFor,
  HIT_SLOWMO,
  HIT_SLOWMO_FACTOR,
  INVULN_SECONDS,
  JUMP,
  LANE_SETTLE,
  LANE_WIDTH,
  OBSTACLES,
  OBSTACLE_IDS,
  PLAYER,
  SLIDE,
  SPAWN_AHEAD,
  START_HEARTS,
  cashTierFor,
  coinValue,
  laneX,
  makeRng,
  multiplierAt,
  nextMilestoneAt,
  LEAD_IN,
  nextSpawn,
  pickRow,
  runnerSpeedAt,
  verdictFor,
  weddingProfit,
} from "@shared/runner";
import type { CashId, LaneIndex, ObstacleId, RowLayout, Rng, Verdict } from "@shared/runner";
import type { Currency } from "@shared/types";

/** Which of the couple the player is. Purely cosmetic — both share one physics
 *  body on purpose, so neither is "better". */
export type RunnerCharacter = "bride" | "groom";

export type RunPhase = "menu" | "running" | "paused" | "over";

/** Simulation substep, seconds. 120 Hz is comfortably finer than any collision
 *  box in the catalogue and costs nothing measurable. */
const STEP = 1 / 120;
/** Longest real frame the accumulator will honour (≈ 4 substeps at 30 fps). */
const MAX_SUBSTEPS = 12;

/** Obstacle pool size. Sized from the spawn window rather than guessed: at the
 *  tightest row gap there are at most `SPAWN_AHEAD / ROW_GAP_TIGHT` ≈ 5 rows
 *  alive, and the densest row blocks all three lanes, so 18 leaves real
 *  headroom without keeping dead objects alive. */
const OBSTACLE_POOL = 18;
/** Cash is instanced, so the pool is just memory and a loop bound. */
const CASH_POOL = 120;
const BAG_POOL = 8;

/** Nominal player height, standing. The catalogue in `shared/runner.ts` is
 *  authored against this and against `SLIDE`'s 0.8 — both live here as the
 *  single source. */
const STAND_HEIGHT = 1.7;
const SLIDE_HEIGHT = 0.8;

export interface ObstacleInstance {
  /** Stable across the object's whole life; React keys on it. */
  readonly key: number;
  id: ObstacleId;
  lane: LaneIndex;
  x: number;
  z: number;
  active: boolean;
  /** Set once this obstacle has taken a heart, so one limousine is one bill. */
  spent: boolean;
}

export interface CashInstance {
  x: number;
  y: number;
  z: number;
  tier: CashId;
  active: boolean;
  /** Per-coin spin phase, so a row of coins shimmers rather than pulsing in
   *  lockstep. */
  phase: number;
}

export interface BagInstance {
  x: number;
  y: number;
  z: number;
  active: boolean;
  phase: number;
}

export type RunEvent =
  | { type: "coin"; x: number; y: number; z: number; tier: CashId; value: number }
  | { type: "bag"; x: number; y: number; z: number; value: number }
  | { type: "jump" }
  | { type: "land" }
  | { type: "slide" }
  | { type: "lane"; lane: LaneIndex }
  | { type: "hit"; x: number; y: number; z: number; obstacle: ObstacleId }
  | { type: "expense"; amount: number }
  | { type: "milestone"; multiplier: number }
  | { type: "gameover"; summary: RunSummary };

/** Why a burst of particles exists. The engine picks the reason and the position;
 *  the particle system owns what the reason LOOKS like. */
export type SparkKind = "coin" | "cost" | "dust" | "confetti";

export interface SparkRequest {
  kind: SparkKind;
  x: number;
  y: number;
  z: number;
}

/** Handed back by `drainSparks` when nothing is queued, so the common frame
 *  allocates nothing at all. */
const EMPTY_EVENTS: readonly RunEvent[] = Object.freeze([]);
const EMPTY_SPARKS: readonly SparkRequest[] = Object.freeze([]);

/** Ceiling on requests queued in one frame. A whole row of cash collected at
 *  once would otherwise ask for one burst per coin, which is a frame-budget
 *  problem dressed as a correctness one. */
/* THE CAP IS PER `advance()` CALL, NOT PER QUEUE.
 *
 * `advance()` is the frame boundary for the simulation: the fixed-step loop inside
 * it runs zero or more steps and the scene drains once afterwards. So the batch is
 * cleared at the TOP of `advance()` and that is what makes the cap mean what it
 * says — otherwise a queue nobody drained (a test with no `<Particles>` mounted, a
 * scene whose loop is not running) would hit the ceiling and then emit NOTHING for
 * the rest of the run. A late burst is a cosmetic flaw; a particle system that
 * goes permanently quiet because a queue filled up once is a broken game. */
const MAX_SPARKS_PER_ADVANCE = 6;

export interface RunSummary {
  profit: number;
  cash: number;
  bags: number;
  distance: number;
  hits: number;
  multiplier: number;
  verdict: Verdict;
  /** Which currency every figure above is denominated in. Carried on the
   *  summary itself so the game-over card renders one symbol for one number
   *  set and cannot label a EUR profit with a Ft glyph. */
  currency: Currency;
}

export interface RunState {
  phase: RunPhase;
  character: RunnerCharacter;
  /** Metres travelled. The only source of difficulty and of milestones. */
  distance: number;
  /** Current forward speed, including the post-hit stumble. */
  speed: number;
  /** Speed the difficulty curve asks for right now — what the speedometer
   *  and the camera FOV read, so the stumble is visible but the track does not
   *  slow down under the player. */
  cruiseSpeed: number;
  lane: LaneIndex;
  /** Smoothed world x. Chases `laneX(lane)`; the gap between the two is the
   *  player's visual lean. */
  x: number;
  /** Feet height above the path. */
  y: number;
  vy: number;
  airborne: boolean;
  sliding: boolean;
  /** Seconds of slide LEFT, not a boolean. The rig needs the remaining length to
   *  build a 0 → 1 pose blend, and a boolean would give it a step: the runner
   *  would snap into the slide and snap back out. */
  slideTime: number;
  hearts: number;
  invuln: number;
  /** Seconds of stumble remaining. */
  slowmo: number;
  /** 1 → 0, drives the screen flash. */
  hitFlash: number;
  /** 1 → 0, drives the camera shake. */
  shake: number;
  multiplier: number;
  /** Raw cash before the multiplier. */
  cash: number;
  bags: number;
  hits: number;
  /** Metres until the next multiplier step, or null at the top of the ladder. */
  toNextMilestone: number | null;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Exponential smoothing factor for a given time constant. Framerate
 *  independent, unlike a bare `x += (target - x) * 0.2`. */
const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

export class RunEngine {
  readonly obstacles: ObstacleInstance[] = [];
  readonly cash: CashInstance[] = [];
  readonly bags: BagInstance[] = [];
  events: RunEvent[] = [];
  readonly state: RunState;

  /** Seed of the run in progress. A run is fully reproducible from it. */
  seed = 1;

  private rng: Rng = makeRng(1);
  private accum = 0;
  private spawnCursor = 0;
  private slideCooldown = 0;
  private coyote = 0;
  private jumpBuffer = 0;
  private key = 1;
  /** Wall-clock seconds since the run started; drives the run cycle, the camera
   *  and the partner's idle animation. Public because THREE separate rigs read
   *  it every frame and a `getAnimationClock()` accessor over a private field
   *  would be the same number wearing a disguise. Cosmetic only: nothing that
   *  decides an outcome may read it. */
  clock = 0;
  /** Rises to 1 when a milestone lands and decays — the HUD's "×3!" pop. */
  private milestonePulse = 0;

  /** Fired ~12×/s with the numbers the HUD shows. Set by the page. */
  onTick: ((state: RunState, extra: TickExtras) => void) | null = null;

  /** Fired ONCE, the instant the last heart goes. Set by the page. Not an
   *  `events` entry — see the note where it is fired. */
  onGameOver: ((summary: RunSummary) => void) | null = null;
  private tickAccum = 0;

  /** Which currency the whole run is scored in. Set from the couple's own
   *  workspace before the first frame; the engine reads it through
   *  `economyFor` at the moment a figure is produced, never from a constant,
   *  so switching it mid-menu cannot leave a coin worth the old currency's
   *  number. A currency change mid-RUN is refused — see `setCurrency`. */
  currency: Currency = "HUF";

  constructor(character: RunnerCharacter = "bride", currency: Currency = "HUF") {
    this.currency = currency;
    this.state = {
      phase: "menu",
      character,
      distance: 0,
      speed: 0,
      cruiseSpeed: 0,
      lane: 1,
      x: 0,
      y: 0,
      vy: 0,
      airborne: false,
      sliding: false,
      slideTime: 0,
      hearts: START_HEARTS,
      invuln: 0,
      slowmo: 0,
      hitFlash: 0,
      shake: 0,
      multiplier: 1,
      cash: 0,
      bags: 0,
      hits: 0,
      toNextMilestone: 0,
    };
    for (let i = 0; i < OBSTACLE_POOL; i++) {
      this.obstacles.push({
        key: this.key++,
        id: "photographer",
        lane: 1,
        x: 0,
        z: 0,
        active: false,
        spent: false,
      });
    }
    for (let i = 0; i < CASH_POOL; i++) {
      this.cash.push({ x: 0, y: 0, z: 0, tier: "coin", active: false, phase: i * 0.37 });
    }
    for (let i = 0; i < BAG_POOL; i++) {
      this.bags.push({ x: 0, y: 0, z: 0, active: false, phase: i * 1.1 });
    }
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  start(seed?: number) {
    const s = this.state;
    s.phase = "running";
    s.distance = 0;
    s.speed = 0;
    s.cruiseSpeed = 0;
    s.lane = 1;
    s.x = 0;
    s.y = 0;
    s.vy = 0;
    s.airborne = false;
    s.sliding = false;
    s.slideTime = 0;
    s.hearts = START_HEARTS;
    s.invuln = 0;
    s.slowmo = 0;
    s.hitFlash = 0;
    s.shake = 0;
    s.multiplier = 1;
    s.cash = 0;
    s.bags = 0;
    s.hits = 0;
    s.toNextMilestone = null;

    for (const o of this.obstacles) o.active = false;
    for (const c of this.cash) c.active = false;
    for (const b of this.bags) b.active = false;
    // Both queues are cleared, not just the events. An undrained spark from the
    // last frame of the previous run would otherwise fire as confetti over a menu
    // that is still fading out, which is the sort of thing that gets filed as "the
    // game is haunted" and is impossible to reproduce afterwards.
    this.events.length = 0;
    this.sparks = [];
    this.accum = 0;
    this.tickAccum = 0;
    this.clock = 0;
    s.slideTime = 0;
    this.slideCooldown = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.milestonePulse = 0;

    this.seed = seed ?? (Math.random() * 0xffffffff) >>> 0;
    this.rng = makeRng(this.seed);
    // The first row lands LEAD_IN metres out, never on top of the player.
    this.spawnCursor = LEAD_IN;
  }

  pause() {
    if (this.state.phase === "running") this.state.phase = "paused";
  }

  resume() {
    if (this.state.phase === "paused") this.state.phase = "running";
  }

  toMenu() {
    this.state.phase = "menu";
  }

  /* ── Input ──────────────────────────────────────────────────────────── */

  moveLane(direction: -1 | 1): boolean {
    const s = this.state;
    if (s.phase !== "running") return false;
    const next = clamp(s.lane + direction, 0, 2) as LaneIndex;
    if (next === s.lane) return false;
    s.lane = next;
    // A lane change cancels a slide: ducking into a side step is how runners
    // feel mushy, and the two verbs are never needed on the same row.
    s.slideTime = 0;
    s.sliding = false;
    this.events.push({ type: "lane", lane: next });
    return true;
  }

  jump(): boolean {
    const s = this.state;
    if (s.phase !== "running") return false;
    // Coyote time covers the handful of frames between leaving the ground and
    // the jump landing, which is the classic "I pressed jump and nothing
    // happened" complaint. The buffer does the same for a press that arrives
    // a few frames early.
    if (!s.airborne || this.coyote > 0) {
      this.doJump();
      return true;
    }
    this.jumpBuffer = 0.13;
    return false;
  }

  private doJump() {
    const s = this.state;
    s.vy = JUMP.velocity;
    s.airborne = true;
    s.sliding = false;
    s.slideTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.events.push({ type: "jump" });
  }

  slide(): boolean {
    const s = this.state;
    if (s.phase !== "running") return false;
    // No sliding in mid-air: the one place a runner's controls usually betray
    // you is a duck that eats a jump, and ducking in the air does nothing
    // useful here anyway.
    if (s.airborne) return false;
    if (this.slideCooldown > 0) return false;
    s.sliding = true;
    s.slideTime = SLIDE.seconds;
    this.events.push({ type: "slide" });
    return true;
  }

  /* ── The loop ───────────────────────────────────────────────────────── */

  /** Advance by real elapsed seconds. Fixed substeps, capped. */
  advance(realDt: number) {
    const s = this.state;
    // The frame boundary for the spark batch — see MAX_SPARKS_PER_ADVANCE. It is
    // cleared on EVERY call, including the paused one, so a burst queued by the
    // final tick of a run cannot survive into the game-over card.
    this.sparks = [];
    if (s.phase !== "running") {
      // Still tick the UI at the menu/pause/over screens so the HUD mirror and
      // the character's idle pose keep breathing, but never simulate.
      this.clock += realDt;
      this.pump(realDt);
      return;
    }
    this.clock += realDt;
    this.accum += Math.min(realDt, MAX_SUBSTEPS * STEP);
    let steps = 0;
    while (this.accum >= STEP && steps < MAX_SUBSTEPS) {
      this.step(STEP);
      this.accum -= STEP;
      steps++;
    }
    if (steps === MAX_SUBSTEPS) this.accum = 0;
    this.pump(realDt);
  }

  private pump(realDt: number) {
    this.tickAccum += realDt;
    if (this.onTick && this.tickAccum >= 1 / 12) {
      this.tickAccum = 0;
      this.onTick(this.state, {
        clock: this.clock,
        milestonePulse: this.milestonePulse,
      });
    }
    this.milestonePulse = Math.max(0, this.milestonePulse - realDt * 1.8);
  }

  private step(dt: number) {
    const s = this.state;

    /* Timers. */
    if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
    if (s.hitFlash > 0) s.hitFlash = Math.max(0, s.hitFlash - dt * 2.6);
    if (s.shake > 0) s.shake = Math.max(0, s.shake - dt * 2.2);
    if (this.slideCooldown > 0) this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (this.coyote > 0) this.coyote = Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    /* Slide. Runs to its full length even if the key is long gone — an early
     * cancel is how a slide becomes a twitch. */
    if (s.slideTime > 0) {
      s.slideTime -= dt;
      if (s.slideTime <= 0) {
        s.slideTime = 0;
        s.sliding = false;
        this.slideCooldown = SLIDE.cooldown;
      }
    }

    /* Speed: the curve's number, dipped by the stumble. */
    s.cruiseSpeed = runnerSpeedAt(s.distance);
    if (s.slowmo > 0) {
      s.slowmo = Math.max(0, s.slowmo - dt);
      // Ease back in over the last third of the stumble rather than snapping,
      // so the recovery feels like the runner gathering pace.
      const k = s.slowmo / HIT_SLOWMO;
      const dip = HIT_SLOWMO_FACTOR + (1 - HIT_SLOWMO_FACTOR) * (1 - ease(1 - k, 0.25));
      s.speed = s.cruiseSpeed * dip;
    } else {
      s.speed = s.cruiseSpeed;
    }

    const travel = s.speed * dt;
    s.distance += travel;

    /* Milestones, before the HUD can show a multiplier that has not applied. */
    const multiplier = multiplierAt(s.distance);
    if (multiplier > s.multiplier) {
      s.multiplier = multiplier;
      this.milestonePulse = 1;
      this.events.push({ type: "milestone", multiplier });
      // Confetti is the milestone's own visual vocabulary, which is why the game
      // over fires none: a burst has to MEAN something.
      this.spark("confetti", s.x, 1.5, 0);
    }
    const step = nextMilestoneAt(s.distance);
    s.toNextMilestone = step ? Math.max(0, step.at - s.distance) : null;

    /* Player body. */
    const targetX = laneX(s.lane);
    s.x += (targetX - s.x) * ease(dt, LANE_SETTLE * 0.42);

    if (s.airborne) {
      s.vy -= JUMP.gravity * dt;
      s.y += s.vy * dt;
      if (s.y <= 0) {
        s.y = 0;
        s.vy = 0;
        s.airborne = false;
        this.coyote = 0.09;
        this.events.push({ type: "land" });
        if (this.jumpBuffer > 0) this.doJump();
      }
    }

    /* Track. The cursor is metres AHEAD of the player, so it closes by exactly
     * what the player just ran; without this it never re-enters the spawn
     * window and the track goes empty after the first handful of rows. */
    this.spawnCursor -= travel;
    this.spawn();
    for (const o of this.obstacles) {
      if (!o.active) continue;
      o.z += travel;
      if (o.z > DESPAWN_BEHIND) o.active = false;
    }
    for (const c of this.cash) {
      if (!c.active) continue;
      c.z += travel;
      c.phase += dt * 3.1;
      if (c.z > DESPAWN_BEHIND) c.active = false;
    }
    for (const b of this.bags) {
      if (!b.active) continue;
      b.z += travel;
      b.phase += dt * 1.9;
      if (b.z > DESPAWN_BEHIND) b.active = false;
    }

    /* Contacts. */
    this.collide();
  }

  /* ── Track generation ───────────────────────────────────────────────── */

  private spawn() {
    const s = this.state;
    // Rows are born when the spawn cursor comes inside the window ahead of the
    // player. The cursor is metres-ahead and the window is metres too, so this
    // test is exact and needs no per-row position bookkeeping.
    while (this.spawnCursor <= SPAWN_AHEAD) {
      const template = pickRow(this.rng, s.distance);
      const layout = template.build(this.rng);
      this.placeRow(this.spawnCursor, layout);
      this.spawnCursor = nextSpawn(this.spawnCursor, s.distance);
    }
  }

  private placeRow(spawn: number, layout: RowLayout) {
    const z = -spawn;
    for (const block of layout.blocked) {
      const slot = this.freeObstacle();
      if (!slot) break;
      slot.id = block.id;
      slot.lane = block.lane;
      slot.z = z;
      slot.spent = false;
      slot.active = true;
      // Lateral jitter so a row of identical carts does not read as a fence.
      // Wide blockers get none — a limousine that drifts sideways stops being a
      // limousine and starts being a wall.
      const jitter =
        (this.rng() - 0.5) * 0.5 * LANE_WIDTH * (1 - Math.min(1, footprintOf(block.id)));
      slot.x = laneX(block.lane) + jitter;
    }
    const coins = layout.coins;
    for (let i = 0; i < coins.length; i++) {
      const c = coins[i];
      if (!c) continue;
      const slot = this.freeCash();
      if (!slot) break;
      // A coin that would upgrade to a bag only does so some of the time, so
      // `bag_alley`'s guaranteed bag stays the rare thing it is.
      const wantsBag = layout.bag !== null && this.rng() < BAG_CHANCE;
      slot.tier = wantsBag
        ? this.tierFrom(layout.bag?.height ?? c.height)
        : cashTierFor(this.rng, i, coins.length);
      slot.x = laneX(c.lane);
      slot.y = c.height;
      slot.z = z;
      slot.active = true;
    }
    if (layout.bag) {
      const slot = this.freeBag();
      if (slot) {
        slot.x = laneX(layout.bag.lane);
        slot.y = layout.bag.height;
        slot.z = z;
        slot.active = true;
      }
    }
  }

  /** Higher coins in an arc read as envelopes, the low ones as loose change —
   *  so the tier of a coin is legible from its position before you can even
   *  see the shape. */
  private tierFrom(height: number): CashId {
    if (height >= 1.05) return "envelope";
    if (height >= 0.6) return "bundle";
    return "coin";
  }

  private freeObstacle(): ObstacleInstance | null {
    for (const o of this.obstacles) if (!o.active) return o;
    return null;
  }
  private freeCash(): CashInstance | null {
    for (const c of this.cash) if (!c.active) return c;
    return null;
  }
  private freeBag(): BagInstance | null {
    for (const b of this.bags) if (!b.active) return b;
    return null;
  }

  /* ── Collision ──────────────────────────────────────────────────────── */

  private collide() {
    const s = this.state;
    const height = s.sliding ? SLIDE_HEIGHT : STAND_HEIGHT;
    const centerY = s.y + height / 2;
    const reach = height / 2 + 0.42;

    for (const o of this.obstacles) {
      if (!o.active || o.spent) continue;
      if (Math.abs(o.z) > 0.7) continue;
      const spec = OBSTACLE_GEOM[o.id];
      if (Math.abs(o.x - s.x) > spec.halfX + PLAYER.halfX - PLAYER.forgive) continue;
      const top = spec.base + spec.height;
      // Vertical overlap against the player's own box, forgiving both edges.
      // This is the test that makes the three gates mean what the catalogue
      // says they mean: a `jump` gate is cleared by height, a `slide` gate is
      // cleared by ducking, and a full-height one is cleared by neither.
      const bottom = s.y + PLAYER.forgive;
      const head = s.y + height - PLAYER.forgive;
      if (head > spec.base + PLAYER.forgive && bottom < top - PLAYER.forgive) {
        o.spent = true;
        this.damage(o);
      }
    }

    for (const c of this.cash) {
      if (!c.active) continue;
      if (Math.abs(c.z) > 0.62) continue;
      if (Math.abs(c.x - s.x) > 0.66) continue;
      if (Math.abs(c.y - centerY) > reach) continue;
      c.active = false;
      const value = coinValue(c.tier, this.currency);
      s.cash += value;
      this.events.push({ type: "coin", x: c.x, y: c.y, z: c.z, tier: c.tier, value });
      // One burst, not one per tier. The tier is the SCORE difference and the
      // player reads it off the HUD; the burst's job is only to say "something
      // was collected here", and a bundle burst that looks identical to a coin
      // burst teaches the player nothing the counter has not already said.
      this.spark("coin", c.x, c.y, c.z);
    }

    for (const b of this.bags) {
      if (!b.active) continue;
      if (Math.abs(b.z) > 0.8) continue;
      if (Math.abs(b.x - s.x) > 0.86) continue;
      if (Math.abs(b.y - centerY) > reach + 0.3) continue;
      b.active = false;
      s.bags += 1;
      this.events.push({
        type: "bag",
        x: b.x,
        y: b.y,
        z: b.z,
        value: economyFor(this.currency).bag * s.multiplier,
      });
      // The bag is the only pickup with its own burst, because it is the only
      // one whose value is worth a distinct sound AND a distinct colour.
      this.spark("coin", b.x, b.y + 0.2, b.z);
    }
  }

  private damage(o: ObstacleInstance) {
    const s = this.state;
    if (s.invuln > 0 || s.phase !== "running") return;
    s.hearts = Math.max(0, s.hearts - 1);
    s.hits += 1;
    s.invuln = INVULN_SECONDS;
    s.slowmo = HIT_SLOWMO;
    s.hitFlash = 1;
    s.shake = 1;
    const spec = OBSTACLE_GEOM[o.id];
    this.events.push({
      type: "hit",
      x: o.x,
      y: spec.base + spec.height * 0.5,
      z: o.z,
      obstacle: o.id,
    });
    this.events.push({ type: "expense", amount: economyFor(this.currency).expensePerHit });
    // The cost burst is RED and rises, where a pickup's falls and is gold: the
    // two must never be confusable at a glance, because one adds to the score and
    // the other takes from it.
    this.spark("cost", o.x, spec.base + spec.height * 0.5, o.z);
    if (s.hearts <= 0) this.gameOver();
  }

  private gameOver() {
    const s = this.state;
    s.phase = "over";
    // NO confetti here, and the omission is deliberate: confetti in this game
    // belongs to the milestone ladder, so firing one on a game over would be
    // celebrating a loss with the game's own vocabulary for winning. The verdict
    // screen is DOM, and it decides for itself whether a run was worth
    // celebrating.
    this.events.push({ type: "gameover", summary: this.summary() });
    /* THE END OF A RUN IS A CALLBACK, NOT AN EVENT.
     *
     * `events` is drained — emptied — by the audio layer, which owns it, so a
     * page that wanted the finished summary by reading the queue would be racing
     * the sound for it and would usually lose. The verdict card is not an
     * optional consumer of a log; it is the one thing that must happen exactly
     * once at the moment the run ends, so it gets its own hook beside `onTick`.
     * `onTick` is the high-frequency mirror, this is the one-shot. */
    this.onGameOver?.(this.summary());
  }

  /* ── The visual spark queue ──────────────────────────────────────────── */

  /**
   * A spark is a request to the particle system, NOT an event.
   *
   * THE SEPARATION IS LOAD-BEARING. `events` is the semantic log and the audio
   * layer owns it outright. If particles also drained `events`, the
   * first consumer to run each frame would take the queue and the second would
   * silently get nothing: a bug that appears only when two features are enabled
   * at once, which is exactly the kind that ships. Two queues, two owners, and
   * neither consumer can starve the other.
   *
   * The engine decides only the REASON and the POSITION. What a reason looks like
   * is the particle system's business, which is why a new visual costs no engine
   * change at all.
   */
  /* `events` HAS EXACTLY ONE OWNER, AND IT IS THE AUDIO LAYER.
   *
   * The queue is drained, not peeked, because a sound must not replay if the
   * consumer comes late. Anything else that wants to know what happened reads
   * `engine.events` directly and is then responsible for tolerating seeing the
   * same event twice — it is a non-destructive read of a log someone else owns.
   * Two layers both calling the drain is the bug that produces a pickup that is
   * silent, and it is why the drain is a named method on the engine rather than
   * an `events.length = 0` sprinkled at whatever call site happens to be first. */
  drainEvents(): readonly RunEvent[] {
    if (this.events.length === 0) return EMPTY_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }

  private sparks: SparkRequest[] = [];

  /** Take everything queued since the last call. The array is swapped rather than
   *  emptied so a consumer iterating it cannot be disturbed by the engine pushing
   *  more while it reads. */
  drainSparks(): readonly SparkRequest[] {
    if (this.sparks.length === 0) return EMPTY_SPARKS;
    const out = this.sparks;
    this.sparks = [];
    return out;
  }

  /** Queue a burst. Capped, because a row of cash collected in a single frame
   *  must not be able to hand the particle system 40 requests and blow the
   *  frame budget on a shape the player cannot see individually. */
  private spark(kind: SparkKind, x: number, y: number, z: number) {
    if (this.sparks.length >= MAX_SPARKS_PER_ADVANCE) return;
    this.sparks.push({ kind, x, y, z });
  }

  /** The run so far, as the game-over screen and the best-score check read it.
   *  Every number here is derived from the raw counters, never accumulated,
   *  so the score on screen can always be recomputed from the run. */
  summary(): RunSummary {
    const s = this.state;
    const economy = { cash: s.cash, bags: s.bags, hits: s.hits, currency: this.currency };
    const profit = weddingProfit(economy, s.multiplier);
    return {
      profit,
      cash: economy.cash,
      bags: s.bags,
      distance: Math.floor(s.distance),
      hits: s.hits,
      multiplier: s.multiplier,
      verdict: verdictFor(profit, this.currency),
      currency: this.currency,
    };
  }

  /** The bill so far, for the HUD's running cost readout. Derived from `hits`
   *  through the shared economy rather than accumulated, for the same reason the
   *  summary is. */
  expenses(): number {
    return this.state.hits * economyFor(this.currency).expensePerHit;
  }

  /** Switch the scoring currency. Refused while a run is in flight: half the
   *  coins on the track would be worth the old number and half the new, and a
   *  leaderboard score is not worth a re-scored mid-run table. A refresh of the
   *  workspace currency is a new-run event, which is why the page sets this
   *  before `start()`. */
  setCurrency(currency: Currency): void {
    // Refused for the WHOLE of a run, not just the frames it is actively
    // simulating. Guarding on `running` alone left the paused phase open, and a
    // pause is the one moment a couple is still looking at their run — the
    // printed props have their amounts baked into canvas textures by then, so a
    // swap would leave the track quoting one currency and the HUD another, with
    // no reload to fix it. `menu` and `over` are the only states in which there
    // is no run on screen to contradict.
    const phase = this.state.phase;
    if (phase === "running" || phase === "paused") return;
    this.currency = currency;
  }

  /* ── Cosmetics the renderer reads ──────────────────────────────────── */

  /** Where the partner being chased is, in metres ahead. They hover around 30
   *  metres out, drift a little closer whenever the player is doing well (a
   *  milestone closes the gap for a moment) and never closer than 18 — far
   *  enough that they read as narrative rather than as another collider. */
  partnerDistance(milestonePulse: number): number {
    const base = 30 - milestonePulse * 6;
    const sway = Math.sin(this.clock * 0.55) * 2.4;
    return base + sway;
  }

  /** Seconds since the run began. Drives every run-cycle animation. */
  get runClock(): number {
    return this.clock;
  }
}

export interface TickExtras {
  clock: number;
  milestonePulse: number;
}

/** Collision volumes, flattened out of the catalogue once at module load.
 *  `base` + `height` rather than a centre + half-extent, because that is the
 *  form the overlap test reads and the form the catalogue was authored in —
 *  "this starts at 1.02 and is 1.44 tall" is the sentence a designer can check
 *  against the player's 1.7 standing / 0.8 sliding box. */
interface Geom {
  halfX: number;
  base: number;
  height: number;
}

const OBSTACLE_GEOM: Readonly<Record<ObstacleId, Geom>> = Object.fromEntries(
  OBSTACLE_IDS.map((id) => {
    const spec = OBSTACLES[id];
    return [id, { halfX: spec.half.x, base: spec.base, height: spec.half.y * 2 }];
  }),
) as Record<ObstacleId, Geom>;

const footprintOf = (id: ObstacleId): number => OBSTACLES[id].footprint;
