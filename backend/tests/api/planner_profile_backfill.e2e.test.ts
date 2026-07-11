// Boot backfill: heal already-planner accounts whose public profile stayed
// blank (they became planners before profile-seeding existed) from their
// accepted /planners application, so the directory card shows the info they
// already gave (company, city, styles, website).

import "../setup";

import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { backfillPlannerProfilesFromWaitlist } from "../../src/domain/planner_conversion";
import { latestCredentialToken, req, wipeAll } from "../helpers";

async function makeBarePlanner(email: string): Promise<number> {
  const reg = await req<{ user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Rita Kruczli",
  });
  const t = latestCredentialToken("email_verification_tokens", email);
  await req("POST", `/api/auth/verify/${t}`, {});
  // Planner with an EMPTY public profile (no business name / city / styles).
  db.prepare(
    `UPDATE users SET user_type = 'planner', couple_id = NULL,
        business_name = NULL, planner_city = NULL, planner_styles = NULL
      WHERE LOWER(email) = ?`,
  ).run(email.toLowerCase());
  return reg.data.user.id;
}

function insertAcceptedWaitlist(email: string): void {
  db.prepare(
    `INSERT INTO planner_waitlist
       (full_name, email, phone, company_name, city, status, wedding_style_1, wedding_style_2,
        website, created_at)
     VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?, ?)`,
  ).run(
    "Rita Kruczli",
    email,
    "+36301234567",
    "Álomszép esküvők Ritával",
    "Budapest",
    "romantic",
    "vintage",
    "aszepszertartas.hu",
    Date.now(),
  );
}

describe("planner profile backfill from waitlist", () => {
  test("seeds an empty planner profile from the accepted application", async () => {
    wipeAll();
    const email = "rita@weddly.test";
    const userId = await makeBarePlanner(email);
    insertAcceptedWaitlist(email);

    const n = backfillPlannerProfilesFromWaitlist();
    expect(n).toBe(1);

    const row = db
      .prepare(
        "SELECT business_name, planner_city, planner_styles, planner_website FROM users WHERE id = ?",
      )
      .get(userId) as {
      business_name: string | null;
      planner_city: string | null;
      planner_styles: string | null;
      planner_website: string | null;
    };
    expect(row.business_name).toBe("Álomszép esküvők Ritával");
    expect(row.planner_city).toBe("Budapest");
    expect(row.planner_website).toBe("aszepszertartas.hu");
    expect(JSON.parse(row.planner_styles ?? "[]")).toEqual(["romantic", "vintage"]);

    // Idempotent: a second run finds nothing left to seed.
    expect(backfillPlannerProfilesFromWaitlist()).toBe(0);
  });

  test("leaves a planner without an accepted application untouched", async () => {
    wipeAll();
    const userId = await makeBarePlanner("noapp@weddly.test");
    expect(backfillPlannerProfilesFromWaitlist()).toBe(0);
    const row = db
      .prepare("SELECT business_name, planner_city FROM users WHERE id = ?")
      .get(userId) as { business_name: string | null; planner_city: string | null };
    expect(row.business_name).toBeNull();
    expect(row.planner_city).toBeNull();
  });

  test("never clobbers a value the planner already filled in", async () => {
    wipeAll();
    const email = "partial@weddly.test";
    const userId = await makeBarePlanner(email);
    // Planner already set their brand; only the city is missing.
    db.prepare("UPDATE users SET business_name = ? WHERE id = ?").run("My Own Brand", userId);
    insertAcceptedWaitlist(email);

    backfillPlannerProfilesFromWaitlist();
    const row = db
      .prepare("SELECT business_name, planner_city FROM users WHERE id = ?")
      .get(userId) as { business_name: string; planner_city: string };
    expect(row.business_name).toBe("My Own Brand"); // preserved
    expect(row.planner_city).toBe("Budapest"); // filled from waitlist
  });
});
