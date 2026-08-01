// Reported 2026-08-01: eight digits typed into "Expected cost" read back as
// "200000000", which nobody can count at a glance. A money field shows the
// figure the way a person writes it and hands the caller raw digits, so
// `Number(value)` keeps working where the old number input used to sit.

import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoneyInput } from "@/components/MoneyInput";

/** The separator is locale-dependent (HU uses a narrow no-break space, EN a
 *  comma), so assert on the shape rather than the exact glyph. */
function grouped(value: string): string {
  return value.replace(/[  \s,.]/g, "|");
}

function setup(locale: "hu" | "en", initial = "") {
  const onChange = mock((_: string) => {});
  const view = render(
    <MoneyInput
      aria-label="amount"
      locale={locale}
      value={initial}
      onChange={onChange}
      placeholder="2000000"
    />,
  );
  return { onChange, view, field: screen.getByLabelText("amount") as HTMLInputElement };
}

describe("<MoneyInput>", () => {
  it("groups the value it displays", () => {
    const { field } = setup("hu", "200000000");
    expect(grouped(field.value)).toBe("200|000|000");
  });

  it("hands the caller raw digits, so Number() still works", () => {
    const { field, onChange } = setup("en", "");
    fireEvent.change(field, { target: { value: "200000000" } });
    expect(onChange).toHaveBeenCalledWith("200000000");
    expect(Number(onChange.mock.calls[0]?.[0])).toBe(200_000_000);
  });

  it("strips whatever the couple pastes in, separators included", () => {
    const { field, onChange } = setup("hu", "");
    fireEvent.change(field, { target: { value: "1 250 000 Ft" } });
    expect(onChange).toHaveBeenCalledWith("1250000");
  });

  it("can be cleared", () => {
    const { field, onChange } = setup("hu", "45000");
    fireEvent.change(field, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("accepts an amount the old step={1000} refused", () => {
    // The euro amounts that produced "the two nearest valid values are 0 and
    // 1000", and a forint one that was refused just as quietly.
    const onChange = mock((_: string) => {});
    render(<MoneyInput aria-label="odd" locale="en" value="" onChange={onChange} />);
    const field = screen.getByLabelText("odd") as HTMLInputElement;
    for (const typed of ["4500", "250", "7"]) {
      fireEvent.change(field, { target: { value: typed } });
      expect(onChange).toHaveBeenLastCalledWith(typed);
    }
  });

  it("groups an all-digit placeholder but leaves a written one alone", () => {
    const { field } = setup("hu", "");
    expect(grouped(field.placeholder)).toBe("2|000|000");

    render(
      <MoneyInput aria-label="dashed" locale="hu" value="" onChange={() => {}} placeholder="-" />,
    );
    expect((screen.getByLabelText("dashed") as HTMLInputElement).placeholder).toBe("-");
  });

  it("keeps the numeric keypad on phones", () => {
    const { field } = setup("hu", "");
    expect(field.getAttribute("inputmode")).toBe("numeric");
  });
});
