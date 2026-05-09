// Short, public, human-friendly invite codes. Avoid 0/O/1/I/L for legibility.
import { randomBytes } from "node:crypto";
import { INVITE_CODE_LENGTH } from "@shared/types";

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
