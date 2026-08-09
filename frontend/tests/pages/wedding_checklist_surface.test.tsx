import "../setup";

import { checklistSections } from "@shared/wedding_checklist";
import type { PlanningItem } from "@shared/types";
import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppProviders } from "@/components/ui/AppProviders";
import { WeddingChecklist } from "@/components/WeddingChecklist";
import { I18nProvider } from "@/lib/i18n";

function checklistTask(id: number, templateId: string, title: string, done = false): PlanningItem {
  return {
    id,
    couple_id: 1,
    kind: "task",
    topic: "wedding",
    title,
    body: null,
    done,
    due_date: null,
    scheduled_time: null,
    assignee: null,
    start_date: null,
    supplier_id: null,
    priority: 0,
    suggested_by_user_id: null,
    suggested_by_name: null,
    position: id,
    seed_key: null,
    checklist_template_id: templateId,
    decision_status: null,
    resolution: null,
    idea_status: null,
    idea_tag: null,
    created_at: id,
    updated_at: id,
  };
}

describe("Wedding checklist Planning surface", () => {
  it("is persistent, uses a two-column layout, and exposes real checkboxes", () => {
    localStorage.setItem("weddly.locale", "en");
    const sections = checklistSections("en", "2027-08-15");
    const first = sections[0]?.items[0];
    const second = sections[1]?.items[0];
    if (!first || !second) throw new Error("Checklist fixture is incomplete");

    const { container } = render(
      <I18nProvider>
        <AppProviders>
          <WeddingChecklist
            items={[
              checklistTask(1, first.id, first.title, true),
              checklistTask(2, second.id, second.title),
            ]}
            onItemsChange={() => {}}
            weddingDate="2027-08-15"
            profile={{}}
          />
        </AppProviders>
      </I18nProvider>,
    );

    expect(container.querySelector('[data-checklist-surface="persistent"]')).not.toBeNull();
    expect(container.querySelector('[data-checklist-layout="two-column"]')).toHaveClass(
      "md:grid-cols-2",
    );
    expect(screen.getByRole("button", { name: "PDF options" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "PDF options" }));
    for (const language of ["English", "Magyar", "Español", "Hrvatski", "Deutsch"]) {
      expect(screen.getByRole("radio", { name: language })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("radio", { name: "Magyar" }));
    expect(screen.getByRole("radio", { name: "Magyar" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mark not done" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Mark done" })).not.toBeChecked();
  });
});
