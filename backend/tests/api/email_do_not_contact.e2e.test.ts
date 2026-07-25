// Address-level suppression, enforced at the dispatcher.
//
// `email_optouts` used to be consulted only by campaign targeting, so an
// unsubscribed address could still be reached by any other outreach path (a
// couple adding them to the directory, a claim-verify link, the next campaign
// we write). A business that asks us to stop has asked about all of it, so the
// check now lives in `sendKind` and covers every kind except transactional.
//
// The transactional carve-out is deliberate and is the interesting case below:
// a suppressed address that later decides to sign up on its own must still be
// able to receive its verify link, or the suppression would lock them out of a
// product they came to voluntarily.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { sendKind } from "../../src/domain/emails";
import {
  addOptOut,
  DO_NOT_CONTACT,
  isOptedOut,
  seedDoNotContact,
} from "../../src/domain/emails/optouts";
import { bootstrapCouple, wipeAll } from "../helpers";

const SUPPRESSED = "stop-mailing-me@vendor.test";
const REACHABLE = "happy-to-hear@vendor.test";

function lastLog(email: string): { kind: string; status: string } | undefined {
  return db
    .prepare("SELECT kind, status FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
    .get(email) as { kind: string; status: string } | undefined;
}

describe("email_optouts: the do-not-contact seed", () => {
  beforeEach(() => {
    // wipeAll() clears email_optouts on purpose (a leaked tombstone would mute
    // a later test's outreach), so the seed has to run per test.
    wipeAll();
  });

  test("seeding writes a tombstone for every address that asked us to stop", () => {
    seedDoNotContact();
    expect(DO_NOT_CONTACT.length).toBeGreaterThan(0);
    for (const entry of DO_NOT_CONTACT) {
      expect(isOptedOut(entry.email)).toBe(true);
    }
  });

  test("Finca Monasterio is on the list (asked in writing, 2026-07-25)", () => {
    seedDoNotContact();
    expect(isOptedOut("info@finca-monasterio.com")).toBe(true);
    // Case and whitespace are normalised on both write and read, so a differently
    // typed copy of the same address is still suppressed.
    expect(isOptedOut("  INFO@Finca-Monasterio.com ")).toBe(true);
  });

  test("re-seeding is a no-op — it runs on every boot", () => {
    seedDoNotContact();
    seedDoNotContact();
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM email_optouts WHERE email = ?")
      .get("info@finca-monasterio.com") as { n: number };
    expect(count.n).toBe(1);
  });

  test("seeding does not overwrite a reason recorded by an earlier unsubscribe", () => {
    addOptOut("info@finca-monasterio.com", "vendor_claim_campaign");
    seedDoNotContact();
    const row = db
      .prepare("SELECT reason FROM email_optouts WHERE email = ?")
      .get("info@finca-monasterio.com") as { reason: string };
    expect(row.reason).toBe("vendor_claim_campaign");
  });
});

describe("sendKind: suppression by category", () => {
  beforeEach(() => {
    wipeAll();
    addOptOut(SUPPRESSED, "do_not_contact");
  });

  test("outreach to a suppressed address is skipped and logged as skipped_opt_out", async () => {
    const result = await sendKind(
      "vendor_claim_verify",
      { listingName: "Finca Test", verifyUrl: "https://weddly.hu/vendor/claim/abc" },
      { user: null, guest: { email: SUPPRESSED, full_name: "Vendor" }, couple_id: null },
    );
    expect(result.status).toBe("skipped_opt_out");
    // Logged, so the admin email list still shows what we chose not to send.
    expect(lastLog(SUPPRESSED)).toEqual({
      kind: "vendor_claim_verify",
      status: "skipped_opt_out",
    });
  });

  test("the same outreach kind still reaches an address that never opted out", async () => {
    const result = await sendKind(
      "vendor_claim_verify",
      { listingName: "Finca Test", verifyUrl: "https://weddly.hu/vendor/claim/abc" },
      { user: null, guest: { email: REACHABLE, full_name: "Vendor" }, couple_id: null },
    );
    // No RESEND key in tests, so a mail that gets through lands here rather
    // than on "sent". The point is that it was NOT suppressed.
    expect(result.status).toBe("skipped_no_provider");
    expect(lastLog(REACHABLE)?.status).toBe("skipped_no_provider");
  });

  test("transactional mail is exempt — a suppressed address can still sign up", async () => {
    await bootstrapCouple(SUPPRESSED);
    const userId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get(SUPPRESSED) as
        | { id: number }
        | undefined
    )?.id as number;
    // The tombstone survives the account being created.
    expect(isOptedOut(SUPPRESSED)).toBe(true);

    const result = await sendKind(
      "verify_resend",
      { verifyUrl: "https://weddly.hu/verify-email/abc" },
      { user: { id: userId, email: SUPPRESSED, full_name: "Suppressed" }, couple_id: null },
    );
    expect(result.status).toBe("skipped_no_provider");
    expect(lastLog(SUPPRESSED)?.kind).toBe("verify_resend");
  });

  test("lifecycle mail to a suppressed address is skipped", async () => {
    await bootstrapCouple(SUPPRESSED);
    const userId = (
      db.prepare("SELECT id FROM users WHERE email = ?").get(SUPPRESSED) as
        | { id: number }
        | undefined
    )?.id as number;

    const result = await sendKind(
      "partner_invite_reminder",
      { invitePartnerUrl: "https://weddly.hu/app?invite=1" },
      { user: { id: userId, email: SUPPRESSED, full_name: "Suppressed" }, couple_id: null },
    );
    expect(result.status).toBe("skipped_opt_out");
    expect(lastLog(SUPPRESSED)).toEqual({
      kind: "partner_invite_reminder",
      status: "skipped_opt_out",
    });
  });
});
