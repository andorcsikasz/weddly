// Planner dashboard day rail. Guards the local-date bucketing (today vs
// overdue, done rows excluded), the urgent panel's count + per-row overdue
// labels, the inline mark-done toggle, and the on-card collapse control
// (collapsed = slim handle with the urgent count still visible). The rail is
// fully props-driven — no fetch stubbing needed.

import type { PlannerClientView, PlannerTaskRow } from "@shared/types";
import { beforeEach, describe, expect, it } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { todayIso } from "@/lib/format";
import { I18nProvider } from "@/lib/i18n";
import { PlannerDashRightRail } from "@/pages/planner/PlannerDashRightRail";

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>{children}</I18nProvider>
    </MemoryRouter>
  );
}

/** Local ISO date `days` from today (negative = past). */
function isoFromToday(days: number): string {
  const base = new Date(`${todayIso()}T00:00:00`);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(
    base.getDate(),
  ).padStart(2, "0")}`;
}

function task(over: Partial<PlannerTaskRow> = {}): PlannerTaskRow {
  return {
    task_id: 1,
    couple_id: 1,
    display_name: "Anna & Bence",
    title: "Untitled task",
    due_date: todayIso(),
    priority: 0,
    done: false,
    board_status: "todo",
    ...over,
  };
}

const clients: PlannerClientView[] = [
  {
    couple_id: 1,
    display_name: "Anna & Bence",
  } as PlannerClientView,
];

const noop = () => {};

function renderRail(
  tasks: PlannerTaskRow[],
  over: Partial<Parameters<typeof PlannerDashRightRail>[0]> = {},
) {
  return render(
    <Providers>
      <PlannerDashRightRail
        tasks={tasks}
        clients={clients}
        collapsed={false}
        onToggleCollapsed={noop}
        onMarkDone={noop}
        {...over}
      />
    </Providers>,
  );
}

beforeEach(() => {
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    // ignore
  }
});

describe("<PlannerDashRightRail>", () => {
  it("buckets tasks into today vs overdue and excludes done rows", () => {
    renderRail([
      task({ task_id: 1, title: "Due today" }),
      task({ task_id: 2, title: "Done today", done: true }),
      task({ task_id: 3, title: "Late task", due_date: isoFromToday(-3) }),
      task({ task_id: 4, title: "Late but done", due_date: isoFromToday(-3), done: true }),
      task({ task_id: 5, title: "Future task", due_date: isoFromToday(4) }),
    ]);

    expect(screen.getByText("Due today")).toBeInTheDocument();
    expect(screen.getByText("Late task")).toBeInTheDocument();
    expect(screen.queryByText("Done today")).not.toBeInTheDocument();
    expect(screen.queryByText("Late but done")).not.toBeInTheDocument();
    expect(screen.queryByText("Future task")).not.toBeInTheDocument();
    // Urgent header shows the overdue count.
    expect(screen.getByRole("button", { name: /Attention 1/ })).toBeInTheDocument();
    // Per-row overdue label.
    expect(screen.getByText("due 3 days ago")).toBeInTheDocument();
  });

  it("shows the all-clear state when nothing is overdue", () => {
    renderRail([task({ task_id: 1, title: "Due today" })]);
    expect(screen.getByText("No overdue tasks across any client.")).toBeInTheDocument();
    expect(screen.queryByText("Attention")).not.toBeInTheDocument();
  });

  it("labels a 1-day-late task as due yesterday", () => {
    renderRail([task({ task_id: 1, title: "Just missed", due_date: isoFromToday(-1) })]);
    expect(screen.getByText("due yesterday")).toBeInTheDocument();
  });

  it("fires onMarkDone with the task id from the inline toggle", () => {
    const doneIds: number[] = [];
    renderRail([task({ task_id: 42, title: "Check off me" })], {
      onMarkDone: (id: number) => doneIds.push(id),
    });
    const toggle = screen.getByRole("button", { name: "Mark as done" });
    fireEvent.click(toggle);
    expect(doneIds).toEqual([42]);
  });

  it("caps the urgent list and links out with the remainder count", () => {
    renderRail(
      Array.from({ length: 6 }, (_, i) =>
        task({ task_id: i + 1, title: `Late ${i + 1}`, due_date: isoFromToday(-2) }),
      ),
    );
    expect(screen.getByText("Late 4")).toBeInTheDocument();
    expect(screen.queryByText("Late 5")).not.toBeInTheDocument();
    expect(screen.getByText("...and 2 more overdue")).toBeInTheDocument();
  });

  it("keeps the collapse control on the card and the expand handle when collapsed", () => {
    let toggles = 0;
    const { rerender } = renderRail([task({ task_id: 1, due_date: isoFromToday(-1) })], {
      onToggleCollapsed: () => {
        toggles += 1;
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse day rail" }));
    expect(toggles).toBe(1);

    rerender(
      <Providers>
        <PlannerDashRightRail
          tasks={[task({ task_id: 1, due_date: isoFromToday(-1) })]}
          clients={clients}
          collapsed={true}
          onToggleCollapsed={() => {
            toggles += 1;
          }}
          onMarkDone={noop}
        />
      </Providers>,
    );
    // Collapsed: the expand control lives on the slim handle, and the urgent
    // count stays visible next to it.
    fireEvent.click(screen.getByRole("button", { name: "Expand day rail" }));
    expect(toggles).toBe(2);
    expect(screen.getByTitle("Attention")).toHaveTextContent("1");
  });
});
