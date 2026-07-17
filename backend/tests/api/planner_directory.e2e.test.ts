// Couple-facing planner directory (the /app/vendors rail) + funnel touch-ups:
// the directory only lists live, verified, minimally-complete planner accounts;
// connecting by user id reuses the consent flow; the waitlist submit sends a
// confirmation mail; and a couple's invite outcome notifies the couple.

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { PRIVACY_VERSION } from "@shared/legal";
import type { PlannerDirectoryDetail, PlannerDirectoryEntry } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";

/** Register + verify + promote to planner, then fill the profile fields the
 *  directory requires (business name + city) unless `listable: false`. */
async function makePlanner(
  email: string,
  opts: { listable?: boolean; verified?: boolean; overrides?: Record<string, unknown> } = {},
): Promise<{ token: string; userId: number }> {
  const { listable = true, verified = true, overrides = {} } = opts;
  // A password register only mints the user row once the verify link is
  // clicked, so every planner starts verified; `verified: false` then flips the
  // flag back off to model an account that never confirmed its address.
  const reg = await registerAndVerify({
    email,
    password: "supersafe123",
    full_name: "Eszter Nagy",
  });
  expect(reg.status).toBe(201);
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
  const userId = (
    db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as {
      id: number;
    }
  ).id;
  if (!verified) {
    db.prepare("UPDATE users SET verified_email = 0 WHERE id = ?").run(userId);
  }
  if (listable) {
    db.prepare(
      "UPDATE users SET business_name = ?, planner_city = ?, planner_bio = ? WHERE id = ?",
    ).run("Nagy Weddings", "Budapest", "We plan calm, editorial weddings.", userId);
  }
  for (const [k, v] of Object.entries(overrides)) {
    db.prepare(`UPDATE users SET ${k} = ? WHERE id = ?`).run(v as never, userId);
  }
  return { token: reg.data.token, userId };
}

function directory(coupleToken: string) {
  return req<{ planners: PlannerDirectoryEntry[] }>(
    "GET",
    "/api/couples/planner-directory",
    undefined,
    { token: coupleToken },
  );
}

describe("couple planner directory", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("lists a live, complete planner and omits their email", async () => {
    const { userId } = await makePlanner("listed@weddly.test");
    const { token: coupleToken } = await bootstrapCouple("dir-couple@weddly.test");

    const r = await directory(coupleToken);
    expect(r.status).toBe(200);
    const entry = r.data.planners.find((p) => p.planner_user_id === userId);
    expect(entry).toBeDefined();
    expect(entry?.business_name).toBe("Nagy Weddings");
    expect(entry?.city).toBe("Budapest");
    expect(entry?.link_status).toBe("none");
    // The email must never leak through the directory DTO.
    expect(JSON.stringify(entry)).not.toContain("listed@weddly.test");
  });

  test("surfaces the admin-granted verified badge and sorts verified planners first", async () => {
    const plain = await makePlanner("plain@weddly.test");
    const badge = await makePlanner("badge@weddly.test", {
      overrides: { planner_verified: 1 },
    });
    const { token: coupleToken } = await bootstrapCouple("verify-dir-couple@weddly.test");

    const r = await directory(coupleToken);
    expect(r.status).toBe(200);
    expect(r.data.planners.find((p) => p.planner_user_id === plain.userId)?.verified).toBe(false);
    expect(r.data.planners.find((p) => p.planner_user_id === badge.userId)?.verified).toBe(true);
    // Verified planners lead the directory.
    expect(r.data.planners[0]?.planner_user_id).toBe(badge.userId);

    // The detail DTO carries the badge too.
    const detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${badge.userId}`,
      undefined,
      { token: coupleToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.verified).toBe(true);
  });

  test("admin-verified planners are listed even with a thin profile (no business name / city)", async () => {
    // Verified badge granted, but onboarding not finished: no business_name /
    // planner_city. The relaxed gate still surfaces them (card falls back to
    // full_name; city is optional), unlike an unverified thin planner.
    const { userId } = await makePlanner("thinverified@weddly.test", {
      listable: false,
      overrides: { planner_verified: 1 },
    });
    const { token: coupleToken } = await bootstrapCouple("thin-couple@weddly.test");

    const r = await directory(coupleToken);
    expect(r.status).toBe(200);
    const entry = r.data.planners.find((p) => p.planner_user_id === userId);
    expect(entry).toBeDefined();
    expect(entry?.verified).toBe(true);
    // Unset business name / city come back as empty strings; full_name carries
    // the display fallback the card renders.
    expect(entry?.business_name).toBe("");
    expect(entry?.city).toBe("");
    expect(entry?.full_name).toBe("Eszter Nagy");

    // The detail endpoint opens too (mirrors the relaxed gate).
    const detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${userId}`,
      undefined,
      { token: coupleToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.business_name).toBe("");
    expect(detail.data.full_name).toBe("Eszter Nagy");
  });

  test("excludes planners with no business name / city, unverified, or suspended", async () => {
    await makePlanner("nocity@weddly.test", { listable: false });
    await makePlanner("unverified@weddly.test", { verified: false });
    await makePlanner("suspended@weddly.test", {
      overrides: { status: "suspended" },
    });
    const { token: coupleToken } = await bootstrapCouple("excl-couple@weddly.test");

    const r = await directory(coupleToken);
    const emails = r.data.planners.map((p) => p.business_name);
    // Only the suspended/unverified/incomplete ones exist; none qualify.
    expect(r.data.planners.length).toBe(0);
    expect(emails).not.toContain("Nagy Weddings");
  });

  test("excludes demo planners", async () => {
    await makePlanner("realdemo@weddly.test", {
      overrides: { email: "demo-abc@demo.weddly.local" },
    });
    const { token: coupleToken } = await bootstrapCouple("demo-couple@weddly.test");
    const r = await directory(coupleToken);
    expect(r.data.planners.length).toBe(0);
  });

  test("connect by id creates a couple-initiated pending link the planner can accept", async () => {
    const { token: plannerToken, userId } = await makePlanner("connect@weddly.test");
    const { token: coupleToken, coupleId } = await bootstrapCouple("connect-couple@weddly.test");

    const invite = await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_user_id: userId },
      { token: coupleToken },
    );
    expect(invite.status).toBe(200);

    // Directory now reflects the couple-side pending state as "invited".
    const after = await directory(coupleToken);
    expect(after.data.planners.find((p) => p.planner_user_id === userId)?.link_status).toBe(
      "invited",
    );

    // The link is couple-initiated, so the PLANNER accepts it.
    const row = db
      .prepare(
        "SELECT initiated_by FROM planner_clients WHERE planner_user_id = ? AND couple_id = ?",
      )
      .get(userId, coupleId) as { initiated_by: string };
    expect(row.initiated_by).toBe("couple");

    const accept = await req(
      "POST",
      `/api/planner/invites/${coupleId}/accept`,
      {},
      { token: plannerToken },
    );
    expect(accept.status).toBe(200);

    const linked = await directory(coupleToken);
    expect(linked.data.planners.find((p) => p.planner_user_id === userId)?.link_status).toBe(
      "active",
    );
  });

  test("a planner-initiated pending request shows as 'requested' in the directory", async () => {
    const { token: plannerToken, userId } = await makePlanner("req@weddly.test");
    const { token: coupleToken } = await bootstrapCouple("req-couple@weddly.test");
    // Planner requests access to the couple.
    await req(
      "POST",
      "/api/planner/clients",
      { email: "req-couple@weddly.test" },
      { token: plannerToken },
    );
    const r = await directory(coupleToken);
    expect(r.data.planners.find((p) => p.planner_user_id === userId)?.link_status).toBe(
      "requested",
    );
  });

  test("connect by id rejects a non-planner target", async () => {
    const { token: coupleToken } = await bootstrapCouple("bad-couple@weddly.test");
    await bootstrapCouple("other-couple@weddly.test");
    const otherCoupleUser = (
      db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get("other-couple@weddly.test") as {
        id: number;
      }
    ).id;
    const r = await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_user_id: otherCoupleUser },
      { token: coupleToken },
    );
    expect(r.status).toBe(404);
  });
});

describe("planner funnel emails", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("waitlist submit sends a confirmation mail", async () => {
    const submit = await req("POST", "/api/planners/waitlist", {
      full_name: "Kata Szervező",
      email: "kata@planner.test",
      phone: "+36301234567",
      privacy_version: PRIVACY_VERSION,
    });
    expect(submit.status).toBe(201);

    const log = db
      .prepare("SELECT kind FROM email_log WHERE to_email = ? ORDER BY id DESC LIMIT 1")
      .get("kata@planner.test") as { kind: string } | undefined;
    expect(log?.kind).toBe("planner_waitlist_received");
  });

  test("planner accepting a couple's invite notifies the couple", async () => {
    const { token: plannerToken, userId } = await makePlanner("outcome@weddly.test");
    const { token: coupleToken, coupleId } = await bootstrapCouple("outcome-couple@weddly.test");

    await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_user_id: userId },
      { token: coupleToken },
    );
    const accept = await req(
      "POST",
      `/api/planner/invites/${coupleId}/accept`,
      {},
      { token: plannerToken },
    );
    expect(accept.status).toBe(200);

    const log = db
      .prepare(
        "SELECT kind FROM email_log WHERE to_email = ? AND kind = 'planner_invite_outcome' ORDER BY id DESC LIMIT 1",
      )
      .get("outcome-couple@weddly.test") as { kind: string } | undefined;
    expect(log?.kind).toBe("planner_invite_outcome");
  });
});

describe("planner directory detail", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("returns the enriched profile: availability, portfolio, reference links, link_status", async () => {
    const { userId } = await makePlanner("detail@weddly.test", {
      overrides: {
        planner_availability: "2027 Q3",
        planner_phone: "+36 30 111 2222",
        planner_address: "Budapest, Fő utca 1.",
      },
    });
    // A portfolio image (references) + external reference links from the waitlist.
    db.prepare(
      "INSERT INTO planner_portfolio (planner_user_id, title, description, image_url, sort_order, created_at) VALUES (?, 'Villa wedding', '', '/uploads/planners/x/portfolio/1.jpg', 0, ?)",
    ).run(userId, Date.now());
    db.prepare(
      "INSERT INTO planner_waitlist (full_name, email, phone, reference_links, status, created_at) VALUES ('Eszter', 'detail@weddly.test', '+3630', 'instagram.com/nagy, nagy-weddings.hu', 'accepted', ?)",
    ).run(Math.floor(Date.now() / 1000));

    const { token: coupleToken } = await bootstrapCouple("detail-couple@weddly.test");
    const r = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${userId}`,
      undefined,
      { token: coupleToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.business_name).toBe("Nagy Weddings");
    expect(r.data.city).toBe("Budapest");
    expect(r.data.availability).toBe("2027 Q3");
    expect(r.data.link_status).toBe("none");
    expect(r.data.portfolio.length).toBe(1);
    expect(r.data.portfolio[0]?.title).toBe("Villa wedding");
    expect(r.data.reference_links).toEqual(["instagram.com/nagy", "nagy-weddings.hu"]);
    // Contact details ARE surfaced on the auth-gated single-planner detail page
    // (unlike the scrapeable directory list): phone, email, address, plus the
    // empty offerings the planner hasn't filled in yet.
    expect(r.data.phone).toBe("+36 30 111 2222");
    expect(r.data.email).toBe("detail@weddly.test");
    expect(r.data.address).toBe("Budapest, Fő utca 1.");
    expect(r.data.packages).toEqual([]);
    expect(r.data.unavailable_dates).toEqual([]);
  });

  test("reflects an active link and 404s a non-planner id", async () => {
    const { token: plannerToken, userId } = await makePlanner("detail2@weddly.test");
    const { token: coupleToken, coupleId } = await bootstrapCouple("detail2-couple@weddly.test");
    await req(
      "POST",
      "/api/couples/planner-invite",
      { planner_user_id: userId },
      { token: coupleToken },
    );
    await req("POST", `/api/planner/invites/${coupleId}/accept`, {}, { token: plannerToken });

    const r = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${userId}`,
      undefined,
      { token: coupleToken },
    );
    expect(r.status).toBe(200);
    expect(r.data.link_status).toBe("active");

    // A plain couple user id is not a planner -> 404.
    const otherCouple = (
      db
        .prepare("SELECT id FROM users WHERE LOWER(email) = ?")
        .get("detail2-couple@weddly.test") as {
        id: number;
      }
    ).id;
    const bad = await req("GET", `/api/couples/planner-directory/${otherCouple}`, undefined, {
      token: coupleToken,
    });
    expect(bad.status).toBe(404);
  });
});
