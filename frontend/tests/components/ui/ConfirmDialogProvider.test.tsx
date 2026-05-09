import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ConfirmDialogProvider, useConfirm } from "@/components/ui/ConfirmDialogProvider";

function Harness({
  destructive = false,
  onResult,
}: {
  destructive?: boolean;
  onResult: (v: boolean) => void;
}) {
  const confirm = useConfirm();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        setPending(true);
        const ok = await confirm({
          title: "Delete this?",
          body: "Are you sure?",
          confirmLabel: "Yes",
          cancelLabel: "No",
          destructive,
        });
        setPending(false);
        onResult(ok);
      }}
    >
      Trigger {pending ? "(pending)" : ""}
    </button>
  );
}

describe("<ConfirmDialogProvider> + useConfirm()", () => {
  it("resolves true when the confirm button is clicked", async () => {
    const results: boolean[] = [];
    render(
      <ConfirmDialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </ConfirmDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Trigger/ }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    expect(screen.getByText("Delete this?")).toBeInTheDocument();
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    await waitFor(() => expect(results).toEqual([true]));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("resolves false when the cancel button is clicked", async () => {
    const results: boolean[] = [];
    render(
      <ConfirmDialogProvider>
        <Harness onResult={(v) => results.push(v)} />
      </ConfirmDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Trigger/ }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    await waitFor(() => expect(results).toEqual([false]));
  });

  // ESC behaviour is exercised through the Dialog's `keydown` listener; the
  // happy-dom + React 19 portal teardown path throws DOMException on
  // removeChild during synchronous unmount, so we cover ESC end-to-end via
  // Playwright once that lands. Click-to-cancel above proves the resolve path.

  it("renders the destructive variant on confirm when requested", async () => {
    render(
      <ConfirmDialogProvider>
        <Harness destructive onResult={() => undefined} />
      </ConfirmDialogProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Trigger/ }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Yes" }).className).toContain("btn-accent");
  });
});
