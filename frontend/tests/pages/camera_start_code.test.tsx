// /camera/start with a tryout code: the admin hands out
// /camera/start?code=…, the form checks the code as soon as it knows who is
// asking, and the payment step is replaced by "open my film". Checking spends
// nothing; the code is only redeemed once the film exists (covered end to end
// in backend/tests/api/film_codes.e2e.test.ts).

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n";
import CameraStartPage from "@/pages/CameraStartPage";

const realFetch = globalThis.fetch;
let checks: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("weddly.locale", "en");
  localStorage.setItem("weddly.token", "session.sig");
  checks = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/auth/me")) {
      return Promise.resolve(
        json({
          user: {
            id: 7,
            email: "anna@example.test",
            full_name: "Anna Kiss",
            couple_id: null,
            role: "owner",
            user_type: "couple",
            verified_email: true,
            camera_only: false,
            locale: "en",
          },
        }),
      );
    }
    if (url.includes("/api/film-codes/check")) {
      const code = (JSON.parse(String(init?.body)) as { code: string }).code;
      checks.push(code);
      return Promise.resolve(
        code === "FAIR2027"
          ? json({ cap: 50 })
          : json({ error: "code_used_up", detail: { code: "code_used_up" } }, 410),
      );
    }
    return Promise.resolve(json({}));
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider>
        <AuthProvider>
          <Routes>
            <Route path="/camera/start" element={<CameraStartPage />} />
          </Routes>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

describe("/camera/start with a tryout code", () => {
  it("applies a code from the link and swaps payment for opening the film", async () => {
    renderAt("/camera/start?code=fair2027");
    expect(await screen.findByText("Code applied: up to 50 guests")).toBeInTheDocument();
    expect(checks).toEqual(["FAIR2027"]);
    expect(screen.getByRole("button", { name: /Open my film/ })).toBeInTheDocument();
    expect(screen.queryByText(/Secure payment with Stripe/)).toBeNull();
  });

  it("explains a refused code and keeps the paid route", async () => {
    renderAt("/camera/start");
    fireEvent.click(await screen.findByRole("button", { name: /Have a code\?/ }));
    fireEvent.change(screen.getByLabelText("Your code"), { target: { value: "spent-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("This code has already been used."),
    );
    expect(screen.getByText(/Secure payment with Stripe/)).toBeInTheDocument();
  });
});
