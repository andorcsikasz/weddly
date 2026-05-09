// Couple-level public identifier. Uppercase ASCII so it's typeable on every
// keyboard layout — Hungarian accents (Á, Sá, Ő…) get folded down to ASCII so
// "Andor & Sári" → "ANDORSARI". Conflicts within the platform get a numeric
// suffix.

import { COUPLE_SLUG_MAX_LENGTH, COUPLE_SLUG_MIN_LENGTH } from "@shared/types";
import { db } from "../db";

const COMBINING_MARKS = /[̀-ͯ]/g;

/** Lowercase or mixed input → uppercase ASCII alphanumerics. Drops everything
 *  else (spaces, punctuation, accents). Returns "" if nothing survives. */
export function normalizeSlugInput(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, COUPLE_SLUG_MAX_LENGTH);
}

/** Compose a base slug from bride + groom names, falling back to display_name
 *  or a generic placeholder. Always returns at least COUPLE_SLUG_MIN_LENGTH
 *  characters of A-Z/0-9. */
export function deriveSlugBase(brideName: string, groomName: string, displayName: string): string {
  const combined = normalizeSlugInput(`${brideName}${groomName}`);
  if (combined.length >= COUPLE_SLUG_MIN_LENGTH) return combined;
  const fromDisplay = normalizeSlugInput(displayName);
  if (fromDisplay.length >= COUPLE_SLUG_MIN_LENGTH) return fromDisplay;
  return "WEDDLY";
}

/** Returns a slug that's globally unique in the `couples` table. Appends a
 *  numeric suffix on collision (ANDORSARI → ANDORSARI2 → ANDORSARI3 …). */
export function uniqueCoupleSlug(base: string, excludeCoupleId?: number): string {
  const cleaned = normalizeSlugInput(base) || "WEDDLY";
  const stmt = db.prepare("SELECT id FROM couples WHERE slug = ?");
  const taken = (slug: string): boolean => {
    const row = stmt.get(slug) as { id: number } | undefined;
    return Boolean(row && row.id !== excludeCoupleId);
  };
  if (!taken(cleaned)) return cleaned;
  for (let i = 2; i < 10000; i++) {
    const suffix = String(i);
    const baseLen = Math.min(cleaned.length, COUPLE_SLUG_MAX_LENGTH - suffix.length);
    const candidate = `${cleaned.slice(0, baseLen)}${suffix}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a unique couple slug from base "${cleaned}"`);
}

/** Validate user-provided slug input. Throws on bad shape. */
export function validateSlug(raw: string): string {
  const cleaned = normalizeSlugInput(raw);
  if (cleaned.length < COUPLE_SLUG_MIN_LENGTH) {
    throw new Error(`Slug must be at least ${COUPLE_SLUG_MIN_LENGTH} chars (A–Z, 0–9)`);
  }
  return cleaned;
}
