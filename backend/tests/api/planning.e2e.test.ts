import "../setup";

import type { PlanningItem } from "@shared/types";
import { beforeEach, describe, expect, test } from "bun:test";
import { bootstrapCouple, req, wipeAll } from "../helpers";

type CreateResp = { item: PlanningItem };

describe("planning ideas: idea_status + idea_tag", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("create stamps idea_tag and defaults idea_status to null", async () => {
    const { token } = await bootstrapCouple();
    const created = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "idea", title: "Tűzijáték a tó felett", idea_tag: "surprise" },
      { token },
    );
    expect(created.status).toBe(201);
    expect(created.data.item.idea_tag).toBe("surprise");
    expect(created.data.item.idea_status).toBeNull();
  });

  test("update sets idea_status and changes idea_tag; reading reflects it", async () => {
    const { token } = await bootstrapCouple();
    const created = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "idea", title: "Polaroid sarok" },
      { token },
    );
    const id = created.data.item.id;

    const patched = await req<CreateResp>(
      "PATCH",
      `/api/planning/${id}`,
      { idea_status: "doing", idea_tag: "experience" },
      { token },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.item.idea_status).toBe("doing");
    expect(patched.data.item.idea_tag).toBe("experience");

    // Round-trips through the list read.
    const list = await req<{ items: PlanningItem[] }>("GET", "/api/planning", undefined, { token });
    const row = list.data.items.find((i) => i.id === id);
    expect(row?.idea_status).toBe("doing");
    expect(row?.idea_tag).toBe("experience");

    // Clearing back to null is allowed.
    const cleared = await req<CreateResp>(
      "PATCH",
      `/api/planning/${id}`,
      { idea_status: null, idea_tag: null },
      { token },
    );
    expect(cleared.data.item.idea_status).toBeNull();
    expect(cleared.data.item.idea_tag).toBeNull();
  });

  test("rejects an unknown idea_status enum value", async () => {
    const { token } = await bootstrapCouple();
    const created = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "idea", title: "Random ötlet" },
      { token },
    );
    const bad = await req(
      "PATCH",
      `/api/planning/${created.data.item.id}`,
      { idea_status: "nope" },
      { token },
    );
    expect(bad.status).toBe(400);
  });

  test("rejects an unknown idea_tag enum value on both create and update", async () => {
    const { token } = await bootstrapCouple();
    const badCreate = await req(
      "POST",
      "/api/planning",
      { kind: "idea", title: "Bad tag", idea_tag: "wat" },
      { token },
    );
    expect(badCreate.status).toBe(400);

    const ok = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "idea", title: "OK idea" },
      { token },
    );
    const badPatch = await req(
      "PATCH",
      `/api/planning/${ok.data.item.id}`,
      { idea_tag: "wat" },
      { token },
    );
    expect(badPatch.status).toBe(400);
  });

  test("bulk schedule sets dates + position on many tasks in one call", async () => {
    const { token } = await bootstrapCouple();
    const a = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Helyszín" },
      { token },
    );
    const b = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Torta" },
      { token },
    );

    const res = await req<{ items: PlanningItem[]; applied: number }>(
      "POST",
      "/api/planning/schedule",
      {
        updates: [
          { id: a.data.item.id, start_date: "2026-01-01", due_date: "2026-02-01", position: 5 },
          { id: b.data.item.id, start_date: "2026-03-01", due_date: "2026-04-01", position: 3 },
        ],
      },
      { token },
    );
    expect(res.status).toBe(200);
    expect(res.data.applied).toBe(2);

    const rowA = res.data.items.find((i) => i.id === a.data.item.id);
    expect(rowA?.due_date).toBe("2026-02-01");
    expect(rowA?.start_date).toBe("2026-01-01");
    expect(rowA?.position).toBe(5);
    const rowB = res.data.items.find((i) => i.id === b.data.item.id);
    expect(rowB?.due_date).toBe("2026-04-01");
    expect(rowB?.position).toBe(3);
  });

  test("bulk schedule ignores ids from another couple", async () => {
    const mine = await bootstrapCouple("mine@weddly.test");
    const other = await bootstrapCouple("other@weddly.test");
    const foreign = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Idegen feladat" },
      { token: other.token },
    );
    const ours = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Saját feladat" },
      { token: mine.token },
    );

    const res = await req<{ items: PlanningItem[]; applied: number }>(
      "POST",
      "/api/planning/schedule",
      {
        updates: [
          { id: foreign.data.item.id, start_date: "2026-01-01", due_date: "2026-02-01" },
          { id: ours.data.item.id, start_date: "2026-01-01", due_date: "2026-02-01" },
        ],
      },
      { token: mine.token },
    );
    // Only our own row is touched; the foreign id is silently skipped.
    expect(res.data.applied).toBe(1);

    const stillUndated = await req<{ items: PlanningItem[] }>("GET", "/api/planning", undefined, {
      token: other.token,
    });
    expect(stillUndated.data.items.find((i) => i.id === foreign.data.item.id)?.due_date).toBeNull();
  });

  test("bulk schedule rejects a malformed date and a non-array body", async () => {
    const { token } = await bootstrapCouple();
    const created = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Feladat" },
      { token },
    );
    const badDate = await req(
      "POST",
      "/api/planning/schedule",
      { updates: [{ id: created.data.item.id, start_date: null, due_date: "2026/02/01" }] },
      { token },
    );
    expect(badDate.status).toBe(400);

    const badBody = await req("POST", "/api/planning/schedule", { updates: "nope" }, { token });
    expect(badBody.status).toBe(400);
  });

  test("bulk delete removes selected rows atomically and ignores another couple's ids", async () => {
    const mine = await bootstrapCouple("bulk-delete-mine@weddly.test");
    const other = await bootstrapCouple("bulk-delete-other@weddly.test");
    const first = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Első saját feladat" },
      { token: mine.token },
    );
    const second = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "idea", title: "Második saját ötlet" },
      { token: mine.token },
    );
    const foreign = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Idegen feladat" },
      { token: other.token },
    );

    const deleted = await req<{ ok: true; deleted: number }>(
      "POST",
      "/api/planning/delete-many",
      { ids: [first.data.item.id, second.data.item.id, second.data.item.id, foreign.data.item.id] },
      { token: mine.token },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.data).toEqual({ ok: true, deleted: 2 });

    const mineAfter = await req<{ items: PlanningItem[] }>("GET", "/api/planning", undefined, {
      token: mine.token,
    });
    expect(mineAfter.data.items).toHaveLength(0);
    const otherAfter = await req<{ items: PlanningItem[] }>("GET", "/api/planning", undefined, {
      token: other.token,
    });
    expect(otherAfter.data.items.some((item) => item.id === foreign.data.item.id)).toBe(true);
  });

  test("bulk delete validates its id list before deleting anything", async () => {
    const { token } = await bootstrapCouple("bulk-delete-validation@weddly.test");
    const created = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Maradjon meg" },
      { token },
    );

    const empty = await req("POST", "/api/planning/delete-many", { ids: [] }, { token });
    expect(empty.status).toBe(400);
    const malformed = await req(
      "POST",
      "/api/planning/delete-many",
      { ids: [created.data.item.id, "not-an-id"] },
      { token },
    );
    expect(malformed.status).toBe(400);

    const after = await req<{ items: PlanningItem[] }>("GET", "/api/planning", undefined, {
      token,
    });
    expect(after.data.items.some((item) => item.id === created.data.item.id)).toBe(true);
  });

  test("assignee round-trips on a task via create and patch", async () => {
    const { token } = await bootstrapCouple();
    const created = await req<CreateResp>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Virágot rendelni", assignee: "Anna" },
      { token },
    );
    expect(created.data.item.assignee).toBe("Anna");
    const patched = await req<CreateResp>(
      "PATCH",
      `/api/planning/${created.data.item.id}`,
      { assignee: "Apa" },
      { token },
    );
    expect(patched.data.item.assignee).toBe("Apa");
  });
});
