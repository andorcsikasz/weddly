/**
 * Every sound in the game, synthesised. No audio files, no network, no licence.
 *
 * THE ENGINE'S EVENT LOG IS THE ONLY INPUT. `runnerAudio.attach(engine)` drains
 * `engine.events` once per animation frame and turns each event into a sound, so
 * there is no second place where a pickup can make a noise and no place where a
 * sound can be played for a pickup that did not happen.
 *
 * THE RULES THAT MATTER:
 *
 *  - **The context starts suspended and is resumed by a user gesture.** Every
 *    browser requires this, and a game that creates its own context at mount gets
 *    a silent game on iOS with no error anywhere. `unlock()` is wired to the
 *    first tap/keypress on the menu.
 *  - **A coin is a two-oscillator blip, not a sample.** Three tier pitches, and
 *    the pitch RISES with the tier. That is the whole feedback channel for a
 *    pickup: the player hears a bundle coming before they see it.
 *  - **The bag gets its own arpeggio.** It is worth four coins and it is the only
 *    pickup that changes key, so the ear learns it in one run.
 *  - **A hit is a filtered noise burst plus a low thud.** A hit that plays a tone
 *    reads as a reward; noise reads as an impact, and the thud is what the player
 *    feels through the floor of the camera shake.
 *  - **Everything is rate-limited per kind.** Collecting a whole row of coins in
 *    one frame must not stack twenty oscillators into a wall of noise.
 *  - **Nothing is scheduled ahead of `now` by more than a few ms**, and every
 *    node is `stop()`-ed and self-disconnecting, so a long run cannot leak
 *    contexts or nodes.
 */

import type { RunEngine, RunEvent } from "../engine/RunEngine";

/** Four bars of bass, one note per sixteenth (0 = rest). A minor pentatonic in A,
 *  so it never clashes with the C-major pickups above it. */
const BASS: readonly (readonly number[])[] = [
  [110, 0, 0, 110, 0, 0, 131, 0, 110, 0, 0, 147, 0, 131, 0, 0],
  [110, 0, 0, 110, 0, 0, 165, 0, 147, 0, 0, 131, 0, 110, 0, 0],
  [98, 0, 0, 98, 0, 0, 131, 0, 98, 0, 0, 110, 0, 131, 0, 0],
  [110, 0, 0, 110, 0, 165, 0, 147, 0, 131, 0, 110, 0, 98, 0, 0],
];

/** How many of the same sound may play inside `RATE_WINDOW_MS`. */
const RATE_WINDOW_MS = 90;
const MAX_PER_WINDOW = 3;

export class RunnerAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();
  private muted = false;

  /** Start (or resume) the context. MUST be called from a user gesture. Safe to
   *  call repeatedly — which it is, because the menu, the pause button and the
   *  first keypress all call it. */
  unlock() {
    if (!this.ctx) this.build();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
  }

  /** Master mute. Bound to the page's sound toggle and to a `visibilitychange`,
   *  because a tab that is not visible should not keep playing. */
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  get isMuted() {
    return this.muted;
  }

  /** Call once per frame with the events since the last frame. The array is
   *  drained here; the caller must not use it afterwards. */
  play(events: readonly RunEvent[]) {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    if (ctx.state !== "running") return;
    for (const e of events) {
      if (!this.allow(e.type)) continue;
      switch (e.type) {
        case "coin":
          this.coin(ctx, e.tier);
          break;
        case "bag":
          this.bag(ctx);
          break;
        case "jump":
          this.jump(ctx);
          break;
        case "land":
          this.land(ctx);
          break;
        case "slide":
          this.slide(ctx);
          break;
        case "hit":
          this.hit(ctx);
          break;
        case "expense":
          // The expense has its own sound and it is a MINOR SECOND below the
          // hit: the two arrive on the same frame and a player who only hears
          // one of them must hear the money one. This is the sound of the game.
          this.expense(ctx);
          break;
        case "milestone":
          this.milestone(ctx);
          break;
        case "gameover":
          this.gameover(ctx);
          break;
        case "power":
          this.power(ctx);
          break;
        case "shield_break":
          this.shieldBreak(ctx);
          break;
        case "streak":
          this.streak(ctx);
          break;
        case "charge":
          this.horn(ctx);
          break;
        case "countdown":
          this.countdown(ctx, e.n);
          break;
        case "liftoff":
          this.liftoff(ctx);
          break;
        case "gift":
          this.gift(ctx);
          break;
        default:
          // `lane` is silent on purpose. A whoosh per lane change on a keyboard
          // player holding ArrowRight would be a machine gun; the camera pan is
          // the feedback.
          break;
      }
    }
  }

  /* ── Voices ──────────────────────────────────────────────────────────── */

  /** One enveloped oscillator. Every voice in the game is this function with
   *  different arguments, which is why there is no per-sound synth code. */
  private blip(
    ctx: AudioContext,
    opts: { type: OscillatorType; from: number; to: number; at: number; dur: number; gain: number },
  ) {
    const t0 = ctx.currentTime + opts.at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.from, t0);
    if (opts.to !== opts.from)
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur);
    // A 6 ms attack and an exponential tail. A linear fade on a short blip has an
    // audible click at the end, which is what most of these sound like otherwise.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(opts.gain, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(env).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.02);
    // Let the node graph be collected once it has finished; `onended` is the only
    // supported way, and without it a ten-minute run leaks one graph per blip.
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  /** A filtered burst of the shared noise buffer. Impacts, scrapes and the
   *  envelope "hiss" under a hit. */
  private noiseBurst(
    ctx: AudioContext,
    opts: { at: number; dur: number; gain: number; hz: number },
  ) {
    const buf = this.noise;
    if (!buf) return;
    const t0 = ctx.currentTime + opts.at;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(opts.hz, t0);
    filter.Q.value = 1.1;
    const env = ctx.createGain();
    env.gain.setValueAtTime(opts.gain, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(filter).connect(env).connect(this.master!);
    src.start(t0, Math.random() * 0.4);
    src.stop(t0 + opts.dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }

  private coin(ctx: AudioContext, tier: "coin" | "bundle" | "envelope") {
    // Three pitches, rising with the tier: a player hears a bundle two rows away.
    const base = tier === "coin" ? 880 : tier === "bundle" ? 1174 : 1568;
    this.blip(ctx, { type: "triangle", from: base, to: base * 1.5, at: 0, dur: 0.09, gain: 0.13 });
  }

  private bag(ctx: AudioContext) {
    // A rising fourth-then-octave arpeggio. The only sound in the game that
    // changes key, which is what makes a bag unmistakable in a noisy frame.
    this.blip(ctx, { type: "triangle", from: 523, to: 523, at: 0, dur: 0.07, gain: 0.12 });
    this.blip(ctx, { type: "triangle", from: 698, to: 698, at: 0.06, dur: 0.07, gain: 0.12 });
    this.blip(ctx, { type: "triangle", from: 1046, to: 1046, at: 0.12, dur: 0.14, gain: 0.14 });
  }

  private jump(ctx: AudioContext) {
    this.blip(ctx, { type: "sine", from: 300, to: 620, at: 0, dur: 0.11, gain: 0.09 });
  }

  private land(ctx: AudioContext) {
    this.noiseBurst(ctx, { at: 0, dur: 0.09, gain: 0.1, hz: 420 });
  }

  private slide(ctx: AudioContext) {
    // A downward sweep: the one voice that literally sounds like the direction it
    // describes.
    this.blip(ctx, { type: "sawtooth", from: 520, to: 180, at: 0, dur: 0.16, gain: 0.05 });
    this.noiseBurst(ctx, { at: 0, dur: 0.16, gain: 0.07, hz: 2400 });
  }

  private hit(ctx: AudioContext) {
    // Noise first, then a low thud. The thud is what the camera shake is synced
    // to, so the shake reads as the consequence of a sound rather than as an
    // effect that happens next to one.
    this.noiseBurst(ctx, { at: 0, dur: 0.16, gain: 0.2, hz: 1400 });
    this.blip(ctx, { type: "sine", from: 160, to: 60, at: 0, dur: 0.2, gain: 0.22 });
  }

  private expense(ctx: AudioContext) {
    // The register is the message. Everything that ADDS money in this game sits
    // in the C major pentatonic above middle C; money coming OUT is a minor
    // second below it and the player feels the difference before they can name it.
    this.blip(ctx, { type: "sine", from: 233, to: 220, at: 0.02, dur: 0.3, gain: 0.12 });
    this.blip(ctx, { type: "sine", from: 466, to: 440, at: 0.02, dur: 0.26, gain: 0.06 });
  }

  private milestone(ctx: AudioContext) {
    const notes = [659, 784, 988, 1319];
    notes.forEach((n, i) => {
      this.blip(ctx, { type: "triangle", from: n, to: n, at: i * 0.06, dur: 0.16, gain: 0.1 });
    });
  }

  private gameover(ctx: AudioContext) {
    // Down, not up. The run ended; the arpeggio would be celebrating.
    const notes = [659, 523, 440, 349];
    notes.forEach((n, i) => {
      this.blip(ctx, { type: "sine", from: n, to: n, at: i * 0.13, dur: 0.3, gain: 0.11 });
    });
  }

  private power(ctx: AudioContext) {
    // A fast upward sweep plus a sparkle on top: a power-up is a state change,
    // not a pickup, so it gets the only glissando in the game.
    this.blip(ctx, { type: "square", from: 330, to: 1320, at: 0, dur: 0.22, gain: 0.05 });
    [1568, 2093, 2637].forEach((n, i) => {
      this.blip(ctx, {
        type: "triangle",
        from: n,
        to: n,
        at: 0.1 + i * 0.05,
        dur: 0.1,
        gain: 0.07,
      });
    });
  }

  private shieldBreak(ctx: AudioContext) {
    // Glass, not a thud: the shield took it, the runner did not.
    this.noiseBurst(ctx, { at: 0, dur: 0.22, gain: 0.16, hz: 4200 });
    this.blip(ctx, { type: "triangle", from: 1760, to: 880, at: 0, dur: 0.25, gain: 0.08 });
  }

  private streak(ctx: AudioContext) {
    const notes = [784, 988, 1175, 1568, 1976];
    notes.forEach((n, i) => {
      this.blip(ctx, { type: "triangle", from: n, to: n, at: i * 0.045, dur: 0.12, gain: 0.09 });
    });
  }

  private horn(ctx: AudioContext) {
    // Two detuned saws: a car horn is a chord, which is why one tone sounds
    // like a buzzer instead.
    this.blip(ctx, { type: "sawtooth", from: 392, to: 380, at: 0, dur: 0.32, gain: 0.05 });
    this.blip(ctx, { type: "sawtooth", from: 494, to: 480, at: 0, dur: 0.32, gain: 0.04 });
  }

  private liftoff(ctx: AudioContext) {
    // A long rising whoosh: the balloons take you up.
    this.blip(ctx, { type: "sine", from: 220, to: 1760, at: 0, dur: 0.7, gain: 0.07 });
    this.noiseBurst(ctx, { at: 0, dur: 0.6, gain: 0.08, hz: 1800 });
  }

  private gift(ctx: AudioContext) {
    // A music-box flourish: the present opening.
    [1046, 1318, 1568, 2093, 1568, 2637].forEach((n, i) => {
      this.blip(ctx, { type: "sine", from: n, to: n, at: i * 0.055, dur: 0.18, gain: 0.08 });
    });
  }

  private countdown(ctx: AudioContext, n: number) {
    const go = n === 0;
    this.blip(ctx, {
      type: "square",
      from: go ? 1046 : 523,
      to: go ? 1046 : 523,
      at: 0,
      dur: go ? 0.35 : 0.12,
      gain: 0.06,
    });
  }

  /* ── Music ───────────────────────────────────────────────────────────── */

  /** A tiny step sequencer: kick, off-beat hat, and a pentatonic bass line. It
   *  only runs while a run is moving, and is scheduled a tenth of a second ahead
   *  on the audio clock so a slow frame cannot make it stutter. */
  private nextStep = 0;
  private stepIndex = 0;
  private music(ctx: AudioContext, playing: boolean, intensity: number) {
    if (!playing) {
      this.nextStep = 0;
      return;
    }
    const bpm = 118 + intensity * 26;
    const sixteenth = 60 / bpm / 4;
    if (this.nextStep < ctx.currentTime) this.nextStep = ctx.currentTime + 0.02;
    while (this.nextStep < ctx.currentTime + 0.1) {
      const at = this.nextStep - ctx.currentTime;
      const step = this.stepIndex % 16;
      const bar = Math.floor(this.stepIndex / 16) % 4;
      if (step % 4 === 0) {
        this.blip(ctx, { type: "sine", from: 140, to: 45, at, dur: 0.16, gain: 0.16 });
      }
      if (step % 4 === 2) this.noiseBurst(ctx, { at, dur: 0.04, gain: 0.05, hz: 8000 });
      if (intensity > 0.35 && step % 2 === 1)
        this.noiseBurst(ctx, { at, dur: 0.02, gain: 0.025, hz: 9500 });
      const line = BASS[bar] ?? BASS[0]!;
      const note = line[step];
      if (note)
        this.blip(ctx, {
          type: "triangle",
          from: note,
          to: note,
          at,
          dur: sixteenth * 1.6,
          gain: 0.07,
        });
      this.nextStep += sixteenth;
      this.stepIndex += 1;
    }
  }

  /* ── Plumbing ────────────────────────────────────────────────────────── */

  private allow(kind: string) {
    const now = performance.now();
    const prev = this.last.get(kind) ?? 0;
    if (now - prev < RATE_WINDOW_MS) {
      // Inside the window, count the repeats so a long row of coins degrades to
      // a few sounds rather than to silence — dropping everything sounds like the
      // audio has broken.
      const n = this.repeats.get(kind) ?? 0;
      if (n >= MAX_PER_WINDOW) return false;
      this.repeats.set(kind, n + 1);
      return true;
    }
    this.last.set(kind, now);
    this.repeats.set(kind, 0);
    return true;
  }

  private repeats = new Map<string, number>();

  private build() {
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined" ? AudioContext : (undefined as never);
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(ctx.destination);
      // One second of white noise, generated once and reused by every burst. A
      // per-burst noise buffer would allocate an AudioBuffer per hit.
      const len = Math.floor(ctx.sampleRate * 1);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buf;
    } catch {
      // No Web Audio (or it is blocked): the game runs silently rather than not
      // at all.
      this.ctx = null;
      this.master = null;
    }
  }

  /** Drain the engine's events and play them, returning what it drained.
   *
   *  The drain is the ENGINE'S method rather than `events.splice(0)` here for one
   *  reason: this is the only consumer, and the moment a second one appears the
   *  two have to be able to tell. `drainEvents()` names the owner in one place. */
  attach(engine: RunEngine): readonly RunEvent[] {
    const events = engine.drainEvents();
    this.play(events);
    const ctx = this.ctx;
    if (ctx && this.master && !this.muted && ctx.state === "running") {
      const s = engine.state;
      this.music(
        ctx,
        s.phase === "running" && s.countdown <= 0,
        Math.min(1, Math.max(0, (s.cruiseSpeed - 11.5) / 15.5)),
      );
    }
    return events;
  }
}

/** One audio object per game session. Held by the page, not by a module-level
 *  singleton, so a remount cannot leave a second AudioContext alive. */
export function createRunnerAudio() {
  return new RunnerAudio();
}
