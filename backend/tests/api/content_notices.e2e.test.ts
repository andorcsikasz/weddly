import "../setup";

import { describe, expect, test } from "bun:test";
import { registerAndVerify, req, wipeAll } from "../helpers";

const REPORTER = "reporter@example.test";

async function submitNotice() {
  return req<{ reference: string; status: string }>("POST", "/api/legal/content-notices", {
    reporter_name: "Rights Holder",
    reporter_email: REPORTER,
    content_url: "http://localhost:5173/suppliers/illegal-content-test",
    illegality: "Copyright infringement under the applicable copyright statute",
    explanation:
      "The photograph displayed at this precise URL is my protected work and Weddly has no licence to reproduce it.",
    good_faith: true,
  });
}

describe("DSA content notices", () => {
  test("public submission produces a private case reference and reporter-scoped status", async () => {
    wipeAll();
    const created = await submitNotice();
    expect(created.status).toBe(201);
    expect(created.data.reference).toHaveLength(32);

    const status = await req<{ notice: { status: string; decision_reason: string | null } }>(
      "GET",
      `/api/legal/content-notices/${created.data.reference}?email=${encodeURIComponent(REPORTER)}`,
    );
    expect(status.status).toBe(200);
    expect(status.data.notice.status).toBe("submitted");
    expect(status.data.notice.decision_reason).toBeNull();

    const wrongEmail = await req(
      "GET",
      `/api/legal/content-notices/${created.data.reference}?email=attacker@example.test`,
    );
    expect(wrongEmail.status).toBe(404);
  });

  test("a reasoned admin decision can be appealed exactly once", async () => {
    wipeAll();
    const created = await submitNotice();
    const admin = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    const decided = await req<{ notice: { status: string; decision_reason: string } }>(
      "PATCH",
      `/api/admin/content-notices/${created.data.reference}`,
      {
        status: "rejected",
        decision_reason:
          "The supplied evidence does not establish ownership; please provide the original publication record.",
      },
      { token: admin.data.token },
    );
    expect(decided.status).toBe(200);
    expect(decided.data.notice.status).toBe("rejected");

    const appeal = await req<{ ok: true }>(
      "POST",
      `/api/legal/content-notices/${created.data.reference}/appeal`,
      {
        reporter_email: REPORTER,
        reason:
          "The original publication and raw file metadata are available at the evidence link supplied in this appeal.",
      },
    );
    expect(appeal.status).toBe(200);
    const duplicate = await req(
      "POST",
      `/api/legal/content-notices/${created.data.reference}/appeal`,
      {
        reporter_email: REPORTER,
        reason: "This second attempt must be refused because the appeal path is single-use.",
      },
    );
    expect(duplicate.status).toBe(409);

    const appealDecision = await req<{
      notice: { appeal_decision: string; appeal_decided_at: number | null };
    }>(
      "PATCH",
      `/api/admin/content-notices/${created.data.reference}`,
      {
        status: "rejected",
        decision_reason:
          "The supplied evidence does not establish ownership; please provide the original publication record.",
        appeal_decision:
          "The appeal was reviewed with the new evidence, but it still does not establish ownership of the reported work.",
      },
      { token: admin.data.token },
    );
    expect(appealDecision.status).toBe(200);
    expect(appealDecision.data.notice.appeal_decided_at).toBeNumber();
  });

  test("affected content owner receives a scoped statement-of-reasons appeal path", async () => {
    wipeAll();
    const created = await submitNotice();
    const admin = await registerAndVerify({
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Ádám Nagy",
    });
    const affectedEmail = "vendor-owner@example.test";
    const decided = await req<{ notice: { affected_notified_at: number | null } }>(
      "PATCH",
      `/api/admin/content-notices/${created.data.reference}`,
      {
        status: "actioned",
        decision_reason:
          "The reported photograph was removed because the available licence evidence did not cover publication on Weddly.",
        affected_email: affectedEmail,
      },
      { token: admin.data.token },
    );
    expect(decided.status).toBe(200);
    expect(decided.data.notice.affected_notified_at).toBeNumber();

    const affected = await req<{ notice: { status: string; decision_reason: string } }>(
      "GET",
      `/api/legal/content-notices/${created.data.reference}/affected?email=${encodeURIComponent(affectedEmail)}`,
    );
    expect(affected.status).toBe(200);
    expect(affected.data.notice.status).toBe("actioned");
    const reporterCannotUseAffectedPath = await req(
      "GET",
      `/api/legal/content-notices/${created.data.reference}/affected?email=${encodeURIComponent(REPORTER)}`,
    );
    expect(reporterCannotUseAffectedPath.status).toBe(404);

    const appeal = await req(
      "POST",
      `/api/legal/content-notices/${created.data.reference}/affected-appeal`,
      {
        email: affectedEmail,
        reason:
          "The image licence expressly includes directory publication and the signed grant is attached to this complaint.",
      },
    );
    expect(appeal.status).toBe(200);
    const duplicate = await req(
      "POST",
      `/api/legal/content-notices/${created.data.reference}/affected-appeal`,
      {
        email: affectedEmail,
        reason: "This duplicate affected-user appeal must be rejected as already submitted.",
      },
    );
    expect(duplicate.status).toBe(409);

    const appealDecision = await req<{
      notice: { affected_appeal_decision: string; affected_appeal_decided_at: number | null };
    }>(
      "PATCH",
      `/api/admin/content-notices/${created.data.reference}`,
      {
        status: "actioned",
        decision_reason:
          "The reported photograph was removed because the available licence evidence did not cover publication on Weddly.",
        affected_email: affectedEmail,
        affected_appeal_decision:
          "The licence evidence was reviewed, but it does not grant Weddly the right to publish this directory image.",
      },
      { token: admin.data.token },
    );
    expect(appealDecision.status).toBe(200);
    expect(appealDecision.data.notice.affected_appeal_decided_at).toBeNumber();
  });

  test("rejects notices without the good-faith declaration or a Weddly locator", async () => {
    wipeAll();
    const offPlatform = await req("POST", "/api/legal/content-notices", {
      reporter_name: "Rights Holder",
      reporter_email: REPORTER,
      content_url: "https://example.com/not-weddly",
      illegality: "Copyright infringement in a protected photograph",
      explanation: "This URL is not content hosted on Weddly and must therefore be rejected here.",
      good_faith: true,
    });
    expect(offPlatform.status).toBe(400);
    const noDeclaration = await req("POST", "/api/legal/content-notices", {
      reporter_name: "Rights Holder",
      reporter_email: REPORTER,
      content_url: "http://localhost:5173/suppliers/example",
      illegality: "Copyright infringement in a protected photograph",
      explanation: "This notice deliberately omits the mandatory declaration for the test case.",
      good_faith: false,
    });
    expect(noDeclaration.status).toBe(400);
  });
});
