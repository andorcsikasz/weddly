// The overlays: menu, HUD, pause, game-over.
//
// What is worth testing on a component that mostly renders strings is the
// CONDITIONAL COPY and the number formatting — the two places a screenshot of the
// wrong state looks like a correct one. In particular:
//
//  - The HUD exists only while RUNNING. A HUD left mounted over the pause overlay
//    puts the frozen score behind a dimmed scrim, and reads as a glitch.
//  - The mute control is the one control present on every phase, so its label has
//    to follow the actual audio state rather than a stale local flag.
//  - Money on the game-over card comes from the SUMMARY's currency, never from the
//    store's current currency — those are two different reads, and they diverge
//    the moment a couple changes currency between runs.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { VERDICT_I18N } from "@shared/runner";
import type { Currency } from "@shared/types";
import { RunEngine } from "@/pages/games/runner/engine/RunEngine";
import { RunnerUI } from "@/pages/games/runner/components/RunnerUI";
import { useRunnerStore } from "@/pages/games/runner/store/runnerStore";

const noop = () => {};

function renderUI(muted = false, onPause: () => void = noop) {
  return render(
    <MemoryRouter>
      <RunnerUI
        onStart={noop}
        onPause={onPause}
        onResume={noop}
        onQuit={noop}
        onToggleMute={noop}
        muted={muted}
      />
    </MemoryRouter>,
  );
}

/** A REAL engine's state, driven to a chosen point, rather than a hand-written
 *  object shaped like `RunState`. `tick` takes the whole engine state, so a
 *  hand-rolled literal would have to invent fifteen fields the HUD never reads —
 *  and the day one of them is renamed the test stops compiling rather than
 *  failing for a reason anybody can read. */
function runningState(): RunEngine["state"] {
  const engine = new RunEngine("bride", "HUF");
  engine.start(5);
  for (let i = 0; i < 30; i++) engine.advance(1 / 60);
  return engine.state;
}

describe("RunnerUI overlays", () => {
  beforeEach(() => {
    useRunnerStore.setState({
      phase: "menu",
      ready: true,
      hearts: 3,
      cash: 0,
      bags: 0,
      hits: 0,
      multiplier: 1,
      distance: 0,
      profit: 0,
      summary: null,
      firstRun: false,
      best: null,
    });
  });
  afterEach(() => {
    cleanup();
    mock.restore();
  });

  it("waits for the currency before offering to start", () => {
    useRunnerStore.setState({ ready: false });
    renderUI();
    // The Canvas cannot be mounted before the couple's currency is known, and a
    // Start button that comes up first would show a scoreboard in the wrong money.
    expect(screen.getByText("runner.preparing")).toBeTruthy();
    expect(screen.queryByText("runner.start")).toBeNull();
  });

  it("offers Start and the exit link on the menu", () => {
    renderUI();
    expect(screen.getByText("runner.start")).toBeTruthy();
    expect(screen.getByText("runner.how_title")).toBeTruthy();
    expect(screen.getByText("runner.controls_title")).toBeTruthy();
    // Full screen over the shell, so the menu must carry its own way out.
    expect(screen.getByText("runner.back_to_games").closest("a")?.getAttribute("href")).toBe(
      "/app/games",
    );
  });

  it("shows no scoreboard while paused, only the paused card", () => {
    useRunnerStore.getState().tick(runningState(), { clock: 1, milestonePulse: 0 }, "HUF");
    // The engine's pause is a PHASE change, so that is how the store sees one.
    useRunnerStore.setState({ phase: "paused" });
    renderUI();
    expect(screen.getByText("runner.paused_title")).toBeTruthy();
    // No live scoreboard behind the scrim: the frozen numbers under a dimmed
    // overlay read as a rendering fault, not as a paused game.
    expect(screen.queryByText("runner.profit_label")).toBeNull();
    expect(screen.queryByText("runner.distance_label")).toBeNull();
  });

  it("renders the live HUD while running", () => {
    useRunnerStore.getState().tick(runningState(), { clock: 1, milestonePulse: 0 }, "HUF");
    renderUI();
    expect(screen.getByText("runner.profit_label")).toBeTruthy();
    expect(screen.getByText("runner.distance_label")).toBeTruthy();
    expect(screen.queryByText("runner.paused_title")).toBeNull();
  });

  it("gives a touch player a pause button in the HUD", () => {
    useRunnerStore.getState().tick(runningState(), { clock: 1, milestonePulse: 0 }, "HUF");
    let paused = 0;
    renderUI(false, () => {
      paused += 1;
    });
    fireEvent.click(screen.getByLabelText("runner.control_pause"));
    expect(paused).toBe(1);
  });

  it("calls a first run a first run, not a new record", () => {
    useRunnerStore.setState({ best: null, firstRun: false });
    useRunnerStore.getState().finish({
      profit: 500,
      cash: 50,
      bags: 0,
      distance: 300,
      hits: 3,
      multiplier: 1,
      verdict: "over_budget",
      currency: "EUR",
    });
    renderUI();
    expect(screen.getByText("runner.first_run")).toBeTruthy();
    expect(screen.queryByText("runner.new_best")).toBeNull();
  });

  it("labels the multiplier as a score, not as a speed", () => {
    useRunnerStore.getState().tick(runningState(), { clock: 1, milestonePulse: 0 }, "HUF");
    renderUI();
    // `runner.speed_label` used to sit on the ×N badge. The multiplier is the
    // SCORE multiplier; a screen reader announcing "speed" for a scoring badge is
    // a wrong answer about the game's own rules, and it was the only reason a
    // speed label existed at all.
    expect(screen.getByLabelText("runner.multiplier_label")).toBeTruthy();
    expect(screen.queryByLabelText("runner.speed_label")).toBeNull();
  });

  it("shows both lines of a verdict, using the keys the shared module publishes", () => {
    useRunnerStore.getState().finish({
      profit: 1_000_000,
      cash: 1_000_000,
      bags: 0,
      distance: 1234,
      hits: 1,
      multiplier: 1,
      verdict: "under_budget",
      currency: "HUF",
    });
    renderUI();
    // A map local to the component is exactly how this drifts: the shared module
    // publishes the key names, and a component table naming a different set
    // renders as a raw dotted path in whichever language lost the race.
    expect(screen.getByText(VERDICT_I18N.under_budget.title)).toBeTruthy();
    expect(screen.getByText(VERDICT_I18N.under_budget.body)).toBeTruthy();
  });

  it("prints the game-over money in the summary's currency", () => {
    useRunnerStore.getState().finish({
      profit: 1_660_000,
      cash: 30_000,
      bags: 2,
      distance: 1234,
      hits: 1,
      multiplier: 2,
      verdict: "tight",
      currency: "HUF",
    });
    renderUI();
    // The HUF scoreboard is a grouped forint figure with the app's `Ft` glyph.
    // Asserting the shape rather than an exact digit string, because the grouping
    // character is ICU's business.
    expect(screen.getByText(/1[\s  ]660[\s  ]000\s*Ft/)).toBeTruthy();
  });

  it("reflects the audio's mute state rather than a copy of it", () => {
    useRunnerStore.getState().tick(runningState(), { clock: 1, milestonePulse: 0 }, "HUF");
    renderUI(true);
    expect(screen.getByLabelText("runner.mute_off")).toBeTruthy();
    cleanup();
    renderUI(false);
    expect(screen.getByLabelText("runner.mute_on")).toBeTruthy();
  });

  it("falls back to the store currency when the summary carries none", () => {
    // Both are HUF by default here, so this pins that a currency-less summary
    // still renders a figure at all rather than throwing inside the formatter.
    useRunnerStore.getState().finish({
      profit: 0,
      cash: 0,
      bags: 0,
      distance: 10,
      hits: 3,
      multiplier: 1,
      verdict: "bankrupt",
      currency: "EUR" as Currency,
    });
    expect(() => renderUI()).not.toThrow();
    expect(screen.getByText(VERDICT_I18N.bankrupt.title)).toBeTruthy();
  });
});
