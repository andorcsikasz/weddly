// WeddlyMarket sound effects, synthesized on the fly with WebAudio, so there
// are no audio files to ship or cache. Every sound is a few short oscillator
// notes: a chirp on a bet, a two-note lock, a drumroll + sting on the reveal.
//
// Muting is a per-device convenience (localStorage), wrapped in try/catch
// like every other storage read: a private tab simply starts unmuted. The
// AudioContext is created lazily on the first sound, which always follows a
// tap, so browsers that need a user gesture to start audio are satisfied.

const MUTE_KEY = "weddly.market.muted";

let ctx: AudioContext | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // best-effort only
  }
}

function audio(): AudioContext | null {
  if (isMuted() || typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  ac: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = "square",
  gain = 0.06,
): void {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  g.gain.setValueAtTime(gain, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + dur + 0.02);
}

export type MarketSound = "bet" | "allin" | "lock" | "reveal" | "win" | "lose" | "pop" | "new";

export function playSound(sound: MarketSound): void {
  const ac = audio();
  if (!ac) return;
  switch (sound) {
    case "bet":
      tone(ac, 660, 0, 0.08);
      tone(ac, 990, 0.07, 0.1);
      break;
    case "allin":
      [523, 659, 784, 1047].forEach((f, i) => tone(ac, f, i * 0.07, 0.14));
      break;
    case "lock":
      tone(ac, 440, 0, 0.1, "triangle", 0.1);
      tone(ac, 330, 0.1, 0.16, "triangle", 0.1);
      break;
    case "reveal":
      for (let i = 0; i < 14; i++) tone(ac, 120 + (i % 2) * 20, i * 0.06, 0.05, "triangle", 0.08);
      tone(ac, 880, 0.9, 0.35, "sawtooth", 0.07);
      break;
    case "win":
      [784, 988, 1175, 1568].forEach((f, i) => tone(ac, f, i * 0.09, 0.2, "square", 0.05));
      break;
    case "lose":
      [392, 370, 349, 262].forEach((f, i) => tone(ac, f, i * 0.16, 0.22, "triangle", 0.08));
      break;
    case "pop":
      tone(ac, 1200, 0, 0.05, "sine", 0.08);
      break;
    case "new":
      tone(ac, 880, 0, 0.09, "sine", 0.09);
      tone(ac, 1320, 0.1, 0.14, "sine", 0.09);
      break;
  }
}
