// Planner "offerings": price packages (árajánlat) + PDF price lists, and the
// whole-day availability calendar. Mirrors the vendor listing-packages and
// availability suites. Everything the planner publishes here surfaces on the
// couple-facing planner detail DTO (auth-gated single-planner page).

import "../setup";

import { beforeEach, describe, expect, test } from "bun:test";
import { MAX_LISTING_PACKAGES } from "@shared/listing_packages";
import type { PlannerAvailabilityView, PlannerDirectoryDetail, PlannerProfile } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, latestCredentialToken, req, wipeAll } from "../helpers";

const BASE = `http://localhost:${process.env.PORT ?? "8791"}`;

/** Register + verify + promote to a listable planner (business name + city). */
async function makePlanner(email: string): Promise<{ token: string; userId: number }> {
  const reg = await req<{ token: string; user: { id: number } }>("POST", "/api/auth/register", {
    email,
    password: "supersafe123",
    full_name: "Eszter Nagy",
  });
  expect(reg.status).toBe(201);
  const vt = latestCredentialToken("email_verification_tokens", email);
  await req("POST", `/api/auth/verify/${vt}`, {});
  db.prepare("UPDATE users SET user_type = 'planner', couple_id = NULL WHERE LOWER(email) = ?").run(
    email.toLowerCase(),
  );
  const userId = (
    db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase()) as {
      id: number;
    }
  ).id;
  db.prepare(
    "UPDATE users SET business_name = ?, planner_city = ? WHERE id = ?",
  ).run("Nagy Weddings", "Budapest", userId);
  return { token: reg.data.token, userId };
}

/** Tomorrow (UTC) as 'YYYY-MM-DD' — always a future, blockable date. */
function tomorrowIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("planner price packages", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("adds, updates and deletes packages, capped at the max", async () => {
    const { token } = await makePlanner("pkg@weddly.test");

    const add = await req<PlannerProfile>(
      "POST",
      "/api/planner/profile/packages",
      { name: "Teljes körű szervezés", price_text: "250 000 Ft-tól", description: "A-Z tervezés" },
      { token },
    );
    expect(add.status).toBe(201);
    expect(add.data.packages.length).toBe(1);
    const pkgId = add.data.packages[0]?.id as number;
    expect(add.data.packages[0]?.name).toBe("Teljes körű szervezés");
    expect(add.data.packages[0]?.price_text).toBe("250 000 Ft-tól");

    // Fill the cap, then reject the overflow.
    for (let i = 2; i <= MAX_LISTING_PACKAGES; i++) {
      const r = await req<PlannerProfile>(
        "POST",
        "/api/planner/profile/packages",
        { name: `Csomag ${i}` },
        { token },
      );
      expect(r.status).toBe(201);
    }
    const over = await req(
      "POST",
      "/api/planner/profile/packages",
      { name: "Egy csomaggal túl sok" },
      { token },
    );
    expect(over.status).toBe(409);

    // Update the first package's price.
    const upd = await req<PlannerProfile>(
      "PATCH",
      `/api/planner/profile/packages/${pkgId}`,
      { price_text: "Egyedi ár" },
      { token },
    );
    expect(upd.status).toBe(200);
    expect(upd.data.packages.find((p) => p.id === pkgId)?.price_text).toBe("Egyedi ár");

    // Delete it — back under the cap.
    const del = await req<PlannerProfile>(
      "DELETE",
      `/api/planner/profile/packages/${pkgId}`,
      undefined,
      { token },
    );
    expect(del.status).toBe(200);
    expect(del.data.packages.find((p) => p.id === pkgId)).toBeUndefined();
    expect(del.data.packages.length).toBe(MAX_LISTING_PACKAGES - 1);
  });

  test("rejects an empty name", async () => {
    const { token } = await makePlanner("pkgname@weddly.test");
    const r = await req("POST", "/api/planner/profile/packages", { name: "   " }, { token });
    expect(r.status).toBe(400);
  });

  test("attaches and clears a PDF price list", async () => {
    const { token, userId } = await makePlanner("pkgpdf@weddly.test");
    const add = await req<PlannerProfile>(
      "POST",
      "/api/planner/profile/packages",
      { name: "Napi koordináció" },
      { token },
    );
    const pkgId = add.data.packages[0]?.id as number;

    // Valid %PDF upload.
    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])], {
      type: "application/pdf",
    });
    const form = new FormData();
    form.append("file", pdf, "arlista.pdf");
    const up = await fetch(`${BASE}/api/planner/profile/packages/${pkgId}/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    expect(up.status).toBe(200);
    const upBody = (await up.json()) as PlannerProfile;
    const withPdf = upBody.packages.find((p) => p.id === pkgId);
    expect(withPdf?.pdf_name).toBe("arlista.pdf");
    expect(withPdf?.pdf_url).toContain(`planners/${userId}/packages/${pkgId}.pdf`);

    // A non-PDF payload is rejected on magic bytes.
    const notPdf = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], {
      type: "application/pdf",
    });
    const badForm = new FormData();
    badForm.append("file", notPdf, "fake.pdf");
    const bad = await fetch(`${BASE}/api/planner/profile/packages/${pkgId}/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: badForm,
    });
    expect(bad.status).toBe(415);

    // Clear it.
    const clear = await req<PlannerProfile>(
      "DELETE",
      `/api/planner/profile/packages/${pkgId}/pdf`,
      undefined,
      { token },
    );
    expect(clear.status).toBe(200);
    expect(clear.data.packages.find((p) => p.id === pkgId)?.pdf_url).toBeNull();
  });
});

describe("planner availability", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("blocks and unblocks whole days, recomputing next-free", async () => {
    const { token } = await makePlanner("avail@weddly.test");
    const day = tomorrowIso();

    const empty = await req<PlannerAvailabilityView>(
      "GET",
      "/api/planner/profile/availability",
      undefined,
      { token },
    );
    expect(empty.status).toBe(200);
    expect(empty.data.blocked_dates).toEqual([]);

    const block = await req<PlannerAvailabilityView>(
      "POST",
      "/api/planner/profile/availability",
      { date: day, reason: "Másik esküvő" },
      { token },
    );
    expect(block.status).toBe(201);
    expect(block.data.blocked_dates).toContain(day);
    // Next-free skips the blocked day.
    expect(block.data.next_available).not.toBe(day);

    // Re-block is idempotent (no duplicate-key error).
    const again = await req<PlannerAvailabilityView>(
      "POST",
      "/api/planner/profile/availability",
      { date: day },
      { token },
    );
    expect(again.status).toBe(201);
    expect(again.data.blocked_dates.filter((d) => d === day).length).toBe(1);

    const unblock = await req<PlannerAvailabilityView>(
      "DELETE",
      `/api/planner/profile/availability?date=${day}`,
      undefined,
      { token },
    );
    expect(unblock.status).toBe(200);
    expect(unblock.data.blocked_dates).not.toContain(day);
  });

  test("rejects a past date", async () => {
    const { token } = await makePlanner("availpast@weddly.test");
    const r = await req(
      "POST",
      "/api/planner/profile/availability",
      { date: "2000-01-01" },
      { token },
    );
    expect(r.status).toBe(400);
  });
});

describe("offerings surface on the couple detail DTO", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("packages + blocked dates + wedding date reach the couple", async () => {
    const { token, userId } = await makePlanner("surface@weddly.test");
    await req(
      "POST",
      "/api/planner/profile/packages",
      { name: "Teljes körű szervezés", price_text: "250 000 Ft-tól" },
      { token },
    );
    const day = tomorrowIso();
    await req("POST", "/api/planner/profile/availability", { date: day }, { token });

    const { token: coupleToken, coupleId } = await bootstrapCouple("surface-couple@weddly.test");
    db.prepare("UPDATE couples SET wedding_date = '2027-06-12' WHERE id = ?").run(coupleId);

    const detail = await req<PlannerDirectoryDetail>(
      "GET",
      `/api/couples/planner-directory/${userId}`,
      undefined,
      { token: coupleToken },
    );
    expect(detail.status).toBe(200);
    expect(detail.data.packages.length).toBe(1);
    expect(detail.data.packages[0]?.name).toBe("Teljes körű szervezés");
    expect(detail.data.unavailable_dates).toContain(day);
    expect(detail.data.wedding_date).toBe("2027-06-12");
  });
});
