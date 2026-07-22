/** Public-page contact masking for vendors who opt to hide their details from
 *  anonymous visitors — a reason to register, same rationale as the always-on
 *  phone mask (see phone_mask.ts). Two rules apply, and only when the vendor
 *  flips `hide_contact_public` on their listing AND the viewer has no session:
 *
 *    email   "info@greattide.hu" -> "in•••@greattide.hu"   (local tail hidden,
 *                                                            @domain kept)
 *    address "Attila út 35"      -> "Attila út •••"         (house-number tail
 *                                                            hidden, street kept)
 *
 *  Masking happens server-side so the hidden characters never reach the client
 *  at all — a client-only mask would still ship the full value in the JSON. The
 *  bullet `•` is the sentinel the frontend also keys on to drop the mailto:/maps
 *  link that a partial value would otherwise break. */

/** The one glyph the masked-value renderer looks for. Never occurs in a real
 *  email or a normal street address, so `value.includes(CONTACT_MASK_CHAR)` is a
 *  safe "is this masked?" test on the client. */
export const CONTACT_MASK_CHAR = "•";

/** Fixed three-bullet run for the hidden tail. Fixed (not length-matched) on
 *  purpose: repeating by length would leak how many characters were hidden. */
const HIDDEN = CONTACT_MASK_CHAR.repeat(3);

/** Keep the first two characters of `s` and replace the rest with the fixed
 *  hidden run. Used for the local part of an email and as the address fallback
 *  when there's no space to split on. */
function keepHeadMaskTail(s: string): string {
  return s.slice(0, Math.min(2, s.length)) + HIDDEN;
}

/** `info@greattide.hu` -> `in•••@greattide.hu`. Keeps the first two chars of the
 *  local part and the whole `@domain` (so the vendor's domain still reads as
 *  legitimate), hides the rest of the local part. A value with no usable `@` is
 *  tail-masked like a plain string. */
export function maskEmailForPublic(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return keepHeadMaskTail(email);
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes the leading "@"
  return local.slice(0, Math.min(2, local.length)) + HIDDEN + domain;
}

/** `Attila út 35` -> `Attila út •••`. Masks the last whitespace-delimited token
 *  (typically the house number), keeping the street/area as a teaser. Falls back
 *  to tail-masking a single-token address. */
export function maskAddressForPublic(address: string): string {
  const trimmed = address.trimEnd();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace <= 0) return keepHeadMaskTail(trimmed);
  return `${trimmed.slice(0, lastSpace + 1)}${HIDDEN}`;
}
