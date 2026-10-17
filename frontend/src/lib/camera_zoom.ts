// Zoom for the guest camera, as the guest sees it: one number, 0.5x to 5x,
// like the phone's own camera app. Underneath it is up to three different
// mechanisms, and which ones a phone has is only known at runtime:
//
//   - Hardware zoom on the track (`zoom` in getCapabilities). Chrome on
//     Android exposes it; on a phone with a logical multi-camera its range
//     starts below 1, so 0.5 is just a zoom value on the same stream.
//   - A separate ultra-wide lens. iOS Safari lists it as its own camera
//     ("Back Ultra Wide Camera"), so 0.5 means opening that one instead.
//   - Digital zoom: a centred crop, applied the same way to the preview (a CSS
//     scale) and to the saved shot (the crop in renderShot), so what the guest
//     framed is what is kept. Always available, which is why 2x and pinch
//     work on every phone, and why 0.5 is the only preset that can be absent.
//
// Everything here is pure so the mapping can be tested without a camera.

export const ZOOM_MAX_DIGITAL = 5;
export const ULTRA_WIDE_ZOOM = 0.5;

export interface ZoomRange {
  min: number;
  max: number;
}

/** What the camera should do to show displayed zoom `z`. */
export interface ZoomPlan {
  /** Which back lens: the default one, or the separate ultra-wide. */
  lens: "main" | "ultra";
  /** A value for the track's `zoom` constraint, or null to leave it alone. */
  hardware: number | null;
  /** Centred crop factor on top of whatever the lens/hardware delivers. */
  digital: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The ultra-wide back camera, if the phone lists one. Labels are only
 *  populated after camera permission, which is why this runs after the first
 *  stream is live. A front lens never qualifies: 0.5 is a back-camera idea. */
export function findUltraWideDeviceId(devices: readonly MediaDeviceInfo[]): string | null {
  for (const d of devices) {
    if (d.kind !== "videoinput" || !d.deviceId) continue;
    const label = d.label.toLowerCase();
    if (/front|user|selfie|facetime/.test(label)) continue;
    if (/ultra[\s-]?wide|ultrawide|0[.,]5x?\b/.test(label)) return d.deviceId;
  }
  return null;
}

/** The lowest zoom this phone can actually show. */
export function minZoom(mainHardware: ZoomRange | null, ultraDeviceId: string | null): number {
  if (mainHardware && mainHardware.min < 1) return Math.max(ULTRA_WIDE_ZOOM, mainHardware.min);
  return ultraDeviceId ? ULTRA_WIDE_ZOOM : 1;
}

export function maxZoom(mainHardware: ZoomRange | null): number {
  return Math.max(ZOOM_MAX_DIGITAL, mainHardware?.max ?? 1);
}

/** Map a displayed zoom onto lens + hardware + crop. `mainHardware` is the
 *  zoom range of the MAIN lens's track (the ultra-wide is used only as the
 *  fixed 0.5 step, so its own range never matters). */
export function planZoom(
  z: number,
  mainHardware: ZoomRange | null,
  ultraDeviceId: string | null,
): ZoomPlan {
  const target = clamp(z, minZoom(mainHardware, ultraDeviceId), maxZoom(mainHardware));
  // A logical camera: below 1 is just a hardware zoom value on the same track.
  if (mainHardware && mainHardware.min < 1) {
    const hardware = clamp(target, mainHardware.min, mainHardware.max);
    return { lens: "main", hardware, digital: Math.max(1, target / hardware) };
  }
  if (target < 1) return { lens: "ultra", hardware: null, digital: 1 };
  if (mainHardware && mainHardware.max > 1) {
    const hardware = clamp(target, Math.max(1, mainHardware.min), mainHardware.max);
    return { lens: "main", hardware, digital: Math.max(1, target / hardware) };
  }
  return { lens: "main", hardware: null, digital: target };
}

/** The tap targets under the viewfinder. 0.5 only where the phone can do it. */
export function zoomPresets(min: number): number[] {
  return min < 1 ? [ULTRA_WIDE_ZOOM, 1, 2] : [1, 2];
}

/** Which preset reads as "selected" for the current zoom: the highest one at
 *  or below it, so a pinch to 1.6x lights the 1 and labels it 1.6x, the way
 *  the phone's own camera does. */
export function activePreset(z: number, presets: readonly number[]): number {
  let active = presets[0] ?? 1;
  for (const p of presets) if (z + 1e-6 >= p) active = p;
  return active;
}

/** "0.5", "1", "1.6", "2": one decimal at most, no trailing zero. */
export function formatZoom(z: number): string {
  return String(Math.round(z * 10) / 10);
}

/** New zoom for a pinch, from the zoom and finger spread when it started.
 *  Multiplicative, so spreading twice as far doubles the zoom at any level. */
export function pinchZoom(
  startZoom: number,
  startDistance: number,
  distance: number,
  range: ZoomRange,
): number {
  if (startDistance <= 0) return startZoom;
  return clamp(startZoom * (distance / startDistance), range.min, range.max);
}

/** The centred source rectangle a digital zoom keeps. */
export function digitalCrop(
  width: number,
  height: number,
  factor: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const f = Math.max(1, factor);
  const sw = width / f;
  const sh = height / f;
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh };
}
