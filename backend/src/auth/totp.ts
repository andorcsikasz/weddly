// RFC 6238 TOTP verifier used only for privileged application step-up. Secrets
// are deployment variables keyed by admin email; they never enter SQLite,
// logs, API responses, or the frontend bundle.

import { createHmac, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

function decodeBase32(raw: string): Buffer {
  const input = raw.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function codeAt(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Return the accepted time-step counter, or null. ±1 step tolerates modest
 * device clock drift; elevateSession atomically rejects counter replay. */
export function verifyTotp(secretBase32: string, code: string, atMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = decodeBase32(secretBase32);
  if (secret.length < 16) throw new Error("TOTP secret must contain at least 128 bits");
  const supplied = Buffer.from(code, "ascii");
  const current = Math.floor(atMs / 1000 / STEP_SECONDS);
  for (const delta of [-1, 0, 1]) {
    const counter = current + delta;
    const expected = Buffer.from(codeAt(secret, counter), "ascii");
    if (timingSafeEqual(supplied, expected)) return counter;
  }
  return null;
}

/** Test/provisioning helper. Do not expose through an HTTP route. */
export function totpCode(secretBase32: string, atMs = Date.now()): string {
  return codeAt(decodeBase32(secretBase32), Math.floor(atMs / 1000 / STEP_SECONDS));
}
