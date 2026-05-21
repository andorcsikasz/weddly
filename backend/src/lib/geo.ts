// Tiny geo helper for the suppliers proximity query.
//
// Haversine returns great-circle distance in kilometres between two
// (lat, lng) pairs. Accuracy is fine for "filter results within 30km of a
// venue" — the formula assumes a spherical earth, so it's off by a fraction
// of a percent vs WGS84 ellipsoid distance, which is irrelevant at the
// kilometre granularity the UI shows. Pure function, no I/O, deterministic.

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
