import {
  checklistSections,
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
});
