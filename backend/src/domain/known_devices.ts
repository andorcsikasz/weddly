// "New device" detection for the security-alert email.
//
// WHAT COUNTS AS A DEVICE. The browser mints a random id once and keeps it in
// localStorage, sending it back as `X-Weddly-Device`. That id IS the device:
// it survives IP changes, network switches, VPNs and sign-out, so signing back
// in on your own laptop is recognised as the same machine. When the header is
// absent (a non-browser client, an old build, curl) we fall back to a parsed
// User-Agent (browser family + OS family), which is coarse but still a property
// of the machine rather than of where it happens to be sitting.
//
// The IP address is deliberately NOT part of the identity. It used to be, and
// it was wrong in both directions: a dynamic-IP re-lease or a Wi-Fi/mobile
// switch alerted on your own daily driver, while a different browser on the
// same subnet was silently accepted as "known" and never alerted at all.
//
// We never store the raw id, UA or IP - those are PII under GDPR. Each device
// is a SHA-256 truncated to 16 hex chars. Storage is an inline JSON array on
// `users.known_devices_json`, capped to KNOWN_DEVICE_CAP entries and evicted
// least-recently-SEEN first.

import { createHash } from "node:crypto";
import type { Ctx } from "../lib/http";
import { CONFIG } from "../config";
import { db, now } from "../db";
import { sendKind } from "./emails/send";

const KNOWN_DEVICE_CAP = 20;

/** Bumped whenever the fingerprint INPUTS change. Entries written by an older
 *  formula can never match the new one, so on a version bump the stored list is
 *  discarded and the current device is re-seeded silently. Without this, every
 *  existing user would receive one "new device" mail purely because we changed
 *  how the hash is computed. */
const DEVICE_FORMAT_VERSION = 2;

/** At most one new-device alert per user per window. A backstop: the identity
 *  is stable now, but a client that cannot persist the device id (private
 *  windows, storage blocked, a scripted client) would otherwise be able to
 *  generate one mail per sign-in. */
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Guards against a hostile or broken client sending a huge header. */
const MAX_DEVICE_ID_LEN = 200;

export type DeviceCheckResult =
  | { kind: "first" } // no prior devices recorded -> register silently, no alert
  | { kind: "existing" } // fingerprint matches a known device -> bump last_seen
  | { kind: "new" }; // recognised user, unknown device -> caller should alert

interface KnownDevice {
  /** Format version the `fp` was computed under. */
  v: number;
  fp: string;
  last_seen_at: number;
}

interface UserRow {
  known_devices_json: string | null;
}

/** Browser family from a User-Agent, dependency-free. Order matters: Edge and
 *  Opera both also claim "Chrome", and every mainstream browser still claims
 *  "Mozilla" (which is why the previous "first token" approach collapsed them
 *  all into one value and made the UA half of the fingerprint inert). */
function browserFamily(ua: string): string {
  if (/\bEdg(?:e|A|iOS)?\//.test(ua)) return "edge";
  if (/\bOPR\/|\bOpera\//.test(ua)) return "opera";
  if (/\bSamsungBrowser\//.test(ua)) return "samsung";
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return "firefox";
  if (/\bCriOS\//.test(ua)) return "chrome";
  if (/\bChrome\//.test(ua)) return "chrome";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "safari";
  return "other";
}

/** OS family from a User-Agent. Coarse on purpose: it must not change when the
 *  user takes an OS point-update, or every patch Tuesday would alert. */
function osFamily(ua: string): string {
  if (/\bWindows NT\b/.test(ua)) return "windows";
  if (/\biPhone\b|\biPad\b|\biPod\b/.test(ua)) return "ios";
  if (/\bAndroid\b/.test(ua)) return "android";
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return "macos";
  if (/\bCrOS\b/.test(ua)) return "chromeos";
  if (/\bLinux\b/.test(ua)) return "linux";
  return "other";
}

/** Normalise the client-supplied device id. Returns null when absent or
 *  implausible, so the caller falls back to the UA fingerprint. */
function normaliseDeviceId(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DEVICE_ID_LEN) return null;
  return trimmed;
}

/** Privacy-preserving device fingerprint.
 *
 *  A client-supplied device id wins outright: it is the only input that is
 *  genuinely per-machine and stable across networks. The UA fallback keeps
 *  headless/legacy clients working, at the cost of not distinguishing two
 *  identical browser+OS combinations.
 *
 *  Note there is no security downside to trusting the client id here: it can
 *  only ever SUPPRESS an alert, and only when it matches an id this user has
 *  signed in with before. An attacker on a stolen password does not know the
 *  victim's device id, so their random (or absent) id fails to match and the
 *  alert fires. */
export function deviceFingerprint(deviceId: string | null, userAgent: string | null): string {
  const did = normaliseDeviceId(deviceId);
  const material = did
    ? `did|${did}`
    : `ua|${browserFamily(userAgent ?? "")}|${osFamily(userAgent ?? "")}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/** Check (and update) the known-device list for a user. Returns:
 *  - `first` when the user has no recorded devices under the CURRENT format
 *    version. The fingerprint is recorded but no alert should fire, so neither
 *    a brand-new account nor a format migration mails the user about itself.
 *  - `existing` when the fingerprint is already known; `last_seen_at` is bumped.
 *  - `new` when the user has prior devices but not this one.
 */
export function recordKnownDevice(userId: number, fingerprint: string): DeviceCheckResult {
  const row = db.prepare("SELECT known_devices_json FROM users WHERE id = ?").get(userId) as
    | UserRow
    | undefined;
  if (!row) return { kind: "existing" }; // user gone - nothing to do

  const devices = parseDevices(row.known_devices_json);
  const ts = now();
  const idx = devices.findIndex((d) => d.fp === fingerprint);

  if (idx >= 0) {
    devices[idx]!.last_seen_at = ts;
    persistDevices(userId, devices);
    return { kind: "existing" };
  }

  const firstSeen = devices.length === 0;
  devices.push({ v: DEVICE_FORMAT_VERSION, fp: fingerprint, last_seen_at: ts });
  // Evict least-recently-SEEN, not least-recently-added: the previous version
  // truncated by insertion order, so a user with many one-off devices could
  // evict the daily driver they were still using and get re-alerted on it.
  if (devices.length > KNOWN_DEVICE_CAP) {
    devices.sort((a, b) => b.last_seen_at - a.last_seen_at);
    devices.length = KNOWN_DEVICE_CAP;
  }
  persistDevices(userId, devices);
  return firstSeen ? { kind: "first" } : { kind: "new" };
}

/** Entries from an older format version are dropped, which makes the next
 *  sign-in read as `first` (silent) rather than `new` (mail). */
function parseDevices(raw: string | null): KnownDevice[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is KnownDevice =>
        typeof d === "object" &&
        d !== null &&
        (d as KnownDevice).v === DEVICE_FORMAT_VERSION &&
        typeof (d as KnownDevice).fp === "string" &&
        typeof (d as KnownDevice).last_seen_at === "number",
    );
  } catch {
    return [];
  }
}

function persistDevices(userId: number, devices: KnownDevice[]): void {
  db.prepare("UPDATE users SET known_devices_json = ? WHERE id = ?").run(
    JSON.stringify(devices),
    userId,
  );
}

/** True when the user has not been alerted inside the cooldown window; stamps
 *  the clock as a side effect so concurrent logins can't both pass. */
function claimAlertSlot(userId: number): boolean {
  const row = db.prepare("SELECT new_device_alert_at FROM users WHERE id = ?").get(userId) as
    | { new_device_alert_at: number | null }
    | undefined;
  const ts = now();
  if (row?.new_device_alert_at != null && ts - row.new_device_alert_at < ALERT_COOLDOWN_MS) {
    return false;
  }
  db.prepare("UPDATE users SET new_device_alert_at = ? WHERE id = ?").run(ts, userId);
  return true;
}

/** Timestamp for the alert body. Deliberately locale-neutral (`2026-07-20
 *  14:32`): the mail renders per-recipient HU or EN, and the previous
 *  hard-coded `toLocaleString("hu-HU")` printed a Hungarian date inside the
 *  English copy. */
function signedInAtLabel(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}

/** Single entry point used by every sign-in path (password, Google, Apple):
 *  fingerprint the request, record it, and mail the user only when this is a
 *  genuinely unrecognised device and the cooldown allows it. */
export function alertOnNewDevice(
  ctx: Ctx,
  user: { id: number; email: string; full_name: string },
): void {
  const fp = deviceFingerprint(
    ctx.req.headers.get("x-weddly-device"),
    ctx.req.headers.get("user-agent"),
  );
  const result = recordKnownDevice(user.id, fp);
  if (result.kind !== "new") return;
  if (!claimAlertSlot(user.id)) return;
  void sendKind(
    "new_device_signin",
    {
      signedInAt: signedInAtLabel(now()),
      forgotUrl: `${CONFIG.frontendBaseUrl}/forgot-password`,
    },
    { user: { id: user.id, email: user.email, full_name: user.full_name } },
  );
}
