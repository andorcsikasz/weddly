// Convert an existing (mis-routed) account into a real vendor. This is the
// vendor analogue of domain/planner_conversion.ts: someone who signed up as a
// couple (or otherwise landed on the wrong account kind) but is actually a
// wedding supplier gets "channelled over" to a vendor account by an admin,
// without losing any data.
//
// Non-destructive by design: it never touches users.couple_id, the couples
// row, or couple_members, so a mis-routed person's workspace data survives (it
// just becomes inaccessible to them while their now-vendor role routes them to
// the vendor home). Mirrors convertUserToPlanner's guarantees.

import type { SupplierCategory } from "@shared/suppliers";
import { vendorCurrencyForLocale } from "@shared/vendor_billing";
import { db, now } from "../db";
import { createVendorListing } from "./listings";
import { normaliseLocale, type UserRow } from "./users";
import { createVendorAccount, getVendorAccountByOwnerUserId } from "./vendor_accounts";
import { initVendorBilling } from "./vendor_billing";

export interface ConvertUserToVendorInput {
  category: SupplierCategory;
  /** Vendor-written label behind category='other'; see Listing.custom_category. */
  customCategory?: string | null;
  /** Business/display name for the account + listing; defaults to full_name. */
  businessName?: string | null;
}

/** Promote an existing account to a real vendor: flip `users.role='vendor'`,
 *  create the vendor_account + a live listing (only when the account doesn't
 *  exist yet), and grant billing (real founding-or-trial, first-come, the same
 *  as a genuine self-serve signup). The account is created with
 *  `onboarding_done=false` so the vendor lands in the in-app onboarding wizard
 *  to finish their profile. Idempotent: re-running on a user that already owns
 *  a vendor account just re-ensures the role + billing row. Never touches
 *  `users.couple_id`, so any existing workspace data is preserved. Returns the
 *  vendor account id + whether a fresh account was created. */
export function convertUserToVendor(
  user: UserRow,
  input: ConvertUserToVendorInput,
): { vendorAccountId: number; created: boolean } {
  const businessName = (input.businessName?.trim() || user.full_name).slice(0, 120);
  const currency = vendorCurrencyForLocale(normaliseLocale(user.locale));

  const convert = db.transaction((): { vendorAccountId: number; created: boolean } => {
    db.prepare("UPDATE users SET role = 'vendor', updated_at = ? WHERE id = ?").run(now(), user.id);

    let account = getVendorAccountByOwnerUserId(user.id);
    let created = false;
    if (!account) {
      account = createVendorAccount({
        ownerUserId: user.id,
        displayName: businessName,
        contactEmail: user.email,
        onboardingDone: false, // run the in-app wizard to finish the profile
      });
      created = true;
      // Give the vendor a live listing to land on + refine in the wizard,
      // seeded with the admin-chosen category so it isn't an unlabeled card.
      createVendorListing({
        vendorAccountId: account.id,
        category: input.category,
        customCategory: input.customCategory ?? null,
        name: businessName,
        city: "",
        contactEmail: user.email,
      });
    }
    // Founding (free year) or trial — inside the tx so the cohort count and the
    // grant stay consistent with the account creation. Idempotent for a vendor
    // that already has a subscription row.
    initVendorBilling(account.id, currency);
    return { vendorAccountId: account.id, created };
  });
  return convert();
}
