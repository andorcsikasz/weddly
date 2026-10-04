// The first-run coach tour, and the one route it must never appear on.
//
// What is worth pinning here is a TRAP, not a style. The tour renders a
// full-screen swallower at `z-[80]`; the runner pins itself over the app shell
// at `z-index: 60` (`.rn-page`), so the tour sits ABOVE the game while every
// element it points at — the bottom nav, the More button, the partner-invite
// section — sits BELOW it. On a phone that combination is not an ugly overlay,
// it is a dead end: Start does nothing, every swipe is swallowed, and the tour
// has no reachable target and no visible way to finish. The player could only
// escape with the browser's back gesture. Found on a 390x844 viewport, where
// the tour shows by design (it is mobile-only) and the runner is the thing
// people open on a phone.
//
// So the rule is: a full-screen game route suppresses the tour, and suppressing
// it DEFERS rather than skips — the next shell page still gets it.
//
// No `unmount()` and no `cleanup()`, per the policy `tests/setup.ts` records:
// the tour portals into `document.body`, and RTL's unmount path throws
// `DOMException: removeChild` on a portal node happy-dom no longer owns. The
// innerHTML wipe in setup's `afterEach` is the teardown. Every test below waits
// out the component's 400ms arm timer, so no timer is left pending across the
// boundary either.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CoachMarks } from "@/components/CoachMarks";

const STORAGE_KEY = "weddly.coachmarks.v1";
/** Comfortably under the component's own 1024px `lg:` breakpoint, and the width
 *  of the viewport the bug was found on. */
const PHONE_WIDTH = 390;
/** The tour arms itself on a timer so the bottom nav can mount first, so a test
 *  has to outlast that rather than assert synchronously. */
const ARM_DELAY_MS = 500;

/** The overlay is the swallower: a full-viewport `fixed` layer whose only job is
 *  to sit above everything and take the taps. Its `z-[80]` is the entire reason
 *  a `z-index: 60` game route has to opt out, so its presence is asserted on
 *  the class rather than on copy. */
const OVERLAY = ".fixed.inset-0.z-\\[80\\]";
const overlayUp = () => document.querySelector(OVERLAY) !== null;

const originalWidth = window.innerWidth;

function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <CoachMarks />
    </MemoryRouter>,
  );
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The elements the tour points at. Without them in the DOM the component skips
 *  the step (a missing target is how a tour survives an already-invited
 *  partner), which would make "the tour is showing" and "the tour correctly had
 *  nothing to show" indistinguishable. They are here so the fixture is the real
 *  case: the targets EXIST and are still unreachable, because the game is
 *  painted over them. */
function mountCoachTargets() {
  for (const target of ["bottom-nav", "more-button", "partner-invite"]) {
    const el = document.createElement("div");
    el.setAttribute("data-coach-target", target);
    document.body.append(el);
  }
}

describe("CoachMarks", () => {
  beforeEach(() => {
    // happy-dom defaults to 1024, which is exactly the width the component
    // treats as desktop, so without this the tour never arms and every
    // assertion below would pass for the wrong reason.
    window.innerWidth = PHONE_WIDTH;
    window.localStorage.removeItem(STORAGE_KEY);
    mountCoachTargets();
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
    window.localStorage.removeItem(STORAGE_KEY);
  });

  it("shows on an ordinary shell page, where its targets are reachable", async () => {
    renderAt("/app");
    await wait(ARM_DELAY_MS);
    expect(overlayUp()).toBe(true);
  });

  it("renders nothing on the full-screen game route", async () => {
    renderAt("/app/games/runner");
    await wait(ARM_DELAY_MS);
    // Not "smaller", and not "behind": absent. The tour's own targets are
    // covered by the game surface, so there is nothing it could usefully point
    // at — and a swallower over a game is not a worse overlay, it is an
    // unplayable screen.
    expect(overlayUp()).toBe(false);
  });

  it("defers the tour on the game route instead of completing it", async () => {
    renderAt("/app/games/runner");
    await wait(ARM_DELAY_MS);
    // The distinction that matters: suppressing the overlay must not write the
    // completion flag, or a player who opened one game on their phone would
    // silently never see the tour that teaches the shell they have to navigate
    // back into. Deferral is the whole point.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("still suppresses it on a nested path under the game route", async () => {
    // A prefix match has to include the separator, so the rule cannot be
    // decided by a substring that happens to match the next route added
    // alongside it.
    renderAt("/app/games/runner/");
    await wait(ARM_DELAY_MS);
    expect(overlayUp()).toBe(false);
  });

  it("leaves the other games routes alone — they are ordinary shell pages", async () => {
    // A blanket `/app/games` prefix would have thrown away the tour on the hub
    // and on the quiz/markets management pages, which scroll and show the very
    // nav the tour describes. Only a route that hides the shell is exempt.
    renderAt("/app/games");
    await wait(ARM_DELAY_MS);
    expect(overlayUp()).toBe(true);
  });
});
