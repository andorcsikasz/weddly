import "../setup";

import type { ConditionTag } from "@shared/planning_prompts";
import { INTAKE_DIMENSIONS } from "@shared/planning_prompts";
import { describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DecisionsOnboarding } from "@/components/DecisionsOnboarding";
import type { PlanningPromptTags } from "@/lib/endpoints";
import { I18nProvider } from "@/lib/i18n";

function Harness({ onDone }: { onDone: () => void }) {
  const [tags, setTags] = useState<PlanningPromptTags>({});
  return (
    <>
      <DecisionsOnboarding
        tags={tags}
        questionCount={42}
        onAnswer={(tag: ConditionTag, value) => setTags((t) => ({ ...t, [tag]: value }))}
        onDone={onDone}
      />
      <output data-testid="tags">{JSON.stringify(tags)}</output>
    </>
  );
}

const wait = (ms: number) => act(() => new Promise((r) => setTimeout(r, ms)));

describe("decisions onboarding", () => {
  it("asks one question at a time, then shows what is ahead", async () => {
    localStorage.setItem("weddly.locale", "en");
    let done = 0;
    const { container } = render(
      <I18nProvider>
        <Harness onDone={() => done++} />
      </I18nProvider>,
    );
    const first = INTAKE_DIMENSIONS[0];
    expect(screen.getByText(first?.question.en ?? "")).toBeTruthy();
    expect(screen.getByText(`1 of ${INTAKE_DIMENSIONS.length}`)).toBeTruthy();

    // A double tap answers the question once, never the next one too.
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    await wait(220);
    const tags = JSON.parse(screen.getByTestId("tags").textContent ?? "{}");
    expect(tags).toEqual({ [first?.tag as string]: "yes" });
    expect(screen.getByText(INTAKE_DIMENSIONS[1]?.question.en ?? "")).toBeTruthy();

    // Skipping leaves the rest unanswered and still ends on the summary.
    for (let i = 1; i < INTAKE_DIMENSIONS.length; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    }
    expect(container.querySelector('[data-decisions-onboarding="summary"]')).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("questions to consider")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start deciding" }));
    expect(done).toBe(1);
  });
});
