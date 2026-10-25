// The vendor's printable review QR code (/vendor/reviews). A Hovercode dynamic
// code that opens the vendor's public page with the review composer open
// (`?review=1`). Dynamic, so a renamed listing (new pretty URL) re-points the
// code instead of breaking the printed copies.

export interface VendorReviewQr {
  /** The short link the printed code encodes. */
  shortlink_url: string;
  /** Where the short link currently lands. */
  target_url: string;
  /** Scans in the last 30 days. Null when Hovercode did not answer. */
  scans_30d: number | null;
}

export interface VendorReviewQrView {
  /** False when the server has no Hovercode key: the card is hidden. */
  available: boolean;
  /** Null until the vendor asks for a code. */
  qr: VendorReviewQr | null;
}
