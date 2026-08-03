import "./setup";
import { describe, expect, test } from "bun:test";
import { PROMPT_SEEDS } from "@shared/planning_prompts";
import { HONEYMOON_EXTRA_TASKS, TASK_TEMPLATE_GROUPS } from "@shared/planning_task_packs";
import { WEDDING_TIMELINE } from "@shared/planning_timeline";
import {
  WAND_FALLBACK_LEAD,
  WAND_FALLBACK_SPREAD_DAYS,
  suggestSchedule,
  wandLeadFor,
} from "@shared/planning_wand";

const WEDDING = "2027-06-05";

/** A free-typed task the way the wizard sees one: no seed, but a real row id. */
function task(title: string, extra: { seed_key?: string | null; id?: number } = {}) {
  return { title, seed_key: extra.seed_key ?? null, id: extra.id };
}

function due(title: string, extra: { seed_key?: string | null; id?: number } = {}): string {
  const r = suggestSchedule(task(title, extra), WEDDING);
  expect(r, title).not.toBeNull();
  return r!.due_date;
}

const honeymoonItems = TASK_TEMPLATE_GROUPS.find((g) => g.id === "honeymoon")?.items ?? [];

describe("wandLeadFor: curated wedding timeline titles", () => {
  test("a WEDDING_TIMELINE title gets that template's own lead, in both locales", () => {
    // "Book your venue" is 12 calendar months out with a 45-day window.
    const venue = WEDDING_TIMELINE.find((i) => i.key === "venue")!;
    for (const title of [venue.title.hu, venue.title.en]) {
      expect(wandLeadFor(task(title))).toEqual({ lead: venue.lead, windowDays: venue.windowDays });
    }
    expect(due(venue.title.hu)).toBe("2026-06-05");
  });

  test("matching ignores surrounding whitespace and case", () => {
    expect(wandLeadFor(task("  bOoK YoUr VeNuE  "))).toEqual(wandLeadFor(task("Book your venue")));
  });

  test("a short-fuse timeline title lands in the wedding week, not a month out", () => {
    expect(due("Pack wedding bag")).toBe("2027-06-04");
  });
});

describe("wandLeadFor: honeymoon pack titles (the regression that matters)", () => {
  test("every honeymoon pack title resolves to its own lead, not the fallback", () => {
    for (const item of honeymoonItems) {
      for (const title of [item.title.hu, item.title.en]) {
        const lead = wandLeadFor(task(title));
        expect(lead.lead, title).toEqual({ days: -item.deadline_days });
        expect(lead, title).not.toEqual(WAND_FALLBACK_LEAD);
      }
    }
  });

  test("two different honeymoon tasks get two DIFFERENT dates", () => {
    // The bug: passport, flights and the packing list all came out on one day.
    const passport = due("Check passport validity");
    const flights = due("Book flights");
    const packing = due("Pack list");
    expect(passport).toBe("2026-12-07"); // 180 days before
    expect(flights).toBe("2027-01-06"); // 150 days before
    expect(packing).toBe("2027-06-02"); // 3 days before
    expect(new Set([passport, flights, packing]).size).toBe(3);
    // …and they come out in the order a couple would actually do them.
    expect(passport < flights).toBe(true);
    expect(flights < packing).toBe(true);
  });

  test("the whole honeymoon pack spreads across the runway", () => {
    const dates = new Set(honeymoonItems.map((i) => due(i.title.hu)));
    // 10 items, 8 distinct deadline_days values (two pairs share one).
    expect(dates.size).toBe(new Set(honeymoonItems.map((i) => i.deadline_days)).size);
    expect(dates.size).toBeGreaterThan(1);
  });

  test("the HU and the EN title of one pack item agree", () => {
    for (const item of [...honeymoonItems, ...HONEYMOON_EXTRA_TASKS]) {
      expect(due(item.title.hu), item.title.en).toBe(due(item.title.en));
    }
  });
});

describe("wandLeadFor: honeymoon reserve tasks", () => {
  test("every reserve task carries a real lead, so none of them is fallback-dated", () => {
    for (const item of HONEYMOON_EXTRA_TASKS) {
      expect(item.deadline_days, item.title.en).toBeLessThan(0);
      const lead = wandLeadFor(task(item.title.en));
      expect(lead.lead, item.title.en).toEqual({ days: -item.deadline_days });
    }
  });

  test("the reserve set is not a second one-date class", () => {
    const dates = new Set(HONEYMOON_EXTRA_TASKS.map((i) => due(i.title.en)));
    expect(dates.size).toBeGreaterThan(4);
  });

  test("an admin errand outruns a suitcase errand", () => {
    // The IDP is an office visit with a wait; the first-aid kit is a chemist run.
    const idp = due("Apply for an international driving permit");
    const kit = due("Pack a basic travel first-aid kit");
    expect(idp < kit).toBe(true);
  });
});

describe("wandLeadFor: seed_key group leads", () => {
  const venuePrompt = PROMPT_SEEDS.find((p) => p.group === "venue_weather")!;
  const dayOfPrompt = PROMPT_SEEDS.find((p) => p.group === "dayof_money_close")!;

  test("a promoted decision prompt gets its theme group's lead", () => {
    expect(wandLeadFor(task("anything at all", { seed_key: venuePrompt.seed_key }))).toEqual({
      lead: { months: 4 },
      windowDays: 30,
    });
    expect(wandLeadFor(task("anything at all", { seed_key: dayOfPrompt.seed_key }))).toEqual({
      lead: { days: 10 },
      windowDays: 7,
    });
  });

  test("venue decisions land well before day-of money tasks", () => {
    const early = due("x", { seed_key: venuePrompt.seed_key });
    const late = due("y", { seed_key: dayOfPrompt.seed_key });
    expect(early < late).toBe(true);
  });

  test("an unknown seed_key drops through to the fallback", () => {
    const lead = wandLeadFor(task("Kutyasétáltatás", { seed_key: "no_such_prompt", id: 0 }));
    expect(lead).toEqual(WAND_FALLBACK_LEAD);
  });
});

describe("wandLeadFor: precedence", () => {
  test("a title match beats the seed_key group", () => {
    // Same row, once with a seed and once without: the curated title wins both
    // times, so promoting a prompt can never move a known big rock.
    const venue = WEDDING_TIMELINE.find((i) => i.key === "venue")!;
    const seeded = wandLeadFor(
      task(venue.title.hu, { seed_key: PROMPT_SEEDS[0]!.seed_key, id: 7 }),
    );
    expect(seeded).toEqual({ lead: venue.lead, windowDays: venue.windowDays });
  });

  test("the curated timeline beats the task pack on a shared title", () => {
    // "Helyszínt foglalni" is in both. The timeline says 12 calendar months;
    // the pack's own -365 would land a day out on a leap year.
    const venue = WEDDING_TIMELINE.find((i) => i.key === "venue")!;
    const packVenue = TASK_TEMPLATE_GROUPS.find((g) => g.id === "wedding")!.items.find(
      (i) => i.title.hu === venue.title.hu,
    );
    expect(packVenue).toBeDefined();
    expect(wandLeadFor(task(venue.title.hu)).lead).toEqual(venue.lead);
  });

  test("the seed_key group beats the fallback", () => {
    const lead = wandLeadFor(
      task("Egy teljesen egyedi teendő", { seed_key: PROMPT_SEEDS[0]!.seed_key }),
    );
    expect(lead).not.toEqual(WAND_FALLBACK_LEAD);
  });
});

describe("wandLeadFor: the fallback is staggered, not stacked", () => {
  test("free-typed tasks do not all collapse onto one date", () => {
    const titles = [
      "Kutyasétáltatás",
      "Nagyi elhozása",
      "Kölcsönkért asztalok",
      "Kávégép",
      "Esernyők",
    ];
    const dates = titles.map((title, i) => due(title, { id: 101 + i }));
    expect(new Set(dates).size).toBe(titles.length);
  });

  test("the spread runs in row order: the task typed first is proposed first", () => {
    const dates = [0, 1, 2, 3].map((i) => due(`free task ${i}`, { id: 200 + i }));
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  test("slot 0 is exactly WAND_FALLBACK_LEAD and the band is a fortnight wide", () => {
    const first = due("a", { id: 0 });
    const last = due("b", { id: WAND_FALLBACK_SPREAD_DAYS - 1 });
    expect(wandLeadFor(task("a", { id: 0 }))).toEqual(WAND_FALLBACK_LEAD);
    expect(first).toBe("2027-04-23"); // 43 days before
    expect(last).toBe("2027-05-06"); // 30 days before
  });

  test("the band wraps rather than drifting away from the wedding", () => {
    // Whatever the row id, a fallback task always lands inside the fortnight.
    for (const id of [0, 13, 14, 99, 1_000_000]) {
      const d = due("z", { id });
      expect(d >= "2027-04-23", String(id)).toBe(true);
      expect(d <= "2027-05-06", String(id)).toBe(true);
    }
  });

  test("an idless task still gets a stable, spread date", () => {
    const a = due("Kutyasétáltatás");
    const b = due("Nagyi elhozása");
    expect(a).toBe(due("Kutyasétáltatás")); // deterministic
    expect(a).not.toBe(b); // and not stacked
  });
});

describe("suggestSchedule", () => {
  test("returns null without a usable wedding date", () => {
    expect(suggestSchedule(task("Book flights"), null)).toBeNull();
    expect(suggestSchedule(task("Book flights"), "")).toBeNull();
    expect(suggestSchedule(task("Book flights"), "2027-02-30")).toBeNull();
  });

  test("start_date is always on or before due_date, for every known title", () => {
    const titles = [
      ...WEDDING_TIMELINE.flatMap((i) => [i.title.hu, i.title.en]),
      ...TASK_TEMPLATE_GROUPS.flatMap((g) => g.items).flatMap((i) => [i.title.hu, i.title.en]),
      ...HONEYMOON_EXTRA_TASKS.flatMap((i) => [i.title.hu, i.title.en]),
      "valami szabadon beírt teendő",
    ];
    for (const title of titles) {
      const r = suggestSchedule(task(title, { id: 1 }), WEDDING);
      expect(r, title).not.toBeNull();
      expect(r!.start_date <= r!.due_date, title).toBe(true);
    }
  });
});
