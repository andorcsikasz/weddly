// Tiny dependency-free confetti burst — a subtle celebration when a planning
// step is completed. Appends a fixed, full-viewport, click-through canvas,
// animates a short upward particle fan, then self-removes. No-op under
// prefers-reduced-motion. Hand-rolled (no canvas-confetti dep) to stay in line
// with the "no UI libraries" rule; the hex colours are the effect's paint, not
// component styling, so they live here rather than as Tailwind tokens.

// star gold, sage green, blush, steel blue, oat — a small festive palette.
const COLORS = ["#FFD000", "#2f9c52", "#d35d42", "#4F6D7A", "#bfae7b"];

/** Fire a small confetti burst from `origin` (defaults to upper-centre of the
 *  viewport, roughly where the supplier chain sits). Safe to call repeatedly. */
export function fireConfetti(origin?: { x: number; y: number }): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.cssText = `position:fixed;inset:0;width:${W}px;height:${H}px;pointer-events:none;z-index:9999`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  document.body.appendChild(canvas);
  ctx.scale(dpr, dpr);

  const ox = origin?.x ?? W / 2;
  const oy = origin?.y ?? H * 0.28;
  const GRAVITY = 0.18;
  const MAX_LIFE = 90; // ~1.5s at 60fps

  const particles = Array.from({ length: 28 }, () => {
    // Upward fan: centred on straight-up (-90°) with a ~160° spread.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 4 + Math.random() * 6;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed + (Math.random() - 0.5) * 2,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#FFD000",
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      life: 0,
    };
  });

  let raf = 0;
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    canvas.remove();
  };

  const frame = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of particles) {
      p.life += 1;
      if (p.life > MAX_LIFE) continue;
      alive = true;
      p.vy += GRAVITY;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.spin;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / MAX_LIFE);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (alive) raf = requestAnimationFrame(frame);
    else cleanup();
  };
  raf = requestAnimationFrame(frame);
  // Safety net: guarantee removal even if the rAF loop is throttled/paused
  // (backgrounded tab) so we never leak the canvas.
  window.setTimeout(cleanup, 4000);
}
