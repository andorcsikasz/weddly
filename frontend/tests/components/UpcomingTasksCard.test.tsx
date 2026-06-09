// Dashboard "your upcoming tasks" card. Guards the selection rules (dated +
// undone + wedding-topic, soonest-first, capped at 5), the relative due chips,
// the two empty states, and the optimistic inline done-toggle. The card self-
// fetches GET /api/planning, so we stub globalThis.fetch with the same handler-
// registry pattern the page tests use; due dates are computed off the real
// `todayIso()` so "overdue / today / in N days" stays deterministic.

import type { PlanningItem } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { UpcomingTasksCard } from "@/components/UpcomingTasksCard";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { todayIso } from "@/lib/format";
import { I18nProvider } from "@/lib/i18n";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
type Call = { url: string; method: Method; body: unknown };

const realFetch = globalThis.fetch;
const calls: Call[] = [];
let listResponse: { items: PlanningItem[] } = { items: [] };

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = ((init?.method ?? "GET").toUpperCase() as Method) ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string" && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });
    if (method === "GET" && url.includes("/api/planning")) {
      return jsonResponse(200, listResponse);
    }
    if (method === "PATCH" && url.includes("/api/planning/")) {
      return jsonResponse(200, { item: {} });
    }
    return jsonResponse(200, {});
  }) as typeof fetch;
}

async function flush(times = 2) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

/** ISO date `days` from today (negative = past). */
function isoFromToday(days: number): string {
  const base = Date.parse(`${todayIso()}T00:00:00Z`);
  const d = new Date(base + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function task(over: Partial<PlanningItem> = {}): PlanningItem {
  return {
    id: 1,
    couple_id: 1,
    kind: "task",
    topic: "wedding",
    title: "Untitled task",
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
    decision_status: null,
    resolution: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  listResponse = { items: [] };
  try {
    localStorage.clear();
    localStorage.setItem("weddly.locale", "en");
  } catch {
    // ignore
  }
  installFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("<UpcomingTasksCard>", () => {
  it("nudges to start planning when the couple has no tasks at all", async () => {
    listResponse = { items: [] };
    render(
      <Providers>
        <UpcomingTasksCard />
      </Providers>,
    );
    await flush();
    expect(screen.getByText("Start planning")).toBeInTheDocument();
  });

  it("reassures when tasks exist but none are dated/pending", async () => {
    listResponse = {
      items: [
        task({ id: 1, title: "Someday", due_date: null }),
        task({ id: 2, title: "Already done", due_date: isoFromToday(2), done: true }),
      ],
    };
    render(
      <Providers>
        <UpcomingTasksCard />
      </Providers>,
    );
    await flush();
    expect(screen.getByText("Nothing urgent. Everything's on track.")).toBeInTheDocument();
    expect(screen.queryByText("Start planning")).not.toBeInTheDocument();
  });

  it("lists dated wedding tasks soonest-first and excludes done/undated/honeymoon", async () => {
    listResponse = {
      items: [
        task({ id: 1, title: "Later task", due_date: isoFromToday(10) }),
        task({ id: 2, title: "Overdue task", due_date: isoFromToday(-3) }),
        task({ id: 3, title: "Honeymoon flight", due_date: isoFromToday(1), topic: "honeymoon" }),
        task({ id: 4, title: "Finished", due_date: isoFromToday(1), done: true }),
        task({ id: 5, title: "Idea not task", kind: "idea", due_date: isoFromToday(1) }),
      ],
    };
    render(
      <Providers>
        <UpcomingTasksCard />
      </Providers>,
    );
    await flush();

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2); // honeymoon + done + idea all excluded
    // Soonest-first: overdue (-3) sorts before the +10 task.
    expect(items[0]).toHaveTextContent("Overdue task");
    expect(items[1]).toHaveTextContent("Later task");
    expect(screen.queryByText("Honeymoon flight")).not.toBeInTheDocument();

    // Relative due chips.
    expect(screen.getByText("3d overdue")).toBeInTheDocument();
    expect(screen.getByText("in 10d")).toBeInTheDocument();
  });

  it("caps the list at 5 rows", async () => {
    listResponse = {
      items: Array.from({ length: 8 }, (_, i) =>
        task({ id: i + 1, title: `Task ${i + 1}`, due_date: isoFromToday(i + 1) }),
      ),
    };
    render(
      <Providers>
        <UpcomingTasksCard />
      </Providers>,
    );
    await flush();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
  });

  it("optimistically completes a task via PATCH and drops it from the list", async () => {
    listResponse = {
      items: [
        task({ id: 7, title: "Confirm florist", due_date: isoFromToday(2) }),
        task({ id: 8, title: "Book band", due_date: isoFromToday(5) }),
      ],
    };
    render(
      <Providers>
        <UpcomingTasksCard />
      </Providers>,
    );
    await flush();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    const firstToggle = screen.getAllByRole("button", { name: "Done" })[0];
    if (!firstToggle) throw new Error("expected a toggle button");
    await act(async () => {
      fireEvent.click(firstToggle);
    });
    await flush();

    const patch = calls.find((c) => c.method === "PATCH" && c.url.includes("/api/planning/7"));
    expect(patch).toBeDefined();
    expect(patch?.body).toMatchObject({ done: true });
    await waitFor(() => expect(screen.queryByText("Confirm florist")).not.toBeInTheDocument());
    expect(screen.getByText("Book band")).toBeInTheDocument();
  });
});
