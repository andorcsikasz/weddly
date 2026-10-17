import { describe, expect, test } from "bun:test";
import {
  activePreset,
  digitalCrop,
  findUltraWideDeviceId,
  formatZoom,
  maxZoom,
  minZoom,
  pinchZoom,
  planZoom,
  zoomPresets,
} from "../../src/lib/camera_zoom";

function cam(label: string, deviceId = label): MediaDeviceInfo {
  return { kind: "videoinput", label, deviceId, groupId: "" } as MediaDeviceInfo;
}

describe("findUltraWideDeviceId", () => {
  test("finds the iPhone's separately listed ultra-wide", () => {
    const devices = [
      cam("Front Camera"),
      cam("Back Camera"),
      cam("Back Ultra Wide Camera", "uw"),
      cam("Back Telephoto Camera"),
    ];
    expect(findUltraWideDeviceId(devices)).toBe("uw");
  });

  test("never picks a front lens, and finds nothing on a one-lens phone", () => {
    expect(findUltraWideDeviceId([cam("Front Ultra Wide Camera")])).toBeNull();
    expect(findUltraWideDeviceId([cam("camera2 0, facing back"), cam("Front Camera")])).toBeNull();
  });

  test("ignores devices with no label yet (before permission) or no id", () => {
    expect(findUltraWideDeviceId([cam(""), cam("Back Ultra Wide Camera", "")])).toBeNull();
  });
});

describe("planZoom", () => {
  test("a phone with nothing but a camera: 0.5 is unavailable, zoom is a crop", () => {
    expect(minZoom(null, null)).toBe(1);
    expect(zoomPresets(minZoom(null, null))).toEqual([1, 2]);
    expect(planZoom(2, null, null)).toEqual({ lens: "main", hardware: null, digital: 2 });
    // Asking for 0.5 anyway clamps to 1 rather than inventing a lens.
    expect(planZoom(0.5, null, null)).toEqual({ lens: "main", hardware: null, digital: 1 });
  });

  test("iPhone: 0.5 opens the ultra-wide, 1 and up stay on the main lens", () => {
    expect(zoomPresets(minZoom(null, "uw"))).toEqual([0.5, 1, 2]);
    expect(planZoom(0.5, null, "uw")).toEqual({ lens: "ultra", hardware: null, digital: 1 });
    expect(planZoom(1, null, "uw")).toEqual({ lens: "main", hardware: null, digital: 1 });
  });

  test("Android logical camera: 0.5 is a hardware zoom value on the same lens", () => {
    const range = { min: 0.5, max: 8 };
    expect(zoomPresets(minZoom(range, null))).toEqual([0.5, 1, 2]);
    expect(planZoom(0.5, range, null)).toEqual({ lens: "main", hardware: 0.5, digital: 1 });
    expect(planZoom(2, range, null)).toEqual({ lens: "main", hardware: 2, digital: 1 });
  });

  test("hardware zoom runs out, the crop takes over the rest", () => {
    const range = { min: 1, max: 3 };
    expect(maxZoom(range)).toBe(5);
    expect(planZoom(5, range, null)).toEqual({ lens: "main", hardware: 3, digital: 5 / 3 });
  });

  test("a phone whose hardware zoom goes past the digital ceiling keeps its range", () => {
    expect(maxZoom({ min: 1, max: 10 })).toBe(10);
  });
});

describe("presets and labels", () => {
  test("a pinch to 1.6 lights the 1, and reads 1.6", () => {
    expect(activePreset(1.6, [0.5, 1, 2])).toBe(1);
    expect(activePreset(0.5, [0.5, 1, 2])).toBe(0.5);
    expect(activePreset(2.4, [1, 2])).toBe(2);
    expect(formatZoom(1.6)).toBe("1.6");
    expect(formatZoom(1)).toBe("1");
    expect(formatZoom(1.649)).toBe("1.6");
  });
});

describe("pinchZoom", () => {
  test("spreading twice as far doubles the zoom, within range", () => {
    const range = { min: 1, max: 5 };
    expect(pinchZoom(1, 100, 200, range)).toBe(2);
    expect(pinchZoom(2, 100, 50, range)).toBe(1);
    expect(pinchZoom(3, 100, 400, range)).toBe(5);
    expect(pinchZoom(1, 100, 10, range)).toBe(1);
    expect(pinchZoom(1.5, 0, 50, range)).toBe(1.5);
  });
});

describe("digitalCrop", () => {
  test("keeps the centred 1/f of the frame", () => {
    expect(digitalCrop(1920, 1440, 2)).toEqual({ sx: 480, sy: 360, sw: 960, sh: 720 });
    expect(digitalCrop(1920, 1440, 1)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1440 });
    // Never a crop LARGER than the frame.
    expect(digitalCrop(1920, 1440, 0.5)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1440 });
  });
});
