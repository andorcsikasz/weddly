// The light that runs the "know a good supplier?" card.
//
// It is one dashed outline rather than four edge bars, and what makes it smooth
// is an invariant a screenshot cannot show: every dash pattern's period equals
// the path length (`pathLength=100`), so the dash wraps across the seam of the
// rectangle by itself. Break that and the light is cut in half every time it
// passes the top-left corner. So the CSS numbers are pinned here, next to the
// component that gives them their meaning.

import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TracingFrame } from "@/components/TracingFrame";

afterEach(() => cleanup());

describe("<TracingFrame>", () => {
  it("draws one outline per layer, each measured as a percentage of its own perimeter", () => {
    const { container } = render(
      <TracingFrame>
        <p>plate</p>
      </TracingFrame>,
    );
    const rects = container.querySelectorAll("svg rect");
    expect(rects).toHaveLength(5);
    for (const r of rects) expect(r.getAttribute("pathLength")).toBe("100");
    // The plate is still rendered above the light.
    expect(container.textContent).toBe("plate");
  });

  it("takes its corner radius from the caller, defaulting to rounded-2xl", () => {
    const a = render(<TracingFrame>x</TracingFrame>);
    expect(a.container.querySelector("rect")?.getAttribute("rx")).toBe("16");
    cleanup();
    const b = render(<TracingFrame radius={24}>x</TracingFrame>);
    expect(b.container.querySelector("rect")?.getAttribute("rx")).toBe("24");
  });

  it("is decoration: hidden from assistive tech", () => {
    const { container } = render(<TracingFrame>x</TracingFrame>);
    expect(container.querySelector(".trace-run")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("trace layers in index.css", () => {
  const css = readFileSync(join(import.meta.dir, "..", "..", "src", "index.css"), "utf8");
  const layers = [1, 2, 3, 4, 5].map((n) => {
    const block = css.match(new RegExp(`\\.trace-l${n}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
    const dash = block.match(/stroke-dasharray:\s*([\d.]+)\s+([\d.]+)/);
    const shift = block.match(/--shift:\s*([\d.]+)/);
    return {
      n,
      len: Number(dash?.[1]),
      rest: Number(dash?.[2]),
      shift: Number(shift?.[1]),
    };
  });

  it("gives every layer a dash pattern whose period is exactly the path length", () => {
    for (const l of layers) {
      expect(Number.isFinite(l.len), `layer ${l.n} has a dasharray`).toBe(true);
      expect(l.len + l.rest, `layer ${l.n} period`).toBeCloseTo(100, 6);
    }
  });

  it("centres every layer on the longest one, so the bright point is the middle of the tail", () => {
    const longest = layers[0]?.len ?? 0;
    for (const l of layers) {
      expect(l.shift, `layer ${l.n} shift`).toBeCloseTo((longest - l.len) / 2, 6);
    }
  });

  it("gets shorter and brighter towards the core", () => {
    for (let i = 1; i < layers.length; i++) {
      expect((layers[i]?.len ?? 0) < (layers[i - 1]?.len ?? 0)).toBe(true);
    }
  });
});
