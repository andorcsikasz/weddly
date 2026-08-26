import type { PhotoAlbum } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppProviders } from "@/components/ui";
import { I18nProvider } from "@/lib/i18n";
import MediaPage from "@/pages/MediaPage";

const realFetch = globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("weddly.locale", "en");
  localStorage.setItem("weddly.token", "host-session");
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("<MediaPage> Wedding Film setup", () => {
  it("shows the included capacity and sends every capture setting when creating", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const createdAlbum: PhotoAlbum = {
      id: 1,
      uploadToken: "film-token",
      slug: null,
      title: "Sari & Andor Wedding",
      shotsPerGuest: 24,
      revealAt: new Date("2099-01-02T12:00").getTime(),
      eventEndsAt: new Date("2099-01-01T23:00").getTime(),
      isUploadEnabled: true,
      allowGuestViewing: true,
      filmAesthetic: "natural",
      coverImageUrl: null,
      guestCap: 25,
      stripeTier: "free",
      paidAt: null,
      photoCount: 0,
      participantCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/couples/current") {
        return Promise.resolve(
          json({
            couple: {
              display_name: "Sari & Andor",
              bride_name: "Sari",
              groom_name: "Andor",
              wedding_date: "2099-01-01",
              media_links: { photographer: [] },
            },
          }),
        );
      }
      if (url === "/api/photo-albums/current") {
        return Promise.resolve(json({ album: null }));
      }
      if (url === "/api/photo-albums/film-access") {
        return Promise.resolve(
          json({
            access: { free: false, reason: null, priceEurCents: 790, checkoutEnabled: true },
          }),
        );
      }
      if (url === "/api/photo-albums" && method === "POST") {
        requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Promise.resolve(json({ album: createdAlbum }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    render(
      <I18nProvider>
        <AppProviders>
          <MemoryRouter initialEntries={["/app/media"]}>
            <MediaPage />
          </MemoryRouter>
        </AppProviders>
      </I18nProvider>,
    );

    const createButtons = await screen.findAllByRole("button", { name: "Create Wedding Film" });
    fireEvent.click(createButtons[0] as HTMLButtonElement);

    const dialog = await screen.findByRole("dialog", { name: "Set up your guest photo album" });
    expect(dialog).toBeVisible();
    expect(screen.getByDisplayValue("24")).toHaveAttribute("type", "number");
    expect(screen.getAllByText("25 Guests").length).toBeGreaterThan(0);
    expect(screen.getByText("Unlock 200 · €7.90")).toBeVisible();

    const dateInputs = Array.from(
      dialog.querySelectorAll<HTMLInputElement>('input[type="datetime-local"]'),
    );
    expect(dateInputs).toHaveLength(2);
    const [eventEndsInput, revealInput] = dateInputs;
    if (!eventEndsInput || !revealInput) throw new Error("Expected both film date inputs");
    fireEvent.change(eventEndsInput, {
      target: { value: "2099-01-01T23:00" },
    });
    fireEvent.change(revealInput, {
      target: { value: "2099-01-02T12:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create album" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      title: "Sari & Andor Wedding",
      film_aesthetic: "natural",
      shots_per_guest: 24,
      event_ends_at: new Date("2099-01-01T23:00").getTime(),
      reveal_at: new Date("2099-01-02T12:00").getTime(),
    });
  });
});
