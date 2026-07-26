/** Neutralize a stored external URL for use in an `href`. Returns undefined for
 *  an empty value, and forces an `https://` prefix on anything that isn't
 *  already http(s) so a `javascript:` / `data:` value can never render as a live
 *  href (React does not block those schemes on its own). The backend already
 *  rejects non-http(s) URLs on write; this is render-time defense in depth for
 *  any value stored before that guard existed. */
export function safeExternalHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
