// Argon2id via Bun's built-in.
//
// We use Bun's default cost (memoryCost = 65536 KB, timeCost = 2) deliberately.
// That's above OWASP's 2024 minimum (m ≥ 19456, t ≥ 2 for Argon2id) and gives
// ~60ms hash + ~60ms verify on Apple-Silicon-class hardware — well below the
// 250ms perceptible-latency threshold even on login. A 100-user load run
// reported register p95 ≈ 336ms; that was 10-way concurrent CPU contention
// on 8 cores, not the per-call cost. See scripts/bench/argon2.ts for the
// reproducible per-call numbers and the trade-off curve before changing.

export async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}
