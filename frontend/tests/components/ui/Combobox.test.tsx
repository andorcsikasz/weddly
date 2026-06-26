import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Combobox, type ComboOption } from "@/components/Combobox";

const OPTS: ComboOption[] = [
  { id: "city:Budapest", label: "Budapest", hint: "Town" },
  { id: "city:Budakeszi", label: "Budakeszi", hint: "Town" },
  { id: "sup:a1", label: "A-list Salon", hint: "Supplier" },
];

/** Controlled harness — the real callers own `value`, so the test does too. */
function Harness({
  onSelect,
  onClear,
}: {
  onSelect: (o: ComboOption) => void;
  onClear?: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <Combobox
      value={value}
      onChange={setValue}
      onSelect={onSelect}
      options={OPTS}
      ariaLabel="Search"
      onClear={
        onClear
          ? () => {
              setValue("");
              onClear();
            }
          : undefined
      }
    />
  );
}

describe("<Combobox>", () => {
  it("keeps the listbox closed until the field is focused", () => {
    render(<Harness onSelect={() => undefined} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens the listbox on focus and renders an option per suggestion", () => {
    render(<Harness onSelect={() => undefined} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Search" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("selects an option on click", () => {
    const onSelect = mock((_o: ComboOption) => undefined);
    render(<Harness onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Search" }));
    fireEvent.mouseDown(screen.getByText("A-list Salon"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe("sup:a1");
  });

  it("navigates with the arrow keys and commits on Enter", () => {
    const onSelect = mock((_o: ComboOption) => undefined);
    render(<Harness onSelect={onSelect} />);
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" }); // active 0 -> 1
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect.mock.calls[0]?.[0]?.id).toBe("city:Budakeszi");
  });

  it("closes the listbox on Escape", () => {
    render(<Harness onSelect={() => undefined} />);
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.focus(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("hides the clear button when the value is empty", () => {
    render(
      <Combobox
        value=""
        onChange={() => undefined}
        onSelect={() => undefined}
        options={[]}
        ariaLabel="Search"
        onClear={() => undefined}
      />,
    );
    // The combobox input carries the "Search" label but is not a button.
    expect(screen.queryAllByRole("button", { name: "Search" }).length).toBe(0);
  });

  it("shows a clear button when a value is present and fires onClear", () => {
    const onClear = mock(() => undefined);
    render(
      <Combobox
        value="Buda"
        onChange={() => undefined}
        onSelect={() => undefined}
        options={[]}
        ariaLabel="Search"
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("renders a suffix overlay when provided", () => {
    render(
      <Combobox
        value="Tata"
        onChange={() => undefined}
        onSelect={() => undefined}
        options={[]}
        ariaLabel="City"
        suffix="+25 km"
      />,
    );
    expect(screen.getByText("+25 km")).toBeTruthy();
  });
});
