/** Public-page ADDRESS masking for vendors who opt to hide their details from
 *  anonymous visitors — a reason to register, same rationale as the always-on
 *  phone mask (see phone_mask.ts). It applies only when the vendor flips
 *  `hide_contact_public` on their listing AND the viewer has no session:
 *
 *    address "Attila út 35"      -> "Attila út •••"         (house-number tail
 *                                                            hidden, street kept)
 *
 *  There is deliberately no email twin any more. A masked mailbox was a teaser
 *  that registering used to redeem, and the email is now withheld from every
 *  viewer (routes/suppliers.ts) — a mask over a value nobody is ever shown is
 *  just a second thing to keep in sync.
 *
 *  Masking happens server-side so the hidden characters never reach the client
 *  at all — a client-only mask would still ship the full value in the JSON. The
 *  bullet `•` is the sentinel the frontend also keys on to drop the maps link
 *  that a partial value would otherwise break. */

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

/** `Attila út 35` -> `Attila út •••`. Masks the last whitespace-delimited token
 *  (typically the house number), keeping the street/area as a teaser. Falls back
 *  to tail-masking a single-token address. */
export function maskAddressForPublic(address: string): string {
  const trimmed = address.trimEnd();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace <= 0) return keepHeadMaskTail(trimmed);
  return `${trimmed.slice(0, lastSpace + 1)}${HIDDEN}`;
}
