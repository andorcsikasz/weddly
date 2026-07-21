/** The public vendor page hides most of a phone number from anonymous
 *  visitors: seeing the full number is a reason to register. Keeps the first
 *  five DIGITS (enough to read the country/area prefix) and replaces every
 *  later digit with `*`, while preserving any separators (`+`, spaces, `-`) so
 *  the masked value still reads as a phone number.
 *
 *  "06706361792" -> "06706******"
 *  "+36 70 636 1792" -> "+36 70 6** ****"
 *
 *  Masking happens server-side so the hidden digits never reach the client at
 *  all — a client-only mask would still ship the full number in the JSON. */
export function maskPhoneForAnonymous(phone: string): string {
  let digitsKept = 0;
  let out = "";
  for (const ch of phone) {
    if (ch >= "0" && ch <= "9") {
      digitsKept += 1;
      out += digitsKept <= 5 ? ch : "*";
    } else {
      out += ch;
    }
  }
  return out;
}
