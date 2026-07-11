// "Finish your profile" planner nudge — the auto post-signup sweep + the admin
// "Send reminder" button. Fires when a planner's public profile still can't be
// listed (no business name or city).
//
// Covers (major-change rule — new email kind + worker sweep + admin endpoint):
//   - nothing fires before the 3-day mark
//   - the sweep sends exactly once past 3 days and is idempotent
//   - a complete profile is never nudged
//   - the admin button sends on demand (not deduped) and returns the gaps
//   - the rendered mail names only the empty fields

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { buildEmail } from "../../src/domain/emails/templates";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { latestCredentialToken, req, verifyUserEmail, wipeAll } from "../helpers";

/** Register + verify a planner. When `complete`, fill the directory-required
 *  business name + city so the profile is listable (and thus not nudged). */
async function makePlanner(email: string, complete: boolean): Promise<number> {
  const reg = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Rita Kruczli",
  });
  const t = latestCredentialToken("email_verification_tokens", email);
  await req("POST", `/api/auth/verify/${t}`, {});
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
  const id = reg.data.user.id;
  if (complete) {
    db.prepare(
      "UPDATE users SET business_name = ?, planner_city = ?, planner_styles = ? WHERE id = ?",
    ).run("Álomszép esküvők", "Budapest", JSON.stringify(["romantic"]), id);
  }
  return id;
}

function backdate(userId: number, ms: number): void {
  db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(Date.now() - ms, userId);
}

function nudgeCount(userId: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM email_log WHERE kind = 'planner_profile_incomplete' AND user_id = ?",
    )
    .get(userId) as { n: number };
  return row.n;
}

async function bootstrapAdmin(): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

const THREE_DAYS = 1000 * 60 * 60 * 24 * 3;

describe("planner profile-incomplete nudge", () => {
  test("does not fire before the 3-day mark", async () => {
    wipeAll();
    const id = await makePlanner("fresh@weddly.test", false);
    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
  });

  test("fires exactly once past 3 days and is idempotent", async () => {
    wipeAll();
    const id = await makePlanner("mature@weddly.test", false);
    backdate(id, THREE_DAYS + 1000 * 60 * 60);

    runEmailSweep();
    expect(nudgeCount(id)).toBe(1);
    // A second sweep must NOT re-send.
    runEmailSweep();
    expect(nudgeCount(id)).toBe(1);
  });

  test("a complete (listable) profile is never nudged", async () => {
    wipeAll();
    const id = await makePlanner("done@weddly.test", true);
    backdate(id, THREE_DAYS + 1000 * 60 * 60);
    runEmailSweep();
    expect(nudgeCount(id)).toBe(0);
  });

  test("admin 'Send reminder' sends on demand and returns the gaps", async () => {
    wipeAll();
    const id = await makePlanner("nudge-me@weddly.test", false);
    const adminToken = await bootstrapAdmin();

    const r = await req<{
      ok: true;
      missing: { businessName: boolean; city: boolean; bio: boolean; styles: boolean };
    }>("POST", `/api/admin/planners/${id}/remind-profile`, {}, { token: adminToken });
    expect(r.status).toBe(200);
    expect(r.data.missing.businessName).toBe(true);
    expect(r.data.missing.city).toBe(true);
    expect(nudgeCount(id)).toBe(1);

    // Manual send is NOT deduped — clicking again sends again.
    await req("POST", `/api/admin/planners/${id}/remind-profile`, {}, { token: adminToken });
    expect(nudgeCount(id)).toBe(2);
  });

  test("non-admin cannot trigger the reminder", async () => {
    wipeAll();
    const id = await makePlanner("victim@weddly.test", false);
    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "rando@weddly.test",
      password: "supersafe123",
      full_name: "Rando",
    });
    const r = await req(
      "POST",
      `/api/admin/planners/${id}/remind-profile`,
      {},
      { token: reg.data.token },
    );
    expect(r.status).toBe(403);
    expect(nudgeCount(id)).toBe(0);
  });

  test("the render names only the empty fields", () => {
    const built = buildEmail(
      "planner_profile_incomplete",
      {
        fullName: "Rita Kruczli",
        businessName: null,
        editUrl: "https://tryweddly.com/app/planner/settings/account",
        missing: { businessName: true, city: true, bio: false, styles: false },
      },
      { recipientName: "Rita Kruczli", recipientLocale: "en" },
    );
    const html = built.rendered.html;
    expect(html).toContain("Hi Rita Kruczli,");
    expect(html).toContain("your business name");
    expect(html).toContain("your city");
    // bio + styles are filled, so they're not named.
    expect(html).not.toContain("a short bio");
    expect(html).not.toContain("your styles");
    expect(html).toContain("/app/planner/settings/account");
  });
});
