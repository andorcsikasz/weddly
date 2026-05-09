import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const OPTIONS = [
  { value: "hu" as const, label: "Magyar" },
  { value: "en" as const, label: "English" },
] as const;

describe("<SegmentedControl>", () => {
  it("renders a radiogroup with one radio per option", () => {
    render(
      <SegmentedControl
        ariaLabel="Language"
        value="hu"
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Language" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(2);
  });

  it("marks the active option with aria-checked='true'", () => {
    render(
      <SegmentedControl
        ariaLabel="Language"
        value="en"
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("radio", { name: "English" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Magyar" })).toHaveAttribute("aria-checked", "false");
  });

  it("only the active option is in the tab order (roving tabindex)", () => {
    render(
      <SegmentedControl
        ariaLabel="Language"
        value="hu"
        options={OPTIONS}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("radio", { name: "Magyar" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "English" })).toHaveAttribute("tabindex", "-1");
  });

  it("calls onChange when an option is clicked", () => {
    const onChange = mock(() => undefined);
    render(
      <SegmentedControl ariaLabel="Language" value="hu" options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(onChange).toHaveBeenCalledWith("en");
  });

  it("ArrowRight selects the next option", () => {
    const onChange = mock(() => undefined);
    render(
      <SegmentedControl ariaLabel="Language" value="hu" options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Magyar" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("en");
  });

  it("ArrowLeft wraps to the previous option", () => {
    const onChange = mock(() => undefined);
    render(
      <SegmentedControl ariaLabel="Language" value="hu" options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "Magyar" }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledWith("en");
  });

  it("Home jumps to first, End to last", () => {
    const onChange = mock(() => undefined);
    render(
      <SegmentedControl ariaLabel="Language" value="en" options={OPTIONS} onChange={onChange} />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "English" }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("hu");
    fireEvent.keyDown(screen.getByRole("radio", { name: "English" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("en");
  });
});
