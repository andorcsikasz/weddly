// The Google Calendar button has three states the person can act on, and each
// one is a different sentence to a couple, so each is pinned here:
//
//   1. disconnected    -> "Connect Google Calendar" starts the consent flow;
//   2. reconnect       -> a dead grant is its own amber button, not a green tick
//                         and not a menu item, because the reconnect IS the fix;
//   3. connected       -> the pill with its menu, and no reconnect prompt.
// And while a request is in flight the button is disabled and says so, so a
// second click cannot start a second consent round-trip.

import { describe, expect, it } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GoogleCalendarStatus } from "@shared/types";
import { GoogleCalendarConnect, type GoogleCalendarApi } from "@/components/GoogleCalendarConnect";
import { ConfirmDialogProvider } from "@/components/ui/ConfirmDialogProvider";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { I18nProvider } from "@/lib/i18n";

function Providers({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

function status(overrides: Partial<GoogleCalendarStatus>): GoogleCalendarStatus {
  return {
    configured: true,
    connected: false,
    email: null,
    calendarId: null,
    lastSyncedAt: null,
    syncState: null,
    lastError: null,
    needsReconnect: false,
    verificationPending: false,
    pullEnabled: null,
    busySyncedAt: null,
    externalBusyCount: 0,
    ...overrides,
  };
}

/** A fake of the endpoint client. `connect` never settles unless told to, so a
 *  test can observe the pending state. */
function fakeApi(current: GoogleCalendarStatus, connect?: () => Promise<{ url: string }>) {
  const api: GoogleCalendarApi = {
    status: async () => current,
    connect: connect ?? (async () => ({ url: "https://accounts.google.com/o/oauth2/v2/auth" })),
    sync: async () => current,
    disconnect: async () => status({}),
  };
  return api;
}

describe("GoogleCalendarConnect: the button reflects the connection state", () => {
  it("offers Connect when disconnected", async () => {
    render(<GoogleCalendarConnect api={fakeApi(status({}))} keyPrefix="timeline" />, {
      wrapper: Providers,
    });
    const button = await screen.findByRole("button", { name: "Connect Google Calendar" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers Reconnect as its own button when Google has ended the grant", async () => {
    render(
      <GoogleCalendarConnect
        api={fakeApi(status({ connected: true, needsReconnect: true }))}
        keyPrefix="timeline"
      />,
      { wrapper: Providers },
    );
    const button = await screen.findByRole("button", { name: "Reconnect Google Calendar" });
    // It starts the consent round-trip directly. A menu item here would hide the
    // one fix behind a click that reads as optional.
    expect(button.getAttribute("aria-haspopup")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the connected pill with a menu and no reconnect prompt", async () => {
    render(
      <GoogleCalendarConnect
        api={fakeApi(status({ connected: true, email: "owner@example.test" }))}
        keyPrefix="timeline"
      />,
      { wrapper: Providers },
    );
    const pill = await screen.findByRole("button", { name: "Google Calendar options" });
    expect(pill.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByRole("button", { name: "Reconnect Google Calendar" })).toBeNull();
  });

  it("renders nothing while the integration is not configured on the server", async () => {
    const { container } = render(
      <GoogleCalendarConnect api={fakeApi(status({ configured: false }))} keyPrefix="timeline" />,
      { wrapper: Providers },
    );
    await waitFor(() => expect(container.querySelector("button")).toBeNull());
  });
});

describe("GoogleCalendarConnect: a request in flight disables the button", () => {
  it("is disabled and says connecting until the consent URL comes back", async () => {
    let release: (v: { url: string }) => void = () => {};
    const pending = new Promise<{ url: string }>((resolve) => {
      release = resolve;
    });
    render(
      <GoogleCalendarConnect api={fakeApi(status({}), () => pending)} keyPrefix="timeline" />,
      { wrapper: Providers },
    );
    const button = (await screen.findByRole("button", {
      name: "Connect Google Calendar",
    })) as HTMLButtonElement;
    fireEvent.click(button);

    const busy = await screen.findByRole("button", { name: /Connecting/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    // Let the request finish so the test does not leave a dangling promise.
    release({ url: "about:blank" });
  });
});
