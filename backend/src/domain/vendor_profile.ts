// Vendor listing completeness — the "your listing is still incomplete" reminder
// shared by the automatic recurring sweep (domain/emails/worker.ts), the admin
// "Send reminder" button (routes/admin_vendors.ts), and the admin vendor list's
// incomplete badge (domain/vendor_accounts.ts). One place owns the definition of
// "what's missing" so the sweep, the button, the list and the email body can
// never disagree.

import { CONFIG } from "../config";
import { db } from "../db";
import { sendKind } from "./emails";
import { getListingByVendorAccountId, listingChecklist } from "./listings";

/** The still-empty sections, one flag per thing the email can name. Keys are
 *  the checklist's step keys, so a step added to the portal shows up here the
 *  moment it has copy — and can never be silently dropped from the email
 *  instead. */
export interface VendorListingMissing {
  cover: boolean;
  gallery: boolean;
  description: boolean;
  contact: boolean;
  pricing: boolean;
  capacity: boolean;
  packages: boolean;
}

/** Which public-facing sections of a vendor's PRIMARY listing are still empty.
 *
 *  DERIVED FROM THE SAME CHECKLIST the vendor sees, and that is the whole
 *  point. This used to be a second, hand-written definition of "incomplete",
 *  and the two drifted exactly as you would expect: the dashboard ring read
 *  100% while the reminder mail named two empty sections, so a vendor could not
 *  tell which one was lying (both were consulted honestly, they simply asked
 *  different questions). It also hid a real bug for months — the counts keyed on
 *  `v<accountId>`, an id only a register-born listing has, so 42 of 62 live
 *  vendors were told their photos and packages were missing while the ring, which
 *  keyed on the real id, said they were done.
 *
 *  There is deliberately NO availability rule. It used to be "has blocked no
 *  dates", which is not an empty section but an empty CALENDAR: a vendor with
 *  nothing booked is fully available, and the reminder asked 50 of 62 accounts to
 *  go and mark themselves busy. See `calendar_public` in
 *  domain/vendor_availability_settings.ts for the vendors who publish none at all.
 *
 *  A vendor with NO listing gets every flag set; `sendVendorIncompleteReminder`'s
 *  callers skip them, because a mail about an editor that 404s is worse than no
 *  mail. */
export function vendorListingMissing(vendorAccountId: number): VendorListingMissing {
  const listing = getListingByVendorAccountId(vendorAccountId);
  const undone = new Set(
    listingChecklist(listing)
      .filter((s) => !s.done)
      .map((s) => s.key),
  );
  return {
    cover: undone.has("cover"),
    gallery: undone.has("gallery"),
    description: undone.has("description"),
    contact: undone.has("contact"),
    pricing: undone.has("pricing"),
    // Absent from the checklist for the ~23 categories with no guest count, and
    // an absent step is not a missing one.
    capacity: undone.has("capacity"),
    packages: undone.has("packages"),
  };
}

/** True when any public section is still empty — i.e. the checklist is not at
 *  100%, which is what the vendor's own ring shows. */
export function isVendorListingIncomplete(m: VendorListingMissing): boolean {
  return Object.values(m).some(Boolean);
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
