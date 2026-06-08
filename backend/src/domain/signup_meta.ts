// Acquisition metadata captured once, at signup, and stored on the user row.
//
// Three sources, all resolved here so the password / Google / Apple register
// handlers stay identical (no path captures nulls by omission):
//   - country  : derived server-side from the request IP via GeoLite2, IP
//                discarded immediately (never persisted by this module).
//   - device   : coarse bucket parsed from the User-Agent header (mobile /
//                tablet / desktop) — no raw UA, OS, or browser version stored,
//                so this carries ~no fingerprinting entropy.
//   - utm_*     : campaign params the client read off the landing URL and
//                threaded through the register body; coerced + length-capped
//                here so user-controlled strings can't bloat the column.
//
// All fields are nullable: a VPN / datacenter IP, a missing UA, or an organic
// (no-UTM) signup all legitimately yield null. Lawful basis is legitimate
// interest (GDPR Art 6(1)(f)) — coarse, server-side, no tracking cookie.

import { lookupCountry } from "../lib/geoip";
import type { Ctx } from "../lib/http";
import { parseUserAgent } from "./feedback";

/** UTM fields as they arrive (untrusted) in a register request body. */
export interface UtmInput {
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
  utm_term?: unknown;
}

/** The resolved, storable acquisition fields. Column-aligned with `users`. */
export interface SignupAcquisition {
  signup_country: string | null;
  device_type: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

const UTM_MAX_LEN = 200;

/** Coerce one untrusted UTM value: a non-empty string, trimmed, capped to a
 *  sane length; anything else (number, object, oversized, blank) → null. */
function coerceUtm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, UTM_MAX_LEN);
}

/** Canonical acquisition channels, low cardinality so dashboards stay readable.
 *  "direct" = no UTM tag was captured (organic / typed-in / untracked). */
export type AcquisitionChannel = "paid" | "social" | "email" | "organic" | "referral" | "direct";

/** Derive a coarse channel bucket from the UTM source + medium. UTM-only (the
 *  raw HTTP referrer isn't stored on the user), so an untagged signup is
 *  "direct" by definition. Pure + deterministic for unit testing. */
export function channelFromUtm(
  source: string | null | undefined,
  medium: string | null | undefined,
): AcquisitionChannel {
  const s = (source ?? "").toLowerCase();
  const m = (medium ?? "").toLowerCase();
  if (!s && !m) return "direct";
  if (/\b(cpc|ppc|paid|ads?|display|retargeting)\b/.test(m)) return "paid";
  const both = `${s} ${m}`;
  if (
    /facebook|instagram|tiktok|pinterest|youtube|twitter|linkedin|social|reddit|snapchat/.test(both)
  ) {
    return "social";
  }
  if (/email|newsletter|mailing/.test(both)) return "email";
  if (/organic|seo/.test(m)) return "organic";
  // Tagged but uncategorised (e.g. a partner link with utm_source set) → referral.
  return "referral";
}

/** Build the acquisition row for a fresh signup. `ctx` provides the request IP
 *  (→ country) and User-Agent (→ device); `body` provides the UTM params. */
export function buildSignupAcquisition(ctx: Ctx, body: UtmInput): SignupAcquisition {
  return {
    signup_country: lookupCountry(ctx.clientIp),
    device_type: parseUserAgent(ctx.req.headers.get("user-agent")).device,
    utm_source: coerceUtm(body.utm_source),
    utm_medium: coerceUtm(body.utm_medium),
    utm_campaign: coerceUtm(body.utm_campaign),
    utm_content: coerceUtm(body.utm_content),
    utm_term: coerceUtm(body.utm_term),
  };
}
