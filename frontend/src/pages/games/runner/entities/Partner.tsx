/**
 * The other half of the couple, running one lane over.
 *
 * This is a `RunnerModel` with `detail="far"` and the opposite skin — one rig,
 * two skins, so there is no such thing as a faster character. What lives HERE is
 * the RELATIONSHIP between the two figures, which is the only reason this file
 * exists:
 *
 *  - They take the OUTER lane on the player's side, so the partner is always in
 *    frame from the chase camera and never between the player and the next row. A
 *    partner who crossed in front would be an obstacle the player has to learn to
 *    ignore, which is the one thing a runner must never ask.
 *  - They do NOT dodge. A second agent reading the track turns the game into a
 *    two-body puzzle; here they simply follow, which keeps the player's own
 *    decisions the only thing that matters.
 *  - They cheer on a milestone and wave through the invulnerability window after
 *    a hit, both read off the same `RunState` the rig already reads, so there is
 *    no celebration state here that can fall out of sync with the simulation.
 */

import { useMemo, useRef } from "react";
import { LANE_WIDTH } from "@shared/runner";
import type { RunnerCharacter, RunState } from "../engine/RunEngine";
import { RunnerModel, type RigInput } from "./RunnerModel";

/** Where the partner runs: the path's own edge, just past the outer lane's
 *  widest blocker (lane centre 1.7 + a 0.55 half-width limousine) and short of
 *  the shrub line at 2.9. A fixed edge rather than "one lane over from the
 *  player", because one lane over from the centre IS the outer lane, and the
 *  partner was running straight through the props in it. */
const OFFSET = LANE_WIDTH + 0.9;
/** Metres behind the player. Far enough to sit in the shot's lower third, close
 *  enough that a collision still reads as "that was me". */
const TRAIL = 3.2;

export interface PartnerProps {
  /** The skin the player is NOT. */
  character: RunnerCharacter;
  /** Read once a frame. */
  read: () => RunState;
}

export function Partner({ character, read }: PartnerProps) {
  /** The partner's own animation clock. It advances off the engine's, so it
   *  keeps time with the run, but it is not the engine's clock: a partner on the
   *  engine's exact phase would land every step in unison with the player and
   *  read as one two-legged creature. Half speed is enough to break the lockstep
   *  without reading as a different game. */
  const clock = useRef(0);

  const readRig = useMemo(
    () => (): RigInput => {
      const s = read();
      clock.current += 0.016;
      const airborne = s.y > 0.1;
      // A CHEER, not a jump: a small fast bounce that fires while the player is
      // in the air or above a ×2 multiplier. Coupling the partner's height to the
      // player's is what makes the two figures read as one celebration rather than
      // as two animations happening near each other.
      const cheering = airborne || s.multiplier > 1;
      const hop = cheering ? Math.abs(Math.sin(clock.current * 7)) * 0.34 : 0;
      // The partner runs one lane further out on the player's OWN side, and a
      // player sitting in the centre lane counts as being on the right. That tie
      // is the whole point of it: without one fixed answer the partner visibly
      // swaps sides every time the player returns to the middle, which reads as
      // a bug rather than as a person.
      const x = s.x < 0 ? -OFFSET : OFFSET;
      return {
        x,
        y: hop,
        z: -TRAIL,
        air: cheering ? Math.abs(Math.sin(clock.current * 7)) * 0.45 : 0,
        // The partner never slides. They are not dodging, so there is nothing to
        // duck.
        slide: 0,
        speed: s.cruiseSpeed,
        // The rig rolls by `laneDelta` radians-ish (it is meant to be a lane
        // ERROR of a few centimetres), so the metres between the two runners
        // laid the partner flat on their side. A small fixed angle toward the
        // player keeps the "running together" read without the tumble.
        laneDelta: x < 0 ? 0.12 : -0.12,
        clock: clock.current,
        // The partner does NOT flicker. The invulnerability window exists to tell
        // the player which body is protected, and flickering both of them says
        // that neither is.
        invuln: 0,
        celebrate: s.phase === "over" ? 1 : 0,
        running: s.phase === "running" || s.phase === "over",
        bob: 0,
      };
    },
    [read],
  );

  return <RunnerModel character={character} read={readRig} detail="far" scale={0.96} />;
}

export { OFFSET as PARTNER_OFFSET, TRAIL as PARTNER_TRAIL };
