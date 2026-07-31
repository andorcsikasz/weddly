// Vendor to-do board (/api/vendor/tasks). Verifies:
//   - POST creates a task (default lane 'todo'), validates title / due_date /
//     board_status, and the list endpoint returns deadline-first ordering
//   - PATCH moves a card between lanes (with a vendor.task_board_move audit
//     entry) and edits title / due date
//   - DELETE removes the card
//   - ownership: another vendor's task reads as 404 (no cross-account probing)
//   - 401 for anon, 403 for couple-role users
//
// Pairs with backend/src/routes/vendor_tasks.ts. Bootstraps a real vendor the
// same way vendor_account.e2e.test.ts does: community submit → verify →
// admin approve → claim flow.

import "../setup";

import { describe, expect, test } from "bun:test";
import { bootstrapCouple, registerAndVerify, req, wipeAll } from "../helpers";
import { db } from "../../src/db";
import { createVerificationToken } from "../../src/domain/community_suppliers";
import type { VendorTask } from "@shared/vendor_tasks";

interface ClaimRow {
  token: string;
}

async function registerAdminAndGetToken(): Promise<string> {
  const reg = await registerAndVerify({
    email: "admin@test.test",
    password: "supersafe123",
    full_name: "Ádám Nagy",
  });
  if (reg.status === 201) {
    return reg.data.token;
  }
  const login = await req<{ token: string }>("POST", "/api/auth/login", {
    email: "admin@test.test",
    password: "supersafe123",
  });
  return login.data.token;
}

/** Community submit → email verify → admin approve, so the listing is
 *  claimable. Same bootstrap as vendor_account.e2e.test.ts. */
async function makeApprovedListing(
  ownerEmail: string,
  contactEmail: string,
  name: string,
): Promise<{ listingId: string; coupleToken: string }> {
  const { token } = await bootstrapCouple(ownerEmail);
  const submit = await req<{ supplier: { id: string } }>(
    "POST",
    "/api/suppliers/community",
    {
      category: "photography",
      submitter_type: "self",
      name,
      city: "Budapest",
      address: null,
      website: `https://${name.toLowerCase().replace(/\s+/g, "-")}.example`,
      contact_email: contactEmail,
      contact_phone: null,
      blurb: `${name} blurb`,
      price_band: 3,
    },
    { token },
  );
  expect(submit.status).toBe(201);
  const publicId = submit.data.supplier.id;
  const numericId = Number(publicId.slice(1));

  createVerificationToken(numericId);
  const vtok = db
    .prepare(
      "SELECT token FROM community_supplier_verifications WHERE supplier_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(numericId) as { token: string } | undefined;
  expect(vtok).toBeTruthy();
  await req("POST", `/api/suppliers/community/verify/${vtok?.token}`, {});

  const adminToken = await registerAdminAndGetToken();
  const approve = await req(
    "POST",
    `/api/admin/suppliers/${numericId}/approve`,
    {},
    { token: adminToken },
  );
  expect(approve.status).toBe(200);
  return { listingId: publicId, coupleToken: token };
}

async function claimListing(
  listingId: string,
  contactEmail: string,
  fullName: string,
): Promise<{ vendorToken: string }> {
  const start = await req("POST", "/api/vendor/claim/start", {
    listing_id: listingId,
    claimant_email: "claimer@gmail.test",
  });
  expect(start.status).toBe(200);
  const claim = db
    .prepare(
      "SELECT token FROM listing_claims WHERE listing_id = ? AND email_sent_to = ? ORDER BY id DESC LIMIT 1",
    )
    .get(listingId, contactEmail) as ClaimRow | undefined;
  expect(claim).toBeTruthy();
  const verify = await req("POST", `/api/vendor/claim/verify/${claim?.token}`, {});
  expect(verify.status).toBe(200);
  const complete = await req<{ token: string }>("POST", "/api/vendor/claim/complete", {
    token: claim?.token,
    password: "vendorpass123",
    full_name: fullName,
  });
  expect(complete.status).toBe(201);
  return { vendorToken: complete.data.token };
}

async function bootstrapVendor(slug: string): Promise<{ vendorToken: string }> {
  const { listingId } = await makeApprovedListing(
    `owner-${slug}@weddly.test`,
    `vendor-${slug}@weddly.test`,
    `Tasks Studio ${slug}`,
  );
  return claimListing(listingId, `vendor-${slug}@weddly.test`, `Vendor ${slug}`);
}

describe("vendor tasks board", () => {
  // The claim-flow bootstrap costs a few seconds per vendor (argon2 + email
  // fan-out), so every vendor-bootstrapping test carries an explicit timeout;
  // the default 5s is fine solo but flakes when other suites share the run.
  const BOOTSTRAP_TIMEOUT = 30_000;

  test(
    "create → list → move lane → edit → delete lifecycle",
    async () => {
      wipeAll();
      const { vendorToken } = await bootstrapVendor("lifecycle");

      // Create: default lane is 'todo'.
      const created = await req<{ task: VendorTask }>(
        "POST",
        "/api/vendor/tasks",
        { title: "Send the quote", due_date: "2027-05-10" },
        { token: vendorToken },
      );
      expect(created.status).toBe(201);
      expect(created.data.task.title).toBe("Send the quote");
      expect(created.data.task.board_status).toBe("todo");
      expect(created.data.task.due_date).toBe("2027-05-10");
      const taskId = created.data.task.id;

      // A second, undated task sorts AFTER the deadlined one.
      const second = await req<{ task: VendorTask }>(
        "POST",
        "/api/vendor/tasks",
        { title: "Order new lenses" },
        { token: vendorToken },
      );
      expect(second.status).toBe(201);
      expect(second.data.task.due_date).toBeNull();

      const list = await req<{ tasks: VendorTask[] }>("GET", "/api/vendor/tasks", undefined, {
        token: vendorToken,
      });
      expect(list.status).toBe(200);
      expect(list.data.tasks.map((tk) => tk.title)).toEqual(["Send the quote", "Order new lenses"]);

      // Drag to 'doing' → audit entry.
      const moved = await req<{ task: VendorTask }>(
        "PATCH",
        `/api/vendor/tasks/${taskId}`,
        { board_status: "doing" },
        { token: vendorToken },
      );
      expect(moved.status).toBe(200);
      expect(moved.data.task.board_status).toBe("doing");
      const audit = db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'vendor.task_board_move' AND target_id = ?",
        )
        .get(taskId) as { n: number };
      expect(audit.n).toBe(1);

      // Edit title + clear the due date in one PATCH.
      const edited = await req<{ task: VendorTask }>(
        "PATCH",
        `/api/vendor/tasks/${taskId}`,
        { title: "Send the final quote", due_date: null },
        { token: vendorToken },
      );
      expect(edited.status).toBe(200);
      expect(edited.data.task.title).toBe("Send the final quote");
      expect(edited.data.task.due_date).toBeNull();
      expect(edited.data.task.board_status).toBe("doing");

      // Delete → gone from the list.
      const del = await req<{ ok: true }>("DELETE", `/api/vendor/tasks/${taskId}`, undefined, {
        token: vendorToken,
      });
      expect(del.status).toBe(200);
      const after = await req<{ tasks: VendorTask[] }>("GET", "/api/vendor/tasks", undefined, {
        token: vendorToken,
      });
      expect(after.data.tasks.map((tk) => tk.id)).toEqual([second.data.task.id]);
    },
    BOOTSTRAP_TIMEOUT,
  );

  test(
    "validates title, due_date and board_status",
    async () => {
      wipeAll();
      const { vendorToken } = await bootstrapVendor("validate");

      const empty = await req(
        "POST",
        "/api/vendor/tasks",
        { title: "   " },
        { token: vendorToken },
      );
      expect(empty.status).toBe(400);

      const longTitle = await req(
        "POST",
        "/api/vendor/tasks",
        { title: "x".repeat(201) },
        { token: vendorToken },
      );
      expect(longTitle.status).toBe(400);

      const badDate = await req(
        "POST",
        "/api/vendor/tasks",
        { title: "ok", due_date: "next tuesday" },
        { token: vendorToken },
      );
      expect(badDate.status).toBe(400);

      const badLane = await req(
        "POST",
        "/api/vendor/tasks",
        { title: "ok", board_status: "archived" },
        { token: vendorToken },
      );
      expect(badLane.status).toBe(400);

      const ok = await req<{ task: VendorTask }>(
        "POST",
        "/api/vendor/tasks",
        { title: "ok", board_status: "doing" },
        { token: vendorToken },
      );
      expect(ok.status).toBe(201);
      expect(ok.data.task.board_status).toBe("doing");

      const badPatch = await req(
        "PATCH",
        `/api/vendor/tasks/${ok.data.task.id}`,
        { board_status: "later" },
        { token: vendorToken },
      );
      expect(badPatch.status).toBe(400);
    },
    BOOTSTRAP_TIMEOUT,
  );

  test(
    "a foreign vendor's task reads as 404",
    async () => {
      wipeAll();
      const { vendorToken: tokenA } = await bootstrapVendor("owner-a");
      const { vendorToken: tokenB } = await bootstrapVendor("owner-b");

      const created = await req<{ task: VendorTask }>(
        "POST",
        "/api/vendor/tasks",
        { title: "Private plan" },
        { token: tokenA },
      );
      expect(created.status).toBe(201);
      const taskId = created.data.task.id;

      const patch = await req(
        "PATCH",
        `/api/vendor/tasks/${taskId}`,
        { board_status: "done" },
        { token: tokenB },
      );
      expect(patch.status).toBe(404);
      const del = await req("DELETE", `/api/vendor/tasks/${taskId}`, undefined, { token: tokenB });
      expect(del.status).toBe(404);

      // B's list stays empty; A's task is untouched.
      const listB = await req<{ tasks: VendorTask[] }>("GET", "/api/vendor/tasks", undefined, {
        token: tokenB,
      });
      expect(listB.data.tasks).toEqual([]);
      const listA = await req<{ tasks: VendorTask[] }>("GET", "/api/vendor/tasks", undefined, {
        token: tokenA,
      });
      expect(listA.data.tasks[0]?.board_status).toBe("todo");
    },
    BOOTSTRAP_TIMEOUT,
  );

  test("401 for anon, 403 for couple-role users", async () => {
    wipeAll();

    const anon = await req("GET", "/api/vendor/tasks");
    expect(anon.status).toBe(401);

    const { token: coupleToken } = await bootstrapCouple("couple-tasks@weddly.test");
    const asCouple = await req(
      "POST",
      "/api/vendor/tasks",
      { title: "nope" },
      { token: coupleToken },
    );
    expect(asCouple.status).toBe(403);
  });
});
