import "../setup";

import { PRIVACY_VERSION } from "@shared/legal";
import type { PlannerWaitlistAdminView } from "@shared/planner_waitlist";
import { describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { req, verifyUserEmail, wipeAll } from "../helpers";

async function bootstrapAdmin(): Promise<string> {
  wipeAll();
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Admin",
  });
  await verifyUserEmail("admin@test.test");
  return reg.data.token;
}

/** Submit a planner waitlist entry anonymously and return its id. */
async function submitWaitlist(email: string): Promise<number> {
  const res = await req<{ entry: { id: number; status: string } }>(
    "POST",
    "/api/planners/waitlist",
    {
      full_name: "Anna Szervező",
      email,
      phone: "+36301234567",
      company_name: "Anna Events",
      privacy_version: PRIVACY_VERSION,
    },
  );
  expect(res.status).toBe(201);
  return res.data.entry.id;
}

describe("planner waitlist decision email", () => {
  test("decide sends the branded decision email and stores the sent copy", async () => {
    const adminToken = await bootstrapAdmin();
    const id = await submitWaitlist("planner-decide@weddly.test");

    const subject = "Wēddly: jóváhagytuk a szervezői hozzáférésed";
    const body =
      "Szia Anna!\n\nAktiváltuk a szervezői hozzáférésed. Lépj be és indítsd el az onboardingot.";

    const res = await req<{ entry: PlannerWaitlistAdminView | null }>(
      "POST",
      `/api/admin/planner-waitlist/${id}/decide`,
      { outcome: "accepted", subject, body, notes: "egyeztettünk telefonon" },
      { token: adminToken },
    );

    expect(res.status).toBe(200);
    expect(res.data.entry?.status).toBe("accepted");
    expect(res.data.entry?.sent_subject).toBe(subject);
    expect(res.data.entry?.sent_body).toBe(body);
    expect(res.data.entry?.notes).toBe("egyeztettünk telefonon");

    const mail = db
      .prepare(
        "SELECT kind, to_email, subject FROM email_log WHERE kind = 'planner_waitlist_decision' ORDER BY id DESC LIMIT 1",
      )
      .get() as { kind: string; to_email: string; subject: string } | undefined;
    expect(mail?.to_email).toBe("planner-decide@weddly.test");
    expect(mail?.subject).toBe(subject);
  });

  test("decide rejects an empty subject or body", async () => {
    const adminToken = await bootstrapAdmin();
    const id = await submitWaitlist("planner-empty@weddly.test");

    const noSubject = await req(
      "POST",
      `/api/admin/planner-waitlist/${id}/decide`,
      { outcome: "rejected", subject: "", body: "van szöveg", notes: "" },
      { token: adminToken },
    );
    expect(noSubject.status).toBe(400);

    const noBody = await req(
      "POST",
      `/api/admin/planner-waitlist/${id}/decide`,
      { outcome: "rejected", subject: "van tárgy", body: "", notes: "" },
      { token: adminToken },
    );
    expect(noBody.status).toBe(400);
  });

  test("reopen resets the status but keeps the last sent copy", async () => {
    const adminToken = await bootstrapAdmin();
    const id = await submitWaitlist("planner-reopen@weddly.test");

    await req(
      "POST",
      `/api/admin/planner-waitlist/${id}/decide`,
      { outcome: "rejected", subject: "Tárgy", body: "Üzenet a szervezőnek", notes: "" },
      { token: adminToken },
    );

    const res = await req<{ entry: PlannerWaitlistAdminView | null }>(
      "POST",
      `/api/admin/planner-waitlist/${id}/reopen`,
      undefined,
      { token: adminToken },
    );
    expect(res.status).toBe(200);
    expect(res.data.entry?.status).toBe("new");
    // Reopen clears the decision but preserves the last email so a re-decide
    // starts from what already went out.
    expect(res.data.entry?.sent_subject).toBe("Tárgy");
  });

  test("decide requires an admin session", async () => {
    await bootstrapAdmin();
    const id = await submitWaitlist("planner-noauth@weddly.test");
    const res = await req("POST", `/api/admin/planner-waitlist/${id}/decide`, {
      outcome: "accepted",
      subject: "x",
      body: "y",
      notes: "",
    });
    expect(res.status).toBe(401);
  });
});
