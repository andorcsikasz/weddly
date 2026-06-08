import "../setup";
import { describe, expect, test } from "bun:test";
import { req, wipeAll } from "../helpers";

/** Feedback triage workflow (see shared/feedback.ts):
 *    - expanded status lifecycle (new/reviewed/planned/fixed/rejected/archived)
 *    - admin triage fields (priority / product area / internal notes)
 *    - technical context captured at submission (device/browser/os from the
 *      User-Agent header, full URL from the body)
 *    - product area auto-inferred from the in-app route
 */
describe("feedback triage workflow", () => {
  async function newAdmin(): Promise<string> {
    const r = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "admin@test.test",
      password: "supersafe123",
      full_name: "Admin",
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
    const user = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "user@test.test",
      password: "supersafe123",
      full_name: "User",
    });
    const r = await req(
      "PATCH",
      "/api/admin/feedback/1",
      { priority: "low" },
      { token: user.data.token },
    );
    expect(r.status).toBe(403);
  });
});
