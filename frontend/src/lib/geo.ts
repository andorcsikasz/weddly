// Frontend port of backend/src/lib/geo.ts. Great-circle distance in km between
// two (lat, lng) pairs. Used by the supplier comparison dialog to show how far
// each shortlisted supplier sits from the couple's wedding-venue pin. Spherical
// earth, off by a fraction of a percent vs WGS84 — irrelevant at the km
// granularity the UI shows. Pure, deterministic, no I/O.

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}
