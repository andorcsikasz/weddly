// Weddly Camera tryout codes, the bits both the /camera/start form and the
// film page need: the same normalising the backend does (so a link we build
// is one the post-signup allowlist accepts) and one message per refusal.

import { ApiError } from "./api";

/** Upper-case, no spaces: what the backend stores. Null when it cannot be a code. */
export function normalizeFilmCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{4,32}$/.test(code) ? code : null;
}

const REFUSALS = new Set([
  "code_not_found",
  "code_expired",
  "code_revoked",
  "code_used_up",
  "code_already_redeemed",
  "cap_already_covered",
  "invalid_code",
]);

/** The i18n key that explains why a check or redeem failed. */
export function filmCodeErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return "camera.code_error_rate";
    const code = (err.detail as { code?: string } | undefined)?.code;
    if (code && REFUSALS.has(code)) return `camera.code_error_${code}`;
  }
  return "common.error_generic";
}
