/**
 * The bent world: the road winds left and right and rolls away over the
 * horizon, while the simulation underneath stays a straight three-lane track.
 *
 * This is the endless-runner trick (Subway Surfers, Animal Crossing): every
 * vertex is pushed sideways and down by the SQUARE of its distance from the
 * camera, after the model-view transform. Near the runner the offset is ~0, so
 * collision and what the player sees at their feet always agree; far away the
 * road visibly curves. Nothing in the engine knows the world is bent, which is
 * what keeps a curve from ever being able to change the outcome of a run.
 *
 * One pair of uniform objects is shared by every patched material, so moving
 * the curve is two number writes per frame, not a material update.
 */

import type * as THREE from "three";

export const bendUniforms = {
  uBendX: { value: 0 },
  uBendY: { value: 0 },
};

const HEADER = "uniform float uBendX;\nuniform float uBendY;\n";
const BEND = `#include <project_vertex>
{
  float bendD = min(0.0, mvPosition.z);
  mvPosition.x += uBendX * bendD * bendD;
  mvPosition.y += uBendY * bendD * bendD;
  gl_Position = projectionMatrix * mvPosition;
}`;

/** Patch one material, once. Materials whose shader has no `project_vertex`
 *  (sprites, the particle points) are left straight, which is invisible: they
 *  live near the runner, where the bend is zero. */
export function bendMaterial(material: THREE.Material): void {
  const data = material.userData as { bent?: boolean; noBend?: boolean };
  if (data.bent || data.noBend) return;
  data.bent = true;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    if (!shader.vertexShader.includes("#include <project_vertex>")) return;
    shader.uniforms.uBendX = bendUniforms.uBendX;
    shader.uniforms.uBendY = bendUniforms.uBendY;
    shader.vertexShader = HEADER + shader.vertexShader.replace("#include <project_vertex>", BEND);
  };
  // A distinct cache key, so a bent program is never handed to a straight
  // material of the same type (or the other way round).
  material.customProgramCacheKey = () => "runner-bend";
  material.needsUpdate = true;
}

/**
 * The curve at a travelled distance. Two slow sine waves of different periods
 * so the road never repeats a bend in a way the eye can learn, a permanent
 * gentle roll-off over the horizon, and a ramp-in so the opening straight is
 * straight while the player is still learning the controls.
 */
export function bendAt(distance: number): { x: number; y: number } {
  const ramp = Math.min(1, Math.max(0, (distance - 60) / 160));
  const x = (Math.sin(distance / 190) * 0.0034 + Math.sin(distance / 77 + 1.3) * 0.0011) * ramp;
  const y = -0.0007 - Math.max(0, Math.sin(distance / 260)) * 0.0006 * ramp;
  return { x, y };
}
