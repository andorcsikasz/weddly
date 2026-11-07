import { afterEach, describe, expect, test } from "bun:test";
import { haptic } from "../../src/lib/haptics";

const nav = globalThis.navigator as Navigator & { vibrate?: unknown };
const original = Object.getOwnPropertyDescriptor(nav, "vibrate");

afterEach(() => {
  if (original) Object.defineProperty(nav, "vibrate", original);
  else delete (nav as { vibrate?: unknown }).vibrate;
});

describe("haptic", () => {
  test("uses navigator.vibrate with the kind's pattern", () => {
    const calls: unknown[] = [];
    Object.defineProperty(nav, "vibrate", {
      configurable: true,
      value: (p: unknown) => calls.push(p),
    });
    haptic("shutter");
    haptic("success");
    expect(calls).toEqual([12, [12, 60, 18]]);
  });

  test("never throws, even when vibrate does", () => {
    Object.defineProperty(nav, "vibrate", {
      configurable: true,
      value: () => {
        throw new Error("blocked");
      },
    });
    expect(() => haptic("error")).not.toThrow();
  });
});
