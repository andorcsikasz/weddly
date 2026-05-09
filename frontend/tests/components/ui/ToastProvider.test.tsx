import { describe, expect, it } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { ToastProvider, useToast } from "@/components/ui/ToastProvider";

function withProvider(node: ReactNode) {
  return <ToastProvider>{node}</ToastProvider>;
}

function Pusher({
  message,
  kind,
  duration,
}: {
  message: string;
  kind?: "success" | "error" | "info";
  duration?: number;
}) {
  const toast = useToast();
  useEffect(() => {
    toast.push({ message, kind, duration });
  }, [toast, message, kind, duration]);
  return null;
}

describe("<ToastProvider> + useToast()", () => {
  it("renders pushed toasts in the live region", async () => {
    render(withProvider(<Pusher message="Saved!" kind="success" duration={0} />));
    await waitFor(() => expect(screen.getByText("Saved!")).toBeInTheDocument());
  });

  it("uses role='alert' for error toasts and 'status' for success", async () => {
    render(withProvider(<Pusher message="Bad" kind="error" duration={0} />));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Bad"));

    render(withProvider(<Pusher message="Good" kind="success" duration={0} />));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Good"));
  });

  it("dismisses when the user clicks the close button", async () => {
    render(withProvider(<Pusher message="Click me away" duration={0} />));
    await waitFor(() => expect(screen.getByText("Click me away")).toBeInTheDocument());
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    act(() => {
      fireEvent.click(dismiss);
    });
    await waitFor(() => expect(screen.queryByText("Click me away")).not.toBeInTheDocument());
  });

  it("auto-dismisses after the configured duration", async () => {
    render(withProvider(<Pusher message="Bye" duration={50} />));
    await waitFor(() => expect(screen.getByText("Bye")).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText("Bye")).not.toBeInTheDocument(), {
      timeout: 500,
    });
  });

  it("throws when useToast is used outside the provider", () => {
    function Bare() {
      useToast();
      return null;
    }
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(() => render(<Bare />)).toThrow(/useToast/);
    } finally {
      console.error = original;
    }
  });
});
