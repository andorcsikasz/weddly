// Short, public, human-friendly invite codes. Avoid 0/O/1/I/L for legibility.
import { randomBytes } from "node:crypto";
import { HOUSEHOLD_CODE_LENGTH, INVITE_CODE_LENGTH } from "@shared/types";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Long, opaque, one-time-use partner-B invite token. */
export function generateInviteToken(): string {
  return randomBytes(24).toString("hex");
}

/** Memorable 4-digit household check-in code. Always in [1000, 9999] so it
 *  reads as a 4-digit number with no leading zero. Uniqueness is per-couple
 *  and enforced at the call site (UNIQUE(couple_id, code)). */
export function generateHouseholdCode(): string {
  // 9000 possible values; rejection sample so the distribution is uniform.
  // randomBytes is overkill here but consistent with the rest of the module.
  while (true) {
    const buf = randomBytes(2);
    const n = buf.readUInt16BE(0);
    // Reject the upper tail to avoid bias when mapping into a 9000-value range.
    if (n >= 65000) continue;
    const code = 1000 + (n % 9000);
    return String(code).padStart(HOUSEHOLD_CODE_LENGTH, "0");
  }
}
