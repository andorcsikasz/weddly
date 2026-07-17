// Vendor onboarding: the accepted-waitlist → live vendor account flow, plus the
// founding cohort (first 100 free for a year, no card) and the entitlement gate.
//
// Covers (major-change rule — new endpoints + money/state-machine):
//   - admin accepts a waitlist entry → a single-use onboarding token is minted
//     and the activation URL is appended to the sent email body
//   - verify/:token returns the prefill view + honest founding spots-left
//   - complete creates users(role='vendor') + vendor_account + a live listing +
//     a founding subscription, and issues a session
//   - founding badge: subscription_status='founding', is_founding_member=1,
//     ~1-year window; spots-left decrements
//   - the founding vendor can edit their listing (entitled); a lapsed vendor is
//     refused with 402 on the edit surface

import "../setup";

import { describe, expect, test } from "bun:test";
import { VENDOR_FOUNDING_CAP, VENDOR_FOUNDING_DURATION_MS } from "@shared/vendor_billing";
import { db } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { registerAndVerify, req, wipeAll } from "../helpers";

async function addAdmin(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  return reg.data.token;
}

/** Submit a waitlist entry + admin-accept it, returning the minted onboarding
 *  token (read straight from the DB — the token isn't exposed in the API, only
 *  emailed). */
async function acceptedWaitlistToken(
  adminToken: string,
  opts: { email: string; business: string; category?: string; location?: string },
): Promise<{ waitlistId: number; token: string; sentBody: string }> {
  const submit = await req<{ entry: { id: number } }>("POST", "/api/vendors/waitlist", {
    business_name: opts.business,
    email: opts.email,
    category: opts.category ?? "photography",
    location: opts.location ?? "Budapest",
    website: null,
    message: null,
    portfolio_links: [],
    instagram_handle: null,
  });
  expect(submit.status).toBe(201);
  const waitlistId = submit.data.entry.id;

  const decide = await req(
    "POST",
    `/api/admin/vendor-waitlist/${waitlistId}/decide`,
    { outcome: "accepted", subject: "Welcome", body: "Gratulálunk, felvettünk!", notes: "" },
    { token: adminToken },
  );
  expect(decide.status).toBe(200);

  const row = db
    .prepare(
      "SELECT token FROM vendor_onboarding WHERE waitlist_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    )
    .get(waitlistId) as { token: string } | undefined;
  expect(row?.token).toBeTruthy();
  const sent = db.prepare("SELECT sent_body FROM vendor_waitlist WHERE id = ?").get(waitlistId) as {
    sent_body: string;
  };
  return { waitlistId, token: row!.token, sentBody: sent.sent_body };
}

describe("vendor onboarding — accept → activate → live", () => {
  test("admin accept mints a token and appends the activate URL to the email", async () => {
    wipeAll();
    const admin = await addAdmin();
    const { token, sentBody } = await acceptedWaitlistToken(admin, {
      email: "studio@weddly.test",
      business: "Aurora Studio",
    });
    expect(sentBody).toContain(`/vendor/activate/${token}`);

    // The accepted vendor gets the dedicated, transactional `vendor_activation`
    // mail (activation link IS the button) — NOT the outreach
    // `vendor_waitlist_decision` reply whose button pointed at the homepage.
    const logged = db
      .prepare("SELECT kind, category FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
      .get("studio@weddly.test") as { kind: string; category: string };
    expect(logged.kind).toBe("vendor_activation");
    expect(logged.category).toBe("transactional");
    const decisionRows = db
      .prepare(
        "SELECT COUNT(*) AS n FROM email_log WHERE to_email = ? AND kind = 'vendor_waitlist_decision'",
      )
      .get("studio@weddly.test") as { n: number };
    expect(decisionRows.n).toBe(0);

    // Under_review / rejected must NOT mint a token.
    const reject = await acceptedWaitlistRejectMintsNothing(admin);
    expect(reject).toBe(0);
  });

  test("verify returns the prefill view + founding spots left", async () => {
    wipeAll();
    const admin = await addAdmin();
    const { token } = await acceptedWaitlistToken(admin, {
      email: "verify@weddly.test",
      business: "Verify Co",
    });
    const v = await req<{
      onboarding: {
        business_name: string;
        email: string;
        founding_spots_left: number;
        founding_cap: number;
      };
    }>("POST", `/api/vendor/onboard/verify/${token}`);
    expect(v.status).toBe(200);
    expect(v.data.onboarding.business_name).toBe("Verify Co");
    expect(v.data.onboarding.email).toBe("verify@weddly.test");
    expect(v.data.onboarding.founding_cap).toBe(VENDOR_FOUNDING_CAP);
    expect(v.data.onboarding.founding_spots_left).toBe(VENDOR_FOUNDING_CAP);
  });

  test("complete creates a founding vendor with a live listing + session", async () => {
    wipeAll();
    const admin = await addAdmin();
    const { token } = await acceptedWaitlistToken(admin, {
      email: "founder@weddly.test",
      business: "Founder Films",
      category: "photography",
      location: "Szeged",
    });

    const done = await req<{ token: string; user: { id: number; role: string; email: string } }>(
      "POST",
      "/api/vendor/onboard/complete",
      { token, password: "supersafe123", full_name: "Anna Founder", locale: "hu" },
    );
    expect(done.status).toBe(201);
    expect(done.data.user.role).toBe("vendor");
    expect(done.data.user.email).toBe("founder@weddly.test");
    const vendorToken = done.data.token;

    // Account + live listing exist; the vendor can read their listing.
    const me = await req<{
      listing: { name: string; city: string; status: string };
      account: { id: number };
    }>("GET", "/api/vendor/listing/me", undefined, { token: vendorToken });
    expect(me.status).toBe(200);
    expect(me.data.listing.name).toBe("Founder Films");
    expect(me.data.listing.city).toBe("Szeged"); // seeded from waitlist location

    // Founding subscription granted: free year, badge set.
    const sub = db
      .prepare("SELECT * FROM vendor_subscriptions WHERE vendor_account_id = ?")
      .get(me.data.account.id) as {
      subscription_status: string;
      is_founding_member: number;
      founding_until: number;
      currency: string;
    };
    expect(sub.subscription_status).toBe("founding");
    expect(sub.is_founding_member).toBe(1);
    expect(sub.currency).toBe("HUF"); // locale 'hu' → HUF
    expect(sub.founding_until).toBeGreaterThan(Date.now() + VENDOR_FOUNDING_DURATION_MS - 60_000);

    // Token is single-use: a second complete is refused.
    const again = await req("POST", "/api/vendor/onboard/complete", {
      token,
      password: "supersafe123",
      full_name: "Dup",
    });
    expect(again.status).toBe(409);
  });

  test("the founding vendor can edit; a lapsed vendor keeps the listing but loses the calendar", async () => {
    wipeAll();
    const admin = await addAdmin();
    const { token } = await acceptedWaitlistToken(admin, {
      email: "gate@weddly.test",
      business: "Gate Vendor",
    });
    const done = await req<{ token: string }>("POST", "/api/vendor/onboard/complete", {
      token,
      password: "supersafe123",
      full_name: "Gate Owner",
      locale: "en",
    });
    expect(done.status).toBe(201);
    const vendorToken = done.data.token;

    // Founding → entitled → can edit.
    const ok = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { city: "Vienna" },
      { token: vendorToken },
    );
    expect(ok.status).toBe(200);

    // Force the sub into the lapsed 'none' state. Freemium contract: the
    // LISTING stays editable on the FREE plan; the availability calendar is
    // the PRO surface the 402 gate still protects.
    const acct = db
      .prepare(
        "SELECT va.id AS id FROM vendor_accounts va JOIN users u ON u.id = va.owner_user_id WHERE u.email = ?",
      )
      .get("gate@weddly.test") as { id: number };
    db.prepare(
      "UPDATE vendor_subscriptions SET subscription_status = 'none', founding_until = NULL, is_founding_member = 0 WHERE vendor_account_id = ?",
    ).run(acct.id);

    const stillEditable = await req(
      "PATCH",
      "/api/vendor/listing/me",
      { city: "Graz" },
      { token: vendorToken },
    );
    expect(stillEditable.status).toBe(200);

    const blocked = await req(
      "POST",
      "/api/vendor/availability/me",
      { date: "2031-06-01" },
      { token: vendorToken },
    );
    expect(blocked.status).toBe(402);
  });
});

/** Helper: an under_review decision must not mint an onboarding token. Returns
 *  the count of pending tokens for that waitlist row (expected 0). */
async function acceptedWaitlistRejectMintsNothing(adminToken: string): Promise<number> {
  const submit = await req<{ entry: { id: number } }>("POST", "/api/vendors/waitlist", {
    business_name: "Under Review Co",
    email: "review@weddly.test",
    category: "catering",
    location: null,
    website: null,
    message: null,
    portfolio_links: [],
    instagram_handle: null,
  });
  const id = submit.data.entry.id;
  await req(
    "POST",
    `/api/admin/vendor-waitlist/${id}/decide`,
    { outcome: "under_review", subject: "Hold", body: "Még nézzük.", notes: "" },
    { token: adminToken },
  );
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM vendor_onboarding WHERE waitlist_id = ?")
    .get(id) as { n: number };
  return row.n;
}

// The activation mail is the one the vendor actually clicks. Regression guard
// for the "misleading homepage button" bug: the CTA button MUST be the
// single-use activation link (not the marketing homepage), the link must also
// be a clickable copy-paste fallback, and the footer must be honest
// (transactional "concerns your account", not the outreach "you have no
// account") now that a real account is waiting.
describe("vendor_activation email builder points every link at the activation URL", () => {
  const ACTIVATE_URL = "https://tryweddly.com/vendor/activate/deadbeefcafe";

  test("accept variant: CTA button + copy-paste fallback both are the activation link", () => {
    const built = buildEmail(
      "vendor_activation",
      {
        businessName: "Bloom Studio",
        activateUrl: ACTIVATE_URL,
        introMessage: "Szia Bloom Studio!\n\nFelvettünk titeket a katalógusba.",
        subject: "Wēddly: szívesen látnánk titeket",
      },
      { recipientName: "Bloom Studio" },
    );
    const { html, text } = built.rendered;

    // Admin subject rides along.
    expect(built.subject).toBe("Wēddly: szívesen látnánk titeket");
    // The dark CTA button href is EXACTLY the activation link — no UTM, no
    // homepage. `wd-cta` is the button class in the shared shell.
    expect(html).toContain(`href="${ACTIVATE_URL}" class="wd-cta"`);
    // Clear, bold action labels (both language cards render in the bilingual
    // guest fallback).
    expect(html).toContain("Fiók aktiválása");
    expect(html).toContain("Activate account");
    // The activation URL is ALSO a clickable copy-paste fallback line.
    expect(html).toContain(`<a href="${ACTIVATE_URL}"`);
    expect(html).toContain("Vagy másold be a böngészőbe:");
    // The old misleading homepage CTA label is gone.
    expect(html).not.toContain("Weddly megnyitása");
    expect(html).not.toContain("Open Weddly");
    // No UTM query string was bolted onto the single-use link.
    expect(html).not.toContain("utm_campaign=vendor_activation");
    // Honest, transactional footer — NOT the outreach "you have no account".
    expect(html).not.toContain("nincs fiókod nálunk");
    // The admin's warm intro carried through to the body + plain-text part.
    expect(text).toContain("Felvettünk titeket a katalógusba.");
    expect(text).toContain(ACTIVATE_URL);
  });

  test("resend variant: no admin body → clear default welcome + activation button", () => {
    const built = buildEmail(
      "vendor_activation",
      { businessName: "Bloom Studio", activateUrl: ACTIVATE_URL },
      { recipientName: "Bloom Studio" },
    );
    const { html } = built.rendered;
    // Falls back to the standard bilingual activation subject.
    expect(built.subject).toContain("Aktiváld a Weddly szolgáltatói fiókod");
    expect(html).toContain(`href="${ACTIVATE_URL}" class="wd-cta"`);
    expect(html).toContain("Fiók aktiválása");
    expect(html).toContain("nincs szükség bankkártyára");
    expect(html).not.toContain("Weddly megnyitása");
  });
});
