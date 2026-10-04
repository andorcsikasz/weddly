// The HUD's reserved width — the one rule that keeps the pause button still.
//
// THE SCORE MUST NOT BE ABLE TO RESIZE ITS OWN ROW. `.rn-stat--lead` used to
// carry `min-width: 9.5rem`, which is a FLOOR and not a reservation, so the
// plate grew with the figure: measured in a real browser at 1440x900 it went
// 152px at zero to 216px at nine digits. Flex gives that growth to whatever
// sits after it, so the multiplier ring, the hearts and — the part that
// actually mattered — the pause and mute buttons slid sideways as a run got
// good. On a 390x844 phone it was worse than cosmetic: the plate tipped
// `.rn-hud-right` onto a second row the moment the score crossed a digit count,
// growing the HUD from 97px to 145px while the player was mid-run. Players tap
// pause by reflex, and the control was drifting under their thumb.
//
// Nothing about that is visible in a screenshot of any single state, and it is
// not a rendering error, so nothing else catches it. Hence a test on the
// stylesheet: the invariant is that the plate's width is RESERVED. Asserted as
// "declares a width, and does not declare a min-width" rather than on a pixel
// value, so a future retune of the plate does not have to come here.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/pages/games/runner/runner.css",
);
/** Comments go before any parsing, and that is not cosmetic: the rule under
 *  test explains this regression in a comment that NAMES `min-width` and
 *  `flex`, so a naive declaration regex reads the prose as the declarations
 *  and the test asserts on its own documentation. */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = stripComments(readFileSync(CSS_PATH, "utf8"));

/** The declarations of one top-level rule, without the nested blocks and
 *  without matching a same-named selector further down the file. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open + 1, close);
}

/** A declaration's value, or undefined when the rule does not declare it.
 *  Matches on a statement boundary so `min-width` cannot be satisfied by
 *  `width`. */
function decl(body: string, property: string): string | undefined {
  return body.match(new RegExp(`(?:^|[;{])\\s*${property}\\s*:\\s*([^;]+)`))?.[1]?.trim();
}

describe("the HUD's score plate", () => {
  const lead = ruleBody(".rn-stat--lead");

  it("reserves a width instead of only a minimum", () => {
    expect(decl(lead, "width")).toBeString();
    // The regression, stated as the absence of the thing that caused it: a
    // `min-width` floor lets the figure grow the plate, and the plate growing
    // is what moved the controls.
    expect(decl(lead, "min-width")).toBeUndefined();
  });

  it("cannot grow at all, even where a parent flexes it", () => {
    // `flex: 0 0 auto` is what stops the growth reaching its siblings even if a
    // later rule re-introduced a shrink-to-fit: the basis is the reserved
    // width, not the content.
    expect(decl(lead, "flex")).toContain("0");
    expect(decl(lead, "flex")).toContain("auto");
  });

  it("has a safety valve for a figure past the reserve", () => {
    // Clipped digits beat a moving button, but only because it is bounded: an
    // unclipped overflow would spill across the multiplier ring instead.
    expect(decl(lead, "overflow")).toBe("hidden");
  });

  it("keeps a reserved width on a phone too, where the wrap used to flip", () => {
    // The narrow-screen override used to reset the plate to `min-width: 0`,
    // which is what let the score reflow the row on exactly the viewport where
    // the row had no spare width to give. It now shrinks the RESERVE.
    const narrow = css.slice(css.indexOf("@media (max-width: 420px)"));
    expect(narrow).toContain(".rn-stat--lead");
    const narrowLead = narrow.slice(
      narrow.indexOf(".rn-stat--lead {"),
      narrow.indexOf("}", narrow.indexOf(".rn-stat--lead {")),
    );
    expect(decl(narrowLead, "width")).toBeString();
    expect(decl(narrowLead, "min-width")).toBeUndefined();
  });
});
