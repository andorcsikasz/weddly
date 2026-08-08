import "../setup";

import type { PlanningItem } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/components/ui/AppProviders";
import { I18nProvider } from "@/lib/i18n";
import PlanningPage from "@/pages/PlanningPage";

const realFetch = globalThis.fetch;
let deleteBody: unknown = null;

function task(id: number, title: string): PlanningItem {
  return {
    id,
    couple_id: 1,
    kind: "task",
    topic: "wedding",
    title,
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
    position: id,
    seed_key: null,
    checklist_template_id: null,
    decision_status: null,
    resolution: null,
    idea_status: null,
    idea_tag: null,
    created_at: id,
    updated_at: id,
  };
}

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.setItem("weddly.locale", "en");
  deleteBody = null;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/planning") && (init?.method ?? "GET") === "GET") {
      return response({ items: [task(11, "Confirm florist"), task(12, "Book venue")] });
    }
    if (url.endsWith("/api/planning/prompts/profile")) return response({ tags: {} });
    if (url.endsWith("/api/couples/current")) {
      return response({
        couple: {
          id: 1,
          bride_name: "Ada",
          groom_name: "Bence",
          currency: "HUF",
          wedding_date: null,
        },
      });
    }
    if (url.endsWith("/api/planning/delete-many") && init?.method === "POST") {
      deleteBody = JSON.parse(String(init.body));
      return response({ ok: true, deleted: 2 });
    }
    return response({});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Planning multi-delete", () => {
  it("selects all visible tasks, confirms once, and sends one bulk request", async () => {
    render(
      <MemoryRouter>
        <I18nProvider>
          <AppProviders>
            <PlanningPage />
          </AppProviders>
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Confirm florist")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select" }));
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Confirm florist" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Select Book venue" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Delete 2 items?")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete selected" }));

    await waitFor(() => expect(deleteBody).toEqual({ ids: [11, 12] }));
    await waitFor(() => expect(screen.queryByText("Confirm florist")).not.toBeInTheDocument());
    expect(screen.queryByText("Book venue")).not.toBeInTheDocument();
  });
});
