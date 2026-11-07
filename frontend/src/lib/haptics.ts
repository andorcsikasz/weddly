// Short haptic taps, so the guest camera feels like a camera.
//
// Android browsers have navigator.vibrate. iOS Safari doesn't, but since
// iOS 18 toggling an <input type="checkbox" switch> plays the system haptic,
// so on iPhone we click a hidden one. That only works inside a tap, which is
// why callers fire it at the start of a gesture, not after an await.
// Everywhere else this does nothing.

export type Haptic = "tap" | "select" | "shutter" | "success" | "warning" | "error";

/** Vibration patterns (ms) for Android. */
const PATTERNS: Record<Haptic, number | number[]> = {
  tap: 8,
  select: 5,
  shutter: 12,
  success: [12, 60, 18],
  warning: [20, 80, 20],
  error: [30, 60, 30, 60, 30],
};

/** How many system taps iOS plays for each kind (one per toggle). */
const IOS_TAPS: Record<Haptic, number> = {
  tap: 1,
  select: 1,
  shutter: 1,
  success: 2,
  warning: 2,
  error: 3,
};

let iosSwitch: HTMLLabelElement | null = null;

function iosLabel(): HTMLLabelElement | null {
  if (iosSwitch?.isConnected) return iosSwitch;
  if (typeof document === "undefined") return null;
  const label = document.createElement("label");
  label.ariaHidden = "true";
  label.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;left:-9px;";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.append(input);
  document.body.append(label);
  iosSwitch = label;
  return label;
}

const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iP(hone|od|ad)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1));

/** Plays a short haptic. Safe to call anywhere; a no-op where unsupported. */
export function haptic(kind: Haptic = "tap") {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }
    if (!isIOS()) return;
    const label = iosLabel();
    if (!label) return;
    for (let i = 0; i < IOS_TAPS[kind]; i++) {
      setTimeout(() => label.click(), i * 90);
    }
  } catch {
    // Haptics are a nicety; never let them break a tap.
  }
}
