import type { PlanningItem } from "@shared/types";
import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { KanbanBoard } from "@/pages/PlanningPage";

function task(over: Partial<PlanningItem> = {}): PlanningItem {
  return {
    id: 1,
    couple_id: 1,
    kind: "task",
    topic: "wedding",
    title: "Confirm florist",
    body: null,
    done: false,
    due_date: null,
    scheduled_time: null,
    assignee: null,
    start_date: null,
    supplier_id: null,
    priority: 0,
    suggested_by_user_id: null,
    suggested_by_name: null,
    position: 0,
    seed_key: null,
    checklist_template_id: null,
    decision_status: null,
    resolution: null,
    idea_status: null,
    idea_tag: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

describe("Planning board mobile drag", () => {
  it("moves a task with a captured touch pointer without also toggling it done", () => {
    localStorage.setItem("weddly.locale", "en");
    const item = task();
    const onPatchTask = mock((_received: PlanningItem, _patch: Partial<PlanningItem>) => {});
    const onToggleTaskDone = mock((_received: PlanningItem) => {});
    const { container } = render(
      <I18nProvider>
        <KanbanBoard
          tasks={[item]}
          vendors={[]}
          currency="HUF"
          filter="tasks"
          onToggleTaskDone={onToggleTaskDone}
          onPatchTask={onPatchTask}
          onAddVendor={() => {}}
          onEditVendor={() => {}}
        />
      </I18nProvider>,
    );

    const target = container.querySelector<HTMLElement>('[data-kanban-col="in_progress"]');
    expect(target).not.toBeNull();
    const originalElementFromPoint = document.elementFromPoint;
    document.elementFromPoint = mock(() => target) as typeof document.elementFromPoint;

    try {
      const grip = screen.getByRole("button", { name: "Drag task to another column" });
      fireEvent.pointerDown(grip, {
        pointerId: 7,
        pointerType: "touch",
        clientX: 24,
        clientY: 120,
      });
      fireEvent.pointerMove(grip, {
        pointerId: 7,
        pointerType: "touch",
        clientX: 32,
        clientY: 240,
      });

      expect(target).toHaveClass("ring-2");
      fireEvent.pointerUp(grip, {
        pointerId: 7,
        pointerType: "touch",
        clientX: 32,
        clientY: 240,
      });
      fireEvent.click(grip);

      expect(onPatchTask).toHaveBeenCalledTimes(1);
      expect(onPatchTask.mock.calls[0]?.[0]).toBe(item);
      expect(onPatchTask.mock.calls[0]?.[1]).toMatchObject({ done: false });
      expect(onPatchTask.mock.calls[0]?.[1]?.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(onToggleTaskDone).not.toHaveBeenCalled();
    } finally {
      document.elementFromPoint = originalElementFromPoint;
    }
  });

  it("stacks columns on phones and keeps the drag grip touch-safe", () => {
    localStorage.setItem("weddly.locale", "en");
    const { container } = render(
      <I18nProvider>
        <KanbanBoard
          tasks={[task()]}
          vendors={[]}
          currency="HUF"
          filter="tasks"
          onToggleTaskDone={() => {}}
          onPatchTask={() => {}}
          onAddVendor={() => {}}
          onEditVendor={() => {}}
        />
      </I18nProvider>,
    );

    const columns = container.querySelector('[data-kanban-col="todo"]')?.parentElement;
    expect(columns).toHaveClass("flex-col", "sm:flex-row", "sm:min-w-[860px]");
    expect(screen.getByRole("button", { name: "Drag task to another column" })).toHaveClass(
      "h-11",
      "w-11",
      "touch-none",
    );
  });
});
