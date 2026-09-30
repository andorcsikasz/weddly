import "../setup";

import type { PlanningItem } from "@shared/types";
import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { AppProviders } from "@/components/ui/AppProviders";
import { WeddingChecklist } from "@/components/WeddingChecklist";
import { I18nProvider } from "@/lib/i18n";
import type { PlanningPace } from "@shared/wedding_checklist";

function Harness() {
  const [items, setItems] = useState<PlanningItem[]>([]);
  const [pace, setPace] = useState<PlanningPace | null>(null);
  return (
    <WeddingChecklist
      items={items}
      onItemsChange={(updater) => setItems(updater(items))}
      weddingDate="2029-06-16"
      profile={{}}
      pace={pace}
      onPaceChange={setPace}
    />
  );
}

describe("planning pace question", () => {
  it("asks first, then re-times the checklist to the answer", async () => {
    localStorage.setItem("weddly.locale", "en");
    const realFetch = globalThis.fetch;
    const sent: unknown[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/planning/checklist/pace") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { pace: PlanningPace };
        sent.push(body);
        return new Response(JSON.stringify({ pace: body.pace, items: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    try {
      const { container } = render(
        <I18nProvider>
          <AppProviders>
            <Harness />
          </AppProviders>
        </I18nProvider>,
      );
      // The question stands in for the checklist: three options, no list yet.
      expect(screen.getByText("How far ahead are you planning?")).toBeTruthy();
      expect(container.querySelectorAll("[data-pace]")).toHaveLength(3);
      expect(container.querySelector('[data-checklist-surface="persistent"]')).toBeNull();

      fireEvent.click(screen.getByRole("radio", { name: /Last minute/ }));
      await waitFor(() =>
        expect(container.querySelector('[data-checklist-surface="persistent"]')).toBeTruthy(),
      );
      expect(sent).toEqual([{ pace: "last_minute" }]);
      expect(screen.getByText("12–16 weeks before")).toBeTruthy();
      expect(screen.queryByText("12–18 months before")).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
