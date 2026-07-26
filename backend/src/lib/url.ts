// Shared http(s)-only URL validation.
//
// A user-supplied URL that later reaches an `href`/`src` in someone else's
// browser (a couple browsing a vendor, an ADMIN opening the supplier/feedback
// panel) is stored XSS if its scheme isn't checked: React renders a
// `javascript:` / `data:` / `vbscript:` URL as a live, clickable href without
// complaint, and so does HTML email. Every route that stores a user URL destined
// for a link must pass it through here so a non-http(s) value can never be
// persisted. Mirrors the inline guard domain/accommodations.ts + domain/wishlist.ts
// already apply; this is the single reusable version for the routes that missed it.

import { HttpError } from "./http";

/** Normalize a URL to its http(s) href, or null if it is not a valid http(s)
 *  URL (bad syntax, or a javascript:/data:/mailto:/etc. scheme). Never throws. */
export function httpUrlOrNull(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}

/** Like httpUrlOrNull but 400s on a non-http(s) URL — for explicit form fields
 *  where the caller should be told their URL was rejected. */
export function requireHttpUrl(raw: string, field: string): string {
  const href = httpUrlOrNull(raw);
  if (href === null) throw new HttpError(400, `${field} must be a valid http(s) URL`);
  return href;
}
