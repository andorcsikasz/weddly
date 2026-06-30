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
