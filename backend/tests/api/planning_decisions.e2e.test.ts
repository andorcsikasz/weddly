import "../setup";

import { PROMPTS_BY_KEY, promptsForGroup } from "@shared/planning_prompts";
import type { PlanningItem } from "@shared/types";
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

type ListResp = { items: PlanningItem[] };
type GenResp = { items: PlanningItem[]; created: number };

function prompts(items: PlanningItem[]): PlanningItem[] {
  return items.filter((i) => i.seed_key);
}

describe("planning decisions (Döntések layer)", () => {
  beforeEach(() => {
    wipeAll();
  });

  test("generate materialises a group's prompts as open task rows, idempotently", async () => {
    const { token } = await bootstrapCouple();

    const gen = await req<GenResp>(
      "POST",
      "/api/planning/prompts/generate",
      { group: "ceremony" },
      { token },
    );
    expect(gen.status).toBe(200);
    expect(gen.data.created).toBeGreaterThan(0);

    const made = prompts(gen.data.items);
    expect(made.length).toBe(gen.data.created);
    // Every materialised row is a kind='task', open, undated decision-prompt
    // whose seed_key resolves against the master and belongs to the group.
    for (const row of made) {
      expect(row.kind).toBe("task");
      expect(row.decision_status).toBe("open");
      expect(row.due_date).toBeNull();
      const seed = PROMPTS_BY_KEY.get(row.seed_key ?? "");
      expect(seed?.group).toBe("ceremony");
    }

    // Second generate of the same group inserts nothing (dedupe on seed_key).
    const again = await req<GenResp>(
      "POST",
      "/api/planning/prompts/generate",
      { group: "ceremony" },
      { token },
    );
    expect(again.status).toBe(200);
    expect(again.data.created).toBe(0);
    expect(prompts(again.data.items).length).toBe(made.length);
  });

  test("rejects an unknown group", async () => {
    const { token } = await bootstrapCouple();
    const bad = await req("POST", "/api/planning/prompts/generate", { group: "nope" }, { token });
    expect(bad.status).toBe(400);
  });

  test("a prompt is decided with a resolution and reopened", async () => {
    const { token } = await bootstrapCouple();
    const gen = await req<GenResp>(
      "POST",
      "/api/planning/prompts/generate",
      { group: "food_drink" },
      { token },
    );
    const target = prompts(gen.data.items)[0];
    expect(target).toBeDefined();
    const id = target?.id as number;

    const decided = await req<{ item: PlanningItem }>(
      "PATCH",
      `/api/planning/${id}`,
      { decision_status: "decided", resolution: "Barista kávé, van növényi tej" },
      { token },
    );
    expect(decided.status).toBe(200);
    expect(decided.data.item.decision_status).toBe("decided");
    expect(decided.data.item.resolution).toBe("Barista kávé, van növényi tej");
    // Still hidden from the dated Tasks surface (no due_date, not promoted).
    expect(decided.data.item.due_date).toBeNull();

    const reopened = await req<{ item: PlanningItem }>(
      "PATCH",
      `/api/planning/${id}`,
      { decision_status: "open", resolution: null },
      { token },
    );
    expect(reopened.data.item.decision_status).toBe("open");
    expect(reopened.data.item.resolution).toBeNull();
  });

  test("promoting a prompt turns it into a dated task", async () => {
    const { token } = await bootstrapCouple();
    const gen = await req<GenResp>(
      "POST",
      "/api/planning/prompts/generate",
      { group: "dayof_money_close" },
      { token },
    );
    const target = prompts(gen.data.items)[0];
    const id = target?.id as number;

    const promoted = await req<{ item: PlanningItem }>(
      "PATCH",
      `/api/planning/${id}`,
      { decision_status: "promoted", due_date: "2026-09-01", assignee: "Anna" },
      { token },
    );
    expect(promoted.status).toBe(200);
    expect(promoted.data.item.decision_status).toBe("promoted");
    expect(promoted.data.item.due_date).toBe("2026-09-01");
    expect(promoted.data.item.assignee).toBe("Anna");
    // seed_key is retained so the deck can still show it as "moved".
    expect(promoted.data.item.seed_key).toBe(target?.seed_key ?? null);
  });

  test("lifecycle fields stay null on a normal (non-prompt) task", async () => {
    const { token } = await bootstrapCouple();
    const created = await req<{ item: PlanningItem }>(
      "POST",
      "/api/planning",
      { kind: "task", title: "Sima feladat" },
      { token },
    );
    expect(created.data.item.seed_key).toBeNull();
    expect(created.data.item.decision_status).toBeNull();

    // A client trying to set decision_status on a non-prompt row is ignored.
    const patched = await req<{ item: PlanningItem }>(
      "PATCH",
      `/api/planning/${created.data.item.id}`,
      { decision_status: "decided", resolution: "nope" },
      { token },
    );
    expect(patched.data.item.decision_status).toBeNull();
    expect(patched.data.item.resolution).toBeNull();
  });

  test("intake profile persists and a 'no' answer hides its conditional prompts", async () => {
    const { token } = await bootstrapCouple();

    // Default profile is empty.
    const empty = await req<{ tags: Record<string, string> }>(
      "GET",
      "/api/planning/prompts/profile",
      undefined,
      { token },
    );
    expect(empty.status).toBe(200);
    expect(empty.data.tags).toEqual({});

    // Say "no outdoor".
    const saved = await req<{ tags: Record<string, string> }>(
      "PUT",
      "/api/planning/prompts/profile",
      { tags: { outdoor: "no" } },
      { token },
    );
    expect(saved.status).toBe(200);
    expect(saved.data.tags.outdoor).toBe("no");

    // The venue_weather group has outdoor-tagged prompts; with outdoor=no they
    // must not be materialised.
    const outdoorKeys = new Set(
      promptsForGroup("venue_weather")
        .filter((s) => s.condition === "outdoor")
        .map((s) => s.seed_key),
    );
    expect(outdoorKeys.size).toBeGreaterThan(0);

    const gen = await req<GenResp>(
      "POST",
      "/api/planning/prompts/generate",
      { group: "venue_weather" },
      { token },
    );
    const madeKeys = new Set(prompts(gen.data.items).map((r) => r.seed_key));
    for (const k of outdoorKeys) expect(madeKeys.has(k)).toBe(false);
    // Universal venue prompts still come through.
    expect(madeKeys.size).toBeGreaterThan(0);
  });

  test("religious prompts are hidden for a civil-only ceremony", async () => {
    const { token, coupleId } = await bootstrapCouple();
    db.prepare("UPDATE couples SET ceremony_kind = 'civil' WHERE id = ?").run(coupleId);

    const religiousKeys = new Set(
      promptsForGroup("ceremony")
        .filter((s) => s.condition === "religious")
        .map((s) => s.seed_key),
    );

    const gen = await req<GenResp>(
      "POST",
      "/api/planning/prompts/generate",
      { group: "ceremony" },
      { token },
    );
    const madeKeys = new Set(prompts(gen.data.items).map((r) => r.seed_key));
    for (const k of religiousKeys) expect(madeKeys.has(k)).toBe(false);
  });
});
