// The fine-tune row carries the redesign's two load-bearing promises:
//   1. Only one row is open at a time (that is what keeps seven controls in
//      the space the old editor spent on two).
//   2. A swap always shows before/now and can be reverted in one tap, so a
//      couple never has to remember what their page looked like 300ms ago.
// Both are trivially easy to break while refactoring the page around it.

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TuneRow, TuneSwitchRow } from "@/components/design/TuneRow";
import { I18nProvider } from "@/lib/i18n";
import { applyStylePreset, resolveDesign } from "@shared/design";

const COUPLE = { bride_name: "Anna", groom_name: "Bence", wedding_date: "2027-05-29" };
const GARDEN = resolveDesign(null);
const NOIR = applyStylePreset(GARDEN, "midnight_luxe");

function renderRow(open: boolean, before: typeof GARDEN | null, onRevert = mock(() => {})) {
  const utils = render(
    <I18nProvider>
      <TuneRow
        id="colors"
        label="Colours"
        value={<span>value-slot</span>}
        open={open}
        onToggle={mock(() => {})}
        before={before}
        now={NOIR}
        onRevert={onRevert}
        couple={COUPLE}
        locale="en"
        fallbackName="A & B"
      >
        <span>body-slot</span>
      </TuneRow>
    </I18nProvider>,
  );
  return { ...utils, onRevert };
}

describe("TuneRow", () => {
  it("shows its value but not its body while closed", () => {
    renderRow(false, null);
    expect(screen.getByText("value-slot")).toBeTruthy();
    expect(screen.queryByText("body-slot")).toBeNull();
  });

  it("reports its open state to assistive tech", () => {
    const closed = renderRow(false, null);
    expect(closed.container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
    closed.unmount();
    const open = renderRow(true, null);
    expect(open.container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  });

  it("offers revert only once something actually changed", () => {
    // Opened and untouched: before === now, so there is nothing to revert and
    // offering it would be a button that does nothing.
    const same = render(
      <I18nProvider>
        <TuneRow
          id="colors"
          label="Colours"
          value={null}
          open
          onToggle={mock(() => {})}
          before={NOIR}
          now={NOIR}
          onRevert={mock(() => {})}
          couple={COUPLE}
          locale="en"
          fallbackName="A & B"
        >
          <span />
        </TuneRow>
      </I18nProvider>,
    );
    expect(screen.queryByText("Revert")).toBeNull();
    same.unmount();

    // Changed since the row opened: revert appears and fires.
    const { onRevert } = renderRow(true, GARDEN);
    const revert = screen.getByText("Revert");
    fireEvent.click(revert);
    expect(onRevert).toHaveBeenCalled();
  });

  it("renders a before/now pair from the two designs, not from one", () => {
    renderRow(true, GARDEN);
    // Garden is long-form, Noir is Roman numerals. Seeing both proves the pair
    // is fed two different designs rather than the live one twice.
    const text = document.body.textContent ?? "";
    expect(text).toContain("MMXXVII");
    expect(text).toContain("May 29, 2027");
  });
});

describe("TuneSwitchRow", () => {
  it("reveals its sub-choices only while switched on", () => {
    const off = render(
      <I18nProvider>
        <TuneSwitchRow label="Monogram" checked={false} onChange={mock(() => {})}>
          <span>separators</span>
        </TuneSwitchRow>
      </I18nProvider>,
    );
    expect(screen.queryByText("separators")).toBeNull();
    expect(off.container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe(
      "false",
    );
    off.unmount();

    render(
      <I18nProvider>
        <TuneSwitchRow label="Monogram" checked onChange={mock(() => {})}>
          <span>separators</span>
        </TuneSwitchRow>
      </I18nProvider>,
    );
    expect(screen.getByText("separators")).toBeTruthy();
  });
});
