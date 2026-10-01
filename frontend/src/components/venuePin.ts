// The venue map's marker: a teardrop pin filled with the couple's accent, the
// Weddly dove (the exact silhouette from the logo, frontend/public/logo.svg) in
// white in its head. The dove path is lifted verbatim from that file so the pin
// and the brand mark never drift apart; re-run scripts/… if the logo dove is
// ever re-drawn (there is no generator, it was a one-time extraction).
//
// Returned as an L.divIcon, i.e. inline SVG rendered straight into the DOM, not
// an <img> fetch, so it needs no img-src CSP allowance and scales crisply at any
// zoom. `accent` is the palette accent, passed as a hex OR a CSS var() — CSS
// custom properties inherit through Leaflet's marker pane, so
// fill="var(--wt-accent)" resolves against the guest-page theme root.
//
// A custom `className` is passed so Leaflet's default `.leaflet-div-icon` white
// box + grey border rule never applies (that class is only added when you don't
// supply your own).

import L from "leaflet";
import { DOVE_PATH } from "./dovePath";

/** Raw SVG string for the pin. viewBox 0 0 24 24 (the canonical map-pin box);
 *  the dove is centred in the pin head. */
export function venuePinSvg(accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.35))" aria-hidden="true">
  <path d="M12 1.5c-4.14 0-7.5 3.28-7.5 7.33 0 5.1 6.36 12.4 6.63 12.71a1.16 1.16 0 0 0 1.74 0c.27-.31 6.63-7.61 6.63-12.71C19.5 4.78 16.14 1.5 12 1.5z" fill="${accent}" stroke="#ffffff" stroke-width="1.1" stroke-linejoin="round"/>
  <svg x="5.6" y="3.4" width="12.8" height="12.8" viewBox="337 282 624 668" preserveAspectRatio="xMidYMid meet">
    <path transform="translate(363,282)" d="${DOVE_PATH}" fill="#ffffff"/>
  </svg>
</svg>`;
}

/** L.divIcon for the pin, tip anchored on the exact coordinate. */
export function venuePinIcon(accent: string): L.DivIcon {
  return L.divIcon({
    html: venuePinSvg(accent),
    className: "wt-venue-pin",
    iconSize: [40, 40],
    iconAnchor: [20, 38],
    popupAnchor: [0, -36],
  });
}
