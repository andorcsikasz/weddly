// Where a new account should land once it has finished signing up.
//
// The anonymous vendor page ends every visit in a sign-up CTA, and a CTA that
// drops the visitor on the generic dashboard after email verification and
// onboarding has thrown away the one thing they told us: which vendor they came
// for. This remembers that vendor's internal page across the whole sign-up
// (register, verify email, onboarding) and hands it back exactly once.
//
// localStorage rather than a query string because the trip crosses an email
// link and a wizard; a query param would have to be threaded through both. The
// cost is that it does not follow a visitor who opens the verification link on
// another device, who simply lands on /app like everybody else did before.
//
// The destination is an ALLOWLIST of one shape (an internal vendor page),
// re-checked on read: anything else that ends up in storage is ignored, so this
// can never become an open redirect.

const KEY = "weddly.post_signup_destination";

/** Long enough to cover a sign-up that is finished the next day; matches the
 *  pending-signup TTL, after which the verification link is dead anyway. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const VENDOR_PAGE = /^\/app\/suppliers\/[A-Za-z0-9][A-Za-z0-9._~%-]{0,119}$/;

export function isSafeDestination(path: unknown): path is string {
  return typeof path === "string" && VENDOR_PAGE.test(path);
}

export function rememberDestination(path: string, now: number = Date.now()): void {
  if (!isSafeDestination(path)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    /* private mode or blocked storage: the visitor lands on /app instead */
  }
}

/** The remembered destination, cleared as it is read. Null when there is none,
 *  it has expired, or what is stored is not a shape we would ever have written. */
export function takeDestination(now: number = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    localStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.at !== "number" || now - parsed.at > TTL_MS) return null;
    return isSafeDestination(parsed.path) ? parsed.path : null;
  } catch {
    return null;
  }
}
