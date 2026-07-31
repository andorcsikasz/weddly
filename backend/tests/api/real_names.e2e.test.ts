import "../setup";

import { describe, expect, test } from "bun:test";
import { checkRealName } from "@shared/real_names";
import type { Couple } from "@shared/types";
import { db } from "../../src/db";
import { backfillNameReview } from "../../src/domain/name_review";
import { runEmailSweep } from "../../src/domain/emails/worker";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

// A workspace is only worth something if a real couple is behind it. Production
// carried "x & y", "XY & Z", "NŐ & FÉRFI" (WOMAN & MAN), "Asszony & Ferj"
// (WIFE & HUSBAND), "Nem & Tudom" (I & DON'T-KNOW) and "Bridee & Groomy" before
// this rule existed, so these tests pin both halves: the gate that stops the
// next one, and the 3-day correction window the existing ones were given.

describe("the real-name rule itself", () => {
  test("refuses the shapes that turned up in production", () => {
    for (const name of [
      "x",
      "y",
      "N",
      "Kr",
      "XY",
      "NŐ",
      "FÉRFI",
      "Asszony",
      "Ferj",
      "Nem",
      "Tudom",
      "Bridee",
      "Groomy",
      "Bride",
      "Groom",
      "Bridey",
      "test",
      "asdf",
      "qwerty",
      "aaa",
      "TBD",
      "123",
    ]) {
      expect(checkRealName(name)).not.toBeNull();
    }
  });

  test("accepts the names real couples actually use", () => {
    for (const name of [
      // Hungarian nicknames, all of which end in the -i the diminutive strip
      // reaches for. Every one of these was a false positive at some point
      // while this rule was being written.
      "Bari",
      "Eni",
      "Mani",
      "Bori",
      "Feri",
      "Mari",
      "Ági",
      "Zsófi",
      "Peti",
      "Csabi",
      // Ordinary given names, including the two-letter ones.
      "Anna",
      "Zo",
      "Jo",
      "Ed",
      "Napsugár",
      "Csordás Eszter",
      "Klein Tamara",
      "Eva Green",
    ]) {
      expect(checkRealName(name)).toBeNull();
    }
  });

  test("does not refuse a business for being in the wedding business", () => {
    // Both of these are live production accounts. The industry's own words are
    // in every second supplier's name, so they are evidence of nothing.
    expect(checkRealName("Esküvői Weboldalam")).toBeNull();
    expect(checkRealName("Dream Wedding Film")).toBeNull();
    expect(checkRealName("Boda y Fiesta")).toBeNull();
  });

  test("says nothing about a name written in another script", () => {
    // The rule is a list of Latin words. Folding to [a-z] would empty these
    // out and refuse every one of them as "contains no letters", which would
    // lock a whole market out of signup.
    for (const name of ["王芳", "Ольга", "محمد", "김민준", "Γιώργος", "Nguyễn Thị Hương"]) {
      expect(checkRealName(name)).toBeNull();
    }
    // Two people whose given name is a two-letter word this rule blocks when
    // it stands alone as the whole answer.
    expect(checkRealName("No Jin")).toBeNull();
    expect(checkRealName("En Hui")).toBeNull();
  });
});

describe("the gate on the way in", () => {
  test("register refuses a placeholder name", async () => {
    wipeAll();
    const r = await req<{ detail?: { code?: string; reason?: string } }>(
      "POST",
      "/api/auth/register",
      { email: "fake@weddly.test", password: "supersafe123", full_name: "Bride" },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("placeholder_name");
    expect(r.data.detail?.reason).toBe("role_word");
    // Nothing was created, not even a pending signup.
    const pending = db
      .prepare("SELECT count(*) AS n FROM pending_signups WHERE email = ?")
      .get("fake@weddly.test") as { n: number };
    expect(pending.n).toBe(0);
  });

  test("register still accepts an ordinary name", async () => {
    wipeAll();
    const r = await registerAndVerify({
      email: "real@weddly.test",
      password: "supersafe123",
      full_name: "Anna Kovács",
    });
    expect(r.status).toBe(201);
  });

  test("onboarding refuses placeholder partner names, naming the field", async () => {
    wipeAll();
    const reg = await registerAndVerify({
      email: "ob@weddly.test",
      password: "supersafe123",
      full_name: "Anna Kovács",
    });
    const r = await req<{ detail?: { code?: string; field?: string } }>(
      "POST",
      "/api/couples/onboard",
      {
        bride_name: "x",
        groom_name: "y",
        wedding_date: "2027-09-12",
        target_guest_count: 80,
        budget_ceiling_huf: 5_000_000,
        style_tags: [],
      },
      { token: reg.data.token },
    );
    expect(r.status).toBe(400);
    expect(r.data.detail?.code).toBe("placeholder_name");
    expect(r.data.detail?.field).toBe("bride_name");
  });

  test("renaming to a placeholder later is refused too", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("rename@weddly.test");
    const r = await req(
      "PATCH",
      "/api/couples/current",
      { bride_name: "Groomy", groom_name: "Anna" },
      { token },
    );
    expect(r.status).toBe(400);
  });

  test("a user cannot rename themselves to a placeholder", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("selfrename@weddly.test");
    const bad = await req("PATCH", "/api/users/me", { full_name: "asdf" }, { token });
    expect(bad.status).toBe(400);
    const good = await req("PATCH", "/api/users/me", { full_name: "Anna Kovács" }, { token });
    expect(good.status).toBe(200);
  });

  test("a vendor keeps their business name, which is not a person name", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("biz@weddly.test");
    // Same account, re-typed as a vendor: `full_name` is now a business.
    db.prepare("UPDATE users SET role = 'vendor' WHERE email = ?").run("biz@weddly.test");
    const r = await req(
      "PATCH",
      "/api/users/me",
      { full_name: "Bride & Groom Photography" },
      { token },
    );
    expect(r.status).toBe(200);
  });
});

/** Put a workspace into the state the gate would have prevented, the way the
 *  ~14 production couples got there: written before the rule existed. */
function forceNames(coupleId: number, bride: string, groom: string): void {
  db.prepare(
    "UPDATE couples SET bride_name = ?, groom_name = ?, display_name = ? WHERE id = ?",
  ).run(bride, groom, `${bride} & ${groom}`, coupleId);
}

function flaggedAt(coupleId: number): number | null {
  const row = db.prepare("SELECT name_flagged_at FROM couples WHERE id = ?").get(coupleId) as {
    name_flagged_at: number | null;
  };
  return row.name_flagged_at;
}

describe("the 3-day window for couples already inside", () => {
  test("the backfill flags placeholders, spares everyone else, and keeps its date", async () => {
    wipeAll();
    const bad = await bootstrapCouple("legacy-bad@weddly.test");
    const good = await bootstrapCouple("legacy-good@weddly.test");
    forceNames(bad.coupleId, "x", "y");
    forceNames(good.coupleId, "Anna", "Bence");

    expect(backfillNameReview().flagged).toBe(1);
    const first = flaggedAt(bad.coupleId);
    expect(first).not.toBeNull();
    expect(flaggedAt(good.coupleId)).toBeNull();

    // Idempotent. A second boot must NOT restart the three days, or the date
    // in the email we already sent stops being true.
    backfillNameReview();
    expect(flaggedAt(bad.coupleId)).toBe(first);
  });

  test("the couple is told, with the deadline, and is not yet locked", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("notice@weddly.test");
    forceNames(coupleId, "NŐ", "FÉRFI");
    backfillNameReview();

    const r = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, { token });
    const review = r.data.couple.name_review;
    expect(review).not.toBeNull();
    expect(review?.locked).toBe(false);
    expect(review?.fields.map((f) => f.field)).toEqual(["bride_name", "groom_name"]);
    // Three days, counted from when we noticed.
    expect(review!.deadline - review!.flagged_at).toBe(3 * 24 * 60 * 60 * 1000);

    // Inside the window the workspace still works.
    const write = await req("POST", "/api/guests", { full_name: "Kata Nagy" }, { token });
    expect(write.status).toBe(201);
  });

  test("past the deadline the workspace is read-only, and the fix still gets through", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("locked@weddly.test");
    forceNames(coupleId, "Bridee", "Groomy");
    backfillNameReview();
    // Age the flag past the window.
    db.prepare("UPDATE couples SET name_flagged_at = ? WHERE id = ?").run(
      Date.now() - 4 * 24 * 60 * 60 * 1000,
      coupleId,
    );

    const read = await req("GET", "/api/guests", undefined, { token });
    expect(read.status).toBe(200); // reads stay open

    const blocked = await req<{ detail?: { code?: string } }>(
      "POST",
      "/api/guests",
      { full_name: "Kata Nagy" },
      { token },
    );
    expect(blocked.status).toBe(409);
    expect(blocked.data.detail?.code).toBe("name_review_required");

    // The one door left open, and the reason the lock is not a support ticket.
    const fix = await req<{ couple: Couple }>(
      "PATCH",
      "/api/couples/current",
      { bride_name: "Dóra", groom_name: "Gergő" },
      { token },
    );
    expect(fix.status).toBe(200);
    expect(fix.data.couple.name_review).toBeNull();
    expect(flaggedAt(coupleId)).toBeNull();

    // And the workspace is immediately itself again, with no sweep in between.
    const after = await req("POST", "/api/guests", { full_name: "Kata Nagy" }, { token });
    expect(after.status).toBe(201);
  });

  test("a locked workspace cannot slip a placeholder back through the open door", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("relock@weddly.test");
    forceNames(coupleId, "x", "y");
    backfillNameReview();
    db.prepare("UPDATE couples SET name_flagged_at = ? WHERE id = ?").run(
      Date.now() - 4 * 24 * 60 * 60 * 1000,
      coupleId,
    );

    const r = await req(
      "PATCH",
      "/api/couples/current",
      { bride_name: "XY", groom_name: "Z" },
      { token },
    );
    expect(r.status).toBe(400);
    expect(flaggedAt(coupleId)).not.toBeNull();
  });

  test("the notice email goes to the couple once, not once per sweep", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("mailed@weddly.test");
    forceNames(coupleId, "Nem", "Tudom");
    backfillNameReview();

    expect(runEmailSweep().nameReviewNotices).toBe(1);
    const stamped = db
      .prepare("SELECT name_notice_sent_at FROM couples WHERE id = ?")
      .get(coupleId) as { name_notice_sent_at: number | null };
    expect(stamped.name_notice_sent_at).not.toBeNull();

    expect(runEmailSweep().nameReviewNotices).toBe(0);
  });

  test("a demo workspace is never flagged", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("demo@weddly.test");
    forceNames(coupleId, "x", "y");
    db.prepare("UPDATE couples SET is_demo = 1 WHERE id = ?").run(coupleId);
    expect(backfillNameReview().flagged).toBe(0);
    expect(flaggedAt(coupleId)).toBeNull();
  });

  test("the backfill retires a flag whose names have since been fixed", async () => {
    wipeAll();
    const { coupleId } = await bootstrapCouple("healed@weddly.test");
    forceNames(coupleId, "x", "y");
    backfillNameReview();
    expect(flaggedAt(coupleId)).not.toBeNull();

    // Fixed straight in the DB, i.e. not through the route that clears it.
    forceNames(coupleId, "Anna", "Bence");
    expect(backfillNameReview().cleared).toBe(1);
    expect(flaggedAt(coupleId)).toBeNull();
  });
});
