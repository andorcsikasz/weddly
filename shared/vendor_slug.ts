// Human-readable public ids for directory listings. Registered-vendor (`v{N}`)
// and community (`c{N}`) listings have opaque numeric ids; this wraps them in a
// name-based slug so a shared link reads `/vendors/magyar-foto-v12` instead of
// `/vendors/v12`. The trailing `v{N}`/`c{N}` is the source of truth — the name
// prefix is cosmetic, so a bare `v12`, a stale name in the URL, and the pretty
// form all resolve to the same listing (see `canonicalListingId`). Curated
// listings already carry readable slugs and pass through untouched.

/** Lowercase, hyphenated, ASCII-folded slug from a business name.
 *  "Magyar Fotó" → "magyar-foto". Hungarian accents fold to ASCII so the slug
 *  is typeable on any keyboard. Returns "" when nothing alphanumeric survives. */
export function slugifyName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accent marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // runs of non-alphanumerics → single hyphen
    .replace(/^-+|-+$/g, "") // trim edge hyphens
    .slice(0, 60)
    .replace(/-+$/g, ""); // re-trim after the length cap
}

/** The pretty, shareable public id for a listing. Only `v{N}` / `c{N}` ids get
 *  the readable name prefix; a curated slug (already readable) is returned
 *  as-is, and an empty slug falls back to the bare id. */
export function vendorPublicId(id: string, name: string): string {
  if (!/^[vc]\d+$/.test(id)) return id;
  const slug = slugifyName(name);
  return slug ? `${slug}-${id}` : id;
}

/** Reverse of `vendorPublicId`: pull the canonical `v{N}` / `c{N}` id out of a
 *  public id, whether bare (`v12`) or name-prefixed (`magyar-foto-v12`). Returns
 *  null when there's no such trailing token (e.g. a curated slug), so callers
 *  fall back to treating the input as a literal id. */
export function canonicalListingId(publicId: string): string | null {
  const m = /(?:^|-)([vc]\d+)$/.exec(publicId);
  return m?.[1] ?? null;
}
