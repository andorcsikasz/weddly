import {
  checklistLeadDaysById,
  checklistSections,
  PLANNING_PACES,
  recommendedPlanningPace,
  checklistTemplateSize,
  isChecklistItemApplicable,
  isChecklistTemplateId,
} from "@shared/wedding_checklist";
import { describe, expect, test } from "bun:test";

describe("shared wedding checklist catalogue", () => {
  test("keeps stable unique ids and complete copy in every UI locale", () => {
    const locales = ["en", "hu", "es", "hr", "de"] as const;
    for (const locale of locales) {
      const sections = checklistSections(locale, "2027-08-15");
      const items = sections.flatMap((section) => section.items);
      expect(sections).toHaveLength(11);
      expect(items).toHaveLength(checklistTemplateSize());
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      expect(items.every((item) => item.title.trim().length > 3)).toBe(true);
      expect(items.every((item) => item.dueDate !== null)).toBe(true);
      expect(items.every((item) => isChecklistTemplateId(item.id))).toBe(true);
    }
  });

  test("places post-wedding tasks after the wedding and exposes personalization rules", () => {
    const sections = checklistSections("en", "2027-08-15");
    const after = sections.find((section) => section.id === "after");
    expect(after?.items[0]?.dueDate).toBe("2027-08-22");
    const conditional = sections
      .flatMap((section) => section.items)
      .filter((item) => item.condition);
    expect(conditional.some((item) => item.condition === "outdoor")).toBe(true);
    expect(conditional.some((item) => item.condition === "has_children")).toBe(true);
    expect(conditional.some((item) => item.condition === "alcohol_served")).toBe(true);
    expect(conditional.some((item) => item.condition === "accommodation_needed")).toBe(true);
    expect(conditional.some((item) => item.condition === "printed_stationery")).toBe(true);
    const noOutdoor = sections
      .flatMap((section) => section.items)
      .filter((item) => isChecklistItemApplicable(item, { outdoor: "no" }));
    expect(noOutdoor.some((item) => item.condition === "outdoor")).toBe(false);
    expect(noOutdoor.length).toBe(checklistTemplateSize() - 2);
  });

  test("with todayIso, a near wedding never suggests a past date, and section order survives", () => {
    // Wedding only 100 days out: the 12-18/9-12/6-9-month sections (leadDays
    // 450/315/225, all > 100) must clamp; the rest already fit.
    const todayIso = "2026-06-14";
    const weddingDate = "2026-09-22"; // 100 days after todayIso
    const sections = checklistSections("en", weddingDate, todayIso);
    const pre = sections.filter((s) => s.id !== "after");
    for (const section of pre) {
      for (const item of section.items) {
        expect(item.dueDate, item.id).not.toBeNull();
        expect(item.dueDate! >= todayIso, item.id).toBe(true);
        expect(item.dueDate! <= weddingDate, item.id).toBe(true);
      }
    }
    // Section order must still read earliest-due-first: a section can never
    // start before the section listed ahead of it finished.
    let previousMax = todayIso;
    for (const section of pre) {
      const dates = section.items.map((i) => i.dueDate!).sort();
      const min = dates[0]!;
      expect(min >= previousMax, section.id).toBe(true);
      previousMax = dates[dates.length - 1]!;
    }
  });

  test("without todayIso, the catalog can still suggest a date before today (pre-existing behaviour)", () => {
    // Omitting todayIso keeps the plain calendar subtraction — this is what a
    // stored, couple-approved date relies on never being silently rewritten.
    const sections = checklistSections("en", "2026-09-22");
    const m12_18 = sections.find((s) => s.id === "m12_18");
    expect(m12_18?.items[0]?.dueDate).toBe("2025-06-29");
  });

  test("each pace keeps every section in runway order and inside its own horizon", () => {
    const weddingDate = "2029-06-16";
    const wed = new Date("2029-06-16T00:00:00");
    const horizonDays = { early_bird: 18 * 31, relaxed: 10 * 31, last_minute: 4 * 31 };
    for (const pace of PLANNING_PACES) {
      const sections = checklistSections("en", weddingDate, undefined, pace);
      const dues = sections.map((section) => section.items[0]?.dueDate ?? "");
      for (let i = 1; i < dues.length; i++) {
        expect(dues[i]! > dues[i - 1]!, `${pace} ${sections[i]?.id}`).toBe(true);
      }
      const first = new Date(`${dues[0]}T00:00:00`);
      const lead = Math.round((wed.getTime() - first.getTime()) / 86_400_000);
      expect(lead <= horizonDays[pace], pace).toBe(true);
      // The final month is the final month whatever the pace.
      expect(sections.find((s) => s.id === "m1")?.items[0]?.dueDate).toBe("2029-05-17");
    }
  });

  test("early bird is the original plan, and the other paces retitle the long-range sections", () => {
    const early = checklistSections("en", "2029-06-16", undefined, "early_bird");
    const byDefault = checklistSections("en", "2029-06-16");
    expect(early).toEqual(byDefault);
    expect(early[0]?.title).toBe("12–18 months before");
    expect(checklistSections("en", null, undefined, "relaxed")[0]?.title).toBe(
      "8–10 months before",
    );
    expect(checklistSections("hr", null, undefined, "last_minute")[0]?.title).toBe(
      "12–16 tjedana prije",
    );
    // A conditional extra moves with the section it sits in.
    const leads = checklistLeadDaysById("last_minute");
    expect(leads.get("hotel-blocks")).toBe(leads.get("choose-outfits"));
  });

  test("recommends the pace that fits the runway left", () => {
    expect(recommendedPlanningPace("2027-12-01", "2026-09-30")).toBe("early_bird");
    expect(recommendedPlanningPace("2027-05-01", "2026-09-30")).toBe("relaxed");
    expect(recommendedPlanningPace("2026-12-01", "2026-09-30")).toBe("last_minute");
    expect(recommendedPlanningPace(null, "2026-09-30")).toBeNull();
  });
});
