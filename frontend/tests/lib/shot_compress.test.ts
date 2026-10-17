import { describe, expect, test } from "bun:test";
import {
  encodeUnderBudget,
  fitLongEdge,
  SHOT_MAX_BYTES,
  SHOT_QUALITY_LADDER,
} from "../../src/lib/shot_compress";

describe("fitLongEdge", () => {
  test("brings a landscape frame's width down to 1600, keeping the ratio", () => {
    expect(fitLongEdge(1920, 1440)).toEqual({ width: 1600, height: 1200 });
  });

  test("brings a portrait frame's height down to 1600", () => {
    expect(fitLongEdge(1440, 1920)).toEqual({ width: 1200, height: 1600 });
  });

  test("leaves a frame already inside the bound alone, never upscaling", () => {
    expect(fitLongEdge(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(fitLongEdge(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  test("rounds to whole pixels and never collapses a side to zero", () => {
    expect(fitLongEdge(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitLongEdge(1601, 1)).toEqual({ width: 1600, height: 1 });
  });
});

/** A fake JPEG encoder: the size falls as quality falls, like the real one. */
function encoderFor(sizeAt: (q: number) => number | null) {
  const asked: number[] = [];
  const encode = async (q: number) => {
    asked.push(q);
    const size = sizeAt(q);
    return size === null ? null : new Blob([new Uint8Array(size)], { type: "image/jpeg" });
  };
  return { encode, asked };
}

describe("encodeUnderBudget", () => {
  test("a typical shot costs one encode at the top rung", async () => {
    const { encode, asked } = encoderFor(() => 450_000);
    const blob = await encodeUnderBudget(encode);
    expect(blob?.size).toBe(450_000);
    expect(asked).toEqual([SHOT_QUALITY_LADDER[0]]);
  });

  test("a busy shot steps down until it fits, and stops there", async () => {
    // 0.85 -> 1.6 MB, 0.75 -> 1.2 MB, 0.65 -> 0.9 MB
    const { encode, asked } = encoderFor((q) => Math.round(q * q * 2_200_000));
    const blob = await encodeUnderBudget(encode);
    expect(blob?.size).toBeLessThanOrEqual(SHOT_MAX_BYTES);
    expect(asked).toEqual([0.85, 0.75, 0.65]);
  });

  test("a shot that never fits still goes out, as the smallest encode", async () => {
    const { encode, asked } = encoderFor((q) => Math.round(3_000_000 * q));
    const blob = await encodeUnderBudget(encode);
    expect(asked).toEqual([...SHOT_QUALITY_LADDER]);
    expect(blob?.size).toBe(Math.round(3_000_000 * 0.45));
  });

  test("an encoder that fails on one rung is not fatal", async () => {
    const { encode } = encoderFor((q) => (q === 0.85 ? null : 500_000));
    expect((await encodeUnderBudget(encode))?.size).toBe(500_000);
  });

  test("an encoder that produces nothing at all yields null, not an empty shot", async () => {
    const { encode } = encoderFor(() => null);
    expect(await encodeUnderBudget(encode)).toBeNull();
  });
});
