// The country picker replaced a scrolling chip row on the public browse
// teaser. Two properties matter and are easy to lose: the closed state must
// state the current filter (that is the whole reason it replaced the chips),
// and every country must stay reachable without a swipe.

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { CountryPicker } from "@/components/CountryPicker";

// No `afterEach(cleanup)` here. `tests/setup.ts` wipes `document.body.innerHTML`
// from a preload-registered hook, which runs first — so a `cleanup()` here finds
// its containers already detached and throws "The node to be removed is not a child
// of this node", failing every test in the file from teardown. The body wipe is
// the teardown; a test that needs to unmount mid-way calls its own render
// result's `unmount()`.

const OPTIONS = [
  { code: "HU", label: "Magyarország", count: 145 },
  { code: "GR", label: "Görögország", count: 40 },
  { code: "AL", label: "Albánia", count: 38 },
];

function setup(value: string | null = null) {
  const onChange = mock((_: string | null) => {});
  const view = render(
    <CountryPicker
      value={value}
      options={OPTIONS}
      onChange={onChange}
      allLabel="Mind"
      ariaLabel="Ország"
    />,
  );
  // `view` is returned so a test that re-renders can unmount THIS picker through
  // its own render result. The module-level `cleanup()` walks every container
  // registered in the process, so it reaches into other tests' DOM and fails on
  // entries the body wipe has already detached.
  return { onChange, view, trigger: screen.getByRole("button", { name: "Ország" }) };
}

describe("CountryPicker", () => {
  it("keeps the list closed until asked, and shows the current filter", () => {
    const { trigger } = setup("GR");
    // Closed: the trigger is the answer. The other countries are not on screen.
    expect(trigger.textContent).toContain("Görögország");
    expect(trigger.textContent).toContain("40");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByText("Albánia")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("falls back to the all-countries label when nothing is picked", () => {
    const { trigger } = setup(null);
    expect(trigger.textContent).toContain("Mind");
  });

  it("lists every country plus the all row when opened", () => {
    const { trigger } = setup(null);
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    // 3 countries + the "all" row. Nothing is hidden behind a horizontal swipe.
    expect(screen.getAllByRole("option").length).toBe(OPTIONS.length + 1);
    for (const o of OPTIONS) expect(screen.getByText(o.label)).toBeTruthy();
  });

  it("reports the picked code, and null for the all row", () => {
    const first = setup(null);
    fireEvent.click(first.trigger);
    fireEvent.click(screen.getByText("Albánia"));
    expect(first.onChange).toHaveBeenCalledWith("AL");
    first.view.unmount();

    // With a country picked, the trigger shows that country, so the only
    // "Mind" on screen is the all row inside the open list.
    const second = setup("AL");
    fireEvent.click(second.trigger);
    fireEvent.click(screen.getByText("Mind"));
    expect(second.onChange).toHaveBeenCalledWith(null);
  });

  it("marks the picked row as selected for assistive tech", () => {
    const { trigger } = setup("GR");
    fireEvent.click(trigger);
    const selected = screen
      .getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true");
    expect(selected.length).toBe(1);
    expect(selected[0]?.textContent).toContain("Görögország");
  });

  it("closes on Escape without changing the filter", () => {
    const { trigger, onChange } = setup(null);
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens and picks with the keyboard alone", () => {
    const { trigger, onChange } = setup(null);
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // opens, lands on "all"
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // first country
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("HU");
  });
});
