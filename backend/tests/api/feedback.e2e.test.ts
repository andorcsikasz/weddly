import "../setup";
import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** Feedback triage workflow (see shared/feedback.ts):
 *    - expanded status lifecycle (new/reviewed/planned/fixed/rejected/archived)
 *    - admin triage fields (priority / product area / internal notes)
 *    - technical context captured at submission (device/browser/os from the
 *      User-Agent header, full URL from the body)
 *    - product area auto-inferred from the in-app route
 */
describe("feedback triage workflow", () => {
  async function newAdmin(): Promise<string> {
    const r = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    expect(r.status).toBe(201);
    return r.data.token;
  }

  async function firstEntryId(token: string): Promise<number> {
    const list = await req<{ entries: Array<{ id: number }> }>(
      "GET",
      "/api/admin/feedback",
      undefined,
      { token },
    );
    expect(list.status).toBe(200);
    return list.data.entries[0]!.id;
  }

  test("captures device/browser/os from User-Agent and url from the body", async () => {
    wipeAll();
    const adminToken = await newAdmin();

    const submit = await req(
      "POST",
      "/api/feedback",
      {
        source: "app",
        context: "/app/budget",
        url: "https://weddly.hu/app/budget?tab=lines",
        message: "Budget page is slow on my phone.",
      },
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        },
      },
    );
    expect(submit.status).toBe(200);

    const list = await req<{
      entries: Array<{
        device: string | null;
        browser: string | null;
        os: string | null;
        url: string | null;
        feature_area: string | null;
      }>;
    }>("GET", "/api/admin/feedback", undefined, { token: adminToken });
    const entry = list.data.entries[0]!;
    expect(entry.device).toBe("mobile");
    expect(entry.browser).toBe("Safari");
    expect(entry.os).toBe("iOS");
    expect(entry.url).toBe("https://weddly.hu/app/budget?tab=lines");
    // Product area inferred from the second path segment of the route.
    expect(entry.feature_area).toBe("budget");
  });

  test("desktop Chrome on Windows classifies correctly", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req(
      "POST",
      "/api/feedback",
      { message: "Desktop note." },
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
      },
    );
    const list = await req<{
      entries: Array<{ device: string; browser: string; os: string }>;
    }>("GET", "/api/admin/feedback", undefined, { token: adminToken });
    const entry = list.data.entries[0]!;
    expect(entry.device).toBe("desktop");
    expect(entry.browser).toBe("Chrome");
    expect(entry.os).toBe("Windows");
  });

  test("admin can move through the full lifecycle including archived", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req("POST", "/api/feedback", { message: "Lifecycle." });
    const id = await firstEntryId(adminToken);

    for (const status of ["reviewed", "planned", "fixed", "rejected", "archived"] as const) {
      const r = await req<{ entry: { status: string } }>(
        "PATCH",
        `/api/admin/feedback/${id}/status`,
        { status },
        { token: adminToken },
      );
      expect(r.status).toBe(200);
      expect(r.data.entry.status).toBe(status);
    }
  });

  test("admin can set priority, area, and notes via the triage PATCH", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req("POST", "/api/feedback", { message: "Triage me." });
    const id = await firstEntryId(adminToken);

    const set = await req<{
      entry: { priority: string | null; feature_area: string | null; admin_notes: string | null };
    }>(
      "PATCH",
      `/api/admin/feedback/${id}`,
      { priority: "high", feature_area: "guests", admin_notes: "Likely a real bug." },
      { token: adminToken },
    );
    expect(set.status).toBe(200);
    expect(set.data.entry.priority).toBe("high");
    expect(set.data.entry.feature_area).toBe("guests");
    expect(set.data.entry.admin_notes).toBe("Likely a real bug.");

    // Partial update leaves untouched fields alone, and null clears.
    const partial = await req<{
      entry: { priority: string | null; feature_area: string | null; admin_notes: string | null };
    }>("PATCH", `/api/admin/feedback/${id}`, { priority: null }, { token: adminToken });
    expect(partial.data.entry.priority).toBe(null);
    expect(partial.data.entry.feature_area).toBe("guests");
    expect(partial.data.entry.admin_notes).toBe("Likely a real bug.");
  });

  test("triage PATCH rejects an invalid priority", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req("POST", "/api/feedback", { message: "Bad priority." });
    const id = await firstEntryId(adminToken);
    const r = await req(
      "PATCH",
      `/api/admin/feedback/${id}`,
      { priority: "urgent" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("triage PATCH is admin-gated", async () => {
    wipeAll();
    await newAdmin();
    const user = await registerAndVerify({
      email: "user@test.test",
      password: "supersafe123",
      full_name: "Zsolt Nagy",
    });
    const r = await req(
      "PATCH",
      "/api/admin/feedback/1",
      { priority: "low" },
      { token: user.data.token },
    );
    expect(r.status).toBe(403);
  });

  interface ReplyResp {
    entry: {
      status: string;
      replies: Array<{ message: string; channel: string; notified: boolean }>;
    };
    delivery: { email: string | null; notified: boolean };
  }

  test("admin can reply by email to an anonymous submission and it advances to reviewed", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req("POST", "/api/feedback", {
      message: "Love the app, one small bug.",
      from_email: "guest@example.com",
    });
    const id = await firstEntryId(adminToken);

    const r = await req<ReplyResp>(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "Thanks for flagging it, fixed now!", channel: "email" },
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    // No RESEND key in the test env, so the mailer short-circuits to a logged
    // "skipped_no_provider" attempt, proof the send path ran end to end.
    expect(r.data.delivery.email).toBe("skipped_no_provider");
    expect(r.data.delivery.notified).toBe(false);
    expect(r.data.entry.replies).toHaveLength(1);
    expect(r.data.entry.replies[0]!.channel).toBe("email");
    expect(r.data.entry.replies[0]!.message).toBe("Thanks for flagging it, fixed now!");
    // A reply nudges a still-new row to reviewed.
    expect(r.data.entry.status).toBe("reviewed");

    const duplicate = await req(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "Thanks for flagging it, fixed now!", channel: "email" },
      { token: adminToken },
    );
    expect(duplicate.status).toBe(409);
    const replyCount = db
      .prepare("SELECT COUNT(*) AS n FROM feedback_replies WHERE feedback_id = ?")
      .get(id) as { n: number };
    expect(replyCount.n).toBe(1);
  });

  test("reply via in-app notification lands in the submitter's bell", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    const couple = await bootstrapCouple("submitter@weddly.test");

    // Authenticated submission, captures user_id so the notification can be
    // routed to the submitter's workspace.
    await req(
      "POST",
      "/api/feedback",
      { source: "app", context: "/app/seating", message: "How do I move the chairs?" },
      { token: couple.token },
    );
    const id = await firstEntryId(adminToken);

    const r = await req<ReplyResp>(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "Edit tables under Terem; seat guests under Ültetés.", channel: "notification" },
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.delivery.notified).toBe(true);
    expect(r.data.delivery.email).toBe(null);
    expect(r.data.entry.replies[0]!.channel).toBe("notification");

    const feed = await req<{
      items: Array<{ kind: string; data: { message?: string } }>;
    }>("GET", "/api/notifications", undefined, { token: couple.token });
    const msg = feed.data.items.find((i) => i.kind === "admin_message");
    expect(msg).toBeDefined();
    expect(msg!.data.message).toBe("Edit tables under Terem; seat guests under Ültetés.");
  });

  test("channel 'both' delivers email and a bell notification", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    const couple = await bootstrapCouple("both@weddly.test");
    await req(
      "POST",
      "/api/feedback",
      { source: "app", context: "/app/budget", message: "A note." },
      { token: couple.token },
    );
    const id = await firstEntryId(adminToken);

    const r = await req<ReplyResp>(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "Answered.", channel: "both" },
      { token: adminToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.delivery.email).toBe("skipped_no_provider");
    expect(r.data.delivery.notified).toBe(true);
    expect(r.data.entry.replies[0]!.channel).toBe("both");
    expect(r.data.entry.replies[0]!.notified).toBe(true);
  });

  test("reply requires a non-empty message", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req("POST", "/api/feedback", { message: "x", from_email: "g@example.com" });
    const id = await firstEntryId(adminToken);
    const r = await req(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "   ", channel: "email" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("notification-only reply to an anonymous submission is rejected", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    await req("POST", "/api/feedback", { message: "Anon note.", from_email: "g@example.com" });
    const id = await firstEntryId(adminToken);
    const r = await req(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "Hello?", channel: "notification" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("email reply to a submission with no address on file is rejected", async () => {
    wipeAll();
    const adminToken = await newAdmin();
    // Rating-only, anonymous, no user_id and no from_email.
    await req("POST", "/api/feedback", { rating: 8 });
    const id = await firstEntryId(adminToken);
    const r = await req(
      "POST",
      `/api/admin/feedback/${id}/reply`,
      { message: "Thanks!", channel: "email" },
      { token: adminToken },
    );
    expect(r.status).toBe(400);
  });

  test("reply is admin-gated", async () => {
    wipeAll();
    await newAdmin();
    const user = await registerAndVerify({
      email: "user2@test.test",
      password: "supersafe123",
      full_name: "Zsolt Nagy",
    });
    const r = await req(
      "POST",
      "/api/admin/feedback/1/reply",
      { message: "hi", channel: "email" },
      { token: user.data.token },
    );
    expect(r.status).toBe(403);
  });
});
