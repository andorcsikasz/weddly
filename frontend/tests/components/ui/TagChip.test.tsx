import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { TagChip } from "@/components/ui/TagChip";
import { I18nProvider } from "@/lib/i18n";

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
      <I18nProvider>
        <TagChip label="Anna" selected onToggle={() => undefined} removable onRemove={onRemove} />
      </I18nProvider>,
    );
    // The button's aria-label runs through t("common.remove_item", { label }),
    // which resolves to "Remove Anna" (en) or "Anna eltávolítása" (hu) depending
    // on jsdom's detected locale — both contain "Anna", which is enough to find it.
    const remove = screen.getByRole("button", { name: /Anna/ });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
