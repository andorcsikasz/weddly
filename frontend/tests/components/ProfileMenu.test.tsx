import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProfileMenu } from "@/components/ProfileMenu";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";

const realFetch = globalThis.fetch;

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function user() {
  return {
    id: 1,
    email: "sara@example.test",
    full_name: "Sára Zöld",
    status: "active",
    role: "user",
    is_admin: false,
    couple_id: 1,
    verified_email: true,
    created_at: Date.now(),
  };
}

function renderMenu(partner: unknown) {
  let partnerRequests = 0;
  globalThis.fetch = ((input) => {
    const url = String(input);
    if (url.endsWith("/api/auth/me")) return Promise.resolve(ok({ user: user() }));
    if (url.endsWith("/api/couples/partner")) {
      partnerRequests += 1;
      return Promise.resolve(ok({ partner }));
    }
    return Promise.resolve(ok({}));
  }) as typeof fetch;

  const view = render(
    <MemoryRouter initialEntries={["/app"]}>
      <I18nProvider>
        <AuthProvider>
          <ProfileMenu />
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
  return { view, partnerRequests: () => partnerRequests };
}

beforeEach(() => {
  localStorage.setItem("weddly.token", "test-token");
  localStorage.setItem("weddly.locale", "en");
  localStorage.removeItem("weddly.demo_session");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem("weddly.token");
  localStorage.removeItem("weddly.locale");
  localStorage.removeItem("weddly.demo_session");
});

describe("<ProfileMenu>", () => {
  it("shows an empty invite link only after the server confirms there is no partner invite", async () => {
    const { view } = renderMenu(null);

    const inviteSlot = await screen.findByRole("link", { name: "Invite your partner" });
    expect(inviteSlot).toHaveAttribute("href", "/app#invite-partner");
    expect(inviteSlot).toBeEmptyDOMElement();

    view.unmount();
  });

  it("does not show the empty slot while a partner invitation is pending", async () => {
    const { view, partnerRequests } = renderMenu({
      full_name: null,
      email: "partner@example.test",
      status: "invited",
    });

    await waitFor(() => expect(partnerRequests()).toBeGreaterThan(0));
    expect(screen.queryByRole("link", { name: "Invite your partner" })).not.toBeInTheDocument();

    view.unmount();
  });

  it("places both active indicators in the same bottom-right position", async () => {
    const { view } = renderMenu({
      full_name: "Csaba Antal",
      email: "csaba@example.test",
      status: "active",
    });

    await waitFor(() => {
      expect(view.container.querySelectorAll(".bg-sage-500")).toHaveLength(2);
    });
    expect(view.container.querySelectorAll(".bg-sage-500.right-0")).toHaveLength(2);
    expect(view.container.querySelector(".bg-sage-500.left-0")).not.toBeInTheDocument();

    view.unmount();
  });

  it("keeps an inactive partner muted while the current working profile is green", async () => {
    const { view } = renderMenu({
      full_name: "Csaba Antal",
      email: "csaba@example.test",
      status: "joined",
    });

    await waitFor(() => {
      expect(view.container.querySelectorAll(".bg-sage-500.right-0")).toHaveLength(1);
      expect(view.container.querySelector(".bg-umber-400.right-0")).toBeInTheDocument();
    });

    view.unmount();
  });
});
