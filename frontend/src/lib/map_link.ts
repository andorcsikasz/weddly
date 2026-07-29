// Outbound "open this pin in a real map app" link.
//
// The guest page used to hand the exact venue coordinates to openstreetmap.org.
// That is the same basemap the embedded thumbnail already shows, and it is not
// where a guest wants to end up: they want the pin in the app that can navigate
// them there, which on an Apple device is Apple Maps and everywhere else is
// Google Maps.
//
// Coordinates only, never the venue name, as the search term: a name search can
// resolve to a different business with a similar name, and the whole point of
// this link is that the couple pinned the EXACT spot. On Apple the name rides
// along as `q`, which only labels the pin `ll` already fixed.

/** True on iOS / iPadOS / macOS, where Apple Maps is the system map app. */
function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  // iPadOS 13+ reports as "Macintosh", which is fine: both want Apple Maps.
  return /\b(iPhone|iPad|iPod|Macintosh)\b/.test(ua);
}

/**
 * Deep link to the platform's map app for an exact pin.
 *
 * @param label Optional venue name. Apple shows it as the pin's title; Google
 *              never sees it, so the coordinates stay authoritative there.
 */
export function mapPinUrl(lat: number, lng: number, label?: string | null): string {
  const coords = `${lat},${lng}`;
  if (isApplePlatform()) {
    const q = label?.trim();
    // `ll` fixes the location, `q` only names it. Without `ll`, `q` would be
    // treated as a search string and could land somewhere else entirely.
    return q
      ? `https://maps.apple.com/?ll=${coords}&q=${encodeURIComponent(q)}`
      : `https://maps.apple.com/?ll=${coords}&q=${encodeURIComponent(coords)}`;
  }
  // Google's documented universal cross-platform URL. On Android and in the
  // mobile browser it hands off to the Google Maps app when installed.
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`;
}
