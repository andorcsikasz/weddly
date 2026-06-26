// Short, public, human-friendly invite codes. Avoid 0/O/1/I/L for legibility.
import { randomBytes } from "node:crypto";
import { HOUSEHOLD_CODE_ALPHABET, HOUSEHOLD_CODE_LENGTH, INVITE_CODE_LENGTH } from "@shared/types";

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

/** Public reference codes for the two principal parties: organisers (couples)
 *  get "O" + 5 digits, vendors get "V" + 5 digits — e.g. `O48217`, `V09134`.
 *  Numeric-only after the prefix so they're easy to read aloud / type into a
 *  support form. The 5-digit space (100k) is far larger than the current user
 *  base; collisions are handled by a retry loop at the call site (see
 *  `uniqueOrganiserCode` / `uniqueVendorCode`), which throws loudly if it ever
 *  saturates rather than silently reusing a code. */
const PUBLIC_REF_DIGITS = 5;

function randomDigits(n: number): string {
  const bytes = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i++) {
    out += String(bytes[i]! % 10);
  }
  return out;
}

export function generateOrganiserCode(): string {
  return `O${randomDigits(PUBLIC_REF_DIGITS)}`;
}

export function generateVendorCode(): string {
  return `V${randomDigits(PUBLIC_REF_DIGITS)}`;
}

/** Household check-in code — Crockford base32, 8 chars (~40 bits of entropy).
 *  Bumped from the legacy 4-digit form in May 2026 because the share-with-
 *  guests workflow leaks the code into URLs the couple texts around, and a
 *  4-digit code is small enough that a curious neighbour could enumerate it.
 *  Uniqueness is per-couple and enforced at the call site (UNIQUE(couple_id,
 *  code)); rows from before the bump keep their original code shape and
 *  continue to resolve. Lookup is case-insensitive — codes are uppercased
 *  on write so simple `=` comparisons stay correct. */
export function generateHouseholdCode(): string {
  const alphabetLen = HOUSEHOLD_CODE_ALPHABET.length; // 32
  // Reject bytes in the top of the 0-255 range that don't divide cleanly into
  // 32 so the resulting symbol stays uniform. 256 / 32 = 8 cleanly, so every
  // byte maps via `b % 32` without bias — no rejection sample needed.
  // We still pull double the chars worth of entropy to keep things obvious.
  let out = "";
  // Pull enough random bytes in one shot; 32 bytes is plenty for 8 symbols
  // (it tolerates the modulo without bias since 256 % 32 === 0).
  const buf = randomBytes(HOUSEHOLD_CODE_LENGTH);
  for (let i = 0; i < HOUSEHOLD_CODE_LENGTH; i++) {
    out += HOUSEHOLD_CODE_ALPHABET[buf[i]! % alphabetLen];
  }
  return out;
}

/** Normalise a household code for lookup. Uppercases (Crockford is
 *  case-insensitive) and trims. Legacy 4-digit codes pass through unchanged
 *  (digits have no case). The Crockford "lookalike" remap (I→1, L→1, O→0)
 *  is intentionally NOT applied here because the generation alphabet excludes
 *  those glyphs, so a user typing one must have miskeyed — better to 404
 *  than to silently steer them to the wrong household. */
export function normalizeHouseholdCode(raw: string): string {
  return raw.trim().toUpperCase();
}
