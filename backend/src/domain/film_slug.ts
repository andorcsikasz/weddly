// Custom guest-link slug validation (#17). Slugs share the public /photos/:token
// namespace with upload tokens, so they must never overlap with the token shape
// (hex) and must avoid reserved sub-paths.

import { HttpError } from "../lib/http";

// Reserved sub-paths that live alongside /photos/:token — a slug must never
// shadow these.
const RESERVED = new Set(["current", "film-access", "checkout", "qr", "devices"]);

// Upload tokens are hex (randomBytes(12).toString("hex") = 24 hex chars). Reject
// any slug that looks like a token so the two namespaces never collide.
const TOKEN_SHAPE = /^[0-9a-f]{20,}$/;

/** Normalize + validate a custom slug. Throws HttpError(400, {code:"slug_invalid"})
 *  on any invalid input. Returns the canonical lowercase slug. */
export function validateFilmSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-") // anything not allowed becomes a hyphen
    .replace(/-+/g, "-") // collapse repeated hyphens
    .replace(/^-+|-+$/g, ""); // trim leading/trailing hyphens

  if (slug.length < 3 || slug.length > 40)
    throw new HttpError(400, "Slug must be 3-40 characters", { code: "slug_invalid" });
  if (RESERVED.has(slug))
    throw new HttpError(400, "That slug is reserved", { code: "slug_invalid" });
  if (TOKEN_SHAPE.test(slug))
    throw new HttpError(400, "Slug cannot look like an upload token", { code: "slug_invalid" });

  return slug;
}
