// Vendor listing completeness — the "your listing is still incomplete" reminder
// shared by the automatic recurring sweep (domain/emails/worker.ts), the admin
// "Send reminder" button (routes/admin_vendors.ts), and the admin vendor list's
// incomplete badge (domain/vendor_accounts.ts). One place owns the definition of
// "what's missing" so the sweep, the button, the list and the email body can
// never disagree.

import { CONFIG } from "../config";
import { db } from "../db";
import { sendKind } from "./emails";
import { countListingPackages, countListingPhotos, getListingByVendorAccountId } from "./listings";

export interface VendorListingMissing {
  photos: boolean;
  bio: boolean;
  pricing: boolean;
  packages: boolean;
}

/** Which public-facing sections of a vendor's PRIMARY listing are still empty.
 *  Mirrors what a couple sees on the public profile, so the nudge (and the admin
 *  badge) only ever names things that are genuinely blank.
 *
 *  Every count keys on the listing's OWN id, never on `v<accountId>`: only a
 *  listing created by vendor register carries that id, while a CLAIMED one keeps
 *  the curated/community id it was imported under ('csengokoncert', 'c9'). Two
 *  thirds of live vendor listings are the claimed kind, and each of them was
 *  told their photos and packages were missing while both were on the page —
 *  the nudge counted rows under an id that does not exist.
 *
 *  There is deliberately NO availability rule here. It used to be "has blocked
 *  no dates", which is not an empty section but an empty CALENDAR: a vendor with
 *  nothing booked is fully available, and the reminder asked 50 of 62 accounts
 *  to go and mark themselves busy. See `calendar_public` in
 *  domain/vendor_availability_settings.ts for the vendors who publish no
 *  calendar at all. */
export function vendorListingMissing(vendorAccountId: number): VendorListingMissing {
  const listing = getListingByVendorAccountId(vendorAccountId);
  const listingId = listing?.id ?? `v${vendorAccountId}`;
  return {
    photos: !listing?.hero_image_url && countListingPhotos(listingId) === 0,
    bio: !(listing?.blurb_hu || listing?.blurb_en),
    pricing: listing?.price_band == null,
    packages: countListingPackages(listingId) === 0,
  };
}

/** True when any public section is still empty. */
export function isVendorListingIncomplete(m: VendorListingMissing): boolean {
  return m.photos || m.bio || m.pricing || m.packages;
}

/** The account fields the reminder + its bookkeeping need. */
export interface VendorReminderAccount {
  id: number;
  display_name: string;
  owner_user_id: number;
  email: string;
  full_name: string;
  /** Reminders already sent — selects the copy variant and is then incremented. */
  profile_nudge_count: number;
}

/** Stamp the cadence bookkeeping and fire the "finish your listing" email.
 *  Fire-and-forget send; the stamp lands FIRST so a silent mailer hiccup still
 *  advances the series (and rotates the copy variant) rather than re-sending the
 *  same text. Callers own the "should we send" decision — the sweep gates on
 *  cadence + cap, the admin button is an explicit override. Returns the variant
 *  index used. */
export function sendVendorIncompleteReminder(
  account: VendorReminderAccount,
  missing: VendorListingMissing,
  ts: number,
): number {
  const variant = account.profile_nudge_count;
  db.prepare(
    `UPDATE vendor_accounts
        SET profile_nudge_last_at = ?, profile_nudge_count = profile_nudge_count + 1
      WHERE id = ?`,
  ).run(ts, account.id);
  void sendKind(
    "vendor_profile_incomplete",
    {
      businessName: account.display_name,
      editUrl: `${CONFIG.frontendBaseUrl}/vendor/listing`,
      missing,
      variant,
    },
    {
      user: { id: account.owner_user_id, email: account.email, full_name: account.full_name },
      couple_id: null,
    },
  );
  return variant;
}
