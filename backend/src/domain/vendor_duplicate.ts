// Detects a new vendor account being created with a name or email that
// already matches an existing vendor account, and makes sure an admin
// actually sees it.
//
// Production already produced a real duplicate this way: two vendor_accounts
// for "La Contessa Kastélyhotel" under two different logins. Registration's
// own `assertNoUnclaimedDirectoryTwin` (routes/vendor_register.ts) only
// refuses an UNCLAIMED directory twin — a CLAIMED one (a second person
// registering for a business someone already claimed) is deliberately let
// through, since a real second business can share a name, but it was only
// ever `log.info`'d. Nobody reads server logs for that. This module is the
// "somebody should actually see this" half: it never blocks account
// creation, it just tells an admin so they can merge (see vendor_merge.ts) or
// confirm it's a genuine namesake.

import { foldName } from "@shared/real_names";
import { CONFIG } from "../config";
import { db } from "../db";
import { addAuditLog } from "../lib/audit";
import { sendKind } from "./emails";

export interface VendorDuplicateMatch {
  vendor_account_id: number;
  vendor_code: string | null;
  display_name: string;
  contact_email: string | null;
  owner_email: string;
}

interface CandidateRow {
  id: number;
  vendor_code: string | null;
  display_name: string;
  contact_email: string | null;
  owner_email: string;
}

/** Every OTHER vendor account whose display name folds to the same letters as
 *  `displayName` (case/diacritic/spacing-insensitive), or whose account
 *  contact email or owner login email matches `email` — excluding
 *  `excludeVendorAccountId`. Read-only; the vendor table is a few hundred
 *  rows, so this is one full-table scan filtered in JS rather than a second
 *  SQL round trip per comparison mode. */
export function findVendorAccountDuplicates(input: {
  displayName: string;
  email: string;
  excludeVendorAccountId?: number;
}): VendorDuplicateMatch[] {
  const folded = foldName(input.displayName);
  const email = input.email.trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT va.id, va.vendor_code, va.display_name, va.contact_email, u.email AS owner_email
         FROM vendor_accounts va
         JOIN users u ON u.id = va.owner_user_id
        WHERE va.id != ?`,
    )
    .all(input.excludeVendorAccountId ?? -1) as CandidateRow[];
  return rows
    .filter((r) => {
      if (folded.length > 0 && foldName(r.display_name) === folded) return true;
      if (email.length > 0) {
        if (r.contact_email && r.contact_email.trim().toLowerCase() === email) return true;
        if (r.owner_email.trim().toLowerCase() === email) return true;
      }
      return false;
    })
    .map((r) => ({
      vendor_account_id: r.id,
      vendor_code: r.vendor_code,
      display_name: r.display_name,
      contact_email: r.contact_email,
      owner_email: r.owner_email,
    }));
}

/** Fire-and-forget admin alert for a name/email match found at vendor-account
 *  creation time — self-serve register, admin-initiated register, or an
 *  admin rerouting a mis-routed account to vendor (convertUserToVendor).
 *  Never blocks the caller: a mailer hiccup must not fail account creation,
 *  so send failures are swallowed after a log line. Always leaves an
 *  audit_log row regardless of whether the mail goes out, so the match is on
 *  the record even if every admin address bounces. */
export function alertVendorDuplicate(
  matches: VendorDuplicateMatch[],
  context: {
    source: string;
    displayName: string;
    email: string;
    newVendorAccountId: number | null;
  },
): void {
  if (matches.length === 0) return;

  addAuditLog({
    actor_user_id: null,
    couple_id: null,
    action: "vendor.duplicate_detected",
    target_kind: "vendor_account",
    target_id: context.newVendorAccountId,
    note: context.source,
    after: { display_name: context.displayName, email: context.email, matches },
  });

  for (const to of CONFIG.adminEmails) {
    void sendKind(
      "vendor_duplicate_admin_alert",
      {
        source: context.source,
        displayName: context.displayName,
        email: context.email,
        newVendorAccountId: context.newVendorAccountId,
        matches: matches.map((match) => ({
          vendorAccountId: match.vendor_account_id,
          vendorCode: match.vendor_code,
          displayName: match.display_name,
          contactEmail: match.contact_email,
          ownerEmail: match.owner_email,
        })),
        adminUrl: `${CONFIG.frontendBaseUrl}/app/admin/vendors`,
      },
      {
        user: null,
        guest: { email: to, full_name: "" },
        sender: "admin",
      },
    );
  }
}
