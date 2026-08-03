// Couple-defined meal options on top of the six canonical ones.
//
// Six was never enough for a real wedding (halal, a gluten-free plate, a
// second main), and the enum could not grow without breaking every consumer
// that switches on it. So custom slots are a SEPARATE key space, `x1`…`xN`,
// carrying nothing but the couple's label. What these cases pin is the part
// that would rot quietly: a custom option has to survive the whole round trip
// (menu → public form → guest row → caterer summary → CSV) and must not be
// forgeable from the unauthenticated RSVP endpoint.

import "../setup";

import { describe, expect, test } from "bun:test";
import { req, wipeAll, bootstrapCouple } from "../helpers";
import { MEAL_MAX_CUSTOM } from "@shared/meals";
import type { DietarySummary, MealMenu } from "@shared/types";

async function getSlug(token: string): Promise<string> {
  const me = await req<{ couple: { slug: string | null } }>(
    "GET",
    "/api/couples/current",
    undefined,
    { token },
  );
  return me.data.couple.slug ?? "";
}

async function firstHousehold(token: string): Promise<{ id: number; code: string }> {
  const list = await req<{ households: { id: number; code: string }[] }>(
    "GET",
    "/api/households",
    undefined,
    { token },
  );
  return list.data.households[0]!;
}

async function setMenu(token: string, menu: unknown) {
  return req<{ couple: { meal_menu: MealMenu } }>(
    "PATCH",
    "/api/couples/current",
    { meal_menu: menu },
    { token },
  );
}

/** The six canonical slots, untouched, plus whatever custom entries follow. */
function coreMenu() {
  return ["meat", "fish", "vegetarian", "vegan", "child", "none"].map((choice) => ({
    choice,
    label: null,
    enabled: true,
  }));
}

async function setup(email: string) {
  wipeAll();
  const { token } = await bootstrapCouple(email);
  const g = await req<{ guest: { id: number } }>(
    "POST",
    "/api/guests",
    { full_name: "Anna Kovács" },
    { token },
  );
  expect(g.status).toBe(201);
  const slug = await getSlug(token);
  const hh = await firstHousehold(token);
  return { token, slug, code: hh.code, guestId: g.data.guest.id };
}

function submitMeal(slug: string, code: string, guestId: number, meal: string | null) {
  return req<{ rsvp: { members: { id: number; meal_choice: string | null }[] } }>(
    "POST",
    "/api/rsvp/checkin",
    {
      couple_slug: slug,
      household_code: code,
      members: [
        {
          guest_id: guestId,
          rsvp_status: "yes",
          meal_choice: meal,
          dietary: null,
          accommodation_needed: false,
          song_request: null,
        },
      ],
    },
  );
}

describe("custom meal options", () => {
  test("a couple's own option survives the whole round trip", async () => {
    const { token, slug, code, guestId } = await setup("meal-x-trip@weddly.test");

    const saved = await setMenu(token, [
      ...coreMenu(),
      { choice: "x1", label: "Halal", enabled: true },
      { choice: "x2", label: "Gluténmentes tál", enabled: true },
    ]);
    expect(saved.status).toBe(200);
    expect(saved.data.couple.meal_menu).toHaveLength(8);
    expect(saved.data.couple.meal_menu[6]?.label).toBe("Halal");

    // The guest sees it on the public form...
    const view = await req<{ rsvp: { meal_menu: MealMenu } }>(
      "GET",
      `/api/rsvp/lookup?couple=${slug}&code=${code}`,
    );
    expect(view.data.rsvp.meal_menu.map((m) => m.choice)).toContain("x1");

    // ...picks it...
    const r = await submitMeal(slug, code, guestId, "x1");
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.find((m) => m.id === guestId)?.meal_choice).toBe("x1");

    // ...and the caterer summary reports it under its LABEL, since `x1` means
    // nothing to the person cooking.
    const sum = await req<DietarySummary>("GET", "/api/guests/dietary-summary", undefined, {
      token,
    });
    expect(sum.status).toBe(200);
    const halal = sum.data.custom_meals.find((c) => c.key === "x1");
    expect(halal?.label).toBe("Halal");
    expect(halal?.count).toBe(1);
    // An option nobody picked still reports, as a zero rather than a silence.
    expect(sum.data.custom_meals.find((c) => c.key === "x2")?.count).toBe(0);
    // The six canonical buckets are untouched by any of this.
    expect(sum.data.meal.meat).toBe(0);
    expect(sum.data.meal.unspecified).toBe(0);
  });

  test("the CSV exports the label, never the slot id", async () => {
    const { token, slug, code, guestId } = await setup("meal-x-csv@weddly.test");
    await setMenu(token, [...coreMenu(), { choice: "x1", label: "Halal", enabled: true }]);
    await submitMeal(slug, code, guestId, "x1");

    const res = await fetch(`http://localhost:${process.env.PORT ?? "8791"}/api/guests/csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain("Halal");
    // The internal key must not reach a spreadsheet a caterer opens.
    expect(csv).not.toMatch(/(^|,)"?x1"?(,|$)/m);
  });

  test("a custom key the couple never defined cannot be submitted", async () => {
    const { token, slug, code, guestId } = await setup("meal-x-forge@weddly.test");
    await setMenu(token, [...coreMenu(), { choice: "x1", label: "Halal", enabled: true }]);

    // The RSVP endpoint is unauthenticated. An invented slot resolves to "no
    // preference" rather than to a phantom dish on the catering order.
    const r = await submitMeal(slug, code, guestId, "x9");
    expect(r.status).toBe(200);
    expect(r.data.rsvp.members.find((m) => m.id === guestId)?.meal_choice).toBeNull();
  });

  test("an unlabelled custom option is dropped: it is nothing but its label", async () => {
    const { token } = await setup("meal-x-blank@weddly.test");

    const r = await setMenu(token, [
      ...coreMenu(),
      { choice: "x1", label: "   ", enabled: true },
      { choice: "x2", label: "Halal", enabled: true },
    ]);
    expect(r.status).toBe(200);
    const custom = r.data.couple.meal_menu.filter((m) => m.choice.startsWith("x"));
    expect(custom).toHaveLength(1);
    expect(custom[0]?.choice).toBe("x2");
  });

  test("the six canonical slots always survive, whatever is sent", async () => {
    const { token } = await setup("meal-x-core@weddly.test");

    // A body carrying only custom options must not delete the six: everything
    // downstream keys on them and existing guests hold them.
    const r = await setMenu(token, [{ choice: "x1", label: "Halal", enabled: true }]);
    expect(r.status).toBe(200);
    const keys = r.data.couple.meal_menu.map((m) => m.choice);
    expect(keys.slice(0, 6)).toEqual(["meat", "fish", "vegetarian", "vegan", "child", "none"]);
    expect(keys).toHaveLength(7);
  });

  test("custom options are capped and duplicates collapse", async () => {
    const { token } = await setup("meal-x-cap@weddly.test");

    const tooMany = Array.from({ length: MEAL_MAX_CUSTOM + 4 }, (_, i) => ({
      choice: `x${i + 1}`,
      label: `Option ${i + 1}`,
      enabled: true,
    }));
    const r = await setMenu(token, [...coreMenu(), ...tooMany, ...tooMany]);
    expect(r.status).toBe(200);
    const custom = r.data.couple.meal_menu.filter((m) => m.choice.startsWith("x"));
    expect(custom).toHaveLength(MEAL_MAX_CUSTOM);
    expect(new Set(custom.map((m) => m.choice)).size).toBe(MEAL_MAX_CUSTOM);
  });

  test("deleting an option leaves the guest who picked it on the catering order", async () => {
    const { token, slug, code, guestId } = await setup("meal-x-delete@weddly.test");
    await setMenu(token, [...coreMenu(), { choice: "x1", label: "Halal", enabled: true }]);
    await submitMeal(slug, code, guestId, "x1");

    // The couple removes the option afterwards. The guest still needs feeding,
    // so the bucket survives under its bare key — which reads as stale, and is
    // meant to.
    await setMenu(token, coreMenu());
    const sum = await req<DietarySummary>("GET", "/api/guests/dietary-summary", undefined, {
      token,
    });
    const stale = sum.data.custom_meals.find((c) => c.key === "x1");
    expect(stale?.count).toBe(1);
    expect(sum.data.meal.unspecified).toBe(0);
  });
});
