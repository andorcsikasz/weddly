import "../setup";

import { checklistSections } from "@shared/wedding_checklist";
import type { PlanningItem } from "@shared/types";
import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/components/ui/AppProviders";
import { WeddingChecklist } from "@/components/WeddingChecklist";
import { todayIso } from "@/lib/format";
import { I18nProvider } from "@/lib/i18n";

function checklistTask(
  id: number,
  templateId: string,
  title: string,
  done = false,
  dueDate: string | null = null,
): PlanningItem {
  return {
    id,
    couple_id: 1,
    kind: "task",
    topic: "wedding",
    title,
    body: null,
    done,
    due_date: dueDate,
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

  it("flags an added item as overdue when its own due date has passed, matching the Tasks tab's badge", () => {
    localStorage.setItem("weddly.locale", "en");
    const sections = checklistSections("en", "2027-08-15");
    const first = sections[0]?.items[0];
    if (!first) throw new Error("Checklist fixture is incomplete");

    render(
      <I18nProvider>
        <AppProviders>
          <WeddingChecklist
            items={[checklistTask(1, first.id, first.title, false, "2020-01-01")]}
            onItemsChange={() => {}}
            weddingDate="2027-08-15"
            profile={{}}
          />
        </AppProviders>
      </I18nProvider>,
    );

    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("shows Suggest deadlines only when there's a wedding date and something left to add", () => {
    localStorage.setItem("weddly.locale", "en");
    const weddingDate = "2027-08-15";
    const catalog = checklistSections("en", weddingDate).flatMap((section) => section.items);
    const [first] = catalog;
    if (!first) throw new Error("Checklist fixture is incomplete");

    // No wedding date at all: nothing to compute a suggestion from.
    const { rerender } = render(
      <I18nProvider>
        <AppProviders>
          <WeddingChecklist items={[]} onItemsChange={() => {}} weddingDate={null} profile={{}} />
        </AppProviders>
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "Suggest deadlines" })).toBeNull();

    rerender(
      <I18nProvider>
        <AppProviders>
          <WeddingChecklist
            items={[]}
            onItemsChange={() => {}}
            weddingDate={weddingDate}
            profile={{}}
          />
        </AppProviders>
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Suggest deadlines" })).toBeInTheDocument();

    // Approving every catalog item leaves nothing left to suggest.
    const allAdded = catalog.map((entry, index) =>
      checklistTask(index + 1, entry.id, entry.title, false),
    );
    rerender(
      <I18nProvider>
        <AppProviders>
          <WeddingChecklist
            items={allAdded}
            onItemsChange={() => {}}
            weddingDate={weddingDate}
            profile={{}}
          />
        </AppProviders>
      </I18nProvider>,
    );
    expect(screen.queryByRole("button", { name: "Suggest deadlines" })).toBeNull();
  });

  it("Suggest deadlines approves not-yet-added items via the checklist endpoint, never re-submitting one already added", async () => {
    localStorage.setItem("weddly.locale", "en");
    const weddingDate = "2027-08-15";
    const catalog = checklistSections("en", weddingDate).flatMap((section) => section.items);
    const [first, second] = catalog;
    if (!first || !second) throw new Error("Checklist fixture is incomplete");

    // The production loop is sequential and has no cancel switch, so a test
    // that let it run to completion would either wait out the couple of
    // hundred remaining real catalog items or risk a dangling fetch after the
    // mock below is restored. Failing the SECOND request stops the loop
    // (via its own try/catch) after proving the first one really went
    // through, keeping this deterministic and fast.
    const realFetch = globalThis.fetch;
    const postedTemplateIds: string[] = [];
    const postedDueDates: (string | undefined)[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/planning/checklist/items") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { template_id: string; due_date?: string };
        postedTemplateIds.push(body.template_id);
        postedDueDates.push(body.due_date);
        if (postedTemplateIds.length >= 2) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        const item = checklistTask(101, body.template_id, body.template_id, false, body.due_date);
        return new Response(JSON.stringify({ item, created: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    try {
      const items: PlanningItem[] = [
        checklistTask(1, first.id, first.title, false),
        checklistTask(2, second.id, second.title, false),
      ];
      render(
        <I18nProvider>
          <AppProviders>
            <WeddingChecklist
              items={items}
              onItemsChange={() => {}}
              weddingDate={weddingDate}
              profile={{}}
            />
          </AppProviders>
        </I18nProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Suggest deadlines" }));

      await waitFor(() => expect(postedTemplateIds.length).toBe(2));
      // The loop is over — the button is interactive again.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Suggest deadlines" })).toBeEnabled(),
      );
      expect(postedTemplateIds).not.toContain(first.id);
      expect(postedTemplateIds).not.toContain(second.id);
      expect(new Set(postedTemplateIds).size).toBe(2);
      // Every submitted date is a real, non-null suggestion — never the
      // long-past default a 15-month-out lead would naively compute.
      const today = todayIso();
      for (const date of postedDueDates) {
        expect(date).not.toBeNull();
        expect(date! >= today).toBe(true);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
