// Lightweight "new device" detection for the security-alert email.
//
// We don't store raw UA or IP — those are PII under GDPR. Instead, each
// device gets a SHA-256 fingerprint over `ua-family + ip-first-two-octets`,
// truncated to 16 hex chars. That's enough to distinguish "same recipient,
// different machine" without identifying the specific browser or pinpointing
// the user beyond a /16 subnet (city-level).
//
// Storage is an inline JSON array on `users.known_devices_json`, capped to
// the most recent KNOWN_DEVICE_CAP entries. No new table — every read/write
// already goes through a single users row, and the list is bounded.

import { createHash } from "node:crypto";
import { db, now } from "../db";

const KNOWN_DEVICE_CAP = 10;

export type DeviceCheckResult =
  | { kind: "first" } // user has no prior devices recorded → silently register, no alert
  | { kind: "existing" } // fingerprint matches a known device → bump last_seen
  | { kind: "new" }; // recognised user, unknown device → caller should alert

interface KnownDevice {
  fp: string;
  last_seen_at: number;
}

interface UserRow {
  known_devices_json: string | null;
}

/** Compute the privacy-preserving device fingerprint. The UA family is the
 *  first token of the User-Agent header (`Mozilla/5.0` becomes `Mozilla` —
 *  blunt, but consistent across browser updates). IP /16 prefix is the
 *  first two octets (`203.0.113.42` → `203.0`). */
export function deviceFingerprint(userAgent: string | null, ip: string | null): string {
  const uaFamily = (userAgent ?? "").split(/[\s/]/)[0] ?? "unknown";
  const ipPrefix = ipFirstTwoOctets(ip);
  return createHash("sha256").update(`${uaFamily}|${ipPrefix}`).digest("hex").slice(0, 16);
}

function ipFirstTwoOctets(ip: string | null): string {
  if (!ip) return "unknown";
  // IPv4 with optional port; IPv6 keeps the first two groups.
  const trimmed =
    ip
      .replace(/^::ffff:/, "")
      .split(",")[0]
      ?.trim() ?? "";
  if (trimmed.includes(":")) {
    // IPv6 → first two groups.
    return trimmed.split(":").slice(0, 2).join(":") || "unknown";
  }
  const parts = trimmed.split(".");
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return "unknown";
}

/** Check (and update) the known-device list for a user. Returns:
 *  - `first` when this is the very first device the user has signed in from.
 *    The fingerprint is recorded but no alert should fire — otherwise every
 *    new user would get a "new device" mail about themselves.
 *  - `existing` when the fingerprint is already in the list; `last_seen_at`
 *    is bumped to now.
 *  - `new` when the user has prior devices but not this one. Caller should
 *    fire the `new_device_signin` security mail.
 */
export function recordKnownDevice(userId: number, fingerprint: string): DeviceCheckResult {
  const row = db.prepare("SELECT known_devices_json FROM users WHERE id = ?").get(userId) as
    | UserRow
    | undefined;
  if (!row) return { kind: "existing" }; // user gone — nothing to do

  const devices = parseDevices(row.known_devices_json);
  const ts = now();
  const idx = devices.findIndex((d) => d.fp === fingerprint);

  if (idx >= 0) {
    devices[idx]!.last_seen_at = ts;
    persistDevices(userId, devices);
    return { kind: "existing" };
  }

  const firstSeen = devices.length === 0;
  devices.unshift({ fp: fingerprint, last_seen_at: ts });
  // Cap to the most recent KNOWN_DEVICE_CAP so a long-lived account doesn't
  // accumulate fingerprints from a decade of one-time devices.
  if (devices.length > KNOWN_DEVICE_CAP) devices.length = KNOWN_DEVICE_CAP;
  persistDevices(userId, devices);
  return firstSeen ? { kind: "first" } : { kind: "new" };
}

function parseDevices(raw: string | null): KnownDevice[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d): d is KnownDevice =>
        typeof d === "object" &&
        d !== null &&
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
