// The living backdrop behind the Wēddly Games hub: two slow aurora blobs,
// a glow that follows the cursor, and a constellation of drifting particles
// that link up near each other and lean away from the pointer.
//
// Portalled to <body> at z-index -1, so it sits above the console's canvas
// paint (GamesConsole.css, `html:has(.gc-page) body`) and below everything
// else, including the sidebar, without depending on what the app shell's
// wrappers do to stacking. Under prefers-reduced-motion only the static
// aurora renders: no canvas, no animation loop.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type Particle = { x: number; y: number; vx: number; vy: number; r: number; hue: 0 | 1 | 2 };

// Purple (Kahoot), blue (Polymarket), white: the hub's own three colours.
const HUES = ["167, 120, 255", "86, 150, 255", "230, 236, 255"] as const;
const LINK_DIST = 130;
const POINTER_DIST = 170;

export function GamesAmbient() {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let particles: Particle[] = [];
    const pointer = { x: -9999, y: -9999, active: false };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Density scales with area, capped so a 4K monitor doesn't pay O(n²).
      const count = Math.min(110, Math.round((w * h) / 16000));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.4 + 0.5,
        hue: (Math.random() < 0.4 ? 0 : Math.random() < 0.7 ? 1 : 2) as Particle["hue"],
      }));
    };

    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      root.style.setProperty("--gx", `${e.clientX}px`);
      root.style.setProperty("--gy", `${e.clientY}px`);
      root.classList.add("gc-amb-live");
    };
    const onLeave = () => {
      pointer.active = false;
      root.classList.remove("gc-amb-live");
    };

    let raf = 0;
    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        if (pointer.active) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < POINTER_DIST * POINTER_DIST && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const push = (1 - d / POINTER_DIST) * 0.6;
            p.vx += (dx / d) * push * 0.08;
            p.vy += (dy / d) * push * 0.08;
          }
        }
        // Friction pulls a pushed particle back to its idle drift speed.
        p.vx *= 0.985;
        p.vy *= 0.985;
        const speed = Math.hypot(p.vx, p.vy);
        if (speed < 0.08) {
          p.vx += (Math.random() - 0.5) * 0.02;
          p.vy += (Math.random() - 0.5) * 0.02;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -10) p.x = w + 10;
        else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        else if (p.y > h + 10) p.y = -10;
      }

      ctx.lineWidth = 0.7;
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i];
        if (!a) continue;
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j];
          if (!b) continue;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > LINK_DIST * LINK_DIST) continue;
          const alpha = (1 - Math.sqrt(d2) / LINK_DIST) * 0.16;
          ctx.strokeStyle = `rgba(${HUES[a.hue]}, ${alpha.toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        if (pointer.active) {
          const dx = a.x - pointer.x;
          const dy = a.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < POINTER_DIST) {
            ctx.strokeStyle = `rgba(${HUES[a.hue]}, ${((1 - d / POINTER_DIST) * 0.35).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        ctx.fillStyle = `rgba(${HUES[p.hue]}, 0.75)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(frame);
    };

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return createPortal(
    <div ref={rootRef} className="gc-ambient" aria-hidden="true">
      <span className="gc-aurora gc-aurora-a" />
      <span className="gc-aurora gc-aurora-b" />
      <span className="gc-aurora gc-aurora-c" />
      <span className="gc-cursor-glow" />
      <canvas ref={canvasRef} className="gc-particles" />
    </div>,
    document.body,
  );
}
