import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EntryDialogProvider, useEntryPrompt } from "@/components/ui/EntryDialogProvider";

function Harness({ onResult }: { onResult: (v: string | null) => void }) {
  const prompt = useEntryPrompt();
  return (
    <button
      type="button"
      onClick={async () => {
        const v = await prompt({
          title: "Snapshot name",
          label: "Name",
          confirmLabel: "Save",
          cancelLabel: "Cancel",
          validate: (s) => (s.length === 0 ? "Required" : null),
        });
        onResult(v);
      }}
    >
      Trigger
    </button>
  );
}

describe("<EntryDialogProvider> + useEntryPrompt()", () => {
  it("returns the entered text on submit", async () => {
    const results: (string | null)[] = [];
    render(
      <EntryDialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </EntryDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Plan A" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(results).toEqual(["Plan A"]));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns null when cancelled", async () => {
    const results: (string | null)[] = [];
    render(
      <EntryDialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </EntryDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(results).toEqual([null]));
  });

  it("blocks submit while validation fails and shows error", async () => {
    const results: (string | null)[] = [];
    render(
      <EntryDialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </EntryDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Required"));
    expect(results).toEqual([]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("trims surrounding whitespace before resolving", async () => {
    const results: (string | null)[] = [];
    render(
      <EntryDialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </EntryDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Trim me  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(results).toEqual(["Trim me"]));
  });
});
