// Hosts this app refuses to make outbound requests to, ever, from any code
// path. Grown from one incident: bodalia.es disputes the 2026-08-19
// WeddlyResearchBot crawl behind suppliers_data_es_scale_*.ts, and two
// SERVER-SIDE sweeps (domain/listing_image_backfill.ts,
// domain/listing_gallery_backfill.ts) fire on every boot and would otherwise
// keep re-fetching that domain for any row not yet checked.
//
// Wired into `lib/ssrf.ts`'s `isBlockedHostname` — the one choke point both
// `lib/remote_image.ts` (image downloads) and `lib/link_preview.ts` (og:image
// / HTML unfurling) already resolve every host through, including every
// redirect hop. Adding a host here is enough; no caller needs its own check.
// The one-off research scripts under backend/scripts/ import it too, as a
// second guard for anyone who runs them directly outside the server.

export const DISPUTED_SOURCE_HOSTS: readonly string[] = ["bodalia.es"];

export function isDisputedSourceHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return DISPUTED_SOURCE_HOSTS.some((blocked) => h === blocked || h.endsWith(`.${blocked}`));
}
