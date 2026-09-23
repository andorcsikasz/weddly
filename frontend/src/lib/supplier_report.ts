// The community-report queue exists ONLY for community-submitted listings
// (`backend/src/routes/community_suppliers.ts` posts to
// `/api/suppliers/community/:id/report`, which requires a finite positive
// numeric id). Directory ids arrive in three shapes — curated slugs
// (`csengokoncert`), community `c{N}`, claimed `v{N}` — so the number part
// can only come from the `c` prefix, and even then must be checked: a slug
// that merely starts with "c" (e.g. `csengokoncert`) parses to NaN, which
// serialized into the URL and 400'd. Returns null for anything that is not a
// genuine `c{digits}` community row.

export function communityReportId(id: string): number | null {
  if (!id || id[0] !== "c") return null;
  const n = Number(id.slice(1));
  return Number.isInteger(n) && n > 0 ? n : null;
}
