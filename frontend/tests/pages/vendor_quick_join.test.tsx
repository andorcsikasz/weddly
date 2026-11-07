// /suppliers/join: the page the admin's in-person QR opens. Three questions,
// and the OK button is the terms acceptance, so the register body must carry
// the same consent fields the long form sends behind its two checkboxes, plus
// the QR attribution.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PRIVACY_VERSION, VENDOR_TERMS_VERSION } from "@shared/legal";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import VendorQuickJoinPage from "@/pages/VendorQuickJoinPage";

const realFetch = globalThis.fetch;
let registered: Record<string, unknown> | null = null;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("weddly.locale", "en");
  registered = null;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/vendor/register")) {
      registered = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        json(
          {
            token: "s.sig",
            user: {
              id: 9,
              email: "studio@example.test",
              full_name: "Studio Bloom",
              role: "vendor",
            },
          },
          201,
        ),
      );
    }
    if (url.includes("/api/auth/me")) return Promise.resolve(json({ error: "no" }, 401));
    return Promise.resolve(json({}));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/suppliers/join"]}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/suppliers/join" element={<VendorQuickJoinPage />} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("/suppliers/join", () => {
  it("registers a vendor in three answers, with OK accepting the terms", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("What's your business called?"), {
      target: { value: "Studio Bloom" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // A tap on a trade is the answer and moves on by itself.
    fireEvent.click(await screen.findByRole("button", { name: "Photography" }));

    const emailField = await screen.findByLabelText("Email");
    const ok = screen.getByRole("button", { name: "OK" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    fireEvent.change(emailField, { target: { value: "studio@example.test" } });
    fireEvent.change(screen.getByLabelText("Password (8+ characters)"), {
      target: { value: "supersafe123" },
    });
    expect(screen.getByText(/By tapping OK you accept the/)).toBeTruthy();
    fireEvent.click(ok);

    await waitFor(() => expect(registered).not.toBeNull());
    expect(registered).toMatchObject({
      email: "studio@example.test",
      business_name: "Studio Bloom",
      full_name: "Studio Bloom",
      category: "photography",
      privacy_version: PRIVACY_VERSION,
      vendor_terms_version: VENDOR_TERMS_VERSION,
      highlighted_terms_accepted: true,
      utm_source: "qr",
    });
    expect(await screen.findByText("You're in, Studio Bloom!")).toBeTruthy();
  });
});
