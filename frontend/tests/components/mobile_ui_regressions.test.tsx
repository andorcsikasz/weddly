import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { NewsletterCapture } from "@/components/NewsletterCapture";
import { NotificationBell } from "@/components/NotificationBell";
import { I18nProvider } from "@/lib/i18n";

function providers(node: ReactNode) {
  return render(
    <MemoryRouter>
      <I18nProvider>{node}</I18nProvider>
    </MemoryRouter>,
  );
}

describe("mobile UI regressions", () => {
  it("keeps newsletter consent easy to tap and makes it part of the enabled state", () => {
    providers(<NewsletterCapture source="test" />);

    const email = screen.getByPlaceholderText("email@example.com");
    const consent = screen.getByRole("checkbox");
    const submit = screen.getByRole("button", { name: "Subscribe" });

    expect(consent.closest("label")).toHaveClass("min-h-tap");
    expect(consent).toHaveClass("h-5", "w-5");
    fireEvent.change(email, { target: { value: "couple@example.com" } });
    expect(submit).toBeDisabled();
    fireEvent.click(consent);
    expect(submit).toBeEnabled();
  });

  it("portals the notification panel into the viewport instead of the bell anchor", () => {
    const originalFetch = globalThis.fetch;
    // The panel opening itself is independent of the feed response. Keeping
    // the request pending avoids an unrelated async state update after the
    // portal assertions have completed.
    globalThis.fetch = mock(() => new Promise<Response>(() => {})) as unknown as typeof fetch;

    try {
      providers(<NotificationBell />);
      fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

      const panel = screen.getByRole("menu");
      expect(panel).toHaveClass("notification-panel", "fixed", "z-50");
      expect(panel.parentElement).toBe(document.body);
      expect(panel.style.maxHeight).toContain("100dvh");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
