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
  CHARGE_SPEED,
  CHARGE_TRIGGER,
  MAGNET_REACH,
  MAX_BLOCKS_PER_ROW,
  POWERUP_CHANCE,
  POWERUP_FROM,
  POWERUP_SECONDS,
  ROW_GAP_TIGHT,
  BOOST_JUMP,
  FLY_HEIGHT,
  SKY_COIN_SPACING,
  STREAK_WINDOW,
  giftEnvelopeValue,
  hitCost,
  pickGiftPower,
  rollGift,
  isStreakStep,
  pickPowerUp,
  streakBonus,
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
import type {
  CashId,
  GiftOutcome,
  LaneIndex,
  ObstacleId,
  PowerUpId,
  RowLayout,
  Rng,
  Verdict,
} from "@shared/runner";
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

/** Obstacle pool size. Sized from the spawn window rather than guessed.
 *
 *  The worst case is `SPAWN_AHEAD / ROW_GAP_TIGHT` rows alive at once, each of
 *  which may block all three lanes. At the current gaps that is 82 / 12 ≈ 6.8
 *  rows → ~21 obstacles, plus whatever the spawn cursor overshoots by on the
 *  frame a run starts, so the pool is 32.
 *
 *  This number is NOT free to be small. `freeObstacle()` returning null breaks
 *  out of the row loop and the remaining obstacles of that row are simply never
 *  created — the generator fails SILENTLY and the track gets emptier the denser
 *  it is meant to be. A player sees a thinning obstacle field and blames the
 *  difficulty ramp. If `ROW_GAP_TIGHT` ever drops again, this must come with it. */
const OBSTACLE_POOL = Math.ceil((SPAWN_AHEAD / ROW_GAP_TIGHT + 1) * MAX_BLOCKS_PER_ROW) + 4;
/** Cash is instanced, so the pool is just memory and a loop bound. */
const CASH_POOL = 220;
const BAG_POOL = 8;
const POWERUP_POOL = 4;

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
  /** Will drive at the player once inside `CHARGE_TRIGGER`. */
  charge: boolean;
  /** Is driving right now. The renderer reads it for the bounce and the warning. */
  charging: boolean;
}

export interface PowerUpInstance {
  kind: PowerUpId;
  x: number;
  y: number;
  z: number;
  active: boolean;
  phase: number;
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

/** One rising money label, handed to the scene when something is collected.
 *
 *  This is the animation's DATA, not its look: the amount and the world position
 *  are decided here because this is the only place that knows both the tier that
 *  was collected and where it was, and a label that has to be reconstructed by the
 *  renderer would eventually disagree with the score about what was picked up.
 *
 *  `value` is the amount the MULTIPLIER actually paid, not the tier's face value —
 *  at ×3 a coin is worth three coins, and a label reading the face value is the
 *  one number on screen that would be wrong exactly when the player feels richest. */
export interface FloatRequest {
  x: number;
  y: number;
  z: number;
  value: number;
  currency: Currency;
  /** A bag gets a bigger label and a longer life, because it is a bigger event. */
  big: boolean;
}

/** Handed back when nothing is queued, so the common frame allocates nothing. */
const EMPTY_FLOATS: readonly FloatRequest[] = Object.freeze([]);

/** Ceiling on labels in one frame. A whole row crossed at once is five pickups,
 *  and five labels climbing over each other is a wall of digits that hides the
 *  track. Past this the extras are dropped deliberately: the HUD counter and the
 *  burst already said they were collected. */
const MAX_FLOATS_PER_ADVANCE = 3;

export type RunEvent =
  | { type: "coin"; x: number; y: number; z: number; tier: CashId; value: number }
  | { type: "bag"; x: number; y: number; z: number; value: number }
  | { type: "jump" }
  | { type: "land" }
  | { type: "slide" }
  | { type: "lane"; lane: LaneIndex }
  | { type: "hit"; x: number; y: number; z: number; obstacle: ObstacleId }
  | { type: "expense"; amount: number; obstacle: ObstacleId }
  | { type: "milestone"; multiplier: number }
  | { type: "power"; kind: PowerUpId }
  | { type: "gift"; outcome: GiftOutcome }
  | { type: "liftoff" }
  | { type: "shield_break" }
  | { type: "streak"; count: number; value: number }
  | { type: "charge" }
  | { type: "countdown"; n: number }
  | { type: "gameover"; summary: RunSummary };

/** Why a burst of particles exists. The engine picks the reason and the position;
 *  the particle system owns what the reason LOOKS like. */
export type SparkKind = "coin" | "cost" | "dust" | "confetti" | "power";

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
  /** Longest pickup streak of the run. Optional so a summary written before
   *  streaks existed still renders. */
  bestCombo?: number;
  /** The bill, summed from each hit's own vendor price. */
  expenses?: number;
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
  /** Pickups in a row without a hit or a gap longer than `STREAK_WINDOW`. */
  combo: number;
  bestCombo: number;
  /** Seconds left before the streak lapses. */
  comboTimer: number;
  /** Seconds of each power-up left; 0 is off. */
  magnet: number;
  doubler: number;
  shield: number;
  /** Seconds of balloon flight / super sneakers left. */
  fly: number;
  boost: number;
  /** Seconds of the 3-2-1 left before the track starts moving. */
  countdown: number;
  /** The bill so far: each hit priced by its vendor against the couple's budget. */
  expenses: number;
  /** The most recent hit, for the toast. `n` is the hit count it was, so the
   *  HUD can tell a new hit from a re-render of the same one. */
  lastHit: { id: ObstacleId; amount: number; n: number } | null;
  /** The most recent gift box, for its toast; `n` counts gifts this run. */
  lastGift: { outcome: GiftOutcome; power: PowerUpId | null; amount: number; n: number } | null;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Exponential smoothing factor for a given time constant. Framerate
 *  independent, unlike a bare `x += (target - x) * 0.2`. */
const ease = (dt: number, tau: number) => 1 - Math.exp(-dt / Math.max(1e-4, tau));

export class RunEngine {
  readonly obstacles: ObstacleInstance[] = [];
  readonly cash: CashInstance[] = [];
  readonly bags: BagInstance[] = [];
  readonly powerups: PowerUpInstance[] = [];
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
  /** Last whole second of the countdown announced, so each number fires once. */
  private lastCount = 0;
  private giftCount = 0;
  /** Metres of travel until the next sky coin is laid during a flight. */
  private skyCursor = 0;
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

  /** The couple's wedding budget in `currency`, or null when they have not set
   *  one. Prices every hit (see `hitCost`). Same mid-run guard as the currency. */
  budget: number | null = null;

  setBudget(budget: number | null): void {
    const phase = this.state.phase;
    if (phase === "running" || phase === "paused") return;
    this.budget = budget !== null && Number.isFinite(budget) && budget > 0 ? budget : null;
  }

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
      combo: 0,
      bestCombo: 0,
      comboTimer: 0,
      magnet: 0,
      doubler: 0,
      shield: 0,
      countdown: 0,
      expenses: 0,
      lastHit: null,
      lastGift: null,
      fly: 0,
      boost: 0,
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
        charge: false,
        charging: false,
      });
    }
    for (let i = 0; i < CASH_POOL; i++) {
      this.cash.push({ x: 0, y: 0, z: 0, tier: "coin", active: false, phase: i * 0.37 });
    }
    for (let i = 0; i < BAG_POOL; i++) {
      this.bags.push({ x: 0, y: 0, z: 0, active: false, phase: i * 1.1 });
    }
    for (let i = 0; i < POWERUP_POOL; i++) {
      this.powerups.push({ kind: "magnet", x: 0, y: 0, z: 0, active: false, phase: i * 0.8 });
    }
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /** `countdown` is seconds of 3-2-1 before the track moves. The page passes 3;
   *  the tests pass nothing, so a seeded run is still a pure function of frames. */
  start(seed?: number, countdown = 0) {
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
    s.combo = 0;
    s.bestCombo = 0;
    s.comboTimer = 0;
    s.magnet = 0;
    s.doubler = 0;
    s.shield = 0;
    s.countdown = countdown;
    s.expenses = 0;
    s.lastHit = null;
    s.lastGift = null;
    s.fly = 0;
    s.boost = 0;
    this.giftCount = 0;
    this.skyCursor = 0;
    this.lastCount = Math.ceil(countdown);

    for (const o of this.obstacles) o.active = false;
    for (const p of this.powerups) p.active = false;
    for (const c of this.cash) c.active = false;
    for (const b of this.bags) b.active = false;
    // Both queues are cleared, not just the events. An undrained spark from the
    // last frame of the previous run would otherwise fire as confetti over a menu
    // that is still fading out, which is the sort of thing that gets filed as "the
    // game is haunted" and is impossible to reproduce afterwards.
    this.events.length = 0;
    this.sparks = [];
    this.floats = [];
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
    // Spawn the opening window NOW rather than on the first step, so the track
    // is already laid out under the 3-2-1 instead of popping in at "go".
    this.spawn();
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
    if (s.phase !== "running" || s.countdown > 0) return false;
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
    if (s.phase !== "running" || s.countdown > 0) return false;
    if (s.fly > 0) return false;
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
    s.vy = JUMP.velocity * (s.boost > 0 ? BOOST_JUMP : 1);
    s.airborne = true;
    s.sliding = false;
    s.slideTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.events.push({ type: "jump" });
  }

  slide(): boolean {
    const s = this.state;
    if (s.phase !== "running" || s.countdown > 0) return false;
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
    // The frame boundary for the per-frame batches — see MAX_SPARKS_PER_ADVANCE
    // and MAX_FLOATS_PER_ADVANCE. Both are cleared on EVERY call, including the
    // paused one, so a burst or a money label queued by the final tick of a run
    // cannot survive into the game-over card.
    this.sparks = [];
    this.floats = [];
    if (s.phase !== "running") {
      // Still tick the UI at the menu/pause/over screens so the HUD mirror and
      // the character's idle pose keep breathing, but never simulate.
      this.clock += realDt;
      this.pump(realDt);
      return;
    }
    this.clock += realDt;
    if (s.countdown > 0) {
      // The 3-2-1 runs on real time and moves nothing: the track is already
      // spawned ahead (see `start`), the runner is on the line, and the numbers
      // are announced once each for the HUD pop and the beep.
      s.countdown = Math.max(0, s.countdown - realDt);
      const n = Math.ceil(s.countdown);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.events.push({ type: "countdown", n });
      }
      this.pump(realDt);
      return;
    }
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
    if (s.magnet > 0) s.magnet = Math.max(0, s.magnet - dt);
    if (s.doubler > 0) s.doubler = Math.max(0, s.doubler - dt);
    if (s.shield > 0) s.shield = Math.max(0, s.shield - dt);
    if (s.boost > 0) s.boost = Math.max(0, s.boost - dt);
    if (s.fly > 0) {
      s.fly = Math.max(0, s.fly - dt);
      if (s.fly === 0) {
        // The balloons let go: fall back under gravity, briefly untouchable so
        // the landing cannot be onto a wall the player could not see coming.
        s.vy = 0;
        s.airborne = true;
        s.invuln = Math.max(s.invuln, 1.1);
      }
    }
    if (s.comboTimer > 0) {
      s.comboTimer = Math.max(0, s.comboTimer - dt);
      if (s.comboTimer === 0) s.combo = 0;
    }

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

    if (s.fly > 0) {
      s.y += (FLY_HEIGHT - s.y) * ease(dt, 0.32);
      s.vy = 0;
      s.airborne = true;
      s.sliding = false;
      s.slideTime = 0;
    } else if (s.airborne) {
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
    this.skyTrail(travel);
    for (const o of this.obstacles) {
      if (!o.active) continue;
      if (o.charge && !o.charging && -o.z < CHARGE_TRIGGER) {
        o.charging = true;
        this.events.push({ type: "charge" });
      }
      o.z += travel + (o.charging ? CHARGE_SPEED * dt : 0);
      if (o.z > DESPAWN_BEHIND) o.active = false;
    }
    // The magnet bends cash toward the runner rather than teleporting it: the
    // player watches a lane of coins curve in, which is the whole fun of it.
    const pull = s.magnet > 0 ? ease(dt, 0.09) : 0;
    const bodyY = s.y + (s.sliding ? SLIDE_HEIGHT : STAND_HEIGHT) / 2;
    for (const c of this.cash) {
      if (!c.active) continue;
      c.z += travel;
      c.phase += dt * 3.1;
      if (pull > 0 && c.z > -MAGNET_REACH && c.z < 1) {
        c.x += (s.x - c.x) * pull;
        c.y += (bodyY - c.y) * pull;
        c.z += (0 - c.z) * pull * 0.6;
      }
      if (c.z > DESPAWN_BEHIND) c.active = false;
    }
    for (const p of this.powerups) {
      if (!p.active) continue;
      p.z += travel;
      p.phase += dt * 2.4;
      if (p.z > DESPAWN_BEHIND) p.active = false;
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
      if (s.distance + this.spawnCursor > POWERUP_FROM && layout.safe.length > 0) {
        if (this.rng() < POWERUP_CHANCE) {
          const lane = layout.safe[Math.floor(this.rng() * layout.safe.length)] ?? layout.safe[0];
          if (lane !== undefined) this.placePowerUp(this.spawnCursor - 5, lane);
        }
      }
      this.spawnCursor = nextSpawn(this.spawnCursor, s.distance) + (layout.span ?? 0);
    }
  }

  private placeRow(spawn: number, layout: RowLayout) {
    const z = -spawn;
    for (const block of layout.blocked) {
      const slot = this.freeObstacle();
      if (!slot) break;
      slot.id = block.id;
      slot.lane = block.lane;
      slot.z = z - (block.dz ?? 0);
      slot.spent = false;
      slot.charge = block.charge === true;
      slot.charging = false;
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
      slot.z = z - (c.dz ?? 0);
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

  /** During a flight, lay a weaving trail of coins at cruising height far
   *  enough ahead to arrive while the balloons still hold. */
  private skyTrail(travel: number) {
    const s = this.state;
    if (s.fly <= 0) return;
    const ahead = 46;
    if (s.fly * Math.max(1, s.speed) < ahead + 4) return;
    this.skyCursor -= travel;
    while (this.skyCursor <= 0) {
      this.skyCursor += SKY_COIN_SPACING;
      const slot = this.freeCash();
      if (!slot) return;
      const wave = Math.sin((s.distance + ahead) * 0.09);
      const lane = (wave > 0.4 ? 2 : wave < -0.4 ? 0 : 1) as LaneIndex;
      slot.tier = this.rng() < 0.15 ? "envelope" : this.rng() < 0.4 ? "bundle" : "coin";
      slot.x = laneX(lane);
      slot.y = FLY_HEIGHT + 0.7;
      slot.z = -ahead;
      slot.active = true;
    }
  }

  /** A power-up a few metres before a row, on one of its safe lanes. */
  private placePowerUp(spawn: number, lane: LaneIndex) {
    const slot = this.powerups.find((p) => !p.active);
    if (!slot) return;
    slot.kind = pickPowerUp(this.rng);
    slot.x = laneX(lane);
    slot.y = 0.95;
    slot.z = -spawn;
    slot.active = true;
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
      if (s.fly > 0) break;
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
      const value = coinValue(c.tier, this.currency) * (s.doubler > 0 ? 2 : 1);
      s.cash += value;
      this.bumpStreak();
      this.events.push({ type: "coin", x: c.x, y: c.y, z: c.z, tier: c.tier, value });
      // One burst, not one per tier. The tier is the SCORE difference and the
      // player reads it off the HUD; the burst's job is only to say "something
      // was collected here", and a bundle burst that looks identical to a coin
      // burst teaches the player nothing the counter has not already said.
      this.spark("coin", c.x, c.y, c.z);
      // Under the magnet every coin arrives at the runner, so the labels would
      // stack in one column; fan them out by the coin's own phase (not the rng,
      // which would change the track).
      const fan = s.magnet > 0 ? Math.sin(c.phase * 7.3) * 0.9 : 0;
      this.float(c.x + fan, c.y + 0.35 + Math.abs(fan) * 0.3, c.z, value * s.multiplier, false);
    }

    for (const b of this.bags) {
      if (!b.active) continue;
      if (Math.abs(b.z) > 0.8) continue;
      if (Math.abs(b.x - s.x) > 0.86) continue;
      if (Math.abs(b.y - centerY) > reach + 0.3) continue;
      b.active = false;
      s.bags += 1;
      this.bumpStreak();
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
      this.float(b.x, b.y + 0.75, b.z, economyFor(this.currency).bag * s.multiplier, true);
    }

    for (const p of this.powerups) {
      if (!p.active) continue;
      if (Math.abs(p.z) > 0.75) continue;
      if (Math.abs(p.x - s.x) > 0.8) continue;
      if (Math.abs(p.y - centerY) > reach + 0.2) continue;
      p.active = false;
      if (p.kind === "gift") {
        this.openGift(p.x, p.y, p.z);
      } else {
        this.grant(p.kind);
        this.events.push({ type: "power", kind: p.kind });
      }
      this.spark("power", p.x, p.y, p.z);
    }
  }

  /** Switch a power-up on. One place, so a gift and a pickup cannot disagree. */
  private grant(kind: Exclude<PowerUpId, "gift">) {
    const s = this.state;
    if (kind === "magnet") s.magnet = POWERUP_SECONDS.magnet;
    else if (kind === "double") s.doubler = POWERUP_SECONDS.double;
    else if (kind === "shield") s.shield = POWERUP_SECONDS.shield;
    else if (kind === "boost") s.boost = POWERUP_SECONDS.boost;
    else {
      s.fly = POWERUP_SECONDS.fly;
      this.skyCursor = 0;
      this.events.push({ type: "liftoff" });
    }
  }

  /** A wedding gift: an envelope of cash, a power-up, a heart back, or a tote. */
  private openGift(x: number, y: number, z: number) {
    const s = this.state;
    const outcome = rollGift(this.rng, s.hearts < START_HEARTS);
    let power: PowerUpId | null = null;
    let amount = 0;
    if (outcome === "envelope") {
      const raw = giftEnvelopeValue(this.currency);
      s.cash += raw;
      amount = raw * s.multiplier;
      this.floats.push({ x, y: y + 0.8, z, value: amount, currency: this.currency, big: true });
    } else if (outcome === "bag") {
      s.bags += 1;
      amount = economyFor(this.currency).bag * s.multiplier;
      this.floats.push({ x, y: y + 0.8, z, value: amount, currency: this.currency, big: true });
    } else if (outcome === "heart") {
      s.hearts = Math.min(START_HEARTS, s.hearts + 1);
    } else {
      const kind = pickGiftPower(this.rng);
      power = kind;
      this.grant(kind);
    }
    this.giftCount += 1;
    s.lastGift = { outcome, power, amount, n: this.giftCount };
    this.events.push({ type: "gift", outcome });
    this.spark("confetti", x, y + 0.5, z);
  }

  /** One more pickup in the streak, and the bonus when it lands on a step. The
   *  bonus goes into RAW cash like any pickup, so the profit stays derivable
   *  from the counters and the multiplier applies to it once, not twice. */
  private bumpStreak() {
    const s = this.state;
    s.combo += 1;
    s.comboTimer = STREAK_WINDOW;
    if (s.combo > s.bestCombo) s.bestCombo = s.combo;
    if (isStreakStep(s.combo)) {
      const bonus = streakBonus(s.combo, this.currency);
      s.cash += bonus;
      this.events.push({ type: "streak", count: s.combo, value: bonus * s.multiplier });
      this.spark("confetti", s.x, 1.6, -0.5);
      // Never DROPPED by the per-frame cap: a streak label is the one float that
      // is not redundant with the HUD counter, so it evicts a coin label instead.
      if (this.floats.length >= MAX_FLOATS_PER_ADVANCE) this.floats.pop();
      this.floats.push({
        x: s.x,
        y: 2.3,
        z: -0.5,
        value: bonus * s.multiplier,
        currency: this.currency,
        big: true,
      });
    }
  }

  private damage(o: ObstacleInstance) {
    const s = this.state;
    if (s.invuln > 0 || s.phase !== "running") return;
    if (s.shield > 0) {
      // The shield takes the hit whole: no heart, no bill, no stumble. A short
      // invulnerability so the same wall cannot hit the bare runner a frame later.
      s.shield = 0;
      s.invuln = 0.6;
      s.shake = 0.4;
      this.events.push({ type: "shield_break" });
      this.spark("power", s.x, 1, 0);
      return;
    }
    s.combo = 0;
    s.comboTimer = 0;
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
    const cost = hitCost(o.id, this.currency, this.budget);
    s.expenses += cost;
    s.lastHit = { id: o.id, amount: cost, n: s.hits };
    this.events.push({ type: "expense", amount: cost, obstacle: o.id });
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
  /** Rising money labels, drained by the scene on the same beat as the sparks. */
  private floats: FloatRequest[] = [];

  /** Take everything queued since the last call. Swapped rather than emptied, for
   *  the same reason as `drainSparks`: a consumer walking the array must not be
   *  disturbed by the engine pushing more while it reads. */
  drainFloats(): readonly FloatRequest[] {
    if (this.floats.length === 0) return EMPTY_FLOATS;
    const out = this.floats;
    this.floats = [];
    return out;
  }

  private float(x: number, y: number, z: number, value: number, big: boolean) {
    if (this.floats.length >= MAX_FLOATS_PER_ADVANCE) return;
    this.floats.push({ x, y, z, value, currency: this.currency, big });
  }

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
    const economy = {
      cash: s.cash,
      bags: s.bags,
      hits: s.hits,
      currency: this.currency,
      expenses: s.expenses,
    };
    const profit = weddingProfit(economy, s.multiplier);
    return {
      profit,
      cash: economy.cash,
      bags: s.bags,
      distance: Math.floor(s.distance),
      hits: s.hits,
      multiplier: s.multiplier,
      verdict: verdictFor(profit, this.currency),
      bestCombo: s.bestCombo,
      expenses: s.expenses,
      currency: this.currency,
    };
  }

  /** The bill so far, for the HUD's running cost readout. Derived from `hits`
   *  through the shared economy rather than accumulated, for the same reason the
   *  summary is. */
  expenses(): number {
    return this.state.expenses;
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

  /** Which half of the couple the player is, set from the menu.
   *
   *  Same guard as `setCurrency`, for the same reason: the rig is built around
   *  this choice and the partner is derived from it as "the one you are not", so
   *  swapping it with a run on screen would change who the second figure is four
   *  lines below the player's own, mid-stride. The menu is the only place the
   *  choice belongs — and it is a choice, not a setting, so there is no reason to
   *  let it change later. */
  setCharacter(character: RunnerCharacter): void {
    const phase = this.state.phase;
    if (phase === "running" || phase === "paused") return;
    this.state.character = character;
  }

  /* ── Cosmetics the renderer reads ──────────────────────────────────── */

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
