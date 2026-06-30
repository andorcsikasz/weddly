// Per-couple custom meal menu: couples rename the six fixed meal slots and
// toggle which are offered, and the public RSVP view exposes the result so the
// check-in form shows their real dishes. The slot keys stay the MealChoice
// enum (stats / place cards / allergen logic unchanged) — this only customises
// labels + offered flags. See shared/meals.ts + routes/couples.ts.

import "../setup";

import { describe, expect, test } from "bun:test";
import { MEAL_ORDER } from "@shared/meals";
import type { Couple, MealMenu, PublicCheckinView } from "@shared/types";
import { db } from "../../src/db";
import { bootstrapCouple, req, wipeAll } from "../helpers";

function patchMenu(token: string, meal_menu: unknown) {
  return req<{ couple: Couple }>("PATCH", "/api/couples/current", { meal_menu }, { token });
}

describe("couple meal menu", () => {
  test("a fresh couple gets the all-default 6-slot menu", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("meal-default@weddly.test");
    const me = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, { token });
    expect(me.status).toBe(200);
    const menu = me.data.couple.meal_menu;
    expect(menu.map((m) => m.choice)).toEqual(MEAL_ORDER);
    expect(menu.every((m) => m.enabled)).toBe(true);
    expect(menu.every((m) => m.label === null)).toBe(true);
  });

  test("custom labels + offered flags persist and round-trip", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("meal-custom@weddly.test");
    const input: MealMenu = [
      { choice: "meat", label: "Marhasült rukkolával", enabled: true },
      { choice: "fish", label: "Sült pisztráng", enabled: true },
      { choice: "vegetarian", label: "Gombás rizottó", enabled: true },
      { choice: "vegan", label: null, enabled: false },
      { choice: "child", label: "Gyerekmenü", enabled: true },
      { choice: "none", label: null, enabled: false },
    ];
    const patched = await patchMenu(token, input);
    expect(patched.status).toBe(200);

    const me = await req<{ couple: Couple }>("GET", "/api/couples/current", undefined, { token });
    const byChoice = new Map(me.data.couple.meal_menu.map((m) => [m.choice, m]));
    expect(byChoice.get("meat")).toEqual({
      choice: "meat",
      label: "Marhasült rukkolával",
      enabled: true,
    });
    expect(byChoice.get("vegan")?.enabled).toBe(false);
    expect(byChoice.get("vegan")?.label).toBeNull();
    expect(byChoice.get("child")?.label).toBe("Gyerekmenü");
  });

  test("partial / unordered input resolves to the full ordered 6-slot menu", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("meal-partial@weddly.test");
    // Only two slots sent, out of order, with an unknown key that must be dropped.
    const patched = await patchMenu(token, [
      { choice: "fish", label: "Tonhal", enabled: true },
      { choice: "bogus", label: "x", enabled: true },
      { choice: "meat", label: null, enabled: false },
    ]);
    expect(patched.status).toBe(200);
    const menu = patched.data.couple.meal_menu;
    expect(menu.map((m) => m.choice)).toEqual(MEAL_ORDER);
    const byChoice = new Map(menu.map((m) => [m.choice, m]));
    expect(byChoice.get("fish")?.label).toBe("Tonhal");
    expect(byChoice.get("meat")?.enabled).toBe(false);
    // Slots not mentioned default to enabled / no override.
    expect(byChoice.get("vegetarian")).toEqual({
      choice: "vegetarian",
      label: null,
      enabled: true,
    });
  });

  test("an all-disabled menu is normalised so at least one slot stays offered", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("meal-alloff@weddly.test");
    const patched = await patchMenu(
      token,
      MEAL_ORDER.map((choice) => ({ choice, label: null, enabled: false })),
    );
    expect(patched.status).toBe(200);
    expect(patched.data.couple.meal_menu.some((m) => m.enabled)).toBe(true);
  });

  test("over-long labels are trimmed to the storage cap", async () => {
    wipeAll();
    const { token } = await bootstrapCouple("meal-long@weddly.test");
    const huge = "x".repeat(200);
    const patched = await patchMenu(token, [{ choice: "meat", label: huge, enabled: true }]);
    expect(patched.status).toBe(200);
    const meat = patched.data.couple.meal_menu.find((m) => m.choice === "meat");
    expect(meat?.label).not.toBeNull();
    expect((meat?.label ?? "").length).toBeLessThanOrEqual(48);
  });

  test("the public RSVP view exposes the couple's custom menu", async () => {
    wipeAll();
    const { token, coupleId } = await bootstrapCouple("meal-public@weddly.test");
    await patchMenu(token, [
      { choice: "meat", label: "Bárányborda", enabled: true },
      { choice: "none", label: null, enabled: false },
    ]);
    const hh = await req<{ household: { code: string } }>(
      "POST",
      "/api/households",
      { label: "Public family" },
      { token },
    );
    expect(hh.status).toBe(201);
    const code = hh.data.household.code;
    const slug = (
      db.prepare("SELECT slug FROM couples WHERE id = ?").get(coupleId) as { slug: string }
    ).slug;

    const view = await req<{ rsvp: PublicCheckinView }>(
      "GET",
      `/api/rsvp/lookup?couple=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`,
    );
    expect(view.status).toBe(200);
    const menu = view.data.rsvp.meal_menu;
    const byChoice = new Map(menu.map((m) => [m.choice, m]));
    expect(byChoice.get("meat")?.label).toBe("Bárányborda");
    expect(byChoice.get("none")?.enabled).toBe(false);
    // Still the full ordered six slots, so the form can render defaults too.
    expect(menu.map((m) => m.choice)).toEqual(MEAL_ORDER);
  });
});
