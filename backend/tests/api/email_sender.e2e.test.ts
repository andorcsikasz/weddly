import "../setup";

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CONFIG } from "../../src/config";
import { db } from "../../src/db";
import { buildResendPayload } from "../../src/lib/mailer";
import { scanAdminSenderIntegrity } from "../../src/domain/emails/integrity_check";
import { senderForKind } from "../../src/domain/emails/kinds";
import { buildUnsubscribeHeaders } from "../../src/domain/emails/preferences";
import { sendKind } from "../../src/domain/emails/send";
import { registerAndVerify, req, wipeAll } from "../helpers";

// Owner rule, 2026-07-31: anything an admin sends from /app/admin/* leaves
// from the support mailbox, never `noreply@`. A person wrote it and a person
// is waiting for the reply, so a sender that cannot receive one is a lie the
// recipient reads before the first word.
//
// ONE exception, by owner direction: the vendor RATING campaign keeps the
// automatic sender.

describe("which mailbox a send leaves from", () => {
  test("the admin sender is the support mailbox, and it keeps the display name", () => {
    // Test env pins EMAIL_FROM="" (no domain to conflict with) and
    // SUPPORT_EMAIL=hello@tryweddly.com.
    expect(CONFIG.emailFromAdmin).toBe("hello@tryweddly.com");
    // In production EMAIL_FROM carries a display name; the admin sender takes
    // the same one so the two never read as two different companies.
    const derived = (from: string) =>
      from.includes("<")
        ? `${from.slice(0, from.indexOf("<")).trim()} <${CONFIG.supportEmail}>`
        : CONFIG.supportEmail;
    expect(derived("Weddly <noreply@tryweddly.com>")).toBe("Weddly <hello@tryweddly.com>");
  });

  test("admin-console kinds resolve to the admin sender", () => {
    for (const kind of [
      "admin_feedback_reply",
      "account_flagged",
      "free_access_granted",
      "community_supplier_published",
      "planner_waitlist_decision",
      "vendor_activation",
      "vendor_claim_campaign",
      "personal_invite",
      "onboarding_campaign",
    ] as const) {
      expect(senderForKind(kind)).toBe("admin");
    }
  });

  test("the rating campaign is the deliberate exception", () => {
    // Owner direction. If this ever flips, it flips on purpose, not because
    // someone tidied the campaign kinds into one list.
    expect(senderForKind("vendor_review_campaign")).toBe("default");
    expect(senderForKind("vendor_review_campaign_reminder")).toBe("default");
  });

  test("automatic mail keeps the automatic sender", () => {
    for (const kind of [
      "welcome_verify",
      "password_reset",
      "guest_invite",
      "milestone_t30",
      "wedding_today",
      "post_wedding_review_request",
      "supplier_outreach",
    ] as const) {
      expect(senderForKind(kind)).toBe("default");
    }
  });

  test("a kind the worker ALSO fires switches on the per-send override alone", () => {
    // verify_resend goes out both from the user's own "resend" button and from
    // the admin console. Classifying the KIND would drag the user-triggered
    // path along with it, so only the admin call site passes the override.
    expect(senderForKind("verify_resend")).toBe("default");
    expect(senderForKind("verify_resend", "admin")).toBe("admin");
    expect(senderForKind("partner_invite_reminder")).toBe("default");
    expect(senderForKind("partner_invite_reminder", "admin")).toBe("admin");
    expect(senderForKind("planner_profile_incomplete")).toBe("default");
    expect(senderForKind("planner_profile_incomplete", "admin")).toBe("admin");
  });

  test("no /api/admin/ route sends from the default mailbox unclassified", () => {
    // The drift this guards: a NEW admin route sends a kind nobody classified.
    // Nothing breaks, no error is raised — the mail just goes out from the
    // wrong mailbox, which is invisible until someone hits Reply.
    const repoRoot = join(import.meta.dir, "..", "..", "..");
    const violations = scanAdminSenderIntegrity(repoRoot);
    if (violations.length > 0) {
      throw new Error(violations.map((v) => `  ${v.path} — ${v.reason}`).join("\n"));
    }
    expect(violations.length).toBe(0);
  });
});

describe("the sender that actually went out is recorded", () => {
  async function newAdmin(): Promise<string> {
    const r = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    expect(r.status).toBe(201);
    return r.data.token;
  }

  function loggedFrom(kind: string): string | null {
    const row = db
      .prepare("SELECT from_email FROM email_log WHERE kind = ? ORDER BY id DESC LIMIT 1")
      .get(kind) as { from_email: string | null } | undefined;
    expect(row).toBeDefined();
    return row?.from_email ?? null;
  }

  test("an admin's feedback reply leaves from the support mailbox", async () => {
    wipeAll();
    const adminToken = await newAdmin();

    const submitter = await registerAndVerify({
      email: "writer@test.test",
      password: "supersafe123",
      full_name: "Flóra Kiss",
    });
    expect(submitter.status).toBe(201);

    const submit = await req(
      "POST",
      "/api/feedback",
      { source: "app", context: "/app/budget", message: "The budget page is slow." },
      { token: submitter.data.token },
    );
    expect(submit.status).toBe(200);

    const list = await req<{ entries: Array<{ id: number }> }>(
      "GET",
      "/api/admin/feedback",
      undefined,
      { token: adminToken },
    );
    const entryId = list.data.entries[0]!.id;

    const reply = await req(
      "POST",
      `/api/admin/feedback/${entryId}/reply`,
      { message: "Thanks for the feedback, we'll take a look.", channel: "email" },
      { token: adminToken },
    );
    expect(reply.status).toBe(200);

    expect(loggedFrom("admin_feedback_reply")).toBe("hello@tryweddly.com");
  });

  test("the same couple's automatic mail still leaves from the default sender", async () => {
    // The register that produced this account fired welcome_verify on the
    // ordinary path. It must NOT have picked up the admin mailbox.
    expect(loggedFrom("welcome_verify")).toBe(CONFIG.emailFrom);
    expect(loggedFrom("welcome_verify")).not.toBe(CONFIG.emailFromAdmin);
  });
});

// Reported 2026-07-31: a couple answered a hand-written support reply and the
// answer went to `noreply@`, under a footer promising it would reach us.
// Reply-To was being passed to Resend as a custom header, and Resend owns that
// header on every message it sends — ours never left the building. The address
// only travels in the top-level `reply_to` field.
describe("a reply reaches a human", () => {
  test("Reply-To rides the top-level field, never a header", () => {
    const payload = buildResendPayload({
      to: "flora@test.test",
      subject: "Reply to your feedback",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(payload.reply_to).toBe(CONFIG.supportEmail);
    // A Reply-To sitting in `headers` is the exact shape that silently failed.
    const headers = payload.headers as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("reply-to");
    // The headers Resend does honour are untouched.
    expect(headers["Auto-Submitted"]).toBe("auto-generated");
  });

  test("a per-kind override wins over the support mailbox", () => {
    // supplier_outreach points a vendor's reply straight at the couple.
    const payload = buildResendPayload({
      to: "vendor@test.test",
      subject: "Wedding enquiry",
      html: "<p>hi</p>",
      text: "hi",
      replyTo: "couple@test.test",
    });
    expect(payload.reply_to).toBe("couple@test.test");
  });

  test("a caller that still passes the header gets it promoted, not dropped", () => {
    const payload = buildResendPayload({
      to: "vendor@test.test",
      subject: "Wedding enquiry",
      html: "<p>hi</p>",
      text: "hi",
      headers: { "Reply-To": "couple@test.test", "List-Unsubscribe": "<https://x.test/u>" },
    });
    expect(payload.reply_to).toBe("couple@test.test");
    const headers = payload.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toBe("<https://x.test/u>");
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain("reply-to");
  });
});

describe("one-click unsubscribe headers", () => {
  test("builds the RFC 8058 pair pointing at the token URL", () => {
    const headers = buildUnsubscribeHeaders("abc123");
    expect(headers["List-Unsubscribe"]).toBe(`<${CONFIG.frontendBaseUrl}/api/unsubscribe/abc123>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  test("reaches buildResendPayload untouched, same as any other header", () => {
    const payload = buildResendPayload({
      to: "couple@test.test",
      subject: "A reminder",
      html: "<p>hi</p>",
      text: "hi",
      headers: buildUnsubscribeHeaders("xyz789"),
    });
    const headers = payload.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toBe(`<${CONFIG.frontendBaseUrl}/api/unsubscribe/xyz789>`);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });
});

describe("admin email duplicate guard", () => {
  test("the same kind and address can leave the admin console only once in five minutes", async () => {
    wipeAll();
    const target = {
      user: null,
      guest: { email: "  SAME@Example.test ", full_name: "Same recipient" },
      sender: "admin" as const,
    };

    const first = await sendKind(
      "verify_resend",
      { verifyUrl: "https://example.test/verify/first" },
      target,
    );
    const duplicate = await sendKind(
      "verify_resend",
      { verifyUrl: "https://example.test/verify/second" },
      target,
    );

    expect(first.status).toBe("skipped_no_provider");
    expect(duplicate.status).toBe("skipped_duplicate");
    const rows = db
      .prepare("SELECT status FROM email_log WHERE lower(trim(to_email)) = ? ORDER BY id")
      .all("same@example.test") as Array<{ status: string }>;
    expect(rows.map((row) => row.status)).toEqual(["skipped_no_provider", "skipped_duplicate"]);
  });

  test("automatic sends are unaffected, and an expired admin guard can be replaced", async () => {
    wipeAll();
    const automaticTarget = {
      user: null,
      guest: { email: "repeat@example.test", full_name: "Repeat" },
    };
    const one = await sendKind(
      "verify_resend",
      { verifyUrl: "https://example.test/verify/one" },
      automaticTarget,
    );
    const two = await sendKind(
      "verify_resend",
      { verifyUrl: "https://example.test/verify/two" },
      automaticTarget,
    );
    expect(one.status).toBe("skipped_no_provider");
    expect(two.status).toBe("skipped_no_provider");

    const adminTarget = { ...automaticTarget, sender: "admin" as const };
    expect(
      (
        await sendKind(
          "verify_resend",
          { verifyUrl: "https://example.test/verify/admin-one" },
          adminTarget,
        )
      ).status,
    ).toBe("skipped_no_provider");
    db.prepare(
      "UPDATE admin_email_send_dedupe SET reserved_at = 1 WHERE to_email = ? AND kind = ?",
    ).run("repeat@example.test", "verify_resend");
    expect(
      (
        await sendKind(
          "verify_resend",
          { verifyUrl: "https://example.test/verify/admin-two" },
          adminTarget,
        )
      ).status,
    ).toBe("skipped_no_provider");
  });
});
