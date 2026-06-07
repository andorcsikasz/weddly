import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, verifyUserEmail, bootstrapCouple } from "../helpers";
import { db } from "../../src/db";

// Couple shortlist ("saved" star on /app/suppliers), moved off per-device
// localStorage to a couple-scoped server table so both partners share one
// list. Mirrors the couple_picks suite but without the per-category cap — a
// couple shortlists several suppliers in one category to compare them.

interface SavedRow {
  supplier_id: string;
  saved_by_user_id: number | null;
  saved_at: number;
}

/** Register + verify partner B and accept the pending invite into A's couple.
 *  Returns B's bearer token. */
async function registerAndAcceptInvite(email: string, inviteToken: string): Promise<string> {
  const reg = await req<{ token: string }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Partner",
  });
  expect(reg.status).toBe(201);
  await verifyUserEmail(email);
  const accept = await req(
    "POST",
    `/api/invites/${inviteToken}/accept`,
    {},
    { token: reg.data.token },
  );
  expect(accept.status).toBe(200);
  return reg.data.token;
}

describe("saved_suppliers (shared couple shortlist)", () => {
  test("CRUD happy path: add several in one category, list, remove, audit", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("saved-crud@weddly.test");

    // Empty workspace.
    const empty = await req<{ saved: SavedRow[] }>("GET", "/api/saved-suppliers", undefined, {
      token,
    });
    expect(empty.status).toBe(200);
    expect(empty.data.saved).toEqual([]);

    // Shortlist three photographers — no per-category cap, all coexist.
    for (const id of ["foto-egy", "foto-ketto", "c42"]) {
      const put = await req("PUT", `/api/saved-suppliers/${id}`, undefined, { token });
      expect(put.status).toBe(200);
    }

    const list = await req<{ saved: SavedRow[] }>("GET", "/api/saved-suppliers", undefined, {
      token,
    });
    expect(list.data.saved.length).toBe(3);
    const ids = new Set(list.data.saved.map((s) => s.supplier_id));
    expect(ids).toEqual(new Set(["foto-egy", "foto-ketto", "c42"]));
    expect(list.data.saved.every((s) => (s.saved_by_user_id ?? 0) > 0)).toBe(true);

    // Three saved.add audit rows.
    const addAudit = db
      .prepare("SELECT after_json FROM audit_log WHERE action = 'saved.add' AND couple_id = ?")
      .all(coupleId) as { after_json: string | null }[];
    expect(addAudit.length).toBe(3);

    // Remove one + audit.
    const del = await req("DELETE", "/api/saved-suppliers/foto-egy", undefined, { token });
    expect(del.status).toBe(200);
    const after = await req<{ saved: SavedRow[] }>("GET", "/api/saved-suppliers", undefined, {
      token,
    });
    expect(after.data.saved.length).toBe(2);
    expect(after.data.saved.some((s) => s.supplier_id === "foto-egy")).toBe(false);

    const removeAudit = db
      .prepare("SELECT before_json FROM audit_log WHERE action = 'saved.remove' AND couple_id = ?")
      .all(coupleId) as { before_json: string | null }[];
    expect(removeAudit.length).toBe(1);
    expect(JSON.parse(removeAudit[0]!.before_json!)).toMatchObject({ supplier_id: "foto-egy" });
  });

  test("add is idempotent: re-saving the same supplier is a no-op, one row, one audit", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("saved-idem@weddly.test");

    await req("PUT", "/api/saved-suppliers/dupe-slug", undefined, { token });
    await req("PUT", "/api/saved-suppliers/dupe-slug", undefined, { token });
    await req("PUT", "/api/saved-suppliers/dupe-slug", undefined, { token });

    const rows = db
      .prepare("SELECT supplier_id FROM saved_suppliers WHERE couple_id = ?")
      .all(coupleId) as { supplier_id: string }[];
    expect(rows.length).toBe(1);

    // Only the first add audited — the later no-ops don't spam the feed.
    const addAudit = db
      .prepare("SELECT id FROM audit_log WHERE action = 'saved.add' AND couple_id = ?")
      .all(coupleId);
    expect(addAudit.length).toBe(1);
  });

  test("removing a supplier that isn't saved is a silent 200 with no audit", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("saved-del-noop@weddly.test");

    const del = await req("DELETE", "/api/saved-suppliers/never-saved", undefined, { token });
    expect(del.status).toBe(200);
    const removeAudit = db
      .prepare("SELECT id FROM audit_log WHERE action = 'saved.remove' AND couple_id = ?")
      .all(coupleId);
    expect(removeAudit.length).toBe(0);
  });

  test("cross-couple isolation: A's shortlist invisible to a different couple B", async () => {
    wipeAll();
    const a = await bootstrapCouple("saved-iso-a@weddly.test");
    await req("PUT", "/api/saved-suppliers/a-only", undefined, { token: a.token });

    const reg = await req<{ token: string }>("POST", "/api/auth/register", {
      email: "saved-iso-b@weddly.test",
      password: "supersafe123",
      full_name: "B",
    });
    await verifyUserEmail("saved-iso-b@weddly.test");
    await req(
      "POST",
      "/api/couples/onboard",
      {
        display_name: "Beth & Carl",
        wedding_date: "2027-04-01",
        target_guest_count: 50,
        budget_ceiling_huf: 3_000_000,
        style_tags: [],
      },
      { token: reg.data.token },
    );

    const bList = await req<{ saved: SavedRow[] }>("GET", "/api/saved-suppliers", undefined, {
      token: reg.data.token,
    });
    expect(bList.data.saved).toEqual([]);
  });

  test("partners share one shortlist: B sees what A saved, and vice versa", async () => {
    wipeAll();
    const a = await bootstrapCouple("saved-share-a@weddly.test");

    // A invites partner B into the same couple.
    const inv = await req<{ invite: { token: string } }>(
      "POST",
      "/api/couples/invites",
      { invited_email: "saved-share-b@weddly.test" },
      { token: a.token },
    );
    expect(inv.status).toBe(201);
    const bToken = await registerAndAcceptInvite(
      "saved-share-b@weddly.test",
      inv.data.invite.token,
    );

    // A saves a supplier; B sees it.
    await req("PUT", "/api/saved-suppliers/shared-foto", undefined, { token: a.token });
    const bSees = await req<{ saved: SavedRow[] }>("GET", "/api/saved-suppliers", undefined, {
      token: bToken,
    });
    expect(bSees.data.saved.map((s) => s.supplier_id)).toContain("shared-foto");

    // B saves another; A sees both.
    await req("PUT", "/api/saved-suppliers/shared-dj", undefined, { token: bToken });
    const aSees = await req<{ saved: SavedRow[] }>("GET", "/api/saved-suppliers", undefined, {
      token: a.token,
    });
    expect(new Set(aSees.data.saved.map((s) => s.supplier_id))).toEqual(
      new Set(["shared-foto", "shared-dj"]),
    );
  });

  test("unauthenticated requests are rejected", async () => {
    wipeAll();
    const r = await req("GET", "/api/saved-suppliers");
    expect(r.status).toBe(401);
  });
});
