import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TagChip } from "@/components/ui/TagChip";

describe("<TagChip>", () => {
  it("renders as a checkbox role and reflects selected state via aria-checked", () => {
    render(<TagChip label="Rustic" selected={false} onToggle={() => undefined} />);
    const chip = screen.getByRole("checkbox", { name: "Rustic" });
    expect(chip).toHaveAttribute("aria-checked", "false");
  });

  it("flips aria-checked when selected becomes true", () => {
    const { rerender } = render(
      <TagChip label="Rustic" selected={false} onToggle={() => undefined} />,
    );
    rerender(<TagChip label="Rustic" selected={true} onToggle={() => undefined} />);
    expect(screen.getByRole("checkbox", { name: "Rustic" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("calls onToggle on click", () => {
    const onToggle = mock(() => undefined);
    render(<TagChip label="Modern" selected={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Modern" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("respects disabled prop", () => {
    const onToggle = mock(() => undefined);
    render(<TagChip label="X" selected={false} onToggle={onToggle} disabled />);
    const chip = screen.getByRole("checkbox", { name: "X" });
    expect(chip).toBeDisabled();
    fireEvent.click(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("renders a remove button in removable mode and fires onRemove", () => {
    const onRemove = mock(() => undefined);
    render(
      <TagChip label="Anna" selected onToggle={() => undefined} removable onRemove={onRemove} />,
    );
    const remove = screen.getByRole("button", { name: /Remove Anna/i });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
